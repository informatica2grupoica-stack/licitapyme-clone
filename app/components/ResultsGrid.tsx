'use client';

import Link from 'next/link';
import { Oportunidad, ESTADOS_LICITACION, TIPOS_LICITACION } from '@/app/types/search.types';
import {
  Calendar, Building2, DollarSign, Clock, Star, StarOff,
  ExternalLink, MapPin, Tag, ChevronRight, AlertCircle, Briefcase,
} from 'lucide-react';
import { useFavorites } from '@/app/hooks/useFavorites';
import { useState } from 'react';
import { useSession } from '@/app/lib/session-context';
import { estadoEfectivoCodigo } from '@/app/lib/estado-mp';
import { AsignarNegocioModal } from '@/app/components/AsignarNegocioModal';

interface ResultsGridProps {
  opportunities: Oportunidad[];
  loading?: boolean;
  onFavoriteToggle?: () => void;
}

const formatDate = (d: string) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatCLP = (n?: number) => {
  if (!n) return null;
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
};

const ESTADO_STYLE: Record<string, { label: string; cls: string; dot: string }> = {
  '5':  { label: 'Publicada',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  '6':  { label: 'Cerrada',     cls: 'bg-slate-100 text-gray-600 border-slate-200',         dot: 'bg-gray-400' },
  '7':  { label: 'Desierta',    cls: 'bg-orange-50 text-orange-700 border-orange-200',    dot: 'bg-orange-500' },
  '8':  { label: 'Adjudicada',  cls: 'bg-indigo-50 text-indigo-700 border-indigo-200',          dot: 'bg-indigo-500' },
  '18': { label: 'Revocada',    cls: 'bg-red-50 text-red-700 border-red-200',             dot: 'bg-red-500' },
  '19': { label: 'Suspendida',  cls: 'bg-yellow-50 text-yellow-700 border-yellow-200',   dot: 'bg-yellow-500' },
};

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
      <div className="flex justify-between mb-3">
        <div className="h-4 bg-gray-200 rounded w-2/3" />
        <div className="h-5 bg-slate-100 rounded-full w-20" />
      </div>
      <div className="h-5 bg-gray-200 rounded w-full mb-2" />
      <div className="h-4 bg-slate-100 rounded w-4/5 mb-4" />
      <div className="grid grid-cols-2 gap-3">
        <div className="h-4 bg-slate-100 rounded w-full" />
        <div className="h-4 bg-slate-100 rounded w-full" />
        <div className="h-4 bg-slate-100 rounded w-full" />
        <div className="h-4 bg-slate-100 rounded w-full" />
      </div>
    </div>
  );
}

export function ResultsGrid({ opportunities, loading = false, onFavoriteToggle }: ResultsGridProps) {
  const { isFavorite, toggleFavorite } = useFavorites();
  const { usuario } = useSession();
  const isAdmin = usuario?.rol === 'admin';
  const [toggling, setToggling] = useState<string | null>(null);
  // Licitación seleccionada para asignar directamente desde el buscador.
  const [asignarOpp, setAsignarOpp] = useState<Oportunidad | null>(null);

  const handleToggle = async (opp: Oportunidad) => {
    setToggling(opp.codigo);
    await toggleFavorite({
      codigo: opp.codigo,
      nombre: opp.nombre,
      organismo: opp.organismo,
      monto_total: opp.monto_total,
      fecha_cierre: opp.fecha_cierre,
      estado: opp.estado,
    });
    setToggling(null);
    onFavoriteToggle?.();
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map(i => <SkeletonCard key={i} />)}
      </div>
    );
  }

  if (opportunities.length === 0) return null;

  return (
    <div className="space-y-3">
      {opportunities.map(opp => {
        // Estado EFECTIVO: si figura "Publicada" pero su cierre ya pasó, se muestra "Cerrada".
        const codigoEfectivo = estadoEfectivoCodigo(opp.estado, opp.fecha_cierre);
        const estado = ESTADO_STYLE[String(codigoEfectivo ?? opp.estado)] || { label: opp.estado, cls: 'bg-slate-100 text-gray-600 border-slate-200', dot: 'bg-gray-400' };
        const fav = isFavorite(opp.codigo);
        const isToggling = toggling === opp.codigo;
        const diasRestantes = opp.dias_cierre ?? -1;
        const monto = formatCLP(opp.monto_total || opp.monto_estimado);
        const tipoLabel = opp.tipo_licitacion ? (TIPOS_LICITACION[opp.tipo_licitacion] || opp.tipo_licitacion) : null;

        return (
          <article
            key={opp.codigo}
            className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all duration-200 overflow-hidden group"
          >
            <div className="p-5">
              {/* Row 1: código + estado + favorito */}
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-100">
                    {opp.codigo}
                  </span>
                  {tipoLabel && (
                    <span className="flex items-center gap-1 text-xs text-purple-600 bg-purple-50 border border-purple-100 px-2 py-0.5 rounded">
                      <Tag size={10} />
                      {opp.tipo_licitacion}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${estado.cls}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${estado.dot}`} />
                    {estado.label}
                  </span>
                  <button
                    onClick={() => handleToggle(opp)}
                    disabled={isToggling}
                    className="p-1 hover:bg-slate-100 rounded-full transition-colors disabled:opacity-50"
                    title={fav ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                  >
                    {fav ? (
                      <Star size={16} className="text-amber-500 fill-amber-500" />
                    ) : (
                      <StarOff size={16} className="text-gray-300 hover:text-gray-500" />
                    )}
                  </button>
                </div>
              </div>

              {/* Título */}
              <Link href={`/licitacion/${encodeURIComponent(opp.codigo)}`}>
                <h3 className="text-base font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors line-clamp-2 mb-1 leading-snug">
                  {opp.nombre}
                </h3>
              </Link>

              {/* Descripción */}
              {opp.descripcion && (
                <p className="text-sm text-gray-500 line-clamp-1 mb-3">{opp.descripcion}</p>
              )}

              {/* Info grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-1.5 gap-x-4 text-sm">
                <div className="flex items-center gap-2 text-gray-600">
                  <Building2 size={13} className="text-gray-400 flex-shrink-0" />
                  <span className="truncate">{opp.organismo}</span>
                </div>

                {opp.region && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <MapPin size={13} className="text-gray-400 flex-shrink-0" />
                    <span className="truncate">{opp.region}</span>
                  </div>
                )}

                <div className="flex items-center gap-2 text-gray-600">
                  <Calendar size={13} className="text-gray-400 flex-shrink-0" />
                  <span>Cierre: <strong>{formatDate(opp.fecha_cierre)}</strong></span>
                </div>

                {monto && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <DollarSign size={13} className="text-gray-400 flex-shrink-0" />
                    <span className="font-medium text-gray-800">{monto}</span>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                {/* Días restantes */}
                {diasRestantes > 0 ? (
                  <div className="flex items-center gap-1.5">
                    <Clock size={13} className={diasRestantes <= 3 ? 'text-red-500' : 'text-orange-400'} />
                    <span className={`text-xs font-semibold ${diasRestantes <= 3 ? 'text-red-600' : 'text-orange-600'}`}>
                      {diasRestantes === 1 ? '1 día' : `${diasRestantes} días`} para cerrar
                    </span>
                    {diasRestantes <= 3 && (
                      <AlertCircle size={12} className="text-red-500" />
                    )}
                  </div>
                ) : diasRestantes === 0 ? (
                  <span className="text-xs font-semibold text-red-600 flex items-center gap-1">
                    <AlertCircle size={12} />
                    Cierra hoy
                  </span>
                ) : (
                  <span className="text-xs text-gray-400">Proceso finalizado</span>
                )}

                <div className="flex items-center gap-2">
                  {isAdmin && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setAsignarOpp(opp); }}
                      className="flex items-center gap-1 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-2.5 py-1 rounded-lg transition-colors"
                      title="Asignar esta licitación a un usuario como negocio"
                    >
                      <Briefcase size={12} /> Asignar
                    </button>
                  )}
                  {opp.url && (
                    <a
                      href={opp.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                      title="Ver en Mercado Público"
                      onClick={e => e.stopPropagation()}
                    >
                      <ExternalLink size={14} />
                    </a>
                  )}
                  <Link
                    href={`/licitacion/${encodeURIComponent(opp.codigo)}`}
                    className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-blue-800 transition-colors"
                  >
                    Ver detalle
                    <ChevronRight size={13} />
                  </Link>
                </div>
              </div>
            </div>
          </article>
        );
      })}

      {/* Asignar a negocio directamente desde el buscador */}
      {asignarOpp && (
        <AsignarNegocioModal
          licitacion={asignarOpp}
          onClose={() => setAsignarOpp(null)}
          onAsignada={() => {}}
        />
      )}
    </div>
  );
}

