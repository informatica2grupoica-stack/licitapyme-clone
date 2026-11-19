// Equivalencias de la EMPRESA para el pareo de cotizaciones (modelo → familia): «HST 300» = «electrofusión 20-160 mm (equivale a Elektra Light 160)».
// Son del CLIENTE (nunca se ven entre empresas distintas) y se crean solas. Alimentan al pareo global: se las pasa a la IA como «lo que fijó la empresa»
// y el código las usa para bloquear choques de familia y para no tratar como «código mal puesto» dos textos que la empresa declaró equivalentes.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import type { EquivalenciaFamilia } from '@/app/lib/compras-pareo-global-core';

export interface EquivalenciaEmpresa extends EquivalenciaFamilia { id: number }

let lista = false;
async function asegurarTabla() {
  if (lista) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS compras_equivalencia (
    id INT AUTO_INCREMENT PRIMARY KEY, cliente_id INT NOT NULL, patron VARCHAR(120) NOT NULL, familia VARCHAR(300) NOT NULL,
    creado_por_nombre VARCHAR(160) NULL, created_at DATETIME NOT NULL, UNIQUE KEY uq_cliente_patron (cliente_id, patron)
  ) DEFAULT CHARSET=utf8mb4`);
  lista = true;
}

export async function listarEquivalencias(clienteId: number): Promise<EquivalenciaEmpresa[]> {
  await asegurarTabla();
  const [rows] = await pool.query('SELECT id, patron, familia FROM compras_equivalencia WHERE cliente_id = ? ORDER BY patron', [clienteId]) as any;
  return (rows as any[]).map(r => ({ id: Number(r.id), patron: String(r.patron), familia: String(r.familia) }));
}

/** Crea o actualiza (por patrón). */
export async function guardarEquivalencia(clienteId: number, patron: string, familia: string, userNombre: string | null): Promise<void> {
  await asegurarTabla();
  const p = patron.trim().slice(0, 120), f = familia.trim().slice(0, 300);
  if (!p || !f) throw new Error('Escribe el modelo (o palabra) y a qué familia equivale.');
  await pool.query(
    `INSERT INTO compras_equivalencia (cliente_id, patron, familia, creado_por_nombre, created_at) VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE familia = VALUES(familia), creado_por_nombre = VALUES(creado_por_nombre)`,
    [clienteId, p, f, userNombre, ahoraChileSQL()]);
}

export async function eliminarEquivalencia(clienteId: number, id: number): Promise<void> {
  await asegurarTabla();
  const [res] = await pool.query('DELETE FROM compras_equivalencia WHERE id = ? AND cliente_id = ?', [id, clienteId]) as any;
  if (!res.affectedRows) throw new Error('Esa equivalencia no es de tu empresa.');
}
