// ¿La pantalla del Auditor manda alguna acción que el servidor no acepta?
//
// BUG REAL QUE ESTE TEST EXISTE PARA CAZAR (26-ago-2026): al agregar el acuse de lectura de las
// alertas de cumplimiento se sumó el botón "Marcar como visto" (que manda ACUSAR) y la rama que lo
// procesa, pero NO la lista blanca de acciones del PATCH — que estaba escrita a mano dentro del
// route. Resultado: el botón se veía perfecto, y al apretarlo devolvía "Petición inválida" sin
// decir qué faltaba. `tsc` no lo ve (son strings), la suite tampoco lo veía (nadie cruzaba las dos
// puntas) y solo apareció cuando el usuario lo apretó en producción.
//
// El test lee el componente REAL y cruza cada `onAccion(..., 'X')` contra ACCIONES_ITEM. No es
// elegante leer un .tsx desde un test, pero es la única forma de que un olvido en cualquiera de
// las dos puntas falle acá y no en la cara del usuario.
//
// Correr con:
//   npx tsx --test app/lib/__tests__/checklist-acciones.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACCIONES_ITEM, transicion } from '../checklist-comercial';

const COMPONENTES = [
  'app/negocios/[id]/InformacionComercialSection.tsx',
  'app/negocios/[id]/FilaLineaTecnica.tsx',
  'app/components/ModalAuditorLineaTecnica.tsx',
];

/** Todas las acciones que la UI manda por `onAccion(algo, 'ACCION')`. */
function accionesQueMandaLaUI(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const ruta of COMPONENTES) {
    let src: string;
    try { src = readFileSync(ruta, 'utf8'); } catch { continue; }
    for (const m of src.matchAll(/onAccion\s*\(\s*[^,]+,\s*'([A-Z_]+)'/g)) {
      const accion = m[1];
      if (!out.has(accion)) out.set(accion, []);
      out.get(accion)!.push(ruta);
    }
  }
  return out;
}

test('toda acción que la pantalla manda está en la lista blanca del servidor', () => {
  const permitidas = new Set<string>(ACCIONES_ITEM);
  const desconocidas: string[] = [];
  for (const [accion, archivos] of accionesQueMandaLaUI()) {
    if (!permitidas.has(accion)) desconocidas.push(`${accion} (en ${archivos.join(', ')})`);
  }
  assert.deepEqual(desconocidas, [],
    `La UI manda acciones que el PATCH rechazaría con "Petición inválida": ${desconocidas.join(' · ')}`);
});

test('la pantalla encontró acciones de verdad (si no, el test de arriba pasa por vacío)', () => {
  const encontradas = accionesQueMandaLaUI();
  assert.ok(encontradas.size >= 3, `Solo se detectaron ${encontradas.size} acciones — ¿cambió la forma de llamar a onAccion?`);
  // Las dos puntas del circuito de doble firma tienen que estar sí o sí.
  assert.ok(encontradas.has('CARGAR'));
  assert.ok(encontradas.has('APROBAR'));
});

test('el acuse de lectura de las alertas está permitido en el servidor', () => {
  assert.ok(ACCIONES_ITEM.includes('ACUSAR'));
  assert.ok(ACCIONES_ITEM.includes('DESACUSAR'));
});

// ACUSAR/DESACUSAR se resuelven ANTES de transicion() con su propia lógica. Si alguien las hiciera
// pasar por ahí sin darse cuenta, transicion() devolvería null y el route respondería
// "No se puede acusar un punto en estado PENDIENTE" — un error confuso en vez del acuse.
test('transicion() sigue modelando SOLO la doble firma (el acuse no pasa por ahí)', () => {
  assert.equal(transicion('PENDIENTE', 'CARGAR'), 'CARGADO');
  assert.equal(transicion('CARGADO', 'APROBAR'), 'APROBADO');
  assert.equal(transicion('PENDIENTE', 'APROBAR'), null);
  assert.equal(transicion('PENDIENTE', 'ACUSAR' as never), null);
});
