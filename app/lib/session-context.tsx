'use client';

// app/lib/session-context.tsx
// Contexto global de sesión — disponible en todos los componentes cliente
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

export interface UsuarioSession {
  id: number;
  email: string;
  nombre: string | null;
  empresa: string | null;
  rol: 'admin' | 'usuario' | 'externo';
  // Permisos granulares (admin = todos). El cliente los usa para mostrar/ocultar UI;
  // el servidor SIEMPRE reverifica en cada endpoint (no confía solo en esto).
  permisos?: {
    ver_otros_negocios?: boolean;
    acceso_radar?: boolean;
    comentar_viabilidad?: boolean;
    exportar?: boolean;
    alertas_anexos?: boolean;
    aprobar_comercial?: boolean;
    entrega_proyectos?: boolean;
    repartir_puente?: boolean;
    compras?: boolean;
    compras_administracion?: boolean;
    compras_bodega?: boolean;
    // Único permiso que NO viene gratis con `rol==='admin'` (10-sep-2026) — ver api-auth.ts.
    compras_todo?: boolean;
    // Perfil de Compras: menú y páginas limitados a los módulos de Compras.
    solo_compras?: boolean;
    // Compras en SOLO LECTURA: ve el módulo y sus catálogos, no puede modificar nada.
    compras_ver?: boolean;
  };
  // Frente C.1: ¿ve por defecto solo la Tarjeta de Decisión (resumen) en vez de los 4 módulos
  // de detalle? El propio usuario puede graduarse desde el botón "Ver análisis completo".
  modoPrincipiante?: boolean;
  // Datos de contacto (migración 125). `perfilPendiente` = aún no tiene teléfono → aviso en el layout.
  telefono?: string | null;
  cargo?: string | null;
  tieneFoto?: boolean;
  perfilPendiente?: boolean;
}

interface SessionContextType {
  usuario: UsuarioSession | null;
  cargando: boolean;
  recargarSesion: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextType>({
  usuario: null,
  cargando: true,
  recargarSesion: async () => {},
  logout: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioSession | null>(null);
  const [cargando, setCargando] = useState(true);

  const recargarSesion = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      setUsuario(data.autenticado ? data.usuario : null);
    } catch {
      setUsuario(null);
    } finally {
      setCargando(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      setUsuario(null);
      window.location.href = '/bienvenida';
    }
  }, []);

  useEffect(() => {
    recargarSesion();
  }, [recargarSesion]);

  return (
    <SessionContext.Provider value={{ usuario, cargando, recargarSesion, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
