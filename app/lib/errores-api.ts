// app/lib/errores-api.ts
// Qué mensaje de un error puede ver quien usa la pantalla. Las reglas de negocio lanzan errores con un texto pensado para la
// persona («Falta el link…»), y ese se muestra tal cual. Los errores del sistema (MySQL, red, un bug) llevan nombres de tablas,
// columnas o rutas internas: esos NO salen al navegador (quedan en el log del servidor) y se muestra el mensaje por defecto.
export function mensajeSeguro(e: unknown, porDefecto: string): string {
  const x = e as { message?: unknown; code?: unknown; sqlMessage?: unknown; sql?: unknown; errno?: unknown } | null;
  const msg = typeof x?.message === 'string' ? x.message.trim() : '';
  if (!msg) return porDefecto;
  if (x?.sqlMessage || x?.sql || (typeof x?.code === 'string' && /^(ER_|E[A-Z]{3,}$|PROTOCOL_|ERR_)/.test(x.code))) return porDefecto;
  if (/\b(ER_[A-Z_]+|ECONN\w+|ENOTFOUND|ETIMEDOUT|ENOENT|EACCES)\b|SQL syntax|Unknown column|doesn't exist|\bat\s+\S+\s+\(|\.(ts|tsx|js|mjs):\d+|Cannot read prop|is not a function|is not defined|undefined|\[object /i.test(msg)) return porDefecto;
  return msg.length > 300 ? porDefecto : msg;
}
