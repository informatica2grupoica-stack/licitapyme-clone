// app/lib/viabilidad-v4/verificador-semantico.ts
// P5 · CHEQUEO SEMÁNTICO de los datos críticos (prompt auxiliar B, "Verificador de citas").
//
// Que una frase exista en las bases no basta: tiene que SOSTENER lo que el sistema quiere afirmar
// ("no se exigirá garantía" existe, pero no sostiene "se exige garantía"). Se hace UNA llamada por
// análisis con todos los pares juntos, después de que el código ubicó cada frase. SI → verificado;
// PARCIAL o NO → no verificado (ámbar) y, si el dato es crítico, revisión humana (V-25).
// Si la llamada falla, los pares quedan NO_EVALUADA: la frase igual se encontró literal, y no se
// manda todo a revisión humana por una caída de la IA (se deja aviso en el informe).

export interface ParSemantico {
  id: number;
  afirmacion: string;
  documento: string;
  numeral: string;
  frase: string;
  /** La cita del informe que se marca con el resultado. */
  cita: { semantica?: string; motivo_semantica?: string };
}

export const SYSTEM_VERIFICADOR = `Eres un verificador de citas de bases de licitaciones públicas chilenas.
Recibes una lista de pares: una AFIRMACIÓN que el sistema quiere sostener y la
FRASE textual de las bases que la respalda. Para cada par, responde si la
frase, por sí sola, sostiene la afirmación.

Reglas:
- Juzga solo con la frase. No uses conocimiento externo ni supongas contexto
  que no está escrito.
- SI: la frase dice lo que dice la afirmación, aunque con otras palabras.
- PARCIAL: la frase sostiene una parte, no toda (por ejemplo, el plazo pero no
  el evento desde el que corre).
- NO: la frase dice otra cosa, dice lo contrario o es demasiado general.
- Una negación cambia el sentido: "no se exigirá garantía" NO sostiene "se
  exige garantía".
- No corrijas ni completes la afirmación.

Responde SOLO JSON:
{"resultados":[{"id":1,"sostiene":"SI|PARCIAL|NO","motivo":"una línea"}]}`;

export function construirUserVerificador(pares: ParSemantico[]): string {
  return `Verifica cada par:\n${pares.map(p => `${p.id}. AFIRMACIÓN: ${p.afirmacion}
   FRASE (${p.documento}, ${p.numeral}): "${p.frase}"`).join('\n')}`;
}

/** Corre el verificador (en tandas de 40) y marca `cita.semantica`. Nunca lanza. */
export async function verificarSemantica(
  pares: ParSemantico[],
  preguntar: (system: string, user: string) => Promise<any>,
): Promise<{ evaluados: number; fallo: string | null }> {
  if (!pares.length) return { evaluados: 0, fallo: null };
  let evaluados = 0;
  let fallo: string | null = null;
  for (let i = 0; i < pares.length; i += 40) {
    const tanda = pares.slice(i, i + 40);
    try {
      const r = await preguntar(SYSTEM_VERIFICADOR, construirUserVerificador(tanda));
      const res: any[] = Array.isArray(r?.resultados) ? r.resultados : [];
      for (const p of tanda) {
        const x = res.find(y => Number(y?.id) === p.id);
        const s = String(x?.sostiene || '').toUpperCase();
        p.cita.semantica = s === 'SI' || s === 'PARCIAL' || s === 'NO' ? s : 'NO_EVALUADA';
        if (x?.motivo) p.cita.motivo_semantica = String(x.motivo).slice(0, 200);
        if (p.cita.semantica !== 'NO_EVALUADA') evaluados++;
      }
    } catch (e) {
      fallo = String((e as any)?.message ?? e).slice(0, 160);
      for (const p of tanda) p.cita.semantica = 'NO_EVALUADA';
    }
  }
  return { evaluados, fallo };
}
