'use client';

// Modal compartido para asignar una licitación a un usuario como negocio.
// Se usa desde la ficha de la licitación (GestionSection) y directamente desde
// las tarjetas del buscador (ResultsGrid), sin tener que entrar al detalle.

import { useState, useEffect } from 'react';
import { Briefcase, Loader2, X } from 'lucide-react';
import { Oportunidad } from '@/app/types/search.types';
import { useToast } from '@/app/components/ui/toast';
import { Select } from '@/app/components/ui/Select';

interface UsuarioAsignacion {
  id: number;
  nombre: string;
  email: string;
}

export function AsignarNegocioModal({
  licitacion,
  asignadoNombre = null,
  onClose,
  onAsignada,
}: {
  licitacion: Oportunidad;
  asignadoNombre?: string | null;
  onClose: () => void;
  onAsignada: () => void;
}) {
  const yaAsignada = !!asignadoNombre;
  const [usuarios, setUsuarios] = useState<UsuarioAsignacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [asignandoA, setAsignandoA] = useState('');
  const [guardando, setGuardando] = useState(false);
  const { success: toastSuccess, error: toastError } = useToast();

  useEffect(() => {
    fetch('/api/usuarios')
      .then(r => r.json())
      .then(d => { if (d.success) setUsuarios(d.usuarios || []); })
      .catch(() => {})
      .finally(() => setCargando(false));
  }, []);

  // Escape cierra + scroll-lock del fondo (mismo patrón que DocumentViewerModal).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const handleAsignar = async () => {
    if (!asignandoA) return;
    setGuardando(true);
    try {
      const res = await fetch('/api/negocios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licitacion_codigo:    licitacion.codigo,
          licitacion_nombre:    licitacion.nombre,
          licitacion_organismo: licitacion.organismo,
          licitacion_monto:     licitacion.monto_total || licitacion.monto_estimado || null,
          licitacion_cierre:    licitacion.fecha_cierre || null,
          licitacion_estado:    licitacion.estado || null,
          licitacion_tipo:      licitacion.tipo_licitacion || null,
          licitacion_region:    licitacion.region || null,
          asignado_a:           parseInt(asignandoA),
        }),
      });
      const data = await res.json();
      if (data.success) {
        const u = usuarios.find(u => String(u.id) === asignandoA);
        toastSuccess(yaAsignada ? 'Licitación reasignada' : 'Licitación asignada', `${yaAsignada ? 'Movida' : 'Asignada'} a ${u?.nombre || 'usuario'}`);
        onAsignada();
        onClose();
      } else {
        toastError('Error al asignar', data.error || 'Intenta de nuevo');
      }
    } catch {
      toastError('Error de conexión', 'No se pudo asignar la licitación');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-[2px] z-50 flex items-center justify-center p-4 overlay-in"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog" aria-modal="true" aria-label="Asignar a Negocio"
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md modal-in">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-indigo-50 rounded-xl flex items-center justify-center">
              <Briefcase size={16} className="text-indigo-600" />
            </div>
            <div>
              <h3 className="text-[13px] font-bold text-slate-800">{yaAsignada ? 'Reasignar Negocio' : 'Asignar a Negocio'}</h3>
              <p className="text-[11px] text-slate-500">Selecciona el responsable</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
            <X size={16} className="text-slate-500" />
          </button>
        </div>

        <div className="px-6 py-3 bg-slate-50 border-b border-slate-100">
          <p className="text-[10px] font-mono text-slate-400 mb-0.5">{licitacion.codigo}</p>
          <p className="text-[13px] font-semibold text-slate-800 line-clamp-2">{licitacion.nombre}</p>
          <p className="text-xs text-slate-500 mt-0.5">{licitacion.organismo}</p>
          {yaAsignada && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mt-2">
              Actualmente asignada a <b>{asignadoNombre}</b>. Al reasignar se <b>mueve</b> al nuevo perfil (deja de estar en el actual).
            </p>
          )}
        </div>

        <div className="px-6 py-4">
          {cargando ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 size={20} className="animate-spin text-indigo-500" />
            </div>
          ) : usuarios.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">No hay usuarios disponibles</p>
          ) : (
            <div className="space-y-2">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Asignar a
              </label>
              <Select
                value={asignandoA}
                onChange={setAsignandoA}
                placeholder="— Selecciona un usuario —"
                options={usuarios.map(u => ({
                  value: String(u.id), label: u.nombre || u.email,
                  description: u.nombre ? u.email : undefined,
                }))} />
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex gap-2 justify-end">
          <button onClick={onClose}
            className="px-4 py-2 text-[13px] text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors font-medium">
            Cancelar
          </button>
          <button
            onClick={handleAsignar}
            disabled={!asignandoA || guardando}
            className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-[13px] font-semibold rounded-xl transition-colors"
          >
            {guardando ? <Loader2 size={14} className="animate-spin" /> : <Briefcase size={14} />}
            {guardando ? (yaAsignada ? 'Reasignando...' : 'Asignando...') : (yaAsignada ? 'Reasignar' : 'Asignar')}
          </button>
        </div>
      </div>
    </div>
  );
}
