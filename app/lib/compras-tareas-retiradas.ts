// Tareas del catálogo de Compras que se sacaron del sistema. Sus filas siguen en `compras_tarea` (no se borra nada):
// el código no las crea, no las lista ni las cuenta. Vale para todas las empresas, sin migración.
// 'reloj_entrega': reloj de entrega, sacado el 2026-11-27 por decisión del dueño (no calculaba con seguridad).
const RETIRADAS = ['reloj_entrega'] as const;

/** Condición SQL para dejar fuera las tareas retiradas. Las tareas propias (sin clave) pasan. */
export const sinTareasRetiradas = (columna: string) => `COALESCE(${columna}, '') NOT IN (${RETIRADAS.map(c => `'${c}'`).join(',')})`;
