'use client';

// TEMA claro/oscuro de toda la app — mismo patrón que el colapso del sidebar (AppLayout.tsx):
// un valor cacheado a nivel de módulo para que, al remontar entre páginas, no haya parpadeo
// entre claro y oscuro mientras se relee localStorage.
//
// La clase `dark` se aplica a <html>. globals.css declara el variant de Tailwind v4:
//   @custom-variant dark (&:where(.dark, .dark *));
// así que cualquier utilidad `dark:` en el árbol reacciona a esa clase, no a prefers-color-scheme.
//
// El script inline en layout.tsx aplica la clase ANTES del primer paint (evita el flash blanco→oscuro).
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

export type Tema = 'claro' | 'oscuro';

const CLAVE_TEMA = 'tema-color';

let temaCache: Tema | null = null;

function aplicarClase(tema: Tema) {
  document.documentElement.classList.toggle('dark', tema === 'oscuro');
}

interface ThemeCtx { tema: Tema; alternar: () => void; setTema: (t: Tema) => void }
const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [tema, setTemaState] = useState<Tema>(() => temaCache ?? 'claro');

  useEffect(() => {
    if (temaCache === null) {
      let inicial: Tema = 'claro';
      try { inicial = (localStorage.getItem(CLAVE_TEMA) as Tema) || 'claro'; } catch { /* no bloquear */ }
      temaCache = inicial;
      setTemaState(inicial);
    }
  }, []);

  const setTema = useCallback((next: Tema) => {
    temaCache = next;
    setTemaState(next);
    aplicarClase(next);
    try { localStorage.setItem(CLAVE_TEMA, next); } catch { /* no bloquear por storage */ }
  }, []);

  const alternar = useCallback(() => {
    setTema(temaCache === 'oscuro' ? 'claro' : 'oscuro');
  }, [setTema]);

  return <Ctx.Provider value={{ tema, alternar, setTema }}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
