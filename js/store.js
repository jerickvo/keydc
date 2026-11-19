// The last N printed sheets, kept on this device (IndexedDB) for reprinting.
// Nothing ever leaves the device. If IndexedDB is unavailable the booth keeps
// working; only reprinting is affected.
import { CONFIG } from '../config.js';

const DB_NAME = 'stkeyclub';
const STORE = 'sessions';
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB not available'));
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

function run(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const st = tx.objectStore(STORE);
        let result;
        Promise.resolve(fn(st, (r) => (result = r))).catch(reject);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
      })
  );
}

const req2p = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export async function saveSession({ sheetBlob, thumbBlob, layout }) {
  const id = await run('readwrite', async (st, set) => {
    set(await req2p(st.add({ time: Date.now(), sheetBlob, thumbBlob, layout })));
  });
  await prune();
  return id;
}

async function prune() {
  await run('readwrite', async (st) => {
    const keys = await req2p(st.getAllKeys());
    const extra = keys.length - CONFIG.maxSessions;
    for (let i = 0; i < extra; i++) st.delete(keys[i]); // keys are ascending: oldest first
  });
}

// Newest first.
export async function listSessions() {
  const all = await run('readonly', async (st, set) => set(await req2p(st.getAll())));
  return (all || []).sort((a, b) => b.id - a.id);
}

export async function getSession(id) {
  return run('readonly', async (st, set) => set(await req2p(st.get(id))));
}

export async function clearSessions() {
  await run('readwrite', async (st) => {
    st.clear();
  });
}
