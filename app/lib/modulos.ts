// app/lib/modulos.ts
// Catálogo de MÓDULOS que se pueden activar por empresa-cliente (multi-cliente). Datos puros, sin BD: lo usan el proxy
// (Edge/Node), el servidor y la UI.
//
// Regla: el cliente 1 (Grupo ICA) tiene `clientes.modulos = NULL` = TODOS. Un cliente nuevo parte con `['radar','negocios']`.
// Una ruta que no calza con ningún módulo se NIEGA a los clientes (lista blanca, falla cerrado): una ruta nueva queda
// bloqueada para clientes hasta que alguien la clasifique aquí.

export type Modulo =
  | 'radar' | 'negocios' | 'viabilidad' | 'resultado' | 'ia_chat' | 'auditor' | 'costeo' | 'anexos' | 'compras' | 'entregas' | 'competencia';

export const TODOS_LOS_MODULOS: Modulo[] = ['radar', 'negocios', 'viabilidad', 'resultado', 'ia_chat', 'auditor', 'costeo', 'anexos', 'compras', 'entregas', 'competencia'];
export const MODULOS_BASE: Modulo[] = ['radar', 'negocios'];
/** Módulos que se pueden activar a una empresa-cliente HOY. Los demás todavía leen tablas sin separar por empresa (Compras, Auditor, Anexos…):
 *  activarlos le mostraría datos de Grupo ICA. Se agregan aquí uno por uno, DESPUÉS de separar sus tablas por empresa y probarlo
 *  (`npx tsx scripts/chequear-aislamiento.mts --simular=<módulo>` lista lo que todavía lo bloquea).
 *  Consulta a la IA (ia_chat, 2026-11-17): ADICIONAL, no viene de inicio (un cliente nuevo parte con radar y negocios). Solo cubre los chats
 *  (Dashboard, uno por menú y el de cada licitación), todos separados por empresa (chat-global.ts / chat-licitacion.ts); el de cada menú además
 *  exige el módulo de ese menú. Las otras rutas de IA que colgaban de él siguen solo para ICA (ver REGLAS).
 *  Costeo (2026-11-10): rutas con dueño (guardia en proxy.ts), lee la viabilidad de la empresa (`informe-viabilidad.ts`), sin datos de ICA. Requiere Viabilidad. */
export const MODULOS_ACTIVABLES: Modulo[] = ['radar', 'negocios', 'viabilidad', 'resultado', 'costeo', 'auditor', 'ia_chat'];

// ── Planes (2026-11-18, regla del dueño) ──────────────────────────────────────────────────────────────────────────────
// Todas las empresas ven el MISMO LICITANK; el plan solo decide qué aparece en los menús. Módulos efectivos = los del plan + los
// adicionales marcados a mano en /admin/clientes (`clientes.modulos`), y nunca más que MODULOS_ACTIVABLES.
// Básico: Buscador, Radar, Puente, Dashboard (módulo radar), Negocios, Postuladas, Ganadas/Perdidas, Descartadas, Órdenes de compra (desde 2026-11-18, van con Negocios), Empresas y la administración de su empresa; dentro del negocio sin Viabilidad, Resultado, Auditor ni Postulación.
// Pro (2026-11-18, decisión del dueño): Básico + Viabilidad IA (con sus criterios), Resultado, Costeo y Auditor (con aprobación simple, configurable por empresa).
// NO incluye Postulación (anexos), Compras ni el conector con el ERP (Obuma); Competencia queda fuera por ahora. Consulta a la IA (ia_chat), Compras y Entregas van aparte.
// Auditor: su pre-postulación depende de Anexos (no se vende) y la exportación a Obuma es solo de ICA (ver REGLAS).
// «Resultado» (pestaña Resultado del negocio) es solo de la pantalla: su API (/api/licitacion-adjudicacion) es de Negocios porque
// también la usa /adjudicadas, y son datos públicos de Mercado Público.
export type Plan = 'BASICO' | 'PRO';
export const PLANES: Plan[] = ['BASICO', 'PRO'];
export const NOMBRE_PLAN: Record<Plan, string> = { BASICO: 'Básico', PRO: 'Pro' };
export const MODULOS_DEL_PLAN: Record<Plan, Modulo[]> = {
  BASICO: ['radar', 'negocios'],
  PRO:    ['radar', 'negocios', 'viabilidad', 'resultado', 'costeo', 'auditor'],
};

/** `clientes.plan` → plan vigente. Lo viejo ('BASE', 'EQUIPO', vacío) cuenta como Básico. */
export function normalizarPlan(plan: unknown): Plan {
  return String(plan ?? '').trim().toUpperCase() === 'PRO' ? 'PRO' : 'BASICO';
}

/** Módulos que de verdad usa una empresa-cliente: los de su plan + sus adicionales, solo los ya separados por empresa. */
export function modulosDeCliente(plan: unknown, adicionalesJson: unknown): Modulo[] {
  const set = new Set<Modulo>([...MODULOS_DEL_PLAN[normalizarPlan(plan)], ...(adicionalesJson == null ? [] : modulosEfectivos(adicionalesJson))]);
  return TODOS_LOS_MODULOS.filter(m => set.has(m) && MODULOS_ACTIVABLES.includes(m));
}

export const NOMBRE_MODULO: Record<Modulo, string> = {
  radar: 'Radar', negocios: 'Negocios', viabilidad: 'Viabilidad IA', resultado: 'Resultado', ia_chat: 'Consulta a la IA', auditor: 'Auditor',
  costeo: 'Costeo', anexos: 'Anexos', compras: 'Compras', entregas: 'Entregas', competencia: 'Ofertas de la competencia',
};

/** Permisos finos (api-auth.ts) que cada módulo habilita. Un permiso que no figura en ningún módulo
 *  (p. ej. `reglas_ia`) no se le concede a un cliente. `ver_otros_negocios`/`exportar` van con Negocios. */
export const PERMISOS_DEL_MODULO: Record<Modulo, string[]> = {
  radar:      ['acceso_radar', 'repartir_puente', 'alertas_anexos'],
  negocios:   ['ver_otros_negocios', 'exportar'],
  viabilidad: ['comentar_viabilidad', 'viabilidad_automatica'],
  resultado:  [],
  ia_chat:    ['chat_licitacion', 'chat_global'],
  auditor:    ['auditor_tecnico', 'auditor_compra', 'auditor_aprobar', 'aprobar_comercial'],
  costeo:     ['costeo_editor', 'costeo_ver','costeo_exportar', 'costeo_agregar_fila', 'costeo_agregar_gasto', 'costeo_agregar_adicional', 'costeo_editar_postulado'],
  anexos:     ['anexos'],
  compras:    ['compras', 'compras_administracion', 'compras_bodega', 'compras_todo', 'compras_ver', 'compras_auditor', 'solo_compras'],
  entregas:   ['entrega_proyectos'],
  competencia: [],
};

interface Regla { modulo: Modulo | 'comun' | 'interno'; re: RegExp }

// El orden importa: el PRIMERO que calza gana, así que lo más específico va arriba.
const REGLAS: Regla[] = [
  // ── Comunes a todo cliente (sesión, perfil, avisos propios) ──
  { modulo: 'comun', re: /^\/(login|recuperar|restablecer|bienvenida|perfil|mis-reportes|modulo-bloqueado)(\/|$)/ },
  { modulo: 'comun', re: /^\/api\/(auth|perfil|reportes-error|historial|actividad|equipo|mi-empresa)(\/|$)/ },
  { modulo: 'comun', re: /^\/equipo(\/|$)/ },
  { modulo: 'comun', re: /^\/mi-empresa(\/|$)/ },

  // ── Solo ICA (administración global, sistema) ──
  // Las líneas de negocio (etiquetas) las administra cada empresa: es parte de Radar/Negocios, aunque la página viva bajo /admin.
  { modulo: 'radar',   re: /^\/admin\/etiquetas(\/|$)/ },
  { modulo: 'interno', re: /^\/(admin|memoria|dev-test-firma)(\/|$)/ },
  { modulo: 'interno', re: /^\/api\/(admin|cron|debug|memoria|obuma-compras)(\/|$)/ },

  // ── Módulos que NO se venden en la Fase 1 (más específicos primero) ──
  // La viabilidad de Grupo ICA (motor v4, sus reglas y tablas) es SOLO de ICA. Una empresa-cliente con el módulo usa su propia viabilidad: /api/cv.
  { modulo: 'interno', re: /^\/(analizadas|reglas-ia|analisis-licitacion)(\/|$)/ },
  { modulo: 'interno', re: /^\/api\/(licitacion-viabilidad|licitacion-viabilidad-ia|viabilidad|viabilidad-feedback|analizadas|prefiltro|reglas-ia)(\/|$)/ },
  { modulo: 'viabilidad', re: /^\/api\/cv\// },
  // Estas rutas de IA leen análisis y documentos sin separar por empresa: siguen solo para ICA hasta separarlas.
  { modulo: 'interno',    re: /^\/api\/(licitacion-ia|licitacion-preguntas|analizar-documento|buscar-productos)(\/|$)/ },
  { modulo: 'ia_chat',    re: /^\/api\/(chat-global|chat-proyecto|chat-seccion)(\/|$)/ },
  { modulo: 'ia_chat',    re: /^\/api\/licitacion\/[^/]+\/chat(\/|$)/ },
  { modulo: 'interno',    re: /^\/api\/negocios\/[^/]+\/auditor\/obuma(\/|$)/ },   // conector con el ERP: solo Grupo ICA
  { modulo: 'anexos',     re: /^\/api\/negocios\/[^/]+\/prepostulacion(\/|$)/ },    // certificado y candado de anexos: va con Postulación
  { modulo: 'auditor',    re: /^\/api\/negocios\/[^/]+\/auditor(\/|$)/ },
  { modulo: 'costeo',     re: /^\/api\/negocios\/[^/]+\/(comercial|lineas-oferta)(\/|$)/ },
  { modulo: 'costeo',     re: /^\/api\/documentos\/generar-costeo(\/|$)/ },
  { modulo: 'anexos',     re: /^\/api\/anexos(\/|$)/ },
  { modulo: 'anexos',     re: /^\/api\/empresas\/[^/]+\/(documentos|firmas)(\/|$)/ },
  // Órdenes de compra (2026-11-18, plan Básico): cada empresa ve solo las suyas (ordenes_compra.cliente_id, migration-197), así que viene con Negocios.
  { modulo: 'negocios',   re: /^\/(api\/)?ordenes-compra(\/|$)/ },
  { modulo: 'compras',    re: /^\/(compras|logistica|aprobaciones)(\/|$)/ },
  { modulo: 'compras',    re: /^\/api\/(compras|logistica|aprobaciones)(\/|$)/ },
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
