// Hidden operator menu: hold the top-left corner for 2 s, or press "o".
import { CONFIG } from '../config.js';
import { settings, setSetting, RULES } from './settings.js';
import { sheetsSent, addSheets, resetSheets } from './print.js';
import { listSessions, clearSessions } from './store.js';
import { $, $$, log } from './util.js';

let api = null;
let isOpen = false;
let refreshTimer = null;
let thumbUrls = [];
let lastCams = [];

const el = {};

export function initOperator(options) {
  api = options;
  Object.assign(el, {
    root: $('#operator'),
    close: $('#op-close'),
    backdrop: $('#operator .op-backdrop'),
    camera: $('#op-camera'),
    cameraStatus: $('#op-camera-status'),
    sheets: $('#op-sheets'),
    pack: $('#op-pack'),
    sheetsMinus: $('#op-sheets-minus'),
    sheetsReset: $('#op-sheets-reset'),
    testPrint: $('#op-test-print'),
    sessions: $('#op-sessions'),
    clear: $('#op-clear'),
    fullscreen: $('#op-fullscreen'),
    reload: $('#op-reload'),
    info: $('#op-info'),
    log: $('#op-log'),
    toast: $('#op-toast'),
    corner: $('#corner'),
  });

  el.close.addEventListener('click', closeOperator);
  el.backdrop.addEventListener('click', closeOperator);

  // toggles
  for (const input of $$('#operator input.switch[data-setting]')) {
    const key = input.dataset.setting;
    input.checked = !!settings[key];
    input.addEventListener('change', () => setSetting(key, input.checked));
  }

  // steppers
  for (const box of $$('#operator .stepper[data-setting]')) {
    const key = box.dataset.setting;
    const rule = RULES[key];
    const unit = box.dataset.unit || '';
    box.innerHTML = '';
    const minus = button('−', `Decrease ${key}`);
    const out = document.createElement('output');
    const plus = button('+', `Increase ${key}`);
    const render = () => {
      out.textContent = formatNumber(settings[key]) + unit;
      minus.disabled = settings[key] <= rule.min;
      plus.disabled = settings[key] >= rule.max;
    };
    minus.addEventListener('click', () => {
      setSetting(key, round(settings[key] - rule.step));
      render();
    });
    plus.addEventListener('click', () => {
      setSetting(key, round(settings[key] + rule.step));
      render();
    });
    box.append(minus, out, plus);
    box._render = render;
    render();
  }

  // segmented choices
  for (const seg of $$('#operator .seg[data-setting]')) {
    const key = seg.dataset.setting;
    const render = () => {
      for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.value === settings[key]));
    };
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-value]');
      if (!b) return;
      setSetting(key, b.dataset.value);
      render();
    });
    seg._render = render;
    render();
  }

  // camera picker
  el.camera.addEventListener('change', onCameraPicked);

  // counter
  el.sheetsMinus.addEventListener('click', () => {
    addSheets(-1);
    refreshStatus();
  });
  confirmTap(el.sheetsReset, 'Tap again', () => {
    resetSheets();
    refreshStatus();
  });

  // printing
  guardTap(el.testPrint, async () => {
    toast('Preparing test print…');
    try {
      await api.testPrint();
      toast('Test print sent');
    } catch (e) {
      log.error('test print failed', e);
      toast('Test print failed');
    }
    refreshStatus();
  });
  confirmTap(el.clear, 'Tap again to delete all', async () => {
    try {
      await clearSessions();
      toast('Saved sheets deleted');
    } catch (e) {
      log.error('clear failed', e);
      toast('Could not delete');
    }
    renderSessions();
  });

  el.fullscreen.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', renderFullscreenLabel);
  document.addEventListener('webkitfullscreenchange', renderFullscreenLabel);
  el.reload.addEventListener('click', () => location.reload());

  bindCorner();
  renderFullscreenLabel();
}

export function isOperatorOpen() {
  return isOpen;
}

export function openOperator() {
  if (isOpen) return;
  isOpen = true;
  el.root.hidden = false;
  if (api.onOpen) api.onOpen();
  for (const n of $$('#operator [data-setting]')) {
    if (n._render) n._render();
    if (n.matches('input.switch')) n.checked = !!settings[n.dataset.setting];
  }
  refreshCameras();
  renderSessions();
  refreshStatus();
  refreshTimer = setInterval(refreshStatus, 1000);
  el.root.querySelector('.op-panel').focus({ preventScroll: true });
}

export function closeOperator() {
  if (!isOpen) return;
  isOpen = false;
  el.root.hidden = true;
  clearInterval(refreshTimer);
  revokeThumbs();
  if (api.onClose) api.onClose();
}

/* ---------------- camera ---------------- */

export async function refreshCameras(cams) {
  if (!el.camera) return;
  lastCams = cams || (await api.camera.listCameras());
  const sel = el.camera;
  sel.textContent = '';
  addOption(sel, '', 'Automatic');
  lastCams.forEach((c, i) => addOption(sel, c.deviceId, c.label || `Camera ${i + 1}`));
  if (settings.cameraId && !lastCams.some((c) => c.deviceId === settings.cameraId)) {
    addOption(sel, settings.cameraId, `${settings.cameraLabel || 'Saved camera'} (not connected)`);
  }
  sel.value = settings.cameraId || '';
  refreshStatus();
}

async function onCameraPicked() {
  const id = el.camera.value;
  const cam = lastCams.find((c) => c.deviceId === id);
  setSetting('cameraId', id);
  setSetting('cameraLabel', id ? (cam && cam.label) || settings.cameraLabel : '');
  el.cameraStatus.textContent = 'Switching camera…';
  if (id) await api.connectCamera({ deviceId: id, label: settings.cameraLabel, strict: true });
  else await api.connectCamera({ deviceId: '', label: '' });
  refreshCameras();
}

/* ---------------- status ---------------- */

function refreshStatus() {
  if (!isOpen) return;
  const state = api.getState();
  const cam = api.camera;
  if (cam.running) {
    const i = cam.info();
    let text = `${i.label || 'Camera'} · ${i.width}×${i.height}`;
    if (settings.cameraId && i.deviceId && i.deviceId !== settings.cameraId) text += ' · chosen camera not found, using this one';
    el.cameraStatus.textContent = text;
  } else {
    el.cameraStatus.textContent = state.cameraError ? `Not connected (${state.cameraError})` : 'Connecting…';
  }
  el.cameraStatus.title = el.cameraStatus.textContent; // full name if it is cut off
  const n = sheetsSent();
  el.sheets.textContent = String(n);
  el.pack.textContent = `/ ${CONFIG.paperPack}`;
  el.info.textContent = api.info();
  if (el.log.closest('details').open) {
    el.log.textContent = log
      .entries()
      .map((e) => `${e.t.toLocaleTimeString()} ${e.level === 'info' ? '' : e.level.toUpperCase() + ' '}${e.text}`)
      .reverse()
      .join('\n');
  }
}

/* ---------------- saved sheets ---------------- */

function revokeThumbs() {
  for (const u of thumbUrls) URL.revokeObjectURL(u);
  thumbUrls = [];
}

export async function renderSessions() {
  if (!isOpen) return;
  let list;
  try {
    list = await listSessions();
  } catch (e) {
    log.warn('saved sheets unavailable', e);
    el.sessions.innerHTML = '<p class="op-note">Saved sheets are not available on this device.</p>';
    return;
  }
  revokeThumbs();
  el.sessions.textContent = '';
  if (!list.length) {
    el.sessions.innerHTML = '<p class="op-note">Printed sheets appear here for reprinting.</p>';
    return;
  }
  for (const s of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'op-session';
    b.dataset.id = String(s.id);
    const img = document.createElement('img');
    img.alt = '';
    const url = URL.createObjectURL(s.thumbBlob || s.sheetBlob);
    thumbUrls.push(url);
    img.src = url;
    const cap = document.createElement('span');
    const timeText = new Date(s.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    cap.textContent = timeText;
    b.append(img, cap);
    let armed = null;
    b.addEventListener('click', async () => {
      if (!armed) {
        b.classList.add('armed');
        cap.textContent = 'Tap to print';
        armed = setTimeout(() => {
          armed = null;
          b.classList.remove('armed');
          cap.textContent = timeText;
        }, 3000);
        return;
      }
      clearTimeout(armed);
      armed = null;
      b.classList.remove('armed');
      cap.textContent = timeText;
      if (b.disabled) return;
      b.disabled = true;
      setTimeout(() => (b.disabled = false), 3000);
      try {
        await api.reprint(s);
        toast('Reprint sent');
      } catch (e) {
        log.error('reprint failed', e);
        toast('Reprint failed');
      }
      refreshStatus();
    });
    el.sessions.appendChild(b);
  }
}

/* ---------------- helpers ---------------- */

function button(text, label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.setAttribute('aria-label', label);
  return b;
}

function addOption(sel, value, text) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  sel.appendChild(o);
}

function round(v) {
  return Math.round(v * 100) / 100;
}

function formatNumber(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

let toastTimer = null;
function toast(text) {
  el.toast.textContent = text;
  el.toast.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('on'), 2500);
}

// Destructive actions need a second tap within 3 s.
function confirmTap(btn, armedText, action) {
  const original = btn.textContent;
  let timer = null;
  btn.addEventListener('click', () => {
    if (!timer) {
      btn.textContent = armedText;
      btn.classList.add('armed');
      timer = setTimeout(reset, 3000);
      return;
    }
    reset();
    action();
  });
  function reset() {
    clearTimeout(timer);
    timer = null;
    btn.textContent = original;
    btn.classList.remove('armed');
  }
}

// Ignore repeated taps for a few seconds (no double print jobs).
function guardTap(btn, action) {
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    const t = setTimeout(() => (btn.disabled = false), 4000);
    try {
      await action();
    } finally {
      setTimeout(() => {
        clearTimeout(t);
        btn.disabled = false;
      }, 3000);
    }
  });
}

function toggleFullscreen() {
  const d = document;
  const root = d.documentElement;
  try {
    if (d.fullscreenElement || d.webkitFullscreenElement) {
      (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    } else {
      const req = root.requestFullscreen || root.webkitRequestFullscreen;
      const p = req && req.call(root, { navigationUI: 'hide' });
      if (p && p.catch) p.catch((e) => toast('Full screen not allowed: ' + e.message));
    }
  } catch (e) {
    toast('Full screen not available');
  }
}

function renderFullscreenLabel() {
  if (!el.fullscreen) return;
  const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
  el.fullscreen.textContent = on ? 'Exit full screen' : 'Full screen';
}

function bindCorner() {
  const c = el.corner;
  if (!c) return;
  let timer = null;
  const clear = () => {
    clearTimeout(timer);
    timer = null;
    c.classList.remove('holding');
  };
  c.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    clear();
    try {
      c.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    c.classList.add('holding');
    timer = setTimeout(() => {
      clear();
      openOperator();
    }, 2000);
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) c.addEventListener(ev, clear);
  c.addEventListener('contextmenu', (e) => e.preventDefault());
}
