// app/lib/legal-config.ts
// Datos de quien opera LICITANK y publica la política de privacidad y los términos. Van por variable de entorno (nada de datos de
// empresa escritos en el código: skill multiempresa-escalable). Si falta alguno, la página lo muestra como «[por completar]» para que
// se note antes de publicar. Se leen al pedir la página (las páginas son `force-dynamic`), no al compilar.

export const PENDIENTE_LEGAL = '[por completar]';
const leer = (n: string) => (process.env[n] || '').trim() || PENDIENTE_LEGAL;

export function datosLegales() {
  return {
    razonSocial: leer('LEGAL_RAZON_SOCIAL'),
    rut: leer('LEGAL_RUT'),
    domicilio: leer('LEGAL_DOMICILIO'),
    correoPrivacidad: leer('LEGAL_CORREO_PRIVACIDAD'),
    /** Fecha de la última versión de los textos (aaaa-mm-dd). */
    vigencia: (process.env.LEGAL_VIGENCIA || '').trim() || '2026-11-17',
  };
}
