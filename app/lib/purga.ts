// app/lib/purga.ts — retención de tablas que crecen sin límite (auditoría 2026-11-17, DB-005; Ley 21.719: no guardar datos personales más de lo necesario).
// SEGURA POR DEFECTO: sin PURGA_ACTIVA=1 solo CUENTA lo que borraría (simulación). Los plazos son decisión del dueño y se ajustan por variable de entorno
// (meses; 0 = no purgar esa tabla). Borra en lotes chicos para no bloquear la base.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';

const LOTE = 5000;
const MAX_LOTES = 20; // por tabla y por corrida; lo que falte sale en la corrida siguiente

interface Regla {
  tabla: string;
  /** Condición SQL con `?` = fecha de corte (hora de Chile, formato SQL). */
  donde: string;
  /** Plazo por defecto en días y variable que lo cambia (en meses, salvo `diasEnv`). */
  dias: number;
  env: string;
  etiqueta: string;
}

// Qué se purga y por qué:
//  · password_resets: enlaces de recuperación ya usados o vencidos; no sirven para nada.
//  · actividad_usuario: bitácora de uso por persona (datos personales: quién hizo qué y cuándo).
//  · historial_eventos: campana de notificaciones y su historia.
// NO se purga licitaciones_cache (96 MB): es caché de datos públicos que ahorra consultas a Mercado Público.
const REGLAS: Regla[] = [
  { tabla: 'password_resets', donde: `(usado_en IS NOT NULL AND usado_en < ?) OR (expira_en < ?)`, dias: 7, env: 'PURGA_RESETS_DIAS', etiqueta: 'enlaces de recuperación usados o vencidos' },
  { tabla: 'actividad_usuario', donde: `created_at < ?`, dias: 18 * 30, env: 'PURGA_ACTIVIDAD_MESES', etiqueta: 'bitácora de actividad por usuario' },
  { tabla: 'historial_eventos', donde: `created_at < ?`, dias: 24 * 30, env: 'PURGA_HISTORIAL_MESES', etiqueta: 'notificaciones e historial' },
];

function diasDe(r: Regla): number {
  const v = process.env[r.env];
  if (v === undefined || v === '') return r.dias;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return r.dias;
  return r.env.endsWith('_MESES') ? Math.round(n * 30) : Math.round(n);
}

/** Fecha de corte «ahora − dias», en hora de Chile y formato SQL. */
function corte(dias: number): string {
  return ahoraChileSQL(new Date(Date.now() - dias * 86_400_000));
}

export interface ResultadoPurga { tabla: string; etiqueta: string; dias: number | null; modo: 'simulacion' | 'real' | 'desactivada' | 'error'; filas: number; detalle?: string }

export async function ejecutarPurga(opts: { real?: boolean } = {}): Promise<ResultadoPurga[]> {
  const real = opts.real ?? /^(1|true)$/i.test(process.env.PURGA_ACTIVA || '');
  const out: ResultadoPurga[] = [];
  for (const r of REGLAS) {
    const dias = diasDe(r);
    if (dias === 0) { out.push({ tabla: r.tabla, etiqueta: r.etiqueta, dias: null, modo: 'desactivada', filas: 0 }); continue; }
    const c = corte(dias);
    const params = r.donde.split('?').length - 1 === 2 ? [c, c] : [c];
    try {
      if (!real) {
        const [rows] = await pool.query(`SELECT COUNT(*) n FROM ${r.tabla} WHERE ${r.donde}`, params) as any;
        out.push({ tabla: r.tabla, etiqueta: r.etiqueta, dias, modo: 'simulacion', filas: Number(rows[0]?.n) || 0 });
        continue;
      }
      let total = 0;
      for (let i = 0; i < MAX_LOTES; i++) {
        const [res] = await pool.query(`DELETE FROM ${r.tabla} WHERE ${r.donde} LIMIT ${LOTE}`, params) as any;
        const n = Number(res?.affectedRows) || 0;
        total += n;
        if (n < LOTE) break;
      }
      out.push({ tabla: r.tabla, etiqueta: r.etiqueta, dias, modo: 'real', filas: total });
    } catch (e) {
      out.push({ tabla: r.tabla, etiqueta: r.etiqueta, dias, modo: 'error', filas: 0, detalle: String(e).slice(0, 160) });
    }
  }
  return out;
}
