// app/lib/whatsapp-avisos-core.ts
// Lógica PURA de los avisos por WhatsApp (sin BD ni red): tipos, reglas de quién recibe qué y redacción del mensaje.
// La parte con BD y envío está en whatsapp-avisos.ts. Se separa para poder probarla (ver __tests__/whatsapp-avisos.test.mts).
// A QUIÉN le toca cada alerta lo decide avisos-reglas.ts (el mismo criterio que el correo).
import { normalizarTelefono } from '@/app/lib/perfil-datos';
import { elegirPersonas, type Alerta, type Persona } from '@/app/lib/avisos-reglas';

export type TipoAviso = Alerta;
export const TIPOS_AVISO: { tipo: TipoAviso; label: string; desc: string }[] = [
  { tipo: 'ganada',        label: 'Licitación ganada',              desc: 'Cuando se publica la adjudicación a nuestro favor.' },
  { tipo: 'perdida',       label: 'Licitación perdida',             desc: 'Cuando se adjudica a otro proveedor.' },
  { tipo: 'estado_mp',     label: 'Cerrada, revocada o desierta',   desc: 'Cuando Mercado Público deja la licitación en uno de esos estados.' },
  { tipo: 'apertura',      label: 'Apertura de ofertas',            desc: 'Cuando se abren las ofertas y ya se pueden revisar.' },
  { tipo: 'oc',            label: 'Orden de compra',                desc: 'Cuando llega una orden de compra nueva.' },
  { tipo: 'oc_vencer',     label: 'Orden de compra por vencer',     desc: 'A las 09:00 y 17:00, si queda poco para aceptar una orden en el portal.' },
  { tipo: 'oc_cancelada', label: 'Orden de compra cancelada',      desc: 'Cuando el organismo cancela la orden de compra de una licitación nuestra.' },
  { tipo: 'cierra_pronto', label: 'Cierra pronto',                  desc: 'Resumen de las licitaciones asignadas que están por cerrar.' },
  { tipo: 'radar',         label: 'Licitaciones nuevas del radar',  desc: 'Resumen de lo nuevo que calza con las palabras clave (solo administradores).' },
];

export type Destinatario = Persona & { telefono: string | null };

/** ¿Se manda por defecto cuando el perfil no eligió nada? Ganada, perdida y apertura sí (son los avisos de siempre);
 *  los demás los autoriza el admin perfil por perfil (decisión del dueño, 09-nov-2026). */
export function porDefecto(_rol: string, tipo: TipoAviso): boolean {
  return tipo === 'ganada' || tipo === 'perdida' || tipo === 'apertura' || tipo === 'oc_cancelada';
}

/**
 * Quién recibe un aviso por WhatsApp: los destinatarios de ESA alerta según avisos-reglas.ts (encargado de la licitación,
 * admins, Compras, Mercado Público… según el tipo) que además tengan el aviso activado en su perfil, la cuenta activa y
 * un celular chileno válido. `encargados` = quienes llevan esa licitación. `prefs` = lo que cada perfil eligió.
 * `omitirAudiencia`: el llamador ya decidió los destinatarios (resúmenes por persona); solo se aplican perfil, cuenta y celular.
 */
export function elegirDestinatarios(
  tipo: TipoAviso,
  encargados: Iterable<number | null | undefined> | number | null,
  candidatos: Destinatario[],
  prefs: Map<number, Partial<Record<TipoAviso, boolean>>>,
  opts: { omitirAudiencia?: boolean } = {},
): Array<Destinatario & { telefonoNormalizado: string }> {
  const lista = encargados == null ? [] : typeof encargados === 'number' ? [encargados] : encargados;
  const audiencia = opts.omitirAudiencia ? candidatos.filter(c => c.activo) : elegirPersonas(tipo, candidatos, lista);
  const salida: Array<Destinatario & { telefonoNormalizado: string }> = [];
  const vistos = new Set<number>();
  for (const c of audiencia) {
    if (vistos.has(c.id)) continue;
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
  /** Solo en 'oc' y 'oc_vencer': código de la orden de compra. */
  ordenCodigo?: string | null;
  /** Texto propio del tipo: el estado (estado_mp), el plazo (oc_vencer), el cierre (cierra_pronto) o el resumen (radar). */
  detalle?: string | null;
}

const clp = (n: number) => '$' + Math.round(n).toLocaleString('es-CL');
const primerNombre = (n: string | null) => (n ?? '').trim().split(/\s+/)[0] || '';

const ENCABEZADO: Record<TipoAviso, { icono: string; titulo: string; frase: string }> = {
  ganada:        { icono: '🏆', titulo: 'Licitación adjudicada', frase: 'se publicó la adjudicación de esta licitación a nuestro favor:' },
  perdida:       { icono: '📋', titulo: 'Resultado de licitación', frase: 'se publicó el resultado y esta licitación fue adjudicada a otro proveedor:' },
  estado_mp:     { icono: '⛔', titulo: 'Cambio de estado en Mercado Público', frase: 'Mercado Público cambió el estado de esta licitación:' },
  apertura:      { icono: '📂', titulo: 'Apertura de ofertas', frase: 'se realizó la apertura de esta licitación y ya se pueden revisar las ofertas:' },
  oc:            { icono: '🧾', titulo: 'Orden de compra recibida', frase: 'llegó una orden de compra de esta licitación:' },
  oc_vencer:     { icono: '⏰', titulo: 'Orden de compra por vencer', frase: 'se acaba el plazo para aceptar una orden de compra en el portal:' },
  oc_cancelada:  { icono: '🚫', titulo: 'Orden de compra cancelada', frase: 'el organismo canceló la orden de compra de esta licitación:' },
  cierra_pronto: { icono: '⏰', titulo: 'Cierra pronto', frase: 'estas licitaciones asignadas están por cerrar:' },
  radar:         { icono: '📡', titulo: 'Licitaciones nuevas en el radar', frase: 'el radar encontró licitaciones nuevas:' },
};

/** Texto del aviso: un emoji de encabezado por tipo, con negritas de WhatsApp (*así*) y un enlace que se abre solo con un toque. */
export function redactarAviso(d: DatosAviso): string {
  const e = ENCABEZADO[d.tipo];
  const nom = primerNombre(d.nombreDestinatario);
  const base = d.urlBase.replace(/\/$/, '');
  const saludo = `${nom ? `Hola ${nom}, ` : 'Hola, '}${e.frase}`;
  // Resúmenes (varias licitaciones en un solo mensaje): el detalle trae la lista.
  if (d.tipo === 'radar' || d.tipo === 'cierra_pronto') {
    return [
      `${e.icono} *Licitank · ${e.titulo}*`, '', saludo, '', (d.detalle || '').trim(), '',
      `Ver en Licitank: ${base}${d.tipo === 'radar' ? '/radar' : '/negocios'}`,
    ].join('\n');
  }
  const lineas = [
    `${e.icono} *Licitank · ${e.titulo}*`,
    '',
    saludo,
    '',
    `*${(d.licitacionNombre || d.codigo).trim()}*`,
    `Código: ${d.codigo}`,
  ];
  if (d.organismo) lineas.push(`Organismo: ${d.organismo.trim()}`);
  if ((d.tipo === 'oc' || d.tipo === 'oc_vencer' || d.tipo === 'oc_cancelada') && d.ordenCodigo) lineas.push(`Orden de compra: ${d.ordenCodigo}`);
  if (d.tipo === 'ganada' && d.monto) lineas.push(`Monto adjudicado: ${clp(d.monto)}`);
  if (d.tipo === 'oc' && d.monto) lineas.push(`Monto: ${clp(d.monto)}`);
  if (d.tipo === 'estado_mp' && d.detalle) lineas.push(`Estado: ${d.detalle.trim()}`);
  if ((d.tipo === 'oc_vencer' || d.tipo === 'oc_cancelada') && d.detalle) lineas.push(d.detalle.trim());
  lineas.push('', `Ver en Licitank: ${base}/licitacion/${encodeURIComponent(d.codigo)}`);
  return lineas.join('\n');
}

/** Clave única del aviso: la misma licitación, aviso y persona no se manda dos veces (los cron repiten el mismo evento). */
export const claveAviso = (tipo: TipoAviso, codigo: string, usuarioId: number) => `${tipo}:${codigo}:${usuarioId}`;
