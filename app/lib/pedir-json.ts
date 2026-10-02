// app/lib/pedir-json.ts
// GET de pantalla con dos ayudas para que volver a una pestaña no se sienta como empezar de cero:
//  • `ultimoJson(url)`: la última respuesta que ya se vio (el componente la pinta al tiro y refresca por detrás).
//  • `pedirJson(url)`: si otro componente ya está pidiendo la MISMA url (Postulación monta 2 paneles que piden lo mismo), comparten la petición.
// `fresco: true` salta el compartido: se usa después de escribir, para no recibir una lectura iniciada antes del cambio.
const ultimo = new Map<string, unknown>();
const enCurso = new Map<string, Promise<any>>();

export const ultimoJson = <T = any>(url: string): T | undefined => ultimo.get(url) as T | undefined;

export function pedirJson<T = any>(url: string, opts: { fresco?: boolean } = {}): Promise<T> {
  const ya = opts.fresco ? undefined : enCurso.get(url);
  if (ya) return ya;
  const p: Promise<T> = fetch(url).then(r => r.json()).then(d => { if (d?.success) ultimo.set(url, d); return d; })
    .finally(() => { if (enCurso.get(url) === p) enCurso.delete(url); });
  enCurso.set(url, p);
  return p;
}
