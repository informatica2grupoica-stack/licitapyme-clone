// app/licitacion/[codigo]/sections/GestionSection.tsx
'use client';

import { useState, useEffect } from 'react';
import {
  Briefcase, Loader2, X, Star, StarOff, ExternalLink, Settings,
} from 'lucide-react';
import { Oportunidad } from '@/app/types/search.types';
import { useToast } from '@/app/components/ui/toast';
import { InfoCard, SectionHeader } from '../utils';

interface UsuarioAsignacion {
  id: number;
  nombre: string;
  email: string;
}

function AsignarNegocioModal({
  licitacion,
  onClose,
  onAsignada,
}: {
  licitacion: Oportunidad;
  onClose: () => void;
  onAsignada: () => void;
}) {
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
        toastSuccess('Licitación asignada', `Asignada a ${u?.nombre || 'usuario'}`);
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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] z-50 flex items-center justify-center p-4 overlay-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md modal-in">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-indigo-50 rounded-xl flex items-center justify-center">
              <Briefcase size={16} className="text-indigo-600" />
            </div>
            <div>
              <h3 className="text-[13px] font-bold text-slate-800">Asignar a Negocio</h3>
              <p className="text-[11px] text-slate-500">Selecciona el responsable</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
            <X size={16} className="text-slate-500" />
          </button>
        </div>

        <div className="px-6 py-3 bg-slate-50 border-b border-slate-100">
          <p className="text-[10px] font-mono text-slate-400 mb-0.5">{licitacion.codigo}</p>
          <p className="text-[13px] font-semibold text-slate-800 line-clamp-2">{licitacion.nombre}</p>
          <p className="text-xs text-slate-500 mt-0.5">{licitacion.organismo}</p>
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
              <select
                value={asignandoA}
                onChange={e => setAsignandoA(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[13px] text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white outline-none"
              >
                <option value="">— Selecciona un usuario —</option>
                {usuarios.map(u => (
                  <option key={u.id} value={String(u.id)}>
                    {u.nombre || u.email} {u.nombre ? `(${u.email})` : ''}
                  </option>
                ))}
              </select>
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
            {guardando ? 'Asignando...' : 'Asignar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function GestionSection({
  licitacion, isAdmin, isFav, toggling, handleToggleFavorite, mpUrl,
}: {
  licitacion: Oportunidad;
  isAdmin: boolean;
  isFav: boolean;
  toggling: boolean;
  handleToggleFavorite: () => void;
  mpUrl: string;
}) {
  const [asignarOpen, setAsignarOpen] = useState(false);

  return (
    <div className="space-y-4 fade-in">
      <SectionHeader
        icon={<Settings size={18} />}
        title="Gestión"
        subtitle="Asignación a negocio, favoritos y acceso a Mercado Público"
      />

      {asignarOpen && (
        <AsignarNegocioModal
          licitacion={licitacion}
          onClose={() => setAsignarOpen(false)}
          onAsignada={() => {}}
        />
      )}

      <InfoCard title="Favoritos" icon={<Star size={15} />}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] text-slate-600">
            {isFav
              ? 'Esta licitación está en tus favoritos.'
              : 'Agrega esta licitación a tus favoritos para acceder rápido desde el dashboard.'}
          </p>
          <button
            onClick={handleToggleFavorite}
            disabled={toggling}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors flex-shrink-0 disabled:opacity-50 ${
              isFav
                ? 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
            }`}
          >
            {toggling
              ? <Loader2 size={14} className="animate-spin" />
              : isFav ? <StarOff size={14} /> : <Star size={14} />}
            {isFav ? 'Quitar de favoritos' : 'Agregar a favoritos'}
          </button>
        </div>
      </InfoCard>

      {isAdmin && (
        <InfoCard title="Asignación a negocio" icon={<Briefcase size={15} />}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] text-slate-600">
              Asigna esta licitación a un miembro del equipo para darle seguimiento como negocio/oportunidad.
            </p>
            <button
              onClick={() => setAsignarOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-xl transition-colors flex-shrink-0"
            >
              <Briefcase size={14} /> Asignar a Negocio
            </button>
          </div>
        </InfoCard>
      )}

      <InfoCard title="Mercado Público" icon={<ExternalLink size={15} />}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] text-slate-600">
            Revisa la ficha oficial de la licitación, sus adjuntos y el estado actualizado en Mercado Público.
          </p>
          <a
            href={mpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[13px] font-semibold rounded-xl transition-colors flex-shrink-0"
          >
            <ExternalLink size={14} /> Ver en Mercado Público
          </a>
        </div>
      </InfoCard>
    </div>
  );
}
