// Loads frame.png and finds the photo holes from its alpha channel.
import { CONFIG } from '../config.js';
import { makeCanvas, loadImage, log } from './util.js';

// Find large connected transparent regions. Returns bounding boxes sorted top
// to bottom: [{ x, y, w, h, area }]. Works at any frame resolution.
export function detectHoles(source, opts = {}) {
  const alphaThreshold = opts.alphaThreshold ?? CONFIG.holeAlphaThreshold;
  const minAreaFraction = opts.minAreaFraction ?? CONFIG.holeMinAreaFraction;
  const w = source.naturalWidth || source.width;
  const h = source.naturalHeight || source.height;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const n = w * h;

  // 1 = transparent & unvisited, 2 = visited, 0 = opaque
  const mask = new Uint8Array(n);
  for (let i = 0, j = 3; i < n; i++, j += 4) mask[i] = data[j] < alphaThreshold ? 1 : 0;

  const stack = new Int32Array(n);
  const regions = [];
  for (let start = 0; start < n; start++) {
    if (mask[start] !== 1) continue;
    let sp = 0;
    stack[sp++] = start;
    mask[start] = 2;
    let minX = w, minY = h, maxX = -1, maxY = -1, area = 0;
    while (sp > 0) {
      const p = stack[--sp];
      const y = (p / w) | 0;
      const x = p - y * w;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && mask[p - 1] === 1) { mask[p - 1] = 2; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] === 1) { mask[p + 1] = 2; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] === 1) { mask[p - w] = 2; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] === 1) { mask[p + w] = 2; stack[sp++] = p + w; }
    }
    regions.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area });
  }

  const minArea = n * minAreaFraction;
  const big = regions.filter((r) => r.area >= minArea && r.w >= w * 0.1 && r.h >= h * 0.02);
  big.sort((a, b) => b.area - a.area);
  return { holes: big.slice(0, CONFIG.shots).sort((a, b) => a.y - b.y || a.x - b.x), found: big.length };
}

export function fallbackHoles(width, height) {
  const { refWidth, refHeight, boxes } = CONFIG.fallbackHoles;
  const sx = width / refWidth;
  const sy = height / refHeight;
  return boxes.map((b) => {
    const x = Math.round(b.x1 * sx);
    const y = Math.round(b.y1 * sy);
    return {
      x,
      y,
      w: Math.round((b.x2 + 1) * sx) - x,
      h: Math.round((b.y2 + 1) * sy) - y,
      area: 0,
    };
  });
}

// A plain stand-in frame so the booth still works if frame.png cannot load.
async function makePlainFrame() {
  const { refWidth: W, refHeight: H, boxes } = CONFIG.fallbackHoles;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1d0b3d');
  g.addColorStop(0.55, '#4a1264');
  g.addColorStop(1, '#0d3b49');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (const b of boxes) ctx.clearRect(b.x1, b.y1, b.x2 - b.x1 + 1, b.y2 - b.y1 + 1);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = '600 30px system-ui, sans-serif';
  ctx.fillText('S T K E Y C L U B', W / 2, 56);
  ctx.font = '800 64px system-ui, sans-serif';
  ctx.fillText('keydc', W / 2, H - 90);
  return loadImage(c.toDataURL('image/png'));
}

export async function loadFrame(url = CONFIG.frameUrl) {
  let image;
  let source = 'file';
  const warnings = [];
  try {
    image = await loadImage(url);
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('empty image');
  } catch (e) {
    log.error('frame.png failed to load, using a plain frame', e);
    warnings.push('frame.png could not be loaded – using a plain frame');
    image = await makePlainFrame();
    source = 'plain';
  }
  const width = image.naturalWidth;
  const height = image.naturalHeight;

  let holes = null;
  let holeSource = 'detected';
  try {
    const t0 = performance.now();
    const res = detectHoles(image);
    log.info(`hole detection: ${res.found} region(s) in ${Math.round(performance.now() - t0)} ms`);
    if (res.found === CONFIG.shots) {
      holes = res.holes;
    } else {
      warnings.push(`found ${res.found} transparent areas instead of ${CONFIG.shots} – using the hole positions from config.js`);
    }
  } catch (e) {
    log.error('hole detection failed', e);
    warnings.push('hole detection failed – using the hole positions from config.js');
  }
  if (!holes) {
    holes = fallbackHoles(width, height);
    holeSource = 'config';
  }

  const bleed = Math.max(1, Math.round((CONFIG.bleed * width) / CONFIG.fallbackHoles.refWidth));
  const photoBoxes = holes.map((hb) => ({ x: hb.x - bleed, y: hb.y - bleed, w: hb.w + 2 * bleed, h: hb.h + 2 * bleed }));
  for (const wmsg of warnings) log.warn(wmsg);
  return { image, width, height, holes, photoBoxes, bleed, holeSource, source, warnings };
}
