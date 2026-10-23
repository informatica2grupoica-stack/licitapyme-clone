// app/lib/modulos.ts
// Catálogo de MÓDULOS que se pueden activar por empresa-cliente (multi-cliente). Datos puros, sin BD: lo usan el proxy
// (Edge/Node), el servidor y la UI.
//
// Regla: el cliente 1 (Grupo ICA) tiene `clientes.modulos = NULL` = TODOS. Un cliente nuevo parte con `['radar','negocios']`.
// Una ruta que no calza con ningún módulo se NIEGA a los clientes (lista blanca, falla cerrado): una ruta nueva queda
// bloqueada para clientes hasta que alguien la clasifique aquí.

export type Modulo =
  | 'radar' | 'negocios' | 'viabilidad' | 'ia_chat' | 'auditor' | 'costeo' | 'anexos' | 'compras' | 'entregas' | 'competencia';

export const TODOS_LOS_MODULOS: Modulo[] = ['radar', 'negocios', 'viabilidad', 'ia_chat', 'auditor', 'costeo', 'anexos', 'compras', 'entregas', 'competencia'];
export const MODULOS_BASE: Modulo[] = ['radar', 'negocios'];

export const NOMBRE_MODULO: Record<Modulo, string> = {
  radar: 'Radar', negocios: 'Negocios', viabilidad: 'Viabilidad IA', ia_chat: 'Consulta a la IA', auditor: 'Auditor',
  costeo: 'Costeo', anexos: 'Anexos', compras: 'Compras', entregas: 'Entregas', competencia: 'Ofertas de la competencia',
};

/** Permisos finos (api-auth.ts) que cada módulo habilita. Un permiso que no figura en ningún módulo
 *  (p. ej. `reglas_ia`) no se le concede a un cliente. `ver_otros_negocios`/`exportar` van con Negocios. */
export const PERMISOS_DEL_MODULO: Record<Modulo, string[]> = {
  radar:      ['acceso_radar', 'repartir_puente', 'alertas_anexos'],
  negocios:   ['ver_otros_negocios', 'exportar'],
  viabilidad: ['comentar_viabilidad', 'viabilidad_automatica'],
  ia_chat:    ['chat_licitacion', 'chat_global'],
  auditor:    ['auditor_tecnico', 'auditor_compra', 'auditor_aprobar', 'aprobar_comercial'],
  costeo:     ['costeo_editor', 'costeo_exportar'],
  anexos:     ['anexos'],
  compras:    ['compras', 'compras_administracion', 'compras_bodega', 'compras_todo', 'compras_ver', 'solo_compras'],
  entregas:   ['entrega_proyectos'],
  competencia: [],
};

interface Regla { modulo: Modulo | 'comun' | 'interno'; re: RegExp }

// El orden importa: el PRIMERO que calza gana, así que lo más específico va arriba.
const REGLAS: Regla[] = [
  // ── Comunes a todo cliente (sesión, perfil, avisos propios) ──
  { modulo: 'comun', re: /^\/(login|recuperar|restablecer|bienvenida|perfil|mis-reportes|modulo-bloqueado)(\/|$)/ },
  { modulo: 'comun', re: /^\/api\/(auth|perfil|reportes-error|historial|actividad)(\/|$)/ },

  // ── Solo ICA (administración global, sistema) ──
  // Las líneas de negocio (etiquetas) las administra cada empresa: es parte de Radar/Negocios, aunque la página viva bajo /admin.
  { modulo: 'radar',   re: /^\/admin\/etiquetas(\/|$)/ },
  { modulo: 'interno', re: /^\/(admin|memoria|dev-test-firma)(\/|$)/ },
  { modulo: 'interno', re: /^\/api\/(admin|cron|debug|memoria|obuma-compras)(\/|$)/ },

  // ── Módulos que NO se venden en la Fase 1 (más específicos primero) ──
  { modulo: 'viabilidad', re: /^\/(analizadas|reglas-ia|analisis-licitacion)(\/|$)/ },
  { modulo: 'viabilidad', re: /^\/api\/(licitacion-viabilidad|licitacion-viabilidad-ia|viabilidad|viabilidad-feedback|analizadas|prefiltro|reglas-ia)(\/|$)/ },
  { modulo: 'ia_chat',    re: /^\/api\/(licitacion-ia|licitacion-preguntas|chat-global|chat-proyecto|analizar-documento|buscar-productos)(\/|$)/ },
  { modulo: 'ia_chat',    re: /^\/api\/licitacion\/[^/]+\/chat(\/|$)/ },
  { modulo: 'auditor',    re: /^\/api\/negocios\/[^/]+\/(auditor|prepostulacion)(\/|$)/ },
  { modulo: 'costeo',     re: /^\/api\/negocios\/[^/]+\/(comercial|lineas-oferta)(\/|$)/ },
  { modulo: 'costeo',     re: /^\/api\/documentos\/generar-costeo(\/|$)/ },
  { modulo: 'anexos',     re: /^\/api\/anexos(\/|$)/ },
  { modulo: 'anexos',     re: /^\/api\/empresas\/[^/]+\/(documentos|firmas)(\/|$)/ },
  { modulo: 'compras',    re: /^\/(compras|logistica|ordenes-compra|aprobaciones)(\/|$)/ },
  { modulo: 'compras',    re: /^\/api\/(compras|logistica|ordenes-compra|aprobaciones)(\/|$)/ },
  { modulo: 'competencia', re: /^\/api\/postuladas\/ofertas(\/|$)/ },
  { modulo: 'entregas',   re: /^\/entregas(\/|$)/ },
  { modulo: 'entregas',   re: /^\/api\/entregas(\/|$)/ },

  // ── Fase 1: Radar y Negocios ──
  { modulo: 'radar',    re: /^\/$/ },   // el Buscador es la portada
  { modulo: 'radar',    re: /^\/(radar|dashboard|alertas|favoritos|descartadas|puente)(\/|$)/ },
  { modulo: 'radar',    re: /^\/api\/(radar|dashboard|alertas|palabras-clave|favorites|search|puente|etiquetas)(\/|$)/ },
  { modulo: 'radar',    re: /^\/api\/documentos\/descargar-pendientes(\/|$)/ },
  { modulo: 'negocios', re: /^\/(negocios|licitacion|postuladas|adjudicadas|empresas|documentos)(\/|$)/ },
  { modulo: 'negocios', re: /^\/api\/(negocios|licitacion|licitacion-detalle|licitacion-completa|licitacion-comentarios|licitacion-adjudicacion|postuladas|empresas|documentos|ficha-mp|pdf-pagina|proxy|usuarios)(\/|$)/ },
];

export type Clasificacion = Modulo | 'comun' | 'interno' | null;

/** ¿A qué módulo pertenece esta ruta (página o API)? `null` = sin clasificar (los clientes NO entran). */
export function moduloDeRuta(pathname: string): Clasificacion {
  for (const r of REGLAS) if (r.re.test(pathname)) return r.modulo;
  return null;
}

/** Módulos efectivos de un cliente. `modulos` NULL (cliente 1) = todos. */
export function modulosEfectivos(modulosJson: unknown): Modulo[] {
  if (modulosJson == null) return [...TODOS_LOS_MODULOS];
  let lista: unknown = modulosJson;
  if (typeof lista === 'string') { try { lista = JSON.parse(lista); } catch { return [...MODULOS_BASE]; } }
  if (!Array.isArray(lista)) return [...MODULOS_BASE];
  return lista.filter((m): m is Modulo => (TODOS_LOS_MODULOS as string[]).includes(m as string));
}

/** ¿Puede este cliente usar esta ruta? Cliente 1 (ICA) siempre sí; los demás solo si el módulo está activo. */
export function rutaPermitida(pathname: string, clienteId: number, modulos: Modulo[]): { ok: true } | { ok: false; modulo: Clasificacion } {
  if (clienteId === 1) return { ok: true };
  const m = moduloDeRuta(pathname);
  if (m === 'comun') return { ok: true };
  if (m === null || m === 'interno') return { ok: false, modulo: m };
  return modulos.includes(m) ? { ok: true } : { ok: false, modulo: m };
}

/** Permisos finos que un cliente PUEDE tener según sus módulos (los demás se anulan aunque el usuario los tuviera). */
export function permisosPermitidos(modulos: Modulo[]): Set<string> {
  const s = new Set<string>();
  for (const m of modulos) for (const p of PERMISOS_DEL_MODULO[m]) s.add(p);
  return s;
}
