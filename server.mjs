import express from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 7788;
// bumps on every server restart — lets you confirm the page is not a cached copy
const APP_VERSION = String(Date.now()).slice(-6);

// Static assets: dev mode — never let the browser serve a stale HTML/CSS/JS.
app.use(
  express.static(path.join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    setHeaders(res, filePath) {
      if (/\.(html|css|js)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-store, must-revalidate');
      }
    },
  })
);

app.get('/api/version', (_req, res) => res.json({ v: APP_VERSION }));

// ---------- Search via InnerTube (fast, no yt-dlp needed) ----------
let ytPromise = null;
async function getYt() {
  if (!ytPromise) {
    const { Innertube } = await import('youtubei.js');
    ytPromise = Innertube.create({ retrieve_player: false, generate_session_locally: true });
  }
  return ytPromise;
}

// YouTube rotates results between identical requests (A/B). Cache so a query is stable.
const searchCache = new Map();
const SEARCH_TTL = 1000 * 60 * 5;

app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.status(400).json({ error: 'missing q' });

  const key = q.toLowerCase();
  const cached = searchCache.get(key);
  if (cached && Date.now() < cached.expires) {
    return res.json({ results: cached.results, cached: true });
  }

  try {
    const yt = await getYt();
    const search = await yt.music.search(q, { type: 'song' });
    const raw = search.songs?.contents ?? [];

    const results = raw.map((s) => {
      const thumbs = s.thumbnails ?? [];
      let thumb = thumbs.length ? thumbs[thumbs.length - 1].url : null;
      // youtubei returns w60-h60 by default; bump to a usable size
      if (thumb) thumb = thumb.replace(/=w\d+-h\d+/, '=w120-h120');
      else if (s.id) thumb = `https://i.ytimg.com/vi/${s.id}/mqdefault.jpg`;
      return {
        id: s.id,
        title: s.title ?? 'Unknown',
        artist: (s.artists ?? []).map((a) => a.name).join(', ') || 'Unknown artist',
        album: s.album?.name ?? null,
        duration: s.duration?.seconds ?? null,
        thumbnail: thumb,
      };
    });

    searchCache.set(key, { results, expires: Date.now() + SEARCH_TTL });
    res.json({ results });
  } catch (err) {
    console.error('search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Stream URL resolution via yt-dlp ----------
const urlCache = new Map(); // id -> { url, expires }
const CACHE_MS = 1000 * 60 * 20; // googlevideo urls live ~6h, but IP-bound & rotated; refresh often

async function resolveStreamUrl(id) {
  const hit = urlCache.get(id);
  if (hit && Date.now() < hit.expires) return hit.url;

  const { stdout } = await execFileAsync(
    process.env.PYTHON || 'python',
    ['-m', 'yt_dlp', '-f', 'bestaudio[ext=m4a]/bestaudio', '-g', '--no-warnings', '--no-playlist',
     `https://music.youtube.com/watch?v=${id}`],
    { timeout: 60000, maxBuffer: 1024 * 1024 }
  );

  const url = stdout.trim().split(/\r?\n/).filter(Boolean)[0];
  if (!url) throw new Error('no stream url returned');

  urlCache.set(id, { url, expires: Date.now() + CACHE_MS });
  return url;
}

// ---------- Thumbnail proxy (avoids hotlink blocks / referrer issues) ----------
const thumbCache = new Map();

app.get('/api/thumb/:id', async (req, res) => {
  const id = req.params.id.replace(/[^A-Za-z0-9_-]/g, '');
  if (!id) return res.status(400).end();

  const now = Date.now();
  const hit = thumbCache.get(id);
  if (hit && now - hit.at < 1000 * 60 * 60) {
    res.setHeader('content-type', hit.type);
    res.setHeader('cache-control', 'public, max-age=86400');
    return res.end(hit.buf);
  }

  const sources = [
    `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${id}/sddefault.jpg`,
    `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    `https://i.ytimg.com/vi/${id}/default.jpg`,
  ];

  for (const src of sources) {
    try {
      const r = await fetch(src, {
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://music.youtube.com/' },
      });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 500) continue; // ytimg returns tiny placeholder for missing art
      const type = r.headers.get('content-type') || 'image/jpeg';
      thumbCache.set(id, { buf, type, at: now });
      res.setHeader('content-type', type);
      res.setHeader('cache-control', 'public, max-age=86400');
      return res.end(buf);
    } catch { /* try next */ }
  }
  res.status(404).end();
});

// ---------- Audio proxy (keeps goglevideo happy: IP + UA + Range) ----------
app.get('/api/stream/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const url = await resolveStreamUrl(id);

    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Referer: 'https://music.youtube.com/',
    };
    if (req.headers.range) headers.Range = req.headers.range;

    const upstream = await fetch(url, { headers });

    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).json({ error: `upstream ${upstream.status}` });
    }

    res.status(upstream.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (!upstream.headers.get('content-type')) res.setHeader('content-type', 'audio/mp4');

    const reader = upstream.body.getReader();
    req.on('close', () => reader.cancel().catch(() => {}));

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) {
        await new Promise((r) => res.once('drain', r));
      }
    }
    res.end();
  } catch (err) {
    console.error('stream error:', id, err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
});

// ---------- Metadata for one track ----------
app.get('/api/track/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const { stdout } = await execFileAsync(
      process.env.PYTHON || 'python',
      ['-m', 'yt_dlp', '-J', '--no-warnings', '--no-playlist',
       `https://music.youtube.com/watch?v=${id}`],
      { timeout: 60000, maxBuffer: 20 * 1024 * 1024 }
    );
    const j = JSON.parse(stdout);
    res.json({
      id,
      title: j.title,
      artist: j.artist ?? j.uploader ?? null,
      album: j.album ?? null,
      duration: j.duration ?? null,
      thumbnail: j.thumbnail ?? null,
    });
  } catch (err) {
    console.error('track error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  ruelzmusify web  ->  http://localhost:${PORT}\n`);
});
