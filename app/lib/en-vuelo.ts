// app/lib/en-vuelo.ts
// Lecturas pesadas (el panel del Auditor, Pre-postulación) que la pantalla pide varias veces a la vez: cada pestaña monta
// 2-3 componentes y cada uno hace su fetch. La base es remota (~155 ms por consulta), así que armar el panel cuesta segundos
// y se armaba 3-5 veces en paralelo. Aquí quien llega mientras otra lectura IGUAL sigue en curso espera ese mismo resultado.
// NO es un caché: al terminar la lectura se olvida (nada queda viejo), y las rutas que escriben llaman a `invalidarEnVuelo`
// para que una lectura iniciada ANTES de la escritura no se la sirvan a quien pide después.
const enCurso = new Map<string, Promise<unknown>>();

export function compartirEnVuelo<T>(clave: string, leer: () => Promise<T>): Promise<T> {
  const ya = enCurso.get(clave) as Promise<T> | undefined;
  if (ya) return ya;
  const p = leer().finally(() => { if (enCurso.get(clave) === p) enCurso.delete(clave); });
  enCurso.set(clave, p);
  return p;
}

/** Olvida las lecturas en curso de un negocio (se llama al escribir). */
export function invalidarEnVuelo(negocioId: number): void {
  const pref = `:${negocioId}:`;
  for (const k of [...enCurso.keys()]) if (k.includes(pref)) enCurso.delete(k);
}
