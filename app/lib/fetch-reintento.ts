// GET de JSON con reintentos: si el servidor responde con error (p. ej. un 500 pasajero cuando la página lanza muchas
// consultas a la vez), se reintenta en vez de dejar la pantalla mostrando datos viejos sin avisar (visto el 14-oct-2026 en Compras).
export async function fetchJsonReintento<T = any>(url: string, intentos = 3): Promise<T> {
  let ultimo: unknown = null;
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      const d = await r.json().catch(() => null);
      if (r.ok && d) return d as T;
      ultimo = new Error((d && (d as any).error) || `Error ${r.status}`);
    } catch (e) { ultimo = e; }
    if (i < intentos - 1) await new Promise(res => setTimeout(res, 700 * (i + 1)));
  }
  throw ultimo instanceof Error ? ultimo : new Error('No se pudo cargar');
}
