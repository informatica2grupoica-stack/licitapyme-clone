// app/lib/descargas-cliente.ts
// El atributo HTML `download` de un <a> se IGNORA en enlaces cross-origin (R2 vive en otro
// dominio que la app) — el navegador cae al Content-Disposition del servidor de origen, que a
// propósito está en `inline` (contentDispositionInline en r2.ts, para no romper el visor), así
// que un clic en "Descargar" terminaba ABRIENDO/PREVISUALIZANDO el documento en vez de bajarlo.
// Pedido explícito del usuario (7-sep-2026): "cuando le dé a descargar que se descargue nomás
// sin visualizar".
//
// /api/proxy YA existe y ya sabe forzar `Content-Disposition: attachment` — es su comportamiento
// por defecto, sin el parámetro `inline=1` que usa el visor (ver app/api/proxy/route.ts). Sirviendo
// el archivo desde el dominio PROPIO de la app, el `download` del navegador deja de ser
// cross-origin y la descarga funciona de verdad, sin abrir nada.
export function urlDescarga(url: string): string {
  return `/api/proxy?url=${encodeURIComponent(url)}`;
}
