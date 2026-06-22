// app/lib/automatizacion.ts
// Interruptor global de "modo manual". Cuando NEXT_PUBLIC_AUTOMATIZACION_PAUSADA=1,
// el front NO dispara nada automáticamente (descarga, viabilidad, análisis IA,
// clasificación). El usuario ejecuta cada paso con su botón. Para reactivar la
// automatización, poner la variable en 0 (o borrarla) en .env.local.
//
// Es NEXT_PUBLIC_* porque los disparadores automáticos viven en componentes cliente.

export const AUTOMATIZACION_PAUSADA =
  process.env.NEXT_PUBLIC_AUTOMATIZACION_PAUSADA === '1';

// Helper legible en los useEffect: "¿puedo disparar algo automáticamente?"
export const autoPermitido = (): boolean => !AUTOMATIZACION_PAUSADA;
