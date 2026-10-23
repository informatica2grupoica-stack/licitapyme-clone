'use client';

// Perfil de la empresa-cliente (qué vende). Lo usa la viabilidad IA para decidir si una licitación le conviene.
import { AppLayout } from '@/app/components/AppLayout';
import { PerfilEmpresaForm } from '@/app/components/PerfilEmpresaForm';

export default function MiEmpresaPage() {
  return (
    <AppLayout breadcrumb={[{ label: 'Perfil de mi empresa' }]}>
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        <header>
          <h1 className="text-lg font-medium text-slate-900">Perfil de mi empresa</h1>
          <p className="text-sm text-slate-500">Cuéntanos qué vende. La IA lo usa para decirte si una licitación te conviene: mientras más claro, más acertado.</p>
        </header>
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><PerfilEmpresaForm /></section>
      </div>
    </AppLayout>
  );
}
