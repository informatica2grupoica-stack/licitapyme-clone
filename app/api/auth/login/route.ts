// app/api/auth/login/route.ts
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import pool from '@/app/lib/db';
import { respuestaConSession, type UsuarioSession } from '@/app/lib/auth';
import { ipDeRequest, estaBloqueado, registrarIntento } from '@/app/lib/login-rate-limit';
import { registrarActividad } from '@/app/lib/actividad';
import { fichaCliente } from '@/app/lib/tenant';

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email y contraseña son requeridos' },
        { status: 400 }
      );
    }

    const emailLimpio = email.toLowerCase().trim();
    const ip = ipDeRequest(request);

    // ── Protección de fuerza bruta (MySQL, sin Redis) ──────────────────────────
    // Antes de tocar la BD de usuarios, verificar que este email/IP no haya superado
    // el umbral de intentos fallidos recientes. Bloqueo temporal → 429.
    const bloqueo = await estaBloqueado(emailLimpio, ip);
    if (bloqueo.bloqueado) {
      return NextResponse.json(
        {
          error: `Demasiados intentos fallidos. Espera unos minutos e intenta de nuevo.`,
          code: 'RATE_LIMITED',
        },
        { status: 429, headers: { 'Retry-After': String(bloqueo.esperaMin * 60) } }
      );
    }

    // Buscar usuario
    // cliente_id (multi-cliente): si la migración aún no existe, todos son Grupo ICA (1).
    let usuarios: any[];
    try {
      const [rows] = await pool.query(
        'SELECT id, email, password_hash, nombre, empresa, rol, activo, cliente_id FROM usuarios WHERE email = ? LIMIT 1',
        [emailLimpio]
      );
      usuarios = rows as any[];
    } catch (e) {
      if ((e as { code?: string })?.code !== 'ER_BAD_FIELD_ERROR') throw e;
      const [rows] = await pool.query(
        'SELECT id, email, password_hash, nombre, empresa, rol, activo FROM usuarios WHERE email = ? LIMIT 1',
        [emailLimpio]
      );
      usuarios = rows as any[];
    }

    if (usuarios.length === 0) {
      await registrarIntento(emailLimpio, ip, false);
      return NextResponse.json(
        { error: 'Email o contraseña incorrectos' },
        { status: 401 }
      );
    }

    const u = usuarios[0];

    if (!u.activo) {
      return NextResponse.json(
        { error: 'Cuenta desactivada. Contacta al administrador.' },
        { status: 403 }
      );
    }

    // Verificar contraseña
    const coincide = await bcrypt.compare(password, u.password_hash);
    if (!coincide) {
      await registrarIntento(emailLimpio, ip, false);
      return NextResponse.json(
        { error: 'Email o contraseña incorrectos' },
        { status: 401 }
      );
    }

    // Empresa suspendida, dada de baja o vencida: no entra nadie de esa empresa (Grupo ICA nunca se corta).
    const clienteId = Number(u.cliente_id ?? 1);
    if (clienteId !== 1 && !(await fichaCliente(clienteId)).vigente) {
      return NextResponse.json(
        { error: 'El servicio de tu empresa está suspendido o vencido. Contacta a soporte.', code: 'CLIENTE_NO_VIGENTE' },
        { status: 403 }
      );
    }

    // Login correcto → registrar éxito (resetea el contador de fallos del email).
    await registrarIntento(emailLimpio, ip, true);

    // Bitácora: quién y cuándo inició sesión (best-effort, nunca bloquea el login).
    registrarActividad({
      usuarioId: u.id, accion: 'login',
      descripcion: `Inició sesión (${u.email})`,
      metadata: { ip },
    });

    // Actualizar último login
    await pool.query(
      'UPDATE usuarios SET ultimo_login = NOW() WHERE id = ?',
      [u.id]
    );

    const usuario: UsuarioSession = {
      id:      u.id,
      email:   u.email,
      nombre:  u.nombre,
      empresa: u.empresa,
      rol:     u.rol, // el perfil admin de un cliente es admin DENTRO de su empresa: lo acota proxy.ts + los filtros por cliente
      clienteId,
    };

    return respuestaConSession(usuario, {});
  } catch (error) {
    console.error('Error en login:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
