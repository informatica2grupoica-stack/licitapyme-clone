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
  };
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
      window.location.href = '/login';
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
