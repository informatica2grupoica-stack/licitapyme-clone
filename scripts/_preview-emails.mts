// Renderiza las plantillas de correo a un HTML de previsualización (no envía nada).
// Uso: npx tsx scripts/_preview-emails.mts
import { writeFileSync } from 'node:fs';
const { previewEmailsHTML } = await import('@/app/lib/email');
const p = previewEmailsHTML();
const sep = (t: string) => `<div style="max-width:600px;margin:24px auto 8px;font:700 13px/-apple-system,Segoe UI,Roboto,sans-serif;color:#475569;text-transform:uppercase;letter-spacing:.08em;padding:0 16px;">${t}</div>`;
const html = `<!doctype html><meta charset="utf-8"><title>Preview correos ICA</title><body style="margin:0;background:#e2e8f0;">
${sep('1 · Asignación / Reasignación')}${p.asignacion}
${sep('2 · Digest de radar (nuevas por perfil)')}${p.digest}
${sep('3 · Cambios en licitación asignada')}${p.cambio}
</body>`;
const out = 'scripts/_preview-emails.html';
writeFileSync(out, html, 'utf8');
console.log('OK →', out);
