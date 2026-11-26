// Frontera entre empresas para los avisos (2026-11-26): «las fugas no pueden suceder».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { decidirAviso } from '../aviso-frontera';

test('un aviso de Compras o Entregas nunca va a otra empresa; a ICA sí', () => {
  for (const tipo of ['COMPRAS_PROYECTO_GANADO', 'COMPRAS_ASIGNADO', 'ENTREGA_ACUSE']) {
    assert.equal(decidirAviso({ tipo, clienteDestino: 4, destinoTieneNegocio: true }).entregar, false);
    assert.equal(decidirAviso({ tipo, clienteDestino: 1, destinoTieneNegocio: true }).entregar, true);
  }
});

test('un aviso con código de licitación solo llega a una empresa que tenga ese negocio', () => {
  // el caso real: «Proyecto ganado» de un negocio de ICA a un admin de Comercial MP (2026-11-25)
  assert.equal(decidirAviso({ tipo: 'PROYECTO_GANADO', clienteDestino: 4, destinoTieneNegocio: false }).entregar, false);
  assert.equal(decidirAviso({ tipo: 'ORDEN_COMPRA', clienteDestino: 2, destinoTieneNegocio: false }).entregar, false);
  assert.equal(decidirAviso({ tipo: 'PROYECTO_GANADO', clienteDestino: 1, destinoTieneNegocio: true }).entregar, true);
  assert.equal(decidirAviso({ tipo: 'PROYECTO_GANADO', clienteDestino: 4, destinoTieneNegocio: true }).entregar, true);
});

test('un aviso sin código de licitación (ej. reporte de error) no se frena por negocio', () => {
  assert.equal(decidirAviso({ tipo: 'REPORTE_ERROR', clienteDestino: 4 }).entregar, true);
});

// ── Guardia estática: ninguna lista de usuarios puede salir sin filtrar por empresa ────────────────────────────────────────
// Origen del fallo: `SELECT ... FROM usuarios WHERE activo = TRUE` (sin cliente_id) recorrido para avisar a «todos los admin».
// Si agregas una consulta nueva de este tipo y de verdad es de plataforma (no de una empresa), súmala a PERMITIDAS con el motivo.
const PERMITIDAS: Array<{ archivo: RegExp; motivo: string }> = [
  { archivo: /app[\\/]api[\\/]admin[\\/]/, motivo: 'administración de LICITANK (solo superusuario / admin de ICA, ya con su propio chequeo)' },
];

function archivos(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === '__tests__' || n.startsWith('.')) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) archivos(p, out);
    else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}

test('ninguna consulta recorre usuarios activos de TODAS las empresas', () => {
  const raiz = join(process.cwd(), 'app');
  const malas: string[] = [];
  for (const f of archivos(raiz)) {
    if (PERMITIDAS.some(p => p.archivo.test(f))) continue;
    const src = readFileSync(f, 'utf8');
    // sentencias SQL que listan usuarios: «FROM usuarios … WHERE activo» hasta el cierre de la cadena
    for (const m of src.matchAll(/FROM usuarios\b[^`'"]*?WHERE\s+activo\s*=\s*(?:TRUE|1)[^`'"]*/gi)) {
      const sql = m[0];
      if (/cliente_id/i.test(sql)) continue;           // filtrada por empresa
      if (/\bid\s*(=|IN)\s*[?(]/i.test(sql)) continue; // lectura de usuarios puntuales por id
      const linea = src.slice(0, m.index).split('\n').length;
      malas.push(`${f.replace(process.cwd(), '')}:${linea}  ${sql.replace(/\s+/g, ' ').slice(0, 90)}`);
    }
  }
  assert.deepEqual(malas, [], 'Listas de usuarios sin filtrar por empresa (fuga entre empresas):\n' + malas.join('\n'));
});
