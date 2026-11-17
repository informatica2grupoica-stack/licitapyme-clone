// Chequeo POR HANDLER de que una ruta con id en la URL ([id], [codigo]…) verifica que el recurso es de la empresa de quien consulta.
// Lo usa scripts/chequear-aislamiento.mts (sección 4). Nació de SEC-005 (auditoría 2026-11-17): /api/empresas/[id]/documentos y /firmas dejaban
// que un admin de otra empresa tocara empresas ajenas por id; el revisor lo veía solo como «aviso» y a nivel de archivo.
//
// Regla: cada handler exportado (GET/POST/PUT/PATCH/DELETE) de una ruta con segmento dinámico debe nombrar un guardia de dueño en su cuerpo,
// o llamar a una función del mismo archivo que lo haga. Se acepta que el proxy ya cubra la ruta (PROXY_CUBRE) o que esté en la lista de excepciones.

export const GUARDIA = /negocioEsDe\w*|registroEsDeMiEmpresa|puedeVerLicitacion|negocioDelCliente|clienteDeHeader|getClienteId|clienteIdOrNull|x-cliente-id|CLIENTE_ICA|cliente_id|contextoAuditor|puedeVerNegocioAsignado|filtroDocsVisibles/;

/** Rutas que proxy.ts ya guarda (negocioEsDeCliente sobre el id de la URL). Mantener igual que en proxy.ts. */
export const PROXY_CUBRE = [
  /^\/api\/compras\/\d+|^\/api\/compras\/\[[^\]]+\]/,
  /^\/api\/negocios\/\[[^\]]+\]\/(comercial|lineas-oferta)(\/|$)/,
];

const METODOS = /export\s+(?:async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b|const\s+(GET|POST|PUT|PATCH|DELETE)\s*=)/g;

/** Devuelve los métodos de `src` que no nombran guardia de dueño (vacío = bien). */
export function handlersSinGuardia(src: string, url: string): string[] {
  if (!/\[[^\]]+\]/.test(url)) return [];                       // sin id en la URL: no aplica
  if (PROXY_CUBRE.some(r => r.test(url))) return [];
  const posiciones: Array<{ metodo: string; ini: number }> = [];
  for (const m of src.matchAll(METODOS)) posiciones.push({ metodo: (m[1] || m[2]), ini: m.index! });
  if (!posiciones.length) return [];
  // Funciones del mismo archivo cuyo cuerpo ya nombra un guardia (p. ej. `async function autorizar(req)`), para aceptar handlers que las llaman.
  const ayudantes: string[] = [];
  for (const m of src.matchAll(/(?:async\s+function\s+(\w+)|const\s+(\w+)\s*=\s*async)/g)) {
    const nombre = m[1] || m[2];
    if (/^(GET|POST|PUT|PATCH|DELETE)$/.test(nombre)) continue;
    const cuerpo = src.slice(m.index!, m.index! + 1500);
    if (GUARDIA.test(cuerpo)) ayudantes.push(nombre);
  }
  const sin: string[] = [];
  posiciones.forEach((p, i) => {
    const fin = i + 1 < posiciones.length ? posiciones[i + 1].ini : src.length;
    const cuerpo = src.slice(p.ini, fin);
    const llamaAyudante = ayudantes.some(a => new RegExp(`\\b${a}\\s*\\(`).test(cuerpo));
    if (!GUARDIA.test(cuerpo) && !llamaAyudante) sin.push(p.metodo);
  });
  return sin;
}
