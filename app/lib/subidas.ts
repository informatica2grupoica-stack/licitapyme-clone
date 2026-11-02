// app/lib/subidas.ts
// Reglas únicas para los archivos que se suben en Compras (cotizaciones, comprobantes, pagos, respaldos de hitos).
// Pedido del dueño (02-nov-2026): máximo 20 MB por archivo. El mismo tope está en next.config.ts (proxyClientMaxBodySize) con
// holgura para el resto del formulario: si no, Next recorta en silencio el cuerpo a 10 MB y el archivo llega cortado.
export const MAX_SUBIDA_MB = 20;
export const MAX_SUBIDA_BYTES = MAX_SUBIDA_MB * 1024 * 1024;

// Sin svg ni html: un archivo activo subido aquí se serviría desde nuestro propio dominio.
const EXTENSIONES_SUBIDA = /\.(pdf|docx?|xlsx?|pptx?|rtf|txt|csv|xml|png|jpe?g|gif|webp|bmp|heic|zip|rar|msg|eml)$/i;

/** null = el archivo sirve; si no, el mensaje (en castellano, listo para mostrar) de por qué se rechaza. */
export function errorDeArchivoSubido(file: { name: string; size: number }): string | null {
  if (file.size > MAX_SUBIDA_BYTES) return `«${file.name}» pesa más de ${MAX_SUBIDA_MB} MB. Comprímelo o divídelo y vuelve a subirlo.`;
  if (!EXTENSIONES_SUBIDA.test(file.name)) return `«${file.name}»: formato no permitido. Sube PDF, Word, Excel, imagen, texto o un comprimido.`;
  return null;
}
