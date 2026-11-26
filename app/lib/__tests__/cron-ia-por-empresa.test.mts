// Multiempresa: los cron que gastan IA «de oficio» sobre negocios/alertas usan el motor y las tablas de Grupo ICA.
// Si recorren negocios o alertas de OTRA empresa, el gasto se le cobra a ICA y el análisis cae en tablas privadas de ICA (hallazgo 2026-11-26 en viabilidad-perfil).
// Este test falla si alguno de esos cron deja de acotar por empresa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CRON_IA = ['viabilidad', 'viabilidad-perfil', 'prefiltro'];

for (const c of CRON_IA) {
  test(`cron ${c}: la IA de oficio se acota a Grupo ICA (cliente_id = 1)`, () => {
    const src = readFileSync(join(process.cwd(), 'app', 'api', 'cron', c, 'route.ts'), 'utf8');
    assert.match(src, /cliente_id\s*,?\s*1?\)?\s*=\s*1/, `app/api/cron/${c}/route.ts debe filtrar por cliente_id = 1 en su consulta de pendientes`);
  });
}
