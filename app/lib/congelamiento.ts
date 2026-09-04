// app/lib/congelamiento.ts
// CONGELAMIENTO Y TRASPASO A COMPRAS (Auditor Técnico, Fase 7, spec §12). Al postular, el
// Auditor se congela: queda como registro histórico inmutable (nunca se reescribe — INSERT
// IGNORE, la primera vez gana) y arma el paquete que alimentaría un futuro módulo de Compras
// (spec §12.2/12.3): producto validado, costeo, plazos comprometidos, matriz técnica aprobada,
// compromisos de postventa y contactos del cliente.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';

export interface PaqueteTraspaso {
  productoValidado: Array<{ linea: number | null; titulo: string; caracteristicas: Array<{ descripcion: string; veredicto: string | null; fundamentoCita: string | null }> }>;
  costeo: { totalCostoNeto: number | null; totalPrecioNeto: number | null; archivoNombre: string | null; version: number | null } | null;
  plazosComprometidos: Array<{ titulo: string; valor: string | null }>;
  matrizTecnicaAprobada: { total: number; cumplen: number; noCumplen: number; conComplemento: number };
  compromisosPostventa: Array<{ titulo: string; descripcion: string | null }>;
  contactosCliente: {
    organismo: string | null; unidad: string | null; direccion: string | null;
    comuna: string | null; region: string | null; usuarioNombre: string | null; usuarioCargo: string | null;
    // §4.2 campo 11 pide "nombre, teléfono, correo, TODO dato disponible", y §17.3 pide capturar el
    // contacto de PAGOS (que "nunca es la misma persona que la contraparte técnica"). La ficha de MP
    // trae los dos y no se estaban leyendo. Opcionales: los paquetes congelados antes de sep-2026 no
    // los tienen, y muchos organismos publican estos campos vacíos.
    responsableContratoNombre?: string | null;
    responsableContratoEmail?: string | null;
    responsableContratoFono?: string | null;
    responsablePagoNombre?: string | null;
    responsablePagoEmail?: string | null;
  } | null;
}

// Estados en los que la oferta YA SALIÓ: mientras el negocio esté en alguno de ellos, el Auditor
// es registro histórico y no se toca. Si el negocio RETROCEDE (la licitación se reabrió, se retiró
// la oferta, se corrigió el estado por error), el congelamiento deja de aplicar y el equipo puede
// volver a trabajar — la fila del congelamiento NO se borra: el paquete de traspaso sigue ahí, y
// si se vuelve a postular el bloqueo vuelve solo. Reportado 25-ago-2026: 986278-14-LE26 se postuló,
// se reabrió, y el Auditor quedó de solo lectura para siempre.
export const ESTADOS_OFERTA_ENVIADA = [
  'POSTULADA', 'ADJUDICADA', 'POSIBLE_ADJ', 'PERDIDA',
  '7POSTULADO_JV', '7POSTULADO_CG', 'ADJ_JV', 'ADJ_CG', '8POSIBLE_ADJ', '9PERDIDA',
];

/**
 * ¿Este negocio ya congeló su Auditor Técnico? Es el guard que bloquea edición tras postular
 * (spec §12.1, solo lectura). FAIL-CLOSED por diseño: si la consulta falla, LANZA en vez de
 * devolver `false` — un error de infraestructura no debe traducirse en "no está congelado" y
 * dejar editable un negocio que debería estar bloqueado (auditoría ago-2026). Las rutas que usan
 * esto como guard de escritura ya están dentro de un try/catch que responde 500 y no escribe
 * nada; los llamadores internos que sí deben tolerar el fallo (congelarAuditorSiCorresponde,
 * congelarPendientes) lo atrapan explícitamente ellos mismos.
 *
 * BYPASS DE PRUEBAS (27-ago-2026, pedido explícito): el admin necesita hacer pruebas del Auditor
 * sobre negocios YA POSTULADOS —justamente para no tocar los que los asistentes están cargando en
 * vivo—. Si `rol === 'admin'` nunca se considera congelado: el resto del equipo (asistente/asesor)
 * sigue viendo el bloqueo tal cual. El paquete ya congelado en `checklist_comercial_congelamiento`
 * (lo que alimenta Compras) NO se toca acá — solo se reescribe una vez, al postular— así que estas
 * pruebas no corrompen el registro histórico, solo permiten seguir editando el checklist en vivo.
 */
export async function yaCongelado(negocioId: number, rol?: string | null): Promise<boolean> {
  if (rol === 'admin') return false;
  const [rows] = await pool.query(
    `SELECT 1
       FROM checklist_comercial_congelamiento c
       JOIN negocios n ON n.id = c.negocio_id
      WHERE c.negocio_id = ? AND n.estado_pipeline IN (?)
      LIMIT 1`,
    [negocioId, ESTADOS_OFERTA_ENVIADA],
  ) as any;
  return (rows as any[]).length > 0;
}

export async function leerCongelamiento(negocioId: number, rol?: string | null): Promise<{ congeladoAt: string; congeladoPorNombre: string | null; paquete: PaqueteTraspaso } | null> {
  // Mismo bypass de pruebas que yaCongelado(): si el admin no ve el banner de "solo lectura",
  // la UI tampoco le deshabilita los botones (InformacionComercialSection usa `congelado` para eso).
  if (rol === 'admin') return null;
  try {
    const [rows] = await pool.query(
      // Mismo criterio que yaCongelado(): si el negocio ya no está postulado, el banner de
      // "solo lectura" no debe aparecer aunque el paquete histórico siga guardado.
      `SELECT c.congelado_at, c.congelado_por_nombre, c.paquete_traspaso
         FROM checklist_comercial_congelamiento c
         JOIN negocios n ON n.id = c.negocio_id
        WHERE c.negocio_id = ? AND n.estado_pipeline IN (?)
        LIMIT 1`,
      [negocioId, ESTADOS_OFERTA_ENVIADA],
    ) as any;
    const row = (rows as any[])[0];
    if (!row) return null;
    return { congeladoAt: row.congelado_at, congeladoPorNombre: row.congelado_por_nombre, paquete: JSON.parse(row.paquete_traspaso) };
  } catch { return null; }
}

// Capa técnico-administrativa (spec §5.12): el modelo actual no distingue estos ítems de otros
// TECNICO/ADMINISTRATIVO con una columna propia — se aproximan por título mientras esa
// distinción no exista como campo de primera clase.
const RE_POSTVENTA = /capacitaci|postventa|garant[ií]a|mantenimiento|despacho/i;

async function construirPaquete(negocioId: number, licitacionCodigo: string): Promise<PaqueteTraspaso> {
  const [items] = await pool.query(
    `SELECT id, bloque, tipo, titulo, valor_texto, valor_numero, linea_numero FROM checklist_comercial WHERE negocio_id = ?`,
    [negocioId],
  ) as any;
  const filas = items as any[];

  const [caract] = await pool.query(
    `SELECT item_id, descripcion, veredicto, fundamento_cita FROM checklist_comercial_caracteristicas WHERE negocio_id = ?`,
    [negocioId],
  ) as any;
  const caractPorItem = new Map<number, Array<{ descripcion: string; veredicto: string | null; fundamentoCita: string | null }>>();
  for (const c of caract as any[]) {
    const arr = caractPorItem.get(c.item_id) || [];
    arr.push({ descripcion: c.descripcion, veredicto: c.veredicto, fundamentoCita: c.fundamento_cita });
    caractPorItem.set(c.item_id, arr);
  }

  const lineasTecnicas = filas.filter(f => f.tipo === 'linea_tecnica');
  const productoValidado = lineasTecnicas.map(l => ({
    linea: l.linea_numero, titulo: l.titulo, caracteristicas: caractPorItem.get(l.id) || [],
  }));
  const todasCaract = lineasTecnicas.flatMap(l => caractPorItem.get(l.id) || []);
  const matrizTecnicaAprobada = {
    total: todasCaract.length,
    cumplen: todasCaract.filter(c => c.veredicto === 'CUMPLE').length,
    noCumplen: todasCaract.filter(c => c.veredicto === 'NO_CUMPLE').length,
    conComplemento: todasCaract.filter(c => c.veredicto === 'CUMPLE_CON_COMPLEMENTO').length,
  };

  const plazosComprometidos = filas
    .filter(f => f.bloque === 'COMERCIAL' && f.tipo === 'dato')
    .map(f => ({ titulo: f.titulo as string, valor: f.valor_texto as string | null }));

  const compromisosPostventa = filas
    .filter(f => (f.bloque === 'TECNICO' || f.bloque === 'ADMINISTRATIVO') && f.tipo !== 'linea_tecnica' && RE_POSTVENTA.test(f.titulo))
    .map(f => ({ titulo: f.titulo as string, descripcion: f.valor_texto as string | null }));

  let costeo: PaqueteTraspaso['costeo'] = null;
  try {
    const [rows] = await pool.query(
      `SELECT version, archivo_nombre, total_costo_neto, total_precio_neto
         FROM checklist_comercial_costeo WHERE negocio_id = ? AND vigente = 1 LIMIT 1`,
      [negocioId],
    ) as any;
    const r = (rows as any[])[0];
    if (r) costeo = { totalCostoNeto: r.total_costo_neto, totalPrecioNeto: r.total_precio_neto, archivoNombre: r.archivo_nombre, version: r.version };
  } catch { /* migración 53 pendiente */ }

  const contactosCliente = await obtenerContactosCliente(licitacionCodigo);

  return { productoValidado, costeo, plazosComprometidos, matrizTecnicaAprobada, compromisosPostventa, contactosCliente };
}

/**
 * Contactos del comprador desde la API de MP, con REINTENTOS.
 * Antes era una sola llamada: si MP estaba caído en ese instante, el paquete quedaba sin
 * organismo/unidad/dirección/contacto… y como el congelamiento es inmutable, ese hueco era
 * PERMANENTE (Compras recibía el traspaso mutilado y no había forma de recuperarlo).
 * Ahora se reintenta con backoff y, si aun así no se logra, `repararContactosFaltantes()`
 * lo completa después (ver abajo).
 */
export async function obtenerContactosCliente(
  licitacionCodigo: string,
): Promise<PaqueteTraspaso['contactosCliente']> {
  const client = getMercadoPublicoClient();
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const lic = await client.obtenerPorCodigoRapido(licitacionCodigo, 8_000) as any;
      if (!lic) return null;
      // BUG REAL (04-sep-2026, 1114-12-LE26): esto leía `lic.Comprador`, que NO EXISTE.
      // `obtenerPorCodigoRapido` devuelve la ficha YA APLANADA — Organismo, NombreUnidad,
      // DireccionUnidad, ComunaUnidad, Region, NombreUsuario, CargoUsuario van en la raíz. El
      // `Comprador` daba undefined y la función devolvía null por el camino de "MP respondió pero
      // no trae comprador", que ni siquiera reintenta. Resultado: NINGÚN paquete de traspaso tenía
      // contactos del cliente, y Compras recibía el proyecto sin a quién llamar — justo lo que
      // exige la primera tarea del encargado (§5.3, contacto inicial). Se deja el `Comprador` como
      // respaldo por si alguna otra ruta entrega el JSON crudo de MP sin aplanar.
      const c = lic.Comprador || lic;
      const dato = (v: unknown) => {
        const t = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
        return t || null;   // MP publica estos campos como "" cuando el organismo no los llenó
      };
      const contactos = {
        organismo: dato(c.NombreOrganismo ?? c.Organismo),
        unidad: dato(c.NombreUnidad),
        direccion: dato(c.DireccionUnidad),
        comuna: dato(c.ComunaUnidad),
        region: dato(c.RegionUnidad ?? c.Region),
        usuarioNombre: dato(c.NombreUsuario),
        usuarioCargo: dato(c.CargoUsuario),
        responsableContratoNombre: dato(c.NombreResponsableContrato),
        responsableContratoEmail: dato(c.EmailResponsableContrato),
        responsableContratoFono: dato(c.FonoResponsableContrato),
        responsablePagoNombre: dato(c.NombreResponsablePago),
        responsablePagoEmail: dato(c.EmailResponsablePago),
      };
      // Si la ficha vino sin UN SOLO dato útil, es lo mismo que no tenerla: se devuelve null para
      // que quede como faltante honesto en vez de un bloque de nulls que parece un contacto.
      return Object.values(contactos).some(Boolean) ? contactos : null;
    } catch {
      if (intento < 3) await new Promise(r => setTimeout(r, intento * 1_500));
    }
  }
  console.warn(`[congelamiento] contactos de cliente no disponibles para ${licitacionCodigo} (MP no respondió); se repararán después`);
  return null;
}

/**
 * REPARACIÓN de paquetes congelados sin contactos de cliente.
 *
 * El congelamiento es inmutable POR DISEÑO (spec §12.1) y eso no cambia: esta función NO
 * reescribe nada de lo que el equipo decidió —producto, costeo, plazos, matriz técnica—.
 * Solo RELLENA un dato externo que no se pudo leer en su momento y que no depende de nadie
 * del equipo: la ficha del comprador publicada por MP. Un hueco por caída de MP no es una
 * decisión histórica que preservar, es un dato faltante.
 *
 * Idempotente y acotada: solo toca filas cuyo `contactosCliente` sigue en null.
 * Best-effort: nunca lanza (se engancha a un cron).
 */
export async function repararContactosFaltantes(limite = 20): Promise<{ revisados: number; reparados: number }> {
  const res = { revisados: 0, reparados: 0 };
  let filas: Array<{ negocio_id: number; licitacion_codigo: string; paquete_traspaso: string }> = [];
  try {
    const [rows] = await pool.query(
      `SELECT c.negocio_id, n.licitacion_codigo, c.paquete_traspaso
         FROM checklist_comercial_congelamiento c
         JOIN negocios n ON n.id = c.negocio_id
        WHERE JSON_EXTRACT(c.paquete_traspaso, '$.contactosCliente') IS NULL
           OR JSON_TYPE(JSON_EXTRACT(c.paquete_traspaso, '$.contactosCliente')) = 'NULL'
        ORDER BY c.congelado_at DESC
        LIMIT ?`,
      // Un solo placeholder, un solo parámetro. BUG REAL (04-sep-2026): acá se pasaba además
      // ESTADOS_OFERTA_ENVIADA, que no tiene `?` propio — el array caía en el LIMIT y MySQL
      // rechazaba la consulta con error de sintaxis. El catch de abajo se lo tragaba, así que la
      // reparación devolvía "0 revisados" para siempre y NADIE se enteraba: el negocio 717
      // (1114-12-LE26) llevaba 4 semanas congelado sin contactos del cliente esperando un cron
      // que no podía funcionar.
      [limite],
    ) as any;
    filas = rows as any[];
  } catch (e) {
    // Migración 55 pendiente, o MySQL sin funciones JSON → no hay nada que reparar acá.
    console.error('[congelamiento] reparar contactos: carga falló:', String(e).slice(0, 200));
    return res;
  }

  for (const f of filas) {
    res.revisados++;
    const contactos = await obtenerContactosCliente(f.licitacion_codigo);
    if (!contactos) continue; // MP sigue sin dar el dato → se reintenta en la próxima corrida
    try {
      const paquete = typeof f.paquete_traspaso === 'string' ? JSON.parse(f.paquete_traspaso) : f.paquete_traspaso;
      paquete.contactosCliente = contactos;
      // Guarda SOLO si sigue faltando (evita pisar una reparación concurrente).
      const [r] = await pool.query(
        `UPDATE checklist_comercial_congelamiento
            SET paquete_traspaso = ?
          WHERE negocio_id = ?
            AND (JSON_EXTRACT(paquete_traspaso, '$.contactosCliente') IS NULL
                 OR JSON_TYPE(JSON_EXTRACT(paquete_traspaso, '$.contactosCliente')) = 'NULL')`,
        [JSON.stringify(paquete), f.negocio_id],
      ) as any;
      if (r?.affectedRows > 0) {
        res.reparados++;
        console.log(`[congelamiento] contactos reparados para negocio ${f.negocio_id} (${f.licitacion_codigo})`);
      }
    } catch (e) {
      console.error(`[congelamiento] reparar contactos negocio ${f.negocio_id} falló:`, String(e).slice(0, 200));
    }
  }
  return res;
}

/**
 * RECONCILIACIÓN: negocios que llegaron a POSTULADA (o más allá) pero se quedaron sin fila en
 * `checklist_comercial_congelamiento`. El disparo en app/api/negocios/[id]/route.ts es
 * fire-and-forget (`.catch(() => {})`) para no bloquear el PATCH — si `construirPaquete()` falla
 * (MP caído, checklist incompleto, lo que sea) el error se traga y nadie se entera. Sin esto, esa
 * postulada nunca aparece en Compras y no hay forma de saberlo salvo comparando a mano.
 *
 * Best-effort y acotada, mismo patrón que `repararContactosFaltantes`: nunca lanza, nunca reescribe
 * un congelamiento existente (ver `congelarAuditorSiCorresponde`, que ya es idempotente).
 *
 * EXIGE que el negocio TENGA checklist del Auditor. Sin ese filtro esto congelaría también las
 * postuladas anteriores a la Fase 7, que nunca pasaron por el Auditor: medido el 2026-07-31 sobre
 * la base real, 217 de 232 candidatos están en ese caso. Congelarlas produciría 217 paquetes
 * vacíos —ruido que además esconde los 15 casos que sí importan—. Un negocio sin checklist no
 * tiene un congelamiento "faltante": no hay nada que congelar.
 */
export async function congelarPendientes(limite = 20): Promise<{ revisados: number; congelados: number }> {
  const res = { revisados: 0, congelados: 0 };
  let filas: Array<{ id: number; licitacion_codigo: string }> = [];
  try {
    const [rows] = await pool.query(
      `SELECT n.id, n.licitacion_codigo
         FROM negocios n
         LEFT JOIN checklist_comercial_congelamiento c ON c.negocio_id = n.id
        WHERE c.negocio_id IS NULL
          AND n.estado_pipeline IN (?)
          AND EXISTS (SELECT 1 FROM checklist_comercial cc WHERE cc.negocio_id = n.id)
        ORDER BY n.id DESC
        LIMIT ?`,
      [limite],
    ) as any;
    filas = rows as any[];
  } catch (e) {
    console.error('[congelamiento] reconciliación: carga falló:', String(e).slice(0, 200));
    return res;
  }

  for (const f of filas) {
    res.revisados++;
    try {
      const antes = await yaCongelado(f.id);
      if (antes) continue; // se congeló entre la consulta y ahora (carrera con el flujo normal)
      await congelarAuditorSiCorresponde(f.id, f.licitacion_codigo, null, 'Reconciliación automática');
      if (await yaCongelado(f.id)) {
        res.congelados++;
        console.log(`[congelamiento] reconciliado negocio ${f.id} (${f.licitacion_codigo})`);
      }
    } catch (e) {
      // Best-effort: si no se puede verificar este candidato, se salta y se reintenta en la
      // próxima corrida — nunca se asume "no congelado" para forzar un congelamiento a ciegas.
      console.error(`[congelamiento] reconciliación de negocio ${f.id} falló:`, String(e).slice(0, 200));
    }
  }
  return res;
}

/**
 * Congela el Auditor al postular. Idempotente (INSERT IGNORE sobre PK negocio_id): si ya está
 * congelado, no hace nada — nunca se reescribe, es el registro histórico (spec §12.1).
 * Nunca lanza: un fallo acá no debe bloquear la postulación en sí.
 */
export async function congelarAuditorSiCorresponde(
  negocioId: number, licitacionCodigo: string, userId: number | null, userNombre: string,
): Promise<void> {
  try {
    if (await yaCongelado(negocioId)) return;
  } catch (e) {
    // No se pudo verificar si ya estaba congelado: no intentar construir/insertar a ciegas
    // (podría duplicar trabajo o pisar una carrera). Se reintentará en la próxima postulación
    // o en la reconciliación de congelarPendientes().
    console.error('[congelamiento] no se pudo verificar estado previo (no bloquea la postulación):', String(e).slice(0, 200));
    return;
  }
  try {
    const paquete = await construirPaquete(negocioId, licitacionCodigo);
    await pool.query(
      `INSERT IGNORE INTO checklist_comercial_congelamiento
         (negocio_id, congelado_at, congelado_por, congelado_por_nombre, paquete_traspaso)
       VALUES (?, ?, ?, ?, ?)`,
      [negocioId, ahoraChileSQL(), userId, userNombre, JSON.stringify(paquete)],
    );
  } catch (e) {
    console.error('[congelamiento] falló (no bloquea la postulación):', String(e));
  }
}
