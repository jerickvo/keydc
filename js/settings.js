// Settings persisted in localStorage. Every value is validated on load so a
// corrupted or outdated entry can never break the booth.
import { CONFIG } from '../config.js';

const KEY = 'stkeyclub.settings.v1';

export const RULES = {
  mirrorPreview: { type: 'bool' },
  mirrorPhoto: { type: 'bool' },
  countdown: { type: 'num', min: 1, max: 10, step: 1 },
  pause: { type: 'num', min: 0.5, max: 5, step: 0.5 },
  sound: { type: 'bool' },
  flash: { type: 'bool' },
  filters: { type: 'bool' },
  layout: { type: 'enum', values: ['double', 'single'] },
  printLock: { type: 'num', min: 0, max: 300, step: 5 },
  idleReset: { type: 'num', min: 15, max: 600, step: 15 },
  pageSize: { type: 'enum', values: ['4x6in', '100x148mm'] },
  printInset: { type: 'num', min: 0, max: 5, step: 0.5 },
  cameraId: { type: 'str' },
  cameraLabel: { type: 'str' },
};

function sanitize(key, value) {
  const rule = RULES[key];
  const fallback = CONFIG.defaults[key];
  if (!rule) return fallback;
  switch (rule.type) {
    case 'bool':
      return typeof value === 'boolean' ? value : fallback;
    case 'num': {
      const n = Number(value);
      if (value === null || value === '' || !Number.isFinite(n)) return fallback;
      return Math.min(rule.max, Math.max(rule.min, n));
    }
    case 'enum':
      return rule.values.includes(value) ? value : fallback;
    case 'str':
      return typeof value === 'string' ? value.slice(0, 500) : fallback;
    default:
      return fallback;
  }
}

function load() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    stored = {};
  }
  const s = {};
  for (const k of Object.keys(CONFIG.defaults)) {
    s[k] = Object.prototype.hasOwnProperty.call(stored, k) ? sanitize(k, stored[k]) : CONFIG.defaults[k];
  }
  return s;
}

export const settings = load();
const listeners = new Set();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage full or blocked: keep working with in-memory settings */
  }
}

export function setSetting(key, value) {
  if (!(key in CONFIG.defaults)) return;
  const v = sanitize(key, value);
  if (settings[key] === v) return;
  settings[key] = v;
  persist();
  for (const fn of listeners) {
    try {
      fn(key, v);
    } catch (e) {
      console.error(e);
    }
  }
}

export function onSettingsChange(fn) {
  listeners.add(fn);
}

// Small persisted counters/values that are not "settings".
export function readNumber(key, fallback = 0) {
  try {
    const n = Number(localStorage.getItem(key));
    return Number.isFinite(n) && localStorage.getItem(key) !== null ? n : fallback;
  } catch {
    return fallback;
  }
}

export function writeNumber(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* ignore */
  }
}
