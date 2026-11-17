// app/lib/fetch-timeout.ts
// `fetch` con tope de espera. Auditoría 2026-11-17 (COD-001): ~45 llamadas del servidor a R2, Mercado Público, OCR y sitios de proveedores no tenían
// timeout; si el otro lado se colgaba, la petición (y el cupo del pool de la app) quedaba tomada hasta que alguien reiniciara.
// Si quien llama ya pasa su propio `signal`, se respeta tal cual. El tope cubre cabeceras Y cuerpo (descargar un archivo grande lento también se corta).
//
//   fetchConTimeout(url, init)  → 120 s: descargas de documentos/archivos (hasta ~60 MB) y OCR.
//   fetchRapido(url, init)      →  30 s: consultas cortas (API de Mercado Público, ficha HTML, HEAD de una ficha).
// Las llamadas a proveedores de IA NO usan esto: tienen su propio corte por inactividad (streaming) y topes más largos.

export const TIMEOUT_DESCARGA_MS = 120_000;
export const TIMEOUT_RAPIDO_MS = 30_000;

function conTope(input: RequestInfo | URL, init: RequestInit | undefined, ms: number): Promise<Response> {
  if (init?.signal) return fetch(input, init);
  return fetch(input, { ...init, signal: AbortSignal.timeout(ms) });
}

export const fetchConTimeout = (input: RequestInfo | URL, init?: RequestInit) => conTope(input, init, TIMEOUT_DESCARGA_MS);
export const fetchRapido = (input: RequestInfo | URL, init?: RequestInit) => conTope(input, init, TIMEOUT_RAPIDO_MS);
