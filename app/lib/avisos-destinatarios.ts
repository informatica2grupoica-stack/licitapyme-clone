// app/lib/avisos-destinatarios.ts
// Parte con BD de «a quién le llega cada alerta» (la regla pura está en avisos-reglas.ts).
//   personasDeEmpresa()   → el equipo activo de UNA empresa-cliente (con su Área), para aplicar la regla.
//   destinatariosDe()     → personas de la empresa que reciben esa alerta (correo y campana).
//   reservarCorreo()      → freno anti-duplicado: un correo por alerta, licitación y persona (tabla avisos_correo_enviados, migration-182).
import pool from '@/app/lib/db';
import { elegirPersonas, type Alerta, type Persona } from '@/app/lib/avisos-reglas';

export type PersonaConCorreo = Persona & { email: string | null };

const cachePersonas = new Map<number, { t: number; v: PersonaConCorreo[] }>();
const TTL_MS = 30_000;

/** Equipo activo de la empresa. Cache de 30 s: un barrido de cron avisa muchas licitaciones seguidas. */
export async function personasDeEmpresa(clienteId: number): Promise<PersonaConCorreo[]> {
  const c = cachePersonas.get(clienteId);
  if (c && Date.now() - c.t < TTL_MS) return c.v;
  const [rows] = await pool.query(
    `SELECT id, nombre, email, rol, area, activo, telefono FROM usuarios WHERE cliente_id = ? AND activo = TRUE`,
    [clienteId],
  ) as any[];
  const v = (rows as any[]).map(r => ({ ...r, id: Number(r.id) })) as PersonaConCorreo[];
  cachePersonas.set(clienteId, { t: Date.now(), v });
  return v;
}

/** Destinatarios de una alerta dentro de UNA empresa. `encargados` = ids de quienes llevan esa licitación. */
export async function destinatariosDe(
  alerta: Alerta, clienteId: number, encargados: Iterable<number | null | undefined>,
): Promise<PersonaConCorreo[]> {
  return elegirPersonas(alerta, await personasDeEmpresa(clienteId), encargados);
}

let avisoTablaFaltante = false;

/**
 * Reserva el envío de UN correo. Devuelve true si es la primera vez (hay que enviarlo) y false si ya salió.
 * Si la tabla todavía no existe (migration-182 pendiente) devuelve true: mejor un correo repetido que un aviso perdido.
 */
export async function reservarCorreo(clave: string): Promise<boolean> {
  try {
    const [r] = await pool.query(`INSERT IGNORE INTO avisos_correo_enviados (clave) VALUES (?)`, [clave.slice(0, 190)]) as any[];
    return Number((r as any).affectedRows) > 0;
  } catch (e: any) {
    if (!avisoTablaFaltante) {
      avisoTablaFaltante = true;
      console.warn('[avisos] sin freno anti-duplicado (¿falta migration-182?):', String(e?.code || e).slice(0, 120));
    }
    return true;
  }
}
