// app/lib/viabilidad-v4/textos.ts
// El esquema pide ARREGLOS DE TEXTO en varios campos ("alertas":[], "para_ganar":[]…), pero un modelo puede
// devolver objetos ({tipo, descripcion}). La pantalla pinta esos elementos como hijos de React y un objeto
// la tumba entera ("Objects are not valid as a React child") — 1057448-45-LP26: la pestaña Viabilidad no
// cargaba. Aquí se convierten a texto, al guardar y al leer (así los informes ya guardados se arreglan solos).

const RUTAS_TEXTO: string[][] = [
  ['criterios_evaluacion', 'alertas'],
  ['plazos', 'alertas'],
  ['tarjeta_decision', 'para_ganar'],
  ['tarjeta_decision', 'no_quedes_fuera'],
  ['pendientes_fase3'],
  ['veredicto', 'motivos_revision'],
  ['veredicto', 'acciones_AC'],
  ['veredicto', 'advertencias'],
  ['productos', 'hallazgos_formato'],
  ['estrategia', 'donde_se_decide', 'criterios_diferenciadores'],
];

export function aTexto(x: unknown): string {
  if (typeof x === 'string') return x;
  if (x == null) return '';
  if (typeof x !== 'object') return String(x);
  const o = x as Record<string, unknown>;
  const cuerpo = [o.descripcion, o.texto, o.mensaje, o.detalle, o.valor, o.advertencia, o.riesgo].find(v => typeof v === 'string' && v.trim()) as string | undefined;
  const etiqueta = typeof o.tipo === 'string' && o.tipo.trim() ? o.tipo.trim().replace(/_/g, ' ').toLowerCase() : '';
  if (cuerpo) return etiqueta ? `${etiqueta.charAt(0).toUpperCase()}${etiqueta.slice(1)}: ${cuerpo}` : cuerpo;
  try { return JSON.stringify(x); } catch { return ''; }
}

/** Convierte a texto los elementos no-string de los arreglos de texto del informe (muta y devuelve el mismo objeto). */
export function normalizarTextosInforme<T>(inf: T): T {
  if (!inf || typeof inf !== 'object') return inf;
  for (const ruta of RUTAS_TEXTO) {
    let padre: any = inf;
    for (let i = 0; i < ruta.length - 1 && padre && typeof padre === 'object'; i++) padre = padre[ruta[i]];
    const k = ruta[ruta.length - 1];
    if (padre && typeof padre === 'object' && Array.isArray(padre[k]) && padre[k].some((e: unknown) => typeof e !== 'string')) {
      padre[k] = padre[k].map(aTexto).filter((t: string) => t.trim());
    }
  }
  return inf;
}
