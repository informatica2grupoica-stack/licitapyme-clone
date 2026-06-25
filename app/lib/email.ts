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

function plantillaAsignacion(p: AsignacionEmail, appUrl: string): string {
  const titulo = p.reasignacion ? 'Se te reasignó una licitación' : 'Nueva licitación asignada';
  const url = appUrl ? `${appUrl.replace(/\/$/, '')}/licitacion/${encodeURIComponent(p.codigo)}` : '';
  const fila = (label: string, valor: string | null) => valor
    ? `<tr><td style="padding:6px 0;color:#64748b;font-size:13px;width:130px;">${label}</td><td style="padding:6px 0;color:#0f172a;font-size:13px;font-weight:600;">${esc(valor)}</td></tr>`
    : '';
  return `
  <div style="background:#f1f5f9;padding:32px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:540px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:24px 28px;">
        <p style="margin:0;color:#c7d2fe;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">ICA Licitaciones</p>
        <h1 style="margin:6px 0 0;color:#fff;font-size:20px;font-weight:800;">${titulo}</h1>
      </div>
      <div style="padding:28px;">
        <p style="margin:0 0 16px;color:#334155;font-size:14px;">Hola ${esc(p.nombre || '')},</p>
        <p style="margin:0 0 20px;color:#334155;font-size:14px;line-height:1.6;">
          ${p.actorNombre ? esc(p.actorNombre) + ' te ' : 'Se te '}${p.reasignacion ? 'reasignó' : 'asignó'} la siguiente licitación para que la gestiones:
        </p>
        <div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;background:#f8fafc;">
          <p style="margin:0 0 4px;color:#0f172a;font-size:15px;font-weight:700;">${esc(p.licitacionNombre || p.codigo)}</p>
          <p style="margin:0 0 12px;font-family:monospace;color:#6366f1;font-size:12px;">${esc(p.codigo)}</p>
          <table style="width:100%;border-collapse:collapse;">
            ${fila('Organismo', p.organismo || null)}
            ${fila('Monto estimado', fmtMonto(p.monto))}
            ${fila('Cierre', fmtFecha(p.cierre))}
          </table>
        </div>
        ${url ? `<a href="${url}" style="display:inline-block;margin-top:22px;background:#4f46e5;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 22px;border-radius:10px;">Ver licitación →</a>` : ''}
        <p style="margin:24px 0 0;color:#94a3b8;font-size:12px;line-height:1.6;">Este correo es automático. Si crees que es un error, contacta a tu administrador.</p>
      </div>
    </div>
  </div>`;
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

/** Verifica la conexión SMTP (para un endpoint de prueba). */
export async function verificarSMTP(): Promise<{ ok: boolean; error?: string }> {
  const t = transporter();
  if (!t) return { ok: false, error: 'SMTP no configurado (SMTP_HOST/USER/PASS)' };
  try { await t.verify(); return { ok: true }; }
  catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
}
