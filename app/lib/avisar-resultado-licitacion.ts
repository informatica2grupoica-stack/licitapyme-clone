// app/lib/avisar-resultado-licitacion.ts
// Notificación de los 3 hitos "urgentes" de una licitación: ganada, perdida, apertura.
// Antes SOLO llegaban a la campana del perfil asignado (vía registrarEvento en
// procesar-postuladas.ts / detectar-aperturas.ts) — ni correo, y los admins no se enteraban
// salvo que fueran ellos el asignado. Esto AGREGA (no reemplaza) esas llamadas:
//   · Quién recibe (09-nov-2026, decisión del dueño; ver avisos-reglas.ts): ganada y perdida → encargado de la licitación,
//     admins y Compras; apertura → encargado, Compras y Mercado Público (Compras y MP por el «Área» del perfil).
//   · Correo y campana para esos destinatarios (la campana del asignado ya la registra el llamador); el correo lleva
//     freno anti-duplicado (avisos_correo_enviados, migration-182).
//   · WhatsApp: los mismos destinatarios, solo si tienen el aviso activado en su perfil (whatsapp-avisos.ts).
// Best-effort: cualquier fallo se loguea y no interrumpe el cron que llama esto.
import pool from '@/app/lib/db';
import { registrarEvento } from '@/app/lib/historial';
import { enviarAvisoResultadoLicitacion, type TipoResultadoLicitacion } from '@/app/lib/email';
import { encolarAvisoWhatsapp } from '@/app/lib/whatsapp-avisos';
import { destinatariosDe, reservarCorreo } from '@/app/lib/avisos-destinatarios';

interface AsignadoInfo { id: number; nombre: string | null; email: string | null }

interface AvisoResultado {
  tipo: TipoResultadoLicitacion;
  codigo: string;
  nombre: string | null;
  organismo?: string | null;
  monto?: number | null;
  asignado: AsignadoInfo | null;
  /** Empresa-cliente del negocio. Si no viene, se toma la del asignado (o Grupo ICA). Los avisos a "todos los admins" son SOLO
   *  de esa empresa: un cliente jamás debe enterarse de lo de otro, ni ICA de lo de un cliente. */
  clienteId?: number;
  /** Para que un aviso repetido legítimo (p. ej. una readjudicación) no lo frene el anti-duplicado del correo. */
  variante?: string;
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
    let clienteId = a.clienteId;
    if (clienteId == null && a.asignado) {
      const [cu] = await pool.query(`SELECT cliente_id FROM usuarios WHERE id = ? LIMIT 1`, [a.asignado.id]) as any[];
      clienteId = (cu as any[])[0]?.cliente_id != null ? Number((cu as any[])[0].cliente_id) : undefined;
    }
    const cid = clienteId ?? 1;

    // Destinatarios según la regla única (encargado de la licitación + admins/Compras/MP según el tipo).
    const dest = await destinatariosDe(a.tipo, cid, [a.asignado?.id]);
    // El asignado siempre es destinatario (aunque su ficha no venga en la lista de la empresa).
    if (a.asignado && !dest.some(d => Number(d.id) === Number(a.asignado!.id))) {
      dest.push({ id: Number(a.asignado.id), nombre: a.asignado.nombre, email: a.asignado.email, rol: 'usuario', activo: 1 });
    }
    if (dest.length === 0) return;

    // Campana: todos los destinatarios menos el asignado (ese ya la recibió del llamador).
    for (const d of dest) {
      if (a.asignado && Number(d.id) === Number(a.asignado.id)) continue;
      await registrarEvento({
        tipo: a.tipo === 'apertura' ? 'APERTURA' : 'RESULTADO_ADJUDICACION',
        licitacionCodigo: a.codigo, licitacionNombre: a.nombre,
        usuarioId: d.id, usuarioNombre: d.nombre,
        actorId: null, actorNombre: 'Mercado Público',
        mensaje: mensajeCampana(a),
        metadata: { licitacion_codigo: a.codigo, resultado: a.tipo },
      });
    }

    // Correo: uno por alerta, licitación y persona (el mismo hito lo detectan varias vías y antes llegaba repetido).
    if (process.env.ALERTAS_EMAIL !== 'false') {
      for (const d of dest) {
        if (!d.email) continue;
        if (!(await reservarCorreo(`${a.tipo}:${a.codigo}:${a.variante ?? ''}:${d.id}`))) continue;
        await enviarAvisoResultadoLicitacion({
          to: d.email, nombre: d.nombre, tipo: a.tipo,
          codigo: a.codigo, licitacionNombre: a.nombre, organismo: a.organismo ?? null, monto: a.monto ?? null,
        }).catch(e => console.error('[avisar-resultado] correo falló:', String(e).slice(0, 200)));
      }
    }

    // WhatsApp: los mismos destinatarios, solo con el aviso activado en su perfil. Cola con pausa y tope diario;
    // no bloquea ni rompe este aviso si falla.
    await encolarAvisoWhatsapp({
      tipo: a.tipo, codigo: a.codigo, nombre: a.nombre, organismo: a.organismo ?? null, monto: a.monto ?? null,
      asignadoId: a.asignado?.id ?? null, clienteId: cid,
      claveExtra: a.variante ? `${a.codigo}:${a.variante}` : undefined,
    });
  } catch (e) {
    console.error('[avisar-resultado] falló (no crítico):', String(e).slice(0, 200));
  }
}
