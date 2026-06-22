import { Oportunidad, SearchRequest, SearchResponse, TipoOrden } from '@/app/types/search.types';
import { Licitacion } from '@/app/types/mercado-publico.types';
import { extractTipoFromCodigo } from '@/app/lib/tipos-licitacion';
import { normalizar } from '@/app/lib/text-match';

export class SearchEngine {
  // Delegamos en el normalizador compartido (app/lib/text-match.ts) para que la
  // búsqueda manual y el cron del radar usen exactamente la misma normalización.
  private normalizeText(text: string): string {
    return normalizar(text);
  }

  // Pre-computa tokens una sola vez — se pasa a _mapLicitacion para evitar repetir
  private tokenizeQuery(query: string): [string[], string] {
    const norm = this.normalizeText(query);
    return [norm.split(' ').filter(w => w.length >= 3), norm];
  }

  // Puntúa un campo de texto pre-normalizado contra query pre-tokenizada
  private scoreField(queryWords: string[], normText: string): { base: number; exact: number } {
    if (!normText || queryWords.length === 0) return { base: 0, exact: 0 };

    // Set para match exacto O(1) antes de iterar substrings
    const wordSet = new Set(normText.split(' ').filter(w => w.length >= 3));
    let matches = 0;
    let exactMatches = 0;

    for (const qw of queryWords) {
      if (wordSet.has(qw)) {
        exactMatches++;
        matches++;
      } else {
        for (const tw of wordSet) {
          if (tw.includes(qw) || (qw.length >= 5 && tw.length >= 5 && qw.includes(tw))) {
            matches++;
            break;
          }
        }
      }
    }

    return {
      base: matches / queryWords.length,
      exact: exactMatches / queryWords.length,
    };
  }

  // Score con ponderación por campo: nombre > items > descripción > organismo
  private computeScore(
    queryWords: string[],
    queryPhrase: string,
    nombre: string,
    descripcion: string,
    organismo: string,
    itemsText: string
  ): number {
    if (queryWords.length === 0) return 0;

    const sN = this.scoreField(queryWords, nombre);
    const sD = descripcion ? this.scoreField(queryWords, descripcion) : { base: 0, exact: 0 };
    const sO = organismo ? this.scoreField(queryWords, organismo) : { base: 0, exact: 0 };
    const sI = itemsText ? this.scoreField(queryWords, itemsText) : { base: 0, exact: 0 };

    // Pesos: nombre es lo más importante; los items son relevantes; descripción y organismo son complementarios
    const W_NOMBRE = 2.0;
    const W_DESC = 1.0;
    const W_ITEMS = 0.8;
    const W_ORG = 0.3;
    const W_TOTAL = W_NOMBRE + W_DESC + W_ITEMS + W_ORG;

    const weighted = (
      (sN.base + sN.exact * 0.2) * W_NOMBRE +
      (sD.base + sD.exact * 0.1) * W_DESC +
      (sI.base + sI.exact * 0.1) * W_ITEMS +
      sO.base * W_ORG
    ) / W_TOTAL;

    // Bonus si la frase completa aparece como substring en nombre o descripción
    const phraseBonus =
      (nombre.includes(queryPhrase) || descripcion.includes(queryPhrase)) ? 0.2 : 0;

    // Bonus si el nombre empieza exactamente con la frase buscada
    const titleBonus = nombre.startsWith(queryPhrase) ? 0.1 : 0;

    return Math.min(weighted + phraseBonus + titleBonus, 1.0);
  }

  private getDiasHastaCierre(fechaCierre: string): number {
    if (!fechaCierre) return -1;
    return Math.ceil((new Date(fechaCierre).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  }

  // API pública — acepta query como string para compatibilidad externa
  licitacionToOportunidad(lic: Licitacion, query: string = ''): Oportunidad {
    const [queryWords, queryPhrase] = query ? this.tokenizeQuery(query) : [[], ''];
    return this._mapLicitacion(lic, queryWords, queryPhrase);
  }

  // Versión interna que acepta tokens pre-computados — úsala en search() para evitar re-tokenizar
  private _mapLicitacion(
    lic: Licitacion,
    queryWords: string[],
    queryPhrase: string
  ): Oportunidad {
    let score = 1;
    if (queryWords.length > 0) {
      score = this.computeScore(
        queryWords,
        queryPhrase,
        this.normalizeText(lic.Nombre || ''),
        this.normalizeText(lic.Descripcion || ''),
        this.normalizeText(lic.Organismo || ''),
        this.normalizeText((lic.Items || []).map(i => i.NombreProducto || '').join(' '))
      );
    }

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
      // extractTipoFromCodigo es la fuente fiable — la API batch no siempre devuelve Tipo
      tipo_licitacion: extractTipoFromCodigo(lic.Codigo) || lic.Tipo,
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

    // Tokenizar la query UNA SOLA VEZ — el error anterior era tokenizar dentro de
    // licitacionToOportunidad, causando normalizeText(query) N veces por búsqueda
    const [queryWords, queryPhrase] = query ? this.tokenizeQuery(query) : [[], ''];

    let oportunidades: Oportunidad[] = licitaciones.map(lic =>
      this._mapLicitacion(lic, queryWords, queryPhrase)
    );

    // Filtro por relevancia — umbral 0.25 = al menos 1 de 4 palabras debe coincidir
    if (query) {
      oportunidades = oportunidades.filter(opp => (opp.score || 0) >= 0.25);
    }

    if (request.filtro_estado?.length) {
      oportunidades = oportunidades.filter(opp =>
        request.filtro_estado!.includes(opp.estado as any)
      );
    }

    if (request.filtro_tipo?.length) {
      oportunidades = oportunidades.filter(opp => {
        const tipo = (opp.tipo_licitacion || '').toUpperCase();
        return request.filtro_tipo!.some(t => tipo === t.toUpperCase());
      });
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

    const orden = request.tipo_orden || (query ? 'relevancia' : 'fecha_cierre_asc');
    oportunidades = this.ordenar(oportunidades, orden);

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
    // Schwartzian transform para sorts de fecha: calcula Date.getTime() una vez por elemento
    // en lugar de hacerlo en cada comparación (el comparador puede llamarse O(N log N) veces)
    switch (orden) {
      case 'fecha_cierre_asc': {
        const keyed = opps.map(o => ({ o, t: o.fecha_cierre ? new Date(o.fecha_cierre).getTime() : 0 }));
        keyed.sort((a, b) => a.t - b.t);
        return keyed.map(x => x.o);
      }
      case 'fecha_cierre_desc': {
        const keyed = opps.map(o => ({ o, t: o.fecha_cierre ? new Date(o.fecha_cierre).getTime() : 0 }));
        keyed.sort((a, b) => b.t - a.t);
        return keyed.map(x => x.o);
      }
      case 'fecha_publicacion_desc': {
        const keyed = opps.map(o => ({ o, t: o.fecha_publicacion ? new Date(o.fecha_publicacion).getTime() : 0 }));
        keyed.sort((a, b) => b.t - a.t);
        return keyed.map(x => x.o);
      }
      case 'monto_desc':
        return [...opps].sort((a, b) => (b.monto_total || 0) - (a.monto_total || 0));
      case 'monto_asc':
        return [...opps].sort((a, b) => (a.monto_total || 0) - (b.monto_total || 0));
      default:
        return [...opps].sort((a, b) => (b.score || 0) - (a.score || 0));
    }
  }
}

export const searchEngine = new SearchEngine();
