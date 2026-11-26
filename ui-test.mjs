import { chromium } from 'playwright';

const BASE = 'http://localhost:7788/';
const errs = [];
const browser = await chromium.launch();

async function newPage(viewport, tag) {
  const page = await browser.newPage({ viewport });
  page.on('console', (m) => m.type() === 'error' && errs.push(`${tag}: ${m.text()}`));
  page.on('pageerror', (e) => errs.push(`${tag}-pageerror: ${e.message}`));
  return page;
}

const shot = async (page, name) => {
  await page.screenshot({ path: `ui-${name}.png` });
  console.log('  captured', name);
};

// glass panels are transparent, so a light theme can easily produce
// light-on-light text. Check the key labels actually contrast.
async function assertTheme(page, expected, tag) {
  const r = await page.evaluate(() => {
    const lum = (c) => {
      const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    const title = document.querySelector('.section-title');
    const chip = document.querySelector('.chip.active');
    const nav = document.querySelector('.nav-label');
    // gradients can't be read as a colour, so pull the first rgb() stop out
    // of background-image and use that as the surface under the label
    let chipRatio = 0;
    if (chip) {
      const ccs = getComputedStyle(chip);
      const stops = (ccs.backgroundImage.match(/rgba?\([^)]+\)/g) || []);
      const solid = stops.find((s) => {
        const parts = s.match(/[\d.]+/g);
        return !parts || parts.length < 4 || Number(parts[3]) > 0.55;
      });
      const surface = solid || ccs.backgroundColor;
      chipRatio = ratio(ccs.color, surface);
    }
    return {
      theme: document.documentElement.dataset.theme,
      bodyBg,
      titleVsBg: title ? ratio(getComputedStyle(title).color, bodyBg) : 0,
      chipRatio,
      navRatio: nav ? ratio(getComputedStyle(nav).color, bodyBg) : 0,
    };
  });
  if (r.theme !== expected) errs.push(`${tag}: theme is ${r.theme}, expected ${expected}`);
  for (const [k, v] of Object.entries(r)) {
    if (k.endsWith('Ratio') && v < 2.5) errs.push(`${tag}: poor contrast ${k}=${v.toFixed(2)}`);
  }
  console.log(
    `  theme=${r.theme} title=${r.titleVsBg.toFixed(1)}:1 chip=${r.chipRatio.toFixed(1)}:1 nav=${r.navRatio.toFixed(1)}:1`
  );
}


// a sheet is only really open if it's on-screen and painted above the page.
// The slide-up runs on the main thread, so poll instead of guessing a delay.
async function assertSheetOpen(page, id, tag) {
  let box = null;
  for (let i = 0; i < 40; i++) {
    box = await page.locator(id + ' .sheet-panel').boundingBox();
    if (box && box.y + box.height <= (page.viewportSize()?.height ?? 900) + 2 && box.y >= 0) break;
    await page.waitForTimeout(100);
  }
  const vh = page.viewportSize()?.height ?? 900;
  if (!box || box.y < 0 || box.y + box.height > vh + 2) {
    errs.push(`${tag}: ${id} panel never settled on screen (y=${box ? Math.round(box.y) : 'null'})`);
    return;
  }
  // geometry alone isn't enough â€” the sheet must actually paint on top
  const onTop = await page.evaluate((sel) => {
    const panel = document.querySelector(sel + ' .sheet-panel');
    const r = panel.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + 20);
    return !!el && panel.contains(el);
  }, id);
  if (!onTop) errs.push(`${tag}: ${id} is on screen but painted behind something`);
  console.log(`  ${id} panel y=${Math.round(box.y)} h=${Math.round(box.height)} onTop=${onTop}`);
}

async function run(tag, viewport) {
  console.log(`\n=== ${tag} (${viewport.width}x${viewport.height}) ===`);
  const page = await newPage(viewport, tag);
  await page.goto(BASE, { waitUntil: 'networkidle' });

  // seed some library state so Home has content
  await page.evaluate(() => {
    const mk = (i) => ({
      id: 'dQw4w9WgXcQ',
      title: ['Naomi Scott - Speechless', 'Sheila On 7 - Dan', 'Tulus - Hati-Hati di Jalan', 'Pamungkas - To the Bone'][i % 4],
      artist: ['Naomi Scott', 'Sheila On 7', 'Tulus', 'Pamungkas'][i % 4],
      duration: 200 + i,
    });
    const recent = [0, 1, 2, 3].map(mk);
    localStorage.setItem('rq_recent', JSON.stringify(recent));
    localStorage.setItem('rq_liked_tracks', JSON.stringify({ dQw4w9WgXcQ: recent[0] }));
    localStorage.setItem('rq_liked', JSON.stringify(['dQw4w9WgXcQ']));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await assertTheme(page, 'dark', tag);
  await shot(page, `${tag}-home`);

  // nav -> Search
  await page.click('.nav-item[data-view="search"]');
  await page.waitForTimeout(300);
  await page.fill('#q', 'naomi scott');
  await page.waitForSelector('#results .row:not(.row-skeleton)', { timeout: 30000 });
  await page.waitForTimeout(900);
  await shot(page, `${tag}-search`);

  // play first result
  await page.click('#results .row:first-child');
  await page.waitForTimeout(2500);
  await shot(page, `${tag}-mini`);

  // open full player (click the artwork â€” the meta div is a nested inline target)
  await page.click('#miniArt');
  await page.waitForTimeout(900);
  await shot(page, `${tag}-full`);

  // lyrics sheet
  await page.click('#lyricsBtn');
  await page.waitForFunction(
    () => document.querySelectorAll('#lyricsBody .lyrics-line').length > 0,
    null,
    { timeout: 30000 }
  );
  await page.waitForTimeout(600);
  await assertSheetOpen(page, '#lyricsSheet', tag);
  await shot(page, `${tag}-lyrics`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // equalizer sheet
  await page.click('#eqBtn');
  await page.waitForSelector('#eqSheet.open', { timeout: 5000 });
  await page.waitForTimeout(1100);
  await assertSheetOpen(page, '#eqSheet', tag);
  await shot(page, `${tag}-eq`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // library
  await page.click('#fpClose');
  await page.waitForTimeout(400);
  await page.click('.nav-item[data-view="library"]');
  await page.waitForTimeout(400);
  await shot(page, `${tag}-library`);

  await page.close();
}

await run('desktop', { width: 1440, height: 900 });
await run('mobile', { width: 390, height: 844 });
await run('tablet', { width: 834, height: 1112 });

// cold start: no localStorage at all â€” Home must still self-populate
console.log('\n=== cold start (no history) ===');
{
  const page = await newPage({ width: 390, height: 844 }, 'cold');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#home-seed .qp-card:not(.qp-sk)', { timeout: 40000 });
  await page.waitForTimeout(1200);
  const counts = await page.evaluate(() => ({
    shelves: document.querySelectorAll('#home-seed .seed-shelf').length,
    cards: document.querySelectorAll('#home-seed .qp-card:not(.qp-sk)').length,
    idleHidden: document.getElementById('home-idle').classList.contains('hidden'),
  }));
  console.log('  shelves:', counts.shelves, '| cards:', counts.cards, '| idle hidden:', counts.idleHidden);
  if (!counts.cards) errs.push('cold: home seed did not populate');
  await shot(page, 'cold-home');
  await page.close();
}

// light theme + reduced motion sanity check
console.log('\n=== light theme ===');
{
  const page = await newPage({ width: 1280, height: 860 }, 'light');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('rq_theme', 'light');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await assertTheme(page, 'light', 'light');
  await shot(page, 'light-home');

  // search + full player in light mode
  await page.click('.nav-item[data-view="search"]');
  await page.fill('#q', 'tulus');
  // results render after a skeleton pass, so wait for a real row
  await page.waitForSelector('#results .row:not(.row-skeleton)', { state: 'visible', timeout: 30000 });
  await page.click('#results .row:first-child');
  await page.waitForTimeout(1800);
  await page.click('#miniArt');
  await page.waitForTimeout(900);
  await shot(page, 'light-full');

  // the full player flips to dark glyphs in light mode â€” verify it happened
  const fp = await page.evaluate(() => {
    const btn = document.getElementById('eqBtn');
    const cs = getComputedStyle(btn);
    const m = cs.color.match(/[\d.]+/g).map(Number);
    const lum = (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
    return { color: cs.color, dark: lum < 0.5, contentColor: getComputedStyle(btn.closest('.fp-content')).color };
  });
  if (!fp.dark) errs.push(`light: full player glyphs too light (${fp.color})`);
  console.log(`  fp glyph ${fp.color} (content ${fp.contentColor})`);
  await page.close();
}

await browser.close();

console.log('\n--- console errors ---');
if (!errs.length) console.log('  none âœ“');
else errs.forEach((e) => console.log('  âœ—', e));

process.exit(errs.length ? 1 : 0);
