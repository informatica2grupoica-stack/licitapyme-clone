'use client';

// Acceso del navegador (Chrome/Edge, File System Access API) a la carpeta Descargas del usuario, con
// SU permiso explícito. Se usa para subir solo el PDF oficial de una OC apenas la persona lo descarga
// de Mercado Público (ver SubirPdfOficialOC). El handle se recuerda en IndexedDB; el navegador puede
// volver a pedir permiso en una sesión nueva.

const DB = 'licitank-carpetas';
const STORE = 'handles';
const KEY = 'descargas';

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function leerHandle(): Promise<any | null> {
  try {
    const db = await idb();
    return await new Promise(res => {
      const q = db.transaction(STORE).objectStore(STORE).get(KEY);
      q.onsuccess = () => res(q.result ?? null);
      q.onerror = () => res(null);
    });
  } catch { return null; }
}

async function guardarHandle(h: any): Promise<void> {
  try {
    const db = await idb();
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(h, KEY);
  } catch { /* sin IndexedDB: se pedirá la carpeta cada vez */ }
}

export const soportaCarpetaDescargas = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/** Handle ya autorizado, sin pedir nada (null si no hay o falta permiso). */
export async function carpetaDescargasAutorizada(): Promise<any | null> {
  const h = await leerHandle();
  if (!h) return null;
  try { return (await h.queryPermission({ mode: 'read' })) === 'granted' ? h : null; } catch { return null; }
}

/** Pide (o reconfirma) el permiso. Debe llamarse desde un clic del usuario. */
export async function autorizarCarpetaDescargas(): Promise<any | null> {
  const previo = await leerHandle();
  if (previo) {
    try { if ((await previo.requestPermission({ mode: 'read' })) === 'granted') return previo; } catch { /* se elige de nuevo */ }
  }
  const h = await (window as any).showDirectoryPicker({ id: 'descargas', startIn: 'downloads', mode: 'read' });
  await guardarHandle(h);
  return h;
}

/**
 * Espera a que aparezca en la carpeta un PDF nuevo (modificado después de `desde`) cuyo nombre
 * contenga `codigo`. Ignora las descargas a medio camino (.crdownload/.tmp). null si vence o se cancela.
 */
export async function esperarPdfEnCarpeta(
  handle: any, codigo: string, desde: number, signal: AbortSignal, timeoutMs = 10 * 60_000,
): Promise<File | null> {
  const cod = codigo.toLowerCase();
  const fin = Date.now() + timeoutMs;
  while (!signal.aborted && Date.now() < fin) {
    try {
      for await (const entry of handle.values()) {
        if (entry.kind !== 'file') continue;
        const n = String(entry.name).toLowerCase();
        if (!n.endsWith('.pdf') || !n.includes(cod)) continue;
        const f: File = await entry.getFile();
        if (f.lastModified >= desde - 2_000 && f.size > 0) return f;
      }
    } catch { /* permiso revocado o carpeta movida: se sigue intentando hasta el plazo */ }
    await new Promise(r => setTimeout(r, 1_500));
  }
  return null;
}
