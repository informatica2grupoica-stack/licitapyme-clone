// app/lib/anexos-diccionario.ts
// Frente E.1 — cruza una etiqueta detectada en el Word ("Razón social", "RUT"...) contra los
// datos reales de la empresa (tabla `empresas`). A propósito es CONSERVADOR: varias etiquetas
// se repiten en un mismo documento con significados distintos según el bloque en que caen
// ("Nombre" y "Cédula de identidad" aparecen tanto para el representante legal como para el
// director del estudio, en documentos reales) — sin detectar en qué bloque cae cada una, un
// diccionario ciego adivinaría mal la segunda vez. Por eso esas etiquetas ambiguas NO están
// en este diccionario (ni "Nombre" ni "Correo electrónico" a secas): solo entran las que, tal
// cual vienen escritas, ya dicen a QUIÉN describen (empresa, representante legal, o banco) —
// nunca se inventan, quedan siempre en categoría B (humano completa) o van al respaldo IA
// (ver anexos-ia-matching.ts) si ni así calzan.
export interface EmpresaCampos {
  razon_social: string | null;
  rut: string | null;
  direccion: string | null;
  region: string | null;
  giro: string | null;
  tipo_persona_juridica: string | null;
  fecha_sociedad: string | null;
  representante_nombre: string | null;
  representante_rut: string | null;
  representante_cargo: string | null;
  email1: string | null;
  telefono1: string | null;
  banco_tipo_cuenta: string | null;
  banco_numero: string | null;
  banco_nombre: string | null;
  banco_email: string | null;
}

interface EntradaDiccionario {
  campo: keyof EmpresaCampos;
  patrones: RegExp[];   // se prueban en orden; la primera que matchee la etiqueta completa gana
}

// Sufijo opcional "del oferente / de la empresa / del proponente" — en anexos reales de
// distintos organismos la MISMA pregunta viene con cualquiera de estos tres remates ("RUT",
// "RUT del oferente", "RUT. DEL PROPONENTE"…). Encontrado al comparar contra 20 anexos ya
// presentados de verdad (golden set en Downloads, jul-2026): sin este sufijo, "RUT DEL
// OFERENTE:" o "NOMBRE O RAZÓN SOCIAL DEL PROPONENTE" no matcheaban con nada.
const SUFIJO_OFERENTE = '(\\s+(del\\s+|de\\s+la\\s+)?(empresa|oferente|proponente))?';

const DICCIONARIO: EntradaDiccionario[] = [
  { campo: 'razon_social', patrones: [
    new RegExp(`^raz[óo]n\\s+social${SUFIJO_OFERENTE}$`, 'i'),
    new RegExp(`^nombre\\s+o\\s+raz[óo]n\\s+social${SUFIJO_OFERENTE}$`, 'i'),
    new RegExp(`^nombre\\s+del\\s+(proponente|oferente)\\s+o\\s+raz[óo]n\\s+social$`, 'i'),
    /^empresa$/i,
  ] },
  { campo: 'rut', patrones: [
    /^rol\s+[úu]nico\s+tributario$/i,
    new RegExp(`^r\\.?u\\.?t\\.?${SUFIJO_OFERENTE}$`, 'i'),
  ] },
  { campo: 'direccion', patrones: [
    new RegExp(`^direcci[óo]n(\\s+comercial)?${SUFIJO_OFERENTE}$`, 'i'),
    new RegExp(`^domicilio(\\s+comercial)?${SUFIJO_OFERENTE}$`, 'i'),
  ] },
  { campo: 'region', patrones: [/^regi[óo]n$/i] },
  { campo: 'giro', patrones: [/^giro(\s+comercial)?(\s*\/\s*c[óo]digo\s+sii)?$/i] },
  { campo: 'tipo_persona_juridica', patrones: [/^tipo\s+de\s+persona\s+jur[íi]dica$/i, /^naturaleza\s+jur[íi]dica$/i] },
  { campo: 'fecha_sociedad', patrones: [/^escritura\s+p[úu]blica.*$/i, /^fecha\s+(de\s+)?(la\s+)?sociedad$/i, /^fecha\s+(de\s+)?constituci[óo]n$/i] },
  { campo: 'representante_nombre', patrones: [
    /^nombre\s+(completo\s+)?(del\s+|de\s+)?rep(\.|resentante)?\s*legal$/i,
    /^representante\s+legal$/i,
  ] },
  { campo: 'representante_rut', patrones: [
    /^r\.?u\.?t\.?\s+(del\s+|de\s+)?rep(\.|resentante)?\s*legal$/i,
    /^c[ée]dula\s+de\s+identidad\s+(del\s+)?rep(\.|resentante)?\s*legal$/i,
  ] },
  { campo: 'representante_cargo', patrones: [/^cargo\s+(del\s+)?rep(\.|resentante)?\s*legal$/i] },
  { campo: 'email1', patrones: [
    new RegExp(`^correo\\s+electr[óo]nico${SUFIJO_OFERENTE}$`, 'i'),
    new RegExp(`^e-?mail${SUFIJO_OFERENTE}$`, 'i'),
  ] },
  { campo: 'telefono1', patrones: [
    new RegExp(`^tel[ée]fono(s)?(\\s+fijo)?${SUFIJO_OFERENTE}$`, 'i'),
    /^fono$/i,
  ] },
  { campo: 'banco_tipo_cuenta', patrones: [/^tipo\s+de\s+cuenta(\s+bancaria)?$/i] },
  { campo: 'banco_numero', patrones: [/^n[úu]mero\s+de\s+cuenta$/i, /^cuenta\s+(bancaria|corriente)$/i] },
  { campo: 'banco_nombre', patrones: [/^banco$/i] },
  { campo: 'banco_email', patrones: [/^correo\s+(para\s+)?pagos$/i, /^e-?mail\s+de\s+pagos$/i] },
];

// Quita numeración/viñetas al INICIO ("1.1. Nombre o Razón Social" → "Nombre o Razón Social") y
// puntuación colgante al FINAL ("RUT del oferente:" → "RUT del oferente") antes de comparar — el
// diccionario exige match de principio a fin, y los anexos reales casi siempre numeran sus
// campos y cierran con dos puntos. Exige un ESPACIO después del separador de numeración para no
// confundir una abreviatura real ("E-mail") con una viñeta ("a) ").
function normalizarParaMatch(etiqueta: string): string {
  return etiqueta
    .trim()
    .replace(/^\(?\d+(?:\.\d+)*[.\-)]?\s+/, '')
    .replace(/^\(?[a-hA-H]\)\s+/, '')
    .replace(/[:.\s]+$/, '')
    .trim();
}

export interface Coincidencia { campo: keyof EmpresaCampos; valor: string }

// Devuelve el campo+valor si la etiqueta cruza con el diccionario Y la empresa tiene ese dato
// cargado; null si no hay match confiable (queda para el respaldo IA o la pantalla de "completar
// a mano").
export function buscarCampo(etiqueta: string, empresa: EmpresaCampos): Coincidencia | null {
  const limpia = normalizarParaMatch(etiqueta);
  for (const entrada of DICCIONARIO) {
    if (entrada.patrones.some(re => re.test(limpia))) {
      const valor = empresa[entrada.campo];
      if (valor != null && String(valor).trim()) return { campo: entrada.campo, valor: String(valor) };
      return null; // etiqueta reconocida pero la empresa no tiene ese dato cargado
    }
  }
  return null;
}
