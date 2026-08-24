// app/lib/avisar-resultado-licitacion.ts
// Notificación de los 3 hitos "urgentes" de una licitación: ganada, perdida, apertura.
// Antes SOLO llegaban a la campana del perfil asignado (vía registrarEvento en
// procesar-postuladas.ts / detectar-aperturas.ts) — ni correo, y los admins no se enteraban
// salvo que fueran ellos el asignado. Esto AGREGA (no reemplaza) esas llamadas:
//   · Correo al asignado (nuevo) + a cada admin (nuevo).
//   · Campana a cada admin que NO sea el asignado (nuevo; el asignado ya la recibe del llamador).
// (WhatsApp se evaluó y se descartó por ahora — ago-2026 — hasta decidir el mecanismo.)
// Best-effort: cualquier fallo se loguea y no interrumpe el cron que llama esto.
import pool from '@/app/lib/db';
import { registrarEvento } from '@/app/lib/historial';
import { enviarAvisoResultadoLicitacion, type TipoResultadoLicitacion } from '@/app/lib/email';

interface AsignadoInfo { id: number; nombre: string | null; email: string | null }

interface AvisoResultado {
  tipo: TipoResultadoLicitacion;
  codigo: string;
  nombre: string | null;
  organismo?: string | null;
  monto?: number | null;
  asignado: AsignadoInfo | null;
}

const fmtCLP = (n: number) =>
  new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

function mensajeCampana(a: AvisoResultado): string {
  const nom = a.nombre || a.codigo;
  if (a.tipo === 'ganada') return `🏆 ¡Adjudicada! Ganaron ${nom}${a.monto ? ` · ${fmtCLP(a.monto)}` : ''}`;
  if (a.tipo === 'perdida') return `Resultado publicado: ${nom} se adjudicó a terceros`;
  return `📂 Apertura realizada: ${nom} — ya se pueden revisar las ofertas`;
}

export async function avisarResultadoLicitacion(a: AvisoResultado): Promise<void> {
  try {
    const [rows] = await pool.query(
      `SELECT id, nombre, email FROM usuarios WHERE rol = 'admin' AND activo = TRUE`,
    ) as any[];
    const admins = rows as Array<{ id: number; nombre: string | null; email: string | null }>;
    if (admins.length === 0 && !a.asignado) return;

    const asignadoEsAdmin = !!a.asignado && admins.some(ad => Number(ad.id) === Number(a.asignado!.id));

    // Campana: cada admin que no sea ya el asignado (ese ya la recibió del llamador).
    for (const ad of admins) {
      if (a.asignado && Number(ad.id) === Number(a.asignado.id)) continue;
      await registrarEvento({
        tipo: a.tipo === 'apertura' ? 'APERTURA' : 'RESULTADO_ADJUDICACION',
        licitacionCodigo: a.codigo, licitacionNombre: a.nombre,
        usuarioId: ad.id, usuarioNombre: ad.nombre,
        actorId: null, actorNombre: 'Mercado Público',
        mensaje: mensajeCampana(a),
        metadata: { licitacion_codigo: a.codigo, resultado: a.tipo },
      });
    }

    // Correo: asignado (si tiene mail y no es ya un admin) + todos los admins.
    if (process.env.ALERTAS_EMAIL !== 'false') {
      const destinatarios = new Map<string, { nombre: string | null; email: string }>();
      if (a.asignado?.email && !asignadoEsAdmin) destinatarios.set(a.asignado.email, { nombre: a.asignado.nombre, email: a.asignado.email });
      for (const ad of admins) if (ad.email) destinatarios.set(ad.email, { nombre: ad.nombre, email: ad.email });
      for (const [, d] of destinatarios) {
        await enviarAvisoResultadoLicitacion({
          to: d.email, nombre: d.nombre, tipo: a.tipo,
          codigo: a.codigo, licitacionNombre: a.nombre, organismo: a.organismo ?? null, monto: a.monto ?? null,
        }).catch(e => console.error('[avisar-resultado] correo falló:', String(e).slice(0, 200)));
      }
    }
  } catch (e) {
    console.error('[avisar-resultado] falló (no crítico):', String(e).slice(0, 200));
  }
}
