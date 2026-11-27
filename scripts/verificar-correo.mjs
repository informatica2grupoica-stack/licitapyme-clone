// Verifica que el correo de LICITANK pueda llegar a Gmail/Outlook. Uso:
//   node scripts/verificar-correo.mjs                      → revisa SPF/DKIM/DMARC del dominio remitente y prueba conexión + login al SMTP (NO envía nada)
//   node scripts/verificar-correo.mjs --env .env.vps       → igual, leyendo otro archivo de variables (p. ej. una copia de las del servidor)
//   node scripts/verificar-correo.mjs --enviar-a tu@correo → además MANDA un correo de prueba a esa dirección (solo si lo pides con esta opción)
// Lee SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS y SMTP_FROM (las mismas que usa la app). Nunca muestra la clave.
import { readFileSync } from 'node:fs';
import { Resolver } from 'node:dns/promises';
import nodemailer from 'nodemailer';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const archivo = arg('--env') || '.env.local';
const para = arg('--enviar-a');

const env = {};
for (const linea of readFileSync(archivo, 'utf8').split(/\r?\n/)) {
  const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#\r\n]*)/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}

// Resolvedores públicos: el DNS local de este equipo puede no existir o filtrar registros, y el resultado engañaría («no hay SPF» cuando sí hay).
const dns = new Resolver();
dns.setServers(['1.1.1.1', '8.8.8.8']);
let problemas = 0;
const ok = (t) => console.log('  ✔', t);
const mal = (t) => { problemas++; console.log('  ✘', t); };
const aviso = (t) => console.log('  ⚠', t);

const dominioDe = (d) => { const m = /@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/.exec(d || ''); return m ? m[1].toLowerCase() : undefined; };
const from = env.SMTP_FROM || env.SMTP_USER;
const dominio = dominioDe(from);

console.log(`\nArchivo: ${archivo}`);
console.log(`Servidor: ${env.SMTP_HOST || '(falta SMTP_HOST)'}:${env.SMTP_PORT || '465'}   Usuario: ${env.SMTP_USER ? env.SMTP_USER.replace(/(.{2}).*(@.*)?/, '$1…$2') : '(falta)'}`);
console.log(`Remitente: ${from || '(falta)'}   Dominio: ${dominio || '(no se pudo leer)'}\n`);

// ── 1) DNS del dominio remitente ─────────────────────────────────────────────────────────────
console.log('1) DNS del dominio remitente (lo que Gmail revisa para confiar en el correo)');
if (!dominio) { mal('no hay un remitente con dominio: define SMTP_FROM, por ejemplo  LICITANK <avisos@licitank.cl>'); }
else {
  let dnsCaido = false;
  const txt = async (host) => {
    try { return (await dns.resolveTxt(host)).map(p => p.join('')); }
    catch (e) { if (!['ENODATA', 'ENOTFOUND'].includes(e.code)) dnsCaido = true; return []; }
  };
  const spf = (await txt(dominio)).filter(t => /^v=spf1/i.test(t));
  spf.length ? ok(`SPF: ${spf[0].slice(0, 110)}`) : mal(`SPF: no hay registro TXT «v=spf1 …» en ${dominio}`);
  if (spf.length > 1) mal('SPF: hay MÁS DE UN registro v=spf1 (Gmail lo trata como error: deja uno solo)');
  const dmarc = (await txt('_dmarc.' + dominio)).filter(t => /^v=DMARC1/i.test(t));
  dmarc.length ? ok(`DMARC: ${dmarc[0].slice(0, 110)}`) : mal(`DMARC: no hay registro TXT en _dmarc.${dominio} (mínimo:  v=DMARC1; p=none; rua=mailto:tu@correo)`);
  // DKIM: el selector lo define el proveedor; se prueban los más comunes.
  const selectores = ['resend', 'default', 'mail', 's1', 's2', 'k1', 'k2', 'brevo1', 'brevo2', 'mandrill', 'google', 'selector1', 'selector2', 'smtp', 'dkim'];
  const dkim = [];
  for (const s of selectores) { const r = await txt(`${s}._domainkey.${dominio}`); if (r.some(t => /v=DKIM1|p=/i.test(t))) dkim.push(s); }
  dkim.length ? ok(`DKIM: encontrado con el selector «${dkim.join('», «')}»`) : mal(`DKIM: no se encontró ninguna llave en los selectores comunes de ${dominio} (el proveedor te da el registro exacto: es un CNAME o TXT «<selector>._domainkey»)`);
  if (dnsCaido) aviso('No se pudo consultar el DNS (¿sin internet o bloqueado?): los ✘ de arriba pueden ser falsos. Reintenta.');
  try { const mx = await dns.resolveMx(dominio); mx.length ? ok(`MX: ${mx[0].exchange}`) : aviso('MX: sin servidor de recepción (no impide enviar, pero sin buzón no recibes las respuestas)'); }
  catch { aviso(`MX: ${dominio} no recibe correo (no impide enviar; las respuestas a este remitente se perderían)`); }
}

// ── 2) SMTP ──────────────────────────────────────────────────────────────────────────────────
console.log('\n2) Conexión y login al SMTP');
if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) { mal('faltan SMTP_HOST, SMTP_USER o SMTP_PASS'); }
else {
  const puerto = parseInt(env.SMTP_PORT || '465', 10);
  const transporte = nodemailer.createTransport({
    host: env.SMTP_HOST, port: puerto, secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : puerto === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }, name: dominio, connectionTimeout: 15000, greetingTimeout: 15000,
  });
  try { await transporte.verify(); ok('conectó y el usuario/clave fueron aceptados'); }
  catch (e) { mal(`no pudo conectar o iniciar sesión: ${String(e.message || e).slice(0, 160)}`); }

  if (para) {
    console.log(`\n3) Correo de prueba a ${para}`);
    try {
      const r = await transporte.sendMail({
        from, to: para, subject: 'Prueba de correo de LICITANK',
        text: 'Si lees esto, el correo de LICITANK sale bien desde este servidor.\nRevisa en Gmail: «Mostrar original» debe decir SPF: PASS, DKIM: PASS y DMARC: PASS.',
      });
      ok(`aceptado por el servidor (${r.response || r.messageId}). Revisa la bandeja Y la carpeta de spam; en Gmail: ⋮ → «Mostrar original» → SPF/DKIM/DMARC deben decir PASS.`);
    } catch (e) { mal(`el envío falló: ${String(e.message || e).slice(0, 160)}`); }
  } else {
    console.log('\n   (No se envió nada. Para mandar una prueba:  node scripts/verificar-correo.mjs --enviar-a tu@correo)');
  }
}

console.log(problemas ? `\n✘ ${problemas} cosa(s) por corregir antes de que el correo llegue bien a Gmail.\n` : '\n✔ Todo en orden.\n');
process.exit(problemas ? 1 : 0);
