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

const EXPECTED_HOLES = [
  { x: 28, y: 83, w: 544, h: 371 },
  { x: 28, y: 471, w: 544, h: 371 },
  { x: 27, y: 857, w: 544, h: 370 },
  { x: 27, y: 1241, w: 544, h: 370 },
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

function startServer(port = 0) {
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
      res.end(data);
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
  assert.equal(f.w, 600);
  assert.equal(f.h, 1800);
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
  const r = await page.evaluate(async () => {
    const { detectHoles, fallbackHoles } = await import('./js/frame.js');
    const img = PB.state.frame.image;
    const big = document.createElement('canvas');
    big.width = 1200;
    big.height = 3600;
    big.getContext('2d').drawImage(img, 0, 0, 1200, 3600);
    const opaque = document.createElement('canvas');
    opaque.width = 600;
    opaque.height = 1800;
    opaque.getContext('2d').fillRect(0, 0, 600, 1800);
    return {
      big: detectHoles(big).holes,
      none: detectHoles(opaque).found,
      fb: fallbackHoles(1200, 3600),
    };
  });
  r.big.forEach((h, i) => {
    const e = EXPECTED_HOLES[i];
    for (const k of ['x', 'y', 'w', 'h']) {
      assert.ok(Math.abs(h[k] - e[k] * 2) <= 4, `2x hole ${i + 1} ${k}: got ${h[k]}, expected ~${e[k] * 2}`);
    }
  });
  assert.equal(r.none, 0, 'an opaque frame has no holes');
  assert.deepEqual(r.fb[0], { x: 56, y: 166, w: 1088, h: 742, area: 0 });
  await ctx.close();
});

test('flow: 4 shots with the fake camera, strip is 600x1800', async () => {
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
  assert.deepEqual(r.strip, [600, 1800]);
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

test('download: strip PNG is 600x1800 and sheet PNG is 1200x1800', async () => {
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
  assert.deepEqual(sizes.strip, { width: 600, height: 1800 });
  assert.deepEqual(sizes.sheet, { width: 1200, height: 1800 });
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
  assert.deepEqual(sheet, [1200, 1800], 'print sheet canvas is 1200x1800');
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

test('print: "1 strip" layout leaves the right half blank; 100x148 mm option', async () => {
  const ctx = await newContext();
  const page = await openApp(ctx, { init: [syntheticCamera], settings: { ...FAST, layout: 'single', pageSize: '100x148mm' } });
  await runSession(page);
  await preparePrint(page);
  const file = path.join(OUT, 'print-single-100x148.pdf');
  await page.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
  const info = pdfInfo(file);
  assert.equal(info.pages, 1);
  assert.ok(Math.abs(info.w - 283.46) < 0.6 && Math.abs(info.h - 419.53) < 0.6, `page is 100x148 mm, got ${info.w}x${info.h}`);
  const px = pdfPixels(file, 50);
  const p = px.at(Math.round(px.w * 0.75), Math.round(px.h / 2));
  assert.ok(p[0] > 245 && p[1] > 245 && p[2] > 245, `right half should be blank, got ${p}`);
  const q = px.at(Math.round(px.w * 0.25), Math.round(px.h * 0.15));
  assert.ok(!(q[0] > 245 && q[1] > 245 && q[2] > 245), 'left half holds the strip');
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
