'use client';

// Sistema de toasts al estilo Sonner (Emil Kowalski)
// Uso: const { success, error, warning } = useToast()
//      success('4 licitaciones nuevas', 'maquinaria · hace un momento')

import React, {
  createContext, useContext, useState,
  useCallback, useRef, useEffect,
} from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';

// ── Tipos ─────────────────────────────────────────────────────────────────────

type Variant = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id:           string;
  message:      string;
  description?: string;
  variant:      Variant;
  duration:     number;
}

export interface ToastCtx {
  success: (message: string, description?: string) => void;
  error:   (message: string, description?: string) => void;
  warning: (message: string, description?: string) => void;
  info:    (message: string, description?: string) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

// ── Helpers ───────────────────────────────────────────────────────────────────

function icon(variant: Variant) {
  const base = 'w-[18px] h-[18px] flex-shrink-0 mt-px';
  switch (variant) {
    case 'success': return <CheckCircle2  className={`${base} text-emerald-400`} />;
    case 'error':   return <XCircle       className={`${base} text-red-400`} />;
    case 'warning': return <AlertTriangle className={`${base} text-amber-400`} />;
    default:        return <Info          className={`${base} text-sky-400`} />;
  }
}

function accent(variant: Variant): string {
  switch (variant) {
    case 'success': return 'border-l-emerald-500';
    case 'error':   return 'border-l-red-500';
    case 'warning': return 'border-l-amber-500';
    default:        return 'border-l-sky-500';
  }
}

// ── Toast individual ──────────────────────────────────────────────────────────

function Toast({
  toast,
  onDismiss,
  index,
  total,
}: {
  toast:     ToastItem;
  onDismiss: (id: string) => void;
  index:     number;   // 0 = más reciente (abajo del stack)
  total:     number;
}) {
  // Efecto Sonner: toasts más viejos están levemente escalados y opacos atrás
  const offset   = (total - 1 - index);            // 0 = el de abajo (más nuevo)
  const scale    = 1 - offset * 0.06;
  const opacity  = 1 - offset * 0.15;
  const translateY = offset * -10;                  // los viejos suben un poco

  return (
    <div
      style={{
        transform:   `scale(${scale}) translateY(${translateY}px)`,
        opacity,
        transition:  'all 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
        zIndex:      100 - offset,
        position:    index === 0 ? 'relative' : 'absolute',
        bottom:      0,
        right:       0,
        width:       '100%',
      }}
      className={`
        flex items-start gap-3
        bg-zinc-900 border border-zinc-800 border-l-2 ${accent(toast.variant)}
        rounded-xl px-4 py-3.5
        shadow-[0_8px_30px_rgba(0,0,0,0.5)]
        text-white
        min-w-[320px] max-w-[420px]
        ${index === 0 ? 'slide-in-right' : ''}
      `}
    >
      {icon(toast.variant)}

      <div className="flex-1 min-w-0">
        <p className="text-[13.5px] font-medium leading-snug tracking-[-0.01em]">
          {toast.message}
        </p>
        {toast.description && (
          <p className="text-[12px] text-zinc-400 mt-0.5 leading-relaxed">
            {toast.description}
          </p>
        )}
      </div>

      <button
        onClick={() => onDismiss(toast.id)}
        className="flex-shrink-0 mt-px p-0.5 rounded text-zinc-600 hover:text-zinc-300 transition-colors"
      >
        <X size={13} strokeWidth={2.5} />
      </button>
    </div>
  );
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
    setToasts(prev => prev.filter(x => x.id !== id));
  }, []);

  // Limpiar timers al desmontar
  useEffect(() => {
    const map = timers.current;
    return () => { map.forEach(clearTimeout); map.clear(); };
  }, []);

  const show = useCallback((variant: Variant, message: string, description?: string) => {
    const id       = Math.random().toString(36).slice(2, 10);
    const duration = variant === 'error' ? 6000 : variant === 'warning' ? 5000 : 4000;

    setToasts(prev => {
      const next = [...prev, { id, message, description, variant, duration }];
      return next.slice(-3);  // máximo 3 visibles
    });

    const t = setTimeout(() => dismiss(id), duration);
    timers.current.set(id, t);
  }, [dismiss]);

  const ctx: ToastCtx = {
    success: (m, d) => show('success', m, d),
    error:   (m, d) => show('error',   m, d),
    warning: (m, d) => show('warning', m, d),
    info:    (m, d) => show('info',    m, d),
  };

  return (
    <Ctx.Provider value={ctx}>
      {children}

      {/* Toaster: fixed bottom-right */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed bottom-5 right-5 z-[9999] pointer-events-none"
        style={{ minWidth: 320, minHeight: toasts.length ? 56 : 0 }}
      >
        <div className="relative flex flex-col gap-2 items-end">
          {toasts.map((t, i) => (
            <div key={t.id} className="pointer-events-auto w-full">
              <Toast
                toast={t}
                onDismiss={dismiss}
                index={toasts.length - 1 - i}   // 0 = más reciente
                total={toasts.length}
              />
            </div>
          ))}
        </div>
      </div>
    </Ctx.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
