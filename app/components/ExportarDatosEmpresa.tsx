'use client';

// «Tus datos» (Ley 21.719: acceso y portabilidad): el admin de una empresa-cliente descarga todo lo que LICITANK guarda de su empresa.
import { useState } from 'react';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';

export function ExportarDatosEmpresa() {
  const { usuario } = useSession();
  const toast = useToast();
  const [ocupado, setOcupado] = useState(false);
  const aplica = usuario?.rol === 'admin' && !!usuario.clienteId && usuario.clienteId !== 1;
  if (!aplica) return null;

  const descargar = async () => {
    setOcupado(true);
    try {
      const r = await fetch('/api/mi-empresa/exportar');
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        toast.error('No se pudo exportar', d.error || `Error ${r.status}`);
        return;
      }
      const blob = await r.blob();
      const nombre = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')?.[1] || 'licitank-mis-datos.json';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success('Datos exportados', 'El archivo se descargó en tu equipo.');
    } catch {
      toast.error('No se pudo exportar', 'Error de conexión. Intenta de nuevo.');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="font-medium text-slate-900">Tus datos</h2>
      <p className="mt-1 text-sm text-slate-500">
        Descarga todo lo que LICITANK guarda de tu empresa (negocios, comentarios, costeos, personas de tu equipo, configuración y más) en un archivo JSON.
        No incluye contraseñas ni claves de tus integraciones. Puedes pedirlo una vez cada 10 minutos.
      </p>
      <button type="button" onClick={descargar} disabled={ocupado}
        className="mt-3 rounded-lg border border-slate-300 px-3.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
        {ocupado ? 'Preparando…' : 'Descargar mis datos'}
      </button>
    </section>
  );
}
