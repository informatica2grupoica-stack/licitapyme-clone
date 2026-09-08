'use client';

// Burbuja de costeo a nivel de TODA LA APP (pedido del usuario, 08-sep-2026: "no puedo dejar el
// costeo digital en una burbuja para poder seguir trabajando en la aplicación sin cerrar el
// costeo a cada momento"). Antes la burbuja vivía DENTRO de CosteoEditorCard, montada solo
// mientras la sección "costeo" del negocio estaba activa
// (`{seccion === 'costeo' && <CosteoEditorCard .../>}` en app/negocios/[id]/page.tsx) — cambiar
// de pestaña dentro del MISMO negocio, o navegar a cualquier otra página, desmontaba el
// componente y la burbuja (con lo editado sin guardar) desaparecía sin aviso.
//
// Este contexto vive en el layout raíz (app/layout.tsx — el único que Next.js NUNCA desmonta al
// navegar entre páginas) y solo guarda CUÁL negocio está flotando y en qué modo. La instancia de
// verdad (con todo el estado del editor) la monta <CosteoFlotanteHost/> — ver ese archivo — para
// evitar un import circular con CosteoEditorCard.tsx (que a su vez importa `useCosteoFlotante`
// de acá).
import { createContext, useContext, useState, useRef, useCallback, useMemo, type ReactNode } from 'react';
import type { EstadoEditor } from '@/app/negocios/[id]/CosteoEditorCard';

export interface CosteoEstadoHeredado {
  estado: EstadoEditor;
  guardado: EstadoEditor | null;
}

interface CosteoActivo {
  negocioId: number;
  licitacionCodigo: string;
  heredado?: CosteoEstadoHeredado;
}

interface CosteoFlotanteCtx {
  activo: CosteoActivo | null;
  // 'grande' = pantalla completa (una planilla de varias columnas no cabe cómoda en un panel
  // chico — pedido del usuario, 08-sep-2026: "se ve muy pequeño... necesito que se vea grande").
  // 'burbuja' = minimizada a un botón redondo, para seguir en otra página sin perder lo editado.
  modo: 'grande' | 'burbuja';
  /** Trae al frente el negocio que ya está flotando, o abre uno nuevo (reemplazando al anterior si
   *  no tiene cambios sin guardar — o tras confirmar que sí se descartan). `heredado` transporta
   *  lo editado en memoria de la instancia embebida para no perderlo en el traspaso. */
  abrir: (negocioId: number, licitacionCodigo: string, heredado?: CosteoEstadoHeredado) => Promise<void>;
  minimizar: () => void;
  expandir: () => void;
  /** Solo la llama la instancia flotante DESPUÉS de su propio confirm si hay cambios sin guardar
   *  (ver cerrarFlotante en CosteoEditorCard) — acá solo se libera el slot. */
  cerrar: () => void;
  /** La instancia flotante activa registra acá su propio chequeo de "hay cambios sin guardar,
   *  confirma antes de perderlos" — así `abrir()` puede pedirlo ANTES de reemplazarla por otro
   *  negocio, sin que este contexto necesite saber nada de costeo. `null` la desregistra. */
  registrarGuardaAntesDeReemplazar: (fn: (() => Promise<boolean>) | null) => void;
}

const Ctx = createContext<CosteoFlotanteCtx | null>(null);

export function CosteoFlotanteProvider({ children }: { children: ReactNode }) {
  const [activo, setActivo] = useState<CosteoActivo | null>(null);
  const [modo, setModo] = useState<'grande' | 'burbuja'>('grande');
  const guardaRef = useRef<(() => Promise<boolean>) | null>(null);

  const registrarGuardaAntesDeReemplazar = useCallback((fn: (() => Promise<boolean>) | null) => {
    guardaRef.current = fn;
  }, []);

  const abrir = useCallback(async (negocioId: number, licitacionCodigo: string, heredado?: CosteoEstadoHeredado) => {
    // Ya está flotando ESTE mismo negocio: solo se trae al frente, nunca se reemplaza la
    // instancia (lo que lleve editado en memoria ahora mismo va más adelante que `heredado`,
    // que quedaría desactualizado).
    if (activo && activo.negocioId === negocioId) { setModo('grande'); return; }
    // Ya hay OTRO negocio flotando: su propia instancia decide si hay algo sin guardar que se
    // perdería al reemplazarla (misma lógica que ya usa el botón "Cerrar" de la burbuja).
    if (activo && activo.negocioId !== negocioId) {
      const puedeReemplazar = guardaRef.current ? await guardaRef.current() : true;
      if (!puedeReemplazar) return;
    }
    setActivo({ negocioId, licitacionCodigo, heredado });
    setModo('grande');
  }, [activo]);

  const minimizar = useCallback(() => setModo('burbuja'), []);
  const expandir = useCallback(() => setModo('grande'), []);
  const cerrar = useCallback(() => { setActivo(null); guardaRef.current = null; }, []);

  // Memoizado: sin esto, cada componente que consume el contexto (potencialmente varios negocios
  // a la vez en pantalla) re-renderiza en cada tick, y los `useEffect`/`useCallback` de
  // CosteoEditorCard que llevan `flot` en sus dependencias se recrean de más.
  const value = useMemo<CosteoFlotanteCtx>(
    () => ({ activo, modo, abrir, minimizar, expandir, cerrar, registrarGuardaAntesDeReemplazar }),
    [activo, modo, abrir, minimizar, expandir, cerrar, registrarGuardaAntesDeReemplazar],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCosteoFlotante(): CosteoFlotanteCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCosteoFlotante must be used inside <CosteoFlotanteProvider>');
  return ctx;
}
