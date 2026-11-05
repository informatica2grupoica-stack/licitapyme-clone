// app/lib/whatsapp-avisos-core.ts
// Lógica PURA de los avisos por WhatsApp (sin BD ni red): tipos, reglas de quién recibe qué y redacción del mensaje.
// La parte con BD y envío está en whatsapp-avisos.ts. Se separa para poder probarla (ver __tests__/whatsapp-avisos.test.mts).
import { normalizarTelefono } from '@/app/lib/perfil-datos';

export type TipoAviso = 'ganada' | 'perdida' | 'apertura' | 'oc';
export const TIPOS_AVISO: { tipo: TipoAviso; label: string; desc: string }[] = [
  { tipo: 'ganada',   label: 'Licitación ganada',   desc: 'Cuando se publica la adjudicación a nuestro favor.' },
  { tipo: 'perdida',  label: 'Licitación perdida',  desc: 'Cuando se adjudica a otro proveedor.' },
  { tipo: 'apertura', label: 'Apertura de ofertas', desc: 'Cuando se abren las ofertas y ya se pueden revisar.' },
  { tipo: 'oc',       label: 'Orden de compra',     desc: 'Cuando llega una orden de compra nueva, de cualquier licitación de la empresa. Solo a quien se le active.' },
];

export interface Destinatario {
  id: number;
  nombre: string | null;
  rol: 'admin' | 'usuario' | 'externo' | string;
  activo: boolean | number;
  telefono: string | null;
}

/** ¿Este aviso se manda por defecto cuando el perfil no eligió nada? Todos reciben ganada/perdida/apertura de toda la empresa;
 *  la orden de compra solo le llega a quien el admin se la active (decisión del dueño, 04-nov-2026). */
export function porDefecto(_rol: string, tipo: TipoAviso): boolean {
  return tipo !== 'oc';
}

/**
 * Quién recibe un aviso de una licitación: todo perfil del equipo que tenga ese aviso activado, de TODAS las licitaciones de la
 * empresa, sea o no el responsable (decisión del dueño, 05-nov-2026: antes el rol «usuario» solo recibía las suyas).
 *  · El perfil externo solo recibe las licitaciones de las que es responsable.
 * Siempre que la cuenta esté activa y tenga un celular chileno válido. `prefs` = lo que cada perfil eligió (usuario → tipo → sí/no).
 */
export function elegirDestinatarios(
  tipo: TipoAviso,
  asignadoId: number | null,
  candidatos: Destinatario[],
  prefs: Map<number, Partial<Record<TipoAviso, boolean>>>,
): Array<Destinatario & { telefonoNormalizado: string }> {
  const salida: Array<Destinatario & { telefonoNormalizado: string }> = [];
  const vistos = new Set<number>();
  for (const c of candidatos) {
    if (vistos.has(c.id) || !c.activo) continue;
    const esAsignado = asignadoId != null && Number(c.id) === Number(asignadoId);
    const alcance = esAsignado || c.rol !== 'externo';
    if (!alcance) continue;
    const elegido = prefs.get(c.id)?.[tipo];
    if (!(elegido ?? porDefecto(c.rol, tipo))) continue;
    const tel = normalizarTelefono(c.telefono ?? '');
    if (!tel) continue;
    vistos.add(c.id);
    salida.push({ ...c, telefonoNormalizado: tel });
  }
  return salida;
}

export interface DatosAviso {
  tipo: TipoAviso;
  codigo: string;
  licitacionNombre: string | null;
  organismo?: string | null;
  monto?: number | null;
  nombreDestinatario: string | null;
  urlBase: string;
  /** Solo en 'oc': código de la orden de compra. */
  ordenCodigo?: string | null;
}

const clp = (n: number) => '$' + Math.round(n).toLocaleString('es-CL');
const primerNombre = (n: string | null) => (n ?? '').trim().split(/\s+/)[0] || '';

const ENCABEZADO: Record<TipoAviso, { icono: string; titulo: string; frase: string }> = {
  ganada:   { icono: '🏆', titulo: 'Licitación adjudicada', frase: 'se publicó la adjudicación de esta licitación a nuestro favor:' },
  perdida:  { icono: '📋', titulo: 'Resultado de licitación', frase: 'se publicó el resultado y esta licitación fue adjudicada a otro proveedor:' },
  apertura: { icono: '📂', titulo: 'Apertura de ofertas', frase: 'se realizó la apertura de esta licitación y ya se pueden revisar las ofertas:' },
  oc:       { icono: '🧾', titulo: 'Orden de compra recibida', frase: 'llegó una orden de compra de esta licitación:' },
};

/** Texto del aviso: un emoji de encabezado por tipo, con negritas de WhatsApp (*así*) y un enlace que se abre solo con un toque. */
export function redactarAviso(d: DatosAviso): string {
  const e = ENCABEZADO[d.tipo];
  const nom = primerNombre(d.nombreDestinatario);
  const lineas = [
    `${e.icono} *Licitank · ${e.titulo}*`,
    '',
    `${nom ? `Hola ${nom}, ` : 'Hola, '}${e.frase}`,
    '',
    `*${(d.licitacionNombre || d.codigo).trim()}*`,
    `Código: ${d.codigo}`,
  ];
  if (d.organismo) lineas.push(`Organismo: ${d.organismo.trim()}`);
  if (d.tipo === 'oc' && d.ordenCodigo) lineas.push(`Orden de compra: ${d.ordenCodigo}`);
  if (d.tipo === 'ganada' && d.monto) lineas.push(`Monto adjudicado: ${clp(d.monto)}`);
  if (d.tipo === 'oc' && d.monto) lineas.push(`Monto: ${clp(d.monto)}`);
  lineas.push('', `Ver en Licitank: ${d.urlBase.replace(/\/$/, '')}/licitacion/${encodeURIComponent(d.codigo)}`);
  return lineas.join('\n');
}

/** Clave única del aviso: la misma licitación, aviso y persona no se manda dos veces (los cron repiten el mismo evento). */
export const claveAviso = (tipo: TipoAviso, codigo: string, usuarioId: number) => `${tipo}:${codigo}:${usuarioId}`;
