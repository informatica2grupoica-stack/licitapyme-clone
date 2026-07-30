'use client';

// MOTOR COMERCIAL (Auditor Técnico, Fase 4, spec §7) — ingesta del costeo real y las 4 alertas
// obligatorias (discordancia costeo↔anexo, venta bajo costo, sobre presupuesto, error de
// origen). Vive dentro del bloque COMERCIAL de la sección Auditor Técnico.
import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { useConfirm } from '@/app/components/ui/confirm';
import { Upload, Loader2, AlertTriangle, FileSpreadsheet, History, Eye, Download, Trash2 } from 'lucide-react';
import { DocumentViewerModal, type VisorDoc } from '@/app/components/DocumentViewerModal';

interface Alerta { codigo: string; descripcion: string; detalle: string }
interface VersionCosteo {
  id: number; version: number; vigente: boolean; archivo_nombre: string; archivo_url: string | null;
  total_costo_neto: number | null; total_precio_neto: number | null;
  presupuesto_publicado: number | null; total_anexo_economico: number | null;
  alertas: Alerta[]; subido_por_nombre: string | null; subido_at: string;
}

const fmtCLP = (n: number | null) =>
  n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

export function MotorComercialCard({ negocioId, licitacionCodigo }: { negocioId: number; licitacionCodigo: string }) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [vigente, setVigente] = useState<VersionCosteo | null>(null);
  const [historial, setHistorial] = useState<VersionCosteo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState(false);
  const [verHistorial, setVerHistorial] = useState(false);
  const [visorDoc, setVisorDoc] = useState<VisorDoc | null>(null);
  const [eliminando, setEliminando] = useState<number | null>(null);   // id de la versión en curso
  const fileRef = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/negocios/${negocioId}/comercial/costeo`);
      const d = await r.json();
      if (d.success) { setVigente(d.vigente); setHistorial(d.historial || []); }
    } catch { /* silencioso: no bloquear la pestaña por el motor comercial */ }
    finally { setCargando(false); }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);

  const subir = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append('licitacionCodigo', licitacionCodigo);
      fd.append('files', files[0]);
      const rSubida = await fetch('/api/documentos/subir', { method: 'POST', body: fd });
      const dSubida = await rSubida.json();
      if (!rSubida.ok || !dSubida.documentos?.length) { toast.error(dSubida.error || 'No se pudo subir el costeo'); return; }
      const doc = dSubida.documentos[0];

      const r = await fetch(`/api/negocios/${negocioId}/comercial/costeo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: doc.url, nombre: doc.nombre }),
      });
      const d = await r.json();
      if (!r.ok) { toast.error(d.error || 'No se pudo procesar el costeo'); return; }

      const alertas: Alerta[] = d.alertas || [];
      if (alertas.length > 0) toast.warning(`${alertas.length} alerta(s) del motor comercial`, alertas.map(a => a.descripcion).join(' · '));
      else toast.success('Costeo procesado sin alertas');
      cargar();
    } finally {
      setSubiendo(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const eliminarVersion = async (v: VersionCosteo) => {
    const ok = await confirmar({
      titulo: '¿Eliminar esta versión del costeo?',
      mensaje: `v${v.version} · ${v.archivo_nombre}${v.vigente ? ' — es la versión vigente; si hay otra más antigua, esa pasa a vigente.' : ''}`,
      confirmarLabel: 'Eliminar',
      peligro: true,
    });
    if (!ok) return;
    setEliminando(v.id);
    try {
      const r = await fetch(`/api/negocios/${negocioId}/comercial/costeo`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: v.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.error || 'No se pudo eliminar la versión'); return; }
      toast.success('Versión eliminada');
      cargar();
    } finally {
      setEliminando(null);
    }
  };

  if (cargando) return null;

  return (
    <div className="px-4 py-3 border-b border-zinc-100 bg-zinc-50/60">
      <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
        <div className="flex items-center gap-1.5 text-[12px] font-bold text-zinc-700">
          <FileSpreadsheet size={13} className="text-zinc-400" /> Motor Comercial
        </div>
        <div className="flex items-center gap-2">
          {historial.length > 1 && (
            <button onClick={() => setVerHistorial(v => !v)} className="flex items-center gap-1 text-[11px] font-semibold text-zinc-500 hover:text-zinc-800">
              <History size={11} /> {historial.length} versiones
            </button>
          )}
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={e => subir(e.target.files)} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={subiendo}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] font-semibold text-zinc-500 hover:bg-white rounded-lg border border-zinc-200 transition-colors disabled:opacity-50"
          >
            {subiendo ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            {vigente ? 'Subir nueva versión' : 'Subir costeo'}
          </button>
        </div>
      </div>

      {vigente ? (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-zinc-500 mt-1.5">
            <span>Costo: <span className="font-semibold text-zinc-700">{fmtCLP(vigente.total_costo_neto)}</span></span>
            <span>Precio: <span className="font-semibold text-zinc-700">{fmtCLP(vigente.total_precio_neto)}</span></span>
            {vigente.presupuesto_publicado != null && (
              <span>Presupuesto: <span className="font-semibold text-zinc-700">{fmtCLP(vigente.presupuesto_publicado)}</span></span>
            )}
            <span className="text-zinc-400">{vigente.archivo_nombre} · v{vigente.version}{vigente.subido_por_nombre ? ` · ${vigente.subido_por_nombre}` : ''}</span>
            {vigente.archivo_url && (
              <span className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setVisorDoc({ nombre: vigente.archivo_nombre, url: vigente.archivo_url! })}
                  title="Ver el Excel del costeo"
                  className="p-0.5 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                >
                  <Eye size={12} />
                </button>
                <a
                  href={vigente.archivo_url} download={vigente.archivo_nombre}
                  title="Descargar"
                  className="p-0.5 text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors"
                >
                  <Download size={12} />
                </a>
                <button
                  type="button"
                  onClick={() => eliminarVersion(vigente)}
                  disabled={eliminando === vigente.id}
                  title="Eliminar esta versión"
                  className="p-0.5 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors disabled:opacity-50"
                >
                  {eliminando === vigente.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                </button>
              </span>
            )}
          </div>
          {vigente.alertas.length > 0 && (
            <div className="mt-2 space-y-1">
              {vigente.alertas.map(a => (
                <p key={a.codigo} className="text-[11.5px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
                  <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                  <span><span className="font-semibold">{a.descripcion}.</span> {a.detalle}</span>
                </p>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="text-[11.5px] text-zinc-400 mt-1">
          Sin costeo subido todavía — sube la prueba de cotización para cruzar precio, costo y presupuesto.
        </p>
      )}

      {verHistorial && historial.length > 1 && (
        <div className="mt-2 border-t border-zinc-200 pt-2 space-y-1">
          {historial.map(h => (
            <div key={h.id} className="flex items-center justify-between text-[11px] text-zinc-500">
              <span className="inline-flex items-center gap-1">
                v{h.version} · {h.archivo_nombre}{h.subido_por_nombre ? ` · ${h.subido_por_nombre}` : ''}
                {h.archivo_url && (
                  <button
                    type="button"
                    onClick={() => setVisorDoc({ nombre: h.archivo_nombre, url: h.archivo_url! })}
                    title="Ver esta versión"
                    className="p-0.5 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                  >
                    <Eye size={11} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => eliminarVersion(h)}
                  disabled={eliminando === h.id}
                  title="Eliminar esta versión"
                  className="p-0.5 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors disabled:opacity-50"
                >
                  {eliminando === h.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                </button>
              </span>
              <span>{h.alertas.length > 0 ? `${h.alertas.length} alerta(s)` : 'sin alertas'}</span>
            </div>
          ))}
        </div>
      )}

      <DocumentViewerModal doc={visorDoc} onClose={() => setVisorDoc(null)} />
    </div>
  );
}
