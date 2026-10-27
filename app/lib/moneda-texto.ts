// app/lib/moneda-texto.ts
// La moneda que escribe el Lector no siempre es un código: en 4022-19-LE26 (cinturón EQ-27, link de Upteck) vino
// «CLP (inferido del símbolo $ y formato de miles chileno; la página no declara moneda)». El verificador compara la moneda
// con 'CLP' tal cual, así que esa frase bloqueaba el costo («el precio está en CLP (…), no en CLP») y «Corregir precio o IVA»
// no lo arreglaba porque no toca la moneda. Aquí se saca el código de la frase; si no hay uno reconocible se deja el texto
// (nunca se supone una moneda: el verificador avisa). Puro, con tests.
const CODIGOS = 'CLP|USD|EUR|CNY|GBP|BRL|ARS|MXN|PEN|JPY|CAD|UF';
const RE_CODIGO = new RegExp(`\\b(${CODIGOS})\\b`);

export function monedaDeTexto(texto: string | null | undefined): string {
  const t = String(texto ?? '').toUpperCase().trim();
  if (!t) return 'CLP';
  const codigo = t.match(RE_CODIGO);                     // el primero que aparece: «USD (equivalente a CLP…)» es USD
  if (codigo) return codigo[1];
  if (/US\$|U\$S|D[OÓ]LAR/.test(t)) return 'USD';
  if (/EURO|€/.test(t)) return 'EUR';
  if (/\bPESOS?\b|CHILEN/.test(t) || t.replace(/\s/g, '') === '$') return 'CLP';
  return t;                                             // desconocida: se deja tal cual para que el verificador avise
}
