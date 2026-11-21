#!/usr/bin/env node
/* STKEYCLUB Photo Booth – automated checks (Playwright + Chromium).
 *
 *   node tests/run.js            run everything
 *   node tests/run.js detect     run tests whose name contains "detect"
 *
 * Uses Chromium's fake camera (--use-fake-device-for-media-stream) and, for
 * exact pixel checks, a synthetic camera made from a canvas.
 * Screenshots and PDFs are written to test-output/.
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'test-output');
fs.mkdirSync(OUT, { recursive: true });

// Measured on frame.png (591x1748).
const FRAME = { w: 591, h: 1748 };
const SHEET = { w: FRAME.w * 2, h: FRAME.w * 3 }; // 2:3, exactly a 4x6 in page
const EXPECTED_HOLES = [
  { x: 28, y: 81, w: 535, h: 360 },
  { x: 28, y: 458, w: 535, h: 359 },
  { x: 27, y: 832, w: 535, h: 359 },
  { x: 27, y: 1205, w: 535, h: 359 },
];

const FAST = { countdown: 1, pause: 0.5, sound: false };

/* ---------------- static server ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function startServer(port = 0, overrides = {}) {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(overrides[p] ? overrides[p](data) : data);
    });
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address();
      resolve({
        url: `http://localhost:${actual}/`,
        port: actual,
        close: () =>
          new Promise((r) => {
            for (const s of sockets) s.destroy();
            server.close(() => r());
          }),
      });
    });
  });
}

/* ---------------- helpers ---------------- */

let browser;
let server;

async function newContext(opts = {}) {
  return browser.newContext({
    viewport: opts.viewport || { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    acceptDownloads: true,
    serviceWorkers: opts.serviceWorkers || 'block',
    ...opts.contextOptions,
  });
}

// Open the booth with optional settings and init scripts (run before the app).
async function openApp(ctx, { settings = FAST, init = [], waitFor = 'booth', url } = {}) {
  await ctx.addInitScript((s) => {
    if (s && !localStorage.getItem('stkeyclub.settings.v1')) {
      localStorage.setItem('stkeyclub.settings.v1', JSON.stringify(s));
    }
  }, settings);
  for (const fn of init) await ctx.addInitScript(fn);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') page.errors.push(m.text());
  });
  await page.goto(url || server.url);
  if (waitFor) await waitForScreen(page, waitFor);
  return page;
}

async function waitForScreen(page, name, timeout = 20000) {
  await page.waitForFunction((n) => window.PB && window.PB.state.screen === n, name, { timeout });
}

// Synthetic camera: left half red, right half blue, green square in the middle.
function syntheticCamera() {
  const make = () => {
    const c = document.createElement('canvas');
    c.width = 1920;
    c.height = 1080;
    const x = c.getContext('2d');
    let n = 0;
    const draw = () => {
      x.fillStyle = '#ff0000';
      x.fillRect(0, 0, 960, 1080);
      x.fillStyle = '#0000ff';
      x.fillRect(960, 0, 960, 1080);
      x.fillStyle = '#00ff00';
      x.fillRect(900, 480, 120, 120);
      x.fillStyle = n++ % 2 ? '#ff0001' : '#ff0000'; // keep frames flowing
      x.fillRect(0, 0, 2, 2);
    };
    draw();
    setInterval(draw, 33);
    return c.captureStream(30);
  };
  navigator.mediaDevices.getUserMedia = async () => make();
}

async function runSession(page) {
  await page.keyboard.press('Space');
  await waitForScreen(page, 'review', 30000);
}

function pngSize(buf) {
  assert.equal(buf.slice(1, 4).toString(), 'PNG', 'not a PNG file');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name + '.png') });
}

/* ---------------- tests ---------------- */

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('detect: hole detection finds the 4 measured holes', async () => {
  const ctx = await newContext();
  const page = await openApp(ctx);
  const f = await page.evaluate(() => ({
    holes: PB.state.frame.holes,
    source: PB.state.frame.holeSource,
    w: PB.state.frame.width,
    h: PB.state.frame.height,
  }));
  assert.equal(f.source, 'detected', 'holes should come from detection, not the config fallback');
  assert.equal(f.w, FRAME.w);
  assert.equal(f.h, FRAME.h);
  assert.equal(f.holes.length, 4);
  f.holes.forEach((h, i) => {
    const e = EXPECTED_HOLES[i];
    for (const k of ['x', 'y', 'w', 'h']) {
      assert.ok(Math.abs(h[k] - e[k]) <= 2, `hole ${i + 1} ${k}: got ${h[k]}, expected ${e[k]}`);
    }
  });
  console.log('      holes:', f.holes.map((h) => `${h.x}-${h.x + h.w - 1},${h.y}-${h.y + h.h - 1}`).join('  '));
  await ctx.close();
});

test('detect: works at another resolution and falls back to config', async () => {
  const ctx = await newContext();
  const page = await openApp(ctx);
  const r = await page.evaluate(async ({ w, h }) => {
    const { detectHoles, fallbackHoles } = await import('./js/frame.js');
    const img = PB.state.frame.image;
    const big = document.createElement('canvas');
    big.width = w * 2;
    big.height = h * 2;
    big.getContext('2d').drawImage(img, 0, 0, w * 2, h * 2);
    const opaque = document.createElement('canvas');
    opaque.width = w;
    opaque.height = h;
    opaque.getContext('2d').fillRect(0, 0, w, h);
    return {
      big: detectHoles(big).holes,
      none: detectHoles(opaque).found,
      fb: fallbackHoles(w * 2, h * 2),
    };
  }, FRAME);
  r.big.forEach((h, i) => {
    const e = EXPECTED_HOLES[i];
    for (const k of ['x', 'y', 'w', 'h']) {
      assert.ok(Math.abs(h[k] - e[k] * 2) <= 4, `2x hole ${i + 1} ${k}: got ${h[k]}, expected ~${e[k] * 2}`);
    }
  });
  assert.equal(r.none, 0, 'an opaque frame has no holes');
  assert.deepEqual(r.fb[0], { x: 56, y: 162, w: 1070, h: 720, area: 0 });
  await ctx.close();
});

test('flow: 4 shots with the fake camera, strip is the size of frame.png', async () => {
  const ctx = await newContext();
  const page = await openApp(ctx);
  await page.waitForFunction(() => PB.camera.ready);
  await shot(page, '01-start');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => PB.state.phase === 'countdown');
  await page.waitForTimeout(300);
  await shot(page, '02-countdown');
  await page.waitForFunction(() => PB.state.photos.filter(Boolean).length >= 3 && PB.state.phase === 'countdown', null, { timeout: 20000 });
  await page.waitForTimeout(300);
  await shot(page, '03-countdown-shot4');
  await waitForScreen(page, 'review', 30000);
  await page.waitForTimeout(300);
  await shot(page, '04-review');
  const r = await page.evaluate(() => ({
    strip: [document.querySelector('#strip').width, document.querySelector('#strip').height],
    photos: PB.state.photos.map((p) => [p.width, p.height]),
    boxes: PB.state.frame.photoBoxes,
    cam: PB.camera.info(),
  }));
  assert.deepEqual(r.strip, [FRAME.w, FRAME.h]);
  assert.equal(r.photos.length, 4);
  assert.deepEqual(r.cam.width, 1920);
  // Full native resolution: the whole 1080 px height, centre-cropped to each hole's aspect.
  r.photos.forEach(([w, h], i) => {
    const b = r.boxes[i];
    assert.equal(h, 1080, 'photo keeps the full camera height');
    assert.ok(Math.abs(w - Math.round((1080 * b.w) / b.h)) <= 1, `photo ${i + 1} width ${w}`);
  });
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('flash: the mirror does not flash again when the start screen comes back', async () => {
  const ctx = await newContext();
  const page = await openApp(ctx, { settings: { ...FAST, flash: true } });
  await runSession(page);
  await page.click('#restart-btn');
  await waitForScreen(page, 'booth');
  await page.waitForTimeout(60);
  const r = await page.evaluate(() => {
    const f = document.querySelector('#vf-flash');
    return { armed: f.classList.contains('go'), opacity: Number(getComputedStyle(f).opacity) };
  });
  assert.deepEqual(r, { armed: false, opacity: 0 });
  await ctx.close();
});

test('composite: holes hold photo pixels, frame (logo) is drawn on top', async () => {
  const ctx = await newContext();
  const page = await openApp(ctx, { init: [syntheticCamera] });
  await runSession(page);
  const r = await page.evaluate(() => {
    const f = PB.state.frame;
    const strip = document.querySelector('#strip');
    const sd = strip.getContext('2d').getImageData(0, 0, strip.width, strip.height).data;
    const fc = document.createElement('canvas');
    fc.width = f.width;
    fc.height = f.height;
    const fx = fc.getContext('2d');
    fx.drawImage(f.image, 0, 0);
    const fd = fx.getImageData(0, 0, f.width, f.height).data;
    const px = (d, x, y) => {
      const i = (y * f.width + x) * 4;
      return [d[i], d[i + 1], d[i + 2], d[i + 3]];
    };
    const out = { holes: [], logo: { checked: 0, mismatches: 0 } };
    f.holes.forEach((h, n) => {
      // left quarter should be red, right quarter blue (photo is not mirrored)
      const ly = h.y + Math.round(h.h * 0.25);
      const lx = h.x + Math.round(h.w * 0.2);
      const rx = h.x + Math.round(h.w * 0.8);
      out.holes.push({ n, frameAlphaL: px(fd, lx, ly)[3], left: px(sd, lx, ly), right: px(sd, rx, ly) });
    });
    // Logo over hole 4: wherever the frame is opaque inside hole 4's box, the strip must equal the frame.
    const h4 = f.holes[3];
    for (let y = h4.y; y < h4.y + h4.h; y += 2) {
      for (let x = h4.x; x < h4.x + h4.w; x += 2) {
        const fp = px(fd, x, y);
        if (fp[3] !== 255) continue;
        out.logo.checked++;
        const sp = px(sd, x, y);
        if (Math.abs(sp[0] - fp[0]) > 1 || Math.abs(sp[1] - fp[1]) > 1 || Math.abs(sp[2] - fp[2]) > 1) out.logo.mismatches++;
      }
    }
    return out;
  });
  for (const h of r.holes) {
    assert.equal(h.frameAlphaL, 0, 'sample point is inside the transparent hole');
    assert.ok(h.left[0] > 200 && h.left[1] < 40 && h.left[2] < 40, `hole ${h.n + 1} left should be red, got ${h.left}`);
    assert.ok(h.right[2] > 200 && h.right[0] < 40 && h.right[1] < 40, `hole ${h.n + 1} right should be blue, got ${h.right}`);
  }
  assert.ok(r.logo.checked > 2000, `expected many opaque logo pixels inside hole 4, got ${r.logo.checked}`);
  assert.equal(r.logo.mismatches, 0, `${r.logo.mismatches} logo pixels were covered by the photo`);
  console.log(`      logo pixels over hole 4 checked: ${r.logo.checked}, all on top`);
  await ctx.close();
});

test('preview: viewfinder shows exactly the hole, frame on top, mirrored video only', async () => {
  const ctx = await newContext();
  const page = await openApp(ctx, { init: [syntheticCamera] });
  const g = await page.evaluate(() => {
    const vf = document.querySelector('#viewfinder').getBoundingClientRect();
    const v = document.querySelector('#video');
    const fr = document.querySelector('#vf-frame').getBoundingClientRect();
    const vr = v.getBoundingClientRect();
    const f = PB.state.frame;
    return {
      vf: [vf.width, vf.height],
      video: [vr.left - vf.left, vr.top - vf.top, vr.width, vr.height],
      frame: [fr.left - vf.left, fr.top - vf.top, fr.width, fr.height],
      videoTransform: getComputedStyle(v).transform,
      frameTransform: getComputedStyle(document.querySelector('#vf-frame')).transform,
      hole: f.holes[0],
      box: f.photoBoxes[0],
      fw: f.width,
      fh: f.height,
    };
  });
  const s = g.vf[0] / g.hole.w;
  assert.ok(Math.abs(g.vf[0] / g.vf[1] - g.hole.w / g.hole.h) < 0.01, 'viewfinder has the hole aspect ratio');
  assert.ok(Math.abs(g.video[0] - (g.box.x - g.hole.x) * s) < 1.5, 'video left edge = bleed');
  assert.ok(Math.abs(g.video[2] - g.box.w * s) < 1.5, 'video width = hole + bleed');
  assert.ok(Math.abs(g.frame[0] + g.hole.x * s) < 1.5, 'frame aligned to hole x');
  assert.ok(Math.abs(g.frame[1] + g.hole.y * s) < 1.5, 'frame aligned to hole y');
  assert.ok(Math.abs(g.frame[2] - g.fw * s) < 2, 'frame scaled with the hole');
  assert.ok(g.videoTransform.startsWith('matrix(-1'), 'preview video is mirrored');
  assert.equal(g.frameTransform, 'none', 'frame is never mirrored');
  await ctx.close();
});

test('download: strip PNG is the size of frame.png and the sheet PNG is 2:3', async () => {
  const ctx = await newContext();
  const page = await openApp(ctx);
  await runSession(page);
  const downloads = [];
  page.on('download', (d) => downloads.push(d));
  await page.click('#download-btn');
  await page.waitForFunction(() => true);
  for (let i = 0; i < 50 && downloads.length < 2; i++) await page.waitForTimeout(100);
  assert.equal(downloads.length, 2, 'two files downloaded');
  const sizes = {};
  for (const d of downloads) {
    const name = d.suggestedFilename();
    const file = path.join(OUT, name);
    await d.saveAs(file);
    sizes[name.includes('sheet') ? 'sheet' : 'strip'] = pngSize(fs.readFileSync(file));
  }
  assert.deepEqual(sizes.strip, { width: FRAME.w, height: FRAME.h });
  assert.deepEqual(sizes.sheet, { width: SHEET.w, height: SHEET.h });
  await ctx.close();
});

test('retake: tapping photo 3 retakes only that photo', async () => {
  const ctx = await newContext();
  const page = await openApp(ctx);
  await runSession(page);
  await page.evaluate(() => {
    window.__before = PB.state.photos.slice();
  });
  await page.click('#retake-btn');
  await page.waitForTimeout(200);
  await shot(page, '05-retake-mode');
  await page.click('.hole-btn[data-index="2"]');
  await page.waitForFunction(() => PB.state.screen === 'booth');
  await waitForScreen(page, 'review', 20000);
  const r = await page.evaluate(() => PB.state.photos.map((p, i) => p === window.__before[i]));
  assert.deepEqual(r, [true, true, false, true]);
  await ctx.close();
});

test('errors: denied camera shows a message, never a blank page', async () => {
  const ctx = await newContext();
  const page = await openApp(ctx, {
    waitFor: 'message',
    init: [
      () => {
        navigator.mediaDevices.getUserMedia = async () => {
          throw new DOMException('Permission denied', 'NotAllowedError');
        };
      },
    ],
  });
  const t = await page.textContent('#msg-title');
  assert.equal(t, 'Camera blocked');
  assert.ok(await page.isVisible('#msg-retry'));
  await shot(page, '06-denied');
  await ctx.close();
});

const { execFileSync } = require('child_process');

function pdfInfo(file) {
  const out = execFileSync('pdfinfo', [file]).toString();
  const pages = Number(/Pages:\s+(\d+)/.exec(out)[1]);
  const m = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(out);
  return { pages, w: Number(m[1]), h: Number(m[2]) };
}

// Render page 1 of a PDF to raw RGB pixels (via pdftoppm) for edge checks.
function pdfPixels(file, dpi = 50) {
  const base = file.replace(/\.pdf$/, '');
  execFileSync('pdftoppm', ['-r', String(dpi), '-f', '1', '-l', '1', '-singlefile', file, base]);
  const ppm = fs.readFileSync(base + '.ppm');
  // P6\n<w> <h>\n255\n<data>
  const header = ppm.slice(0, 64).toString('latin1');
  const m = /^P6\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(header);
  const w = Number(m[1]);
  const h = Number(m[2]);
  const data = ppm.slice(m[0].length);
  return { w, h, at: (x, y) => [data[(y * w + x) * 3], data[(y * w + x) * 3 + 1], data[(y * w + x) * 3 + 2]] };
}

async function preparePrint(page) {
  await page.evaluate(async () => {
    const prep = await PB.state.prep;
    await PB.actions.setPrintImage(prep.sheetBlob);
  });
}

test('print: stylesheet gives one 4x6 in page, sheet edge to edge, two copies', async () => {
  const ctx = await newContext();
  const page = await openApp(ctx, { init: [syntheticCamera] });
  await runSession(page);
  await preparePrint(page);
  const sheet = await page.evaluate(async () => {
    const p = await PB.state.prep;
    return [p.sheet.width, p.sheet.height];
  });
  assert.deepEqual(sheet, [SHEET.w, SHEET.h], `print sheet canvas is ${SHEET.w}x${SHEET.h}`);
  const file = path.join(OUT, 'print-4x6.pdf');
  await page.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
  const info = pdfInfo(file);
  assert.equal(info.pages, 1, 'exactly one page');
  assert.ok(Math.abs(info.w - 288) < 0.5 && Math.abs(info.h - 432) < 0.5, `page is 4x6 in (288x432 pt), got ${info.w}x${info.h}`);
  const px = pdfPixels(file, 50); // 200 x 300
  const white = (p) => p[0] > 245 && p[1] > 245 && p[2] > 245;
  // Corners and edge midpoints should be frame artwork, not white paper.
  const probes = [[1, 1], [px.w - 2, 1], [1, px.h - 2], [px.w - 2, px.h - 2], [px.w / 2 - 2, 1], [px.w / 2 + 2, px.h - 2]];
  for (const [x, y] of probes) assert.ok(!white(px.at(Math.round(x), Math.round(y))), `edge pixel ${x},${y} is white – sheet not edge to edge`);
  // Both halves hold the same strip.
  let diff = 0;
  for (let y = 5; y < px.h; y += 7) for (let x = 3; x < px.w / 2; x += 5) {
    const a = px.at(x, y);
    const b = px.at(x + px.w / 2, y);
    diff = Math.max(diff, Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  }
  assert.ok(diff < 40, `left and right copies differ (max channel diff ${diff})`);
  await ctx.close();
});

test('print: always two copies, even with an old "1 strip" setting saved; 100x148 mm option', async () => {
  const ctx = await newContext();
  const page = await openApp(ctx, { init: [syntheticCamera], settings: { ...FAST, layout: 'single', pageSize: '100x148mm' } });
  await runSession(page);
  await preparePrint(page);
  const file = path.join(OUT, 'print-100x148.pdf');
  await page.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
  const info = pdfInfo(file);
  assert.equal(info.pages, 1);
  assert.ok(Math.abs(info.w - 283.46) < 0.6 && Math.abs(info.h - 419.53) < 0.6, `page is 100x148 mm, got ${info.w}x${info.h}`);
  const px = pdfPixels(file, 50);
  const white = (p) => p[0] > 245 && p[1] > 245 && p[2] > 245;
  assert.ok(!white(px.at(Math.round(px.w * 0.25), Math.round(px.h * 0.15))), 'left half holds a strip');
  assert.ok(!white(px.at(Math.round(px.w * 0.75), Math.round(px.h * 0.15))), 'right half holds a strip');
  assert.equal(await page.evaluate(() => 'layout' in PB.settings), false, 'the old layout setting is ignored');
  assert.equal(await page.isHidden('.seg[data-setting="layout"]'), true, 'no layout choice in the operator menu');
  await ctx.close();
});

test('print: double tap sends one job, locks Print, counts the sheet', async () => {
  const ctx = await newContext();
  const page = await openApp(ctx, {
    settings: { ...FAST, printLock: 60 },
    init: [
      () => {
        window.__printCalls = 0;
        window.print = () => {
          window.__printCalls++;
        };
      },
    ],
  });
  await runSession(page);
  await page.evaluate(() => PB.state.prep);
  await page.dblclick('#print-btn');
  await page.click('#print-btn', { force: true, noWaitAfter: true, timeout: 1000 }).catch(() => {});
  await waitForScreen(page, 'printing', 5000);
  await shot(page, '07-printing');
  const r = await page.evaluate(() => ({ calls: window.__printCalls, sent: PB.print.sheetsSent(), lock: PB.print.lockRemainingMs() }));
  assert.equal(r.calls, 1, 'window.print called exactly once');
  assert.equal(r.sent, 1, 'sheet counter is 1');
  assert.ok(r.lock > 55000, 'print lock is running');
  // Tap the printing screen -> back to start; next group sees Print locked.
  await page.click('#printing');
  await waitForScreen(page, 'booth');
  await runSession(page);
  const label = await page.textContent('#print-btn .label');
  assert.ok(/Ready in \d+s/.test(label), `locked label, got "${label}"`);
  assert.ok(await page.isDisabled('#print-btn'));
  await shot(page, '08-review-locked');
  // Expire the lock: the button comes back.
  await page.evaluate(() => localStorage.setItem('stkeyclub.printLockUntil', '0'));
  await page.waitForFunction(() => !document.querySelector('#print-btn').disabled, null, { timeout: 3000 });
  assert.equal(await page.textContent('#print-btn .label'), 'Print');
  await ctx.close();
});

test('print: printing screen returns to the start screen by itself', async () => {
  const ctx = await newContext();
  const page = await openApp(ctx, {
    init: [
      () => {
        window.print = () => {};
      },
    ],
  });
  await runSession(page);
  await page.click('#print-btn');
  await waitForScreen(page, 'printing', 5000);
  await waitForScreen(page, 'booth', 10000);
  const photos = await page.evaluate(() => PB.state.photos.length);
  assert.equal(photos, 0, 'photos cleared for the next group');
  await ctx.close();
});

function stubPrint() {
  window.__printCalls = 0;
  window.print = () => {
    window.__printCalls++;
  };
}

// A synthetic camera that the test can "unplug" and "plug back in".
function controllableCamera() {
  window.__camPlugged = true;
  window.__camTracks = [];
  const make = () => {
    const c = document.createElement('canvas');
    c.width = 1280;
    c.height = 720;
    const x = c.getContext('2d');
    let n = 0;
    setInterval(() => {
      x.fillStyle = n++ % 2 ? '#334455' : '#334456';
      x.fillRect(0, 0, 1280, 720);
    }, 33);
    return c.captureStream(30);
  };
  navigator.mediaDevices.getUserMedia = async () => {
    if (!window.__camPlugged) throw new DOMException('Requested device not found', 'NotFoundError');
    const s = make();
    window.__camTracks.push(s.getVideoTracks()[0]);
    return s;
  };
  window.__unplug = () => {
    window.__camPlugged = false;
    for (const t of window.__camTracks) {
      t.stop();
      t.dispatchEvent(new Event('ended'));
    }
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
  };
  window.__plug = () => {
    window.__camPlugged = true;
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
  };
}

function renameSecondCamera() {
  const orig = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
  navigator.mediaDevices.enumerateDevices = async () =>
    (await orig()).map((d) =>
      d.kind === 'videoinput' && d.label === 'fake_device_1'
        ? { deviceId: d.deviceId, groupId: d.groupId, kind: d.kind, label: 'DJI Osmo Pocket 3', toJSON() { return this; } }
        : d
    );
}

const storeCount = () =>
  import('./js/store.js').then(async ({ listSessions }) => (await listSessions()).length);

test('operator: opens with "o" or a 2 s corner hold; settings persist', async () => {
  const ctx = await newContext();
  const page = await openApp(ctx);
  await page.mouse.move(30, 30);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
  assert.ok(await page.isHidden('#operator'), 'a short tap does not open the menu');
  await page.mouse.down();
  await page.waitForTimeout(2300);
  await page.mouse.up();
  await page.waitForSelector('#operator:not([hidden])', { timeout: 2000 });
  await page.waitForTimeout(300);
  await shot(page, '09-operator');
  await page.keyboard.press('Escape');
  assert.ok(await page.isHidden('#operator'));
  await page.keyboard.press('o');
  await page.waitForSelector('#operator:not([hidden])');
  await page.click('label.op-row:has(input[data-setting="sound"])');
  await page.click('.stepper[data-setting="countdown"] button[aria-label^="Increase"]');
  await page.click('.seg[data-setting="pageSize"] button[data-value="100x148mm"]');
  await page.click('label.op-row:has(input[data-setting="mirrorPreview"])');
  assert.equal(await page.evaluate(() => document.querySelector('#video').classList.contains('mirror')), false, 'mirror toggles live');
  await page.reload();
  await waitForScreen(page, 'booth');
  const s = await page.evaluate(() => ({ ...PB.settings }));
  assert.equal(s.sound, true);
  assert.equal(s.countdown, 2);
  assert.equal(s.pageSize, '100x148mm');
  assert.equal(s.mirrorPreview, false);
  await ctx.close();
});

test('camera picker: lists cameras, prefers DJI/Pocket first time, remembers the choice', async () => {
  const b2 = await chromium.launch({
    args: ['--use-fake-device-for-media-stream=device-count=2', '--use-fake-ui-for-media-stream'],
  });
  try {
    const ctx = await b2.newContext({ viewport: { width: 1366, height: 768 }, serviceWorkers: 'block' });
    const page = await openApp(ctx, { init: [renameSecondCamera] });
    const first = await page.evaluate(() => ({ track: PB.camera.label, saved: PB.settings.cameraId, active: PB.camera.deviceId }));
    assert.equal(first.track, 'DJI Osmo Pocket 3', 'the DJI-labelled camera was picked automatically');
    assert.equal(first.saved, first.active, 'and remembered');
    // Reload: device ids change here, and the DJI camera is not the default one,
    // so it can only be found again by name.
    await page.reload();
    await waitForScreen(page, 'booth');
    const again = await page.evaluate(() => ({ track: PB.camera.label, saved: PB.settings.cameraId, active: PB.camera.deviceId }));
    assert.equal(again.track, 'DJI Osmo Pocket 3', 'DJI camera found again after reload');
    assert.equal(again.saved, again.active, 'saved id refreshed');
    await page.keyboard.press('o');
    await page.waitForFunction(() => document.querySelectorAll('#op-camera option').length >= 3);
    const options = await page.$$eval('#op-camera option', (os) => os.map((o) => ({ v: o.value, t: o.textContent })));
    assert.ok(options.some((o) => o.t === 'DJI Osmo Pocket 3'), 'DJI camera listed');
    const other = options.find((o) => o.t === 'fake_device_0');
    assert.ok(other, 'built-in camera listed');
    await page.selectOption('#op-camera', other.v);
    await page.waitForFunction((id) => PB.camera.deviceId === id && PB.camera.ready, other.v, { timeout: 10000 });
    assert.equal(await page.evaluate(() => PB.settings.cameraId), other.v);
    // Chrome may hand out new device ids after a reload (it does here, because the
    // test permission is not stored). The camera must still be found by its name.
    await page.reload();
    await waitForScreen(page, 'booth');
    const after = await page.evaluate(() => ({ label: PB.camera.label, id: PB.camera.deviceId, saved: PB.settings.cameraId }));
    assert.equal(after.label, 'fake_device_0', 'chosen camera used again after reload');
    assert.equal(after.saved, after.id, 'saved id refreshed to the current one');
    await ctx.close();
  } finally {
    await b2.close();
  }
});

test('saved sheets: printing stores the sheet, reprint, keep last 20, clear all', async () => {
  const ctx = await newContext();
  const page = await openApp(ctx, { settings: { ...FAST, printLock: 0 }, init: [stubPrint] });
  await runSession(page);
  await page.click('#print-btn');
  await waitForScreen(page, 'printing', 5000);
  await page.waitForFunction(storeCount, null, { timeout: 5000 });
  assert.equal(await page.evaluate(storeCount), 1);
  await page.click('#printing');
  await waitForScreen(page, 'booth');
  await page.keyboard.press('o');
  await page.waitForSelector('.op-session');
  await page.click('.op-session');
  assert.equal(await page.evaluate(() => window.__printCalls), 1, 'first tap only arms the reprint');
  await page.click('.op-session');
  await page.waitForFunction(() => window.__printCalls === 2);
  assert.equal(await page.evaluate(() => PB.print.sheetsSent()), 2, 'reprint counts a sheet');
  await shot(page, '12-operator-saved');
  const n = await page.evaluate(async () => {
    const { saveSession, listSessions } = await import('./js/store.js');
    const blob = new Blob(['x'], { type: 'image/png' });
    for (let i = 0; i < 22; i++) await saveSession({ sheetBlob: blob, thumbBlob: blob });
    return (await listSessions()).length;
  });
  assert.equal(n, 20, 'only the last 20 are kept');
  await page.click('#op-clear');
  assert.equal(await page.evaluate(storeCount), 20, 'first tap only arms Clear all');
  await page.click('#op-clear');
  await page.waitForFunction(async () => (await import('./js/store.js').then((m) => m.listSessions())).length === 0);
  await ctx.close();
});

test('test print: prints a 4x6 sheet with sample photos and edge guides', async () => {
  const ctx = await newContext();
  const page = await openApp(ctx, { init: [stubPrint] });
  await page.keyboard.press('o');
  await page.click('#op-test-print');
  await page.waitForFunction(() => window.__printCalls === 1, null, { timeout: 5000 });
  const size = await page.evaluate(() => [document.querySelector('#print-img').naturalWidth, document.querySelector('#print-img').naturalHeight]);
  assert.deepEqual(size, [SHEET.w, SHEET.h]);
  const file = path.join(OUT, 'test-print.pdf');
  await page.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
  const info = pdfInfo(file);
  assert.equal(info.pages, 1);
  execFileSync('pdftoppm', ['-r', '100', '-png', '-singlefile', file, path.join(OUT, 'test-print')]);
  await ctx.close();
});

test('idle: review returns to the start screen, with a warning first', async () => {
  const ctx = await newContext();
  const page = await openApp(ctx);
  await runSession(page);
  await page.evaluate(() => {
    PB.state.lastActivity = Date.now() - (PB.settings.idleReset - 4) * 1000;
  });
  await page.waitForFunction(() => /Starting over in/.test(document.querySelector('#idle-hint').textContent), null, { timeout: 3000 });
  await shot(page, '10-idle-warning');
  await waitForScreen(page, 'booth', 8000);
  await ctx.close();
});

test('errors: camera unplugged shows a message and reconnects when plugged back in', async () => {
  const ctx = await newContext();
  const page = await openApp(ctx, { init: [controllableCamera] });
  await page.evaluate(() => window.__unplug());
  await waitForScreen(page, 'message', 5000);
  assert.equal(await page.textContent('#msg-title'), 'Camera disconnected');
  assert.ok(await page.isVisible('#msg-retry'));
  assert.ok(await page.isVisible('#msg-settings'));
  await shot(page, '11-unplugged');
  await page.waitForTimeout(3600);
  assert.equal(await page.evaluate(() => PB.state.screen), 'message', 'stays on the message while unplugged');
  await page.evaluate(() => window.__plug());
  await waitForScreen(page, 'booth', 8000);
  await page.click('#start-btn');
  await page.waitForFunction(() => PB.state.phase === 'countdown');
  await ctx.close();
});

test('errors: unplug mid-countdown cancels; unplug on review waits for the guests', async () => {
  const ctx = await newContext();
  const page = await openApp(ctx, { settings: { ...FAST, countdown: 3 }, init: [controllableCamera] });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => PB.state.phase === 'countdown');
  await page.evaluate(() => window.__unplug());
  await waitForScreen(page, 'message', 5000);
  await page.evaluate(() => window.__plug());
  await waitForScreen(page, 'booth', 8000);
  assert.equal(await page.evaluate(() => PB.state.phase), 'idle');
  await page.evaluate(() => PB.setSetting('countdown', 1));
  await runSession(page);
  await page.evaluate(() => window.__unplug());
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => PB.state.screen), 'review', 'guests keep their review screen');
  await page.click('#restart-btn');
  await waitForScreen(page, 'message', 3000);
  assert.equal(await page.textContent('#msg-title'), 'Camera disconnected');
  await ctx.close();
});

test('errors: camera unplugged and replugged during review reconnects in the background', async () => {
  const ctx = await newContext();
  const page = await openApp(ctx, { init: [controllableCamera] });
  await runSession(page);
  await page.evaluate(() => window.__unplug());
  await page.waitForTimeout(2500); // background retry fails quietly while unplugged
  assert.equal(await page.evaluate(() => PB.state.screen), 'review');
  await page.evaluate(() => window.__plug());
  await page.waitForFunction(() => PB.camera.running, null, { timeout: 8000 });
  assert.equal(await page.evaluate(() => PB.state.screen), 'review', 'guests were never interrupted');
  await page.click('#restart-btn');
  await waitForScreen(page, 'booth', 3000);
  await ctx.close();
});

test('errors: no camera at all shows "No camera found"', async () => {
  const ctx = await newContext();
  const page = await openApp(ctx, {
    waitFor: 'message',
    init: [
      () => {
        navigator.mediaDevices.getUserMedia = async () => {
          throw new DOMException('Requested device not found', 'NotFoundError');
        };
      },
    ],
  });
  assert.equal(await page.textContent('#msg-title'), 'No camera found');
  await ctx.close();
});

test('errors: a camera that never answers shows "not responding"', async () => {
  const ctx = await newContext();
  const page = await openApp(ctx, {
    waitFor: 'loading',
    init: [
      () => {
        navigator.permissions.query = async () => ({ state: 'granted', addEventListener() {} });
        navigator.mediaDevices.getUserMedia = () => new Promise(() => {});
      },
    ],
  });
  await page.waitForSelector('#loading-actions:not([hidden])', { timeout: 10000 });
  await waitForScreen(page, 'message', 15000);
  assert.equal(await page.textContent('#msg-title'), 'Camera not responding');
  await ctx.close();
});

test('errors: denied camera has Retry and a way into the operator menu', async () => {
  const ctx = await newContext();
  const page = await openApp(ctx, {
    waitFor: 'message',
    init: [
      () => {
        navigator.mediaDevices.getUserMedia = async () => {
          throw new DOMException('Permission denied', 'NotAllowedError');
        };
      },
    ],
  });
  assert.equal(await page.textContent('#msg-retry'), 'Retry');
  await page.click('#msg-settings');
  await page.waitForSelector('#operator:not([hidden])');
  await ctx.close();
});

test('offline: precache list covers every app file', async () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const listed = new Set(JSON.parse('[' + /const ASSETS = \[([\s\S]*?)\];/.exec(sw)[1].replace(/'/g, '"').replace(/,\s*$/, '') + ']'));
  for (const f of listed) {
    if (f === './') continue;
    assert.ok(fs.existsSync(path.join(ROOT, f)), `sw.js lists a missing file: ${f}`);
  }
  const needed = ['index.html', 'styles.css', 'config.js', 'frame.png', 'manifest.webmanifest'];
  for (const f of fs.readdirSync(path.join(ROOT, 'js'))) needed.push('js/' + f);
  for (const f of fs.readdirSync(path.join(ROOT, 'icons'))) needed.push('icons/' + f);
  for (const f of fs.readdirSync(path.join(ROOT, 'fonts'))) if (f.endsWith('.woff2')) needed.push('fonts/' + f);
  for (const f of needed) assert.ok(listed.has(f), `${f} is not in the sw.js ASSETS list (it would be missing offline)`);
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(ROOT, icon.src)), `manifest icon missing: ${icon.src}`);
});

test('offline: after one visit the booth loads and works with no network at all', async () => {
  const own = await startServer();
  const ctx = await newContext({ serviceWorkers: 'allow' });
  try {
    const page = await openApp(ctx, { url: own.url });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
    await page.waitForFunction(async () => (await caches.keys()).some((k) => k.startsWith('stkeyclub-')));
    // Kill the server and cut the network.
    await own.close();
    await ctx.setOffline(true);
    const failed = [];
    page.on('requestfailed', (r) => failed.push(r.url()));
    await page.reload();
    await waitForScreen(page, 'booth', 20000);
    const f = await page.evaluate(() => ({ src: PB.state.frame.source, holes: PB.state.frame.holeSource }));
    assert.deepEqual(f, { src: 'file', holes: 'detected' }, 'frame.png came from the offline cache');
    await runSession(page);
    await preparePrint(page);
    const file = path.join(OUT, 'offline-print.pdf');
    await page.pdf({ path: file, preferCSSPageSize: true });
    assert.equal(pdfInfo(file).pages, 1);
    // A brand new tab also opens offline.
    const page2 = await ctx.newPage();
    await page2.goto(own.url);
    await waitForScreen(page2, 'booth', 20000);
    assert.deepEqual(failed, [], 'no request failed while offline');
    await page2.keyboard.press('o');
    await page2.waitForFunction(() => /offline ready \(v/.test(document.querySelector('#op-info').textContent));
  } finally {
    await ctx.close();
    await own.close();
  }
});

test('offline: a new version replaces the old cache and reloads when idle', async () => {
  let bump = false;
  const own = await startServer(0, {
    '/sw.js': (buf) => (bump ? Buffer.from(buf.toString().replace(/const VERSION = '[^']*'/, "const VERSION = 'test-2'")) : buf),
  });
  const ctx = await newContext({ serviceWorkers: 'allow' });
  try {
    const page = await openApp(ctx, { url: own.url });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
    const before = await page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('stkeyclub-')));
    assert.equal(before.length, 1);
    // Guests are on the review screen when the update arrives: no reload yet.
    await runSession(page);
    await page.evaluate(() => (window.__marker = 1));
    bump = true;
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await page.waitForFunction(() => PB.state.pendingReload === true, null, { timeout: 15000 });
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => window.__marker), 1, 'did not reload in the middle of a session');
    // Start over -> idle -> reload into the new version.
    await page.click('#restart-btn');
    await page.waitForFunction(() => window.__marker === undefined && window.PB && PB.state.screen === 'booth', null, { timeout: 20000 });
    const after = await page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('stkeyclub-')));
    assert.deepEqual(after, ['stkeyclub-test-2'], 'old cache deleted, new one in use');
  } finally {
    await ctx.close();
    await own.close();
  }
});

test('pwa: Chrome reports the app as installable', async () => {
  const ctx = await newContext({ serviceWorkers: 'allow' });
  const page = await openApp(ctx);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
  const cdp = await ctx.newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(installabilityErrors, [], JSON.stringify(installabilityErrors));
  const manifest = await cdp.send('Page.getAppManifest');
  assert.deepEqual(manifest.errors, []);
  await ctx.close();
});

// Full-spectrum synthetic camera (hue across, brightness down) for filter checks.
function rainbowCamera() {
  navigator.mediaDevices.getUserMedia = async () => {
    const c = document.createElement('canvas');
    c.width = 1280;
    c.height = 720;
    const x = c.getContext('2d');
    const draw = () => {
      for (let i = 0; i < 64; i++) {
        x.fillStyle = `hsl(${(i / 64) * 360}, 90%, 50%)`;
        x.fillRect((i * 1280) / 64, 0, 1280 / 64 + 1, 720);
      }
      const g = x.createLinearGradient(0, 0, 0, 720);
      g.addColorStop(0, 'rgba(255,255,255,0.6)');
      g.addColorStop(0.5, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.7)');
      x.fillStyle = g;
      x.fillRect(0, 0, 1280, 720);
    };
    draw();
    setInterval(draw, 50);
    return c.captureStream(20);
  };
}

test('filters: each filter changes the strip; None restores the originals exactly', async () => {
  const ctx = await newContext();
  const page = await openApp(ctx, { init: [syntheticCamera] });
  await runSession(page);
  const sample = () =>
    page.evaluate(() => {
      const s = document.querySelector('#strip');
      const x = s.getContext('2d');
      const h = PB.state.frame.holes[0];
      const at = (fx, fy) => Array.from(x.getImageData(Math.round(h.x + h.w * fx), Math.round(h.y + h.h * fy), 1, 1).data.slice(0, 3));
      return { red: at(0.2, 0.25), blue: at(0.8, 0.25) };
    });
  const base = await sample();
  await page.click('#filters-btn');
  await page.waitForSelector('.filter-item');
  assert.deepEqual(await page.$$eval('.filter-item', (bs) => bs.map((b) => b.textContent)), ['None', 'B&W', 'Warm', 'Cool', 'Vintage'], 'five filters');
  await page.waitForTimeout(150);
  await shot(page, '13-filters');
  const res = {};
  for (const id of ['bw', 'warm', 'cool', 'vintage']) {
    await page.click(`.filter-item[data-filter="${id}"]`);
    res[id] = await sample();
  }
  const g = res.bw.red;
  assert.ok(Math.abs(g[0] - g[1]) < 6 && Math.abs(g[1] - g[2]) < 6, `B&W turns red grey, got ${g}`);
  assert.ok(res.warm.blue[2] < base.blue[2] - 20, `Warm lowers blue (${res.warm.blue} vs ${base.blue})`);
  assert.ok(res.cool.red[0] < base.red[0] - 20, `Cool lowers red (${res.cool.red} vs ${base.red})`);
  assert.ok(res.vintage.red[1] > base.red[1] + 25 && res.vintage.blue[2] < base.blue[2] - 50, `Vintage is sepia-toned (${res.vintage.red} / ${res.vintage.blue})`);
  await page.click('.filter-item[data-filter="none"]');
  assert.deepEqual(await sample(), base, 'None gives back the exact original pixels');
  await page.click('.filter-item[data-filter="bw"]');
  const sheetPx = await page.evaluate(async () => {
    const p = await PB.state.prep;
    const h = PB.state.frame.holes[0];
    return Array.from(p.sheet.getContext('2d').getImageData(Math.round(h.x + h.w * 0.2), Math.round(h.y + h.h * 0.25), 1, 1).data.slice(0, 3));
  });
  assert.ok(Math.abs(sheetPx[0] - sheetPx[1]) < 6 && Math.abs(sheetPx[1] - sheetPx[2]) < 6, `print sheet uses the chosen filter, got ${sheetPx}`);
  await page.click('#filters-done');
  assert.ok(await page.isVisible('#print-btn'));
  await shot(page, '14-review-bw');
  await ctx.close();
});

test('filters: per-pixel fallback matches ctx.filter', async () => {
  const ctx = await newContext();
  const page = await openApp(ctx, { init: [rainbowCamera] });
  await runSession(page);
  const r = await page.evaluate(async () => {
    const { filteredDrawer } = await import('./js/filters.js');
    const fo = PB.filters.filterOptions;
    const out = { native: PB.filters.canvasFilterSupported() };
    for (const id of ['bw', 'warm', 'cool', 'vintage']) {
      fo.forceFallback = false;
      const a = PB.compose.composeStrip(PB.state.frame, PB.state.photos, { scale: 0.5, drawPhoto: filteredDrawer(id) });
      fo.forceFallback = true;
      const b = PB.compose.composeStrip(PB.state.frame, PB.state.photos, { scale: 0.5, drawPhoto: filteredDrawer(id) });
      fo.forceFallback = false;
      const da = a.getContext('2d').getImageData(0, 0, a.width, a.height).data;
      const db = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < da.length; i += 4) {
        sum += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
        n += 3;
      }
      out[id] = +(sum / n).toFixed(2);
    }
    return out;
  });
  assert.equal(r.native, true, 'Chrome supports ctx.filter');
  for (const id of ['bw', 'warm', 'cool', 'vintage']) assert.ok(r[id] < 5, `${id}: mean difference ${r[id]} (0-255 scale)`);
  console.log('      mean |ctx.filter - fallback|:', JSON.stringify(r));
  await ctx.close();
});

test('filters: the operator can turn filters off', async () => {
  const ctx = await newContext();
  const page = await openApp(ctx);
  await runSession(page);
  assert.ok(await page.isVisible('#filters-btn'));
  await page.evaluate(() => PB.filters.chooseFilter('bw'));
  await page.keyboard.press('o');
  await page.click('label.op-row:has(input[data-setting="filters"])');
  await page.keyboard.press('Escape');
  assert.ok(await page.isHidden('#filters-btn'), 'Filters button hidden');
  assert.equal(await page.evaluate(() => PB.state.filter), 'none', 'filter reset to None');
  await ctx.close();
});

test('layout: every screen fits, nothing overlaps, at kiosk, tablet and phone sizes', async () => {
  const sizes = [
    [1366, 768],
    [1280, 720],
    [1536, 864],
    [1920, 1080],
    [1440, 900],
    [1280, 800],
    [1200, 800],
    [1366, 657], // windowed Chrome (tabs + address bar)
    [1024, 768],
    [768, 1024], // tablet portrait
    [414, 896], // phones, portrait
    [390, 844],
    [360, 740],
    [320, 568],
    [844, 390], // phones, sideways
    [568, 320],
  ];
  const ctx = await newContext();
  const page = await openApp(ctx, { init: [syntheticCamera] });
  // inside: each element is visible and on screen. apart: pairs of elements that must not overlap.
  const check = async (label, inside, apart = []) => {
    const r = await page.evaluate(
      ({ inside, apart }) => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const bad = [];
        const box = (sel) => {
          const el = document.querySelector(sel);
          return el ? el.getBoundingClientRect() : null;
        };
        for (const sel of inside) {
          const b = box(sel);
          if (!b) bad.push(`${sel} missing`);
          else if (b.width === 0 || b.height === 0) bad.push(`${sel} not visible`);
          else if (b.left < -1 || b.top < -1 || b.right > vw + 1 || b.bottom > vh + 1) bad.push(`${sel} outside ${vw}x${vh}: ${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.right)},${Math.round(b.bottom)}`);
        }
        for (const [a, c] of apart) {
          const p = box(a);
          const q = box(c);
          if (!p || !q || !p.width || !q.width) continue;
          const ox = Math.min(p.right, q.right) - Math.max(p.left, q.left);
          const oy = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
          if (ox > 1 && oy > 1) bad.push(`${a} overlaps ${c} by ${Math.round(oy)}px`);
        }
        const se = document.scrollingElement;
        if (se.scrollHeight > vh + 1 || se.scrollWidth > vw + 1) bad.push('page scrolls');
        return bad;
      },
      { inside, apart }
    );
    assert.deepEqual(r, [], label);
  };
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => PB.actions.goIdle());
    await page.waitForTimeout(150);
    await check(
      `start ${w}x${h}`,
      ['#viewfinder', '#instruction', '#start-btn'],
      [
        ['#booth .wordmark', '#instruction'],
        ['#booth .wordmark', '#viewfinder'],
        ['#instruction', '#start-btn'],
        ['#viewfinder', '#instruction'],
        ['#viewfinder', '#start-btn'],
      ]
    );
    if (w === 1280 && h === 800) await shot(page, `15-start-${w}x${h}`);
    await runSession(page);
    // let the strip finish coming out of the slot
    await page.waitForFunction(() => !document.querySelector('.strip-wrap').getAnimations().some((a) => a.playState === 'running'));
    const reviewInside = ['.strip-wrap', '#print-btn', '#retake-btn', '#filters-btn', '#download-btn', '#restart-btn'];
    const reviewApart = [
      ['.strip-wrap', '.review-controls'],
      ['.review-copy', '#print-btn'],
    ];
    await check(`review ${w}x${h}`, reviewInside, reviewApart);
    await page.click('#retake-btn');
    await check(`retake ${w}x${h}`, ['.strip-wrap', '#retake-btn', '.hole-btn'], reviewApart);
    assert.deepEqual(
      await page.$$eval('#print-btn, #filters-btn, #download-btn, #restart-btn', (bs) => bs.filter((b) => b.checkVisibility({ visibilityProperty: true })).length),
      0,
      `retake ${w}x${h}: only Cancel is left`
    );
    await page.click('#retake-btn');
    await page.click('#filters-btn');
    await check(`filters ${w}x${h}`, ['.strip-wrap', '.filter-list', '#filters-done'], [
      ['.strip-wrap', '.review-controls'],
      ['.review-copy', '.filter-list'],
    ]);
    if (w === 1024 && h === 768) await shot(page, `16-filters-${w}x${h}`);
    await page.click('#filters-done');
  }
  await ctx.close();
});

/* ---------------- runner ---------------- */

(async () => {
  const filter = process.argv[2] || '';
  server = await startServer();
  browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    if (filter && !t.name.includes(filter)) continue;
    const t0 = Date.now();
    try {
      await t.fn();
      passed++;
      console.log(`  ✓ ${t.name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${t.name}\n      ${String((e && e.stack) || e).split('\n').slice(0, 4).join('\n      ')}`);
    }
  }
  await browser.close();
  await server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
