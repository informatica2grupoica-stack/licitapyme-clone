import { Oportunidad, SearchRequest, SearchResponse, TipoOrden } from '@/app/types/search.types';
import { Licitacion } from '@/app/types/mercado-publico.types';

export class SearchEngine {
  private normalizeText(text: string): string {
    if (!text) return '';
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private calculateScore(query: string, text: string): number {
    if (!query || !text) return 0;

    // Filtrar palabras cortas para evitar falsos positivos:
    // "c", "s", "y", "de" dentro de "mantencion" causaban matches espurios
    const queryWords = this.normalizeText(query).split(' ').filter(w => w.length >= 3);
    const textNorm   = this.normalizeText(text);
    const textWords  = textNorm.split(' ').filter(w => w.length >= 3);

    if (queryWords.length === 0) return 0;

    let matches = 0;
    let exactMatches = 0;

    for (const qWord of queryWords) {
      for (const tWord of textWords) {
        if (tWord === qWord) {
          // Coincidencia exacta
          exactMatches++;
          matches++;
          break;
        } else if (tWord.includes(qWord)) {
          // La palabra del texto contiene la palabra de búsqueda
          // Ej: "mantenciones" contiene "mantencion"
          matches++;
          break;
        } else if (qWord.length >= 5 && tWord.length >= 5 && qWord.includes(tWord)) {
          // La búsqueda contiene la palabra del texto (solo para palabras largas)
          // Ej: búsqueda "computadoras" incluye "computador"
          // Requiere ambas >= 5 chars para evitar "ion", "cion", "man" etc.
          matches++;
          break;
        }
      }
    }

    const base       = matches / queryWords.length;
    const exactBonus = exactMatches > 0 ? 0.2 : 0;
    const titleBonus = textNorm.startsWith(this.normalizeText(query)) ? 0.15 : 0;
    return Math.min(base + exactBonus + titleBonus, 1);
  }

  private getDiasHastaCierre(fechaCierre: string): number {
    if (!fechaCierre) return -1;
    const diff = new Date(fechaCierre).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  licitacionToOportunidad(lic: Licitacion, query: string = ''): Oportunidad {
    const searchText = `${lic.Nombre} ${lic.Descripcion || ''} ${lic.Organismo}`;
    const score = query ? this.calculateScore(query, searchText) : 1;

    return {
      codigo: lic.Codigo,
      nombre: lic.Nombre,
      descripcion: lic.Descripcion,
      organismo: lic.Organismo,
      comprador: lic.NombreUnidad,
      codigo_organismo: lic.CodigoOrganismo,
      rut_organismo: lic.RutOrganismo,
      direccion: lic.DireccionUnidad,
      comuna_unidad: lic.ComunaUnidad,
      region: lic.Region || '',
      estado: lic.Estado,
      codigo_estado: lic.CodigoEstado,
      fecha_publicacion: lic.FechaPublicacion || new Date().toISOString(),
      fecha_cierre: lic.FechaCierre || '',
      fecha_adjudicacion: lic.FechaAdjudicacion,
      dias_cierre: this.getDiasHastaCierre(lic.FechaCierre),
      monto_total: lic.MontoEstimado || lic.MontoTotal || 0,
      monto_estimado: lic.MontoEstimado,
      moneda: lic.Moneda || 'CLP',
      tipo_licitacion: lic.Tipo,
      tipo_convocatoria: lic.TipoConvocatoria,
      url: lic.Url,
      items: (lic.Items || []).map(it => ({
        codigo_producto: it.CodigoProducto,
        nombre_producto: it.NombreProducto,
        descripcion: it.Descripcion,
        categoria: it.Categoria,
        cantidad: it.Cantidad,
        unidad: it.Unidad,
        monto_unitario: it.MontoUnitario,
      })),
      fechas_proceso: {
        fecha_publicacion: lic.FechaPublicacion,
        fecha_cierre: lic.FechaCierre,
        fecha_inicio_preguntas: lic.FechaInicioPreguntas,
        fecha_fin_preguntas: lic.FechaFinPreguntas,
        fecha_publicacion_respuestas: lic.FechaPublicacionRespuestas,
        fecha_apertura_tecnica: lic.FechaAperturaTecnica,
        fecha_apertura_economica: lic.FechaAperturaEconomica,
        fecha_adjudicacion: lic.FechaAdjudicacion,
        fecha_estimada_adjudicacion: lic.FechaEstimadaAdjudicacion,
      },
      caracteristicas: {
        tipo_licitacion: lic.Tipo,
        moneda: lic.Moneda,
        subcontratacion: lic.SubContratacion,
        renovable: lic.EsRenovable,
        toma_razon: lic.TomaRazon,
        plazo_contrato_dias: lic.TiempoDuracionContrato,
      },
      contacto: {
        nombre: lic.NombreResponsableContrato,
        email: lic.EmailResponsableContrato,
        telefono: lic.FonoResponsableContrato,
      },
      url_acta: lic.Adjudicacion?.UrlActa,
      numero_oferentes: lic.Adjudicacion?.NumeroOferentes,
      score,
    };
  }

  search(licitaciones: Licitacion[], request: SearchRequest): SearchResponse {
    const startTime = Date.now();
    const query = request.consulta?.trim() || '';

    let oportunidades: Oportunidad[] = licitaciones.map(lic =>
      this.licitacionToOportunidad(lic, query)
    );

    // Filtro por relevancia si hay query
    // Umbral 0.25 → al menos 1 de 4 palabras debe coincidir
    if (query) {
      oportunidades = oportunidades.filter(opp => (opp.score || 0) >= 0.25);
    }

    // Filtros
    if (request.filtro_estado?.length) {
      oportunidades = oportunidades.filter(opp =>
        request.filtro_estado!.includes(opp.estado as any)
      );
    }

    if (request.filtro_monto_min || request.filtro_monto_max) {
      oportunidades = oportunidades.filter(opp => {
        const m = opp.monto_total || 0;
        if (request.filtro_monto_min && request.filtro_monto_max)
          return m >= request.filtro_monto_min && m <= request.filtro_monto_max;
        if (request.filtro_monto_min) return m >= request.filtro_monto_min;
        if (request.filtro_monto_max) return m <= request.filtro_monto_max;
        return true;
      });
    }

    if (request.filtro_fecha_cierre_desde || request.filtro_fecha_cierre_hasta) {
      oportunidades = oportunidades.filter(opp => {
        const f = new Date(opp.fecha_cierre);
        if (request.filtro_fecha_cierre_desde && request.filtro_fecha_cierre_hasta)
          return f >= new Date(request.filtro_fecha_cierre_desde) && f <= new Date(request.filtro_fecha_cierre_hasta);
        if (request.filtro_fecha_cierre_desde) return f >= new Date(request.filtro_fecha_cierre_desde);
        if (request.filtro_fecha_cierre_hasta) return f <= new Date(request.filtro_fecha_cierre_hasta);
        return true;
      });
    }

    if (request.filtro_organismos?.length) {
      oportunidades = oportunidades.filter(opp =>
        request.filtro_organismos!.some(org =>
          opp.organismo.toLowerCase().includes(org.toLowerCase())
        )
      );
    }

    if (request.filtro_regiones?.length) {
      oportunidades = oportunidades.filter(opp =>
        request.filtro_regiones!.some(r =>
          (opp.region || '').toLowerCase().includes(r.toLowerCase())
        )
      );
    }

    // Ordenamiento
    const orden = request.tipo_orden || (query ? 'relevancia' : 'fecha_cierre_asc');
    oportunidades = this.ordenar(oportunidades, orden);

    // Paginación
    const pagina = request.pagina || 1;
    const porPagina = request.resultados_por_pagina || 20;
    const inicio = (pagina - 1) * porPagina;

    return {
      resultados: oportunidades.slice(inicio, inicio + porPagina),
      meta: {
        pagina_actual: pagina,
        total_paginas: Math.ceil(oportunidades.length / porPagina),
        total_resultados: oportunidades.length,
        resultados_por_pagina: porPagina,
        tiempo_busqueda_ms: Date.now() - startTime,
        tipo_orden_aplicado: orden,
      },
    };
  }

  private ordenar(opps: Oportunidad[], orden: TipoOrden): Oportunidad[] {
    const s = [...opps];
    switch (orden) {
      case 'fecha_cierre_asc':
        return s.sort((a, b) => new Date(a.fecha_cierre).getTime() - new Date(b.fecha_cierre).getTime());
      case 'fecha_cierre_desc':
        return s.sort((a, b) => new Date(b.fecha_cierre).getTime() - new Date(a.fecha_cierre).getTime());
      case 'fecha_publicacion_desc':
        return s.sort((a, b) => new Date(b.fecha_publicacion).getTime() - new Date(a.fecha_publicacion).getTime());
      case 'monto_desc':
        return s.sort((a, b) => (b.monto_total || 0) - (a.monto_total || 0));
      case 'monto_asc':
        return s.sort((a, b) => (a.monto_total || 0) - (b.monto_total || 0));
      default:
        return s.sort((a, b) => (b.score || 0) - (a.score || 0));
    }
  }
}

export const searchEngine = new SearchEngine();
