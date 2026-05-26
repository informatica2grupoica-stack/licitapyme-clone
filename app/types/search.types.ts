// src/app/types/search.types.ts

export interface SearchRequest {
  consulta?: string;
  pagina?: number;
  resultados_por_pagina?: number;
  filtro_estado?: ('5' | '6' | '7' | '8' | '18' | '19')[];
  filtro_regiones?: string[];
  filtro_monto_min?: number;
  filtro_monto_max?: number;
  filtro_organismos?: string[];
  filtro_fecha_cierre_desde?: string;
  filtro_fecha_cierre_hasta?: string;
  tipo_orden?: TipoOrden;
}

export interface SearchResponse {
  resultados: Oportunidad[];
  meta: MetaData;
}

// Documento adjunto
export interface DocumentoAdjunto {
  nombre: string;
  url: string;
  tipo?: string;
  descripcion?: string;
  size?: number;
  fecha?: string;
  extension?: string;
  ya_descargado?: boolean;
  url_local?: string;
}

// Fechas del proceso de licitación
export interface FechasProceso {
  fecha_publicacion?: string;
  fecha_cierre?: string;
  fecha_inicio_preguntas?: string;
  fecha_fin_preguntas?: string;
  fecha_publicacion_respuestas?: string;
  fecha_apertura_tecnica?: string;
  fecha_apertura_economica?: string;
  fecha_adjudicacion?: string;
  fecha_estimada_adjudicacion?: string;
  fecha_firma_contrato?: string;
}

// Características del proceso
export interface CaracteristicasProceso {
  tipo_licitacion?: string;
  tipo_convocatoria?: string;
  moneda?: string;
  etapas?: string;
  contrato?: boolean;
  toma_razon?: boolean;
  publicidad_ofertas?: boolean;
  subcontratacion?: boolean;
  renovable?: boolean;
  plazo_contrato_dias?: number;
  modalidad_pago?: string;
}

// Garantías requeridas
export interface Garantias {
  seriedad_oferta_monto?: number;
  seriedad_oferta_moneda?: string;
  cumplimiento_contrato_porcentaje?: number;
  cumplimiento_contrato_fecha_vencimiento?: string;
}

// Criterio de evaluación
export interface CriterioEvaluacion {
  nombre: string;
  ponderacion: number;
  descripcion?: string;
}

// Contacto responsable
export interface ContactoResponsable {
  nombre?: string;
  email?: string;
  telefono?: string;
  cargo?: string;
}

export interface Oportunidad {
  // Identificación
  id?: string;
  codigo: string;
  nombre: string;
  titulo?: string;
  
  // Descripción
  descripcion?: string;
  objeto_licitacion?: string;
  resumen_ia?: string;
  
  // Organismo (datos de la entidad compradora)
  organismo: string;
  comprador?: string;
  unidad_compra?: string;
  codigo_organismo: string;
  rut_organismo?: string;
  direccion?: string;
  comuna_unidad?: string;
  
  // Ubicación geográfica
  region?: string;
  comuna?: string;
  ubicacion?: string;
  
  // Estado de la licitación
  estado: string;
  codigo_estado?: number;
  
  // Fechas principales
  fecha_publicacion: string;
  fecha_cierre: string;
  fecha_adjudicacion?: string;
  dias_cierre?: number;
  
  // Fechas completas del proceso
  fechas_proceso?: FechasProceso;
  
  // Montos y moneda
  monto_total?: number;
  monto_estimado?: number;
  moneda?: string;
  
  // Tipos de licitación
  tipo_licitacion?: string;
  tipo_convocatoria?: string;
  tipo_fuente?: string;
  source?: string;
  
  // URLs
  url?: string;
  detail_url?: string;
  search_url?: string;
  
  // Items/productos
  items: ItemProducto[];
  
  // Documentos adjuntos
  documentos?: DocumentoAdjunto[];
  
  // Scores y métricas de relevancia
  score?: number;
  semantic_score?: number;
  final_score?: number;
  rerank_score?: number;
  rerank_reason?: string | null;
  
  // IA y enriquecimiento
  ia_enriched?: boolean;
  
  // Favorito (cliente)
  is_favorite?: boolean;
  
  // Características del proceso
  caracteristicas?: CaracteristicasProceso;
  
  // Garantías requeridas
  garantias?: Garantias;
  
  // Criterios de evaluación
  criterios_evaluacion?: CriterioEvaluacion[];
  
  // Contacto responsable
  contacto?: ContactoResponsable;
  
  // Estadísticas y métricas adicionales
  reclamos_12m?: number;
  cantidad_ofertas?: number;
  numero_oferentes?: number;
  
  // URLs de descarga de datos
  url_csv?: string;
  url_json?: string;
  url_ocds?: string;
  url_acta?: string;
}

export interface ItemProducto {
  licitacion_id?: string;
  correlativo?: number;
  codigo_producto: string;
  nombre_producto: string;
  cantidad: number;
  unidad: string;
  monto_total?: number;
  monto_unitario?: number;
  categoria?: string;
  codigo_categoria?: string;
  descripcion?: string;
}

export interface MetaData {
  pagina_actual: number;
  total_paginas: number;
  total_resultados: number;
  resultados_por_pagina: number;
  tiempo_busqueda_ms: number;
  tipo_orden_aplicado: string;
  fuente_datos?: string;
  total_licitaciones_procesadas?: number;
  error?: string;
}

export type TipoOrden = 
  | 'fecha_cierre_asc'
  | 'fecha_cierre_desc'
  | 'fecha_publicacion_desc'
  | 'monto_desc'
  | 'monto_asc'
  | 'relevancia'
  | null;

export const ESTADOS_LICITACION: Record<string, string> = {
  '5': '📢 Publicada / Activa',
  '6': '🔒 Cerrada',
  '7': '❌ Desierta',
  '8': '✅ Adjudicada',
  '18': '🚫 Revocada',
  '19': '⏸️ Suspendida'
};

export const ESTADOS_CODIGOS: Record<number, string> = {
  5: 'Publicada / Activa',
  6: 'Cerrada',
  7: 'Desierta',
  8: 'Adjudicada',
  18: 'Revocada',
  19: 'Suspendida'
};

export const REGIONES_CHILE = [
  'Región de Arica y Parinacota',
  'Región de Tarapacá',
  'Región de Antofagasta',
  'Región de Atacama',
  'Región de Coquimbo',
  'Región de Valparaíso',
  'Región Metropolitana de Santiago',
  'Región del Libertador General Bernardo O\'Higgins',
  'Región del Maule',
  'Región de Ñuble',
  'Región del Biobío',
  'Región de La Araucanía',
  'Región de Los Ríos',
  'Región de Los Lagos',
  'Región de Aysén del General Carlos Ibáñez del Campo',
  'Región de Magallanes y de la Antártica Chilena'
];

export const TIPOS_LICITACION: Record<string, string> = {
  'L1': 'Licitación Pública Menor a 100 UTM',
  'LE': 'Licitación Pública Entre 100 y 1000 UTM',
  'LP': 'Licitación Pública Mayor 1000 UTM',
  'LS': 'Licitación Pública Servicios personales especializados',
  'LR': 'Licitación Pública igual o superior a 5.000 UTM',
  'CA': 'Compra Ágil',
  'CO': 'Cotización',
  'A1': 'Licitación Privada sin oferentes',
  'B1': 'Licitación Privada por causales legales',
  'D1': 'Trato Directo por proveedor único'
};

export const MONEDAS: Record<string, string> = {
  'CLP': 'Peso Chileno',
  'USD': 'Dólar Americano',
  'EUR': 'Euro',
  'UF': 'Unidad de Fomento',
  'UTM': 'Unidad Tributaria Mensual'
};

// Tipos de convocatoria
export const TIPOS_CONVOCATORIA: Record<string, string> = {
  'ABIERTO': 'Abierto',
  'RESTRINGIDO': 'Restringido',
  'DIRECTO': 'Trato Directo'
};

// Modalidades de pago
export const MODALIDADES_PAGO: Record<string, string> = {
  '1': 'Pago a 30 días',
  '2': 'Pago a 30, 60 y 90 días',
  '3': 'Pago al día',
  '4': 'Pago Anual',
  '5': 'Pago a 60 días',
  '6': 'Pagos Mensuales',
  '7': 'Pago Contra Entrega Conforme',
  '8': 'Pago Bimensual',
  '9': 'Pago Por Estado de Avance',
  '10': 'Pago Trimestral'
};