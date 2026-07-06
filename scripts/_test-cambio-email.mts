// Prueba REAL del correo de "cambios en licitación asignada" (enviarCorreoCambio).
// Uso: npx tsx scripts/_test-cambio-email.mts destino@correo.cl
import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const destino = process.argv[2];
if (!destino) { console.error('Falta destino'); process.exit(1); }

const { enviarCorreoCambio } = await import('@/app/lib/email');
console.log(`Enviando correo de cambio de prueba → ${destino}  (from: ${process.env.SMTP_FROM})`);
const ok = await enviarCorreoCambio({
  to: destino,
  nombre: 'Camila',
  codigo: '1523-45-LE26',
  licitacionNombre: 'Adquisición de maquinaria de aseo industrial para recinto municipal',
  organismo: 'Municipalidad de Temuco',
  monto: 45_000_000,
  cierre: '2026-08-15',
  actorNombre: 'Jorge (admin)',
  cambios: [
    { tipo: 'Estado', detalle: 'Ahora está en EN PROCESO.' },
    { tipo: 'Líneas', detalle: 'Aseo Industrial, Municipalidades' },
  ],
});
console.log(ok ? '✅ Enviado (revisa bandeja y SPAM).' : '❌ No se pudo enviar (ver error arriba).');
process.exit(ok ? 0 : 1);
