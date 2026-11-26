// app/lib/solicitud-alta-core.ts
// Validación PURA de una solicitud de alta de empresa (formulario público /registro). Sin base de datos: se prueba sola.
// El RUT se valida con las funciones de evaluar-empresa-rut (pasadas por parámetro para no arrastrar la IA ni la BD a las pruebas).

export interface SolicitudDatos {
  razonSocial: string;
  rut: string;
  contactoNombre: string;
  contactoEmail: string;
  contactoTelefono: string | null;
  mensaje: string | null;
}

export type ResultadoValidacion =
  | { ok: true; datos: SolicitudDatos }
  | { ok: false; error: string }
  /** El campo trampa (honeypot) vino lleno: es un robot. Se responde «ok» sin guardar nada. */
  | { ok: false; robot: true; error: string };

export interface FuncionesRut { valido: (r: string) => boolean; formatear: (r: string) => string }

/** Limpia: sin caracteres de control, espacios colapsados, tope de largo. */
export function limpiarTexto(v: unknown, max: number): string {
  return String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export function validarSolicitud(raw: any, rut: FuncionesRut): ResultadoValidacion {
  // Campo trampa: un humano no lo ve (oculto en el formulario); los robots suelen llenar todo.
  if (limpiarTexto(raw?.web, 100)) return { ok: false, robot: true, error: 'robot' };

  const razonSocial = limpiarTexto(raw?.razonSocial, 200);
  const contactoNombre = limpiarTexto(raw?.contactoNombre, 150);
  const contactoEmail = limpiarTexto(raw?.contactoEmail, 190).toLowerCase();
  const rutCrudo = limpiarTexto(raw?.rut, 20);
  const tel = limpiarTexto(raw?.contactoTelefono, 40);
  const mensaje = limpiarTexto(raw?.mensaje, 500);

  if (razonSocial.length < 3) return { ok: false, error: 'Escribe el nombre o razón social de tu empresa.' };
  if (!rutCrudo || !rut.valido(rutCrudo)) return { ok: false, error: 'El RUT de la empresa no es válido (revisa el dígito verificador).' };
  if (contactoNombre.length < 3) return { ok: false, error: 'Escribe el nombre de la persona de contacto.' };
  if (!EMAIL.test(contactoEmail)) return { ok: false, error: 'El correo de contacto no es válido.' };
  if (tel && !/^[+\d][\d\s()-]{5,}$/.test(tel)) return { ok: false, error: 'El teléfono no es válido.' };

  return { ok: true, datos: { razonSocial, rut: rut.formatear(rutCrudo), contactoNombre, contactoEmail, contactoTelefono: tel || null, mensaje: mensaje || null } };
}

// ── Topes anti-abuso (la solicitud no gasta nada hasta que un admin la aprueba, pero el panel no debe llenarse de basura) ──
export const TOPES_SOLICITUD = {
  porIp24h: 3,        // solicitudes de la misma IP en 24 horas
  pendientesTotal: 100, // solicitudes pendientes en todo el sistema
};

export type MotivoRechazoAutomatico = 'ip' | 'lleno' | 'repetida';

/** Decide si la solicitud se guarda. Todas las negativas se contestan al visitante con el MISMO mensaje neutro (no se revela nada). */
export function decidirGuardado(c: { solicitudesDeLaIp24h: number; pendientesTotal: number; yaHayPendientePorRutOCorreo: boolean; yaEsCliente: boolean }): { guardar: true } | { guardar: false; motivo: MotivoRechazoAutomatico | 'cliente' } {
  if (c.yaEsCliente) return { guardar: false, motivo: 'cliente' };
  if (c.yaHayPendientePorRutOCorreo) return { guardar: false, motivo: 'repetida' };
  if (c.solicitudesDeLaIp24h >= TOPES_SOLICITUD.porIp24h) return { guardar: false, motivo: 'ip' };
  if (c.pendientesTotal >= TOPES_SOLICITUD.pendientesTotal) return { guardar: false, motivo: 'lleno' };
  return { guardar: true };
}
