// app/lib/perfil-datos.ts
// Validación y formato de los datos de contacto del perfil (teléfono y RUT chilenos).
// Puro (sin dependencias): lo usan el formulario del cliente y las rutas del servidor,
// así ambos lados aplican exactamente la misma regla.

// Devuelve "+56912345678" o null si no es un número chileno válido (9 dígitos, con o sin +56).
export function normalizarTelefono(entrada: string): string | null {
  let d = String(entrada ?? '').replace(/[^\d]/g, '');
  if (d.length === 11 && d.startsWith('56')) d = d.slice(2);
  if (d.length !== 9) return null;
  return `+56${d}`;
}

// "+56912345678" → "+56 9 1234 5678" (celular) / "+56 2 2345 6789" (fijo).
export function formatearTelefono(t: string | null | undefined): string {
  const m = String(t ?? '').match(/^\+56(\d)(\d{4})(\d{4})$/);
  return m ? `+56 ${m[1]} ${m[2]} ${m[3]}` : (t ?? '');
}

function dvRut(cuerpo: string): string {
  let suma = 0, mult = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += parseInt(cuerpo[i], 10) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const r = 11 - (suma % 11);
  return r === 11 ? '0' : r === 10 ? 'K' : String(r);
}

// Devuelve "12345678-5" o null si el formato o el dígito verificador no calzan.
export function normalizarRut(entrada: string): string | null {
  const limpio = String(entrada ?? '').replace(/[.\s-]/g, '').toUpperCase();
  if (!/^\d{7,8}[\dK]$/.test(limpio)) return null;
  const cuerpo = limpio.slice(0, -1), dv = limpio.slice(-1);
  return dvRut(cuerpo) === dv ? `${cuerpo}-${dv}` : null;
}

// "12345678-5" → "12.345.678-5".
export function formatearRut(r: string | null | undefined): string {
  const m = String(r ?? '').match(/^(\d{1,2})(\d{3})(\d{3})-([\dK])$/);
  return m ? `${m[1]}.${m[2]}.${m[3]}-${m[4]}` : (r ?? '');
}

// Valida y limpia los cuatro campos de contacto. `errores` viene vacío si todo está bien.
// Un campo ausente (undefined) no se toca; uno vacío ("") se borra (null).
export interface DatosContacto { telefono?: string | null; rut?: string | null; cargo?: string | null; area?: string | null }
export function validarContacto(entrada: Record<string, unknown>): { datos: DatosContacto; errores: string[] } {
  const datos: DatosContacto = {};
  const errores: string[] = [];
  const texto = (v: unknown) => String(v ?? '').trim();

  if (entrada.telefono !== undefined) {
    const t = texto(entrada.telefono);
    if (!t) datos.telefono = null;
    else { const n = normalizarTelefono(t); if (n) datos.telefono = n; else errores.push('Teléfono inválido: usa un número chileno de 9 dígitos (ej: +56 9 1234 5678)'); }
  }
  if (entrada.rut !== undefined) {
    const r = texto(entrada.rut);
    if (!r) datos.rut = null;
    else { const n = normalizarRut(r); if (n) datos.rut = n; else errores.push('RUT inválido: revisa el número y el dígito verificador'); }
  }
  for (const campo of ['cargo', 'area'] as const) {
    if (entrada[campo] === undefined) continue;
    const t = texto(entrada[campo]);
    if (t.length > 100) errores.push(`${campo === 'cargo' ? 'Cargo' : 'Área'} demasiado largo (máx. 100 caracteres)`);
    else datos[campo] = t || null;
  }
  return { datos, errores };
}
