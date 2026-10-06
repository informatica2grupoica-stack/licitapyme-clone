// Lector de la ficha pública de Mercado Público (DetailsAcquisition.aspx).
// La API oficial no entrega criterios, garantías, antecedentes ni requisitos del adjudicado; el HTML
// de la ficha sí, ya estructurado (IDs estables de ASP.NET). Sin IA: es el texto oficial del comprador.
// `?idlicitacion=<código>` redirige solo a la ficha (no hace falta el `qs` cifrado).
import * as cheerio from 'cheerio';

export interface FichaPar { etiqueta: string; valor: string }
export interface FichaCriterio { numero: string; nombre: string; observaciones: string; ponderacion: string }
export interface FichaRequerimiento { titulo: string; descripcion: string }

export interface FichaMP {
  codigo: string;
  caracteristicas: FichaPar[];          // 1
  organismo: FichaPar[];                // 2
  etapasPlazos: FichaPar[];             // 3
  antecedentes: { administrativos: string[]; tecnicos: string[]; economicos: string[] }; // 4
  requisitosAdjudicado: { personaNatural: string[]; documentosNatural: string[]; personaJuridica: string[]; documentosJuridica: string[] }; // 5
  criterios: FichaCriterio[];           // 6
  montosContrato: FichaPar[];           // 7
  garantias: string;                    // 8
  requerimientos: FichaRequerimiento[]; // 9
  reclamosPlazoPago: number | null;
}

const limpiar = (s: string) => s.replace(/\s+/g, ' ').trim();

export function parsearFichaMP(html: string, codigo: string): FichaMP {
  const $ = cheerio.load(html);
  const txt = (id: string) => limpiar($(`#${id}`).text());

  // Pares "título / valor" de una sección: lblFicha{n}Titulo{X} ↔ lblFicha{n}{X}
  const pares = (n: number): FichaPar[] => {
    const out: FichaPar[] = [];
    $(`[id^="lblFicha${n}Titulo"]`).each((_, el) => {
      const resto = ($(el).attr('id') || '').slice(`lblFicha${n}Titulo`.length);
      const etiqueta = limpiar($(el).text()).replace(/:$/, '');
      const valor = txt(`lblFicha${n}${resto}`) || txt(`lnkFicha${n}${resto}`); // algunos valores son links (ej. razón social)
      if (etiqueta && valor) out.push({ etiqueta, valor });
    });
    return out;
  };

  // Filas de una grilla; usa lblNumero+lblDescripcion si existen, si no el texto de la fila.
  const filas = (id: string): string[] => {
    const out: string[] = [];
    $(`#${id} > tbody > tr`).each((_, tr) => {
      if ($(tr).find('th').length) return;
      const desc = limpiar($(tr).find('[id$="_lblDescripcion"]').first().text());
      const t = desc || limpiar($(tr).clone().find('a,input,img,script').remove().end().text());
      if (t && !out.includes(t)) out.push(t);
    });
    return out;
  };

  const criterios: FichaCriterio[] = [];
  $('#grvCriterios > tbody > tr').each((_, tr) => {
    const g = (suf: string) => limpiar($(tr).find(`[id$="_${suf}"]`).first().text());
    const nombre = g('lblNombreCriterio');
    if (nombre) criterios.push({ numero: g('lblNumero'), nombre, observaciones: g('lblObservaciones'), ponderacion: g('lblPonderacion') });
  });

  const requerimientos: FichaRequerimiento[] = [];
  $('[id^="grvRequerimientosTecnicos_ctl"][id$="_lblTitulo"]').each((_, el) => {
    const base = ($(el).attr('id') || '').replace(/lblTitulo$/, '');
    requerimientos.push({ titulo: limpiar($(el).text()), descripcion: limpiar($(`#${base}lblDescripcion`).text()) });
  });

  const reclamos = parseInt(txt('lblFicha2Reclamo').replace(/\D/g, ''), 10);

  return {
    codigo,
    caracteristicas: pares(1),
    organismo: pares(2),
    etapasPlazos: pares(3),
    antecedentes: { administrativos: filas('grvAdministrativo'), tecnicos: filas('grvTecnico'), economicos: filas('grvEconomico') },
    requisitosAdjudicado: {
      personaNatural: filas('grvNatural'), documentosNatural: filas('grvDocumentosNaturales'),
      personaJuridica: filas('grvJuridica'), documentosJuridica: filas('grvDocumentosJuridicos'),
    },
    criterios,
    montosContrato: pares(7),
    garantias: txt('lblMensajeGarantia'),
    requerimientos,
    reclamosPlazoPago: Number.isFinite(reclamos) ? reclamos : null,
  };
}

export async function obtenerFichaMP(codigo: string): Promise<FichaMP> {
  const url = `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(codigo)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Ficha MP respondió ${res.status}`);
  const ficha = parsearFichaMP(await res.text(), codigo);
  // Si MP no reconoce el código devuelve una página sin número de licitación: no inventar nada.
  if (!ficha.caracteristicas.length) throw new Error('La ficha de MP no trae contenido para este código');
  return ficha;
}
