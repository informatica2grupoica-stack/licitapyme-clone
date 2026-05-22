// src/lib/search-engine.ts
import { Oportunidad, SearchRequest, SearchResponse, TipoOrden } from '@/app/types/search.types';
import { Licitacion, LicitacionItem } from '@/app/types/mercado-publico.types';

export class SearchEngine {
  /**
   * Normalizar texto para búsqueda
   */
  private normalizeText(text: string): string {
    if (!text) return '';
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Calcular score de relevancia entre consulta y texto
   */
  private calculateScore(query: string, text: string): number {
    if (!query || !text) return 0;
    
    const queryWords = this.normalizeText(query).split(' ');
    const textWords = this.normalizeText(text).split(' ');
    
    let matches = 0;
    let exactMatches = 0;
    
    for (const qWord of queryWords) {
      if (qWord.length < 2) continue;
      
      for (const tWord of textWords) {
        if (tWord === qWord) {
          exactMatches++;
          matches++;
          break;
        } else if (tWord.includes(qWord) || qWord.includes(tWord)) {
          matches++;
          break;
        }
      }
    }
    
    const maxPossibleMatches = queryWords.filter(w => w.length >= 2).length;
    const baseScore = maxPossibleMatches > 0 ? matches / maxPossibleMatches : 0;
    const exactBonus = exactMatches > 0 ? 0.2 : 0;
    
    // Bonus por coincidencia al inicio del título
    const titleBonus = text.toLowerCase().startsWith(query.toLowerCase()) ? 0.15 : 0;
    
    return Math.min(baseScore + exactBonus + titleBonus, 1);
  }

  /**
   * Filtrar por rango de montos
   */
  private filterByMonto(oportunidades: Oportunidad[], min?: number, max?: number): Oportunidad[] {
    if (!min && !max) return oportunidades;
    
    return oportunidades.filter(opp => {
      const monto = opp.monto_total || 0;
      if (min && max) return monto >= min && monto <= max;
      if (min) return monto >= min;
      if (max) return monto <= max;
      return true;
    });
  }

  /**
   * Filtrar por fecha de cierre
   */
  private filterByFechaCierre(oportunidades: Oportunidad[], desde?: string, hasta?: string): Oportunidad[] {
    if (!desde && !hasta) return oportunidades;
    
    return oportunidades.filter(opp => {
      const fechaCierre = new Date(opp.fecha_cierre);
      
      if (desde && hasta) {
        return fechaCierre >= new Date(desde) && fechaCierre <= new Date(hasta);
      }
      if (desde) return fechaCierre >= new Date(desde);
      if (hasta) return fechaCierre <= new Date(hasta);
      return true;
    });
  }

  /**
   * Calcular días hasta el cierre
   */
  private getDiasHastaCierre(fechaCierre: string): number {
    const hoy = new Date();
    const cierre = new Date(fechaCierre);
    const diffTime = cierre.getTime() - hoy.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  /**
   * Búsqueda principal
   */
  search(licitaciones: Licitacion[], request: SearchRequest): SearchResponse {
    const startTime = Date.now();
    const query = request.consulta?.toLowerCase() || '';
    
    // Convertir licitaciones a nuestro formato Oportunidad
    let oportunidades: Oportunidad[] = licitaciones.map(lic => ({
      codigo: lic.Codigo,
      nombre: lic.Nombre,
      descripcion: lic.Descripcion,
      organismo: lic.Organismo,
      codigo_organismo: lic.CodigoOrganismo,
      estado: lic.Estado,
      fecha_publicacion: lic.FechaPublicacion,
      fecha_cierre: lic.FechaCierre,
      monto_total: lic.MontoTotal,
      dias_cierre: this.getDiasHastaCierre(lic.FechaCierre),
      items: lic.Items?.map((item: LicitacionItem) => ({
        codigo_producto: item.CodigoProducto,
        nombre_producto: item.NombreProducto,
        cantidad: item.Cantidad,
        unidad: item.Unidad,
        monto_total: item.MontoTotal
      })) || [],
      url: lic.Url,
      score: query ? this.calculateScore(query, `${lic.Nombre} ${lic.Descripcion || ''} ${lic.Organismo}`) : 1
    }));

    // Aplicar filtros
    if (query) {
      oportunidades = oportunidades.filter(opp => (opp.score || 0) >= 0.1);
    }

    // Filtro por estado
    if (request.filtro_estado && request.filtro_estado.length > 0) {
      oportunidades = oportunidades.filter(opp => 
        request.filtro_estado?.includes(opp.estado as any)
      );
    }

    // Filtro por monto
    oportunidades = this.filterByMonto(oportunidades, request.filtro_monto_min, request.filtro_monto_max);

    // Filtro por fecha de cierre
    oportunidades = this.filterByFechaCierre(oportunidades, request.filtro_fecha_cierre_desde, request.filtro_fecha_cierre_hasta);

    // Filtro por organismos
    if (request.filtro_organismos && request.filtro_organismos.length > 0) {
      oportunidades = oportunidades.filter(opp =>
        request.filtro_organismos?.some(org => 
          opp.organismo.toLowerCase().includes(org.toLowerCase())
        )
      );
    }

    // Ordenar resultados
    const tipoOrden = request.tipo_orden || (query ? 'relevancia' : 'fecha_cierre_asc');
    oportunidades = this.sortOpportunities(oportunidades, tipoOrden);

    // Paginación
    const pagina = request.pagina || 1;
    const resultadosPorPagina = request.resultados_por_pagina || 20;
    const start = (pagina - 1) * resultadosPorPagina;
    const paginatedResults = oportunidades.slice(start, start + resultadosPorPagina);

    return {
      resultados: paginatedResults,
      meta: {
        pagina_actual: pagina,
        total_paginas: Math.ceil(oportunidades.length / resultadosPorPagina),
        total_resultados: oportunidades.length,
        resultados_por_pagina: resultadosPorPagina,
        tiempo_busqueda_ms: Date.now() - startTime,
        tipo_orden_aplicado: tipoOrden
      }
    };
  }

  /**
   * Ordenar oportunidades según criterio
   */
  private sortOpportunities(opportunities: Oportunidad[], tipoOrden: TipoOrden): Oportunidad[] {
    const sorted = [...opportunities];
    
    switch (tipoOrden) {
      case 'fecha_cierre_asc':
        return sorted.sort((a, b) => 
          new Date(a.fecha_cierre).getTime() - new Date(b.fecha_cierre).getTime()
        );
      case 'fecha_cierre_desc':
        return sorted.sort((a, b) => 
          new Date(b.fecha_cierre).getTime() - new Date(a.fecha_cierre).getTime()
        );
      case 'fecha_publicacion_desc':
        return sorted.sort((a, b) => 
          new Date(b.fecha_publicacion).getTime() - new Date(a.fecha_publicacion).getTime()
        );
      case 'monto_desc':
        return sorted.sort((a, b) => (b.monto_total || 0) - (a.monto_total || 0));
      case 'monto_asc':
        return sorted.sort((a, b) => (a.monto_total || 0) - (b.monto_total || 0));
      case 'relevancia':
      default:
        return sorted.sort((a, b) => (b.score || 0) - (a.score || 0));
    }
  }
}

export const searchEngine = new SearchEngine();