// app/lib/viabilidad-v4/adjudicacion.ts
// P1 · CÓMO SE ADJUDICA — una sola pregunta: ¿el conjunto de líneas se puede repartir entre
// proveedores distintos? El modelo, el lector de cláusula y los detectores del código solo
// REPORTAN EVIDENCIAS con su frase; esta función aplica la tabla de decisión aprobada por CA.
//
// Cambios de fondo respecto de la v3:
//  · Sin default a GLOBAL: sin evidencia (o con evidencia en conflicto) el resultado es NO_CLARO,
//    y GLOBAL también exige evidencia. Arica salió GLOBAL contra "adjudicar total o parcialmente".
//  · Solo la API decide por conteo (1 línea en la API = GLOBAL). El manifiesto del modelo NO
//    participa: un manifiesto mal leído decidía la adjudicación.
//  · "Suma alzada" es el tipo de precio del contrato: evidencia DÉBIL, nunca decide (Cholchol:
//    Art. 4 "contrato a suma alzada" y aun así es por línea).
//  · Una evidencia cuenta solo si su frase se encontró en los documentos y el chequeo semántico
//    confirmó que sostiene su tipo.

export const TIPOS_EVIDENCIA = [
  'COTIZAR_TOTALIDAD', 'ADJUDICA_GLOBAL', 'ADJUDICA_POR_LINEA', 'TOTAL_O_PARCIAL', 'OFERTA_POR_BIEN',
  'DESIERTA_POR_LINEA', 'PRESUPUESTO_POR_LINEA', 'SUMA_ALZADA', 'FORMULARIO_TOTAL', 'FORMULARIO_POR_LINEA',
  'FORMULARIOS_SEPARADOS', 'EVALUACION_POR_ITEM', 'GARANTIA_O_PLAZO_POR_LINEA',
] as const;
export type TipoEvidencia = typeof TIPOS_EVIDENCIA[number];

type Lado = 'GLOBAL' | 'POR_LINEAS';
type Peso = 'DECISIVA' | 'FUERTE' | 'FUERTE_CON_RESPALDO' | 'DEBIL';

export const CATALOGO: Record<TipoEvidencia, { lado: Lado; peso: Peso; afirmacion: string; texto: string }> = {
  COTIZAR_TOTALIDAD:         { lado: 'GLOBAL',     peso: 'DECISIVA', afirmacion: 'Las bases obligan a ofertar todas las líneas o ítems', texto: 'obliga a ofertar todas las líneas' },
  ADJUDICA_GLOBAL:           { lado: 'GLOBAL',     peso: 'DECISIVA', afirmacion: 'Las bases adjudican todo a un solo oferente', texto: 'se adjudica todo a un solo oferente' },
  ADJUDICA_POR_LINEA:        { lado: 'POR_LINEAS', peso: 'DECISIVA', afirmacion: 'Las bases adjudican por línea, ítem, lote o bien', texto: 'se adjudica por línea' },
  TOTAL_O_PARCIAL:           { lado: 'POR_LINEAS', peso: 'DECISIVA', afirmacion: 'El organismo puede adjudicar solo una parte de lo licitado', texto: 'puede adjudicar total o parcialmente' },
  OFERTA_POR_BIEN:           { lado: 'POR_LINEAS', peso: 'DECISIVA', afirmacion: 'El oferente puede ofertar uno o más bienes por separado', texto: 'se puede ofertar uno o más bienes por separado' },
  DESIERTA_POR_LINEA:        { lado: 'POR_LINEAS', peso: 'DECISIVA', afirmacion: 'Una línea puede declararse desierta por separado', texto: 'una línea puede quedar desierta por separado' },
  PRESUPUESTO_POR_LINEA:     { lado: 'POR_LINEAS', peso: 'FUERTE',   afirmacion: 'Cada línea tiene su propio monto disponible', texto: 'cada línea tiene su propio presupuesto' },
  FORMULARIOS_SEPARADOS:     { lado: 'POR_LINEAS', peso: 'FUERTE_CON_RESPALDO', afirmacion: '', texto: 'hay un formulario económico por línea' },
  FORMULARIO_POR_LINEA:      { lado: 'POR_LINEAS', peso: 'DEBIL',    afirmacion: 'El formulario económico pide un precio por cada línea', texto: 'el formulario pide precio por línea' },
  EVALUACION_POR_ITEM:       { lado: 'POR_LINEAS', peso: 'DEBIL',    afirmacion: 'Los criterios de evaluación se aplican por ítem o línea', texto: 'se evalúa por línea' },
  GARANTIA_O_PLAZO_POR_LINEA:{ lado: 'POR_LINEAS', peso: 'DEBIL',    afirmacion: 'Las bases piden garantía o plazo por cada línea', texto: 'piden garantía o plazo por línea' },
  SUMA_ALZADA:               { lado: 'GLOBAL',     peso: 'DEBIL',    afirmacion: 'El contrato es a suma alzada', texto: 'contrato a suma alzada (tipo de precio)' },
  FORMULARIO_TOTAL:          { lado: 'GLOBAL',     peso: 'DEBIL',    afirmacion: 'El formulario económico pide un precio total', texto: 'el formulario pide un total' },
};

export interface EvidenciaAdj {
  tipo: TipoEvidencia;
  cita: { documento?: string; numeral?: string; frase?: string; pagina?: number | null; verificada?: boolean; semantica?: string };
  origen: 'modelo' | 'clausula' | 'detector';
  /** true si la frase se encontró y el chequeo semántico no la descartó (lo fija el código). */
  cuenta?: boolean;
  motivo_no_cuenta?: string;
}

export type ResultadoAdj = 'GLOBAL' | 'POR_LINEAS' | 'NO_CLARO';

export interface DecisionAdjudicacion {
  resultado: ResultadoAdj;
  regla_aplicada: number;            // 1..7 de la tabla
  motivo: string;
  cotizar_100: 'SI' | 'POR_LINEA' | 'POR_CONFIRMAR';
  cotizar_100_texto: string;
  evidencias_decisivas: EvidenciaAdj[];
  pregunta_foro: string | null;
}

export function esTipoEvidencia(x: unknown): x is TipoEvidencia {
  return TIPOS_EVIDENCIA.includes(String(x ?? '').toUpperCase() as TipoEvidencia);
}

/** Marca qué evidencias cuentan: frase verificada en los documentos y semántica no negativa. */
export function marcarEvidenciasQueCuentan(evs: EvidenciaAdj[]): EvidenciaAdj[] {
  for (const e of evs) {
    if (e.origen === 'detector' && (e.tipo === 'FORMULARIOS_SEPARADOS' || e.tipo === 'FORMULARIO_TOTAL' || e.tipo === 'FORMULARIO_POR_LINEA')) {
      // Salen de los nombres de archivo / estructura del formulario: no hay frase que verificar.
      e.cuenta = true; continue;
    }
    if (!e.cita?.frase || e.cita.verificada === false) { e.cuenta = false; e.motivo_no_cuenta = 'la frase no se encontró en los documentos'; continue; }
    if (e.cita.semantica === 'NO' || e.cita.semantica === 'PARCIAL') { e.cuenta = false; e.motivo_no_cuenta = 'la frase no sostiene lo que dice el tipo de evidencia'; continue; }
    e.cuenta = true;
  }
  return evs;
}

/** Tabla de decisión de la especificación 1, P1 (en este orden). */
export function decidirAdjudicacion(evs: EvidenciaAdj[], lineasApi: number): DecisionAdjudicacion {
  const validas = evs.filter(e => e.cuenta);
  const de = (pred: (e: EvidenciaAdj) => boolean) => validas.filter(pred);
  const decisivas = de(e => CATALOGO[e.tipo].peso === 'DECISIVA');
  const derivados = (r: ResultadoAdj): Pick<DecisionAdjudicacion, 'cotizar_100' | 'cotizar_100_texto'> =>
    r === 'GLOBAL' ? { cotizar_100: 'SI', cotizar_100_texto: 'Cotizar el 100 % de las líneas' }
      : r === 'POR_LINEAS' ? { cotizar_100: 'POR_LINEA', cotizar_100_texto: 'Completar cada línea que se oferte' }
      : { cotizar_100: 'POR_CONFIRMAR', cotizar_100_texto: 'Por confirmar' };
  const pregunta = '¿Se puede ofertar y adjudicar por línea, o se debe ofertar la totalidad de las líneas a un solo proveedor?';
  const res = (resultado: ResultadoAdj, regla: number, motivo: string, usadas: EvidenciaAdj[] = []): DecisionAdjudicacion => ({
    resultado, regla_aplicada: regla, motivo, ...derivados(resultado), evidencias_decisivas: usadas,
    pregunta_foro: resultado === 'NO_CLARO' ? pregunta : null,
  });

  // 1. La API trae 1 línea → GLOBAL (si la API no respondió, se salta).
  if (lineasApi === 1) return res('GLOBAL', 1, 'La API de Mercado Público trae una sola línea: no hay nada que repartir.');
  // 2. COTIZAR_TOTALIDAD gana aunque otra frase diga "se adjudica por línea".
  const totalidad = decisivas.filter(e => e.tipo === 'COTIZAR_TOTALIDAD');
  if (totalidad.length) return res('GLOBAL', 2, 'Las bases obligan a ofertar todas las líneas: se cotiza el 100 %.', totalidad);
  // 3 / 4. Decisivas.
  if (decisivas.length) {
    const lados = new Set(decisivas.map(e => CATALOGO[e.tipo].lado));
    if (lados.size === 1) {
      const lado = [...lados][0];
      return res(lado, 3, lado === 'GLOBAL' ? 'Las bases adjudican todo a un solo oferente.' : 'Las bases permiten repartir las líneas entre proveedores.', decisivas);
    }
    return res('NO_CLARO', 4, 'Las bases traen frases que apuntan a lados distintos.', decisivas);
  }
  // 5. Sin decisivas, con PRESUPUESTO_POR_LINEA.
  const presu = de(e => e.tipo === 'PRESUPUESTO_POR_LINEA');
  if (presu.length) return res('POR_LINEAS', 5, 'Cada línea tiene su propio presupuesto.', presu);
  // 6. FORMULARIOS_SEPARADOS + al menos otra señal hacia POR LÍNEA.
  const forms = de(e => e.tipo === 'FORMULARIOS_SEPARADOS');
  const respaldo = de(e => e.tipo !== 'FORMULARIOS_SEPARADOS' && CATALOGO[e.tipo].lado === 'POR_LINEAS');
  if (forms.length && respaldo.length) return res('POR_LINEAS', 6, 'Hay un formulario económico por línea y otra señal que lo respalda.', [...forms, ...respaldo]);
  // 7. Solo débiles, formularios sin respaldo o nada.
  return res('NO_CLARO', 7, validas.length ? 'Solo hay señales débiles: no alcanzan para decidir.' : 'Las bases no dicen cómo se adjudica.');
}

// ─── Detectores existentes → evidencias tipadas ───────────────────────────────────────────
export interface SenalesDetectores {
  tipoAdjudicacionMultiple: string | null;
  licitacionTipoMultiple: string | null;
  ofertaSubconjunto: string | null;
  participacionParcialPorLinea: string | null;
  lenguajePorLinea: string | null;
  presupuestoPorLinea: string | null;
  formulariosPorArchivo: number[];
  cuadroPorLinea: string | null;
  totalUnico: boolean;
}

// licitacionTipoMultiple devuelve 'ancla" ... "evidencia': se verifica el trozo más largo.
const trozoMasLargo = (s: string) => s.split(/"\s*\.\.\.\s*"/).sort((a, b) => b.length - a.length)[0].trim();

/** Reasigna los detectores de la v3 como evidencias (especificación 1, P1, "Detectores que ya existen"). */
export function evidenciasDeDetectores(s: SenalesDetectores): EvidenciaAdj[] {
  const out: EvidenciaAdj[] = [];
  const ev = (tipo: TipoEvidencia, frase: string) => out.push({ tipo, origen: 'detector', cita: { documento: '', numeral: '', frase } });
  if (s.tipoAdjudicacionMultiple) ev('ADJUDICA_POR_LINEA', s.tipoAdjudicacionMultiple);
  if (s.licitacionTipoMultiple) ev('OFERTA_POR_BIEN', trozoMasLargo(s.licitacionTipoMultiple));
  if (s.ofertaSubconjunto) ev('OFERTA_POR_BIEN', s.ofertaSubconjunto);
  if (s.participacionParcialPorLinea) ev('OFERTA_POR_BIEN', s.participacionParcialPorLinea);
  if (s.lenguajePorLinea && s.lenguajePorLinea !== s.participacionParcialPorLinea) {
    // Decisiva si habla de adjudicar u ofertar por línea; débil si solo habla de evaluar.
    const soloEvalua = /evalu|puntaje|nota/i.test(s.lenguajePorLinea) && !/adjudic|ofert|postul/i.test(s.lenguajePorLinea);
    ev(soloEvalua ? 'EVALUACION_POR_ITEM' : 'ADJUDICA_POR_LINEA', s.lenguajePorLinea);
  }
  if (s.presupuestoPorLinea) ev('PRESUPUESTO_POR_LINEA', s.presupuestoPorLinea);
  if (s.formulariosPorArchivo.length >= 2) {
    out.push({ tipo: 'FORMULARIOS_SEPARADOS', origen: 'detector', cita: { documento: '', numeral: '', frase: `${s.formulariosPorArchivo.length} archivos de formulario económico, uno por línea (líneas ${s.formulariosPorArchivo.slice(0, 10).join(', ')})` } });
  }
  // cuadroPorLinea y totalUnico describen la estructura del formulario (no traen frase literal).
  if (s.cuadroPorLinea) out.push({ tipo: 'FORMULARIO_POR_LINEA', origen: 'detector', cita: { documento: '', numeral: '', frase: '' } });
  if (s.totalUnico) out.push({ tipo: 'FORMULARIO_TOTAL', origen: 'detector', cita: { documento: '', numeral: '', frase: '' } });
  return out;
}

/** Evidencias del modelo (adjudicacion.evidencias[]) saneadas a la forma interna. */
export function evidenciasDelModelo(arr: unknown, origen: EvidenciaAdj['origen'] = 'modelo'): EvidenciaAdj[] {
  if (!Array.isArray(arr)) return [];
  return arr.filter(e => e && typeof e === 'object' && esTipoEvidencia((e as any).tipo)).map((e: any) => ({
    tipo: String(e.tipo).toUpperCase() as TipoEvidencia,
    origen,
    cita: e.cita && typeof e.cita === 'object' ? e.cita : { documento: '', numeral: '', frase: String(e.frase || '') },
  }));
}

/** Quita evidencias repetidas (mismo tipo y misma frase normalizada). Conserva la primera. */
export function deduplicarEvidencias(evs: EvidenciaAdj[]): EvidenciaAdj[] {
  const vistas = new Set<string>();
  const n = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return evs.filter(e => {
    const k = `${e.tipo}|${n(String(e.cita?.frase || '')).slice(0, 120)}`;
    if (vistas.has(k)) return false;
    vistas.add(k);
    return true;
  });
}
