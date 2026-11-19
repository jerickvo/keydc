// Photo filters. Applied while composing, from the full-resolution originals,
// so switching filters never changes the photos themselves.
//
// Each filter is a CSS filter string (run with ctx.filter where the browser
// supports it, otherwise with the same maths per pixel), plus an optional
// multiply tint (a white-balance shift) and vignette.
import { makeCanvas } from './util.js';
import { drawCover } from './compose.js';

export const FILTERS = [
  { id: 'none', label: 'None' },
  { id: 'bw', label: 'B&W', css: 'grayscale(1) contrast(1.15) brightness(1.04)' },
  { id: 'warm', label: 'Warm', css: 'saturate(1.1) brightness(1.05)', tint: [255, 240, 214] },
  { id: 'cool', label: 'Cool', css: 'saturate(1.02) brightness(1.07)', tint: [222, 236, 255] },
  { id: 'vintage', label: 'Vintage', css: 'sepia(0.5) contrast(0.9) brightness(1.08) saturate(0.85)', vignette: 0.45 },
];

export function getFilter(id) {
  return FILTERS.find((f) => f.id === id) || FILTERS[0];
}

let nativeSupport = null;
export const filterOptions = { forceFallback: false };

// Does ctx.filter actually work here? (Checks the pixels, not just the property.)
export function canvasFilterSupported() {
  if (filterOptions.forceFallback) return false;
  if (nativeSupport !== null) return nativeSupport;
  try {
    const c = makeCanvas(4, 4);
    const x = c.getContext('2d', { willReadFrequently: true });
    if (!('filter' in x)) return (nativeSupport = false);
    const red = makeCanvas(4, 4);
    const rx = red.getContext('2d');
    rx.fillStyle = '#ff0000';
    rx.fillRect(0, 0, 4, 4);
    x.filter = 'grayscale(1)';
    x.drawImage(red, 0, 0);
    const d = x.getImageData(1, 1, 1, 1).data;
    nativeSupport = d[3] > 0 && Math.abs(d[0] - d[1]) < 10 && Math.abs(d[1] - d[2]) < 10;
  } catch {
    nativeSupport = false;
  }
  return nativeSupport;
}

/* ---------- per-pixel fallback (same maths as the CSS filter functions) ---------- */

function parseCss(css) {
  const ops = [];
  const re = /([a-z-]+)\(\s*([-\d.]+)\s*(%|deg)?\s*\)/g;
  let m;
  while ((m = re.exec(css))) {
    let v = parseFloat(m[2]);
    if (m[3] === '%') v /= 100;
    ops.push([m[1], v]);
  }
  return ops;
}

function opMatrix(name, a) {
  const k = 1 - a;
  switch (name) {
    case 'grayscale':
      return [
        0.2126 + 0.7874 * k, 0.7152 - 0.7152 * k, 0.0722 - 0.0722 * k,
        0.2126 - 0.2126 * k, 0.7152 + 0.2848 * k, 0.0722 - 0.0722 * k,
        0.2126 - 0.2126 * k, 0.7152 - 0.7152 * k, 0.0722 + 0.9278 * k,
      ];
    case 'sepia':
      return [
        0.393 + 0.607 * k, 0.769 - 0.769 * k, 0.189 - 0.189 * k,
        0.349 - 0.349 * k, 0.686 + 0.314 * k, 0.168 - 0.168 * k,
        0.272 - 0.272 * k, 0.534 - 0.534 * k, 0.131 + 0.869 * k,
      ];
    case 'saturate':
      return [
        0.213 + 0.787 * a, 0.715 - 0.715 * a, 0.072 - 0.072 * a,
        0.213 - 0.213 * a, 0.715 + 0.285 * a, 0.072 - 0.072 * a,
        0.213 - 0.213 * a, 0.715 - 0.715 * a, 0.072 + 0.928 * a,
      ];
    default:
      return null;
  }
}

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

export function applyCssPerPixel(imageData, css) {
  const ops = parseCss(css).map(([name, v]) => ({ name, v, m: opMatrix(name, v) }));
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];
    for (const op of ops) {
      if (op.m) {
        const m = op.m;
        const nr = m[0] * r + m[1] * g + m[2] * b;
        const ng = m[3] * r + m[4] * g + m[5] * b;
        const nb = m[6] * r + m[7] * g + m[8] * b;
        r = clamp(nr);
        g = clamp(ng);
        b = clamp(nb);
      } else if (op.name === 'brightness') {
        r = clamp(r * op.v);
        g = clamp(g * op.v);
        b = clamp(b * op.v);
      } else if (op.name === 'contrast') {
        const o = 127.5 * (1 - op.v);
        r = clamp(r * op.v + o);
        g = clamp(g * op.v + o);
        b = clamp(b * op.v + o);
      }
    }
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
  return imageData;
}

/* ---------- drawing ---------- */

function vignette(ctx, w, h, strength) {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.hypot(w, h) / 2);
  g.addColorStop(0, 'rgba(30, 15, 0, 0)');
  g.addColorStop(1, `rgba(30, 15, 0, ${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// drawPhoto hook for composeStrip(): draws one photo into its box with the filter.
export function filteredDrawer(id) {
  const f = getFilter(id);
  if (f.id === 'none') return null;
  return (ctx, photo, x, y, w, h) => {
    const tw = Math.max(1, Math.round(w));
    const th = Math.max(1, Math.round(h));
    const t = makeCanvas(tw, th);
    const tx = t.getContext('2d', { willReadFrequently: !canvasFilterSupported() });
    tx.imageSmoothingEnabled = true;
    tx.imageSmoothingQuality = 'high';
    const native = f.css && canvasFilterSupported();
    if (native) tx.filter = f.css;
    drawCover(tx, photo, 0, 0, tw, th);
    tx.filter = 'none';
    if (f.css && !native) tx.putImageData(applyCssPerPixel(tx.getImageData(0, 0, tw, th), f.css), 0, 0);
    if (f.tint) {
      tx.globalCompositeOperation = 'multiply';
      tx.fillStyle = `rgb(${f.tint[0]}, ${f.tint[1]}, ${f.tint[2]})`;
      tx.fillRect(0, 0, tw, th);
      tx.globalCompositeOperation = 'source-over';
    }
    if (f.vignette) vignette(tx, tw, th, f.vignette);
    ctx.drawImage(t, x, y, w, h);
  };
}
