'use client';

// DOCUMENTACIÓN DEL PROYECTO (spec §3.5 — Paquete de traspaso: "Toda la documentación del proyecto
// | Auditor Técnico congelado"). Compras necesita las bases, anexos y respaldos a mano para
// cotizar, homologar y armar el acta — sin esto, el encargado tendría que ir a buscarlos aparte a
// la pestaña de Documentos de la licitación original. Vista de SOLO LECTURA: subir/organizar sigue
// siendo trabajo de la etapa de postulación, no de Compras.
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { FileText, Loader2, ExternalLink, FolderOpen } from 'lucide-react';

interface Documento { nombre: string; url: string; categoria: string | null; fecha: string }

const CATEGORIA_LABEL: Record<string, string> = {
  BASES: 'Bases', ANEXOS: 'Anexos', ANEXOS_GENERADOS: 'Anexos generados', COSTEO: 'Costeo',
  DOCUMENTOS_PROPIOS: 'Documentos propios', RESULTADO: 'Resultado', OTROS: 'Otros',
  ACTA: 'Acta de adjudicación',
};

export function DocumentosLicitacionCard({ licitacionCodigo }: { licitacionCodigo: string }) {
  const toast = useToast();
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [loading, setLoading] = useState(true);
  const [abierto, setAbierto] = useState(true);

  const cargar = useCallback(async () => {
    try {
      // Dos fuentes distintas: `documentos_cache` (bases + lo que presentamos nosotros) y
      // `acta_documento` (acta de evaluación, tabla APARTE que llena la pestaña "Resultado" de la
      // licitación — ver app/lib/acta-adjudicacion.ts). Sin esto, el acta de evaluación —el
      // documento que explica por qué ganamos— nunca aparecía acá aunque ya estuviera descargada.
      const [res, resActa] = await Promise.all([
        fetch(`/api/documentos/${encodeURIComponent(licitacionCodigo)}`),
        fetch(`/api/licitacion/acta?codigo=${encodeURIComponent(licitacionCodigo)}`),
      ]);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudieron cargar');
      const propios: Documento[] = data.documentos || [];

      let actaDocs: Documento[] = [];
      try {
        const dataActa = await resActa.json();
        // Solo lo que ya tiene copia propia en R2 (`url`): lo detectado-pero-no-bajado se gestiona
        // desde la pestaña "Resultado" (botón "Traer pendiente(s)"), no acá.
        actaDocs = (dataActa?.documentos || [])
          .filter((d: any) => d.url)
          .map((d: any) => ({ nombre: d.nombre, url: d.url, categoria: 'ACTA', fecha: d.fechaAdjunto || '' }));
      } catch { /* sin acta todavía no es un error — la licitación puede no tenerla cargada */ }

      setDocumentos([...actaDocs, ...propios]);
    } catch (e: any) {
      toast.error('No se pudo cargar la documentación del proyecto', e.message);
    } finally {
      setLoading(false);
    }
  }, [licitacionCodigo]);

  useEffect(() => { cargar(); }, [cargar]);

  if (loading) return <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>;
  if (documentos.length === 0) return null;

  const porCategoria: Record<string, Documento[]> = {};
  for (const d of documentos) (porCategoria[d.categoria || 'OTROS'] ||= []).push(d);

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      <button onClick={() => setAbierto(v => !v)} className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-zinc-50 border-b border-zinc-100 hover:bg-zinc-100 transition-colors">
        <p className="text-[12.5px] font-bold text-zinc-700 flex items-center gap-1.5">
          <FolderOpen size={14} /> Documentación del proyecto
          <span className="text-[10.5px] font-bold text-zinc-400 bg-zinc-100 border border-zinc-200 px-1.5 py-0.5 rounded-full">{documentos.length}</span>
        </p>
      </button>
      {abierto && (
        <div className="divide-y divide-zinc-100 max-h-80 overflow-y-auto">
          {Object.entries(porCategoria).map(([cat, docs]) => (
            <div key={cat}>
              <p className="px-4 py-1.5 text-[10px] font-bold text-zinc-400 uppercase bg-zinc-50/60">{CATEGORIA_LABEL[cat] || cat}</p>
              {docs.map((d, i) => (
                <a key={i} href={d.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-between gap-2 px-4 py-2 hover:bg-zinc-50 transition-colors">
                  <span className="flex items-center gap-1.5 min-w-0 text-[12px] text-zinc-700 truncate">
                    <FileText size={13} className="flex-shrink-0 text-zinc-400" /> {d.nombre}
                  </span>
                  <ExternalLink size={12} className="flex-shrink-0 text-zinc-400" />
                </a>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
