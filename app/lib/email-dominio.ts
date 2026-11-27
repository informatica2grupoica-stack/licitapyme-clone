// app/lib/email-dominio.ts
// Dominio con el que el servidor se presenta al SMTP (EHLO) y con el que se firma el correo. Puro, para probarlo sin red.
// Antes salía de SMTP_USER; con un proveedor transaccional (Resend: usuario «resend»; Brevo: «xxxx@smtp-brevo.com») eso da un dominio que NO
// es el nuestro y empeora la entrega. El que manda es el dominio del remitente (SMTP_FROM), que es el que se verifica con SPF/DKIM.

/** «LICITANK <avisos@licitank.cl>» → «licitank.cl»; «avisos@licitank.cl» → «licitank.cl»; si no hay arroba, undefined. */
export function dominioDe(direccion: string | undefined | null): string | undefined {
  const m = /@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/.exec(String(direccion ?? ''));
  return m ? m[1].toLowerCase() : undefined;
}

/** Nombre EHLO: el dominio del remitente; si no se puede, el del usuario SMTP; si no, undefined (nodemailer usa el suyo). */
export function nombreEhlo(from: string | undefined | null, user: string | undefined | null): string | undefined {
  return dominioDe(from) ?? dominioDe(user);
}
