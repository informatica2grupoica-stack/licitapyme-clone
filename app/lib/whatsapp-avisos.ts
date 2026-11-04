// app/lib/whatsapp-avisos.ts
// Avisos por WhatsApp (ganada / perdida / apertura / orden de compra) desde el número emisor de la empresa. Vía NO oficial (Evolution/Baileys):
// por eso se manda de a uno, con pausa entre mensajes, un tope diario y solo a personas del equipo con su celular registrado.
//   encolarAvisoWhatsapp()  → decide a quién le toca y deja los mensajes en la cola (best-effort: nunca rompe el cron que llama).
//   drenarCola()            → envía lo pendiente; lo dispara el propio encolado y /api/cron/whatsapp-cola (reintentos).
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { enviarTexto, estadoInstancia, instanciaEmisor, whatsappConfigurado, WhatsappError } from '@/app/lib/whatsapp';
import {
  claveAviso, elegirDestinatarios, porDefecto, redactarAviso, TIPOS_AVISO,
  type Destinatario, type TipoAviso,
} from '@/app/lib/whatsapp-avisos-core';

const TOPE_DIARIO = Math.max(1, Number(process.env.WHATSAPP_TOPE_DIARIO) || 150);
const PAUSA_MIN_MS = Number(process.env.WHATSAPP_PAUSA_MIN_MS) || 8000;
const PAUSA_MAX_MS = Number(process.env.WHATSAPP_PAUSA_MAX_MS) || 20000;
const MAX_INTENTOS = 3;

const TIPOS_VALIDOS = new Set<string>(TIPOS_AVISO.map(t => t.tipo));

export async function prefsDe(ids: number[]): Promise<Map<number, Partial<Record<TipoAviso, boolean>>>> {
  const m = new Map<number, Partial<Record<TipoAviso, boolean>>>();
  if (ids.length === 0) return m;
  const [rows] = await pool.query(
    `SELECT usuario_id, tipo, activo FROM whatsapp_aviso_pref WHERE usuario_id IN (${ids.map(() => '?').join(',')})`, ids,
  ) as any[];
  for (const r of rows as any[]) {
    if (!TIPOS_VALIDOS.has(r.tipo)) continue;
    const e = m.get(Number(r.usuario_id)) ?? {};
    e[r.tipo as TipoAviso] = !!r.activo;
    m.set(Number(r.usuario_id), e);
  }
  return m;
}

/** Lo que de verdad recibe un perfil (lo elegido o el valor por defecto): es lo que muestra el selector. */
export async function avisosEfectivos(usuarioId: number, rol: string): Promise<Record<TipoAviso, boolean>> {
  const p = (await prefsDe([usuarioId])).get(usuarioId) ?? {};
  return Object.fromEntries(TIPOS_AVISO.map(t => [t.tipo, p[t.tipo] ?? porDefecto(rol, t.tipo)])) as Record<TipoAviso, boolean>;
}

export async function guardarAvisos(usuarioId: number, avisos: Partial<Record<TipoAviso, boolean>>): Promise<void> {
  for (const t of TIPOS_AVISO) {
    if (typeof avisos[t.tipo] !== 'boolean') continue;
    await pool.query(
      `INSERT INTO whatsapp_aviso_pref (usuario_id, tipo, activo) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE activo = VALUES(activo)`,
      [usuarioId, t.tipo, avisos[t.tipo] ? 1 : 0],
    );
  }
}

export interface EventoAviso {
  tipo: TipoAviso;
  codigo: string;
  nombre: string | null;
  organismo?: string | null;
  monto?: number | null;
  asignadoId: number | null;
  clienteId: number;
  /** Solo en 'oc': código de la orden (va en la clave: cada orden se avisa una vez por persona). */
  ordenCodigo?: string | null;
}

export async function encolarAvisoWhatsapp(ev: EventoAviso): Promise<number> {
  try {
    if (!whatsappConfigurado()) return 0;
    // La orden de compra va a quien la tenga activada, sea o no el responsable: ahí se miran todos los perfiles activos.
    const [rows] = await pool.query(
      `SELECT id, nombre, rol, activo, telefono FROM usuarios WHERE cliente_id = ? AND activo = TRUE AND (rol = 'admin' OR id = ? OR ? = 1)`,
      [ev.clienteId, ev.asignadoId ?? 0, ev.tipo === 'oc' ? 1 : 0],
    ) as any[];
    const candidatos = rows as Destinatario[];
    const prefs = await prefsDe(candidatos.map(c => Number(c.id)));
    const destinos = elegirDestinatarios(ev.tipo, ev.asignadoId, candidatos, prefs);
    let nuevos = 0;
    for (const d of destinos) {
      const texto = redactarAviso({
        tipo: ev.tipo, codigo: ev.codigo, licitacionNombre: ev.nombre, organismo: ev.organismo, monto: ev.monto,
        nombreDestinatario: d.nombre, urlBase: process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000', ordenCodigo: ev.ordenCodigo,
      });
      const [r] = await pool.query(
        `INSERT IGNORE INTO whatsapp_cola (cliente_id, usuario_id, telefono, tipo, licitacion_codigo, clave, texto, creado_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [ev.clienteId, d.id, d.telefonoNormalizado, ev.tipo, ev.codigo, claveAviso(ev.tipo, ev.tipo === 'oc' && ev.ordenCodigo ? ev.ordenCodigo : ev.codigo, Number(d.id)), texto, ahoraChileSQL()],
      ) as any[];
      nuevos += Number((r as any).affectedRows) || 0;
    }
    if (nuevos > 0) void drenarCola();
    return nuevos;
  } catch (e) {
    console.error('[whatsapp-avisos] encolar falló (no crítico):', String(e).slice(0, 200));
    return 0;
  }
}

let drenando = false;
const pausa = () => new Promise<void>(r => setTimeout(r, PAUSA_MIN_MS + Math.random() * (PAUSA_MAX_MS - PAUSA_MIN_MS)));

/** Envía los pendientes de a uno. Si el emisor no está conectado, los deja pendientes (el cron reintenta). Un solo drenado a la vez por proceso. */
export async function drenarCola(): Promise<{ enviados: number; pendientes: number; motivo?: string }> {
  if (drenando) return { enviados: 0, pendientes: -1, motivo: 'ya hay un envío en curso' };
  drenando = true;
  let enviados = 0;
  try {
    if (!whatsappConfigurado()) return { enviados, pendientes: 0, motivo: 'WhatsApp no configurado' };
    const [cl] = await pool.query(`SELECT DISTINCT cliente_id FROM whatsapp_cola WHERE estado = 'pendiente'`) as any[];
    for (const { cliente_id } of cl as Array<{ cliente_id: number }>) {
      const inst = instanciaEmisor(Number(cliente_id));
      if (await estadoInstancia(inst).catch(() => 'close') !== 'open') continue;
      const hoy = ahoraChileSQL().slice(0, 10) + ' 00:00:00';
      const [c] = await pool.query(`SELECT COUNT(*) n FROM whatsapp_cola WHERE cliente_id = ? AND estado = 'enviado' AND enviado_at >= ?`, [cliente_id, hoy]) as any[];
      let restan = TOPE_DIARIO - Number((c as any[])[0].n);
      const [pend] = await pool.query(
        `SELECT id, telefono, texto, intentos FROM whatsapp_cola WHERE cliente_id = ? AND estado = 'pendiente' ORDER BY id LIMIT 50`, [cliente_id],
      ) as any[];
      for (const m of pend as any[]) {
        if (restan <= 0) break;
        try {
          await enviarTexto(inst, m.telefono, m.texto);
          await pool.query(`UPDATE whatsapp_cola SET estado = 'enviado', enviado_at = ?, error = NULL WHERE id = ?`, [ahoraChileSQL(), m.id]);
          enviados++; restan--;
          await pausa();
        } catch (e) {
          const intentos = Number(m.intentos) + 1;
          await pool.query(`UPDATE whatsapp_cola SET intentos = ?, error = ?, estado = ? WHERE id = ?`,
            [intentos, String(e instanceof WhatsappError ? e.message : e).slice(0, 250), intentos >= MAX_INTENTOS ? 'error' : 'pendiente', m.id]);
          if (e instanceof WhatsappError && e.status === 503) break; // servicio caído: no insistir con el resto
        }
      }
    }
    const [p] = await pool.query(`SELECT COUNT(*) n FROM whatsapp_cola WHERE estado = 'pendiente'`) as any[];
    return { enviados, pendientes: Number((p as any[])[0].n) };
  } catch (e) {
    console.error('[whatsapp-avisos] drenar falló (no crítico):', String(e).slice(0, 200));
    return { enviados, pendientes: -1, motivo: 'error' };
  } finally {
    drenando = false;
  }
}

/** Para la pantalla de administración. */
export async function resumenCola(clienteId: number) {
  const [r] = await pool.query(
    `SELECT SUM(estado='pendiente') pendientes, SUM(estado='error') errores, SUM(estado='enviado' AND enviado_at >= ?) hoy FROM whatsapp_cola WHERE cliente_id = ?`,
    [ahoraChileSQL().slice(0, 10) + ' 00:00:00', clienteId],
  ) as any[];
  const [ult] = await pool.query(
    `SELECT c.id, c.tipo, c.licitacion_codigo, c.estado, c.intentos, c.error, c.creado_at, c.enviado_at, u.nombre
     FROM whatsapp_cola c LEFT JOIN usuarios u ON u.id = c.usuario_id WHERE c.cliente_id = ? ORDER BY c.id DESC LIMIT 15`, [clienteId],
  ) as any[];
  const x = (r as any[])[0] ?? {};
  return { pendientes: Number(x.pendientes) || 0, errores: Number(x.errores) || 0, enviadosHoy: Number(x.hoy) || 0, topeDiario: TOPE_DIARIO, ultimos: ult as any[] };
}
