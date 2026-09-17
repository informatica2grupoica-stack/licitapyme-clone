'use client';

// MÓDULO DE COMPRAS — detalle de un negocio ganado. UNA SOLA pantalla (11-sep-2026, quinta vuelta):
// el usuario probó páginas separadas por submódulo y no era lo que quería — "quiero que todo el
// sistema de compras sea un flujo, ir paso a paso... sin pinchar y navegar a otra pantalla".
// Confirmado explícito: una sola URL, stepper arriba, contenido cambia con estado local. Ver
// ComprasChrome.tsx (todo el contenido) y ComprasContext.tsx (el fetch compartido).
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { ComprasProvider } from './ComprasContext';
import { ComprasChrome } from './ComprasChrome';
import { IconLoader2 as Loader2 } from '@tabler/icons-react';

export default function CompraDetallePage() {
  const params = useParams();
  const router = useRouter();
  const { usuario, cargando: cargandoSesion } = useSession();
  const negocioId = Number(params.negocioId);

  // "Ser admin" ya no alcanza solo (pedido explícito, 10-sep-2026) — mismo criterio que el backend
  // (app/api/compras/[negocioId]/route.ts).
  const puedeVer = !!usuario?.permisos?.compras_todo || !!usuario?.permisos?.compras || !!usuario?.permisos?.aprobar_comercial
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
      <div className="p-4 sm:p-6 w-full max-w-[1800px] mx-auto">
        <ComprasProvider negocioId={negocioId}>
          <ComprasChrome negocioId={negocioId} />
        </ComprasProvider>
      </div>
    </AppLayout>
  );
}
