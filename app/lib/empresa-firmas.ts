// app/lib/empresa-firmas.ts
// Varias firmas escaneadas por empresa (migration-84). Una empresa firma con más de una persona
// —representante legal titular y suplente, apoderado por rubro— y cuál va en cada anexo lo decide
// el documento, no la ficha. Antes la firma era UNA columna (`empresas.firma_url`) y subir otra
// pisaba la anterior.
//
// REGLA CENTRAL de este archivo: `empresas.firma_url` / `firma_nombre` NO desaparecen — quedan
// como ESPEJO de la firma marcada principal, y `sincronizarFirmaPrincipal` es el único lugar que
// las escribe. Todo lo que ya las leía (el relleno de .docx en anexos-rellenar.ts paso 3, la ficha
// técnica comercial, los prompts del motor de IA) sigue andando sin enterarse de que ahora hay
// varias. Lo nuevo es poder ELEGIR otra al estampar sobre el PDF (ver anexos-pdf-firma.ts).
import pool from '@/app/lib/db';

export interface FirmaEmpresa {
  id: number;
  etiqueta: string;
  url: string;
  nombre: string | null;
  es_principal: boolean;
  orden: number;
}

/**
 * Todas las firmas de una empresa, la principal primero. Devuelve [] —nunca revienta— si la
 * migración 84 todavía no está aplicada: el sistema sigue funcionando con la firma única de
 * `empresas.firma_url`, igual que el GET de empresa_documentos con la migración 51.
 */
export async function listarFirmasEmpresa(empresaId: number | string): Promise<FirmaEmpresa[]> {
  try {
    const [rows] = await pool.query(
      `SELECT id, etiqueta, url, nombre, es_principal, orden
         FROM empresa_firmas WHERE empresa_id = ?
        ORDER BY es_principal DESC, orden, id`,
      [empresaId],
    );
    return (rows as any[]).map(r => ({
      id: Number(r.id),
      etiqueta: String(r.etiqueta || '').trim() || 'Firma',
      url: String(r.url),
      nombre: r.nombre ?? null,
      es_principal: !!r.es_principal,
      orden: Number(r.orden ?? 0),
    }));
  } catch (error) {
    console.error('[empresa-firmas] No se pudieron listar las firmas (¿migration-84 sin aplicar?):', String(error).slice(0, 200));
    return [];
  }
}

/** UNA firma concreta, verificando que pertenece a esa empresa. null si no existe o es de otra —
 *  el `firmaId` viaja desde el cliente (ver /api/anexos/generar-firmado), así que nunca se usa sin
 *  cruzarlo contra la empresa del anexo. */
export async function obtenerFirmaEmpresa(empresaId: number | string, firmaId: number): Promise<FirmaEmpresa | null> {
  const firmas = await listarFirmasEmpresa(empresaId);
  return firmas.find(f => f.id === firmaId) ?? null;
}

/**
 * Deja EXACTAMENTE una firma marcada como principal y copia su URL a `empresas.firma_url`.
 * Se llama después de cada alta/baja/cambio. Si `firmaId` viene, esa pasa a ser la principal; si
 * no, se respeta la que ya lo era, y si ninguna lo es (recién se borró la principal) asciende la
 * primera por orden. Sin ninguna firma, la columna espejo queda en NULL — que es exactamente lo
 * que veía antes el sistema cuando se borraba la firma única.
 */
export async function sincronizarFirmaPrincipal(empresaId: number | string, firmaId?: number): Promise<void> {
  const firmas = await listarFirmasEmpresa(empresaId);

  if (!firmas.length) {
    await pool.query(`UPDATE empresas SET firma_url = NULL, firma_nombre = NULL WHERE id = ?`, [empresaId]);
    return;
  }

  const elegida = (firmaId != null ? firmas.find(f => f.id === firmaId) : null)
    ?? firmas.find(f => f.es_principal)
    ?? firmas[0];

  await pool.query(`UPDATE empresa_firmas SET es_principal = 0 WHERE empresa_id = ?`, [empresaId]);
  await pool.query(`UPDATE empresa_firmas SET es_principal = 1 WHERE id = ? AND empresa_id = ?`, [elegida.id, empresaId]);
  await pool.query(
    `UPDATE empresas SET firma_url = ?, firma_nombre = ? WHERE id = ?`,
    [elegida.url, elegida.nombre, empresaId],
  );
}

/** Alta de una firma ya subida a R2. La primera de la empresa queda principal sola (si no, una
 *  empresa recién cargada tendría firmas pero `empresas.firma_url` vacío y el .docx saldría sin
 *  firma sin que nadie lo note). */
export async function agregarFirmaEmpresa(
  empresaId: number | string,
  datos: { etiqueta: string; url: string; nombre: string | null; subidoPor?: number | null; subidoPorNombre?: string | null; hacerPrincipal?: boolean },
): Promise<number> {
  const [[{ n, maxOrden }]] = await pool.query(
    `SELECT COUNT(*) AS n, COALESCE(MAX(orden), -1) AS maxOrden FROM empresa_firmas WHERE empresa_id = ?`,
    [empresaId],
  ) as any;
  const primera = Number(n) === 0;

  const [result] = await pool.query(
    `INSERT INTO empresa_firmas (empresa_id, etiqueta, url, nombre, es_principal, orden, subido_por, subido_por_nombre, subido_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      empresaId, datos.etiqueta.slice(0, 160), datos.url, datos.nombre,
      primera || datos.hacerPrincipal ? 1 : 0, Number(maxOrden) + 1,
      datos.subidoPor ?? null, datos.subidoPorNombre ?? null,
    ],
  ) as any;

  const id = Number((result as any).insertId);
  await sincronizarFirmaPrincipal(empresaId, primera || datos.hacerPrincipal ? id : undefined);
  return id;
}
