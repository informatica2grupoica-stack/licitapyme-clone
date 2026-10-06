// app/api/admin/gasto-ia/route.ts
// GET — gasto de IA por perfil, módulo, modelo, día y licitación (/admin/gasto-ia). Solo admin.
// Lee la tabla ia_uso (migration-139), que llena app/lib/ia-uso.ts en cada llamada al modelo.
// ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD (por defecto: últimos 30 días, hora de Chile).
// proxy.ts ya bloquea /api/admin a no-admins; se reverifica contra el JWT (defensa en profundidad).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { esAdmin } from '@/app/lib/api-auth';
import { ahoraChileSQL } from '@/app/lib/tz';
import { MODULOS_IA } from '@/app/lib/ia-uso';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const num = (x: unknown) => Number(x ?? 0);

export async function GET(req: NextRequest) {
  if (!(await esAdmin(req))) return NextResponse.json({ error: 'Sin permisos de administrador' }, { status: 403 });
  try {
    const hoy = ahoraChileSQL().slice(0, 10);
    const hasta = FECHA.test(req.nextUrl.searchParams.get('hasta') || '') ? req.nextUrl.searchParams.get('hasta')! : hoy;
    const d30 = new Date(`${hoy}T12:00:00Z`); d30.setUTCDate(d30.getUTCDate() - 29);
    const desde = FECHA.test(req.nextUrl.searchParams.get('desde') || '') ? req.nextUrl.searchParams.get('desde')! : d30.toISOString().slice(0, 10);
    const rango = [`${desde} 00:00:00`, `${hasta} 23:59:59`];
    const W = 'WHERE u.created_at BETWEEN ? AND ?';

    const [[tot]] = await pool.query(
      `SELECT COUNT(*) llamadas, COALESCE(SUM(costo_usd),0) costo, COALESCE(SUM(tokens_in),0) tin, COALESCE(SUM(tokens_out),0) tout,
              COUNT(DISTINCT usuario_id) usuarios, SUM(respaldo) respaldo, COUNT(DISTINCT licitacion_codigo) licitaciones
         FROM ia_uso u ${W}`, rango) as any;

    const [porUsuario] = await pool.query(
      `SELECT u.usuario_id, COALESCE(us.nombre, u.usuario_nombre) nombre, us.email, us.empresa, us.rol,
              COUNT(*) llamadas, SUM(u.costo_usd) costo, SUM(u.tokens_in) tin, SUM(u.tokens_out) tout,
              MAX(u.created_at) ultima
         FROM ia_uso u LEFT JOIN usuarios us ON us.id = u.usuario_id ${W}
        GROUP BY u.usuario_id, COALESCE(us.nombre, u.usuario_nombre), us.email, us.empresa, us.rol
        ORDER BY costo DESC`, rango) as any;

    // Cruce usuario × módulo (para el desglose de cada perfil)
    const [usuarioModulo] = await pool.query(
      `SELECT u.usuario_id, u.modulo, COUNT(*) llamadas, SUM(u.costo_usd) costo
         FROM ia_uso u ${W} GROUP BY u.usuario_id, u.modulo`, rango) as any;

    const [porModulo] = await pool.query(
      `SELECT u.modulo, COUNT(*) llamadas, SUM(u.costo_usd) costo, SUM(u.tokens_in) tin, SUM(u.tokens_out) tout
         FROM ia_uso u ${W} GROUP BY u.modulo ORDER BY costo DESC`, rango) as any;

    const [porModelo] = await pool.query(
      `SELECT u.modelo, u.proveedor, COUNT(*) llamadas, SUM(u.costo_usd) costo, SUM(u.tokens_in) tin, SUM(u.tokens_out) tout, SUM(u.respaldo) respaldo
         FROM ia_uso u ${W} GROUP BY u.modelo, u.proveedor ORDER BY costo DESC`, rango) as any;

    const [porDia] = await pool.query(
      `SELECT DATE_FORMAT(u.created_at, '%Y-%m-%d') dia, COUNT(*) llamadas, SUM(u.costo_usd) costo
         FROM ia_uso u ${W} GROUP BY dia ORDER BY dia`, rango) as any;

    const [porLicitacion] = await pool.query(
      `SELECT u.licitacion_codigo codigo, COUNT(*) llamadas, SUM(u.costo_usd) costo, SUM(u.tokens_in + u.tokens_out) tokens
         FROM ia_uso u ${W} AND u.licitacion_codigo IS NOT NULL
        GROUP BY u.licitacion_codigo ORDER BY costo DESC LIMIT 15`, rango) as any;

    const [recientes] = await pool.query(
      `SELECT u.id, u.created_at, COALESCE(us.nombre, u.usuario_nombre) nombre, u.modulo, u.licitacion_codigo codigo,
              u.modelo, u.respaldo, u.tokens_in tin, u.tokens_out tout, u.costo_usd costo, u.duracion_ms ms
         FROM ia_uso u LEFT JOIN usuarios us ON us.id = u.usuario_id ${W}
        ORDER BY u.id DESC LIMIT 40`, rango) as any;

    return NextResponse.json({
      success: true,
      rango: { desde, hasta },
      totales: {
        llamadas: num(tot.llamadas), costo: num(tot.costo), tokens_in: num(tot.tin), tokens_out: num(tot.tout),
        usuarios: num(tot.usuarios), llamadas_respaldo: num(tot.respaldo), licitaciones: num(tot.licitaciones),
      },
      por_usuario: (porUsuario as any[]).map(r => ({
        usuario_id: r.usuario_id == null ? null : Number(r.usuario_id),
        nombre: r.usuario_id == null ? 'Automático (sistema)' : (r.nombre || r.email || `Usuario ${r.usuario_id}`),
        email: r.email ?? null, empresa: r.empresa ?? null, rol: r.rol ?? null,
        llamadas: num(r.llamadas), costo: num(r.costo), tokens_in: num(r.tin), tokens_out: num(r.tout), ultima: r.ultima,
        modulos: (usuarioModulo as any[]).filter(m => (m.usuario_id ?? null) === (r.usuario_id ?? null))
          .map(m => ({ modulo: m.modulo, llamadas: num(m.llamadas), costo: num(m.costo) })).sort((a, b) => b.costo - a.costo),
      })),
      por_modulo: (porModulo as any[]).map(r => ({
        modulo: r.modulo, nombre: (MODULOS_IA as Record<string, string>)[r.modulo] || r.modulo,
        llamadas: num(r.llamadas), costo: num(r.costo), tokens_in: num(r.tin), tokens_out: num(r.tout),
      })),
      por_modelo: (porModelo as any[]).map(r => ({
        modelo: r.modelo, proveedor: r.proveedor, llamadas: num(r.llamadas), costo: num(r.costo),
        tokens_in: num(r.tin), tokens_out: num(r.tout), llamadas_respaldo: num(r.respaldo),
      })),
      por_dia: (porDia as any[]).map(r => ({ dia: String(r.dia), llamadas: num(r.llamadas), costo: num(r.costo) })),
      por_licitacion: (porLicitacion as any[]).map(r => ({ codigo: r.codigo, llamadas: num(r.llamadas), costo: num(r.costo), tokens: num(r.tokens) })),
      recientes: (recientes as any[]).map(r => ({
        id: Number(r.id), fecha: r.created_at, nombre: r.nombre || 'Automático (sistema)', modulo: r.modulo, codigo: r.codigo,
        modelo: r.modelo, respaldo: !!r.respaldo, tokens_in: num(r.tin), tokens_out: num(r.tout), costo: num(r.costo), ms: num(r.ms),
      })),
    });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    // Tabla sin crear: la pantalla lo explica en vez de romperse.
    if (/ia_uso/.test(msg) && /doesn't exist|no existe/i.test(msg)) return NextResponse.json({ success: false, falta_migracion: true, error: 'Falta aplicar migration-139 (node scripts/aplicar-migration-139.mjs)' });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
