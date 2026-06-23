// app/lib/automatizacion.ts
// Interruptor global de "modo manual". Por defecto el front está PAUSADO: NO
// dispara nada automáticamente (descarga, viabilidad, análisis IA, clasificación)
// y el usuario ejecuta cada paso con su botón.
//
// Para REACTIVAR la automatización hay que poner explícitamente
// NEXT_PUBLIC_AUTOMATIZACION_PAUSADA=0 (o =false). Cualquier otro valor —incluido
// ausente, '1' o 'true'— se interpreta como PAUSADO. Esto es a propósito: ante la
// duda, no recargar/no gastar IA solo.
//
// Es NEXT_PUBLIC_* porque los disparadores automáticos viven en componentes cliente.

const _flag = (process.env.NEXT_PUBLIC_AUTOMATIZACION_PAUSADA ?? '').trim().toLowerCase();
export const AUTOMATIZACION_PAUSADA = _flag !== '0' && _flag !== 'false';

// Helper legible en los useEffect: "¿puedo disparar algo automáticamente?"
export const autoPermitido = (): boolean => !AUTOMATIZACION_PAUSADA;
