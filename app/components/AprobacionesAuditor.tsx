'use client';

// «Aprobaciones del Auditor» (migration-200): cuándo una opción firmada necesita que otra persona la apruebe.
// Se cambia en DOS lugares sin tocar código: aquí en Mi empresa (admin de la empresa) y en la ficha de /admin/clientes (LICITANK).
// SelectorAprobaciones es solo la parte visual; AprobacionesEmpresa es la sección de Mi empresa.
import { useCallback, useEffect, useState } from 'react';
import { useSession, tieneModulo } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { MODOS_APROBACION, type ModoAprobacion } from '@/app/lib/opciones-empresa-core';

export function SelectorAprobaciones({ valor, onCambio, activaHoy, deshabilitado }: {
  valor: ModoAprobacion; onCambio: (m: ModoAprobacion) => void; activaHoy?: boolean; deshabilitado?: boolean;
}) {
  return (
    <div>
      <div role="radiogroup" aria-label="Aprobaciones del Auditor" className="space-y-1.5">
        {MODOS_APROBACION.map(m => (
          <label key={m.id} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition ${valor === m.id ? 'border-teal-600 bg-teal-50/60 dark:bg-teal-900/10' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'} ${deshabilitado ? 'opacity-60' : ''}`}>
            <input type="radio" name="modo-aprobacion" className="mt-0.5 accent-teal-700" checked={valor === m.id} disabled={deshabilitado} onChange={() => onCambio(m.id)} />
            <span>
              <span className="block text-[13px] font-medium text-slate-800 dark:text-slate-200">{m.titulo}</span>
              <span className="block text-xs text-slate-500">{m.ayuda}</span>
            </span>
          </label>
        ))}
      </div>
      {activaHoy !== undefined && (
        <p className="mt-2 text-xs text-slate-500">Hoy el Auditor <b>{activaHoy ? 'sí pide' : 'no pide'}</b> aprobación en esta empresa.</p>
      )}
    </div>
  );
}

export function AprobacionesEmpresa() {
  const { usuario } = useSession();
  const toast = useToast();
  const aplica = usuario?.rol === 'admin' && !!usuario.clienteId && usuario.clienteId !== 1 && tieneModulo(usuario, 'auditor');
  const [modo, setModo] = useState<ModoAprobacion>('auto');
  const [activa, setActiva] = useState<boolean | undefined>(undefined);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    const r = await fetch('/api/mi-empresa/opciones').then(x => x.json()).catch(() => ({}));
    if (r.opciones) { setModo(r.opciones.aprobaciones_auditor); setActiva(!!r.aprobacionesActivas); }
  }, []);
  useEffect(() => { if (aplica) cargar(); }, [aplica, cargar]);
  if (!aplica) return null;

  const cambiar = async (m: ModoAprobacion) => {
    setOcupado(true);
    try {
      const r = await fetch('/api/mi-empresa/opciones', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ aprobaciones_auditor: m }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error('No se guardó', j.error || `HTTP ${r.status}`); return; }
      setModo(j.opciones.aprobaciones_auditor); setActiva(!!j.aprobacionesActivas);
      toast.success('Guardado');
    } finally { setOcupado(false); }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">Aprobaciones del Auditor</h2>
      <p className="mt-0.5 mb-3 text-sm text-slate-500">Elige si las opciones que firma tu equipo necesitan que otra persona las apruebe.</p>
      <SelectorAprobaciones valor={modo} onCambio={cambiar} activaHoy={activa} deshabilitado={ocupado} />
    </section>
  );
}
