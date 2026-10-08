// app/lib/compras-despacho.ts
// QUIÉN LLEVA LA MERCADERÍA y CUÁNTO CUESTA EL FLETE, por cotización (migration-141). Puro: sin red ni BD,
// lo usan la pantalla y el servidor.
//
// Son dos preguntas distintas. El motor de escenarios sigue leyendo `incluyeFlete` + `fleteMonto`
// (compras-auditor.ts), así que `aplicarDespacho` las deriva de las dos respuestas.

export type DespachoModalidad = 'PROVEEDOR' | 'RETIRO_PROPIO' | 'TRANSPORTISTA' | 'TIENDA';
export type FleteCondicion = 'INCLUIDO' | 'SIN_COSTO' | 'APARTE' | 'POR_CONFIRMAR';

export const DESPACHO_OPCIONES: { value: DespachoModalidad; label: string }[] = [
  { value: 'PROVEEDOR', label: 'El proveedor despacha' },
  { value: 'RETIRO_PROPIO', label: 'Lo retiramos nosotros' },
  { value: 'TRANSPORTISTA', label: 'Lo trae un transportista que contratamos' },
  { value: 'TIENDA', label: 'Compra en tienda / retiro presencial' },
];

export const CONDICION_OPCIONES: { value: FleteCondicion; label: string }[] = [
  { value: 'INCLUIDO', label: 'Incluido en el precio' },
  { value: 'SIN_COSTO', label: 'Sin costo' },
  { value: 'APARTE', label: 'Se cobra aparte (con monto neto)' },
  { value: 'POR_CONFIRMAR', label: 'Por confirmar' },
];

const DESPACHOS = new Set<string>(DESPACHO_OPCIONES.map(o => o.value));
const CONDICIONES = new Set<string>(CONDICION_OPCIONES.map(o => o.value));
export const esDespacho = (v: unknown): v is DespachoModalidad => typeof v === 'string' && DESPACHOS.has(v);
export const esCondicion = (v: unknown): v is FleteCondicion => typeof v === 'string' && CONDICIONES.has(v);

/** «Incluido en el precio» solo tiene sentido si despacha el proveedor. */
export const condicionesPara = (despacho: string | null | undefined) =>
  CONDICION_OPCIONES.filter(o => o.value !== 'INCLUIDO' || !despacho || despacho === 'PROVEEDOR');

/** Cotizaciones antiguas (o lo que sugiere el agente) solo traen incluyeFlete + fleteMonto: qué condición es. */
export function condicionDesdeLegacy(incluyeFlete: boolean | null | undefined, fleteMonto: number | null | undefined): FleteCondicion | '' {
  if (incluyeFlete == null) return '';
  if (incluyeFlete) return 'INCLUIDO';
  if (fleteMonto === 0) return 'SIN_COSTO';
  return fleteMonto != null ? 'APARTE' : 'POR_CONFIRMAR';
}

/** Lo que entiende el motor de escenarios (incluye_flete, flete_monto) a partir de las dos respuestas. */
export function aplicarDespacho(
  despacho: string | null | undefined, condicion: string | null | undefined, monto: number | null | undefined,
): { incluyeFlete: boolean | null; fleteMonto: number | null } {
  switch (condicion) {
    case 'INCLUIDO': return { incluyeFlete: true, fleteMonto: null };
    // El proveedor despacha gratis = el flete ya viene resuelto (igual que «incluido»); retiro propio gratis = $0 explícito.
    case 'SIN_COSTO': return despacho === 'PROVEEDOR' ? { incluyeFlete: true, fleteMonto: null } : { incluyeFlete: false, fleteMonto: 0 };
    case 'APARTE': return { incluyeFlete: false, fleteMonto: monto != null && monto > 0 ? monto : null };
    case 'POR_CONFIRMAR': return { incluyeFlete: false, fleteMonto: null };
    default: return { incluyeFlete: null, fleteMonto: monto ?? null };
  }
}
