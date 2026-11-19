// Small helpers shared by the modules.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export class Cancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'Cancelled';
  }
}

// A cancel token for multi-step async flows (countdown, capture sequence).
export function makeToken() {
  const listeners = new Set();
  return {
    cancelled: false,
    cancel() {
      if (this.cancelled) return;
      this.cancelled = true;
      for (const fn of listeners) fn();
      listeners.clear();
    },
    onCancel(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function wait(ms, token) {
  return new Promise((resolve, reject) => {
    if (token && token.cancelled) {
      reject(new Cancelled());
      return;
    }
    let off = null;
    const t = setTimeout(() => {
      if (off) off();
      resolve();
    }, ms);
    if (token) {
      off = token.onCancel(() => {
        clearTimeout(t);
        reject(new Cancelled());
      });
    }
  });
}

export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, quality);
    } catch (e) {
      reject(e);
    }
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load ' + String(src).slice(0, 60)));
    img.src = src;
  });
}

export function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// In-memory log shown in the operator menu, so problems on the day can be seen
// without developer tools.
const LOG_MAX = 60;
const entries = [];
function push(level, args) {
  const text = args
    .map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'object' ? safeJson(a) : String(a)))
    .join(' ');
  entries.push({ t: new Date(), level, text });
  if (entries.length > LOG_MAX) entries.shift();
  (console[level] || console.log)('[booth]', ...args);
}
function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
export const log = {
  info: (...a) => push('info', a),
  warn: (...a) => push('warn', a),
  error: (...a) => push('error', a),
  entries: () => entries.slice(),
};
