// src/app/lib/mercado-publico.ts
import { Licitacion } from '@/app/types/mercado-publico.types';

const API_BASE_URL = 'https://api.mercadopublico.cl/servicios/v1/publico';

// Mapeo de estados
const MAPA_ESTADOS: Record<string, string> = {
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '18': '18',
  '19': '19',
  'activas': '5',
  'Publicada': '5',
  'Cerrada': '6',
  'Desierta': '7',
  'Adjudicada': '8',
  'Revocada': '18',
  'Suspendida': '19'
};

export class MercadoPublicoClient {
  private ticket: string;

  constructor(ticket: string) {
    this.ticket = ticket;
  }

  /**
   * Obtener licitación por código específico (búsqueda exacta)
   * @param codigo - Código de la licitación (ej: "1509-5-L114")
   */
  async obtenerPorCodigo(codigo: string): Promise<Licitacion | null> {
    try {
      const url = `${API_BASE_URL}/licitaciones.json?codigo=${codigo}&ticket=${this.ticket}`;
      console.log(`📡 Buscando código: ${codigo}`);
      console.log(`📡 URL: ${url}`);
      
      const response = await fetch(url);
      
      if (!response.ok) {
        console.error(`❌ Error API: ${response.status}`);
        return null;
      }

      const data = await response.json();
      
      if (data.Codigo === 10000) {
        console.error(`❌ API Error: ${data.Mensaje}`);
        return null;
      }
      
      if (!data.Listado || data.Listado.length === 0) {
        console.log(`⚠️ Código ${codigo} no encontrado`);
        return null;
      }
      
      const item = data.Listado[0];
      const licitacion = this.normalizarLicitacion(item);
      console.log(`✅ Licitación encontrada: ${licitacion.Nombre}`);
      return licitacion;
      
    } catch (error) {
      console.error(`❌ Error en obtenerPorCodigo:`, error);
      return null;
    }
  }

  /**
   * Buscar licitaciones por texto en nombre o descripción
   * @param texto - Texto a buscar
   */
  async buscarPorTexto(texto: string): Promise<Licitacion[]> {
    try {
      // Primero obtenemos todas las activas
      const todas = await this.obtenerActivasHoy();
      
      // Filtramos por texto en nombre o descripción
      const textoLower = texto.toLowerCase();
      const resultados = todas.filter(lic => 
        lic.Nombre?.toLowerCase().includes(textoLower) ||
        lic.Descripcion?.toLowerCase().includes(textoLower)
      );
      
      console.log(`🔍 Búsqueda "${texto}": ${resultados.length} resultados de ${todas.length} licitaciones`);
      return resultados;
      
    } catch (error) {
      console.error(`❌ Error en buscarPorTexto:`, error);
      return [];
    }
  }

  /**
   * Obtener licitaciones activas del día actual
   */
  async obtenerActivasHoy(): Promise<Licitacion[]> {
    try {
      const url = `${API_BASE_URL}/licitaciones.json?estado=activas&ticket=${this.ticket}`;
      console.log(`📡 Consultando API: ${url}`);
      
      const response = await fetch(url);
      
      if (!response.ok) {
        console.error(`❌ Error API: ${response.status}`);
        return [];
      }

      const data = await response.json();
      
      if (data.Codigo === 10000) {
        console.error(`❌ API Error: ${data.Mensaje}`);
        return [];
      }
      
      const licitaciones = (data.Listado || []).map((item: any) => this.normalizarLicitacion(item));
      
      console.log(`✅ Encontradas ${licitaciones.length} licitaciones activas hoy`);
      return licitaciones;
      
    } catch (error) {
      console.error(`❌ Error en obtenerActivasHoy:`, error);
      return [];
    }
  }

  /**
   * Obtener licitaciones de los últimos N días
   */
  async obtenerUltimosDias(dias: number = 7): Promise<Licitacion[]> {
    const todasLicitaciones: Licitacion[] = [];
    
    console.log(`📅 Consultando licitaciones de los últimos ${dias} días...`);
    
    for (let i = 0; i < dias; i++) {
      const fecha = new Date();
      fecha.setDate(fecha.getDate() - i);
      const fechaStr = this.formatearFecha(fecha);
      
      console.log(`📅 Consultando fecha: ${fechaStr} (${i + 1}/${dias})`);
      const licitaciones = await this.obtenerPorFecha(fechaStr);
      todasLicitaciones.push(...licitaciones);
      
      // Pequeña pausa para no saturar la API
      await new Promise(r => setTimeout(r, 100));
    }
    
    // Eliminar duplicados por código
    const unicos = new Map();
    for (const lic of todasLicitaciones) {
      if (!unicos.has(lic.Codigo)) {
        unicos.set(lic.Codigo, lic);
      }
    }
    
    const resultado = Array.from(unicos.values());
    console.log(`📊 Total: ${resultado.length} licitaciones únicas en ${dias} días (${todasLicitaciones.length} con duplicados)`);
    return resultado;
  }

  /**
   * Obtener licitaciones por fecha específica
   */
  async obtenerPorFecha(fecha: string): Promise<Licitacion[]> {
    try {
      const url = `${API_BASE_URL}/licitaciones.json?fecha=${fecha}&ticket=${this.ticket}`;
      const response = await fetch(url);
      
      if (!response.ok) return [];
      
      const data = await response.json();
      if (data.Codigo === 10000) return [];
      
      return (data.Listado || []).map((item: any) => this.normalizarLicitacion(item));
      
    } catch (error) {
      console.error(`❌ Error en obtenerPorFecha:`, error);
      return [];
    }
  }

  /**
   * Buscar por código de organismo
   */
  async obtenerPorOrganismo(codigoOrganismo: string): Promise<Licitacion[]> {
    try {
      const url = `${API_BASE_URL}/licitaciones.json?CodigoOrganismo=${codigoOrganismo}&ticket=${this.ticket}`;
      const response = await fetch(url);
      
      if (!response.ok) return [];
      
      const data = await response.json();
      if (data.Codigo === 10000) return [];
      
      return (data.Listado || []).map((item: any) => this.normalizarLicitacion(item));
      
    } catch (error) {
      console.error(`❌ Error en obtenerPorOrganismo:`, error);
      return [];
    }
  }

  /**
   * Normalizar una licitación desde la respuesta de la API
   */
  private normalizarLicitacion(item: any): Licitacion {
    // Extraer organismo de múltiples fuentes posibles
    const organismo = 
      item.Comprador?.NombreOrganismo ||
      item.Comprador?.NombreUnidad ||
      item.Organismo ||
      item.NombreOrganismo ||
      'Organismo no especificado';
    
    // Extraer código del organismo
    const codigoOrganismo = 
      item.Comprador?.CodigoOrganismo ||
      item.CodigoOrganismo ||
      '';
    
    // Extraer región
    const region = 
      item.Comprador?.RegionUnidad ||
      item.Region ||
      '';
    
    // Calcular monto total (si viene en items o directamente)
    let montoTotal = item.MontoEstimado || 0;
    if (!montoTotal && item.Items?.Listado) {
      montoTotal = item.Items.Listado.reduce((sum: number, i: any) => 
        sum + (i.MontoTotal || i.MontoUnitario || 0), 0);
    }
    
    // Formatear fechas correctamente
    const fechaPublicacion = item.Fechas?.FechaPublicacion || 
                            item.FechaPublicacion || 
                            new Date().toISOString();
    
    const fechaCierre = item.FechaCierre || 
                       item.Fechas?.FechaCierre || 
                       new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    
    // Determinar estado correcto
    let estado = String(item.CodigoEstado || item.Estado || '5');
    if (item.Estado === 'activas' || item.Estado === 'Publicada') {
      estado = '5';
    }
    
    return {
      Codigo: item.CodigoExterno || item.Codigo || '',
      Nombre: item.Nombre || 'Sin nombre',
      Descripcion: item.Descripcion || '',
      Estado: estado,
      FechaPublicacion: fechaPublicacion,
      FechaCierre: fechaCierre,
      Organismo: organismo,
      CodigoOrganismo: codigoOrganismo,
      Region: region,
      MontoTotal: montoTotal,
      Items: item.Items?.Listado || [],
      Url: item.Url || `https://www.mercadopublico.cl/Procurement/Modules/RFB/Details.aspx?qs=${item.CodigoExterno}`
    };
  }

  private formatearFecha(fecha: Date): string {
    const dia = fecha.getDate().toString().padStart(2, '0');
    const mes = (fecha.getMonth() + 1).toString().padStart(2, '0');
    const anio = fecha.getFullYear();
    return `${dia}${mes}${anio}`;
  }

  async probarConexion(): Promise<boolean> {
    try {
      const licitaciones = await this.obtenerActivasHoy();
      return licitaciones.length > 0;
    } catch (error) {
      console.error('Error en prueba de conexión:', error);
      return false;
    }
  }

  async getEstadisticas(): Promise<object> {
    const activas = await this.obtenerActivasHoy();
    return {
      ticket_valido: true,
      fecha_consulta: new Date().toISOString(),
      total_activas_hoy: activas.length,
      ultima_actualizacion: new Date().toISOString()
    };
  }
}

let clientInstance: MercadoPublicoClient | null = null;

export function getMercadoPublicoClient(): MercadoPublicoClient {
  if (!clientInstance) {
    const ticket = process.env.MERCADO_PUBLICO_TICKET;
    if (!ticket) {
      throw new Error('MERCADO_PUBLICO_TICKET no está configurado');
    }
    console.log(`🔌 Inicializando cliente de API con ticket: ${ticket.substring(0, 8)}...`);
    clientInstance = new MercadoPublicoClient(ticket);
  }
  return clientInstance;
}

// Función de utilidad para probar búsqueda por código
export async function testBusquedaPorCodigo(codigo: string) {
  const client = getMercadoPublicoClient();
  const resultado = await client.obtenerPorCodigo(codigo);
  if (resultado) {
    console.log(`✅ Código ${codigo} encontrado: ${resultado.Nombre}`);
    console.log(`   Organismo: ${resultado.Organismo}`);
    console.log(`   Cierre: ${resultado.FechaCierre}`);
  } else {
    console.log(`❌ Código ${codigo} no encontrado`);
  }
  return resultado;
}