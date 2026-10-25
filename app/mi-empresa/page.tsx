'use client';

// Configuración de la empresa-cliente: perfil (lo usa la viabilidad) y palabras clave del radar, con sugerencias sacadas
// de lo que vendió en Mercado Público. Es donde aterriza el admin la primera vez que entra.
import { AppLayout } from '@/app/components/AppLayout';
import { ConfigurarEmpresa } from '@/app/components/ConfigurarEmpresa';

export default function MiEmpresaPage() {
  return (
    <AppLayout breadcrumb={[{ label: 'Configura tu empresa' }]}>
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        <header>
          <h1 className="text-lg font-medium text-slate-900">Configura tu empresa</h1>
          <p className="text-sm text-slate-500">Revisamos lo que ya le vendiste al Estado y te proponemos tus palabras clave y tu perfil. Marca lo que sirva, corrige lo que no y guarda.</p>
        </header>
        <ConfigurarEmpresa />
      </div>
    </AppLayout>
  );
}
