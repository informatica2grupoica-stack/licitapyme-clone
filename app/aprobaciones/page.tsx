'use client';

// BANDEJA DE APROBACIÓN TRANSVERSAL (Auditor Técnico, Fase 2) — todos los negocios con algo
// pendiente de aprobación (bloque técnico y/o comercial), de todos los asistentes, en un solo
// lugar. Vista propia del asesor/CA — no una sección dentro de cada negocio.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { Banner } from '@/app/components/ui/Banner';
import { useRealtime } from '@/app/lib/use-realtime';
import { ClipboardCheck, Loader2, Inbox } from 'lucide-react';
import { TarjetaNegocioAprobacion, type NegocioAprobacion } from './TarjetaNegocioAprobacion';

export default function AprobacionesPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const router = useRouter();
  const toast = useToast();

  const [negocios, setNegocios] = useState<NegocioAprobacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const puedeVer = usuario?.rol === 'admin' || !!usuario?.permisos?.aprobar_comercial;

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/aprobaciones');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar la bandeja');
      setNegocios(data.negocios || []);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cargandoSesion) return;
    if (!puedeVer) { router.replace('/dashboard'); return; }
    cargar();
  }, [cargandoSesion, puedeVer, router, cargar]);

  useRealtime(cargar);

  const aprobarBloque = async (negocioId: number, bloque: 'TECNICO' | 'COMERCIAL') => {
    try {
      const res = await fetch('/api/aprobaciones', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ negocioId, bloque, accion: 'APROBAR_BLOQUE' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo aprobar');
      setNegocios(data.negocios || []);
      toast.success('Bloque aprobado', bloque === 'TECNICO' ? 'Bloque técnico aprobado.' : 'Bloque comercial aprobado.');
    } catch (e: any) {
      toast.error('No se pudo aprobar', e.message);
    }
  };

  const rechazarBloque = async (negocioId: number, bloque: 'TECNICO' | 'COMERCIAL', comentario: string) => {
    try {
      const res = await fetch('/api/aprobaciones', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ negocioId, bloque, accion: 'RECHAZAR_BLOQUE', comentario }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo rechazar');
      setNegocios(data.negocios || []);
      toast.info('Bloque rechazado', 'Vuelve a la bandeja del asistente con tu comentario.');
    } catch (e: any) {
      toast.error('No se pudo rechazar', e.message);
    }
  };

  if (cargandoSesion || (!puedeVer && loading)) {
    return (
      <AppLayout breadcrumb={[{ label: 'Aprobaciones' }]}>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
        </div>
      </AppLayout>
    );
  }
  if (!puedeVer) return null;

  return (
    <AppLayout breadcrumb={[{ label: 'Aprobaciones' }]}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-violet-50 flex items-center justify-center flex-shrink-0">
            <ClipboardCheck size={17} className="text-violet-600" />
          </div>
          <div>
            <h1 className="text-[16px] font-bold text-zinc-900 leading-tight">Aprobaciones</h1>
            <p className="text-[12px] text-zinc-500">
              {negocios.length === 0 ? 'Sin nada pendiente' : `${negocios.length} negocio(s) con algo por revisar`} · bloque técnico y comercial, de todos los asistentes
            </p>
          </div>
        </div>

        {error && <Banner variante="error" accion={{ label: 'Reintentar', onClick: cargar }}>{error}</Banner>}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
          </div>
        ) : negocios.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
            <Inbox size={28} className="text-zinc-300" />
            <p className="text-[13.5px] font-semibold text-zinc-500">No hay nada esperando tu aprobación</p>
            <p className="text-[12px] text-zinc-400">Cuando un asistente cargue algo en el bloque técnico o comercial de un negocio, aparece acá.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {negocios.map(n => (
              <TarjetaNegocioAprobacion
                key={n.negocioId} negocio={n}
                onAprobarBloque={aprobarBloque} onRechazarBloque={rechazarBloque}
              />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
