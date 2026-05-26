import {
  Licitacion,
  LicitacionItem,
  LicitacionAPI,
  LicitacionAPIResponse,
  OrdenCompraAPI,
  OrdenCompraAPIResponse,
  ESTADO_CODIGOS,
  TIPO_LICITACION_MAP,
  MODALIDAD_PAGO_MAP,
} from '@/app/types/mercado-publico.types';

const API_BASE = 'https://api.mercadopublico.cl/servicios/v1/publico';

export class MercadoPublicoClient {
  private ticket: string;

  constructor(ticket: string) {
    this.ticket = ticket;
  }

  // =============================================
  // LICITACIONES
  // =============================================

  async obtenerPorCodigo(codigo: string): Promise<Licitacion | null> {
    try {
      const url = `${API_BASE}/licitaciones.json?codigo=${encodeURIComponent(codigo)}&ticket=${this.ticket}`;
      const data: LicitacionAPIResponse = await this.fetch(url);
      if (!data.Listado?.length) return null;
      return this.normalizar(data.Listado[0]);
    } catch {
      return null;
    }
  }

  async obtenerHoy(): Promise<Licitacion[]> {
    try {
      const url = `${API_BASE}/licitaciones.json?ticket=${this.ticket}`;
      const data: LicitacionAPIResponse = await this.fetch(url);
      return (data.Listado || []).map(i => this.normalizar(i));
    } catch {
      return [];
    }
  }

  async obtenerActivasHoy(): Promise<Licitacion[]> {
    try {
      const url = `${API_BASE}/licitaciones.json?estado=activas&ticket=${this.ticket}`;
      const data: LicitacionAPIResponse = await this.fetch(url);
      return (data.Listado || []).map(i => this.normalizar(i));
    } catch {
      return [];
    }
  }

  async obtenerPorFecha(fecha: string): Promise<Licitacion[]> {
    try {
      const url = `${API_BASE}/licitaciones.json?fecha=${fecha}&ticket=${this.ticket}`;
      const data: LicitacionAPIResponse = await this.fetch(url);
      return (data.Listado || []).map(i => this.normalizar(i));
    } catch {
      return [];
    }
  }

  async obtenerPorEstado(estado: string): Promise<Licitacion[]> {
    try {
      const url = `${API_BASE}/licitaciones.json?estado=${encodeURIComponent(estado)}&ticket=${this.ticket}`;
      const data: LicitacionAPIResponse = await this.fetch(url);
      return (data.Listado || []).map(i => this.normalizar(i));
    } catch {
      return [];
    }
  }

  async obtenerPorEstadoYFecha(estado: string, fecha: string): Promise<Licitacion[]> {
    try {
      const url = `${API_BASE}/licitaciones.json?estado=${encodeURIComponent(estado)}&fecha=${fecha}&ticket=${this.ticket}`;
      const data: LicitacionAPIResponse = await this.fetch(url);
      return (data.Listado || []).map(i => this.normalizar(i));
    } catch {
      return [];
    }
  }

  async obtenerPorOrganismo(codigoOrganismo: string, fecha?: string): Promise<Licitacion[]> {
    try {
      const fechaParam = fecha ? `&fecha=${fecha}` : '';
      const url = `${API_BASE}/licitaciones.json?CodigoOrganismo=${codigoOrganismo}${fechaParam}&ticket=${this.ticket}`;
      const data: LicitacionAPIResponse = await this.fetch(url);
      return (data.Listado || []).map(i => this.normalizar(i));
    } catch {
      return [];
    }
  }

  async obtenerPorProveedor(codigoProveedor: string, fecha?: string): Promise<Licitacion[]> {
    try {
      const fechaParam = fecha ? `&fecha=${fecha}` : '';
      const url = `${API_BASE}/licitaciones.json?CodigoProveedor=${codigoProveedor}${fechaParam}&ticket=${this.ticket}`;
      const data: LicitacionAPIResponse = await this.fetch(url);
      return (data.Listado || []).map(i => this.normalizar(i));
    } catch {
      return [];
    }
  }

  async obtenerUltimosDias(dias: number = 3): Promise<Licitacion[]> {
    const todas: Licitacion[] = [];

    for (let i = 0; i < dias; i++) {
      const fecha = new Date();
      fecha.setDate(fecha.getDate() - i);
      const fechaStr = this.formatFecha(fecha);
      const resultado = await this.obtenerPorFecha(fechaStr);
      todas.push(...resultado);
      if (i < dias - 1) await new Promise(r => setTimeout(r, 150));
    }

    const unicos = new Map<string, Licitacion>();
    for (const lic of todas) {
      if (!unicos.has(lic.Codigo)) unicos.set(lic.Codigo, lic);
    }

    return Array.from(unicos.values());
  }

  // =============================================
  // ÓRDENES DE COMPRA
  // =============================================

  async obtenerOrdenCompra(codigo: string): Promise<OrdenCompraAPI | null> {
    try {
      const url = `${API_BASE}/OrdenCompra.json?codigo=${encodeURIComponent(codigo)}&ticket=${this.ticket}`;
      const data: OrdenCompraAPIResponse = await this.fetch(url);
      return data.Listado?.[0] || null;
    } catch {
      return null;
    }
  }

  // =============================================
  // UTILIDADES
  // =============================================

  async probarConexion(): Promise<boolean> {
    try {
      const lics = await this.obtenerActivasHoy();
      return lics.length >= 0;
    } catch {
      return false;
    }
  }

  // =============================================
  // NORMALIZACIÓN COMPLETA
  // =============================================

  normalizar(item: LicitacionAPI): Licitacion {
    const comprador = item.Comprador;
    const fechas = item.Fechas;
    const estado = String(item.CodigoEstado || 5);

    const itemsNorm: LicitacionItem[] = (item.Items?.Listado || []).map(it => ({
      Correlativo: it.Correlativo,
      CodigoProducto: String(it.CodigoProducto || ''),
      NombreProducto: it.NombreProducto || '',
      Descripcion: it.Descripcion,
      Categoria: it.Categoria,
      UnidadMedida: it.UnidadMedida,
      Cantidad: it.Cantidad || 0,
      Unidad: it.UnidadMedida || 'Unidad',
      MontoUnitario: it.Adjudicacion?.MontoUnitario,
      RutProveedorAdjudicado: it.Adjudicacion?.RutProveedor,
      NombreProveedorAdjudicado: it.Adjudicacion?.NombreProveedor,
    }));

    return {
      Codigo: item.CodigoExterno || '',
      Nombre: item.Nombre || '',
      Descripcion: item.Descripcion || '',

      Estado: estado,
      EstadoNombre: ESTADO_CODIGOS[item.CodigoEstado] || item.Estado || '',
      CodigoEstado: item.CodigoEstado,

      FechaPublicacion: fechas?.FechaPublicacion || new Date().toISOString(),
      FechaCierre: item.FechaCierre || fechas?.FechaCierre || '',
      FechaCreacion: fechas?.FechaCreacion,
      FechaAdjudicacion: fechas?.FechaAdjudicacion,
      FechaInicioPreguntas: fechas?.FechaInicio,
      FechaFinPreguntas: fechas?.FechaFinal,
      FechaPublicacionRespuestas: fechas?.FechaPubRespuestas,
      FechaAperturaTecnica: fechas?.FechaActoAperturaTecnica,
      FechaAperturaEconomica: fechas?.FechaActoAperturaEconomica,
      FechaEstimadaAdjudicacion: fechas?.FechaEstimadaAdjudicacion,
      FechaVisitaTerreno: fechas?.FechaVisitaTerreno,
      FechaEntregaAntecedentes: fechas?.FechaEntregaAntecedentes,

      Organismo: comprador?.NombreOrganismo || '',
      CodigoOrganismo: comprador?.CodigoOrganismo || '',
      RutOrganismo: comprador?.RutUnidad,
      NombreUnidad: comprador?.NombreUnidad,
      DireccionUnidad: comprador?.DireccionUnidad,
      ComunaUnidad: comprador?.ComunaUnidad,
      Region: comprador?.RegionUnidad || '',
      NombreUsuario: comprador?.NombreUsuario,
      CargoUsuario: comprador?.CargoUsuario,

      MontoEstimado: item.MontoEstimado,
      MontoTotal: item.MontoEstimado,
      VisibilidadMonto: item.VisibilidadMonto === 1,
      Moneda: item.Moneda || 'CLP',
      Estimacion: item.Estimacion,

      Tipo: item.Tipo,
      CodigoTipo: item.CodigoTipo,
      TipoConvocatoria: item.TipoConvocatoria === 1 ? 'Abierto' : 'Cerrado',
      DiasCierreLicitacion: item.DiasCierreLicitacion,

      Modalidad: item.Modalidad,
      SubContratacion: item.SubContratacion === 1,
      EsRenovable: item.EsRenovable === 1,
      TomaRazon: item.TomaRazon === 1,
      TiempoDuracionContrato: item.TiempoDuracionContrato,
      TipoDuracionContrato: item.TipoDuracionContrato,

      NombreResponsableContrato: item.NombreResponsableContrato,
      EmailResponsableContrato: item.EmailResponsableContrato,
      FonoResponsableContrato: item.FonoResponsableContrato,

      Adjudicacion: item.Adjudicacion
        ? {
            Tipo: item.Adjudicacion.Tipo,
            Fecha: item.Adjudicacion.Fecha,
            Numero: item.Adjudicacion.Numero,
            NumeroOferentes: item.Adjudicacion.NumeroOferentes,
            UrlActa: item.Adjudicacion.UrlActa,
          }
        : undefined,

      Items: itemsNorm,

      Url: `https://www.mercadopublico.cl/Procurement/Modules/RFB/Details.aspx?qs=${item.CodigoExterno}`,
    };
  }

  private async fetch<T>(url: string): Promise<T> {
    const res = await globalThis.fetch(url, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 300 },
    });

    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = await res.json();

    if (data.Codigo === 10000) throw new Error(`API: ${data.Mensaje}`);

    return data as T;
  }

  private formatFecha(date: Date): string {
    const d = date.getDate().toString().padStart(2, '0');
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const y = date.getFullYear();
    return `${d}${m}${y}`;
  }
}

let clientInstance: MercadoPublicoClient | null = null;

export function getMercadoPublicoClient(): MercadoPublicoClient {
  if (!clientInstance) {
    const ticket = process.env.MERCADO_PUBLICO_TICKET;
    if (!ticket) throw new Error('MERCADO_PUBLICO_TICKET no configurado en .env.local');
    clientInstance = new MercadoPublicoClient(ticket);
  }
  return clientInstance;
}
