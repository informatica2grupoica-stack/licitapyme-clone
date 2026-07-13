// app/licitacion/[codigo]/sections/GestionSection.tsx
'use client';

import { useState } from 'react';
import {
  Briefcase, Loader2, Star, StarOff, ExternalLink, Settings, UserCheck,
} from 'lucide-react';
import { Oportunidad } from '@/app/types/search.types';
import { AsignarNegocioModal } from '@/app/components/AsignarNegocioModal';
import { InfoCard, SectionHeader } from '../utils';

export function GestionSection({
  licitacion, isAdmin, isFav, toggling, handleToggleFavorite, mpUrl,
  asignadoNombre = null, onAsignacionCambiada,
}: {
  licitacion: Oportunidad;
  isAdmin: boolean;
  isFav: boolean;
  toggling: boolean;
  handleToggleFavorite: () => void;
  mpUrl: string;
  // ¿A qué perfil está asignada? (lo resuelve la página; una sola asignación por licitación).
  asignadoNombre?: string | null;
  onAsignacionCambiada?: () => void;
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
          asignadoNombre={asignadoNombre}
          onClose={() => setAsignarOpen(false)}
          onAsignada={() => onAsignacionCambiada?.()}
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
            <div className="min-w-0">
              {asignadoNombre ? (
                <p className="text-[13px] text-slate-600 flex items-center gap-1.5 flex-wrap">
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                    <UserCheck size={11} /> {asignadoNombre}
                  </span>
                  Reasignar la <b>mueve</b> a otro perfil (deja de estar en el actual).
                </p>
              ) : (
                <p className="text-[13px] text-slate-600">
                  Asigna esta licitación a un miembro del equipo para darle seguimiento como negocio/oportunidad.
                </p>
              )}
            </div>
            <button
              onClick={() => setAsignarOpen(true)}
              className={`flex items-center gap-2 px-4 py-2 text-white text-[13px] font-semibold rounded-xl transition-colors flex-shrink-0 ${
                asignadoNombre ? 'bg-amber-600 hover:bg-amber-700' : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
            >
              <Briefcase size={14} /> {asignadoNombre ? 'Reasignar' : 'Asignar a Negocio'}
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
