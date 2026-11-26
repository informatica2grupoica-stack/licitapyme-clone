// app/lib/compras-avance-aviso-core.ts
// AVISO ENTRE ENCARGADOS: cuando uno de los que trabajan una licitación en Compras hace algo importante, el otro lo ve en su campana.
// Decisión PURA (sin red ni BD): qué acciones avisan, con qué texto, a quién y cada cuánto. La parte con base de datos está en compras-avisos.ts.

export type CategoriaAvance = 'cotizacion' | 'escenario' | 'aprobacion' | 'sku' | 'oc' | 'estado' | 'tarea';

/** Minutos sin repetir el MISMO aviso de la MISMA persona (cargar 20 cotizaciones seguidas = 1 aviso, no 20). 0 = siempre avisa. */
export const ESPERA_MIN: Record<CategoriaAvance, number> = { cotizacion: 15, sku: 15, tarea: 15, escenario: 0, aprobacion: 0, oc: 0, estado: 0 };

/** Frase fija para lo que se hace muchas veces seguidas; el resto usa la frase de la bitácora. */
const FRASE_GENERICA: Partial<Record<CategoriaAvance, string>> = {
  cotizacion: 'está cargando cotizaciones', sku: 'está creando SKU', tarea: 'está cerrando tareas',
};

/** ¿Esta acción de escritura es un avance que el otro encargado debe enterarse? `rutaRel` es la ruta sin /api/compras/<id>/. */
export function categoriaDeAvance(metodo: string, rutaRel: string, cuerpo: Record<string, any> | null, esTarea = false): CategoriaAvance | null {
  const c = cuerpo || {};
  const partes = rutaRel.split('/').filter(Boolean);
  const raiz = partes[0] || '';
  const m = metodo.toUpperCase();
  if (esTarea) return String(c.estado || '').toUpperCase() === 'HECHA' ? 'tarea' : null;
  switch (raiz) {
    case 'cotizaciones':
      // Cargar, leer con IA, restaurar o eliminar una cotización. Asignar productos, auditar u homologar son pasos internos: no avisan.
      if (partes[1] === 'extraer' || partes[1] === 'restaurar') return 'cotizacion';
      if (partes.length === 1 && m === 'POST') return 'cotizacion';
      if (partes.length === 2 && m === 'DELETE') return 'cotizacion';
      return null;
    case 'escenarios': return m === 'POST' || m === 'PATCH' ? 'escenario' : null;
    case 'aprobaciones': return 'aprobacion';
    case 'sku': return partes[2] === 'verificar-obuma' ? null : 'sku';
    case 'orden-compra-obuma': return partes[1] === 'proveedor' ? null : 'oc';
    case 'orden-compra': return partes[1] === 'buscar' ? null : 'oc';
    case 'estado-compra': return 'estado';
    default: return null;
  }
}

/** Texto del aviso: «Carolina: está cargando cotizaciones en 1426039-8-LE26. Mira el avance.» */
export function textoAvisoAvance(categoria: CategoriaAvance, actorNombre: string | null, frasePrimeraPersona: string, codigo: string | null): string {
  const quien = actorNombre || 'Alguien';
  const que = FRASE_GENERICA[categoria] ?? frasePrimeraPersona.charAt(0).toLowerCase() + frasePrimeraPersona.slice(1);
  return `${quien} ${que}${codigo ? ` en ${codigo}` : ''}. Mira el avance de la licitación.`;
}

/** A quién avisar: el encargado principal y los otros encargados, SIN quien hizo la acción. `soloYo` (local / freno): solo a quien la hizo. */
export function destinatariosAvance(
  a: { asignadoA: number | null; asignadoNombre: string | null; coencargados: Array<{ id: number; nombre: string | null }> },
  actor: { id: number; nombre: string | null }, soloYo: boolean,
): Array<{ id: number; nombre: string | null }> {
  if (soloYo) return [{ id: actor.id, nombre: actor.nombre }];
  const m = new Map<number, string | null>();
  if (a.asignadoA) m.set(a.asignadoA, a.asignadoNombre ?? null);
  for (const c of a.coencargados || []) m.set(c.id, c.nombre ?? null);
  m.delete(actor.id);
  return [...m].map(([id, nombre]) => ({ id, nombre }));
}
