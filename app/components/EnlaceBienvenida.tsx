'use client';

// Muestra el enlace de bienvenida para copiarlo. Se ve UNA vez (en la base solo queda su huella).
import { useState } from 'react';

export function EnlaceBienvenida({ ruta, email }: { ruta: string; email: string }) {
  const [copiado, setCopiado] = useState<'si' | 'no' | null>(null);
  const url = typeof window === 'undefined' ? ruta : `${window.location.origin}${ruta}`;
  const copiar = async () => {
    try { await navigator.clipboard.writeText(url); setCopiado('si'); }
    catch { setCopiado('no'); } // sin permiso del portapapeles: el campo queda seleccionable
  };
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-slate-500">Enlace para que <b>{email}</b> cree su clave</p>
      <div className="flex gap-2">
        <input readOnly value={url} aria-label="Enlace de bienvenida" onFocus={e => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900" />
        <button type="button" onClick={copiar} className="shrink-0 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800">{copiado === 'si' ? 'Copiado' : 'Copiar'}</button>
      </div>
      {copiado === 'no' && <p className="text-xs text-red-600">No se pudo copiar solo: selecciona el enlace y cópialo.</p>}
      <p className="text-xs text-slate-500">Sirve una sola vez y vence en 72 horas. Entrégalo solo a esa persona: quien lo tenga puede definir su clave. No se vuelve a mostrar; si se pierde, genera otro.</p>
    </div>
  );
}
