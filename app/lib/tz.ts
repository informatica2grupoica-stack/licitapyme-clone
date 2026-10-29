// Utilidades de zona horaria. TODA la lógica de negocio de esta app es de Chile
// (America/Santiago). Los datetime de la BD (licitacion_cierre, etc.) se guardan como
// "hora de pared" de Chile (coinciden con la FechaCierre que publica Mercado Público).
//
// OJO con dos trampas de zona horaria en este stack:
//  • El proceso Node debe correr en America/Santiago (TZ=America/Santiago). En Docker el
//    contenedor arranca en UTC por defecto → mysql2 leería los cierres 3-4h corridos y
//    marcaría "vencida" antes de tiempo. Por eso el Dockerfile fija TZ.
//  • El servidor MySQL de Bluehost corre en otra zona (UTC-6), así que NUNCA se debe
//    comparar un cierre chileno contra NOW()/CURDATE() del servidor. Usa ahoraChileSQL().
export const TZ_CHILE = 'America/Santiago';

// "Ahora" en Chile como string 'YYYY-MM-DD HH:mm:ss' (hora de pared), correcto en horario
// de verano/invierno e INDEPENDIENTE de la zona del proceso. Se usa para comparar contra
// columnas datetime que guardan hora de pared chilena, p.ej.:
//   WHERE licitacion_cierre < ?   con param = ahoraChileSQL()
export function ahoraChileSQL(d: Date = new Date()): string {
  // 'sv-SE' produce el formato ISO con espacio: "2026-07-06 14:12:10".
  return d.toLocaleString('sv-SE', { timeZone: TZ_CHILE });
}

// Días de CALENDARIO (hora de Chile) entre hoy y la fecha dada: 0 = hoy, 1 = mañana, -1 = ayer.
// NUNCA dividir milisegundos por 24 h para esto: un cierre hoy a las 20:00 visto a las 08:00 da 0,5
// y Math.ceil/round lo convertían en "mañana" (y uno de mañana 09:00 visto a las 15:00 en "hoy").
// Independiente de la zona del navegador/servidor.
export function diasCalendarioChile(fecha: Date | string | number | null | undefined, ahora: Date | number = new Date()): number | null {
  if (fecha == null || fecha === '') return null;
  const t = new Date(fecha).getTime();
  if (Number.isNaN(t)) return null;
  const dia = (ms: number) => {
    const [y, m, d] = new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ_CHILE }).split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 86_400_000;
  };
  return Math.round(dia(t) - dia(new Date(ahora).getTime()));
}

// Minutos que faltan para la medianoche de HOY en hora de Chile. Usado por el gobernador de
// cuota de la API de Mercado Público (mercado-publico.ts) para repartir lo que queda del
// presupuesto diario entre las corridas que faltan hasta que el contador se reinicie a las 00:00.
export function minutosHastaMedianocheChile(d: Date = new Date()): number {
  const [horaMin] = ahoraChileSQL(d).split(' ').slice(1);
  const [h, m, s] = horaMin.split(':').map(Number);
  return Math.max(1, 24 * 60 - (h * 60 + m + s / 60));
}
