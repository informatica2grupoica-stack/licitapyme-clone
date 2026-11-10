// Mapa de DUEÑO de las tablas que NO tienen una columna que diga de qué empresa son (cliente_id / negocio_id / empresa_id / usuario_id).
// Lo lee `scripts/chequear-aislamiento.mts`, que FALLA si aparece una tabla nueva sin dueño y sin clasificar aquí, o si una ruta de un módulo
// ya abierto a otras empresas toca una tabla PRIVADA_ICA. Regla de la skill `multiempresa-escalable`: toda tabla nueva con datos de negocio lleva
// cliente_id; si es pública por naturaleza o de sistema, se anota acá con el motivo.
//
//  PUBLICA      datos oficiales de Mercado Público o derivados puros de ellos. Se comparten entre empresas a propósito (abarata la IA).
//  PRIVADA_ICA  datos de Grupo ICA (su operación, su viabilidad, sus compras). Ningún módulo abierto a otras empresas puede leerlas.
//               Antes de abrir el módulo que las usa hay que darles cliente_id y filtrar (ver docs/memoria/multiempresa.md).
//  SISTEMA      operación interna de LICITANK (colas, intentos de login, métricas, el propio registro de clientes).
//  DERIVADA     cuelga de otra tabla que sí tiene dueño: hereda su visibilidad.
//  LEGADO       ninguna parte del código la usa hoy; candidata a borrarse (no se borra sin decisión del dueño).

export type ClaseTabla = 'PUBLICA' | 'PRIVADA_ICA' | 'SISTEMA' | 'DERIVADA' | 'LEGADO';

const lista = (clase: ClaseTabla, tablas: string[]): Array<[string, ClaseTabla]> => tablas.map(t => [t, clase]);

export const CLASE_TABLA: Record<string, ClaseTabla> = Object.fromEntries([
  ...lista('PUBLICA', [
    'licitaciones_cache',           // ficha oficial de cada licitación
    'adjudicacion_cache',           // resultado oficial de la adjudicación
    'licitacion_apertura',          // apertura oficial
    'licitacion_unidad_cache',      // comuna / unidad del organismo comprador
    'oferta_competencia',           // ofertas publicadas de todos los proveedores (dato público de MP)
    'oferta_competencia_documento',
    'oferta_competencia_garantia',
    'acta_documento',               // actas publicadas en MP
    'preguntas_respuestas_cache',   // foro público de la licitación
  ]),
  ...lista('PRIVADA_ICA', [
    // Viabilidad de ICA (motor v4, reglas aprendidas, su perfil). Las empresas-cliente usan cliente_viabilidad*.
    'viabilidad_licitacion', 'analisis_ia_licitacion', 'viabilidad_config', 'viabilidad_jobs', 'prefiltro_licitacion',
    // Compras y proveedores de ICA
    'compras_proveedor', 'compras_historial_oc', 'compras_historial_oc_item',
    'compras_fletero', 'compras_fletero_zona', 'compras_gasto_categoria', 'compras_incidencia_tipo', 'compras_tarea_catalogo',
    'compras_tipo_cambio', 'compras_agente_uso_diario',
    // Obuma (solo Inversiones Claro) y precios de mercado reunidos por ICA
    'obuma_proyectos_reales', 'obuma_proyectos_snapshot', 'precios_mercado',
    // Avisos y chat de ICA; el contexto del chat se arma con documentos que ICA subió
    'avisos_correo_enviados', 'licitacion_contexto_chat',
  ]),
  ...lista('SISTEMA', [
    'clientes', 'login_intentos', 'mp_api_uso_diario', 'pipeline_fallos', 'documentos_descarga_cola', 'documentos_scraping_log',
    'migracion_174_hora_chile',
  ]),
  ...lista('DERIVADA', [
    'reportes_error_adjuntos',      // → reportes_error (cliente_id)
    'documentos_generados_separar', // → documentos_cache (cliente_id)
    'documentos_origen_manual',     // → documentos_cache (cliente_id)
    'compras_cotizacion_item',      // → compras_cotizacion (negocio_id): siempre se une por ahí
    'compras_veredicto',            // → compras_producto (negocio)
  ]),
  ...lista('LEGADO', ['doc_chunks', 'doc_files', 'doc_pipeline', 'documentos_licitacion', 'search_alerts']),
]);
