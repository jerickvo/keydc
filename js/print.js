// Printing through the browser: a print-only element holding one image that is
// exactly the page size, with @page size set in CSS so the paper size does not
// depend on what the operator picks in the dialog.
import { settings, readNumber, writeNumber } from './settings.js';
import { CONFIG } from '../config.js';

const COUNT_KEY = 'stkeyclub.sheetsSent';
const LOCK_KEY = 'stkeyclub.printLockUntil';


let area = null;
let img = null;
let currentBlob = null;
let currentUrl = null;

export function initPrint() {
  area = document.createElement('div');
  area.id = 'print-area';
  area.setAttribute('aria-hidden', 'true');
  img = document.createElement('img');
  img.id = 'print-img';
  img.alt = '';
  area.appendChild(img);
  document.body.appendChild(area);
  applyPageSize();
}

export function applyPageSize() {
  const p = { w: `${CONFIG.page.widthMm}mm`, h: `${CONFIG.page.heightMm}mm` };
  let st = document.getElementById('page-style');
  if (!st) {
    st = document.createElement('style');
    st.id = 'page-style';
    document.head.appendChild(st);
  }
  st.textContent = `@page { size: ${p.w} ${p.h}; margin: 0; } :root { --page-w: ${p.w}; --page-h: ${p.h}; }`;
}

// Put the sheet into the print element and wait until it is decoded, so the
// print preview never shows an empty page.
export async function setPrintImage(blob) {
  if (!img) initPrint();
  if (blob === currentBlob && img.complete && img.naturalWidth) return;
  const url = URL.createObjectURL(blob);
  const old = currentUrl;
  currentBlob = blob;
  currentUrl = url;
  img.src = url;
  try {
    await img.decode();
  } catch {
    await new Promise((resolve) => {
      if (img.complete) resolve();
      else {
        img.onload = resolve;
        img.onerror = resolve;
      }
    });
  }
  if (old) URL.revokeObjectURL(old);
}

// Opens the print dialog. In Chrome this returns when the dialog closes.
export async function printBlob(blob) {
  await setPrintImage(blob);
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 150);
  });
  window.print();
}

/* ---- print lock: stops a double tap from sending two jobs ---- */

export function lockRemainingMs() {
  const until = readNumber(LOCK_KEY, 0);
  const max = settings.printLock * 1000;
  return Math.max(0, Math.min(until - Date.now(), max)); // capped in case the clock jumped
}

export function startLock() {
  writeNumber(LOCK_KEY, Date.now() + settings.printLock * 1000);
}

export function clearLock() {
  writeNumber(LOCK_KEY, 0);
}

/* ---- sheets counter ---- */

export function sheetsSent() {
  return Math.max(0, Math.round(readNumber(COUNT_KEY, 0)));
}

export function addSheets(n = 1) {
  writeNumber(COUNT_KEY, Math.max(0, sheetsSent() + n));
}

export function resetSheets() {
  writeNumber(COUNT_KEY, 0);
}
