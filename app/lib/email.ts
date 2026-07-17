// Envío de correos por SMTP (correo corporativo de Bluehost) con nodemailer.
// Si el SMTP no está configurado, se omite el envío (no rompe la acción).
//
// Configura en .env.local (datos de tu correo corporativo Bluehost):
//   SMTP_HOST=mail.tudominio.cl        (servidor de correo saliente de Bluehost)
//   SMTP_PORT=465                       (465 = SSL · 587 = TLS/STARTTLS)
//   SMTP_SECURE=true                    (true para 465, false para 587)
//   SMTP_USER=notificaciones@tudominio.cl   (la cuenta de correo completa)
//   SMTP_PASS=la_contraseña_de_esa_cuenta
//   SMTP_FROM="ICA Licitaciones <notificaciones@tudominio.cl>"  (opcional; por defecto = SMTP_USER)
//   NEXT_PUBLIC_APP_URL=https://tu-app   (para los enlaces del correo)
import nodemailer, { type Transporter } from 'nodemailer';

let _transporter: Transporter | null = null;
function transporter(): Transporter | null {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '465', 10),
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : (process.env.SMTP_PORT || '465') === '465',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      // Pool con límite de tasa: ante muchas asignaciones de golpe, los correos se
      // encolan y salen de a 1 por segundo por una sola conexión, para que el SMTP
      // compartido de Bluehost no los rechace por "demasiados en ráfaga".
      pool: true,
      maxConnections: 1,
      maxMessages: 50,
      rateDelta: 1000, // ventana de 1s
      rateLimit: 1,    // máx 1 correo por ventana
    });
  }
  return _transporter;
}
const FROM = () => process.env.SMTP_FROM || process.env.SMTP_USER || '';

const fmtMonto = (n?: number | null) =>
  n ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n) : null;
const fmtFecha = (f?: string | null) => {
  if (!f) return null;
  try { return new Date(f).toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' }); } catch { return null; }
};
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

interface AsignacionEmail {
  to: string; nombre?: string | null; codigo: string; licitacionNombre?: string | null;
  organismo?: string | null; monto?: number | null; cierre?: string | null;
  actorNombre?: string | null; reasignacion?: boolean;
}

// ─── Layout compartido (todos los correos usan esta base) ─────────────────────
// Identidad real de la marca (logo = red de nodos cian sobre fondo oscuro): header
// oscuro con wordmark de dos tonos + acento cian, tarjetas con franja indigo, botón
// sólido. Estilo cuidado, no el gradiente genérico.
const APP_NOMBRE = 'ICA Licitaciones';
const C_TINTA   = '#0f172a'; // header oscuro (slate-900)
const C_CIAN    = '#22d3ee'; // acento del logo
const C_INDIGO  = '#4f46e5'; // acción / franja (primario de la app)

// Wordmark de dos tonos: "ICA" en cian, "Licitaciones" en blanco.
function wordmark(): string {
  return `<span style="font-size:17px;font-weight:800;letter-spacing:-.01em;color:${C_CIAN};">ICA</span><span style="font-size:17px;font-weight:600;letter-spacing:-.01em;color:#ffffff;"> Licitaciones</span>`;
}

// Tarjeta estándar de una licitación (con franja de acento a la izquierda).
function cardLicitacion(l: { codigo: string; nombre?: string | null; organismo?: string | null; monto?: number | null; cierre?: string | null }): string {
  const fila = (label: string, valor: string | null) => valor
    ? `<tr><td style="padding:3px 0;color:#6b7280;font-size:13px;width:118px;">${label}</td><td style="padding:3px 0;color:#111827;font-size:13px;font-weight:500;">${esc(valor)}</td></tr>`
    : '';
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#ffffff;border:1px solid #e5e7eb;border-left:3px solid ${C_INDIGO};border-radius:8px;">
      <tr><td style="padding:15px 18px;">
        <div style="color:#0f172a;font-size:15px;font-weight:700;line-height:1.4;">${esc(l.nombre || l.codigo)}</div>
        <div style="margin-top:3px;color:#94a3b8;font-size:12px;font-family:ui-monospace,Menlo,Consolas,monospace;">${esc(l.codigo)}</div>
        <table style="width:100%;border-collapse:collapse;margin-top:11px;">
          ${fila('Organismo', l.organismo || null)}
          ${fila('Monto estimado', fmtMonto(l.monto))}
          ${fila('Cierre', fmtFecha(l.cierre))}
        </table>
      </td></tr>
    </table>`;
}

// Envoltura común. `titulo` y `cuerpo` se pasan como HTML ya escapado por el que llama.
function layoutEmail(o: { titulo: string; cuerpo: string; cta?: { label: string; url: string } }): string {
  return `
  <div style="background:#eef1f5;padding:30px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:540px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(15,23,42,.08);">
      <tr><td style="background:${C_TINTA};padding:20px 26px;">
        ${wordmark()}
      </td></tr>
      <tr><td style="height:3px;background:${C_CIAN};font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td style="padding:28px 26px 26px;">
        <h1 style="margin:0 0 18px;color:#0f172a;font-size:19px;font-weight:700;line-height:1.3;">${o.titulo}</h1>
        ${o.cuerpo}
        ${o.cta ? `<div style="margin-top:22px;"><a href="${o.cta.url}" style="display:inline-block;background:${C_INDIGO};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 22px;border-radius:8px;">${esc(o.cta.label)}</a></div>` : ''}
      </td></tr>
      <tr><td style="background:#f8fafc;padding:16px 26px;border-top:1px solid #eceef1;">
        <div style="color:#64748b;font-size:12px;font-weight:600;">${APP_NOMBRE}</div>
        <div style="margin-top:2px;color:#9ca3af;font-size:11.5px;line-height:1.5;">Notificación automática. Si no esperabas este correo, avísale a tu administrador.</div>
      </td></tr>
    </table>
  </div>`;
}

function plantillaAsignacion(p: AsignacionEmail, appUrl: string): string {
  const url = appUrl ? `${appUrl.replace(/\/$/, '')}/licitacion/${encodeURIComponent(p.codigo)}` : '';
  const quien = p.actorNombre ? `${esc(p.actorNombre)} te` : 'Se te';
  const cuerpo = `
    <p style="margin:0 0 14px;color:#374151;font-size:14px;line-height:1.55;">Hola ${esc(p.nombre || '')}:</p>
    <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.55;">
      ${quien} ${p.reasignacion ? 'reasignó' : 'asignó'} esta licitación:
    </p>
    ${cardLicitacion({ codigo: p.codigo, nombre: p.licitacionNombre, organismo: p.organismo, monto: p.monto, cierre: p.cierre })}`;
  return layoutEmail({
    titulo: p.reasignacion ? 'Te reasignaron una licitación' : 'Te asignaron una licitación',
    cuerpo,
    cta: url ? { label: 'Abrir licitación', url } : undefined,
  });
}

/** Envía el correo de asignación/reasignación por SMTP. Devuelve true si se envió. */
export async function enviarCorreoAsignacion(p: AsignacionEmail): Promise<boolean> {
  const t = transporter();
  if (!t) { console.warn('[email] SMTP no configurado (SMTP_HOST/USER/PASS) — correo omitido'); return false; }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  try {
    await t.sendMail({
      from: FROM(),
      to: p.to,
      subject: `${p.reasignacion ? 'Reasignación' : 'Licitación asignada'}: ${p.licitacionNombre || p.codigo}`,
      html: plantillaAsignacion(p, appUrl),
    });
    return true;
  } catch (e) {
    console.error('[email] envío SMTP falló:', String(e));
    return false;
  }
}

// ─── Recuperación de contraseña ──────────────────────────────────────────────
interface RecuperacionEmail {
  to: string;
  nombre?: string | null;
  url: string;            // enlace completo con el token
  vigenciaMin: number;    // minutos de validez del enlace
}

function plantillaRecuperacion(p: RecuperacionEmail): string {
  const cuerpo = `
    <p style="margin:0 0 14px;color:#374151;font-size:14px;line-height:1.55;">Hola ${esc(p.nombre || '')}:</p>
    <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.55;">
      Recibimos una solicitud para restablecer tu contraseña. Haz clic en el botón para elegir una clave nueva.
      El enlace vence en ${p.vigenciaMin} minutos y solo puede usarse una vez.
    </p>
    <p style="margin:0;color:#9ca3af;font-size:12.5px;line-height:1.55;">
      Si tú no pediste esto, ignora este correo: tu contraseña no cambiará.
    </p>`;
  return layoutEmail({
    titulo: 'Restablece tu contraseña',
    cuerpo,
    cta: { label: 'Crear contraseña nueva', url: p.url },
  });
}

/** Envía el correo de recuperación de contraseña. Devuelve true si se envió. */
export async function enviarCorreoRecuperacion(p: RecuperacionEmail): Promise<boolean> {
  const t = transporter();
  if (!t) { console.warn('[email] SMTP no configurado — correo de recuperación omitido'); return false; }
  try {
    await t.sendMail({
      from: FROM(),
      to: p.to,
      subject: 'Restablece tu contraseña · ICA Licitaciones',
      html: plantillaRecuperacion(p),
    });
    return true;
  } catch (e) {
    console.error('[email] envío SMTP (recuperación) falló:', String(e));
    return false;
  }
}

// ─── Digest de radar por perfil ──────────────────────────────────────────────
// Correo con las licitaciones NUEVAS que calzaron las keywords de un perfil en la
// última corrida del cron. Una sola pieza por usuario (no un correo por licitación).

export interface LicitacionDigest {
  codigo: string;
  nombre?: string | null;
  organismo?: string | null;
  monto?: number | null;
  cierre?: string | null;
  keyword?: string | null;
  perfil?: string | null; // nombre del perfil asignado (solo en el digest de cierres para admins)
}
interface DigestEmail {
  to: string;
  nombre?: string | null;
  licitaciones: LicitacionDigest[];
  totalNuevas: number; // total de nuevas (puede ser > licitaciones.length si se recortó la lista)
}

function plantillaDigest(p: DigestEmail, appUrl: string): string {
  const base = appUrl ? appUrl.replace(/\/$/, '') : '';
  const urlRadar = base ? `${base}/radar` : '';
  const tarjeta = (l: LicitacionDigest) => {
    const url = base ? `${base}/licitacion/${encodeURIComponent(l.codigo)}` : '';
    const meta = [l.organismo, fmtMonto(l.monto), fmtFecha(l.cierre) ? `Cierre: ${fmtFecha(l.cierre)}` : null]
      .filter(Boolean).map(v => esc(String(v))).join(' · ');
    return `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#ffffff;border:1px solid #e5e7eb;border-left:3px solid ${C_INDIGO};border-radius:8px;margin-bottom:8px;">
        <tr><td style="padding:13px 16px;">
          <div style="font-size:14.5px;font-weight:700;line-height:1.4;">
            ${url ? `<a href="${url}" style="color:#0f172a;text-decoration:none;">` : ''}${esc(l.nombre || l.codigo)}${url ? '</a>' : ''}
          </div>
          <div style="margin-top:3px;color:#94a3b8;font-size:12px;font-family:ui-monospace,Menlo,Consolas,monospace;">${esc(l.codigo)}${l.keyword ? ` · <span style="color:#6366f1;">${esc(l.keyword)}</span>` : ''}</div>
          ${meta ? `<div style="margin-top:5px;color:#6b7280;font-size:12px;">${meta}</div>` : ''}
        </td></tr>
      </table>`;
  };
  const extra = p.totalNuevas > p.licitaciones.length
    ? `<p style="margin:6px 0 0;color:#6b7280;font-size:13px;">y ${p.totalNuevas - p.licitaciones.length} más en el radar.</p>` : '';
  const cuerpo = `
    <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.55;">Hola ${esc(p.nombre || '')}: estas licitaciones nuevas coinciden con tus palabras clave.</p>
    ${p.licitaciones.map(tarjeta).join('')}
    ${extra}`;
  return layoutEmail({
    titulo: `${p.totalNuevas} nueva${p.totalNuevas !== 1 ? 's' : ''} licitación${p.totalNuevas !== 1 ? 'es' : ''} en tu radar`,
    cuerpo,
    cta: urlRadar ? { label: 'Abrir el radar', url: urlRadar } : undefined,
  });
}

// ─── Correo de cambios en una licitación asignada ─────────────────────────────
export interface CambioEmail {
  to: string;
  nombre?: string | null;
  codigo: string;
  licitacionNombre?: string | null;
  cambios: { tipo: string; detalle: string }[]; // uno o varios cambios de la misma acción
  organismo?: string | null;
  monto?: number | null;
  cierre?: string | null;
  actorNombre?: string | null;
}

function plantillaCambio(p: CambioEmail, appUrl: string): string {
  const url = appUrl ? `${appUrl.replace(/\/$/, '')}/licitacion/${encodeURIComponent(p.codigo)}` : '';
  const lineas = p.cambios.map(c => `
    <tr>
      <td style="padding:6px 0;width:118px;vertical-align:top;"><span style="color:${C_INDIGO};font-size:12.5px;font-weight:700;">${esc(c.tipo)}</span></td>
      <td style="padding:6px 0;color:#111827;font-size:13.5px;line-height:1.5;">${esc(c.detalle)}</td>
    </tr>`).join('');
  const cuerpo = `
    <p style="margin:0 0 14px;color:#374151;font-size:14px;line-height:1.55;">Hola ${esc(p.nombre || '')}:</p>
    <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.55;">
      ${p.actorNombre ? esc(p.actorNombre) : 'Alguien'} actualizó una licitación que tienes asignada.
    </p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 18px;border-top:1px solid #eef1f5;border-bottom:1px solid #eef1f5;">${lineas}</table>
    ${cardLicitacion({ codigo: p.codigo, nombre: p.licitacionNombre, organismo: p.organismo, monto: p.monto, cierre: p.cierre })}`;
  return layoutEmail({
    titulo: 'Cambios en una licitación asignada',
    cuerpo,
    cta: url ? { label: 'Abrir licitación', url } : undefined,
  });
}

/** Envía el correo de cambios (estado/etiquetas/monto…) al perfil asignado. */
export async function enviarCorreoCambio(p: CambioEmail): Promise<boolean> {
  const t = transporter();
  if (!t) { console.warn('[email] SMTP no configurado — correo de cambio omitido'); return false; }
  if (!p.to || p.cambios.length === 0) return false;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  try {
    await t.sendMail({
      from: FROM(),
      to: p.to,
      subject: `Actualización: ${p.licitacionNombre || p.codigo}`,
      html: plantillaCambio(p, appUrl),
    });
    return true;
  } catch (e) {
    console.error('[email] envío cambio SMTP falló:', String(e));
    return false;
  }
}

// ─── Correo: una licitación entró a la etapa ANEXOS ───────────────────────────
// Aviso para los perfiles con permiso 'alertas_anexos' (ej. Fernando): cuando un
// asistente mueve su negocio a la etapa ANEXOS, es la señal de "listo para preparar
// los anexos". No va al asignado, va a quien trabaja los anexos.
export interface EtapaAnexosEmail {
  to: string; nombre?: string | null; codigo: string; licitacionNombre?: string | null;
  organismo?: string | null; monto?: number | null; cierre?: string | null;
  actorNombre?: string | null;
}

function plantillaEtapaAnexos(p: EtapaAnexosEmail, appUrl: string): string {
  const url = appUrl ? `${appUrl.replace(/\/$/, '')}/licitacion/${encodeURIComponent(p.codigo)}` : '';
  const cuerpo = `
    <p style="margin:0 0 14px;color:#374151;font-size:14px;line-height:1.55;">Hola ${esc(p.nombre || '')}:</p>
    <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.55;">
      ${p.actorNombre ? esc(p.actorNombre) : 'Alguien'} movió esta licitación a la etapa
      <strong>ANEXOS</strong>. Ya puedes revisar y preparar los anexos.
    </p>
    ${cardLicitacion({ codigo: p.codigo, nombre: p.licitacionNombre, organismo: p.organismo, monto: p.monto, cierre: p.cierre })}`;
  return layoutEmail({
    titulo: 'Una licitación pasó a la etapa ANEXOS',
    cuerpo,
    cta: url ? { label: 'Abrir licitación', url } : undefined,
  });
}

/** Avisa a un perfil (ej. Fernando) que una licitación entró a la etapa ANEXOS. */
export async function enviarCorreoEtapaAnexos(p: EtapaAnexosEmail): Promise<boolean> {
  const t = transporter();
  if (!t) { console.warn('[email] SMTP no configurado — correo de etapa ANEXOS omitido'); return false; }
  if (!p.to) return false;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  try {
    await t.sendMail({
      from: FROM(),
      to: p.to,
      subject: `Etapa ANEXOS: ${p.licitacionNombre || p.codigo}`,
      html: plantillaEtapaAnexos(p, appUrl),
    });
    return true;
  } catch (e) {
    console.error('[email] envío etapa ANEXOS SMTP falló:', String(e));
    return false;
  }
}

/** Envía el digest de radar a un perfil. Devuelve true si se envió. */
export async function enviarDigestRadar(p: DigestEmail): Promise<boolean> {
  const t = transporter();
  if (!t) { console.warn('[email] SMTP no configurado — digest de radar omitido'); return false; }
  if (!p.to || p.licitaciones.length === 0) return false;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  try {
    await t.sendMail({
      from: FROM(),
      to: p.to,
      subject: `${p.totalNuevas} nueva${p.totalNuevas !== 1 ? 's' : ''} licitación${p.totalNuevas !== 1 ? 'es' : ''} en tu radar`,
      html: plantillaDigest(p, appUrl),
    });
    return true;
  } catch (e) {
    console.error('[email] envío digest SMTP falló:', String(e));
    return false;
  }
}

// ─── Digest "cierran pronto" por perfil ──────────────────────────────────────
// Correo con las licitaciones ASIGNADAS al perfil cuyo cierre cae dentro de la ventana
// (p.ej. 48 h) y siguen sin resolver. Reusa el mismo layout/tarjetas del digest de radar.
interface CierresEmail {
  to: string;
  nombre?: string | null;
  licitaciones: LicitacionDigest[];
  totalNuevas: number;
  horas: number;
  esAdmin?: boolean; // true = digest global de la empresa (muestra el perfil de cada una)
}

// Cierre con fecha + HORA (hora de Chile) — para estos avisos la hora es lo importante.
const fmtCierreHora = (f?: string | null) => {
  if (!f) return null;
  try {
    return new Date(f).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' });
  } catch { return null; }
};

function plantillaCierres(p: CierresEmail, appUrl: string): string {
  const base = appUrl ? appUrl.replace(/\/$/, '') : '';
  const urlNegocios = base ? `${base}/negocios` : '';
  const tarjeta = (l: LicitacionDigest) => {
    const url = base ? `${base}/licitacion/${encodeURIComponent(l.codigo)}` : '';
    const cierre = fmtCierreHora(l.cierre);
    const meta = [l.organismo, fmtMonto(l.monto)].filter(Boolean).map(v => esc(String(v))).join(' · ');
    return `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#ffffff;border:1px solid #fecaca;border-left:3px solid #ef4444;border-radius:8px;margin-bottom:8px;">
        <tr><td style="padding:13px 16px;">
          <div style="font-size:14.5px;font-weight:700;line-height:1.4;">
            ${url ? `<a href="${url}" style="color:#0f172a;text-decoration:none;">` : ''}${esc(l.nombre || l.codigo)}${url ? '</a>' : ''}
          </div>
          <div style="margin-top:3px;color:#94a3b8;font-size:12px;font-family:ui-monospace,Menlo,Consolas,monospace;">${esc(l.codigo)}</div>
          ${l.perfil ? `<div style="margin-top:5px;"><span style="display:inline-block;background:#eef2ff;color:#4338ca;font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:999px;">👤 ${esc(l.perfil)}</span></div>` : ''}
          ${cierre ? `<div style="margin-top:6px;color:#b91c1c;font-size:13px;font-weight:700;">⏰ Cierra: ${esc(cierre)}</div>` : ''}
          ${meta ? `<div style="margin-top:4px;color:#6b7280;font-size:12px;">${meta}</div>` : ''}
        </td></tr>
      </table>`;
  };
  const extra = p.totalNuevas > p.licitaciones.length
    ? `<p style="margin:6px 0 0;color:#6b7280;font-size:13px;">y ${p.totalNuevas - p.licitaciones.length} más por cerrar.</p>` : '';
  const intro = p.esAdmin
    ? `Hola ${esc(p.nombre || '')}: estas licitaciones asignadas al equipo <strong>están por cerrar</strong> y siguen sin resolver. Cada tarjeta indica el perfil responsable.`
    : `Hola ${esc(p.nombre || '')}: estas licitaciones que tienes asignadas <strong>están por cerrar</strong> y siguen sin resolver. Revísalas antes de que venzan.`;
  const cuerpo = `
    <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.55;">${intro}</p>
    ${p.licitaciones.map(tarjeta).join('')}
    ${extra}`;
  return layoutEmail({
    titulo: p.esAdmin
      ? `${p.totalNuevas} licitación${p.totalNuevas !== 1 ? 'es' : ''} del equipo cierra${p.totalNuevas !== 1 ? 'n' : ''} pronto`
      : `${p.totalNuevas} licitación${p.totalNuevas !== 1 ? 'es' : ''} tuya${p.totalNuevas !== 1 ? 's' : ''} cierra${p.totalNuevas !== 1 ? 'n' : ''} pronto`,
    cuerpo,
    cta: urlNegocios ? { label: 'Ver los negocios', url: urlNegocios } : undefined,
  });
}

/** Envía el digest de "cierran pronto" a un perfil. Devuelve true si se envió. */
export async function enviarDigestCierresProximos(p: CierresEmail): Promise<boolean> {
  const t = transporter();
  if (!t) { console.warn('[email] SMTP no configurado — digest de cierres omitido'); return false; }
  if (!p.to || p.licitaciones.length === 0) return false;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  try {
    await t.sendMail({
      from: FROM(),
      to: p.to,
      subject: p.esAdmin
        ? `⏰ ${p.totalNuevas} licitación${p.totalNuevas !== 1 ? 'es' : ''} del equipo cierra${p.totalNuevas !== 1 ? 'n' : ''} pronto`
        : `⏰ ${p.totalNuevas} licitación${p.totalNuevas !== 1 ? 'es' : ''} tuya${p.totalNuevas !== 1 ? 's' : ''} cierra${p.totalNuevas !== 1 ? 'n' : ''} pronto`,
      html: plantillaCierres(p, appUrl),
    });
    return true;
  } catch (e) {
    console.error('[email] envío digest cierres SMTP falló:', String(e));
    return false;
  }
}

/** Verifica la conexión SMTP (para un endpoint de prueba). */
export async function verificarSMTP(): Promise<{ ok: boolean; error?: string }> {
  const t = transporter();
  if (!t) return { ok: false, error: 'SMTP no configurado (SMTP_HOST/USER/PASS)' };
  try { await t.verify(); return { ok: true }; }
  catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
}

/** Renderiza las plantillas con datos de muestra (para previsualizar el diseño sin enviar). */
export function previewEmailsHTML(appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.icalicitaciones.cl'): { asignacion: string; digest: string; cambio: string } {
  const lic = { codigo: '1523-45-LE26', nombre: 'Adquisición de maquinaria de aseo industrial para recinto municipal', organismo: 'Municipalidad de Temuco', monto: 45_000_000, cierre: '2026-08-15' };
  return {
    asignacion: plantillaAsignacion({ to: '', nombre: 'Camila', codigo: lic.codigo, licitacionNombre: lic.nombre, organismo: lic.organismo, monto: lic.monto, cierre: lic.cierre, actorNombre: 'Jorge' }, appUrl),
    digest: plantillaDigest({ to: '', nombre: 'Camila', totalNuevas: 3, licitaciones: [
      { codigo: '1523-45-LE26', nombre: 'Maquinaria de aseo industrial', organismo: 'Municipalidad de Temuco', monto: 45_000_000, cierre: '2026-08-15', keyword: 'maquinaria aseo' },
      { codigo: '2044-12-LR26', nombre: 'Barredora y lavado de calles', organismo: 'Serviu Araucanía', monto: 88_000_000, cierre: '2026-08-20', keyword: 'barredora' },
      { codigo: '3391-08-LE26', nombre: 'Equipos hidrolavadores de alta presión', organismo: 'Hospital Regional', monto: 12_000_000, cierre: '2026-08-10', keyword: 'hidrolavadora' },
    ] }, appUrl),
    cambio: plantillaCambio({ to: '', nombre: 'Camila', codigo: lic.codigo, licitacionNombre: lic.nombre, organismo: lic.organismo, monto: lic.monto, cierre: lic.cierre, actorNombre: 'Jorge', cambios: [
      { tipo: 'Estado', detalle: 'Ahora está en EN PROCESO.' },
      { tipo: 'Líneas', detalle: 'Aseo Industrial, Municipalidades' },
    ] }, appUrl),
  };
}
