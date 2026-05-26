// Diccionario de datos completo - API Mercado Público
// Basado en documentación oficial: api.mercadopublico.cl

export interface LicitacionAPIResponse {
  Cantidad: number;
  FechaCreacion: string;
  Version: string;
  Listado: LicitacionAPI[];
}

export interface LicitacionAPI {
  CodigoExterno: string;
  Nombre: string;
  CodigoEstado: number;
  FechaCierre: string;
  Descripcion?: string;
  Estado?: string;
  Comprador?: CompradorAPI;
  DiasCierreLicitacion?: number;
  Informada?: number;
  CodigoTipo?: number;
  Tipo?: string;
  TipoConvocatoria?: number;
  Moneda?: string;
  Etapas?: number;
  EstadoEtapas?: number;
  TomaRazon?: number;
  EstadoPublicidadOfertas?: number;
  JustificacionPublicidad?: string;
  Contrato?: number;
  Obras?: number;
  CantidadReclamos?: number;
  Fechas?: FechasAPI;
  UnidadTiempoEvaluacion?: number;
  DireccionVisita?: string;
  DireccionEntrega?: string;
  Estimacion?: number;
  FuenteFinanciamiento?: number;
  VisibilidadMonto?: number;
  MontoEstimado?: number;
  UnidadTiempo?: number;
  Modalidad?: number;
  TipoPago?: number;
  NombreResponsablePago?: string;
  EmailResponsablePago?: string;
  NombreResponsableContrato?: string;
  EmailResponsableContrato?: string;
  FonoResponsableContrato?: string;
  ProhibicionContratacion?: string;
  SubContratacion?: number;
  UnidadTiempoDuracionContrato?: number;
  TiempoDuracionContrato?: number;
  TipoDuracionContrato?: string;
  JustificacionMontoEstimado?: string;
  ExtensionPlazo?: number;
  EsBaseTipo?: number;
  UnidadTiempoContratoLicitacion?: number;
  ValorTiempoRenovacion?: number;
  PeriodoTiempoRenovacion?: string;
  EsRenovable?: number;
  Adjudicacion?: AdjudicacionAPI;
  Items?: ItemsAPI;
}

export interface CompradorAPI {
  CodigoOrganismo: string;
  NombreOrganismo: string;
  RutUnidad: string;
  CodigoUnidad: string;
  NombreUnidad: string;
  DireccionUnidad: string;
  ComunaUnidad: string;
  RegionUnidad: string;
  RutUsuario?: string;
  CodigoUsuario?: string;
  NombreUsuario?: string;
  CargoUsuario?: string;
}

export interface FechasAPI {
  FechaCreacion?: string;
  FechaCierre?: string;
  FechaInicio?: string;
  FechaFinal?: string;
  FechaPubRespuestas?: string;
  FechaActoAperturaTecnica?: string;
  FechaActoAperturaEconomica?: string;
  FechaPublicacion?: string;
  FechaAdjudicacion?: string;
  FechaEstimadaAdjudicacion?: string;
  FechaSoporteFisico?: string;
  FechaTiempoEvaluacion?: string;
  FechaEstimadaFirma?: string;
  FechasUsuario?: string;
  FechaVisitaTerreno?: string;
  FechaEntregaAntecedentes?: string;
}

export interface AdjudicacionAPI {
  Tipo?: number;
  Fecha?: string;
  Numero?: string;
  NumeroOferentes?: number;
  UrlActa?: string;
}

export interface ItemsAPI {
  Cantidad: number;
  Listado: ItemAPI[];
}

export interface ItemAPI {
  CodigoEstadoLicitacion?: number;
  Correlativo?: number;
  CodigoProducto?: number;
  CodigoCategoria?: string;
  Categoria?: string;
  NombreProducto?: string;
  Descripcion?: string;
  UnidadMedida?: string;
  Cantidad?: number;
  Adjudicacion?: {
    RutProveedor?: string;
    NombreProveedor?: string;
    CantidadAdjudicada?: string;
    MontoUnitario?: number;
  };
}

// =============================================
// Orden de Compra (OC)
// =============================================

export interface OrdenCompraAPIResponse {
  Cantidad: number;
  FechaCreacion: string;
  Version: string;
  Listado: OrdenCompraAPI[];
}

export interface OrdenCompraAPI {
  Codigo: string;
  Nombre: string;
  CodigoEstado: number;
  CodigoLicitacion?: string;
  Descripcion?: string;
  CodigoTipo?: string;
  Tipo?: string;
  TipoMoneda?: string;
  CodigoEstadoProveedor?: number;
  EstadoProveedor?: string;
  Fechas?: {
    FechaCreacion?: string;
    FechaEnvio?: string;
    FechaAceptacion?: string;
    FechaCancelacion?: string;
    FechaUltimaModificacion?: string;
  };
  TieneItems?: string;
  PromedioCalificacion?: number;
  CantidadEvaluacion?: number;
  Descuentos?: number;
  Cargos?: number;
  TotalNeto?: number;
  PorcentajeIva?: number;
  Impuestos?: number;
  Total?: number;
  Financiamiento?: string;
  Pais?: string;
  TipoDespacho?: string;
  FormaPago?: string;
  Comprador?: {
    CodigoOrganismo?: string;
    NombreOrganismo?: string;
    RutUnidad?: string;
    CodigoUnidad?: string;
    NombreUnidad?: string;
    Actividad?: string;
    DireccionUnidad?: string;
    ComunaUnidad?: string;
    RegionUnidad?: string;
    Pais?: string;
    NombreContacto?: string;
    CargoContacto?: string;
    FonoContacto?: string;
    MailContacto?: string;
  };
  Proveedor?: {
    Codigo?: string;
    Nombre?: string;
    Actividad?: string;
    CodigoSucursal?: string;
    NombreSucursal?: string;
    RutSucursal?: string;
    Direccion?: string;
    Comuna?: string;
    Region?: string;
    Pais?: string;
    NombreContacto?: string;
    CargoContacto?: string;
    FonoContacto?: string;
    MailContacto?: string;
  };
  Items?: {
    Cantidad: number;
    Listado: {
      Correlativo?: number;
      CodigoCategoria?: number;
      Categoria?: string;
      CodigoProducto?: number;
      EspecificacionComprador?: string;
      EspecificacionProveedor?: string;
      Cantidad?: number;
      Moneda?: string;
      PrecioNeto?: number;
      TotalCargos?: number;
      TotalDescuentos?: number;
      TotalImpuestos?: number;
      Total?: number;
    }[];
  };
}

// =============================================
// Modelo interno normalizado (lo que usa la app)
// =============================================

export interface Licitacion {
  // Identificación
  Codigo: string;
  Nombre: string;
  Descripcion?: string;

  // Estado
  Estado: string;
  EstadoNombre?: string;
  CodigoEstado?: number;

  // Fechas
  FechaPublicacion: string;
  FechaCierre: string;
  FechaCreacion?: string;
  FechaAdjudicacion?: string;
  FechaInicioPreguntas?: string;
  FechaFinPreguntas?: string;
  FechaPublicacionRespuestas?: string;
  FechaAperturaTecnica?: string;
  FechaAperturaEconomica?: string;
  FechaEstimadaAdjudicacion?: string;
  FechaVisitaTerreno?: string;
  FechaEntregaAntecedentes?: string;

  // Comprador
  Organismo: string;
  CodigoOrganismo: string;
  RutOrganismo?: string;
  NombreUnidad?: string;
  DireccionUnidad?: string;
  ComunaUnidad?: string;
  Region?: string;
  NombreUsuario?: string;
  CargoUsuario?: string;

  // Monto
  MontoEstimado?: number;
  MontoTotal?: number;
  VisibilidadMonto?: boolean;
  Moneda?: string;
  Estimacion?: number;

  // Tipo
  Tipo?: string;
  CodigoTipo?: number;
  TipoConvocatoria?: string;
  DiasCierreLicitacion?: number;

  // Contrato
  Modalidad?: number;
  SubContratacion?: boolean;
  EsRenovable?: boolean;
  TomaRazon?: boolean;
  TiempoDuracionContrato?: number;
  TipoDuracionContrato?: string;

  // Contacto
  NombreResponsableContrato?: string;
  EmailResponsableContrato?: string;
  FonoResponsableContrato?: string;

  // Adjudicación
  Adjudicacion?: {
    Tipo?: number;
    Fecha?: string;
    Numero?: string;
    NumeroOferentes?: number;
    UrlActa?: string;
  };

  // Items
  Items: LicitacionItem[];

  // URL
  Url?: string;
}

export interface LicitacionItem {
  Correlativo?: number;
  CodigoProducto: string;
  NombreProducto: string;
  Descripcion?: string;
  Categoria?: string;
  UnidadMedida?: string;
  Cantidad: number;
  Unidad: string;
  MontoUnitario?: number;
  MontoTotal?: number;
  RutProveedorAdjudicado?: string;
  NombreProveedorAdjudicado?: string;
}

export interface OrganismoResponse {
  Codigo: string;
  Nombre: string;
  Region?: string;
  RUT?: string;
}

export interface BuscarLicitacionesParams {
  fecha?: string;
  estado?: string;
  codigoOrganismo?: string;
  codigoProveedor?: string;
  ticket: string;
}

// =============================================
// Constantes de la API
// =============================================

export const ESTADO_CODIGOS: Record<number, string> = {
  5: 'Publicada',
  6: 'Cerrada',
  7: 'Desierta',
  8: 'Adjudicada',
  18: 'Revocada',
  19: 'Suspendida',
};

export const TIPO_LICITACION_MAP: Record<string, string> = {
  L1: 'Licitación Pública < 100 UTM',
  LE: 'Licitación Pública 100–1.000 UTM',
  LP: 'Licitación Pública 1.000–2.000 UTM',
  LQ: 'Licitación Pública 2.000–5.000 UTM',
  LR: 'Licitación Pública ≥ 5.000 UTM',
  LS: 'Licitación Pública Servicios Especializados',
  E2: 'Licitación Privada < 100 UTM',
  CO: 'Licitación Privada 100–1.000 UTM',
  B2: 'Licitación Privada 1.000–2.000 UTM',
  H2: 'Licitación Privada 2.000–5.000 UTM',
  I2: 'Licitación Privada > 5.000 UTM',
  A1: 'Licitación Privada sin oferentes',
  B1: 'Licitación Privada por otras causales',
  D1: 'Trato Directo Proveedor Único',
  C1: 'Compra Directa (OC)',
  C2: 'Trato Directo (Cotización)',
  R1: 'OC menor a 3 UTM',
  CA: 'OC sin Resolución',
  SE: 'OC sin emisión automática',
};

export const MODALIDAD_PAGO_MAP: Record<number, string> = {
  1: 'Pago a 30 días',
  2: 'Pago a 30, 60 y 90 días',
  3: 'Pago al día',
  4: 'Pago Anual',
  5: 'Pago Bimensual',
  6: 'Pago Contra Entrega Conforme',
  7: 'Pagos Mensuales',
  8: 'Pago Por Estado de Avance',
  9: 'Pago Trimestral',
  10: 'Pago a 60 días',
};

export const UNIDAD_TIEMPO_MAP: Record<number, string> = {
  1: 'Hora(s)',
  2: 'Día(s)',
  3: 'Semana(s)',
  4: 'Mes(es)',
  5: 'Año(s)',
};

export const TIPO_ACTO_ADJUDICACION_MAP: Record<number, string> = {
  1: 'Autorización',
  2: 'Resolución',
  3: 'Acuerdo',
  4: 'Decreto',
  5: 'Otros',
};
