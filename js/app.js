// STKEYCLUB Photo Booth – main flow.
import { CONFIG } from '../config.js';
import { settings, setSetting, onSettingsChange } from './settings.js';
import { Camera, classifyError } from './camera.js';
import { loadFrame } from './frame.js';
import { cropFromVideo, composeStrip, composeSheet } from './compose.js';
import * as sound from './sound.js';
import { initPrint, applyPageSize, printBlob, setPrintImage, lockRemainingMs, startLock, clearLock, addSheets, sheetsSent } from './print.js';
import { initOperator, openOperator, closeOperator, isOperatorOpen, refreshCameras, renderSessions } from './operator.js';
import { saveSession } from './store.js';
import { makeSamplePhotos, addEdgeGuides } from './testprint.js';
import { FILTERS, filteredDrawer, filterOptions, canvasFilterSupported } from './filters.js';
import { $, makeCanvas, makeToken, wait, Cancelled, canvasToBlob, downloadBlob, timestamp, debounce, log } from './util.js';

const el = {
  app: $('#app'),
  loadingText: $('#loading-text'),
  loadingActions: $('#loading-actions'),
  booth: $('#booth'),
  viewfinder: $('#viewfinder'),
  video: $('#video'),
  shot: $('#shot'),
  vfFrame: $('#vf-frame'),
  countdown: $('#countdown'),
  startBtn: $('#start-btn'),
  progress: $('#progress'),
  sequence: $('#sequence'),
  instruction: $('#instruction'),
  vfFlash: $('#vf-flash'),
  stripWrap: $('#strip-wrap'),
  review: $('#review'),
  strip: $('#strip'),
  holeButtons: $('#hole-buttons'),
  printBtn: $('#print-btn'),
  printLabel: $('#print-btn .label'),
  printing: $('#printing'),
  filtersBtn: $('#filters-btn'),
  filtersDone: $('#filters-done'),
  filterList: $('#filter-list'),
  retakeBtn: $('#retake-btn'),
  retakeLabel: $('#retake-btn .label'),
  downloadBtn: $('#download-btn'),
  restartBtn: $('#restart-btn'),
  reviewLead: $('#review-lead'),
  reviewSub: $('#review-sub'),
  reviewHint: $('#review-hint'),
  idleHint: $('#idle-hint'),
  msgTitle: $('#msg-title'),
  msgText: $('#msg-text'),
  msgRetry: $('#msg-retry'),
  msgSettings: $('#msg-settings'),
  flash: $('#flash'),
};

const state = {
  screen: 'loading',
  phase: 'idle', // booth phase: idle | countdown | shot
  frame: null,
  photos: [], // full-resolution crops (canvases), one per hole
  filter: 'none',
  seq: null, // cancel token of the running capture sequence
  seqMode: null, // 'session' | 'retake'
  retakeMode: false,
  cameraError: null,
  lostDevice: null,
  returnTo: null,
  connecting: false,
  stallRestarts: [],
  prep: null, // Promise<{ strip, sheet, sheetBlob }> for the current photos
  printing: false,
  pendingSwitch: false, // switch back to the chosen camera when the booth is idle
  pendingReload: false, // a new version was installed; reload when the booth is idle
  version: '',
  lastActivity: Date.now(),
};

const camera = new Camera(el.video);
const RETAKE_LABEL = '<span>Retake</span>';
const FLY_MS = 450; // a photo flying from the mirror into its frame
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n) => WORDS[n] || String(n);
const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

const MESSAGES = {
  denied: { title: 'Camera blocked', text: 'Allow camera access for this site in Chrome’s site settings, then tap Retry.', button: 'Retry' },
  notfound: { title: 'No camera found', text: 'Plug in the camera. The booth starts as soon as it appears.' },
  lost: { title: 'Camera disconnected', text: 'Plug it back in and the booth reconnects by itself. Reconnect uses any available camera.' },
  busy: { title: 'Camera in use', text: 'Close any other app or tab using the camera, then tap Reconnect.' },
  timeout: { title: 'Camera not responding', text: 'Unplug the camera, plug it back in, then tap Reconnect.' },
  frozen: { title: 'Camera stopped', text: 'The camera stopped sending video. Check the cable, then tap Reconnect.' },
  capture: { title: 'Photo failed', text: 'The camera didn’t return a picture. Tap Reconnect to try again.' },
  insecure: { title: 'Camera needs HTTPS', text: 'Open the booth’s https:// address.', button: 'Retry' },
  unknown: { title: 'Camera problem', text: 'Tap Reconnect. If it keeps happening, reload the booth.' },
};

const pct = (v, total) => `${((v / total) * 100).toFixed(4)}%`;

/* ---------------- screens ---------------- */

let loadingTimer = null;

function showScreen(name) {
  if (name !== state.screen) clearFlash();
  state.screen = name;
  el.app.dataset.screen = name;
  // Never a dead end: if loading takes long, offer Retry and Settings.
  clearTimeout(loadingTimer);
  el.loadingActions.hidden = true;
  if (name === 'loading') loadingTimer = setTimeout(() => (el.loadingActions.hidden = false), 8000);
  if (name === 'booth') {
    camera.resetWatchdog();
    const p = el.video.play();
    if (p && p.catch) p.catch(() => {});
  }
}

function setPhase(p) {
  state.phase = p;
  el.booth.dataset.phase = p;
  camera.resetWatchdog();
}

function setLoading(text) {
  el.loadingText.textContent = text;
}

function photosComplete() {
  return state.photos.length === CONFIG.shots && state.photos.every(Boolean);
}

/* ---------------- frame + viewfinder ---------------- */

function applyFrame() {
  const f = state.frame;
  document.documentElement.style.setProperty('--frame-ar', `${f.width} / ${f.height}`);
  el.booth.style.setProperty('--hole-ar', (f.holes[0].w / f.holes[0].h).toFixed(5));
  if (f.source !== 'file') el.vfFrame.src = f.image.src;
  buildHoleButtons();
  setViewfinderHole(0, false);
  buildSequence();
  renderSequence();
}

// Show hole i in the viewfinder: the live video fills the hole (plus bleed)
// exactly like the final composite, the frame sits on top, and the view is
// cropped to the hole. Everything is in percentages of the hole, so it stays
// correct at any screen size.
function setViewfinderHole(i, slide) {
  const f = state.frame;
  if (!f) return;
  const h = f.holes[i];
  const b = f.photoBoxes[i];
  el.viewfinder.style.setProperty('--ar', (h.w / h.h).toFixed(5));
  for (const node of [el.video, el.shot]) {
    node.style.left = pct(b.x - h.x, h.w);
    node.style.top = pct(b.y - h.y, h.h);
    node.style.width = pct(b.w, h.w);
    node.style.height = pct(b.h, h.h);
  }
  el.vfFrame.classList.toggle('slide', !!slide);
  el.vfFrame.style.left = pct(-h.x, h.w);
  el.vfFrame.style.top = pct(-h.y, h.h);
  el.vfFrame.style.width = pct(f.width, h.w);
  el.vfFrame.style.height = pct(f.height, h.h);
}

// The four frames in the panel: each shows exactly what lands in that hole of
// the strip (frame artwork included), so the strip visibly fills up.
function buildSequence() {
  el.sequence.textContent = '';
  state.frame.holes.forEach((h, i) => {
    const li = document.createElement('li');
    li.className = 'frame';
    li.dataset.index = String(i);
    li.setAttribute('aria-label', `Photo ${i + 1}`);
    li.appendChild(document.createElement('canvas'));
    el.sequence.appendChild(li);
  });
}

function renderSequence() {
  const f = state.frame;
  if (!f || !el.sequence.children.length) return;
  const items = el.sequence.children;
  const cssW = items[0].clientWidth || 120;
  const scale = Math.min(1, (cssW * Math.min(2, window.devicePixelRatio || 1)) / f.holes[0].w);
  const strip = state.photos.some(Boolean)
    ? composeStrip(f, state.photos, { scale, drawPhoto: filteredDrawer(state.filter) })
    : null;
  f.holes.forEach((h, i) => {
    const li = items[i];
    const c = li.firstChild;
    const filled = !!(strip && state.photos[i]);
    li.classList.toggle('filled', filled);
    if (!filled) {
      c.width = 1;
      c.height = 1;
      c.getContext('2d').clearRect(0, 0, 1, 1);
      return;
    }
    c.width = Math.max(1, Math.round(h.w * scale));
    c.height = Math.max(1, Math.round(h.h * scale));
    c.getContext('2d').drawImage(strip, h.x * scale, h.y * scale, h.w * scale, h.h * scale, 0, 0, c.width, c.height);
  });
}

function markSequence(i) {
  Array.from(el.sequence.children).forEach((li, k) => li.classList.toggle('current', k === i));
}

function setProgress(main, sub) {
  el.progress.textContent = main || '';
  if (sub) {
    const small = document.createElement('small');
    small.textContent = sub;
    el.progress.appendChild(small);
  }
}

// The frozen photo shrinks from the mirror into its frame in the panel.
async function flyToFrame(i, photo, token) {
  const target = el.sequence.children[i];
  const from = el.viewfinder.getBoundingClientRect();
  const to = target ? target.getBoundingClientRect() : null;
  if (!to || !to.width || !from.width || reducedMotion() || typeof el.app.animate !== 'function') {
    hideShot();
    renderSequence();
    return;
  }
  const c = document.createElement('canvas');
  c.width = Math.min(720, photo.width);
  c.height = Math.max(1, Math.round((c.width * photo.height) / photo.width));
  c.getContext('2d').drawImage(photo, 0, 0, c.width, c.height);
  c.className = 'flyer';
  c.style.left = `${from.left}px`;
  c.style.top = `${from.top}px`;
  c.style.width = `${from.width}px`;
  c.style.height = `${from.height}px`;
  el.app.appendChild(c);
  hideShot();
  const anim = c.animate(
    [
      { transform: 'translate(0px, 0px) scale(1, 1)' },
      { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})` },
    ],
    { duration: FLY_MS, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)', fill: 'forwards' }
  );
  const off = token ? token.onCancel(() => anim.cancel()) : null;
  try {
    await anim.finished;
  } catch {
    /* cancelled */
  }
  if (off) off();
  renderSequence();
  c.remove();
}

function buildHoleButtons() {
  const f = state.frame;
  el.holeButtons.textContent = '';
  f.holes.forEach((h, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hole-btn';
    b.dataset.index = String(i);
    b.setAttribute('aria-label', `Retake photo ${i + 1}`);
    b.style.left = pct(h.x, f.width);
    b.style.top = pct(h.y, f.height);
    b.style.width = pct(h.w, f.width);
    b.style.height = pct(h.h, f.height);
    b.innerHTML = RETAKE_LABEL;
    b.addEventListener('click', () => retake(i));
    el.holeButtons.appendChild(b);
  });
}

/* ---------------- capture flow ---------------- */

function showCount(n) {
  const c = el.countdown;
  c.textContent = n ? String(n) : '';
  c.classList.remove('pop');
  if (n) {
    void c.offsetWidth; // restart the animation
    c.classList.add('pop');
  }
}

// Bright in the picture, a softer glow on the rest of the screen.
function flash() {
  for (const f of [el.vfFlash, el.flash]) {
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
  }
}

// A finished flash must not stay armed: CSS restarts an animation when its screen
// is shown again, which would flash the mirror on the way back to the start.
function clearFlash() {
  for (const f of [el.vfFlash, el.flash]) f.classList.remove('go');
}
for (const f of [el.vfFlash, el.flash]) f.addEventListener('animationend', () => f.classList.remove('go'));

function showShot(photo) {
  const c = el.shot;
  c.width = photo.width;
  c.height = photo.height;
  c.getContext('2d').drawImage(photo, 0, 0);
  el.viewfinder.classList.add('show-shot');
}

function hideShot() {
  el.viewfinder.classList.remove('show-shot');
}

function cancelSequence() {
  if (state.seq) state.seq.cancel();
}

async function startSession() {
  if (state.screen !== 'booth' || state.phase !== 'idle') return;
  if (!camera.ready) {
    if (!camera.running) showCameraError('lost');
    return;
  }
  sound.unlockAudio();
  state.photos = new Array(CONFIG.shots).fill(null);
  state.filter = 'none';
  renderSequence();
  const ok = await runShots(state.photos.map((_, i) => i), 'session');
  if (ok) showReview();
  else if (state.screen === 'booth') goIdle();
}

// Countdown + capture for each hole index. Resolves true when all shots were
// taken, false when cancelled (camera lost, operator menu, ...).
async function runShots(indices, mode) {
  cancelSequence();
  const token = makeToken();
  state.seq = token;
  state.seqMode = mode;
  showScreen('booth');
  try {
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      hideShot();
      setViewfinderHole(i, false);
      markSequence(i);
      setProgress(mode === 'retake' ? `Retaking photo ${i + 1}` : `Photo ${i + 1} of ${CONFIG.shots}`, 'Look at the camera');
      setPhase('countdown');
      for (let n = settings.countdown; n >= 1; n--) {
        showCount(n);
        if (settings.sound) sound.tick();
        await wait(1000, token);
      }
      showCount('');
      if (!camera.ready) throw new Error('camera not ready');
      const photo = cropFromVideo(el.video, state.frame.photoBoxes[i], settings.mirrorPhoto);
      if (settings.flash) flash();
      if (settings.sound) sound.shutter();
      state.photos[i] = photo;
      showShot(photo);
      setPhase('shot');
      const last = k === indices.length - 1;
      setProgress(mode === 'retake' ? `Photo ${i + 1} retaken` : `Photo ${i + 1} of ${CONFIG.shots}`, last ? 'All done' : 'Get ready for the next one');
      await wait(Math.max(300, settings.pause * 1000 - FLY_MS), token);
      await flyToFrame(i, photo, token);
    }
    return true;
  } catch (e) {
    if (e instanceof Cancelled) return false;
    log.error('capture failed', e);
    if (mode === 'retake') state.returnTo = 'review';
    if (state.seq === token) state.seq = null;
    showCameraError(camera.running ? 'capture' : 'lost');
    return false;
  } finally {
    if (state.seq === token) state.seq = null;
    showCount('');
    markSequence(-1);
  }
}

function goIdle() {
  cancelSequence();
  state.photos = [];
  state.filter = 'none';
  state.returnTo = null;
  setRetakeMode(false);
  setFiltersOpen(false);
  if (!camera.running) {
    showCameraError(state.cameraError || 'lost', true);
    return;
  }
  hideShot();
  showScreen('booth');
  setPhase('idle');
  setViewfinderHole(0, false);
  markSequence(-1);
  setProgress('', '');
  renderSequence();
  if (state.pendingReload && reloadIfIdle()) return;
  if (state.pendingSwitch && !isOperatorOpen()) {
    state.pendingSwitch = false;
    connectCamera();
  }
}

/* ---------------- review ---------------- */

function showReview() {
  hideShot();
  state.returnTo = null;
  setRetakeMode(false);
  setFiltersOpen(false);
  showScreen('review');
  setPhase('idle');
  refreshResult();
  dispenseStrip();
  hint('');
  state.lastActivity = Date.now();
  el.idleHint.textContent = '';
  updatePrintButton();
}

// The strip comes out of the slot like a fresh print...
function dispenseStrip() {
  const s = el.stripWrap;
  s.classList.remove('dispensing', 'retracting');
  void s.offsetWidth;
  s.classList.add('dispensing');
}

// ...and goes back in when it is sent to the printer.
function retractStrip() {
  return new Promise((resolve) => {
    if (reducedMotion() || state.screen !== 'review') {
      resolve();
      return;
    }
    const s = el.stripWrap;
    s.classList.remove('dispensing');
    void s.offsetWidth;
    s.classList.add('retracting');
    setTimeout(resolve, 460);
  });
}

// Re-render the strip and get the print sheet ready in the background, so
// Print opens the dialog right away.
function refreshResult() {
  composeStrip(state.frame, state.photos, { canvas: el.strip, drawPhoto: filteredDrawer(state.filter) });
  state.prep = prepareSheet();
  state.prep.catch((e) => log.error('could not prepare the sheet', e));
}

async function prepareSheet() {
  const strip = composeStrip(state.frame, state.photos, { drawPhoto: filteredDrawer(state.filter) });
  const sheet = composeSheet(strip, { inset: settings.printInset });
  const sheetBlob = await canvasToBlob(sheet);
  return { strip, sheet, sheetBlob };
}

let hintTimer = null;
function hint(text, ms = 0) {
  clearTimeout(hintTimer);
  el.reviewHint.textContent = text;
  if (ms) hintTimer = setTimeout(() => (el.reviewHint.textContent = ''), ms);
}

// While choosing a photo to retake, everything but Cancel steps back.
function setRetakeMode(on) {
  state.retakeMode = !!on;
  el.review.classList.toggle('retake-mode', state.retakeMode);
  el.retakeLabel.textContent = state.retakeMode ? 'Cancel' : 'Retake a photo';
  for (const b of [el.printBtn, el.filtersBtn, el.downloadBtn, el.restartBtn]) b.inert = state.retakeMode;
  renderReviewCopy();
}

// The line above the buttons says what this screen is for right now.
function renderReviewCopy() {
  const [lead, sub] = state.retakeMode
    ? ['Retake a photo', 'Tap the photo you want to take again.']
    : el.review.classList.contains('filters-open')
      ? ['Filters', 'Pick a look for all four photos.']
      : ['Your strip', 'Prints two copies in about a minute.'];
  if (el.reviewLead.textContent !== lead) el.reviewLead.textContent = lead;
  if (el.reviewSub.textContent !== sub) el.reviewSub.textContent = sub;
}

/* ---------------- filters ---------------- */

function setFiltersOpen(open) {
  const on = !!open && settings.filters && state.screen === 'review';
  el.review.classList.toggle('filters-open', on);
  if (on) {
    setRetakeMode(false);
    renderFilterList();
  }
  renderReviewCopy();
}

// The strip itself is the preview, so the choices are just their names.
function renderFilterList() {
  el.filterList.textContent = '';
  for (const f of FILTERS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'filter-item';
    b.dataset.filter = f.id;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(f.id === state.filter));
    b.textContent = f.label;
    b.addEventListener('click', () => chooseFilter(f.id));
    el.filterList.appendChild(b);
  }
}

function chooseFilter(id) {
  if (state.filter === id) return;
  state.filter = id;
  for (const b of el.filterList.children) b.setAttribute('aria-checked', String(b.dataset.filter === id));
  refreshResult();
}

async function retake(i) {
  if (!state.retakeMode || state.screen !== 'review') return;
  setRetakeMode(false);
  if (!camera.ready) {
    state.returnTo = 'review';
    showCameraError(camera.running ? 'timeout' : 'lost', true);
    return;
  }
  sound.unlockAudio();
  await runShots([i], 'retake');
  if (state.screen === 'booth') showReview();
}

let downloading = false;
async function downloadFiles() {
  if (downloading || !photosComplete()) return;
  downloading = true;
  try {
    const { strip, sheetBlob } = await (state.prep || prepareSheet());
    const stripBlob = await canvasToBlob(strip);
    const ts = timestamp();
    downloadBlob(stripBlob, `stkeyclub-${ts}-strip.png`);
    downloadBlob(sheetBlob, `stkeyclub-${ts}-sheet.png`);
    hint('Saved to Downloads', 4000);
  } catch (e) {
    log.error('download failed', e);
    hint('Download failed', 4000);
  } finally {
    downloading = false;
  }
}

/* ---------------- printing ---------------- */

async function printNow() {
  if (state.screen !== 'review' || !photosComplete() || state.printing) return;
  if (lockRemainingMs() > 0) return;
  // Lock first, synchronously, so a second tap can never send another job.
  state.printing = true;
  startLock();
  updatePrintButton();
  try {
    const prep = await (state.prep || prepareSheet());
    storeSheet(prep); // in the background; never delays printing
    await retractStrip();
    await printBlob(prep.sheetBlob); // returns when the print dialog closes
    addSheets(1);
    log.info(`print: sheet ${sheetsSent()}`);
    showPrinting();
  } catch (e) {
    log.error('print failed', e);
    clearLock();
    if (state.screen === 'review') dispenseStrip();
    hint('Could not print – try again', 5000);
  } finally {
    state.printing = false;
    updatePrintButton();
  }
}

async function storeSheet(prep) {
  try {
    const t = makeCanvas(160, 240);
    const tx = t.getContext('2d');
    tx.imageSmoothingQuality = 'high';
    tx.drawImage(prep.sheet, 0, 0, t.width, t.height);
    const thumbBlob = await canvasToBlob(t, 'image/jpeg', 0.82);
    await saveSession({ sheetBlob: prep.sheetBlob, thumbBlob });
    if (isOperatorOpen()) renderSessions();
  } catch (e) {
    log.warn('could not save the sheet for reprinting', e);
  }
}

// Operator prints skip the guest print lock but restart it.
async function operatorPrint(blob) {
  startLock();
  await printBlob(blob);
  addSheets(1);
  updatePrintButton();
}

async function testPrint() {
  const photos = makeSamplePhotos(state.frame);
  const strip = composeStrip(state.frame, photos);
  const sheet = addEdgeGuides(composeSheet(strip, { inset: settings.printInset }));
  const blob = await canvasToBlob(sheet);
  log.info('test print');
  await operatorPrint(blob);
}

async function reprint(session) {
  log.info(`reprint of sheet #${session.id}`);
  await operatorPrint(session.sheetBlob);
}

let printingTimer = null;
function showPrinting() {
  setRetakeMode(false);
  showScreen('printing');
  clearTimeout(printingTimer);
  printingTimer = setTimeout(leavePrinting, CONFIG.printingScreenMs);
}

function leavePrinting() {
  clearTimeout(printingTimer);
  if (state.screen === 'printing') goIdle();
}

function updatePrintButton() {
  const ms = lockRemainingMs();
  const locked = ms > 0 || state.printing;
  el.printBtn.disabled = locked;
  el.printLabel.textContent = ms > 0 ? `Ready in ${Math.ceil(ms / 1000)}s` : 'Print';
}

/* ---------------- camera lifecycle ---------------- */

let connectSeq = 0;

async function connectCamera({ strict = false, quiet = false, deviceId, label } = {}) {
  const my = ++connectSeq;
  state.connecting = true;
  if (!quiet && state.screen !== 'review' && state.screen !== 'printing') {
    setLoading('Starting camera…');
    showScreen('loading');
  }
  try {
    const info = await camera.start({
      deviceId: deviceId ?? settings.cameraId,
      label: label ?? settings.cameraLabel,
      strict,
      onPrompt: () => setLoading('Allow camera access to start'),
    });
    if (my !== connectSeq) return false;
    if (info.autoPicked && info.deviceId) {
      setSetting('cameraId', info.deviceId);
      setSetting('cameraLabel', info.label);
    } else if (settings.cameraLabel && info.label === settings.cameraLabel && info.deviceId && info.deviceId !== settings.cameraId) {
      setSetting('cameraId', info.deviceId); // same camera, new id (ids can change between visits)
    }
    log.info(`camera on: ${info.label || 'default camera'} ${info.width}x${info.height}`);
    state.cameraError = null;
    state.lostDevice = null;
    afterCameraReady();
    return true;
  } catch (e) {
    const kind = classifyError(e);
    if (my !== connectSeq || kind === 'superseded') return false;
    log.warn('camera start failed:', kind, e.cause || e.message);
    if (!quiet || state.screen === 'loading') showCameraError(kind);
    return false;
  } finally {
    if (my === connectSeq) state.connecting = false;
  }
}

function afterCameraReady() {
  if (state.screen === 'review' || state.screen === 'printing') return; // guests are busy; the camera is back for later
  const back = state.returnTo;
  state.returnTo = null;
  if (back === 'review' && photosComplete()) showReview();
  else goIdle();
}

// force: show it even if guests are on the review/printing screen.
function showCameraError(kind, force = false) {
  state.cameraError = kind;
  cancelSequence();
  if (!force && (state.screen === 'review' || state.screen === 'printing')) {
    log.warn(`camera problem (${kind}); shown after the guests are done`);
    return;
  }
  const m = MESSAGES[kind] || MESSAGES.unknown;
  el.msgTitle.textContent = m.title;
  el.msgText.textContent = m.text;
  el.msgRetry.textContent = m.button || 'Reconnect';
  showScreen('message');
  scheduleAutoRetry();
}

let retryTimer = null;
const AUTO_RETRY = ['lost', 'notfound', 'busy', 'timeout', 'frozen', 'capture', 'unknown'];

// While a camera message is showing, keep trying quietly. After an unplug we
// only reconnect the same camera; Reconnect (manual) may use any camera.
function scheduleAutoRetry(delay = 3000) {
  clearTimeout(retryTimer);
  if (!AUTO_RETRY.includes(state.cameraError)) return;
  retryTimer = setTimeout(async () => {
    if (state.screen !== 'message' || !AUTO_RETRY.includes(state.cameraError)) return;
    if (state.connecting) {
      scheduleAutoRetry();
      return;
    }
    const lost = state.lostDevice || {};
    const deviceId = settings.cameraId || lost.deviceId || '';
    const label = settings.cameraLabel || lost.label || '';
    const strict = state.cameraError !== 'notfound' && !!(deviceId || label);
    const ok = await connectCamera({ strict, quiet: true, deviceId, label });
    if (!ok && state.screen === 'message') scheduleAutoRetry();
  }, delay);
}

// Faster recovery than polling: react when cameras are plugged in or out.
async function onDeviceChange() {
  const cams = await camera.listCameras();
  log.info(`devices changed: ${cams.length} camera(s)`);
  if (isOperatorOpen()) refreshCameras(cams);
  if (camera.track && camera.track.readyState === 'ended') {
    camera.markLost('ended');
    return;
  }
  if (camera.running) {
    const chosen = settings.cameraId;
    if (chosen && camera.deviceId !== chosen && cams.some((c) => c.deviceId === chosen)) {
      log.info('chosen camera is back');
      if (state.screen === 'booth' && state.phase === 'idle' && !isOperatorOpen()) connectCamera();
      else state.pendingSwitch = true;
    }
    return;
  }
  if (state.screen === 'message' && AUTO_RETRY.includes(state.cameraError)) {
    clearTimeout(retryTimer);
    retryTimer = null;
    scheduleAutoRetry(300);
  } else if (state.screen === 'review' || state.screen === 'printing') {
    reconnectInBackground();
  }
}

// Camera came back (or may have) while guests are on the review screen:
// reconnect quietly so the booth is ready when they finish.
function reconnectInBackground() {
  if (camera.running || state.connecting) return;
  const lost = state.lostDevice || {};
  const deviceId = settings.cameraId || lost.deviceId || '';
  const label = settings.cameraLabel || lost.label || '';
  connectCamera({ strict: !!(deviceId || label), quiet: true, deviceId, label });
}

function onCameraLost(e) {
  log.warn('camera lost:', e.detail && e.detail.reason);
  state.lostDevice = { deviceId: camera.deviceId, label: camera.label };
  if (state.screen === 'review' || state.screen === 'printing') {
    state.cameraError = 'lost'; // tell them after the guests are done
    setTimeout(reconnectInBackground, 1500);
    return;
  }
  if (state.seq && state.seqMode === 'retake') state.returnTo = 'review';
  showCameraError('lost');
}

// A camera that is "connected" but sends no frames would silently produce
// identical photos, so treat a stalled stream like a disconnect.
function watchdog() {
  if (document.visibilityState !== 'visible' || state.screen !== 'booth' || state.phase === 'shot' || !camera.running) {
    camera.resetWatchdog();
    return;
  }
  if (camera.msSinceFrame() < CONFIG.camera.frozenAfterMs) return;
  const now = Date.now();
  state.stallRestarts = state.stallRestarts.filter((t) => now - t < 60000);
  camera.resetWatchdog();
  if (state.stallRestarts.length >= 2) {
    log.error('camera stalled repeatedly');
    camera.stop();
    showCameraError('frozen');
    return;
  }
  state.stallRestarts.push(now);
  log.warn('camera stalled, restarting it');
  if (state.seq && state.seqMode === 'retake') state.returnTo = 'review';
  cancelSequence();
  connectCamera({ deviceId: camera.deviceId, label: camera.label });
}

// Review screen: start over after a while with no activity (guests walked away).
function idleCheck() {
  if (state.screen !== 'review' || isOperatorOpen() || state.printing) {
    if (el.idleHint.textContent) el.idleHint.textContent = '';
    return;
  }
  const left = settings.idleReset * 1000 - (Date.now() - state.lastActivity);
  if (left <= 0) {
    log.info('idle: back to start');
    el.idleHint.textContent = '';
    goIdle();
    return;
  }
  el.idleHint.textContent = left <= 10000 ? `Starting over in ${Math.ceil(left / 1000)}…` : '';
}

function onOperatorOpen() {
  // The operator always wins: stop any capture in progress.
  if (state.seq) {
    if (state.seqMode === 'retake') state.returnTo = 'review';
    cancelSequence();
  }
}

function onOperatorClose() {
  state.lastActivity = Date.now();
  if (state.pendingReload && reloadIfIdle()) return;
  if (state.screen === 'booth' && state.phase === 'idle' && state.pendingSwitch) goIdle();
}

function frameInfo() {
  const f = state.frame;
  if (!f) return '';
  const holes = f.holeSource === 'detected' ? 'holes detected' : 'holes from config.js';
  const src = f.source === 'file' ? 'frame.png' : 'PLAIN FRAME (frame.png missing)';
  const offline = state.version ? `offline ready (${state.version})` : 'not cached for offline yet';
  return `${src} ${f.width}×${f.height} · ${holes}${f.warnings.length ? ' · ' + f.warnings.join('; ') : ''} · ${offline}`;
}

/* ---------------- offline / updates ---------------- */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let controller = navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const hadController = !!controller;
    controller = navigator.serviceWorker.controller;
    readVersion();
    if (!hadController) return; // first install: nothing to reload
    log.info('new version installed');
    state.pendingReload = true;
    reloadIfIdle();
  });
  navigator.serviceWorker
    .register('sw.js')
    .then((reg) => {
      readVersion();
      // While online, look for a new version every 30 minutes.
      setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
    })
    .catch((e) => log.warn('offline support unavailable', e));
}

async function readVersion() {
  try {
    const keys = (await caches.keys()).filter((k) => k.startsWith('stkeyclub-'));
    state.version = keys.length ? keys[keys.length - 1].replace('stkeyclub-', 'v') : '';
  } catch {
    state.version = '';
  }
}

// Reload into the new version, but only when nobody is using the booth.
function reloadIfIdle() {
  if (!state.pendingReload) return false;
  if (state.screen !== 'booth' || state.phase !== 'idle' || isOperatorOpen()) return false;
  try {
    const last = Number(sessionStorage.getItem('stkeyclub.reloadAt') || 0);
    if (Date.now() - last < 15000) return false; // never loop
    sessionStorage.setItem('stkeyclub.reloadAt', String(Date.now()));
  } catch {
    /* ignore */
  }
  log.info('reloading into the new version');
  location.reload();
  return true;
}

/* ---------------- input ---------------- */

function bindUI() {
  el.startBtn.addEventListener('click', startSession);
  el.printBtn.addEventListener('click', printNow);
  el.printing.addEventListener('click', leavePrinting);
  el.retakeBtn.addEventListener('click', () => setRetakeMode(!state.retakeMode));
  // Keyboard focus follows the pane that is showing.
  el.filtersBtn.addEventListener('click', () => {
    setFiltersOpen(true);
    const on = el.filterList.querySelector('[aria-checked="true"]');
    if (on) on.focus({ preventScroll: true });
  });
  el.filtersDone.addEventListener('click', () => {
    setFiltersOpen(false);
    el.filtersBtn.focus({ preventScroll: true });
  });
  el.downloadBtn.addEventListener('click', downloadFiles);
  el.restartBtn.addEventListener('click', goIdle);
  el.msgRetry.addEventListener('click', () => connectCamera({ strict: false }));
  el.msgSettings.addEventListener('click', openOperator);
  $('#loading-retry').addEventListener('click', () => connectCamera());
  $('#loading-settings').addEventListener('click', openOperator);

  document.addEventListener('keydown', (e) => {
    if (isOperatorOpen()) {
      if (e.key === 'Escape') closeOperator();
      return;
    }
    if (e.target && e.target.closest && e.target.closest('input, select, textarea')) return;
    if ((e.key === 'o' || e.key === 'O') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      openOperator();
      return;
    }
    if ((e.key === ' ' || e.key === 'Enter') && state.screen === 'booth') {
      e.preventDefault();
      if (!e.repeat) startSession();
      return;
    }
    if (e.key === 'Escape' && state.retakeMode) setRetakeMode(false);
    if (e.key === 'Escape') setFiltersOpen(false);
  });

  document.addEventListener('contextmenu', (e) => {
    if (!(e.target && e.target.closest && e.target.closest('input, textarea'))) e.preventDefault();
  });
  document.addEventListener('dragstart', (e) => e.preventDefault());

  camera.addEventListener('lost', onCameraLost);
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', debounce(onDeviceChange, 700));
  }
  watchPermission();
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
    document.addEventListener(ev, () => (state.lastActivity = Date.now()), { capture: true, passive: true });
  }
  setInterval(idleCheck, 250);
  setInterval(watchdog, 1000);
  setInterval(keepAwake, 30000);
  setInterval(() => {
    if (state.screen === 'review') updatePrintButton();
  }, 500);

  window.addEventListener('resize', debounce(renderSequence, 200));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      keepAwake();
      camera.resetWatchdog();
      if (state.screen === 'booth') el.video.play().catch(() => {});
    }
  });

  window.addEventListener('error', (e) => log.error('error:', e.message));
  window.addEventListener('unhandledrejection', (e) => log.error('unhandled:', e.reason));
}

// If camera access is granted later (from Chrome's site settings), start right away.
async function watchPermission() {
  try {
    const st = await navigator.permissions.query({ name: 'camera' });
    st.addEventListener('change', () => {
      log.info('camera permission:', st.state);
      if (st.state === 'granted' && state.screen === 'message') connectCamera();
    });
  } catch {
    /* not supported */
  }
}

// Copy that depends on the settings (how many seconds, how many strips).
function renderCopy() {
  const n = CONFIG.shots;
  const lead = document.createElement('span');
  lead.className = 'lead';
  lead.textContent = `${word(n).charAt(0).toUpperCase()}${word(n).slice(1)} photos`;
  el.instruction.textContent = '';
  el.instruction.append(lead, ' Look at the camera, not the screen.');
  renderReviewCopy();
}

function applySettings(key) {
  renderCopy();
  el.video.classList.toggle('mirror', settings.mirrorPreview);
  el.review.classList.toggle('no-filters', !settings.filters);
  if (!settings.filters) {
    setFiltersOpen(false);
    if (state.filter !== 'none') {
      state.filter = 'none';
      if (state.screen === 'review') refreshResult();
    }
  }
  applyPageSize();
  if (key === 'printInset' && state.screen === 'review') refreshResult();
}

// Keep the Chromebook screen on during the event.
let wakeLock = null;
async function keepAwake() {
  try {
    if (!('wakeLock' in navigator) || wakeLock || document.visibilityState !== 'visible') return;
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => (wakeLock = null));
  } catch {
    wakeLock = null;
  }
}

/* ---------------- boot ---------------- */

async function boot() {
  initPrint();
  initOperator({
    camera,
    connectCamera,
    getState: () => state,
    onOpen: onOperatorOpen,
    onClose: onOperatorClose,
    testPrint,
    reprint,
    info: frameInfo,
  });
  bindUI();
  applySettings();
  onSettingsChange(applySettings);
  window.__pbBooted = true;
  keepAwake();
  registerServiceWorker();
  setLoading('Loading…');
  state.frame = await loadFrame();
  applyFrame();
  await connectCamera();
}

// Handle for debugging and automated tests.
window.PB = {
  CONFIG,
  state,
  camera,
  settings,
  setSetting,
  log,
  actions: { startSession, goIdle, showReview, retake, setRetakeMode, downloadFiles, connectCamera, printNow, prepareSheet, setPrintImage, testPrint, openOperator, closeOperator },
  print: { lockRemainingMs, sheetsSent },
  filters: { FILTERS, filterOptions, canvasFilterSupported, chooseFilter },
  compose: { composeStrip, composeSheet, cropFromVideo },
};

boot().catch((e) => {
  log.error('boot failed', e);
  showCameraError('unknown');
});
