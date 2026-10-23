'use client';

// Aviso cuando una empresa-cliente entra a algo que no tiene contratado (proxy.ts la manda aquí) o cuando su servicio está
// suspendido/vencido. La activación la hace el superusuario de LICITANK; aquí solo se explica qué pasó.
import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { IconLock as Lock } from '@tabler/icons-react';
import { AppLayout } from '@/app/components/AppLayout';
import { NOMBRE_MODULO, type Modulo } from '@/app/lib/modulos';

function Contenido() {
  const params = useSearchParams();
  const modulo = params.get('m') as Modulo | null;
  const suspendido = params.get('suspendido') === '1';
  const nombre = modulo && NOMBRE_MODULO[modulo] ? NOMBRE_MODULO[modulo] : null;

  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center">
      <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-500">
        <Lock size={22} />
      </div>
      <h1 className="text-xl font-semibold text-gray-900">
        {suspendido ? 'El servicio de tu empresa no está activo' : nombre ? `${nombre} no está incluido en tu plan` : 'Esta sección no está incluida en tu plan'}
      </h1>
      <p className="mt-2 text-sm text-gray-600">
        {suspendido
          ? 'Tu cuenta está suspendida o vencida. Escríbenos y la reactivamos.'
          : 'Si quieres sumarla, escríbenos y la activamos en tu cuenta.'}
      </p>
      <Link href="/dashboard" className="mt-6 inline-block rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800">
        Volver al inicio
      </Link>
    </div>
  );
}

export default function ModuloBloqueadoPage() {
  return (
    <AppLayout>
      <Suspense fallback={null}><Contenido /></Suspense>
    </AppLayout>
  );
}
