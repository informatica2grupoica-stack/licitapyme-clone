// app/lib/avisos-reglas.ts
// UNA sola regla de «a quién le llega cada alerta», compartida por el correo y el WhatsApp (puro, sin BD ni red).
// Decisión del dueño (09-nov-2026): antes cada canal decidía por su cuenta y el WhatsApp salía a todo el equipo.
// Ahora cada asistente solo se entera de SUS licitaciones; Compras y Mercado Público se reconocen por el campo
// «Área» del perfil (Admin > Usuarios), no por nombres escritos en el código (el sistema se vende a otras empresas).
//
//   Alerta           Quién la recibe
//   ganada           encargado de la licitación · admins · Compras
//   perdida          encargado de la licitación · admins · Compras
//   estado_mp        encargado de la licitación · admins · Compras   (Cerrada / Revocada / Desierta)
//   apertura         encargado de la licitación · Compras · Mercado Público
//   oc               encargado (comercial y de Compras) · Compras · Mercado Público
//   oc_vencer        encargado (comercial y de Compras) · Compras · Mercado Público
//   oc_cancelada     encargado (comercial y de Compras) · admins   (el organismo canceló la OC del cliente; 10-nov-2026)
//   cierra_pronto    encargado de la licitación · Mercado Público
//   radar            admins
//
// El WhatsApp además exige que la persona tenga el aviso activado en su perfil (ver whatsapp-avisos-core.ts).

export type Alerta = 'ganada' | 'perdida' | 'estado_mp' | 'apertura' | 'oc' | 'oc_vencer' | 'oc_cancelada' | 'cierra_pronto' | 'radar';
export type Grupo = 'encargado' | 'admin' | 'compras' | 'mp';

export const REGLAS: Record<Alerta, Grupo[]> = {
  ganada:        ['encargado', 'admin', 'compras'],
  perdida:       ['encargado', 'admin', 'compras'],
  estado_mp:     ['encargado', 'admin', 'compras'],
  apertura:      ['encargado', 'compras', 'mp'],
  oc:            ['encargado', 'compras', 'mp'],
  oc_vencer:     ['encargado', 'compras', 'mp'],
  oc_cancelada:  ['encargado', 'admin'],
  cierra_pronto: ['encargado', 'mp'],
  radar:         ['admin'],
};

export interface Persona {
  id: number;
  nombre: string | null;
  email?: string | null;
  rol: string;
  /** Área del perfil (texto libre en Admin > Usuarios): «Compras», «Mercado Público»… */
  area?: string | null;
  activo: boolean | number;
  telefono?: string | null;
}

/** Sin tildes, mayúsculas ni espacios de más: «  Mercado   Público » = «mercado publico». */
export const normalizarArea = (a: string | null | undefined): string =>
  String(a ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** A qué equipo pertenece el perfil según su Área. */
export function equipoDe(area: string | null | undefined): 'compras' | 'mp' | null {
  const a = normalizarArea(area);
  if (!a) return null;
  if (a === 'compras' || a.startsWith('compras ')) return 'compras';
  if (a === 'mp' || a === 'mercado publico' || a.startsWith('mercado publico ')) return 'mp';
  return null;
}

/** ¿Este perfil es destinatario de la alerta? `encargados` = ids de quienes llevan ESA licitación. */
export function esDestinatario(alerta: Alerta, p: Persona, encargados: ReadonlySet<number>): boolean {
  if (!p.activo) return false;
  const grupos = REGLAS[alerta];
  const esEncargado = encargados.has(Number(p.id));
  if (esEncargado && grupos.includes('encargado')) return true;
  // El perfil externo solo ve lo que lleva él: nunca por rol ni por Área.
  if (p.rol === 'externo') return false;
  if (grupos.includes('admin') && p.rol === 'admin') return true;
  const eq = equipoDe(p.area);
  if (eq && grupos.includes(eq)) return true;
  return false;
}

/** Los destinatarios de una alerta, sin repetir personas. */
export function elegirPersonas<T extends Persona>(alerta: Alerta, personas: T[], encargados: Iterable<number | null | undefined>): T[] {
  const enc = new Set<number>();
  for (const e of encargados) if (e != null && Number(e) > 0) enc.add(Number(e));
  const vistos = new Set<number>();
  const salida: T[] = [];
  for (const p of personas) {
    const id = Number(p.id);
    if (vistos.has(id) || !esDestinatario(alerta, p, enc)) continue;
    vistos.add(id);
    salida.push(p);
  }
  return salida;
}

/** ¿Tiene sentido mostrar este aviso en el perfil? (por rol y Área; todos pueden ser «encargado» de alguna licitación). */
export function alertaAplicaAPerfil(alerta: Alerta, perfil: { rol: string; area?: string | null }): boolean {
  const grupos = REGLAS[alerta];
  if (grupos.includes('encargado')) return true;
  if (perfil.rol === 'externo') return false;
  if (grupos.includes('admin') && perfil.rol === 'admin') return true;
  const eq = equipoDe(perfil.area);
  return !!eq && grupos.includes(eq);
}
