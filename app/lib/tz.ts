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
