// Tests de excluirYaExistentes() — el dedupe CONTRA LO YA PERSISTIDO que sincronizar()
// (app/api/negocios/[id]/comercial/route.ts) corre antes de insertar. Cubre el hueco que
// generarItemsDesdeViabilidad() no puede ver: un re-análisis que redacta el MISMO Anexo N°X con
// otras palabras, cuya clave_origen (slug del título) cambia y el UNIQUE(negocio_id, clave_origen)
// no detecta como repetido. Confirmado 24-ago-2026 contra producción: 83 grupos duplicados en 183
// negocios, todos por esta causa. Correr con:
//   npx tsx --test app/lib/__tests__/checklist-comercial-cross-sync.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { excluirYaExistentes, type ItemGenerado } from '../checklist-comercial';

function itemAnexo(titulo: string): ItemGenerado {
  return {
    bloque: 'ADMINISTRATIVO', tipo: 'documento', titulo, descripcion: null,
    criticidad: 'ADMISIBILIDAD_DURA', ponderacion: null, fuenteCita: null, origen: 'viabilidad',
    claveOrigen: `anexo:${titulo.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    generable: true, lineaNumero: null, orden: 0,
  };
}

test('excluirYaExistentes: descarta un Anexo N°X redactado distinto si YA existe con otra redacción', () => {
  const nuevos = [itemAnexo('Anexo N°6 - Programa Integridad')];
  const existentes = ['Anexo N°6: "Declaración Jurada Programa De Integridad y Ética Empresarial"'];
  assert.equal(excluirYaExistentes(nuevos, existentes).length, 0);
});

test('excluirYaExistentes: conserva un Anexo con N° explícito distinto aunque el texto se parezca', () => {
  const nuevos = [itemAnexo('Anexo N°5 (Declaración Jurada Ausencia Conflictos de Intereses)')];
  const existentes = ['Anexo N°3 (Declaración Jurada Ausencia Conflictos de Intereses)'];
  assert.equal(excluirYaExistentes(nuevos, existentes).length, 1);
});

test('excluirYaExistentes: conserva un anexo nuevo de verdad (no está entre los existentes)', () => {
  const nuevos = [itemAnexo('Anexo N°9: Cuadro Resumen de Antecedentes Técnicos')];
  const existentes = ['Anexo N°1: Identificación del Oferente', 'Garantía de Fiel Cumplimiento'];
  assert.equal(excluirYaExistentes(nuevos, existentes).length, 1);
});

test('excluirYaExistentes: no toca ítems fuera de ADMINISTRATIVO ni los que no son "anexo:..." (clave fija/criterio)', () => {
  const precio: ItemGenerado = {
    bloque: 'COMERCIAL', tipo: 'precio', titulo: 'Precio total ofertado', descripcion: null,
    criticidad: 'ADMISIBILIDAD_DURA', ponderacion: null, fuenteCita: null, origen: 'modalidad',
    claveOrigen: 'precio:total', generable: false, lineaNumero: null, orden: 0,
  };
  const exigencia: ItemGenerado = {
    bloque: 'ADMINISTRATIVO', tipo: 'documento', titulo: 'Garantía de fiel cumplimiento', descripcion: null,
    criticidad: 'ADMISIBILIDAD_DURA', ponderacion: null, fuenteCita: null, origen: 'viabilidad',
    claveOrigen: 'adm:garantia_fiel_cumplimiento', generable: false, lineaNumero: null, orden: 0,
  };
  // Aunque el título de "exigencia" calce con algo existente, su clave NO empieza con "anexo:"
  // (es fija: adm:garantia_fiel_cumplimiento) — el UNIQUE ya la protege sola, sin ayuda del fuzzy.
  const existentes = ['Garantía de Fiel Cumplimiento (Póliza)'];
  const resultado = excluirYaExistentes([precio, exigencia], existentes);
  assert.equal(resultado.length, 2);
});
