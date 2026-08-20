// Motor de reparto del Puente del Radar (20-ago-2026).
// Lo que se prueba aquí es lo que el asesor ve en la vista previa: que 30 entre 3 sean 10/10/10,
// que "nivelar carga" de verdad empareje, que las reglas manden sobre el reparto parejo y que
// simular dos veces con la misma semilla dé exactamente lo mismo (si no, la vista previa miente).
//   npx tsx --test app/lib/__tests__/puente-reparto.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repartir, type LicitacionPuente, type PerfilDestino } from '../puente-reparto';

const lic = (n: number, extra: Partial<LicitacionPuente> = {}): LicitacionPuente => ({
  id: n,
  licitacion_codigo: `${1000 + n}-1-LE26`,
  licitacion_nombre: `Licitación ${n}`,
  licitacion_organismo: 'Municipalidad de Prueba',
  licitacion_monto: null,
  licitacion_cierre: null,
  licitacion_estado: 'Publicada',
  licitacion_tipo: 'LE',
  licitacion_region: null,
  categoria_nombre: null,
  viabilidad_semaforo: null,
  ...extra,
});

const perfil = (id: number, cargaActual = 0): PerfilDestino =>
  ({ id, nombre: `Perfil ${id}`, email: `p${id}@ica.cl`, cargaActual });

const cuenta = (r: ReturnType<typeof repartir>) =>
  r.porPerfil.map(p => p.asignadas);

test('equitativa: 30 licitaciones entre 3 perfiles → 10/10/10', () => {
  const licitaciones = Array.from({ length: 30 }, (_, i) => lic(i));
  const perfiles = [perfil(1), perfil(2), perfil(3)];
  const r = repartir(licitaciones, perfiles, { estrategia: 'equitativa', perfiles: [1, 2, 3], semilla: 7 });

  assert.deepEqual(cuenta(r), [10, 10, 10]);
  assert.equal(r.sinAsignar.length, 0);
  // Ninguna se pierde ni se duplica.
  assert.equal(new Set(r.asignaciones.map(a => a.codigo)).size, 30);
});

test('equitativa: 31 entre 4 → 8/8/8/7 (el resto no se pierde ni se duplica)', () => {
  const licitaciones = Array.from({ length: 31 }, (_, i) => lic(i));
  const perfiles = [perfil(1), perfil(2), perfil(3), perfil(4)];
  const r = repartir(licitaciones, perfiles, { estrategia: 'equitativa', perfiles: [1, 2, 3, 4], semilla: 3 });

  const c = cuenta(r).sort((a, b) => b - a);
  assert.deepEqual(c, [8, 8, 8, 7]);
  assert.equal(r.asignaciones.filter(a => a.usuarioId != null).length, 31);
});

test('carga: nivela de verdad — el que venía cargado recibe menos', () => {
  // Juan ya tiene 12 vigentes, Ana 4 y Pedro 2. Con 12 nuevas, lo máximo que se puede emparejar
  // es dejar a Ana y Pedro en 9 (a Juan no se le puede QUITAR carga, solo no darle más).
  const licitaciones = Array.from({ length: 12 }, (_, i) => lic(i));
  const perfiles = [perfil(1, 12), perfil(2, 4), perfil(3, 2)];
  const r = repartir(licitaciones, perfiles, { estrategia: 'carga', perfiles: [1, 2, 3], semilla: 11 });

  assert.deepEqual(r.porPerfil.map(p => p.cargaDespues), [12, 9, 9]);
  assert.deepEqual(cuenta(r), [0, 5, 7], 'Juan no recibe ninguna; el más desocupado recibe más');
  assert.equal(r.asignaciones.filter(a => a.usuarioId != null).length, 12);
});

test('carga: con todos empatados en cero se comporta como el reparto equitativo', () => {
  const licitaciones = Array.from({ length: 9 }, (_, i) => lic(i));
  const r = repartir(licitaciones, [perfil(1), perfil(2), perfil(3)],
    { estrategia: 'carga', perfiles: [1, 2, 3], semilla: 2 });
  assert.deepEqual(cuenta(r), [3, 3, 3]);
});

test('categoría: lo que calza va por regla; el resto cae al reparto parejo', () => {
  const licitaciones = [
    ...Array.from({ length: 4 }, (_, i) => lic(i,      { categoria_nombre: 'Ferretería' })),
    ...Array.from({ length: 2 }, (_, i) => lic(10 + i, { categoria_nombre: 'Aseo' })),
    ...Array.from({ length: 4 }, (_, i) => lic(20 + i, { categoria_nombre: null })),
  ];
  const perfiles = [perfil(1), perfil(2), perfil(3)];
  const r = repartir(licitaciones, perfiles, {
    estrategia: 'categoria',
    perfiles: [1, 2, 3],
    // Sin tilde y en minúsculas a propósito: la comparación normaliza.
    reglas: [{ valor: 'ferreteria', usuarioId: 1 }, { valor: 'ASEO', usuarioId: 2 }],
    fallback: 'equitativa',
    semilla: 5,
  });

  const de = (uid: number) => r.asignaciones.filter(a => a.usuarioId === uid).length;
  assert.ok(de(1) >= 4, 'las 4 de ferretería van al perfil 1');
  assert.ok(de(2) >= 2, 'las 2 de aseo van al perfil 2');
  assert.equal(r.sinAsignar.length, 0, 'las 4 sin categoría se reparten igual');
  assert.equal(r.asignaciones.filter(a => a.usuarioId != null).length, 10);
});

test('categoría con fallback "ninguno": lo que ninguna regla alcanza se queda en el puente', () => {
  const licitaciones = [lic(1, { categoria_nombre: 'Ferretería' }), lic(2, { categoria_nombre: 'Otra cosa' })];
  const r = repartir(licitaciones, [perfil(1), perfil(2)], {
    estrategia: 'categoria', perfiles: [1, 2],
    reglas: [{ valor: 'Ferretería', usuarioId: 1 }],
    fallback: 'ninguno', semilla: 1,
  });
  assert.equal(r.sinAsignar.length, 1);
  assert.equal(r.sinAsignar[0], licitaciones[1].licitacion_codigo);
});

test('monto: cada tramo a su perfil; desde inclusivo, hasta exclusivo', () => {
  const licitaciones = [
    lic(1, { licitacion_monto: 1_000_000 }),
    lic(2, { licitacion_monto: 5_000_000 }),   // borde: entra al tramo de arriba
    lic(3, { licitacion_monto: 80_000_000 }),
  ];
  const r = repartir(licitaciones, [perfil(1), perfil(2), perfil(3)], {
    estrategia: 'monto', perfiles: [1, 2, 3],
    tramos: [
      { desde: null,        hasta: 5_000_000,  usuarioId: 1 },
      { desde: 5_000_000,   hasta: 50_000_000, usuarioId: 2 },
      { desde: 50_000_000,  hasta: null,       usuarioId: 3 },
    ],
    fallback: 'ninguno', semilla: 1,
  });
  const uid = (codigo: string) => r.asignaciones.find(a => a.codigo === codigo)!.usuarioId;
  assert.equal(uid(licitaciones[0].licitacion_codigo), 1);
  assert.equal(uid(licitaciones[1].licitacion_codigo), 2);
  assert.equal(uid(licitaciones[2].licitacion_codigo), 3);
});

test('monto sin presupuesto publicado: no calza ningún tramo → al fallback', () => {
  const licitaciones = [lic(1, { licitacion_monto: null })];
  const r = repartir(licitaciones, [perfil(1)], {
    estrategia: 'monto', perfiles: [1],
    tramos: [{ desde: null, hasta: null, usuarioId: 1 }],
    fallback: 'equitativa', semilla: 1,
  });
  assert.equal(r.asignaciones[0].usuarioId, 1);
  assert.match(r.asignaciones[0].motivo, /parejo/);
});

test('determinismo: misma semilla ⇒ mismo reparto (la vista previa no puede mentir)', () => {
  const licitaciones = Array.from({ length: 25 }, (_, i) => lic(i));
  const perfiles = [perfil(1), perfil(2), perfil(3)];
  const cfg = { estrategia: 'equitativa' as const, perfiles: [1, 2, 3], semilla: 123456 };

  const a = repartir(licitaciones, perfiles, cfg);
  const b = repartir(licitaciones, perfiles, cfg);
  assert.deepEqual(a.asignaciones, b.asignaciones);

  // Con otra semilla el reparto cambia (si no, el "random" no sería random).
  const c = repartir(licitaciones, perfiles, { ...cfg, semilla: 654321 });
  assert.notDeepEqual(c.asignaciones, a.asignaciones);
  assert.deepEqual(cuenta(c), cuenta(a), 'pero los totales siguen siendo parejos');
});

test('manual: manda lo que el asesor movió a mano; lo que no movió queda sin dueño', () => {
  const licitaciones = [lic(1), lic(2), lic(3)];
  const r = repartir(licitaciones, [perfil(1), perfil(2)], {
    estrategia: 'manual', perfiles: [1, 2],
    manual: [
      { codigo: licitaciones[0].licitacion_codigo, usuarioId: 2 },
      { codigo: licitaciones[1].licitacion_codigo, usuarioId: 1 },
    ],
  });
  assert.equal(r.asignaciones.find(a => a.codigo === licitaciones[0].licitacion_codigo)!.usuarioId, 2);
  assert.equal(r.asignaciones.find(a => a.codigo === licitaciones[1].licitacion_codigo)!.usuarioId, 1);
  assert.deepEqual(r.sinAsignar, [licitaciones[2].licitacion_codigo]);
});

test('sin perfiles elegidos: nada se asigna y nada se pierde', () => {
  const licitaciones = [lic(1), lic(2)];
  const r = repartir(licitaciones, [perfil(1)], { estrategia: 'equitativa', perfiles: [] });
  assert.equal(r.sinAsignar.length, 2);
  assert.equal(r.porPerfil.length, 0);
});

test('un perfil desactivado/ajeno en las reglas no recibe nada (cae al fallback)', () => {
  // La regla apunta al usuario 99, que NO está entre los perfiles elegidos.
  const licitaciones = [lic(1, { categoria_nombre: 'Ferretería' })];
  const r = repartir(licitaciones, [perfil(1)], {
    estrategia: 'categoria', perfiles: [1],
    reglas: [{ valor: 'Ferretería', usuarioId: 99 }],
    fallback: 'equitativa', semilla: 1,
  });
  assert.equal(r.asignaciones[0].usuarioId, 1);
});

test('puente vacío: no revienta y devuelve resumen en cero', () => {
  const r = repartir([], [perfil(1), perfil(2)], { estrategia: 'equitativa', perfiles: [1, 2], semilla: 1 });
  assert.deepEqual(cuenta(r), [0, 0]);
  assert.equal(r.asignaciones.length, 0);
});
