// TEMPORAL (se borra al terminar). Regla del dueño para Comercial MP (24-nov-2026): con factura en Obuma (por el centro de costo de su proyecto) → Cerrada
// (Pagada si está cobrada); SIN factura → Entregada. Aplica solo a las 10 que hoy están Cerradas por la vuelta de la tarde.
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#\r\n]*)/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const { default: pool } = await import('../app/lib/db.ts');
const fv = await import('../app/lib/compras-factura-venta.ts');
const { quitarCierreLegado } = await import('../app/lib/compras.ts');
const core = await import('../app/lib/compras-estado-core.ts');
const { pdfDteObuma, pdfYEstadoDte } = await import('../app/lib/obuma.ts');
const { subirDocumentoR2, borrarDocumentoR2 } = await import('../app/lib/r2.ts');
const { parsearFacturaXml } = await import('../app/lib/factura-xml.ts');
const { registrarEvento } = await import('../app/lib/historial.ts');
const { publicarCambio } = await import('../app/lib/sse-bus.ts');
const base = process.env.OBUMA_API_URL || 'https://api.obuma.cl/v1.0';
const get = async (m, q) => (await fetch(`${base}/${m}?` + new URLSearchParams(q), { headers: { 'access-token': process.env.OBUMA_API_TOKEN, Accept: 'application/json' } })).json();
const [[actor]] = await pool.query(`SELECT id, nombre FROM usuarios WHERE email = 'informatica2.grupoica@gmail.com' LIMIT 1`);
const userId = Number(actor.id), nombre = actor.nombre || null;
const CON_FACTURA = { 86: { folio: '1814', tipo: 33 }, 362: { folio: '1811', tipo: 33 } };   // facturas halladas por el centro de costo del proyecto
const SIN_FACTURA = [356, 361, 367, 368, 415, 627, 717, 1090];
const out = [];
const estadoDe = async id => { const [[r]] = await pool.query(`SELECT ca.licitacion_codigo, ca.cierre_legado, ca.estado_compra, e.rut FROM compras_asignacion ca JOIN negocios n ON n.id = ca.negocio_id LEFT JOIN empresas e ON e.id = n.empresa_id WHERE ca.negocio_id = ?`, [id]); return { cod: r.licitacion_codigo, rut: r.rut, e: core.estadoCompraEfectivo(r.cierre_legado, r.estado_compra) }; };

for (const [idS, f] of Object.entries(CON_FACTURA)) {
  const id = Number(idS); const { cod, rut, e } = await estadoDe(id);
  if (rut !== '78.388.175-6') { out.push(`${cod}: NO es de Comercial MP, no se toca`); continue; }
  const ya = (await fv.listarFacturasVenta(id)).some(x => String(x.numero || '').trim() === f.folio);
  if (!ya) {
    const j = await get('ventas.list.json', { tipo_dcto: f.tipo, folio_dcto: f.folio, limit: 5 });
    const v = (j.data || []).find(x => String(x.venta_nro_dcto) === f.folio && String(x.venta_tipo_dcto) === String(f.tipo));
    if (!v) { out.push(`${cod}: no encontré la F${f.folio} en Obuma`); continue; }
    const pdf = await pdfDteObuma(f.tipo, f.folio);
    const url = await subirDocumentoR2(`compras/${cod}/factura-venta`, `Factura ${f.folio}.pdf`, pdf, 'application/pdf');
    let xmlUrl = null;
    try { const { xml } = await pdfYEstadoDte(f.tipo, f.folio); if (xml) { const r = await fetch(xml, { signal: AbortSignal.timeout(20_000) }); const t = r.ok ? await r.text() : ''; if (parsearFacturaXml(t)) xmlUrl = await subirDocumentoR2(`compras/${cod}/factura-venta`, `Factura ${f.folio}.xml`, Buffer.from(t, 'utf8'), 'application/xml'); } } catch { /* solo PDF */ }
    await fv.registrarFacturaVenta(id, { archivoUrl: url, archivoNombre: `Factura ${f.folio}.pdf`, numero: f.folio, emitidaAt: fv.fechaValida(String(v.venta_fecha_ingreso).slice(0, 10)), pagadaAt: null, origen: 'OBUMA', xmlUrl }, userId, nombre)
      .catch(async err => { await borrarDocumentoR2(url).catch(() => {}); if (xmlUrl) await borrarDocumentoR2(xmlUrl).catch(() => {}); throw err; });
    out.push(`${cod}: factura F${f.folio} cargada (sin pagar); queda ${e}`);
  } else out.push(`${cod}: F${f.folio} ya estaba cargada; queda ${e}`);
}
for (const id of SIN_FACTURA) {
  const { cod, rut, e } = await estadoDe(id);
  if (rut !== '78.388.175-6' || e !== 'CERRADA') { out.push(`${cod}: NO se toca (empresa ${rut}, estado ${e})`); continue; }
  const n = (await fv.listarFacturasVenta(id)).length;
  if (n > 0) { out.push(`${cod}: tiene ${n} factura(s) cargada(s), no se toca`); continue; }
  await quitarCierreLegado(id);
  await registrarEvento({ tipo: 'COMPRAS_ESTADO', licitacionCodigo: cod, actorId: userId, actorNombre: nombre, mensaje: `${cod} pasó de «Cerrada» a «Entregada»: no tiene factura en Obuma (regla del dueño para Comercial MP, 24-nov-2026).`, metadata: { negocio_id: id, de: 'CERRADA', a: 'ENTREGADA' } });
  publicarCambio('compras');
  out.push(`${cod}: Cerrada → Entregada`);
}
console.log(out.join('\n'));
process.exit(0);
