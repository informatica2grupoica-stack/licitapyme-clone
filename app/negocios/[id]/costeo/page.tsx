'use client';

// COSTEO EN PESTAÑA PROPIA (/negocios/[id]/costeo).
//
// El editor de costeo vive dentro de la ficha del negocio, en pantalla completa sobre todo lo
// demás. Eso obligaba a cerrarlo —guardando— cada vez que había que mirar un dato de la viabilidad,
// y volver a abrirlo (pedido del usuario, 04-sep-2026). Con esta ruta el costeo es un link: se abre
// en otra pestaña, la viabilidad queda abierta en la primera y se trabaja mirando las dos.
//
// La página solo resuelve el código de la licitación (lo necesita la cabecera del editor) y monta
// el MISMO componente en modo `standalone`: no hay una segunda copia del costeo que mantener.

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, AlertCircle, ArrowLeft } from 'lucide-react';
import { CosteoEditorCard } from '../CosteoEditorCard';

export default function CosteoStandalonePage() {
  const params = useParams();
  const id = Number(params.id);
  const [codigo, setCodigo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(id)) { setError('Negocio inválido'); return; }
    let vivo = true;
    (async () => {
      try {
        const r = await fetch(`/api/negocios/${id}`);
        const d = await r.json();
        if (!vivo) return;
        if (!r.ok) throw new Error(d.error || 'No encontrado');
        setCodigo(d.negocio?.licitacion_codigo || '');
      } catch (e: any) {
        if (vivo) setError(e.message || 'No se pudo cargar el negocio');
      }
    })();
    return () => { vivo = false; };
  }, [id]);

  useEffect(() => {
    if (codigo) document.title = `Costeo · ${codigo}`;
  }, [codigo]);

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-center px-6">
        <AlertCircle size={22} className="text-rose-500" />
        <p className="text-[13px] font-semibold text-zinc-700">{error}</p>
        <Link href={`/negocios/${id}`} className="flex items-center gap-1.5 text-[12px] font-semibold text-indigo-700 hover:underline">
          <ArrowLeft size={13} /> Volver al negocio
        </Link>
      </div>
    );
  }

  if (codigo === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-zinc-400" />
      </div>
    );
  }

  // El editor se dibuja en un portal a pantalla completa; este contenedor solo da aire a los
  // estados en que todavía no llega ahí (cargando, sin ítems, migración pendiente).
  return (
    <div className="p-6">
      <CosteoEditorCard negocioId={id} licitacionCodigo={codigo} standalone />
    </div>
  );
}
