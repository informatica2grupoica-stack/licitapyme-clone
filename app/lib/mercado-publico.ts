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

  /**
   * Versión con timeout explícito — usar en el cron para enrichment masivo.
   * Si la llamada supera `timeoutMs`, retorna null sin lanzar excepción.
   */
  async obtenerPorCodigoRapido(codigo: string, timeoutMs = 8_000): Promise<Licitacion | null> {
    try {
      const url = `${API_BASE}/licitaciones.json?codigo=${encodeURIComponent(codigo)}&ticket=${this.ticket}`;
      const res = await globalThis.fetch(url, {
        headers: { Accept: 'application/json' },
        signal:  AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return null;
      const data: LicitacionAPIResponse = await res.json();
      if (!data.Listado?.length) return null;
      return this.normalizar(data.Listado[0]);
    } catch {
      return null; // timeout o error de red → silencioso
    }
  }

  /**
   * Versión que reporta el estado HTTP — necesaria para el enriquecimiento con
   * throttle: distingue 429 (rate-limit → backoff) de un error real o "no existe".
   * status 429 = la API pide bajar el ritmo; status 0 = timeout/red.
   */
  async obtenerDetalleConEstado(
    codigo: string,
    timeoutMs = 8_000,
  ): Promise<{ lic: Licitacion | null; status: number }> {
    try {
      const url = `${API_BASE}/licitaciones.json?codigo=${encodeURIComponent(codigo)}&ticket=${this.ticket}`;
      const res = await globalThis.fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429) return { lic: null, status: 429 };
      if (!res.ok) return { lic: null, status: res.status };
      const data: LicitacionAPIResponse & { Codigo?: number } = await res.json();
      // La API a veces devuelve 200 con un cuerpo de error (Codigo 10500 = rate-limit)
      if ((data as any).Codigo === 10500) return { lic: null, status: 429 };
      if (!data.Listado?.length) return { lic: null, status: res.status };
      return { lic: this.normalizar(data.Listado[0]), status: 200 };
    } catch {
      return { lic: null, status: 0 }; // timeout o error de red
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
    // fecha en formato DDMMYYYY — la usamos como fallback de FechaPublicacion porque
    // el endpoint batch no incluye el objeto Fechas con FechaPublicacion
    const d = fecha.slice(0, 2), m = fecha.slice(2, 4), y = fecha.slice(4, 8);
    const fechaISOFallback = `${y}-${m}-${d}T00:00:00`;
    try {
      const url = `${API_BASE}/licitaciones.json?fecha=${fecha}&ticket=${this.ticket}`;
      const data: LicitacionAPIResponse = await this.fetch(url);
      return (data.Listado || []).map(i => this.normalizar(i, fechaISOFallback));
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
    // Construir lista de fechas
    const fechas: string[] = [];
    for (let i = 0; i < dias; i++) {
      const fecha = new Date();
      fecha.setDate(fecha.getDate() - i);
      fechas.push(this.formatFecha(fecha));
    }

    // Llamadas en PARALELO — elimina los ~150ms × días de demora artificial
    const resultados = await Promise.all(
      fechas.map(fechaStr => this.obtenerPorFecha(fechaStr))
    );

    const unicos = new Map<string, Licitacion>();
    for (const lista of resultados) {
      for (const lic of lista) {
        if (!unicos.has(lic.Codigo)) unicos.set(lic.Codigo, lic);
      }
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

  normalizar(item: LicitacionAPI, fechaPublicacionFallback?: string): Licitacion {
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

      // Prioridad: 1) campo Fechas del API  2) fallback pasado por el caller (fecha de consulta)  3) vacío
      FechaPublicacion: fechas?.FechaPublicacion || fechaPublicacionFallback || '',
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
