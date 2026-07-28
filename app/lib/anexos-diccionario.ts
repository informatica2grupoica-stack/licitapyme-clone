// app/lib/anexos-diccionario.ts
// Frente E.1 — cruza una etiqueta detectada en el Word ("Razón social", "RUT"...) contra los
// datos reales de la empresa (tabla `empresas`). A propósito es CONSERVADOR: varias etiquetas
// se repiten en un mismo documento con significados distintos según el bloque en que caen
// ("Nombre" y "Cédula de identidad" aparecen tanto para el representante legal como para el
// director del estudio, en documentos reales) — sin detectar en qué bloque cae cada una, un
// diccionario ciego adivinaría mal la segunda vez. Por eso esas etiquetas ambiguas NO están
// en este diccionario: quedan siempre en categoría B (humano completa), nunca se inventan.
//
// Solo entran acá las etiquetas que, en los 4 documentos reales probados, aparecen UNA sola
// vez por sección y sin ambigüedad de a quién describen (la empresa, no una persona dentro
// de ella).
export interface EmpresaCampos {
  razon_social: string | null;
  rut: string | null;
  direccion: string | null;
  giro: string | null;
  email1: string | null;
  telefono1: string | null;
}

interface EntradaDiccionario {
  campo: keyof EmpresaCampos;
  patrones: RegExp[];   // se prueban en orden; la primera que matchee la etiqueta completa gana
}

const DICCIONARIO: EntradaDiccionario[] = [
  { campo: 'razon_social', patrones: [/^raz[óo]n\s+social$/i, /^nombre\s+o\s+raz[óo]n\s+social$/i] },
  { campo: 'rut', patrones: [/^rol\s+[úu]nico\s+tributario$/i, /^r\.?u\.?t\.?\s*(empresa|oferente)?$/i] },
  { campo: 'direccion', patrones: [/^direcci[óo]n$/i, /^domicilio$/i] },
  { campo: 'giro', patrones: [/^giro(\s+comercial)?(\s*\/\s*c[óo]digo\s+sii)?$/i] },
  { campo: 'email1', patrones: [/^correo\s+electr[óo]nico$/i, /^e-?mail$/i] },
  { campo: 'telefono1', patrones: [/^tel[ée]fono(\s+fijo)?$/i] },
];

export interface Coincidencia { campo: keyof EmpresaCampos; valor: string }

// Devuelve el campo+valor si la etiqueta cruza con el diccionario Y la empresa tiene ese dato
// cargado; null si no hay match confiable (queda para la pantalla de "completar a mano").
export function buscarCampo(etiqueta: string, empresa: EmpresaCampos): Coincidencia | null {
  const limpia = etiqueta.trim();
  for (const entrada of DICCIONARIO) {
    if (entrada.patrones.some(re => re.test(limpia))) {
      const valor = empresa[entrada.campo];
      if (valor != null && String(valor).trim()) return { campo: entrada.campo, valor: String(valor) };
      return null; // etiqueta reconocida pero la empresa no tiene ese dato cargado
    }
  }
  return null;
}
