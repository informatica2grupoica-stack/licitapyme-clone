// Reenvía la alerta de etapa ANEXOS para TODAS las licitaciones que HOY están en
// esa etapa (backfill: las que ya estaban en ANEXOS antes de existir la alerta).
// Destinatarios = usuarios activos con el permiso 'alertas_anexos' (ej. Fernando).
//
// SEGURO POR DEFECTO: sin argumentos hace un ENSAYO (no envía nada, solo lista).
// Para enviar de verdad:  npx tsx scripts/notificar-anexos-actuales.mts --enviar
import { readFileSync } from 'node:fs';

// 1) Cargar .env.local (DB + SMTP) igual que el resto de scripts.
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
// El SMTP_FROM del .env es un placeholder (tudominio.cl): usar el buzón autenticado real.
if (process.env.SMTP_USER) process.env.SMTP_FROM = `ICA Licitaciones <${process.env.SMTP_USER}>`;

const ENVIAR = process.argv.includes('--enviar');

const pool = (await import('@/app/lib/db')).default;
const { enviarCorreoEtapaAnexos } = await import('@/app/lib/email');
const { registrarEvento } = await import('@/app/lib/historial');
const { normalizarEstado } = await import('@/app/lib/pipeline');

function parsePermisos(raw: any): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') { try { return JSON.parse(raw) || {}; } catch { return {}; } }
  return typeof raw === 'object' ? raw : {};
}

try {
  // 2) Destinatarios: usuarios activos con alertas_anexos.
  const [urows] = await pool.query(`SELECT id, nombre, email, permisos FROM usuarios WHERE activo = TRUE`) as any;
  const destinatarios = (urows as any[]).filter(u => !!parsePermisos(u.permisos).alertas_anexos && u.email);

  // 3) Licitaciones en etapa ANEXOS (una por código, aunque esté asignada a varios).
  const [nrows] = await pool.query(
    `SELECT licitacion_codigo, licitacion_nombre, licitacion_organismo, licitacion_monto,
            licitacion_cierre, estado_pipeline
       FROM negocios
      WHERE activo = TRUE AND estado_pipeline IN ('ANEXOS','4ANEXOS')`,
  ) as any;
  const porCodigo = new Map<string, any>();
  for (const n of nrows as any[]) {
    if (normalizarEstado(n.estado_pipeline) !== 'ANEXOS') continue; // por si acaso
    if (!porCodigo.has(n.licitacion_codigo)) porCodigo.set(n.licitacion_codigo, n);
  }
  const licitaciones = [...porCodigo.values()];

  // 4) Plan.
  console.log(`\n  Destinatarios (permiso alertas_anexos): ${destinatarios.length}`);
  destinatarios.forEach(d => console.log(`    · ${d.nombre || '—'}  <${d.email}>`));
  console.log(`\n  Licitaciones en etapa ANEXOS: ${licitaciones.length}`);
  licitaciones.forEach(l => console.log(`    · ${l.licitacion_codigo}  ${l.licitacion_nombre || ''}`.slice(0, 100)));
  const totalCorreos = destinatarios.length * licitaciones.length;
  console.log(`\n  Total de correos a enviar: ${totalCorreos}  (from: ${process.env.SMTP_FROM})`);

  if (destinatarios.length === 0 || licitaciones.length === 0) {
    console.log('\n  Nada que enviar. (¿Aplicaste la migración 28 y marcaste el permiso "alertas_anexos" a Fernando?)\n');
    process.exit(0);
  }
  if (!ENVIAR) {
    console.log('\n  ENSAYO — no se envió nada. Para enviar de verdad:');
    console.log('    npx tsx scripts/notificar-anexos-actuales.mts --enviar\n');
    process.exit(0);
  }

  // 5) Envío real: correo + campana por cada (destinatario × licitación).
  let ok = 0, fail = 0;
  for (const l of licitaciones) {
    for (const d of destinatarios) {
      const enviado = await enviarCorreoEtapaAnexos({
        to: d.email, nombre: d.nombre, codigo: l.licitacion_codigo,
        licitacionNombre: l.licitacion_nombre, organismo: l.licitacion_organismo,
        monto: l.licitacion_monto, cierre: l.licitacion_cierre,
        actorNombre: 'Sistema',
      }).catch(() => false);
      if (enviado) ok++; else fail++;
      // Campana (best-effort): deja también la notificación en el historial.
      await registrarEvento({
        tipo: 'ETAPA_ANEXOS',
        licitacionCodigo: l.licitacion_codigo, licitacionNombre: l.licitacion_nombre,
        usuarioId: d.id, usuarioNombre: d.nombre || d.email,
        actorId: null, actorNombre: 'Sistema',
        mensaje: `Recordatorio: ${l.licitacion_nombre || l.licitacion_codigo} está en la etapa ANEXOS`,
        metadata: { licitacion_codigo: l.licitacion_codigo, etapa: 'ANEXOS', backfill: true },
      }).catch(() => {});
    }
  }
  console.log(`\n  Enviados: ${ok}   ·   Fallidos: ${fail}\n`);
  process.exit(fail > 0 && ok === 0 ? 1 : 0);
} catch (e: any) {
  console.error('\n  ERROR:', e?.message || String(e), '\n');
  process.exit(1);
} finally {
  try { await pool.end(); } catch {}
}
