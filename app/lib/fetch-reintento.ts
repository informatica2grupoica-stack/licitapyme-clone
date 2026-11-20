// GET de JSON con reintentos: si el servidor responde con error (p. ej. un 500 pasajero cuando la página lanza muchas
// consultas a la vez), se reintenta en vez de dejar la pantalla mostrando datos viejos sin avisar (visto el 14-oct-2026 en Compras).
//
// Además, pedidos IGUALES que están en vuelo al mismo tiempo comparten UNA sola consulta al servidor (20-nov-2026): en
// Compras → Órdenes y facturas la misma tarjeta se monta dos veces y cada una pedía lo mismo, duplicando la carga.
// Solo comparte mientras el pedido sigue en curso; al terminar no guarda nada, así que después de guardar un cambio
// siempre se lee el dato fresco.
const enVuelo = new Map<string, Promise<unknown>>();

async function pedirConReintento<T>(url: string, intentos: number): Promise<T> {
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

export function fetchJsonReintento<T = any>(url: string, intentos = 3): Promise<T> {
  const clave = `${intentos}|${url}`;
  const activo = enVuelo.get(clave);
  if (activo) return activo as Promise<T>;
  const p = pedirConReintento<T>(url, intentos).finally(() => { enVuelo.delete(clave); });
  enVuelo.set(clave, p);
  return p;
}
