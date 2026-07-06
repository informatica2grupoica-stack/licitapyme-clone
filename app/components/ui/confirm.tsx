'use client';

// Diálogo de confirmación moderno — reemplaza el confirm() nativo del navegador.
// Patrón promesa: const ok = await confirmar({ titulo, mensaje, peligro: true });
// Montado globalmente por <ConfirmProvider> (app/layout.tsx), igual que ToastProvider.
//
// Uso:
//   const confirmar = useConfirm();
//   const ok = await confirmar({
//     titulo: '¿Eliminar usuario?',
//     mensaje: 'Esta acción no se puede deshacer.',
//     confirmarLabel: 'Eliminar',
//     peligro: true,
//   });
//   if (!ok) return;

import {
  createContext, useContext, useState, useRef, useCallback, useEffect,
  type ReactNode,
} from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';

export interface ConfirmOpciones {
  titulo: string;
  mensaje?: string;
  confirmarLabel?: string;  // default: "Confirmar"
  cancelarLabel?: string;   // default: "Cancelar"
  peligro?: boolean;        // true → botón rojo (acciones destructivas)
}

type ConfirmFn = (opciones: ConfirmOpciones) => Promise<boolean>;

const Ctx = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opciones, setOpciones] = useState<ConfirmOpciones | null>(null);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);
  const confirmarBtnRef = useRef<HTMLButtonElement>(null);

  const confirmar: ConfirmFn = useCallback(opts => {
    return new Promise<boolean>(resolve => {
      // Si ya había un diálogo abierto, se resuelve como cancelado.
      resolverRef.current?.(false);
      resolverRef.current = resolve;
      setOpciones(opts);
    });
  }, []);

  const cerrar = useCallback((ok: boolean) => {
    resolverRef.current?.(ok);
    resolverRef.current = null;
    setOpciones(null);
  }, []);

  // Escape cancela · Enter confirma · foco inicial en el botón primario.
  useEffect(() => {
    if (!opciones) return;
    confirmarBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); cerrar(false); }
      if (e.key === 'Enter')  { e.preventDefault(); cerrar(true); }
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [opciones, cerrar]);

  return (
    <Ctx.Provider value={confirmar}>
      {children}

      {opciones && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center p-4 overlay-in"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-titulo"
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={() => cerrar(false)} />

          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl modal-in overflow-hidden">
            <div className="px-5 pt-5 pb-4">
              <div className="flex items-start gap-3">
                <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${
                  opciones.peligro ? 'bg-red-50 text-red-600' : 'bg-indigo-50 text-indigo-600'
                }`}>
                  {opciones.peligro ? <AlertTriangle size={19} /> : <HelpCircle size={19} />}
                </div>
                <div className="min-w-0 pt-0.5">
                  <h2 id="confirm-titulo" className="text-[15px] font-bold text-slate-900 leading-snug">
                    {opciones.titulo}
                  </h2>
                  {opciones.mensaje && (
                    <p className="text-[13px] text-slate-500 mt-1 leading-relaxed">{opciones.mensaje}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => cerrar(false)}
                className="px-4 py-2 text-[13px] font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 rounded-lg transition-colors"
              >
                {opciones.cancelarLabel || 'Cancelar'}
              </button>
              <button
                ref={confirmarBtnRef}
                onClick={() => cerrar(true)}
                className={`px-4 py-2 text-[13px] font-semibold text-white rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                  opciones.peligro
                    ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
                    : 'bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-500'
                }`}
              >
                {opciones.confirmarLabel || 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return ctx;
}
