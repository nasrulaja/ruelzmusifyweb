// ============================================================
//  RuelzMusify Web
//  Mirrors the Android app's structure:
//    Screens.Home / Search / Library  -> 3 nav destinations
//    MiniPlayer + FloatingNavigationToolbar -> fused dock
// ============================================================

const $ = (id) => document.getElementById(id);

const state = {
  queue: [],
  index: -1,
  liked: new Set(JSON.parse(localStorage.getItem('rq_liked') || '[]')),
  likedTracks: JSON.parse(localStorage.getItem('rq_recent_liked') || localStorage.getItem('rq_liked_tracks') || '{}'),
  recent: JSON.parse(localStorage.getItem('rq_recent') || '[]'),
  shuffle: false,
  repeat: 'off', // off | all | one
  view: 'home',
  libTab: 'liked',
  results: [],
};

const audio = $('audio');

const el = {
  dock: $('dock'),
  mini: $('mini'),
  miniArt: $('miniArt'),
  miniTitle: $('miniTitle'),
  miniArtist: $('miniArtist'),
  miniMeta: $('miniMeta'),
  miniProgress: $('miniProgress'),
  miniToggle: $('miniToggle'),
  miniNext: $('miniNext'),
  miniLike: $('miniLike'),

  scroller: $('scroller'),
  nav: $('nav'),

  chips: $('chips'),
  homeQP: $('home-quickpicks'),
  homeSeed: $('home-seed'),
  homeRecentWrap: $('home-recent-wrap'),
  homeRecent: $('home-recent'),
  homeLikedWrap: $('home-liked-wrap'),
  homeLiked: $('home-liked'),
  homeIdle: $('home-idle'),

  q: $('q'),
  clearQ: $('clearQ'),
  results: $('results'),
  searchEmpty: $('search-empty'),

  library: $('library'),
  libraryEmpty: $('library-empty'),

  full: $('full'),
  fpBg: $('fpBg'),
  fpArt: $('fpArt'),
  fpTitle: $('fpTitle'),
  fpArtist: $('fpArtist'),
  fpSource: $('fpSource'),
  fpLike: $('fpLike'),
  fpClose: $('fpClose'),
  fpFill: $('fpFill'),
  fpKnob: $('fpKnob'),
  slider: $('slider'),
  cur: $('cur'),
  dur: $('dur'),
  toggle: $('toggle'),
  prev: $('prev'),
  next: $('next'),
  shuffleBtn: $('shuffleBtn'),
  repeatBtn: $('repeatBtn'),
  vol: $('vol'),
};

// ---------------- helpers ----------------
const fmt = (s) => {
  if (!s || !isFinite(s) || s < 0) return '0:00';
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const saveJSON = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
};

const thumb = (id) => `/api/thumb/${encodeURIComponent(id)}`;

// ---------------- network ----------------
async function fetchWithRetry(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.status >= 500) throw new Error(`server ${r.status}`);
      return r;
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise((res) => setTimeout(res, 600 * (i + 1)));
    }
  }
  throw lastErr;
}

// ---------------- rendering: rows ----------------
function rowHTML(t) {
  return `
    <img class="row-art" src="${thumb(t.id)}" alt="" loading="lazy" decoding="async"
         onerror="this.style.visibility='hidden'" />
    <div class="row-text">
      <div class="row-title">${esc(t.title)}</div>
      <div class="row-sub">${esc(t.artist)}${t.duration ? ' · ' + fmt(t.duration) : ''}</div>
    </div>
    <span class="row-trailing">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13L19 12z"/></svg>
    </span>`;
}

function makeRow(t, onClick) {
  const row = document.createElement('button');
  row.className = 'row';
  row.dataset.id = t.id;
  row.type = 'button';
  row.innerHTML = rowHTML(t);
  row.addEventListener('click', onClick);
  return row;
}

function skeletonRows(n = 8) {
  return Array.from({ length: n })
    .map(
      () => `
    <div class="row row-skeleton" aria-hidden="true">
      <div class="row-art sk"></div>
      <div class="row-text">
        <div class="sk" style="height:12px;width:65%;border-radius:6px"></div>
        <div class="sk" style="height:10px;width:40%;border-radius:6px"></div>
      </div>
    </div>`
    )
    .join('');
}

// ---------------- rendering: grid/shelf ----------------
function gridItemHTML(t, round = false, sub = '') {
  return `
    <div class="grid-art-wrap${round ? ' round' : ''}">
      <img class="grid-art" src="${thumb(t.id)}" alt="" loading="lazy" decoding="async"
           onerror="this.style.visibility='hidden'" />
    </div>
    <div class="grid-title">${esc(t.title)}</div>
    <div class="grid-sub">${esc(sub || t.artist)}</div>`;
}

function makeGridItem(t, onClick, round = false) {
  const b = document.createElement('button');
  b.className = 'grid-item' + (round ? ' round' : '');
  b.type = 'button';
  b.innerHTML = gridItemHTML(t, round);
  b.addEventListener('click', onClick);
  return b;
}

// ---------------- home feed: seeded discovery ----------------
// The APK's home is populated by YouTube Music's own feed API, which needs
// authenticated InnerTube context. We don't have that here, so instead we
// seed the home from real searches: a set of mood/genre queries, cached
// locally so a warm start paints instantly and an offline start still works.

const SEED_KEY = 'rq_seed_feed';
const SEED_TTL = 1000 * 60 * 60 * 6; // 6h

const SEED_SHELVES = [
  { id: 'mood', title: 'Sesuai suasana hati', q: 'lagu indonesia populer' },
  { id: 'chill', title: 'Santai sore', q: 'acoustic chill indonesia' },
  { id: 'energy', title: 'Buat semangat', q: 'lagu semangat workout' },
  { id: 'throwback', title: 'Klasik Indonesia', q: 'lagu indonesia 90an' },
];

function readSeedCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(SEED_KEY) || 'null');
    if (!raw || !raw.at || Date.now() - raw.at > SEED_TTL) return null;
    return raw.shelves || null;
  } catch {
    return null;
  }
}

function renderSeedShelves(shelves, { loading = false } = {}) {
  el.homeSeed.innerHTML = '';

  shelves.forEach((shelf) => {
    const wrap = document.createElement('div');
    wrap.className = 'seed-shelf';

    const head = document.createElement('div');
    head.className = 'section-head';
    head.innerHTML = `<h2 class="section-title">${esc(shelf.title)}</h2>`;
    wrap.appendChild(head);

    const strip = document.createElement('div');
    strip.className = 'quickpicks';

    if (loading) {
      for (let i = 0; i < 4; i++) {
        const sk = document.createElement('div');
        sk.className = 'qp-card qp-sk';
        sk.innerHTML = '<div class="sk sk-art"></div><div class="sk sk-line"></div><div class="sk sk-line short"></div>';
        strip.appendChild(sk);
      }
      wrap.appendChild(strip);
      el.homeSeed.appendChild(wrap);
      return;
    }

    shelf.tracks.forEach((t, i) => {
      const card = document.createElement('button');
      card.className = 'qp-card';
      card.type = 'button';
      card.innerHTML = `
        <img class="qp-art" src="${thumb(t.id)}" alt="" loading="lazy" decoding="async"
             onerror="this.style.visibility='hidden'" />
        <div class="qp-scrim"></div>
        <span class="qp-play">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13L19 12z"/></svg>
        </span>
        <div class="qp-meta">
          <div class="qp-title">${esc(t.title)}</div>
          <div class="qp-artist">${esc(t.artist)}</div>
        </div>`;
      card.addEventListener('click', () => {
        state.queue = shelf.tracks.slice();
        state.source = shelf.title;
        playAt(i);
      });
      strip.appendChild(card);
    });

    wrap.appendChild(strip);
    el.homeSeed.appendChild(wrap);
  });
}

let seeding = false;
let seedPending = false; // true from boot until the first seed resolves

async function loadSeedFeed({ force = false } = {}) {
  if (seeding) return;
  seedPending = true;
  const cached = force ? null : readSeedCache();
  if (cached) {
    renderSeedShelves(cached);
    el.homeSeed.classList.remove('hidden');
    el.homeIdle.classList.add('hidden');
    seedPending = false;
    return;
  }

  seeding = true;
  renderSeedShelves(
    SEED_SHELVES.map((s) => ({ ...s, tracks: [] })),
    { loading: true }
  );
  el.homeSeed.classList.remove('hidden');

  const shelves = [];
  for (const s of SEED_SHELVES) {
    try {
      const r = await fetchWithRetry(`/api/search?q=${encodeURIComponent(s.q)}`, 2);
      const data = await r.json();
      const tracks = (data.results || []).slice(0, 10);
      if (tracks.length) shelves.push({ id: s.id, title: s.title, tracks });
    } catch {
      /* one dead shelf shouldn't kill the page */
    }
  }

  seeding = false;
  seedPending = false;

  if (!shelves.length) {
    el.homeSeed.classList.add('hidden');
    el.homeIdle.classList.remove('hidden');
    return;
  }

  saveJSON(SEED_KEY, { at: Date.now(), shelves });
  renderSeedShelves(shelves);
  el.homeSeed.classList.remove('hidden');
  el.homeIdle.classList.add('hidden');
}

// ---------------- search ----------------
let searchTimer = null;

el.q.addEventListener('input', () => {
  const q = el.q.value.trim();
  el.clearQ.classList.toggle('hidden', !q);
  clearTimeout(searchTimer);
  if (!q) {
    el.results.innerHTML = '';
    el.results.classList.add('hidden');
    el.searchEmpty.classList.remove('hidden');
    return;
  }
  searchTimer = setTimeout(() => doSearch(q), 400);
});

el.clearQ.addEventListener('click', () => {
  el.q.value = '';
  el.clearQ.classList.add('hidden');
  el.results.innerHTML = '';
  el.results.classList.add('hidden');
  el.searchEmpty.classList.remove('hidden');
  el.q.focus();
});

el.q.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    clearTimeout(searchTimer);
    const q = el.q.value.trim();
    if (q) doSearch(q);
  }
});

let searchSeq = 0;
// A press that starts on a result row must survive the async search finishing.
// Track the press, and flush any deferred render once it completes.
let resultsPressActive = false;
let pendingRender = false;

async function doSearch(q) {
  switchView('search');
  el.searchEmpty.classList.add('hidden');
  el.results.classList.remove('hidden');
  el.results.innerHTML = skeletonRows();

  // results arrive after the skeleton is on screen; a slower earlier request
  // must not overwrite a newer one, and replacing innerHTML while the user is
  // already clicking a row swallows that click
  const seq = ++searchSeq;

  try {
    const r = await fetchWithRetry(`/api/search?q=${encodeURIComponent(q)}`);
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    if (seq !== searchSeq) return; // a newer search superseded this one

    state.results = data.results || [];
    if (!state.results.length) {
      el.results.classList.add('hidden');
      el.searchEmpty.classList.remove('hidden');
      return;
    }
    renderResults();
  } catch (e) {
    if (seq !== searchSeq) return;
    el.results.innerHTML = `<div class="empty"><div class="empty-text">Gagal memuat</div>
      <div class="grid-sub">${esc(e.message)}</div></div>`;
  }
}

function renderResults() {
  const items = state.results;
  // Swapping the rows while the pointer is already down on one cancels the
  // click (the element is gone before mouseup). If a press is in progress,
  // defer the swap until it resolves.
  if (resultsPressActive) {
    pendingRender = true;
    return;
  }
  const frag = document.createDocumentFragment();
  items.forEach((t, i) => {
    const row = makeRow(t, () => {
      state.queue = items.slice();
      state.source = 'Pencarian';
      playAt(i);
    });
    if (currentTrack()?.id === t.id) row.classList.add('is-active');
    frag.appendChild(row);
  });
  el.results.replaceChildren(frag);
}

// Track presses that begin inside the result list so a render landing mid-press
// cannot pull the row out from under the user's finger.
el.results.addEventListener(
  'pointerdown',
  () => {
    resultsPressActive = true;
  },
  true
);

const endPress = () => {
  if (!resultsPressActive) return;
  resultsPressActive = false;
  if (pendingRender) {
    pendingRender = false;
    // let the click that ends this press be dispatched first
    setTimeout(renderResults, 0);
  }
};
document.addEventListener('pointerup', endPress, true);
document.addEventListener('pointercancel', endPress, true);

// ---------------- playback ----------------
function currentTrack() {
  return state.queue[state.index] || null;
}

function playAt(i) {
  if (i < 0 || i >= state.queue.length) return;
  state.index = i;
  const t = state.queue[i];

  el.fpTitle.textContent = t.title;
  el.fpArtist.textContent = t.artist;
  el.fpArt.src = thumb(t.id);
  el.fpBg.style.backgroundImage = `url("${thumb(t.id)}")`;
  el.fpSource.textContent = state.source || 'Antrean';

  el.miniTitle.textContent = t.title;
  el.miniArtist.textContent = t.artist;
  el.miniArt.src = thumb(t.id);
  el.mini.classList.remove('hidden');
  el.dock.classList.add('fused');

  updateLikeUI();
  markPlaying(t.id);
  document.title = `${t.title} · RuelzMusify`;

  audio.src = `/api/stream/${encodeURIComponent(t.id)}`;
  buildEq();
  applyEq();
  audio.play().catch(() => {});
  pushRecent(t);

  if ('mediaSession' in navigator && window.MediaMetadata) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist,
      album: t.album || '',
      artwork: [{ src: thumb(t.id), sizes: '320x180', type: 'image/jpeg' }],
    });
    navigator.mediaSession.setActionHandler('play', () => audio.play());
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('previoustrack', prevTrack);
    navigator.mediaSession.setActionHandler('nexttrack', nextTrack);
  }
}

function markPlaying(id) {
  document.querySelectorAll('.row').forEach((r) => {
    r.classList.toggle('is-active', r.dataset.id === id);
  });
}

function pickNextIndex(step) {
  const n = state.queue.length;
  if (!n) return -1;
  if (state.repeat === 'one') return state.index;
  if (state.shuffle) {
    if (n === 1) return 0;
    let r;
    do { r = Math.floor(Math.random() * n); } while (r === state.index);
    return r;
  }
  const nextIdx = state.index + step;
  if (nextIdx >= n) return state.repeat === 'all' ? 0 : -1;
  if (nextIdx < 0) return state.repeat === 'all' ? n - 1 : 0;
  return nextIdx;
}

function nextTrack() {
  const i = pickNextIndex(1);
  if (i < 0) { audio.pause(); return; }
  playAt(i);
}

function prevTrack() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  const i = pickNextIndex(-1);
  if (i >= 0) playAt(i);
}

// ---------------- audio events ----------------
function setPlayingIcon(playing) {
  document.querySelectorAll('#toggle, #miniToggle').forEach((btn) => {
    btn.querySelector('.ic-play')?.classList.toggle('hidden', playing);
    btn.querySelector('.ic-pause')?.classList.toggle('hidden', !playing);
  });
}

audio.addEventListener('play', () => setPlayingIcon(true));
audio.addEventListener('pause', () => setPlayingIcon(false));

audio.addEventListener('ended', () => {
  if (state.repeat === 'one') {
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }
  nextTrack();
});

audio.addEventListener('loadedmetadata', () => {
  el.dur.textContent = fmt(audio.duration);
});

audio.addEventListener('error', () => {
  if (audio.src) el.miniArtist.textContent = 'stream error';
});

audio.addEventListener('timeupdate', () => {
  const d = audio.duration || 0;
  const c = audio.currentTime || 0;
  el.cur.textContent = fmt(c);
  const pct = d ? (c / d) * 100 : 0;
  el.miniProgress.style.width = pct + '%';
  if (!seeking) {
    el.fpFill.style.width = pct + '%';
    el.fpKnob.style.left = pct + '%';
  }
  if (lyricsSheet.classList.contains('open')) updateLyricsProgress();
});

// first highlight can only happen once the stream reports a duration
audio.addEventListener('loadedmetadata', () => {
  if (lyricsSheet.classList.contains('open')) updateLyricsProgress();
});

// ---------------- custom seek slider ----------------
let seeking = false;

function seekRatioFromEvent(e) {
  const rect = el.slider.getBoundingClientRect();
  const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  return Math.min(1, Math.max(0, x / rect.width));
}

function paintSeek(ratio) {
  const d = audio.duration || 0;
  el.fpFill.style.width = ratio * 100 + '%';
  el.fpKnob.style.left = ratio * 100 + '%';
  el.cur.textContent = fmt(ratio * d);
}

el.slider.addEventListener('pointerdown', (e) => {
  seeking = true;
  el.slider.classList.add('dragging');
  el.slider.setPointerCapture(e.pointerId);
  paintSeek(seekRatioFromEvent(e));
});

el.slider.addEventListener('pointermove', (e) => {
  if (!seeking) return;
  paintSeek(seekRatioFromEvent(e));
});

el.slider.addEventListener('pointerup', (e) => {
  if (!seeking) return;
  const ratio = seekRatioFromEvent(e);
  const d = audio.duration || 0;
  if (d) audio.currentTime = ratio * d;
  seeking = false;
  el.slider.classList.remove('dragging');
});

el.slider.addEventListener('pointercancel', () => {
  seeking = false;
  el.slider.classList.remove('dragging');
});

// ---------------- controls ----------------
const togglePlay = () => (audio.paused ? audio.play().catch(() => {}) : audio.pause());

el.toggle.addEventListener('click', togglePlay);
el.miniToggle.addEventListener('click', togglePlay);
el.next.addEventListener('click', nextTrack);
el.miniNext.addEventListener('click', nextTrack);
el.prev.addEventListener('click', prevTrack);

el.vol.addEventListener('input', () => (audio.volume = Number(el.vol.value)));
audio.volume = Number(el.vol.value);

el.shuffleBtn.addEventListener('click', () => {
  state.shuffle = !state.shuffle;
  el.shuffleBtn.classList.toggle('on', state.shuffle);
});

el.repeatBtn.addEventListener('click', () => {
  const order = ['off', 'all', 'one'];
  state.repeat = order[(order.indexOf(state.repeat) + 1) % 3];
  el.repeatBtn.classList.toggle('on', state.repeat !== 'off');
  el.repeatBtn.title =
    state.repeat === 'one' ? 'Ulangi satu lagu' : state.repeat === 'all' ? 'Ulangi semua' : 'Ulang mati';
});

// ---------------- mini -> full player ----------------
const openFull = () => {
  if (!currentTrack()) return;
  el.full.classList.add('open');
  document.body.style.overflow = 'hidden';
};

const closeFull = () => {
  el.full.classList.remove('open');
  document.body.style.overflow = '';
};

el.miniMeta.addEventListener('click', openFull);
el.miniArt.addEventListener('click', openFull);
el.fpClose.addEventListener('click', closeFull);

  const b = document.createElement('button');

// ---------------- likes ----------------
function updateLikeUI() {
  const t = currentTrack();
  const liked = !!(t && state.liked.has(t.id));
  el.fpLike.classList.toggle('on', liked);
  el.fpLike.querySelector('svg').setAttribute('fill', liked ? 'currentColor' : 'none');
  el.miniLike.classList.toggle('liked', liked);
}

function toggleLike() {
  const t = currentTrack();
  if (!t) return;
  if (state.liked.has(t.id)) {
    state.liked.delete(t.id);
    delete state.likedTracks[t.id];
  } else {
    state.liked.add(t.id);
    state.likedTracks[t.id] = t;
  }
  saveJSON('rq_liked', [...state.liked]);
  saveJSON('rq_liked_tracks', state.likedTracks);
  updateLikeUI();
  renderHome();
  if (state.view === 'library') renderLibrary();
}

el.fpLike.addEventListener('click', toggleLike);
el.miniLike.addEventListener('click', toggleLike);

// ---------------- library ----------------
function libraryData() {
  if (state.libTab === 'liked') return Object.values(state.likedTracks);
  if (state.libTab === 'recent') return state.recent;
  return state.queue;
}

function renderLibrary() {
  const list = libraryData();
  el.library.innerHTML = '';

  if (!list.length) {
    el.libraryEmpty.classList.remove('hidden');
    return;
  }
  el.libraryEmpty.classList.add('hidden');

  list.forEach((t, i) => {
    const row = makeRow(t, () => {
      state.queue = list.slice();
      state.source = state.libTab === 'liked' ? 'Disukai' : state.libTab === 'recent' ? 'Terakhir diputar' : 'Antrean';
      playAt(i);
    });
    if (currentTrack()?.id === t.id) row.classList.add('is-active');
    el.library.appendChild(row);
  });
}

$('lib-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  state.libTab = chip.dataset.lib;
  $('lib-chips').querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
  renderLibrary();
});

// ---------------- recent ----------------
function pushRecent(t) {
  state.recent = [t, ...state.recent.filter((x) => x.id !== t.id)].slice(0, 24);
  saveJSON('rq_recent', state.recent);
  renderHome();
  if (state.view === 'library' && state.libTab === 'recent') renderLibrary();
}

// ---------------- home ----------------
const HOME_FILTERS = [
  { id: 'all', label: 'Semua' },
  { id: 'recent', label: 'Terakhir diputar' },
  { id: 'liked', label: 'Disukai' },
];

state.homeFilter = 'all';

function renderChips() {
  el.chips.innerHTML = '';
  HOME_FILTERS.forEach((f) => {
    const b = document.createElement('button');
    b.className = 'chip' + (state.homeFilter === f.id ? ' active' : '');
    b.type = 'button';
    b.textContent = f.label;
    b.addEventListener('click', () => {
      state.homeFilter = f.id;
      renderHome();
    });
    el.chips.appendChild(b);
  });
}

function renderQuickPicks() {
  const src =
    state.homeFilter === 'liked'
      ? Object.values(state.likedTracks)
      : state.homeFilter === 'recent'
      ? state.recent
      : state.recent.length
      ? state.recent
      : Object.values(state.likedTracks);

  const picks = src.slice(0, 10);
  el.homeQP.innerHTML = '';

  if (!picks.length) return;

  const head = document.createElement('div');
  head.className = 'section-head';
  head.innerHTML = `<h2 class="section-title">Quick picks</h2>`;
  el.homeQP.appendChild(head);

  const strip = document.createElement('div');
  strip.className = 'quickpicks';

  picks.forEach((t, i) => {
    const card = document.createElement('button');
    card.className = 'qp-card' + (currentTrack()?.id === t.id ? ' is-active' : '');
    card.type = 'button';
    card.innerHTML = `
      <img class="qp-art" src="${thumb(t.id)}" alt="" loading="lazy" decoding="async"
           onerror="this.style.visibility='hidden'" />
      <div class="qp-scrim"></div>
      <span class="qp-play">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13L19 12z"/></svg>
      </span>
      <div class="qp-meta">
        <div class="qp-title">${esc(t.title)}</div>
        <div class="qp-artist">${esc(t.artist)}</div>
      </div>`;
    card.addEventListener('click', () => {
      state.queue = picks.slice();
      state.source = 'Quick picks';
      playAt(i);
    });
    strip.appendChild(card);
  });

  el.homeQP.appendChild(strip);
}

// ---------------- view switching ----------------
const VIEWS = ['home', 'search', 'library'];

function switchView(v) {
  if (!VIEWS.includes(v)) v = 'home';
  state.view = v;

  VIEWS.forEach((name) => {
    $(`view-${name}`).classList.toggle('hidden', name !== v);
  });

  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === v);
  });

  if (v === 'library') renderLibrary();
  if (v === 'home') renderHome();

  el.scroller.scrollTop = 0;
  if (v === 'search') setTimeout(() => el.q.focus(), 60);
}

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

document.querySelectorAll('[data-goto]').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.goto));
});

$('btnQueueTop').addEventListener('click', () => {
  state.libTab = 'queue';
  $('lib-chips').querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.lib === 'queue'));
  switchView('library');
});

$('fpQueueBtn').addEventListener('click', () => {
  closeFull();
  state.libTab = 'queue';
  $('lib-chips').querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.lib === 'queue'));
  switchView('library');
});

$('queueBottom').addEventListener('click', () => {
  closeFull();
  state.libTab = 'queue';
  $('lib-chips').querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.lib === 'queue'));
  switchView('library');
});

$('volBtn').addEventListener('click', () => {
  audio.muted = !audio.muted;
  $('volBtn').classList.toggle('on', audio.muted);
});

// ---------------- keyboard ----------------
document.addEventListener('keydown', (e) => {
  const typing = e.target === el.q || e.target.tagName === 'INPUT';

  if (e.code === 'Escape') {
    if (lyricsSheet.classList.contains('open')) closeSheet('lyrics');
    else if ($('eqSheet').classList.contains('open')) closeSheet('eq');
    else if (el.full.classList.contains('open')) closeFull();
    else if (typing) el.q.blur();
    return;
  }

  if (typing) return;

  if (e.code === 'Space') {
    e.preventDefault();
    togglePlay();
  }
  if (e.code === 'ArrowRight' && e.shiftKey) nextTrack();
  if (e.code === 'ArrowLeft' && e.shiftKey) prevTrack();
  if (e.code === 'KeyL') toggleLike();
  if (e.code === 'Slash') {
    e.preventDefault();
    switchView('search');
  }
});

// swipe down on the full player closes it (mobile)
let fpTouchStartY = null;
el.full.addEventListener('touchstart', (e) => {
  fpTouchStartY = e.touches[0].clientY;
}, { passive: true });

el.full.addEventListener('touchend', (e) => {
  if (fpTouchStartY == null) return;
  const dy = e.changedTouches[0].clientY - fpTouchStartY;
  if (dy > 120) closeFull();
  fpTouchStartY = null;
}, { passive: true });

function renderHome() {
  renderChips();
  renderQuickPicks();

  const recent = state.recent;
  const liked = Object.values(state.likedTracks);

  el.homeRecentWrap.classList.toggle('hidden', !recent.length);
  el.homeRecent.innerHTML = '';
  recent.slice(0, 12).forEach((t, i) => {
    el.homeRecent.appendChild(
      makeGridItem(t, () => {
        state.queue = recent.slice();
        state.source = 'Keep listening';
        playAt(i);
      })
    );
  });

  el.homeLikedWrap.classList.toggle('hidden', !liked.length);
  el.homeLiked.innerHTML = '';
  liked.slice(0, 12).forEach((t, i) => {
    el.homeLiked.appendChild(
      makeGridItem(t, () => {
        state.queue = liked.slice();
        state.source = 'Disukai';
        playAt(i);
      })
    );
  });

  el.homeIdle.classList.toggle(
    'hidden',
    !!(recent.length || liked.length || el.homeSeed.childElementCount || seedPending)
  );
  if (state.view === 'home') markPlaying(currentTrack()?.id);
}
// ---------------- lyrics ----------------
const lyricsSheet = $('lyricsSheet');
const lyricsBody = $('lyricsBody');
const lyricsFoot = $('lyricsFoot');
let lyricsFor = null;

function openSheet(which) {
  const s = which === 'lyrics' ? lyricsSheet : $('eqSheet');
  s.classList.add('open');
  s.setAttribute('aria-hidden', 'false');
}

function closeSheet(which) {
  const s = which === 'lyrics' ? lyricsSheet : $('eqSheet');
  s.classList.remove('open');
  s.setAttribute('aria-hidden', 'true');
}

document.querySelectorAll('[data-close]').forEach((b) => {
  b.addEventListener('click', () => closeSheet(b.dataset.close));
});

// Lyrics come from lyrics.ovh — free, no key, CORS-enabled. We only have
// title/artist text, so scrub the usual YouTube noise first or the query
// misses ("Speechless (Full) (From "Aladdin")" -> "Speechless").
function cleanForLyrics(t) {
  const title = (t.title || '')
    .replace(/\((?:feat|ft|with)[^)]*\)/gi, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:from|from the)[^)]*\)/gi, ' ')
    .replace(
      /\b(?:official|video|lyrics?|audio|remaster(?:ed)?|soundtrack|ost|karaoke|instrumental|cover|hd|hq|4k)\b.*$/gi,
      ' '
    )
    .replace(/[()]/g, ' ')
    .replace(/\s+-\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const artist = (t.artist || '')
    .split(',')[0]
    .replace(/\s*(?:- topic|topic|vevo)\s*$/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { title: title || t.title || '', artist };
}

async function loadLyrics() {
  const t = currentTrack();
  if (!t) return;
  if (lyricsFor === t.id) return;

  lyricsBody.innerHTML = '<div class="lyrics-loading"><span class="spinner"></span></div>';
  lyricsFoot.textContent = 'Sumber: lyrics.ovh';

  const { title, artist } = cleanForLyrics(t);

  try {
    const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('not found');
    const data = await r.json();
    const text = (data.lyrics || '').replace(/\r/g, '').trim();
    if (!text) throw new Error('empty');

    lyricsFor = t.id;
    lyricsBody.innerHTML = '';
    delete lyricsBody.dataset.idx;
    lyricsBody.scrollTop = 0;
    let bar = 0;
    text.split('\n').forEach((line) => {
      // blank lines become section dividers, not dead space
      if (!line.trim()) {
        bar = 0;
        const gap = document.createElement('div');
        gap.className = 'lyrics-gap';
        lyricsBody.appendChild(gap);
        return;
      }
      const d = document.createElement('div');
      d.className = 'lyrics-line';
      d.dataset.bar = String(bar++);
      // lyrics.ovh sometimes carries double spaces; collapse them so the
      // text does not jump around when a line becomes active
      d.textContent = line.trim().replace(/\s{2,}/g, ' ');
      lyricsBody.appendChild(d);
    });
    // progress should only count real lyric lines, not the gaps
    updateLyricsProgress();
  } catch {
    lyricsFor = null;
    lyricsBody.innerHTML = `<div class="lyrics-empty">
      Lirik untuk lagu ini belum tersedia.
      <div style="opacity:.7;font-size:12px;margin-top:6px">${esc(title)} — ${esc(artist)}</div>
    </div>`;
    lyricsFoot.textContent = 'Tidak ditemukan di lyrics.ovh';
  }
}

// rough sync: spread lines across the track. Without timestamps this is a
// guess, but it reads far better than a static block of text. The first line
// is held for a short lead-in instead of lighting up at 0:00, and the last
// line stays on screen once the outro starts rather than being skipped.
const LYRIC_LEAD_IN = 4; // seconds of intro before the first line is "current"

function updateLyricsProgress() {
  const lines = lyricsBody.querySelectorAll('.lyrics-line');
  if (!lines.length) return;
  const d = audio.duration;
  if (!d || !isFinite(d)) return;

  const span = Math.max(1, d - LYRIC_LEAD_IN);
  const p = Math.min(1, Math.max(0, (audio.currentTime - LYRIC_LEAD_IN) / span));
  const idx = Math.min(lines.length - 1, Math.floor(p * lines.length));

  // only touch the DOM when the line actually changes — this runs on every
  // timeupdate (~4x/s) and toggling classes on 52 nodes each time is waste
  if (lyricsBody.dataset.idx !== String(idx)) {
    lines.forEach((ln, i) => {
      ln.classList.toggle('current', i === idx);
      ln.classList.toggle('sung', i < idx);
    });
    lyricsBody.dataset.idx = String(idx);
    scrollLyricsTo(lines[idx]);
  }
}

// centre the active line. getBoundingClientRect is used instead of offsetTop
// because a line's offsetParent is .sheet-panel, not .lyrics-body — the old
// maths was relative to the wrong box, so the line never landed mid-pane.
function scrollLyricsTo(cur) {
  if (!cur || !lyricsSheet.classList.contains('open')) return;
  const bodyBox = lyricsBody.getBoundingClientRect();
  const lineBox = cur.getBoundingClientRect();
  const delta = lineBox.top - bodyBox.top - bodyBox.height / 2 + lineBox.height / 2;
  lyricsBody.scrollTo({ top: Math.max(0, lyricsBody.scrollTop + delta), behavior: 'smooth' });
}

$('lyricsBtn').addEventListener('click', () => {
  openSheet('lyrics');
  loadLyrics();
});

// ---------------- equalizer ----------------
const EQ_KEY = 'rq_eq';
const EQ_BANDS = [60, 170, 350, 1000, 3500, 8000, 14000];
const EQ_PRESETS = {
  Datar: [0, 0, 0, 0, 0, 0, 0],
  Pop: [-1, 0, 2, 4, 3, 0, -1],
  Rock: [4, 2, -1, -1, 2, 4, 5],
  Jazz: [3, 1, 1, 2, 1, 1, 3],
  Bass: [8, 6, 3, 0, 0, 0, 0],
  Vokal: [-2, -1, 2, 5, 5, 2, -1],
};

const eq = { gains: [...EQ_PRESETS.Datar], bass: 0, volume: 0.85, ctx: null, nodes: [], bassNode: null, gainNode: null };

try {
  const raw = JSON.parse(localStorage.getItem(EQ_KEY) || 'null');
  if (raw && Array.isArray(raw.gains) && raw.gains.length === EQ_BANDS.length) {
    eq.gains = raw.gains;
    eq.bass = raw.bass || 0;
    eq.volume = typeof raw.volume === 'number' ? raw.volume : 0.85;
  }
} catch {}

// The <audio> element exists before any gesture, so the graph can't be built
// until playback starts. buildEq() is idempotent.
function buildEq() {
  if (eq.ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    eq.ctx = new AC();
    let node = eq.ctx.createMediaElementSource(audio);
    eq.nodes = EQ_BANDS.map((freq, i) => {
      const f = eq.ctx.createBiquadFilter();
      f.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
      f.frequency.value = freq;
      f.Q.value = 1.1;
      f.gain.value = eq.gains[i];
      node.connect(f);
      node = f;
      return f;
    });
    eq.bassNode = eq.ctx.createBiquadFilter();
    eq.bassNode.type = 'lowshelf';
    eq.bassNode.frequency.value = 90;
    eq.bassNode.gain.value = eq.bass;
    node.connect(eq.bassNode);
    eq.gainNode = eq.ctx.createGain();
    eq.gainNode.gain.value = eq.volume;
    eq.bassNode.connect(eq.gainNode);
    eq.gainNode.connect(eq.ctx.destination);
  } catch {
    eq.ctx = null;
  }
}

function applyEq() {
  if (eq.ctx && eq.ctx.state === 'suspended') eq.ctx.resume().catch(() => {});
  eq.nodes.forEach((f, i) => (f.gain.value = eq.gains[i]));
  if (eq.bassNode) eq.bassNode.gain.value = eq.bass;
  if (eq.gainNode) eq.gainNode.gain.value = eq.volume;
  audio.volume = eq.ctx ? 1 : eq.volume;
  saveJSON(EQ_KEY, { gains: eq.gains, bass: eq.bass, volume: eq.volume });
}

const eqBandsEl = $('eqBands');
const eqPresetsEl = $('eqPresets');
const eqSliders = [];

function buildEqUI() {
  eqBandsEl.innerHTML = '';
  EQ_BANDS.forEach((freq, i) => {
    const col = document.createElement('div');
    col.className = 'eq-band';

    const gain = document.createElement('div');
    gain.className = 'eq-band-gain';
    gain.textContent = `${eq.gains[i] > 0 ? '+' : ''}${eq.gains[i]}`;

    const input = document.createElement('input');
    input.type = 'range';
    input.min = -12;
    input.max = 12;
    input.step = 1;
    input.value = eq.gains[i];
    input.setAttribute('aria-label', `${freq} Hz`);
    input.addEventListener('input', () => {
      eq.gains[i] = Number(input.value);
      gain.textContent = `${eq.gains[i] > 0 ? '+' : ''}${eq.gains[i]}`;
      applyEq();
    });

    const label = document.createElement('div');
    label.className = 'eq-band-label';
    label.textContent = freq >= 1000 ? `${freq / 1000}k` : String(freq);

    col.append(gain, input, label);
    eqBandsEl.appendChild(col);
    eqSliders[i] = { input, gain };
  });

  eqPresetsEl.innerHTML = '';
  Object.keys(EQ_PRESETS).forEach((name) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = name;
    b.addEventListener('click', () => {
      eq.gains = [...EQ_PRESETS[name]];
      syncEqUI();
      applyEq();
      eqPresetsEl.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === b));
    });
    eqPresetsEl.appendChild(b);
  });
  eqPresetsEl.firstChild?.classList.add('active');
}

function syncEqUI() {
  eqSliders.forEach(({ input, gain }, i) => {
    if (!input) return;
    input.value = eq.gains[i];
    gain.textContent = `${eq.gains[i] > 0 ? '+' : ''}${eq.gains[i]}`;
  });
  $('eqBass').value = eq.bass;
  $('eqVolume').value = eq.volume;
}

buildEqUI();
syncEqUI();

$('eqBass').addEventListener('input', (e) => {
  eq.bass = Number(e.target.value);
  applyEq();
});

$('eqVolume').addEventListener('input', (e) => {
  eq.volume = Number(e.target.value);
  applyEq();
});

$('eqReset').addEventListener('click', () => {
  eq.gains = [...EQ_PRESETS.Datar];
  eq.bass = 0;
  eq.volume = 0.85;
  syncEqUI();
  applyEq();
  eqPresetsEl.querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('active', i === 0));
});

$('eqBtn').addEventListener('click', () => {
  openSheet('eq');
  // build the audio graph off the animation frame — constructing an
  // AudioContext on the click blocks the sheet from painting in
  requestAnimationFrame(() => {
    buildEq();
    applyEq();
  });
});


renderHome();
switchView('home');
loadSeedFeed();

// Dark-first, like the Android app. The user can still choose "auto".
const THEME_KEY = 'rq_theme'; // 'dark' | 'light' | 'auto'
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const pref = localStorage.getItem(THEME_KEY) || 'dark';
  const dark = pref === 'auto' ? prefersDark.matches : pref === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#1a1113' : '#fff8f7';
}

applyTheme();
prefersDark.addEventListener('change', () => {
  if ((localStorage.getItem(THEME_KEY) || 'dark') === 'auto') applyTheme();
});

