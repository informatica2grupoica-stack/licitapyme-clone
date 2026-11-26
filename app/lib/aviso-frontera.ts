// app/lib/aviso-frontera.ts
// FRONTERA ENTRE EMPRESAS PARA LOS AVISOS (campana, tiempo real y push). Regla del dueño (2026-11-26): «las fugas no pueden suceder».
// Es la ÚLTIMA barrera: aunque una consulta futura arme mal la lista de destinatarios (p. ej. «todos los admin» sin mirar la empresa),
// registrarEvento (historial.ts) consulta esta regla y no entrega el aviso. Falla CERRADO: ante la duda, no se avisa.
//
// Reglas (puras, con test en __tests__/aviso-frontera.test.mts):
//  1. Los avisos de Compras (COMPRAS_*) y de Entregas (ENTREGA_*) son de Grupo ICA: nunca van a otra empresa.
//  2. Un aviso ligado a una licitación solo lo recibe quien pertenezca a una empresa que TENGA un negocio con ese código.
//     Medido el 2026-11-26 contra 90 días de historial: frena solo los avisos cruzados (0 de ICA, todos hacia otras empresas).
//  Si algún día hay un aviso legítimo sobre una licitación que la empresa aún no tiene como negocio (p. ej. radar), se agrega su tipo
//  a TIPOS_SIN_NEGOCIO a propósito y con el motivo escrito; por defecto la lista está vacía.
import pool from '@/app/lib/db';
import { CLIENTE_ICA } from '@/app/lib/tenant';

export const TIPOS_SIN_NEGOCIO: readonly string[] = [];

export interface ContextoAviso {
  tipo: string;
  /** Empresa de quien recibiría el aviso. */
  clienteDestino: number;
  /** ¿La empresa destino tiene un negocio con el código de la licitación del aviso? (undefined = el aviso no trae código). */
  destinoTieneNegocio?: boolean;
}

export type DecisionAviso = { entregar: true } | { entregar: false; motivo: string };

export function decidirAviso(c: ContextoAviso): DecisionAviso {
  if (/^(COMPRAS_|ENTREGA_)/.test(c.tipo) && c.clienteDestino !== CLIENTE_ICA) {
    return { entregar: false, motivo: 'aviso de Compras/Entregas hacia una empresa que no es Grupo ICA' };
  }
  if (c.destinoTieneNegocio === false && !TIPOS_SIN_NEGOCIO.includes(c.tipo)) {
    return { entregar: false, motivo: 'la empresa destino no tiene un negocio con ese código de licitación' };
  }
  return { entregar: true };
}

/** Lee de la BD el contexto del destinatario (una sola consulta) y decide. Si no se puede leer, NO se entrega (falla cerrado). */
export async function avisoPuedeEntregarse(tipo: string, usuarioId: number, licitacionCodigo?: string | null): Promise<DecisionAviso> {
  try {
    const [rows] = await pool.query(
      `SELECT COALESCE(u.cliente_id, 1) AS cli,
              ${licitacionCodigo ? `EXISTS (SELECT 1 FROM negocios n WHERE n.licitacion_codigo = ? AND COALESCE(n.cliente_id, 1) = COALESCE(u.cliente_id, 1))` : 'NULL'} AS tiene
         FROM usuarios u WHERE u.id = ? LIMIT 1`,
      licitacionCodigo ? [licitacionCodigo, usuarioId] : [usuarioId],
    ) as any;
    const f = (rows as any[])[0];
    if (!f) return { entregar: false, motivo: 'destinatario inexistente' };
    return decidirAviso({ tipo, clienteDestino: Number(f.cli), destinoTieneNegocio: licitacionCodigo ? Number(f.tiene) === 1 : undefined });
  } catch (e) {
    return { entregar: false, motivo: `no se pudo verificar la frontera (${String(e).slice(0, 80)})` };
  }
}
