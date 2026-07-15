// app/lib/actividad-cliente.ts
// Bitácora desde el NAVEGADOR: acciones que no pasan por un endpoint propio (entrar a una
// sección, mirar un documento, abrir una cita de la viabilidad). Alimenta el Historial de la
// licitación vía POST /api/actividad.
//
// DOS capas de deduplicación, a propósito:
//  1) Aquí, en memoria: evita el tráfico repetido mientras la pestaña sigue abierta (cambiar de
//     sección y volver no dispara nada).
//  2) En el servidor (registrarActividadDiaria): la de verdad — una línea por día por perfil,
//     aunque el usuario recargue, entre desde otro equipo o el helper se remonte.
// Best-effort: si falla la red se olvida la marca y se puede reintentar; nunca rompe la UI.

const enviados = new Set<string>();

type AccionCliente = 'ver_documento' | 'ver_seccion' | 'ver_cita';

function registrar(accion: AccionCliente, codigo: string, clave: string, extra: Record<string, unknown> = {}): void {
  if (!codigo || !clave) return;
  const marca = `${accion}|${codigo}|${clave}`;
  if (enviados.has(marca)) return;
  enviados.add(marca);
  fetch('/api/actividad', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion, licitacion_codigo: codigo, clave, ...extra }),
  }).catch(() => { enviados.delete(marca); /* reintentable si falló la red */ });
}

// Entró a una pestaña del detalle (resumen · documentos · viabilidad · criterios · ítems · fechas…).
export function registrarVerSeccion(codigo: string, seccion: string): void {
  registrar('ver_seccion', codigo, seccion, { seccion });
}

// Abrió o descargó un documento de la licitación.
export function registrarVerDocumento(codigo: string, nombre: string, verbo: 'Vio' | 'Descargó'): void {
  registrar('ver_documento', codigo, `${nombre}|${verbo}`, {
    descripcion: `${verbo} el documento "${nombre}"`,
  });
}

// Abrió el visor de una cita de la viabilidad (el "ojo" que salta a la página del PDF).
export function registrarVerCita(codigo: string, titulo: string): void {
  const t = (titulo || '').trim().slice(0, 120);
  registrar('ver_cita', codigo, t || 'cita', {
    descripcion: t ? `Consultó la fuente: ${t}` : 'Consultó una cita de la viabilidad',
  });
}
