// Avisos del módulo de Compras a las personas a cargo: campana + aviso central en pantalla + correo.
// Una notificación de la campana es un evento de historial con `usuarioId` = destinatario (ver registrarEvento en historial.ts).
// El enlace «dónde corregir» viaja en metadata.url (/compras/<id>?fase=aprobacion): lo usan la campana, el aviso central y el correo.
import pool from '@/app/lib/db';
import { registrarEvento } from '@/app/lib/historial';
import { obtenerAsignacion } from '@/app/lib/compras';
import { enviarAvisoAprobacionCompras } from '@/app/lib/email';

export interface CorreoAviso {
  resultado: 'APROBADA' | 'APROBADA_CON_CAMBIOS' | 'RECHAZADA' | 'CORREGIDA' | 'INCIDENCIA';
  /** «la compra», «el margen», «un producto»… */
  que: string;
  comentario?: string | null;
}

/** Ruta que abre el producto exacto donde hay que corregir (pestaña de fichas o cotizaciones del paso Costeo). */
export const rutaCorregirProducto = (negocioId: number, productoId: number, pestana: 'fichas' | 'cotizaciones' = 'fichas') =>
  `/compras/${negocioId}?fase=costeo&pestana=${pestana}&producto=${productoId}`;

/** Avisa al encargado de Compras del negocio y a sus coencargados, y siempre con copia a quien hizo la acción (para poder probar).
 *  EN LOCAL (NODE_ENV distinto de «production») o con COMPRAS_AVISOS_SOLO_YO=1, el aviso llega SOLO a quien hizo la acción: la base de datos
 *  de desarrollo es la misma que la real, así que sin este freno una prueba local le llegaría a los demás asistentes.
 *  Con `correo` además sale un correo a cada destinatario (nunca bloquea: si el SMTP falla, la campana ya avisó).
 *  Nunca bloquea la acción principal. */
export async function notificarEncargadosCompras(
  negocioId: number, tipo: string, mensaje: string, actor: { id: number; nombre: string | null }, correo?: CorreoAviso, ruta?: string,
): Promise<void> {
  try {
    const asignacion = await obtenerAsignacion(negocioId);
    if (!asignacion) return;
    const destinatarios = new Map<number, string | null>();
    if (asignacion.asignadoA) destinatarios.set(asignacion.asignadoA, asignacion.asignadoNombre ?? null);
    for (const c of asignacion.coencargados || []) destinatarios.set(c.id, c.nombre ?? null);
    const soloYo = process.env.NODE_ENV !== 'production' || /^(1|true)$/i.test(process.env.COMPRAS_AVISOS_SOLO_YO || '');
    if (soloYo) destinatarios.clear();
    destinatarios.set(actor.id, actor.nombre);
    if (soloYo) mensaje = `[PRUEBA · solo para ti] ${mensaje}`;
    // historial_eventos.mensaje es varchar(500): un comentario largo haría fallar el INSERT y el aviso se perdería en silencio. El correo lleva el texto completo.
    if (mensaje.length > 490) mensaje = `${mensaje.slice(0, 487)}…`;
    const [[neg]]: any = await pool.query(
      `SELECT licitacion_codigo, licitacion_nombre FROM negocios WHERE id = ? LIMIT 1`, [negocioId]);
    const url = ruta || `/compras/${negocioId}?fase=aprobacion`;
    for (const [usuarioId, usuarioNombre] of destinatarios) {
      await registrarEvento({
        tipo, licitacionCodigo: neg?.licitacion_codigo ?? null, licitacionNombre: neg?.licitacion_nombre ?? null, usuarioId, usuarioNombre,
        actorId: actor.id, actorNombre: actor.nombre, mensaje, metadata: { negocio_id: negocioId, url, aviso_central: true },
      });
      if (!correo) continue;
      try {
        const [[u]]: any = await pool.query(`SELECT email FROM usuarios WHERE id = ? LIMIT 1`, [usuarioId]);
        if (!u?.email) continue;
        await enviarAvisoAprobacionCompras({
          to: u.email, nombre: usuarioNombre, resultado: correo.resultado, que: correo.que, decididoPor: actor.nombre, comentario: correo.comentario ?? null,
          codigo: neg?.licitacion_codigo ?? null, licitacionNombre: neg?.licitacion_nombre ?? null, negocioId, prueba: soloYo, ruta: url,
        });
      } catch (e) {
        console.error('[compras-avisos] no se pudo enviar el correo:', String(e).slice(0, 200));
      }
    }
  } catch (e) {
    console.error('[compras-avisos] no se pudo avisar:', String(e).slice(0, 200));
  }
}

/** Avisa a los jefes de ventas (permiso aprobar_comercial o admin activo) que el encargado marcó un producto como corregido.
 *  Mismo freno que arriba: en local o con COMPRAS_AVISOS_SOLO_YO=1 llega solo a quien hizo la acción. Nunca bloquea. */
export async function notificarJefesVentas(
  negocioId: number, tipo: string, mensaje: string, actor: { id: number; nombre: string | null }, correo: CorreoAviso | null, ruta: string,
): Promise<void> {
  try {
    const soloYo = process.env.NODE_ENV !== 'production' || /^(1|true)$/i.test(process.env.COMPRAS_AVISOS_SOLO_YO || '');
    const destinatarios = new Map<number, { nombre: string | null; email: string | null }>();
    const [users]: any = await pool.query(`SELECT id, nombre, email, rol, permisos FROM usuarios WHERE activo = TRUE`);
    for (const u of users) {
      let p: any = {};
      try { p = u.permisos ? (typeof u.permisos === 'string' ? JSON.parse(u.permisos) : u.permisos) : {}; } catch { /* permisos ilegibles: no es jefe */ }
      if (!soloYo && (p?.aprobar_comercial === true || p?.aprobar_comercial === 'true')) destinatarios.set(u.id, { nombre: u.nombre, email: u.email });
      if (u.id === actor.id) destinatarios.set(u.id, { nombre: u.nombre, email: u.email });
    }
    if (soloYo) mensaje = `[PRUEBA · solo para ti] ${mensaje}`;
    if (mensaje.length > 490) mensaje = `${mensaje.slice(0, 487)}…`;
    const [[neg]]: any = await pool.query(`SELECT licitacion_codigo, licitacion_nombre FROM negocios WHERE id = ? LIMIT 1`, [negocioId]);
    for (const [usuarioId, d] of destinatarios) {
      await registrarEvento({
        tipo, licitacionCodigo: neg?.licitacion_codigo ?? null, licitacionNombre: neg?.licitacion_nombre ?? null, usuarioId, usuarioNombre: d.nombre,
        actorId: actor.id, actorNombre: actor.nombre, mensaje, metadata: { negocio_id: negocioId, url: ruta },
      });
      if (!d.email || !correo) continue;   // sin `correo` el aviso es solo campana + aviso central (ej. compra rápida por aprobar)
      try {
        await enviarAvisoAprobacionCompras({
          to: d.email, nombre: d.nombre, resultado: correo.resultado, que: correo.que, decididoPor: actor.nombre, comentario: correo.comentario ?? null,
          codigo: neg?.licitacion_codigo ?? null, licitacionNombre: neg?.licitacion_nombre ?? null, negocioId, prueba: soloYo, ruta,
        });
      } catch (e) { console.error('[compras-avisos] correo a jefe falló:', String(e).slice(0, 200)); }
    }
  } catch (e) {
    console.error('[compras-avisos] no se pudo avisar al jefe de ventas:', String(e).slice(0, 200));
  }
}
