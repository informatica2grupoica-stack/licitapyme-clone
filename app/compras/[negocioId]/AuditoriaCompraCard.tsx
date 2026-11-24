'use client';

// AUDITORÍA DE LA COMPRA — el informe completo (costeo → cotización → OC → factura, por proveedor, con la diferencia en pesos y por qué).
// Muestra el MISMO documento que se descarga: un iframe del HTML del informe y un botón que baja el PDF. Solo lectura.
import { useRef, useState } from 'react';
import { Boton } from '@/app/components/ui/kit/Boton';
import { useToast } from '@/app/components/ui/toast';
import { IconDownload as Descargar, IconRefresh as Refrescar } from '@tabler/icons-react';

export function AuditoriaCompraCard({ negocioId }: { negocioId: number }) {
  const [version, setVersion] = useState(0);
  const [bajando, setBajando] = useState(false);
  const [cargado, setCargado] = useState(false);
  const toast = useToast();
  const marco = useRef<HTMLIFrameElement>(null);
  // El informe se ve completo, sin recuadro con scroll propio: el marco crece hasta el alto del documento.
  const ajustar = () => {
    const doc = marco.current?.contentDocument;
    if (doc?.body && marco.current) marco.current.style.height = `${doc.documentElement.scrollHeight + 8}px`;
  };
  const url = `/api/compras/${negocioId}/auditoria`;

  const bajarPdf = async () => {
    setBajando(true);
    try {
      const r = await fetch(`${url}?pdf=1`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'No se pudo generar el PDF.');
      const blob = await r.blob();
      const nombre = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')?.[1] || `Auditoria_${negocioId}.pdf`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = nombre; a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) { toast.error('No se pudo descargar el PDF', e.message); }
    finally { setBajando(false); }
  };

  return (
    <div className="space-y-4" data-testid="auditoria-compra">
      <div className="flex items-end justify-between gap-3 flex-wrap rounded-2xl border border-linea bg-white px-5 py-4 shadow-tarjeta dark:bg-slate-900 dark:border-slate-800">
        <div className="space-y-1 max-w-[62ch]">
          <p className="text-[15px] font-semibold tracking-tight text-tinta dark:text-slate-100">Auditoría de la compra</p>
          <p className="text-[12.5px] text-tinta-2 dark:text-slate-400">Qué se costeó, qué se cotizó, qué se compró a cada proveedor, su orden de compra y su factura. Para cada paso, la diferencia en pesos y por qué se generó. Todo sin IVA.</p>
        </div>
        <div className="flex gap-2">
          <Boton tamano="sm" icono={<Refrescar size={15} />} onClick={() => { setCargado(false); setVersion(v => v + 1); }}>Actualizar</Boton>
          <Boton variante="primario" tamano="sm" icono={<Descargar size={15} />} onClick={bajarPdf} disabled={bajando}>{bajando ? 'Generando PDF…' : 'Descargar PDF'}</Boton>
        </div>
      </div>
      <div className="relative rounded-2xl border border-linea bg-white px-6 py-4 shadow-tarjeta overflow-hidden dark:border-slate-800">
        {!cargado && <p className="absolute inset-0 grid place-items-center text-[12.5px] text-tinta-3">Armando la auditoría…</p>}
        <iframe key={version} title="Auditoría de la compra" src={`${url}?html=1`} ref={marco} scrolling="no" onLoad={() => { setCargado(true); ajustar(); }} className="block w-full h-[70vh] bg-white" />
      </div>
    </div>
  );
}
