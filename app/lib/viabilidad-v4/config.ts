// app/lib/viabilidad-v4/config.ts
// CATÁLOGOS Y PARÁMETROS EDITABLES de la viabilidad v4.0 y del nivel de atractivo v4.1.
//
// Especificación 2 (§6): "Todos los catálogos son enunciativos: CA los edita en configuración sin
// tocar código ni prompt". Lo que está acá son los VALORES POR DEFECTO aprobados por CA el
// 02-10-2026. La fila 'v4' de `viabilidad_config` (migration-137) se mezcla encima: lo que CA
// cambie allí manda, lo que no toque sigue con este default (ver cargar-config.ts).
//
// Módulo PURO (sin BD) a propósito: lo importan las pruebas y la función calcularNivel.

export type Complejidad = 'ALTA' | 'MEDIA' | 'COMMODITY';

export interface RequisitoCatalogo {
  nombre: string;
  /** Basta UNA de estas frases (normalizadas) dentro del requisito. */
  frases: string[];
  /** Si viene, además debe aparecer UNA de estas (ej. "personal idóneo" + "instalación"). */
  contexto?: string[];
  /** Si aparece UNA de estas, el requisito NO calza (es salvable: p. ej. el personal puede ser "subcontratado"). */
  salvo?: string[];
}

export interface ConfigViabilidadV4 {
  version_reglas: string;
  familias: Record<Complejidad, string[]>;
  admisibilidad_imposible: RequisitoCatalogo[];
  certificado_marca: RequisitoCatalogo & { salida: string };
  frases_consecuencia: string[];
  obviedades: string[];
  /** Mínimo en pesos NETOS: un presupuesto igual a este NO pasa (F3). */
  minimo_neto: number;
  /** Tramos de partida por presupuesto neto (5.1). `hasta` null = sin techo. */
  tramos_presupuesto: Array<{ hasta: number | null; nivel: number }>;
  escalones: {
    complejidad: Record<Complejidad, number>;
    productos: Array<{ desde: number; hasta: number | null; escalones: number }>;
    pelea_precio: { umbral_pct: number; escalones: number };
    certificado_marca: number;
    /** Ley del mínimo en plazo / del máximo en garantía con presupuesto ≤ tope. */
    leyes: { hasta_neto: number; escalones: number };
  };
  pisos: { ley_20_30: number; ley_mas_30: number; presupuesto_mas_60: number };
  techos: { presupuesto_10_20: number; servicio: number };
  /** Nivel de partida provisorio cuando las bases no publican monto (3.1). */
  partida_sin_monto: Record<'LE' | 'LP' | 'LR', number>;
  /** Feriados nacionales 'YYYY-MM-DD' (P3, plazo previo en días hábiles). */
  feriados: string[];
  /** Feriados regionales por nombre de región (normalizado, sin tildes, minúsculas). */
  feriados_regionales: Record<string, string[]>;
}

export const NIVELES = ['EXCLUIDO', 'BAJO', 'MEDIO_BAJO', 'MEDIO', 'MEDIO_ALTO', 'ALTO', 'MUY_ALTO'] as const;
export type NivelAtractivo = typeof NIVELES[number];

export const CONFIG_V4_DEFAULT: ConfigViabilidadV4 = {
  version_reglas: '4.1-2026-10-05',
  familias: {
    ALTA: ['LABORATORIO', 'MEDICO_HOSPITALARIO', 'ELECTRICO', 'ELECTRONICO_INSTRUMENTACION', 'INDUSTRIAL_ESPECIALIZADO', 'EQUIPO_ESPECIALIDAD'],
    MEDIA: ['MAQUINARIA_CONSTRUCCION', 'MAQUINARIA_AGRICOLA', 'MAQUINARIA_ASEO', 'MAQUINARIA_OTRA', 'VEHICULOS', 'MOBILIARIO'],
    COMMODITY: ['HERRAMIENTAS', 'MATERIALES_CONSTRUCCION', 'FERRETERIA', 'HOGAR_RETAIL', 'COMPUTACION'],
  },
  admisibilidad_imposible: [
    { nombre: 'Tecnovigilancia ISP', frases: ['tecnovigilancia', 'encargado de tecnovigilancia', 'inscrito en el isp', 'registro isp del personal', 'personal inscrito en el isp'] },
    {
      nombre: 'Personal idóneo',
      frases: ['personal idoneo', 'tecnico certificado', 'profesional a cargo', 'titulo profesional'],
      contexto: ['servicio tecnico', 'instalacion', 'implementacion', 'puesta en marcha'],
      // 1057448-45-LP26: "personal de servicio técnico propio o subcontratado… contrato vigente con el proveedor"
      // se cumple con el servicio técnico del proveedor: no deja fuera, resta como certificado de marca (6.2).
      salvo: ['subcontratado', 'contrato vigente con el proveedor', 'contrato con el proveedor'],
    },
  ],
  certificado_marca: {
    nombre: 'Servicio técnico propio o autorizado de una marca',
    frases: ['servicio tecnico autorizado', 'certificado de representante', 'distribuidor autorizado', 'representante autorizado', 'otorgado por el fabricante', 'certificado por el fabricante', 'capacitado por el fabricante'],
    salida: 'Conseguir el certificado del proveedor del equipo alternativo u homologado',
  },
  frases_consecuencia: [
    'inadmisible', 'quedara fuera', 'quedaran fuera', 'no sera evaluada', 'no seran evaluadas', 'sera rechazada',
    'seran rechazadas', 'fuera de bases', 'desestimada', 'desestimadas', 'no se admitira', 'no se admitiran',
    'sera declarada inadmisible', 'no sera considerada', 'no seran consideradas',
  ],
  obviedades: [
    'verificar stock', 'verifica stock', 'revisar las bases', 'leer las bases', 'leer cuidadosamente',
    'cumplir con las bases', 'presentar la oferta a tiempo', 'subir la oferta antes del cierre',
    'revisar los anexos', 'firmar los anexos', 'cumplir los plazos', 'cotizar con proveedores',
  ],
  minimo_neto: 10_000_000,
  tramos_presupuesto: [
    { hasta: 20_000_000, nivel: 1 },
    { hasta: 30_000_000, nivel: 2 },
    { hasta: 40_000_000, nivel: 3 },
    { hasta: 60_000_000, nivel: 4 },
    { hasta: 100_000_000, nivel: 5 },
    { hasta: null, nivel: 6 },
  ],
  escalones: {
    complejidad: { ALTA: 1, MEDIA: 0, COMMODITY: -1 },
    productos: [
      { desde: 1, hasta: 5, escalones: 1 },
      { desde: 6, hasta: 29, escalones: 0 },
      { desde: 30, hasta: 59, escalones: -1 },
      { desde: 60, hasta: null, escalones: -2 },
    ],
    pelea_precio: { umbral_pct: 70, escalones: -1 },
    certificado_marca: -1,
    leyes: { hasta_neto: 20_000_000, escalones: 1 },
  },
  pisos: { ley_20_30: 5, ley_mas_30: 6, presupuesto_mas_60: 4 },
  techos: { presupuesto_10_20: 4, servicio: 2 },
  partida_sin_monto: { LE: 2, LP: 5, LR: 6 },
  // Feriados legales de Chile. 2026 y 2027 cargados el 02-10-2026; CA los mantiene en configuración.
  feriados: [
    '2026-01-01', '2026-04-03', '2026-04-04', '2026-05-01', '2026-05-21', '2026-06-21', '2026-06-29',
    '2026-07-16', '2026-08-15', '2026-09-18', '2026-09-19', '2026-10-12', '2026-10-31', '2026-11-01',
    '2026-12-08', '2026-12-25',
    '2027-01-01', '2027-03-26', '2027-03-27', '2027-05-01', '2027-05-21', '2027-06-21', '2027-06-28',
    '2027-07-16', '2027-08-15', '2027-09-18', '2027-09-19', '2027-10-11', '2027-10-31', '2027-11-01',
    '2027-12-08', '2027-12-25',
  ],
  feriados_regionales: {
    'arica y parinacota': ['2026-06-07', '2027-06-07'],
    'nuble': ['2026-08-20', '2027-08-20'],
  },
};

const esObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** Mezcla profunda: los objetos se combinan, los arreglos y escalares del override reemplazan. */
export function mezclarConfig(base: ConfigViabilidadV4, override: unknown): ConfigViabilidadV4 {
  const mezclar = (a: any, b: any): any => {
    if (!esObj(b)) return b === undefined ? a : b;
    if (!esObj(a)) return b;
    const out: any = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = mezclar(a[k], v);
    return out;
  };
  return esObj(override) ? mezclar(base, override) : base;
}

/** Nombres de familias para inyectar en {{FAMILIAS}} del prompt (solo nombres, más OTRO). */
export function nombresFamilias(cfg: ConfigViabilidadV4): string {
  return [...cfg.familias.ALTA, ...cfg.familias.MEDIA, ...cfg.familias.COMMODITY, 'OTRO'].join(' · ');
}

/** Normaliza para comparar frases: minúsculas, sin tildes, solo letras/números y espacios. */
export function normFrase(s: unknown): string {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\[\[p[aá]gina[^\]]*\]\]/gi, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** ¿El texto calza con un requisito del catálogo? Devuelve la frase que calzó o null. */
export function calzaCatalogo(texto: string, req: RequisitoCatalogo): string | null {
  const t = ` ${normFrase(texto)} `;
  const frase = req.frases.find(f => t.includes(` ${normFrase(f)} `));
  if (!frase) return null;
  if (req.salvo?.some(x => t.includes(` ${normFrase(x)}`))) return null;
  if (req.contexto?.length && !req.contexto.some(c => t.includes(` ${normFrase(c)} `))) return null;
  return frase;
}
