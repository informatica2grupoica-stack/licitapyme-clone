// Limpia avisos y acuses que se mandaron a usuarios de OTRA empresa (fallo corregido el 2026-11-26: involucradosEnEntrega y los avisos de Compras
// tomaban a los admin de todas las empresas). Por defecto SOLO CUENTA; con --aplicar borra. Uso:  node scripts/limpiar-avisos-cruzados.mjs [--aplicar]
import mysql from 'mysql2/promise';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).split('#')[0].trim()]; }));
const c = await mysql.createConnection({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
const aplicar = process.argv.includes('--aplicar');
// 1) Acuses de entrega de personas que no son de la empresa dueña del negocio (bloquean el cierre de la entrega).
const SQL_ACUSES = `FROM entrega_acuse ea JOIN usuarios u ON u.id = ea.usuario_id JOIN negocios n ON n.id = ea.negocio_id WHERE COALESCE(u.cliente_id,1) <> COALESCE(n.cliente_id,1)`;
// 2) Avisos de proyecto ganado / compras enviados a usuarios de otra empresa que la del negocio de ese código.
const SQL_EVENTOS = `FROM historial_eventos h JOIN usuarios u ON u.id = h.usuario_id
  WHERE h.tipo IN ('PROYECTO_GANADO','COMPRAS_PROYECTO_GANADO','COMPRAS_ASIGNADO','COMPRAS_OC_RECIBIDA')
    AND NOT EXISTS (SELECT 1 FROM negocios n WHERE n.licitacion_codigo = h.licitacion_codigo AND COALESCE(n.cliente_id,1) = COALESCE(u.cliente_id,1))`;
const [[a]] = await c.query(`SELECT COUNT(*) n ${SQL_ACUSES}`);
const [[e]] = await c.query(`SELECT COUNT(*) n ${SQL_EVENTOS}`);
console.log(`Acuses ajenos: ${a.n} · Avisos ajenos: ${e.n}`);
if (aplicar) {
  const [r1] = await c.query(`DELETE ea ${SQL_ACUSES}`);
  const [r2] = await c.query(`DELETE h ${SQL_EVENTOS}`);
  console.log(`Borrados: ${r1.affectedRows} acuses y ${r2.affectedRows} avisos.`);
} else console.log('Solo conté. Para borrar: node scripts/limpiar-avisos-cruzados.mjs --aplicar');
await c.end();
