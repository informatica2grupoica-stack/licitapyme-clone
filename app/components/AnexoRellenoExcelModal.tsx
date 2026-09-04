'use client';

// Pantalla de relleno del anexo económico cuando viene como .xlsx del organismo — hermana de
// AnexoRellenoModal (para .docx), pero mucho más simple: acá solo hay una tabla de precios, no
// párrafos ni checkboxes. Motor separado (anexos-excel-precios.ts / /api/anexos/*-xlsx), pedido
// explícito del usuario: Word, PDF y Excel no comparten un solo camino.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, AlertTriangle, Wand2, FileSpreadsheet, Check, Calculator, CalendarClock } from 'lucide-react';
import { useToast } from '@/app/components/ui/toast';

export interface AnexoXlsxDoc { id: number; nombre: string; url: string }

interface FilaAnalisis {
  fila: number;
  texto: string;
  match: { itemDescripcion: string; precioUnitario: number } | null;
}

interface CampoSuelto { texto: string; valor: string }

interface Analisis {
  nombre: string;
  tabla: { hoja: string; encabezadoPrecio: string; filas: FilaAnalisis[] } | null;
  aviso?: string;
  pieDetectado: boolean;
  camposSueltos: CampoSuelto[];
  sinCosteo: boolean;
}

const fmt = (n: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

export function AnexoRellenoExcelModal({
  doc, codigo, onClose, onGenerado,
}: {
  doc: AnexoXlsxDoc | null;
  codigo: string;
  onClose: () => void;
  onGenerado: (archivo: { nombre: string; url: string }) => void;
}) {
  const toast = useToast();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analisis, setAnalisis] = useState<Analisis | null>(null);
  const [excluidas, setExcluidas] = useState<Set<number>>(new Set());
  const [generando, setGenerando] = useState(false);

  useEffect(() => {
    if (!doc) return;
    setCargando(true);
    setError(null);
    setAnalisis(null);
    setExcluidas(new Set());

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const params = new URLSearchParams({ codigo, documentoId: String(doc.id) });
    fetch(`/api/anexos/analizar-xlsx?${params}`)
      .then(async r => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.success) throw new Error(data.error || 'No se pudo analizar el documento');
        setAnalisis(data);
      })
      .catch(e => setError(e?.message || 'Error al analizar el documento'))
      .finally(() => setCargando(false));

    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
  }, [doc, codigo, onClose]);

  if (!doc) return null;

  const filas = analisis?.tabla?.filas || [];
  const conMatch = filas.filter(f => f.match && !excluidas.has(f.fila));

  const toggleExcluida = (fila: number) => {
    setExcluidas(prev => {
      const next = new Set(prev);
      if (next.has(fila)) next.delete(fila); else next.add(fila);
      return next;
    });
  };

  const generar = async () => {
    setGenerando(true);
    try {
      const r = await fetch('/api/anexos/generar-xlsx', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo, documentoId: doc.id, excluirFilas: [...excluidas] }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.success) {
        toast.error(data.error || 'No se pudo generar el anexo');
        setGenerando(false);
        return;
      }
      const extras = [
        data.camposSueltos > 0 ? `${data.camposSueltos} campo(s) de texto` : null,
        data.pieCorregido ? 'totales corregidos' : null,
      ].filter(Boolean).join(', ');
      toast.success(`Anexo generado — ${data.completados} precio${data.completados === 1 ? '' : 's'} completado${data.completados === 1 ? '' : 's'}${extras ? ` · ${extras}` : ''}`);
      onGenerado(data.archivo);
      onClose();
    } catch (e: any) {
      toast.error(e?.message || 'Error de red al generar el anexo');
      setGenerando(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2 min-w-0">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900 truncate">{doc.nombre}</h2>
              <p className="text-xs text-slate-500">Anexo económico (Excel) — precio unitario desde el costeo</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {cargando && (
            <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
              <Loader2 className="w-5 h-5 animate-spin" /> Analizando el Excel…
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}
          {!cargando && !error && analisis?.aviso && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 text-amber-800 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {analisis.aviso}
            </div>
          )}
          {!cargando && !error && analisis?.sinCosteo && filas.length > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 text-amber-800 text-sm mb-3">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> Esta licitación no tiene costeo cargado — no hay con qué cruzar los precios.
            </div>
          )}
          {!cargando && !error && filas.length > 0 && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Producto</th>
                    <th className="text-right px-3 py-2 font-medium">{analisis?.tabla?.encabezadoPrecio}</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filas.map(f => {
                    const excluida = excluidas.has(f.fila);
                    return (
                      <tr key={f.fila} className={excluida ? 'opacity-40' : ''}>
                        <td className="px-3 py-2 text-slate-800">{f.texto}</td>
                        <td className="px-3 py-2 text-right font-medium">
                          {f.match ? fmt(f.match.precioUnitario) : <span className="text-slate-400 font-normal">sin match — revisar a mano</span>}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {f.match && (
                            <button
                              type="button" onClick={() => toggleExcluida(f.fila)}
                              title={excluida ? 'Volver a incluir' : 'No completar esta fila'}
                              className={`p-1 rounded ${excluida ? 'text-slate-300 hover:text-slate-500' : 'text-emerald-600 hover:bg-emerald-50'}`}
                            >
                              <Check className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!cargando && !error && (analisis?.pieDetectado || (analisis?.camposSueltos?.length ?? 0) > 0) && (
            <div className="mt-3 space-y-2">
              {analisis?.pieDetectado && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-sky-50 text-sky-800 text-sm">
                  <Calculator className="w-4 h-4 mt-0.5 shrink-0" />
                  Al generar también se corrigen las fórmulas de Sumatoria/IVA/Total Bruto, para que
                  sean consistentes entre sí (el formulario de este organismo trae una fórmula de
                  totales mal encadenada).
                </div>
              )}
              {analisis?.camposSueltos?.map((c, i) => (
                <div key={i} className="flex items-start gap-2 p-3 rounded-lg bg-sky-50 text-sky-800 text-sm">
                  <CalendarClock className="w-4 h-4 mt-0.5 shrink-0" />
                  También se completa: <strong>&quot;{c.texto.trim()}&quot;</strong> con <strong>{c.valor}</strong> (dato ya aprobado en el Auditor Técnico).
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 bg-slate-50">
          <span className="text-xs text-slate-500">
            {conMatch.length} de {filas.length} producto{filas.length === 1 ? '' : 's'} con precio
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200 rounded-lg">
              Cancelar
            </button>
            <button
              type="button" onClick={generar}
              disabled={generando || cargando || (conMatch.length === 0 && !analisis?.pieDetectado && !analisis?.camposSueltos?.length)}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg"
            >
              {generando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              Generar
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
