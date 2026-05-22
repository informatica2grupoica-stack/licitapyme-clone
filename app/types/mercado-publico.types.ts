// src/app/types/mercado-publico.types.ts

export interface LicitacionResponse {
  Cantidad: number;
  Fecha: string;
  Listado: Licitacion[];
}

export interface Licitacion {
  Codigo: string;
  Nombre: string;
  Descripcion?: string;
  Estado: string;
  CodigoEstado?: number;
  FechaPublicacion: string;
  FechaCierre: string;
  FechaAdjudicacion?: string;
  Organismo: string;
  CodigoOrganismo: string;
  Region?: string;
  Comuna?: string;
  Moneda?: string;
  Tipo?: string;
  TipoConvocatoria?: string;
  MontoEstimado?: number;
  MontoTotal?: number;
  Items: LicitacionItem[];
  Url?: string;
  DetailUrl?: string;
  SearchUrl?: string;
  Comprador?: string;
  UnidadCompra?: string;
  RutOrganismo?: string;
  Direccion?: string;
}

export interface LicitacionItem {
  LicitacionId?: string;
  Correlativo?: number;
  CodigoProducto: string;
  NombreProducto: string;
  Cantidad: number;
  Unidad: string;
  MontoUnitario?: number;
  MontoTotal?: number;
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
  organismo?: string;
  proveedor?: string;
  ticket: string;
}