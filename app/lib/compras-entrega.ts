// app/lib/compras-entrega.ts
// ENTREGA DEL PROYECTO Y ACTA (spec §16) + POSTVENTA (spec §17.1). El módulo NO emite nota de
// venta, guía de despacho ni factura — todo eso lo emite OBUMA (§16.4/§17.2); acá solo se
// REGISTRAN esos números y las firmas. El único documento oficial que este módulo SÍ genera es el
// acta de entrega (§16.5), y con acta + guía firmadas se cierra el ciclo (§16.7).
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';
import { obtenerAsignacion, listarProductosCompra, coberturaProyecto } from '@/app/lib/compras';

async function licitacionDeNegocio(negocioId: number): Promise<string | null> {
  const [rows] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [negocioId]) as any;
  return (rows as any[])[0]?.licitacion_codigo ?? null;
}

export type ModalidadEntrega = 'TOTAL' | 'PARCIAL';
export interface FirmaDatos { nombre: string; rut: string; cargo: string; recinto: string; fecha: string /* YYYY-MM-DD */ }

export interface Entrega {
  modalidad: ModalidadEntrega; modalidadMotivo: string | null;
  notaVentaNumero: string | null; guiaDespachoNumero: string | null;
  verificacionConforme: boolean | null; verificacionPorNombre: string | null; verificacionAt: string | null;
  actaGeneradaAt: string | null; actaAprobadaPorNombre: string | null; actaAprobadaAt: string | null;
  actaConformidad: 'CONFORME' | 'NO_CONFORME' | null; actaFirma: FirmaDatos | null;
  guiaFirma: FirmaDatos | null; guiaTimbre: boolean;
  cerradaAt: string | null;
  puntos: Array<{ id: number; direccion: string; comuna: string | null; contactoNombre: string | null; contactoTelefono: string | null }>;
}

async function filaEntrega(negocioId: number): Promise<any> {
  const [rows] = await pool.query(
    `SELECT *, DATE_FORMAT(verificacion_at, '%Y-%m-%d %H:%i:%s') AS verificacion_at_fmt,
            DATE_FORMAT(acta_generada_at, '%Y-%m-%d %H:%i:%s') AS acta_generada_at_fmt,
            DATE_FORMAT(acta_aprobada_at, '%Y-%m-%d %H:%i:%s') AS acta_aprobada_at_fmt,
            DATE_FORMAT(acta_firma_fecha, '%Y-%m-%d') AS acta_firma_fecha_fmt,
            DATE_FORMAT(guia_firma_fecha, '%Y-%m-%d') AS guia_firma_fecha_fmt,
            DATE_FORMAT(cerrada_at, '%Y-%m-%d %H:%i:%s') AS cerrada_at_fmt
       FROM compras_entrega WHERE negocio_id = ? LIMIT 1`,
    [negocioId],
  ) as any;
  return (rows as any[])[0] || null;
}

export async function obtenerEntrega(negocioId: number): Promise<Entrega> {
  const r = await filaEntrega(negocioId);
  const [puntos] = await pool.query(
    `SELECT id, direccion, comuna, contacto_nombre, contacto_telefono FROM compras_entrega_punto WHERE negocio_id = ?`,
    [negocioId],
  ) as any;
  const puntosMapeados = (puntos as any[]).map(p => ({ id: p.id, direccion: p.direccion, comuna: p.comuna, contactoNombre: p.contacto_nombre, contactoTelefono: p.contacto_telefono }));
  if (!r) {
    return { modalidad: 'TOTAL', modalidadMotivo: null, notaVentaNumero: null, guiaDespachoNumero: null,
      verificacionConforme: null, verificacionPorNombre: null, verificacionAt: null,
      actaGeneradaAt: null, actaAprobadaPorNombre: null, actaAprobadaAt: null, actaConformidad: null, actaFirma: null,
      guiaFirma: null, guiaTimbre: false, cerradaAt: null, puntos: puntosMapeados };
  }
  return {
    modalidad: r.modalidad, modalidadMotivo: r.modalidad_motivo,
    notaVentaNumero: r.nota_venta_numero, guiaDespachoNumero: r.guia_despacho_numero,
    verificacionConforme: r.verificacion_conforme == null ? null : !!r.verificacion_conforme,
    verificacionPorNombre: r.verificacion_por_nombre, verificacionAt: r.verificacion_at_fmt,
    actaGeneradaAt: r.acta_generada_at_fmt, actaAprobadaPorNombre: r.acta_aprobada_por_nombre, actaAprobadaAt: r.acta_aprobada_at_fmt,
    actaConformidad: r.acta_conformidad,
    actaFirma: r.acta_firma_nombre ? { nombre: r.acta_firma_nombre, rut: r.acta_firma_rut, cargo: r.acta_firma_cargo, recinto: r.acta_firma_recinto, fecha: r.acta_firma_fecha_fmt } : null,
    guiaFirma: r.guia_firma_nombre ? { nombre: r.guia_firma_nombre, rut: r.guia_firma_rut, cargo: r.guia_firma_cargo, recinto: r.guia_firma_recinto, fecha: r.guia_firma_fecha_fmt } : null,
    guiaTimbre: !!r.guia_timbre, cerradaAt: r.cerrada_at_fmt, puntos: puntosMapeados,
  };
}

async function asegurarFila(negocioId: number): Promise<void> {
  const ahora = ahoraChileSQL();
  await pool.query(
    `INSERT IGNORE INTO compras_entrega (negocio_id, modalidad, created_at, updated_at) VALUES (?, 'TOTAL', ?, ?)`,
    [negocioId, ahora, ahora],
  );
}

/** §16.2 — entrega parcial es EXCEPCIONAL, a petición del cliente. */
export async function definirModalidadEntrega(negocioId: number, modalidad: ModalidadEntrega, motivo: string | null): Promise<void> {
  if (modalidad === 'PARCIAL' && !motivo?.trim()) throw new Error('La entrega parcial es excepcional — falta el motivo (a petición del cliente, spec §16.2).');
  await asegurarFila(negocioId);
  await pool.query(`UPDATE compras_entrega SET modalidad = ?, modalidad_motivo = ?, updated_at = ? WHERE negocio_id = ?`,
    [modalidad, modalidad === 'PARCIAL' ? motivo!.trim() : null, ahoraChileSQL(), negocioId]);
}

/** §16.2 — puntos de entrega múltiples: casos menores, pero el módulo debe soportarlos. */
export async function agregarPuntoEntrega(negocioId: number, direccion: string, comuna: string | null, contactoNombre: string | null, contactoTelefono: string | null): Promise<number> {
  if (!direccion?.trim()) throw new Error('Falta la dirección del punto de entrega.');
  const [r] = await pool.query(
    `INSERT INTO compras_entrega_punto (negocio_id, direccion, comuna, contacto_nombre, contacto_telefono) VALUES (?,?,?,?,?)`,
    [negocioId, direccion.trim(), comuna?.trim() || null, contactoNombre?.trim() || null, contactoTelefono?.trim() || null],
  ) as any;
  return r.insertId as number;
}

// BUG REAL (10-sep-2026, auditoría estática): antes borraba por `id` solo, sin comprobar que el
// punto perteneciera a `negocioId` — cualquiera con acceso de escritura a SU negocio podía mandar
// el `id` de un punto de entrega de OTRO negocio (adivinado o visto en otra pestaña) y borrarlo,
// sin tener ningún permiso sobre ese segundo negocio (la ruta solo valida acceso al `negocioId` de
// la URL, no que el recurso borrado sea de ese negocio). Mismo patrón correcto que ya usa
// `eliminarGasto` en compras-gastos.ts: el `WHERE` exige los dos.
export async function quitarPuntoEntrega(negocioId: number, id: number): Promise<void> {
  await pool.query(`DELETE FROM compras_entrega_punto WHERE id = ? AND negocio_id = ?`, [id, negocioId]);
}

/** §16.4 — la verificación "hoy la ejecuta el propio encargado de compras". */
export async function registrarVerificacion(negocioId: number, conforme: boolean, actorId: number, actorNombre: string | null): Promise<void> {
  await asegurarFila(negocioId);
  const ahora = ahoraChileSQL();
  await pool.query(
    `UPDATE compras_entrega SET verificacion_conforme = ?, verificacion_por = ?, verificacion_por_nombre = ?, verificacion_at = ?, updated_at = ? WHERE negocio_id = ?`,
    [conforme ? 1 : 0, actorId, actorNombre, ahora, ahora, negocioId],
  );
}

/** §16.4 — el módulo solo REGISTRA los números que emite OBUMA, no los genera. */
export async function registrarNumeros(negocioId: number, notaVentaNumero: string | null, guiaDespachoNumero: string | null): Promise<void> {
  await asegurarFila(negocioId);
  await pool.query(
    `UPDATE compras_entrega SET nota_venta_numero = COALESCE(?, nota_venta_numero), guia_despacho_numero = COALESCE(?, guia_despacho_numero), updated_at = ? WHERE negocio_id = ?`,
    [notaVentaNumero?.trim() || null, guiaDespachoNumero?.trim() || null, ahoraChileSQL(), negocioId],
  );
}

/** §16.5 — "la genera automáticamente el módulo. Único documento oficial que produce." Requiere
 *  cobertura total (§14.2: "cobertura total o nada") — no tiene sentido generar el acta de un
 *  proyecto que todavía no está completo. Guarda un snapshot de qué se entregó. */
export async function generarActa(negocioId: number, actorId: number, actorNombre: string | null): Promise<void> {
  const cobertura = await coberturaProyecto(negocioId);
  if (!cobertura.cobertura) throw new Error(`El proyecto no tiene cobertura total todavía (${cobertura.listos}/${cobertura.total} listos) — spec §14.2, el acta requiere el proyecto completo.`);
  const productos = await listarProductosCompra(negocioId);
  const contenido = productos.filter(p => p.subestado !== 'RENUNCIADO').map(p => ({ descripcion: p.descripcion, cantidad: p.cantidad, unidad: p.unidad }));
  await asegurarFila(negocioId);
  const ahora = ahoraChileSQL();
  // BUG REAL (10-sep-2026, auditoría estática): regenerar el acta limpiaba la aprobación
  // (correcto), pero NO limpiaba la firma ni el cierre de una versión ANTERIOR ya firmada/cerrada
  // — `obtenerEntrega()` seguía devolviendo `actaFirma`/`cerradaAt` no-nulos para un acta cuyo
  // contenido acababa de cambiar y que en los hechos nunca fue firmada. `firmarActa` sí exige
  // `acta_aprobada_at` (que queda NULL), así que no se puede volver a "firmar" sin re-aprobar —
  // pero mientras tanto la pantalla mentía. Toda regeneración es, en los hechos, un acta nueva:
  // invalida cualquier firma/cierre previo, mismo criterio que `invalidarAprobacionesCompras`.
  await pool.query(
    `UPDATE compras_entrega
        SET acta_generada_at = ?, acta_contenido_json = ?,
            acta_aprobada_por = NULL, acta_aprobada_por_nombre = NULL, acta_aprobada_at = NULL,
            acta_conformidad = NULL,
            acta_firma_nombre = NULL, acta_firma_rut = NULL, acta_firma_cargo = NULL,
            acta_firma_recinto = NULL, acta_firma_fecha = NULL,
            cerrada_at = NULL, updated_at = ?
      WHERE negocio_id = ?`,
    [ahora, JSON.stringify(contenido), ahora, negocioId],
  );
  await registrarEvento({
    tipo: 'COMPRAS_ACTA_GENERADA', licitacionCodigo: await licitacionDeNegocio(negocioId), actorId, actorNombre,
    mensaje: `Se generó el acta de entrega (${contenido.length} producto(s)).`, metadata: { negocio_id: negocioId },
  });
}

/** §16.5 — "la aprueba el encargado de compras antes de imprimirse." */
export async function aprobarActa(negocioId: number, actorId: number, actorNombre: string | null): Promise<void> {
  const ahora = ahoraChileSQL();
  const [r] = await pool.query(
    `UPDATE compras_entrega SET acta_aprobada_por = ?, acta_aprobada_por_nombre = ?, acta_aprobada_at = ?, updated_at = ?
       WHERE negocio_id = ? AND acta_generada_at IS NOT NULL`,
    [actorId, actorNombre, ahora, ahora, negocioId],
  ) as any;
  if (!r?.affectedRows) throw new Error('Todavía no se ha generado el acta.');
}

function validarFirma(f: FirmaDatos) {
  if (!f.nombre?.trim() || !f.rut?.trim() || !f.cargo?.trim() || !f.recinto?.trim() || !f.fecha)
    throw new Error('La firma requiere nombre, RUT, cargo, recinto y fecha (spec §16.5/§16.6).');
}

/** §16.5 — bloque de firma del acta: nombre, RUT, cargo, firma, recinto de recepción y fecha, más
 *  el campo de conformidad. Requiere el acta ya aprobada (§16.5: "antes de imprimirse"). Si la guía
 *  ya estaba firmada, cierra el ciclo (§16.7). */
export async function firmarActa(negocioId: number, firma: FirmaDatos, conformidad: 'CONFORME' | 'NO_CONFORME', actorId: number, actorNombre: string | null): Promise<void> {
  validarFirma(firma);
  const entrega = await filaEntrega(negocioId);
  if (!entrega?.acta_aprobada_at) throw new Error('El acta debe estar aprobada por el encargado de compras antes de firmarse.');
  const ahora = ahoraChileSQL();
  const yaCierra = !!entrega.guia_firma_nombre;
  await pool.query(
    `UPDATE compras_entrega SET acta_conformidad = ?, acta_firma_nombre = ?, acta_firma_rut = ?, acta_firma_cargo = ?, acta_firma_recinto = ?, acta_firma_fecha = ?,
        cerrada_at = COALESCE(cerrada_at, ${yaCierra ? '?' : 'NULL'}), updated_at = ?
      WHERE negocio_id = ?`,
    yaCierra
      ? [conformidad, firma.nombre.trim(), firma.rut.trim(), firma.cargo.trim(), firma.recinto.trim(), firma.fecha, ahora, ahora, negocioId]
      : [conformidad, firma.nombre.trim(), firma.rut.trim(), firma.cargo.trim(), firma.recinto.trim(), firma.fecha, ahora, negocioId],
  );
  if (yaCierra) {
    await registrarEvento({
      tipo: 'COMPRAS_ENTREGA_CERRADA', licitacionCodigo: await licitacionDeNegocio(negocioId), actorId, actorNombre,
      mensaje: `Acta y guía firmadas — se cierra el ciclo de entrega (spec §16.7).`, metadata: { negocio_id: negocioId },
    });
  }
}

/** §16.6 — nombre, RUT, cargo, fecha, recinto, recepción y timbre si es posible. */
export async function firmarGuia(negocioId: number, firma: FirmaDatos, timbre: boolean, actorId: number, actorNombre: string | null): Promise<void> {
  validarFirma(firma);
  const entrega = await filaEntrega(negocioId);
  const ahora = ahoraChileSQL();
  const yaCierra = !!entrega?.acta_firma_nombre;
  await asegurarFila(negocioId);
  await pool.query(
    `UPDATE compras_entrega SET guia_firma_nombre = ?, guia_firma_rut = ?, guia_firma_cargo = ?, guia_firma_recinto = ?, guia_firma_fecha = ?, guia_timbre = ?,
        cerrada_at = COALESCE(cerrada_at, ${yaCierra ? '?' : 'NULL'}), updated_at = ?
      WHERE negocio_id = ?`,
    yaCierra
      ? [firma.nombre.trim(), firma.rut.trim(), firma.cargo.trim(), firma.recinto.trim(), firma.fecha, timbre ? 1 : 0, ahora, ahora, negocioId]
      : [firma.nombre.trim(), firma.rut.trim(), firma.cargo.trim(), firma.recinto.trim(), firma.fecha, timbre ? 1 : 0, ahora, negocioId],
  );
  if (yaCierra) {
    await registrarEvento({
      tipo: 'COMPRAS_ENTREGA_CERRADA', licitacionCodigo: await licitacionDeNegocio(negocioId), actorId, actorNombre,
      mensaje: `Acta y guía firmadas — se cierra el ciclo de entrega (spec §16.7).`, metadata: { negocio_id: negocioId },
    });
  }
}

// ── Postventa (§17.1) — los compromisos YA vienen del resumen ejecutivo; acá solo se marca cuáles
// se resolvieron. "Flujo de reposición: producto defectuoso detectado DESPUÉS de recibido conforme
// es postventa, no incidencia" (§9.6/§17.1) — la distinción con Incidencias es el MOMENTO, no el tipo.
export interface PostventaItem { compromisoTexto: string; resuelto: boolean; resueltoPorNombre: string | null; resueltoAt: string | null; notas: string | null }

export async function listarPostventa(negocioId: number): Promise<Map<string, PostventaItem>> {
  const [rows] = await pool.query(
    `SELECT compromiso_texto, resuelto_por_nombre, DATE_FORMAT(resuelto_at, '%Y-%m-%d %H:%i:%s') AS resuelto_at, notas FROM compras_postventa WHERE negocio_id = ?`,
    [negocioId],
  ) as any;
  const m = new Map<string, PostventaItem>();
  for (const r of rows as any[]) m.set(r.compromiso_texto, { compromisoTexto: r.compromiso_texto, resuelto: true, resueltoPorNombre: r.resuelto_por_nombre, resueltoAt: r.resuelto_at, notas: r.notas });
  return m;
}

export async function marcarPostventaResuelta(negocioId: number, compromisoTexto: string, notas: string | null, actorId: number, actorNombre: string | null): Promise<void> {
  const ahora = ahoraChileSQL();
  await pool.query(
    `INSERT INTO compras_postventa (negocio_id, compromiso_texto, resuelto_por, resuelto_por_nombre, resuelto_at, notas)
     VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE resuelto_por=VALUES(resuelto_por), resuelto_por_nombre=VALUES(resuelto_por_nombre), resuelto_at=VALUES(resuelto_at), notas=VALUES(notas)`,
    [negocioId, compromisoTexto.slice(0, 500), actorId, actorNombre, ahora, notas || null],
  );
}

export async function desmarcarPostventa(negocioId: number, compromisoTexto: string): Promise<void> {
  await pool.query(`DELETE FROM compras_postventa WHERE negocio_id = ? AND compromiso_texto = ?`, [negocioId, compromisoTexto.slice(0, 500)]);
}
