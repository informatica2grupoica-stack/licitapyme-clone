// app/lib/semaforo-auditor.ts
// SEMÁFORO Y CAUSALES DE BLOQUEO del Auditor Técnico (Fase 3, spec §9). Módulo puro (sin DB,
// sin IA): cruza tiempo-a-cierre con lo que queda pendiente, y arma la lista de causales con
// su ruta de desbloqueo — nunca "no cumple" a secas, siempre qué hacer para destrabarlo.
//
// El bloqueo impide la GENERACIÓN DE ANEXOS (spec §9.1), no la postulación — pero esa
// generación (Fase 5, Agente Administrativo-Documental) todavía no existe en este proyecto.
// Mientras tanto, `bloqueado` se usa para el popup no-obviable de la sección Auditor Técnico
// (spec §9.4, "en rojo se dispara un popup que no deja avanzar hasta que se resuelva o se
// reconozca expresamente el pendiente"). Cuando exista el botón "Generar documentos", debe
// leer este mismo campo antes de habilitarse.
//
// Causales NO cubiertas todavía (deliberadamente, no simuladas): documento de la carpeta
// administrativa basal vencido (necesita la carpeta basal, aún no construida), render de PDF
// no confirmado (necesita el motor de escritura de documentos, Fase 5) y discordancia entre
// costeo y anexo económico (necesita el Motor Comercial, Fase 4 — una vez construido, sumar su
// causal acá).
export type ColorSemaforo = 'VERDE' | 'AMARILLO' | 'ROJO';

export interface EntradaSemaforo {
  horasRestantes: number | null;        // null = sin fecha de cierre publicada
  bloqueantesPendientes: number;        // ADMISIBILIDAD_DURA sin aprobar (resumirChecklist)
  faltaAprobacionVigente: boolean;      // bloque TÉCNICO y/o COMERCIAL sin aprobación vigente
}

/** Verde: >72h y sin pendientes críticos. Amarillo: <72h, o hay pendientes. Rojo: <24h, o
 *  falta algo bloqueante — el orden importa, rojo manda sobre amarillo. */
export function calcularSemaforo(e: EntradaSemaforo): ColorSemaforo {
  const { horasRestantes: h, bloqueantesPendientes, faltaAprobacionVigente } = e;
  if (bloqueantesPendientes > 0 || (h != null && h < 24)) return 'ROJO';
  if (faltaAprobacionVigente || (h != null && h < 72)) return 'AMARILLO';
  return 'VERDE';
}

export interface CausalBloqueo { codigo: string; descripcion: string; rutaDesbloqueo: string }

export interface EntradaCausales {
  bloqueantesPendientes: number;
  itemsNoCumpleSinResolver: number;
  itemsPendientesProveedor: number;
  bloqueTecnicoAprobado: boolean;    // true también cuando el bloque no tiene ítems (nada que aprobar)
  bloqueComercialAprobado: boolean;
  horasRestantes: number | null;     // el causal de cierre inminente se decide por esto, NO por el color final del semáforo (que puede ser rojo por otro motivo, ej. bloqueantes, aunque falten días para el cierre)
}

/** Cada causal trae SIEMPRE su ruta de desbloqueo (spec §9.2: nunca "no cumple" a secas). */
export function causalesDeBloqueo(a: EntradaCausales): CausalBloqueo[] {
  const causales: CausalBloqueo[] = [];

  if (a.bloqueantesPendientes > 0) causales.push({
    codigo: 'ADMISIBILIDAD_DURA_PENDIENTE',
    descripcion: `${a.bloqueantesPendientes} punto(s) de admisibilidad dura sin aprobar`,
    rutaDesbloqueo: 'Cargar y aprobar esos puntos en la pestaña Auditor Técnico.',
  });
  if (a.itemsNoCumpleSinResolver > 0) causales.push({
    codigo: 'NO_CUMPLE_SIN_RESOLVER',
    descripcion: `${a.itemsNoCumpleSinResolver} característica(s) técnica(s) NO CUMPLE sin resolver`,
    rutaDesbloqueo: 'Ofertar un producto que cumpla, o que el asesor corrija el veredicto con su fundamento.',
  });
  if (a.itemsPendientesProveedor > 0) causales.push({
    codigo: 'PENDIENTE_CONFIRMACION_PROVEEDOR',
    descripcion: `${a.itemsPendientesProveedor} característica(s) esperando confirmación del proveedor`,
    rutaDesbloqueo: 'Contactar al proveedor y cargar el dato en la línea técnica correspondiente.',
  });
  if (!a.bloqueTecnicoAprobado) causales.push({
    codigo: 'BLOQUE_TECNICO_SIN_APROBAR',
    descripcion: 'El bloque técnico no tiene aprobación vigente del asesor',
    rutaDesbloqueo: 'Esperar a que el asesor apruebe el bloque técnico en /aprobaciones.',
  });
  if (!a.bloqueComercialAprobado) causales.push({
    codigo: 'BLOQUE_COMERCIAL_SIN_APROBAR',
    descripcion: 'El bloque comercial no tiene aprobación vigente del asesor',
    rutaDesbloqueo: 'Esperar a que el asesor apruebe el bloque comercial en /aprobaciones.',
  });
  if (a.horasRestantes != null && a.horasRestantes < 24) causales.push({
    codigo: 'CIERRE_INMINENTE',
    descripcion: a.horasRestantes < 0 ? 'El plazo de cierre ya venció' : 'Quedan menos de 24 horas para el cierre',
    rutaDesbloqueo: 'Resolver los pendientes de arriba, o reconocer expresamente el riesgo para seguir trabajando.',
  });

  return causales;
}
