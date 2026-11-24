// app/lib/compras-proveedores-validar.ts
// Validación pura (sin base de datos) de los datos de un proveedor que se escriben a mano en el catálogo.
// QA 24-nov-2026: el catálogo aceptaba RUT «123», correos y teléfonos de cualquier cosa y nombre vacío. Solo se validan los campos que vienen
// con algo escrito (vacío = «sin dato», se permite). Los datos viejos no se tocan: quien edita otro campo no queda bloqueado por un RUT antiguo malo.

/** Solo dígitos y K, en mayúscula: «76.086.428-5» → «760864285». */
export const rutPlanoProveedor = (r: unknown): string => String(r ?? '').replace(/[^0-9kK]/g, '').toUpperCase();

/** Dígito verificador (módulo 11) de un RUT chileno en cualquier formato de entrada. */
export function rutProveedorValido(rut: unknown): boolean {
  const s = rutPlanoProveedor(rut);
  if (!/^\d{7,8}[\dK]$/.test(s)) return false;
  let suma = 0, mult = 2;
  for (const d of s.slice(0, -1).split('').reverse()) { suma += Number(d) * mult; mult = mult === 7 ? 2 : mult + 1; }
  const dv = 11 - (suma % 11);
  return s.slice(-1) === (dv === 11 ? '0' : dv === 10 ? 'K' : String(dv));
}

const CORREO = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

/** Devuelve el primer problema encontrado en los campos escritos (texto para mostrar a la persona) o null si todo está bien. */
export function problemaDeProveedor(d: Record<string, unknown>, opciones: { rutSinCambio?: boolean } = {}): string | null {
  if (d.nombreEmpresa !== undefined && !String(d.nombreEmpresa ?? '').trim()) return 'Falta el nombre de la empresa.';
  const rut = String(d.rut ?? '').trim();
  if (rut && !opciones.rutSinCambio && !rutProveedorValido(rut)) return `El RUT «${rut}» no es válido: revisa el número y el dígito verificador.`;
  for (const [campo, etiqueta] of [['correo', 'correo'], ['correoPagos', 'correo de pagos']] as const) {
    const v = String(d[campo] ?? '').trim();
    if (v && !CORREO.test(v)) return `El ${etiqueta} «${v}» no parece un correo válido.`;
  }
  const tel = String(d.telefono ?? '').trim();
  if (tel && (tel.replace(/\D/g, '').length < 6 || tel.length > 40)) return `El teléfono «${tel}» no es válido: debe tener al menos 6 dígitos.`;
  return null;
}
