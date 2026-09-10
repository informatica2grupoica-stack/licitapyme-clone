'use client';

// MÓDULO DE COMPRAS — detalle de un negocio ganado. Vive como página propia del módulo (no
// como pestaña dentro de la licitación): la licitación termina en la adjudicación, Compras
// empieza ahí. La sección en sí (resumen ejecutivo, OC del cliente, tareas) está en
// ComprasSection.tsx, compartida acá y reutilizable si algún día se necesita embeber de nuevo.
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { ComprasSection } from '@/app/negocios/[id]/ComprasSection';
import { Loader2 } from 'lucide-react';

export default function CompraDetallePage() {
  const params = useParams();
  const router = useRouter();
  const { usuario, cargando: cargandoSesion } = useSession();
  const negocioId = Number(params.negocioId);

  const esAdmin = usuario?.rol === 'admin';
  const puedeVer = esAdmin || !!usuario?.permisos?.compras || !!usuario?.permisos?.aprobar_comercial
    || !!usuario?.permisos?.compras_administracion || !!usuario?.permisos?.compras_bodega;

  useEffect(() => {
    if (cargandoSesion) return;
    if (!puedeVer) router.replace('/dashboard');
  }, [cargandoSesion, puedeVer, router]);

  if (cargandoSesion || !puedeVer) {
    return (
      <AppLayout breadcrumb={[{ label: 'Compras', href: '/compras' }]}>
        <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="w-6 h-6 animate-spin text-zinc-400" /></div>
      </AppLayout>
    );
  }

  return (
    <AppLayout breadcrumb={[{ label: 'Compras', href: '/compras' }, { label: `Negocio #${negocioId}` }]}>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        <ComprasSection negocioId={negocioId} />
      </div>
    </AppLayout>
  );
}
