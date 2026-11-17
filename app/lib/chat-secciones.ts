// app/lib/chat-secciones.ts
// Registro de SECCIONES del chat (un chatbot por cada menú de LICITANK). Datos puros, sin BD: lo usan la burbuja
// (navegador) y el servidor.
//
//   · `dashboard` es el chat GENERAL (todas las licitaciones; permiso `chat_global`): solo vive en el Dashboard.
//   · Cada otra sección responde con las tablas de SU menú (permiso `chat_licitacion`), siempre separadas por empresa-cliente
//     (ver `app/lib/chat-global.ts`). Dentro de una licitación (/negocios/<id>, /licitacion/<código>) sigue el chat de la licitación.
//
// Multiempresa: la sección se clasifica con el mismo módulo que su ruta (`moduloDeRuta`), así una empresa-cliente solo ve el chat
// de los menús que tiene contratados.

export interface SeccionChat {
  id: string;
  nombre: string;
  /** Rutas de la app que activan esta sección (la primera que calza gana; lo específico va primero). */
  ruta: RegExp;
  /** Ruta representativa para clasificar el módulo (moduloDeRuta). */
  rutaModulo: string;
  /** Tablas que puede leer el chat de este menú (solo lectura). */
  tablas: string[];
  /** Una línea: de qué trata este menú (entra al prompt). */
  que: string;
  /** Preguntas de ejemplo que se muestran como atajos. */
  sugerencias: string[];
  /** Notas por tabla que ayudan a la IA a elegir bien (se agregan al esquema automático). */
  notas?: Record<string, string>;
}

const TABLAS_NEGOCIO = ['negocios', 'licitaciones_cache', 'adjudicacion_cache', 'oferta_competencia'];

export const SECCIONES: SeccionChat[] = [
  {
    id: 'dashboard', nombre: 'General', ruta: /^\/dashboard(\/|$)/, rutaModulo: '/dashboard',
    tablas: [], // el chat general usa su propio esquema curado (chat-global.ts)
    que: 'toda la aplicación: licitaciones, negocios, compras, órdenes de compra, entregas, proveedores, costeo, auditoría y competencia',
    sugerencias: ['¿Cuántas licitaciones ganamos este año?', '¿Qué proveedor nos ha vendido más en los negocios ganados?', '¿Qué órdenes de compra están sin pagar y de qué negocio?', '¿Qué datos nos faltan en la base?'],
  },
  {
    id: 'negocios', nombre: 'Negocios', ruta: /^\/negocios\/?$/, rutaModulo: '/negocios',
    tablas: ['negocios', 'comentarios_negocio', 'comentarios_licitacion', 'historial_eventos', 'negocio_lineas_oferta', 'linea_producto_ofertado', 'negocio_costeo_editor', 'checklist_comercial', 'checklist_comercial_caracteristicas',
      'auditor_opcion', 'auditor_costo_asociado', 'auditor_prepost_item', 'etiquetas', 'negocios_etiquetas', 'usuarios', 'licitaciones_cache', 'viabilidad_licitacion'],
    que: 'las licitaciones que tomamos como negocio, su etapa, responsable, comentarios, viabilidad, costeo y auditoría de requisitos',
    sugerencias: ['¿Qué negocios cierran esta semana?', '¿Cuántos negocios tiene cada persona?', '¿Qué negocios están en proceso sin movimiento?', '¿Cuál es el monto total de lo que está en proceso?'],
    notas: {
      usuarios: 'Solo nombre, cargo y rol del equipo (sin contraseñas ni datos privados). negocios.asignado_a = usuarios.id.',
      negocio_costeo_editor: 'Costeo guardado de cada negocio: el detalle está en datos_json (texto largo, recórtalo con SUBSTRING).',
      checklist_comercial: 'Requisitos que el Auditor extrae de las bases, por negocio; estado distinto de cumplido/aprobado = pendiente.',
    },
  },
  {
    id: 'aprobaciones', nombre: 'Aprobaciones', ruta: /^\/aprobaciones(\/|$)/, rutaModulo: '/aprobaciones',
    tablas: ['compras_aprobacion', 'compras_aprobacion_linea', 'compras_producto', 'negocios'],
    que: 'las aprobaciones de compra pendientes y resueltas, por negocio y por producto',
    sugerencias: ['¿Qué aprobaciones están pendientes?', '¿Qué aprobaciones se rechazaron y por qué?', '¿Cuántas aprobamos este mes?'],
  },
  {
    id: 'postuladas', nombre: 'Postuladas', ruta: /^\/postuladas(\/|$)/, rutaModulo: '/postuladas',
    tablas: [...TABLAS_NEGOCIO, 'preguntas_respuestas_cache', 'oferta_competencia_documento', 'oferta_competencia_garantia', 'licitacion_apertura', 'acta_documento'],
    que: 'las licitaciones a las que ya postulamos y a la espera de resultado',
    sugerencias: ['¿A qué licitaciones postulamos y siguen sin resultado?', '¿Cuál es la próxima fecha de adjudicación?', '¿Con quién competimos en las postuladas?'],
    // Mismo conteo que la pantalla (resultadoDeNegocio en app/postuladas/page.tsx): 41 en evaluación al 17-nov-2026.
    notas: {
      negocios: 'Postuladas de la pantalla = activo = 1 y estado_pipeline IN (\'POSTULADA\',\'POSIBLE_ADJ\',\'ADJUDICADA\',\'PERDIDA\'). «En evaluación» (sin resultado) usa EXACTAMENTE esta condición, que incluye PERDIDA (hay negocios marcados PERDIDA que Mercado Público aún no adjudica): LEFT JOIN adjudicacion_cache a ON a.licitacion_codigo = n.licitacion_codigo WHERE n.activo = 1 AND n.estado_pipeline IN (\'POSTULADA\',\'POSIBLE_ADJ\',\'ADJUDICADA\',\'PERDIDA\') AND ((a.licitacion_codigo IS NULL AND n.estado_pipeline IN (\'POSTULADA\',\'POSIBLE_ADJ\')) OR (a.licitacion_codigo IS NOT NULL AND a.es_adjudicada = 0 AND COALESCE(a.estado, \'\') NOT REGEXP \'desiert|revocad|suspend\')).',
    },
  },
  {
    id: 'adjudicadas', nombre: 'Ganadas / Perdidas', ruta: /^\/adjudicadas(\/|$)/, rutaModulo: '/adjudicadas',
    tablas: [...TABLAS_NEGOCIO, 'compras_cierre_resultado', 'oferta_competencia_documento', 'oferta_competencia_garantia', 'licitacion_apertura', 'acta_documento'],
    que: 'las licitaciones ya resueltas: ganadas, perdidas, desiertas y revocadas',
    sugerencias: ['¿Cuántas ganamos y cuántas perdimos este año?', '¿A quién perdimos más veces?', '¿Cuánto monto hemos ganado en total?'],
    // Mismo conteo que la pantalla (resultadoDe/esResuelta en app/adjudicadas/page.tsx): 74 ganadas / 201 perdidas al 17-nov-2026.
    notas: {
      negocios: 'Ganadas = estado_pipeline \'ADJUDICADA\'; perdidas = \'PERDIDA\'; siempre activo = 1 y LEFT JOIN adjudicacion_cache a ON a.licitacion_codigo = negocios.licitacion_codigo con (a.licitacion_codigo IS NULL OR a.es_adjudicada = 1): así cuenta la pantalla. Sin período en la pregunta = total histórico, no «este año».',
      adjudicacion_cache: 'Quién ganó: lineas es un arreglo JSON, una entrada por línea con proveedor (nombre del ganador), rutProveedor, montoUnitario, cantidad y esNuestra. MySQL 5.7 no lo desarma: para «quién nos ganó» arma un UNION ALL de JSON_UNQUOTE(JSON_EXTRACT(lineas, \'$[i].proveedor\')) con i = 0..9, filtra IS NOT NULL y JSON_EXTRACT(lineas, \'$[i].esNuestra\') = false, y agrupa por proveedor contando licitaciones distintas.',
    },
  },
  {
    id: 'proyectos', nombre: 'Proyectos (Obuma)', ruta: /^\/compras\/proyectos(\/|$)/, rutaModulo: '/compras/proyectos',
    tablas: ['obuma_proyectos_reales', 'obuma_compras', 'compras_orden_compra_obuma', 'negocios'],
    que: 'los proyectos y compras registrados en Obuma',
    sugerencias: ['¿Cuántos proyectos tenemos en Obuma?', '¿Cuánto hemos comprado por proyecto?'],
  },
  {
    id: 'oc-comercial-mp', nombre: 'OC Comercial MP', ruta: /^\/compras\/oc-comercial-mp(\/|$)/, rutaModulo: '/compras/oc-comercial-mp',
    tablas: ['compras_oc_propia', 'compras_oc_linea_negocio', 'compras_factura_venta', 'compras_proveedor', 'negocios'],
    que: 'las órdenes de compra propias de Comercial MP y sus facturas',
    sugerencias: ['¿Qué OC propias tenemos y a quién?', '¿Qué OC no tienen factura?'],
  },
  {
    id: 'proveedores', nombre: 'Proveedores', ruta: /^\/compras\/proveedores(\/|$)/, rutaModulo: '/compras/proveedores',
    tablas: ['compras_proveedor', 'compras_cotizacion', 'compras_cotizacion_item', 'compras_historial_oc', 'compras_historial_oc_item', 'compras_veredicto'],
    que: 'los proveedores, sus cotizaciones y lo que les hemos comprado',
    sugerencias: ['¿A qué proveedor le hemos comprado más?', '¿Quién cotizó más barato un producto?', '¿Qué proveedores no responden?'],
  },
  {
    id: 'compras', nombre: 'Compras', ruta: /^\/compras(\/|$)/, rutaModulo: '/compras',
    tablas: ['negocios', 'compras_producto', 'compras_cotizacion', 'compras_cotizacion_adicional', 'compras_escenario', 'compras_sku', 'compras_tarea', 'compras_reloj',
      'compras_gasto', 'compras_gasto_categoria', 'compras_incidencia', 'compras_incidencia_tipo', 'compras_aprobacion_linea', 'compras_orden_compra_obuma', 'compras_oc_pago', 'compras_oc_cancelacion',
      'compras_proveedor', 'compras_entrega', 'compras_historial_oc', 'compras_historial_oc_item', 'compras_cotizacion_item', 'compras_auditoria_cotizacion', 'compras_asignacion', 'compras_coencargado',
      'compras_compra_rapida', 'compras_borrador_compra', 'compras_tipo_cambio', 'compras_producto_importacion', 'compras_importacion_embarque', 'compras_auditor_costeo_proyecto', 'compras_auditor_costeo_linea',
      'negocio_costeo_editor'],
    que: 'el proceso de compra de cada negocio ganado: productos, cotizaciones, SKU, órdenes de compra, pagos, tareas y gastos',
    sugerencias: ['¿Qué compras tienen tareas atrasadas?', '¿Qué negocios todavía no tienen orden de compra?', '¿Cuánto llevamos gastado en compras este mes?', '¿Qué productos faltan por cotizar?'],
  },
  {
    id: 'ordenes-compra', nombre: 'Órdenes de compra', ruta: /^\/ordenes-compra(\/|$)/, rutaModulo: '/ordenes-compra',
    tablas: ['ordenes_compra', 'compras_orden_compra_obuma', 'compras_oc_pago', 'compras_historial_oc', 'compras_historial_oc_item', 'negocios'],
    que: 'las órdenes de compra de los clientes y las que emitimos a proveedores, con sus pagos',
    sugerencias: ['¿Qué órdenes de compra llegaron esta semana?', '¿Qué OC están sin pagar?', '¿Cuál es la OC más grande de este año?'],
    // Mismo conteo que la pantalla (listarOrdenesCompra en app/lib/ordenes-compra.ts): 267 OC al 17-nov-2026.
    notas: {
      ordenes_compra: 'OC que los ORGANISMOS nos emiten por Mercado Público (no son las que emitimos a proveedores). es_nuestra = 1 = OC a una de nuestras empresas; la pantalla muestra solo es_nuestra = 1 salvo que pidan «de terceros». Sin período en la pregunta = total histórico. Monto: total; fecha: COALESCE(fecha_envio, fecha_creacion).',
      compras_orden_compra_obuma: 'OC que NOSOTROS emitimos a proveedores (vía Obuma). Sus pagos están en compras_oc_pago; «sin pagar» = sin filas en compras_oc_pago (LEFT JOIN + IS NULL).',
    },
  },
  {
    id: 'entregas', nombre: 'Entregas', ruta: /^\/entregas(\/|$)/, rutaModulo: '/entregas',
    tablas: ['entrega_proyecto', 'entrega_acuse', 'compras_entrega', 'compras_entrega_punto', 'negocios'],
    que: 'las entregas a los clientes, sus puntos de entrega y los acuses',
    sugerencias: ['¿Qué entregas están pendientes?', '¿Qué entregas no tienen acuse?', '¿Cuántas entregas hicimos este mes?'],
  },
  {
    id: 'fleteros', nombre: 'Fleteros', ruta: /^\/logistica\/fleteros(\/|$)/, rutaModulo: '/logistica/fleteros',
    tablas: ['compras_fletero', 'compras_fletero_zona', 'compras_embarque', 'compras_retiro_proveedor'],
    que: 'los fleteros, sus zonas y los embarques y retiros',
    sugerencias: ['¿Qué fleteros cubren una región?', '¿Qué retiros están pendientes?'],
  },
  {
    id: 'radar', nombre: 'Radar', ruta: /^\/radar(\/|$)/, rutaModulo: '/radar',
    tablas: ['licitaciones_cache', 'prefiltro_licitacion', 'palabras_clave', 'alertas_licitaciones', 'licitaciones_descartadas', 'favoritos', 'viabilidad_licitacion'],
    que: 'las licitaciones nuevas que detecta el radar según nuestras palabras clave',
    sugerencias: ['¿Qué licitaciones nuevas entraron hoy?', '¿Qué palabras clave traen más licitaciones?', '¿Cuáles cierran esta semana?'],
  },
  {
    id: 'buscador', nombre: 'Buscador', ruta: /^\/$/, rutaModulo: '/',
    tablas: ['licitaciones_cache', 'adjudicacion_cache', 'oferta_competencia', 'precios_mercado', 'favoritos', 'search_history'],
    que: 'el buscador de licitaciones de Mercado Público y los precios de mercado',
    sugerencias: ['¿Qué licitaciones de este rubro están abiertas?', '¿Cuánto se ha pagado por este producto?', '¿Qué organismos compran más?'],
  },
  {
    id: 'puente', nombre: 'Puente', ruta: /^\/puente(\/|$)/, rutaModulo: '/puente',
    tablas: ['puente_cola', 'puente_repartos', 'puente_radar', 'licitaciones_cache', 'usuarios'],
    que: 'el reparto de licitaciones del radar entre el equipo',
    sugerencias: ['¿Qué licitaciones están sin repartir?', '¿Cuántas licitaciones le repartimos a cada persona?'],
    notas: { usuarios: 'Solo nombre, cargo y rol del equipo.' },
  },
  {
    id: 'analizadas', nombre: 'Analizadas', ruta: /^\/analizadas(\/|$)/, rutaModulo: '/analizadas',
    tablas: ['viabilidad_licitacion', 'analisis_ia_licitacion', 'prefiltro_licitacion', 'licitaciones_cache', 'negocios'],
    que: 'las licitaciones con análisis de viabilidad hecho',
    sugerencias: ['¿Cuáles tienen el mejor puntaje de viabilidad?', '¿Cuántas analizamos esta semana?', '¿Cuáles quedaron en rojo y por qué?'],
  },
  {
    id: 'descartadas', nombre: 'Descartadas', ruta: /^\/descartadas(\/|$)/, rutaModulo: '/descartadas',
    tablas: ['licitaciones_descartadas', 'licitaciones_cache', 'negocios'],
    que: 'las licitaciones que descartamos y por qué',
    sugerencias: ['¿Por qué motivos descartamos más?', '¿Cuántas descartamos este mes?'],
  },
  {
    id: 'analisis-licitacion', nombre: 'Análisis de licitación', ruta: /^\/analisis-licitacion(\/|$)/, rutaModulo: '/analisis-licitacion',
    tablas: ['licitaciones_cache', 'viabilidad_licitacion', 'analisis_ia_licitacion', 'adjudicacion_cache', 'oferta_competencia', 'oferta_competencia_documento', 'licitacion_apertura'],
    que: 'el análisis de una licitación, su viabilidad y su competencia',
    sugerencias: ['¿Qué licitaciones parecidas ganamos antes?', '¿Quién ganó licitaciones de este tipo?'],
  },
  {
    id: 'historial', nombre: 'Historial', ruta: /^\/alertas(\/|$)/, rutaModulo: '/alertas',
    tablas: ['historial_eventos', 'alertas_licitaciones', 'negocios'],
    que: 'el historial de eventos y alertas del sistema',
    sugerencias: ['¿Qué pasó hoy en los negocios?', '¿Qué alertas se enviaron esta semana?'],
  },
  {
    id: 'mi-empresa', nombre: 'Mi empresa', ruta: /^\/(mi-empresa|empresas|equipo)(\/|$)/, rutaModulo: '/mi-empresa',
    tablas: ['empresas', 'usuarios', 'etiquetas', 'negocios'],
    que: 'las empresas con las que postulamos, el equipo y las líneas de negocio',
    sugerencias: ['¿Cuántos negocios tiene cada línea de negocio?', '¿Con qué empresa postulamos más?', '¿Quiénes están en el equipo?'],
    notas: { usuarios: 'Solo nombre, cargo y rol del equipo.' },
  },
  {
    id: 'gasto-ia', nombre: 'Gasto de IA', ruta: /^\/admin\/gasto-ia(\/|$)/, rutaModulo: '/admin/gasto-ia',
    tablas: ['ia_uso', 'usuarios'],
    que: 'cuánto se gasta en inteligencia artificial, por módulo y por persona',
    sugerencias: ['¿Cuánto gastamos en IA este mes?', '¿Qué módulo gasta más?', '¿Quién consume más IA?'],
    notas: { usuarios: 'Solo nombre, cargo y rol del equipo.' },
  },
  {
    id: 'errores', nombre: 'Errores reportados', ruta: /^\/(admin\/errores|mis-reportes)(\/|$)/, rutaModulo: '/admin/errores',
    tablas: ['reportes_error'],
    que: 'los errores que reporta el equipo',
    sugerencias: ['¿Qué errores siguen abiertos?', '¿Cuántos errores reportaron esta semana?'],
  },
];

/** Sección del chat para una ruta (null = ese menú no tiene chat propio). */
export function seccionDeRuta(pathname: string): SeccionChat | null {
  for (const s of SECCIONES) if (s.ruta.test(pathname)) return s;
  return null;
}

export const seccionPorId = (id: string): SeccionChat | null => SECCIONES.find(s => s.id === id) ?? null;
