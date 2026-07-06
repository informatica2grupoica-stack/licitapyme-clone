// Prueba REAL de envío del digest de radar, usando la MISMA función del cron
// (enviarDigestRadar). Fuerza SMTP_FROM a la casilla autenticada real (grupoica.cl)
// para saltar el placeholder tudominio.cl. Envía a la dirección pasada por arg.
// Uso: npx tsx scripts/_test-digest-email.mts destino@correo.cl
import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}

// Corrección temporal del remitente: usa la casilla autenticada real (válida).
if (process.env.SMTP_USER) process.env.SMTP_FROM = `ICA Licitaciones <${process.env.SMTP_USER}>`;

const destino = process.argv[2] || process.env.SMTP_USER || '';
if (!destino) { console.error('Falta destino'); process.exit(1); }

const { enviarDigestRadar } = await import('@/app/lib/email');

console.log(`Enviando digest de prueba → ${destino}  (from: ${process.env.SMTP_FROM})`);
const ok = await enviarDigestRadar({
  to: destino,
  nombre: 'Prueba',
  totalNuevas: 3,
  licitaciones: [
    { codigo: 'PRUEBA-1-LE26', nombre: 'Adquisición de maquinaria de aseo industrial', organismo: 'Municipalidad de Ejemplo', monto: 45_000_000, cierre: null, keyword: 'maquinaria aseo' },
    { codigo: 'PRUEBA-2-LR26', nombre: 'Equipamiento de barrido y lavado de calles', organismo: 'Servicio de Ejemplo', monto: 88_000_000, cierre: null, keyword: 'barredora' },
    { codigo: 'PRUEBA-3-LE26', nombre: 'Suministro de equipos hidrolavadores', organismo: 'Hospital de Ejemplo', monto: 12_000_000, cierre: null, keyword: 'hidrolavadora' },
  ],
});
console.log(ok ? '✅ Enviado (revisa la bandeja, y SPAM).' : '❌ No se pudo enviar (ver error arriba).');
process.exit(ok ? 0 : 1);
