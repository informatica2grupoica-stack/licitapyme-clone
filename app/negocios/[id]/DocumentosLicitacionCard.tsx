'use client';

// DOCUMENTACIÓN DEL PROYECTO EN COMPRAS (spec §3.5). Pedido explícito del usuario (11-sep-2026):
// acá NO va todo lo que se descargó de la licitación (anexos sin rellenar, costeo, etc. — eso es
// trabajo de la etapa de postulación) — solo las BASES y el ACTA DE EVALUACIÓN, que es lo que el
// encargado de Compras necesita para cotizar/homologar. Si la licitación no las tiene, no se
// inventa nada: queda vacío y el encargado sube lo que corresponda a mano.
//
// Aparte, sección de subida propia (categoría DOCUMENTOS_PROPIOS — la MISMA que usa "Documentos
// para MP" en la pestaña de la licitación, protegida de la IA en clasificacion.ts): el encargado
// puede arrastrar o elegir varios archivos, quedan listados con opción de borrar.
import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { useConfirm } from '@/app/components/ui/confirm';
import { useCompras } from '@/app/compras/[negocioId]/ComprasContext';
import { IconFileText as FileText, IconLoader2 as Loader2, IconEye as Eye, IconFolderOpen as FolderOpen, IconUpload as Upload, IconTrash as Trash2, IconCloudUpload as UploadCloud, IconSparkles as Sparkles } from '@tabler/icons-react';

interface Documento { nombre: string; url: string; categoria: string | null; fecha: string }

// Los documentos de la licitación NO usan una categoría plana "BASES" — el clasificador
// (app/lib/clasificacion.ts) separa BASES_ADMINISTRATIVAS de BASES_TECNICAS. Las dos cuentan
// como "Bases" acá (confirmado contra documentos_cache real, 11-sep-2026 — un filtro por 'BASES'
// a secas no matcheaba NADA y dejaba la tarjeta vacía aunque las bases sí estuvieran).
const CATS_BASES = ['BASES_ADMINISTRATIVAS', 'BASES_TECNICAS'];
const CATEGORIA_LABEL: Record<string, string> = {
  BASES_ADMINISTRATIVAS: 'Bases administrativas', BASES_TECNICAS: 'Bases técnicas',
  ACTA: 'Acta de evaluación', DOCUMENTOS_PROPIOS: 'Subidos por Compras',
};

export function DocumentosLicitacionCard({ licitacionCodigo }: { licitacionCodigo: string }) {
  const toast = useToast();
  const confirmar = useConfirm();
  const { recargar: recargarCompartido } = useCompras();
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [loading, setLoading] = useState(true);
  // Colapsada por default — vive ARRIBA de las 5 pestañas de Compras (§3-§17, ver ComprasSection.tsx)
  // para estar disponible sin importar en qué etapa del proceso se esté trabajando, pero si viene
  // siempre desplegada empuja todo el resto de la pantalla hacia abajo. Se abre con un click y el
  // contador de la cabecera ya avisa si hay algo adentro.
  const [abierto, setAbierto] = useState(false);
  const [subiendo, setSubiendo] = useState<{ actual: number; total: number } | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragCount = useRef(0);

  const cargar = useCallback(async () => {
    try {
      // Dos fuentes: `documentos_cache` (bases + lo que sube el propio encargado de Compras) y
      // `acta_documento` (acta de evaluación, tabla APARTE — ver app/lib/acta-adjudicacion.ts).
      const [res, resActa] = await Promise.all([
        fetch(`/api/documentos/${encodeURIComponent(licitacionCodigo)}`),
        fetch(`/api/licitacion/acta?codigo=${encodeURIComponent(licitacionCodigo)}`),
      ]);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudieron cargar');
      // Filtro a propósito: acá SOLO Bases (oficial, para cotizar) y lo que suba Compras — nada
      // de anexos sin rellenar, costeo, ni el resto de categorías de la postulación.
      const propios: Documento[] = (data.documentos || [])
        .filter((d: any) => CATS_BASES.includes(d.categoria) || d.categoria === 'DOCUMENTOS_PROPIOS');

      let actaDocs: Documento[] = [];
      try {
        const dataActa = await resActa.json();
        actaDocs = (dataActa?.documentos || [])
          .filter((d: any) => d.url)
          .map((d: any) => ({ nombre: d.nombre, url: d.url, categoria: 'ACTA', fecha: d.fechaAdjunto || '' }));
      } catch { /* sin acta todavía no es un error */ }

      setDocumentos([...actaDocs, ...propios]);
    } catch (e: any) {
      toast.error('No se pudo cargar la documentación del proyecto', e.message);
    } finally {
      setLoading(false);
    }
  }, [licitacionCodigo]);

  useEffect(() => { cargar(); }, [cargar]);

  // Botón "Preparar compra" (pedido explícito del usuario, 15-sep-2026): en vez de que el
  // encargado tenga que notar a mano que faltan Bases/Acta y disparar cada descarga por separado,
  // un solo click reintenta las tres fuentes que ya existían sueltas en el proyecto — bases/anexos
  // desde MP (mismo orquestador que usa el pipeline automático), y lectura + descarga del acta de
  // evaluación (mismos dos pasos que hace el cron `licitacionesEnComprasSinActa` / los botones
  // manuales de acta). Es idempotente: lo que ya está guardado se salta solo, así que no hay
  // problema en apretarlo de nuevo "por si acaso".
  const prepararCompra = async () => {
    setAbierto(true);
    setPreparando(true);
    const notas: string[] = [];
    try {
      try {
        const r = await fetch('/api/documentos/auto-descargar', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ licitacionCodigo, triggerIA: false }),
        });
        const d = await r.json();
        if (r.ok && d.success) {
          notas.push(d.nuevos > 0 ? `${d.nuevos} documento(s) de MP nuevos` : 'Bases/anexos de MP: ya estaban');
        } else {
          notas.push(`Bases/anexos de MP: ${d.error || 'no se pudo'}`);
        }
      } catch { notas.push('Bases/anexos de MP: error de red'); }

      try {
        const rActa = await fetch('/api/licitacion/acta', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ codigo: licitacionCodigo }),
        });
        const dActa = await rActa.json();
        if (rActa.ok && dActa.ok) {
          if (dActa.documentos > 0) {
            const rDesc = await fetch('/api/licitacion/acta', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ codigo: licitacionCodigo, descargar: true }),
            });
            const dDesc = await rDesc.json();
            notas.push(rDesc.ok && dDesc.ok ? `Acta: ${dDesc.descargados} documento(s)` : 'Acta: se leyó pero no se pudo descargar');
          } else {
            notas.push('Acta: sin documentos publicados todavía');
          }
        } else if (rActa.status === 403) {
          notas.push('Acta: requiere un admin');
        } else {
          notas.push(`Acta: ${dActa.error || 'no se pudo leer'}`);
        }
      } catch { notas.push('Acta: error de red'); }

      toast.success('Compra preparada', notas.join(' · '));
      await cargar();
      recargarCompartido();
    } finally {
      setPreparando(false);
    }
  };

  const subirUnArchivo = async (file: File) => {
    if (file.size > 100 * 1024 * 1024) throw new Error(`"${file.name}" supera los 100 MB.`);
    const pres = await fetch('/api/documentos/presign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licitacionCodigo, filename: file.name, contentType: file.type || 'application/octet-stream', size: file.size }),
    });
    const p = await pres.json();
    if (!pres.ok || !p.uploadUrl) throw new Error(p.error || `No se pudo preparar la subida de "${file.name}"`);
    const put = await fetch(p.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    if (!put.ok) throw new Error(`Error subiendo "${file.name}"`);
    const save = await fetch('/api/documentos/guardar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licitacionCodigo, documentoNombre: file.name, url: p.publicUrl, size: file.size, categoria: 'DOCUMENTOS_PROPIOS' }),
    });
    if (!save.ok) throw new Error(`No se pudo registrar "${file.name}"`);
  };

  const subirVarios = async (files: File[]) => {
    if (files.length === 0) return;
    let exitosos = 0;
    const errores: string[] = [];
    for (let i = 0; i < files.length; i++) {
      setSubiendo({ actual: i + 1, total: files.length });
      try { await subirUnArchivo(files[i]); exitosos++; }
      catch (e: any) { errores.push(e?.message || files[i].name); }
    }
    setSubiendo(null);
    if (exitosos > 0) {
      toast.success(exitosos === 1 ? 'Documento subido' : `${exitosos} documentos subidos`);
      setAbierto(true);
      cargar();
      recargarCompartido();
    }
    if (errores.length > 0) toast.error(errores.length === 1 ? 'No se pudo subir el documento' : `No se pudieron subir ${errores.length} documento(s)`, errores.join(' · '));
  };

  const eliminar = async (doc: Documento) => {
    const ok = await confirmar({ titulo: '¿Eliminar documento?', mensaje: `"${doc.nombre}" se eliminará de forma permanente.`, confirmarLabel: 'Eliminar', peligro: true });
    if (!ok) return;
    setOcupado(doc.nombre);
    try {
      const r = await fetch(`/api/documentos/${encodeURIComponent(licitacionCodigo)}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: doc.url, nombre: doc.nombre }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); toast.error(j.error || 'No se pudo eliminar'); return; }
      cargar();
      recargarCompartido();
    } catch { toast.error('Error de red al eliminar'); } finally { setOcupado(null); }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setArrastrando(false); dragCount.current = 0;
    if (e.dataTransfer.files?.length) subirVarios(Array.from(e.dataTransfer.files));
  };
  const onDragEnter = (e: React.DragEvent) => { e.preventDefault(); dragCount.current++; setArrastrando(true); };
  const onDragLeave = (e: React.DragEvent) => { e.preventDefault(); dragCount.current--; if (dragCount.current <= 0) { dragCount.current = 0; setArrastrando(false); } };
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };

  if (loading) return <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>;

  const porCategoria: Record<string, Documento[]> = {};
  for (const d of documentos) (porCategoria[d.categoria || 'OTROS'] ||= []).push(d);
  const subidosPorCompras = porCategoria['DOCUMENTOS_PROPIOS'] || [];
  // Bug real (15-sep-2026): el aviso de "faltan Bases/Acta" comparaba `documentos.length === 0`
  // — la lista COMPLETA, incluyendo lo subido por Compras. Apenas alguien subía un archivo propio
  // (DOCUMENTOS_PROPIOS), el aviso desaparecía aunque Bases y Acta siguieran sin estar. Ahora se
  // calcula solo sobre esas dos categorías, sin que lo propio las tape.
  const faltanBasesOActa = [...CATS_BASES, 'ACTA'].every(cat => !porCategoria[cat]?.length);

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      <div className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-zinc-50 border-b border-zinc-100">
        <button onClick={() => setAbierto(v => !v)} className="flex-1 min-w-0 flex items-center gap-1.5 text-left hover:opacity-80 transition-opacity">
          <p className="text-[12.5px] font-bold text-zinc-700 flex items-center gap-1.5">
            <FolderOpen size={14} /> Documentación del proyecto
            <span className="text-[10.5px] font-bold text-zinc-400 bg-zinc-100 border border-zinc-200 px-1.5 py-0.5 rounded-full">{documentos.length}</span>
          </p>
        </button>
        <button onClick={prepararCompra} disabled={preparando} title="Reintenta traer Bases, Anexos y Acta de evaluación desde Mercado Público — lo que ya está guardado se salta solo"
          className="flex-shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 disabled:opacity-50 px-2.5 py-1.5 rounded-lg transition-colors">
          {preparando ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Preparar compra
        </button>
      </div>
      {abierto && (
        <div>
          {faltanBasesOActa && !subiendo && (
            <p className="px-4 py-3 text-[11.5px] text-amber-600">
              Esta licitación todavía no tiene Bases ni Acta de evaluación descargadas — usa "Preparar compra" arriba o sube lo que corresponda abajo.
            </p>
          )}
          {([...CATS_BASES, 'ACTA'].some(cat => porCategoria[cat]?.length)) ? (
            <div className="divide-y divide-zinc-100 max-h-64 overflow-y-auto">
              {[...CATS_BASES, 'ACTA'].map(cat => (porCategoria[cat]?.length ? (
                <div key={cat}>
                  <p className="px-4 py-1.5 text-[10px] font-bold text-zinc-400 uppercase bg-zinc-50/60">{CATEGORIA_LABEL[cat]}</p>
                  {porCategoria[cat].map((d, i) => (
                    <a key={i} href={d.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center justify-between gap-2 px-4 py-2 hover:bg-zinc-50 transition-colors">
                      <span className="flex items-center gap-1.5 min-w-0 text-[12px] text-zinc-700 truncate">
                        <FileText size={13} className="flex-shrink-0 text-zinc-400" /> {d.nombre}
                      </span>
                      <Eye size={12} className="flex-shrink-0 text-zinc-400" />
                    </a>
                  ))}
                </div>
              ) : null))}
            </div>
          ) : null}

          <div className="px-4 py-3 border-t border-zinc-100 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-bold text-zinc-400 uppercase">{CATEGORIA_LABEL.DOCUMENTOS_PROPIOS}</p>
              <button type="button" onClick={() => fileRef.current?.click()} disabled={!!subiendo}
                className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:bg-zinc-300 px-2.5 py-1.5 rounded-lg transition-colors">
                {subiendo ? <><Loader2 size={12} className="animate-spin" /> Subiendo {subiendo.actual}/{subiendo.total}…</> : <><Upload size={12} /> Subir documento(s)</>}
              </button>
              <input ref={fileRef} type="file" multiple className="hidden"
                onChange={e => { const files = Array.from(e.target.files || []); if (files.length) subirVarios(files); e.target.value = ''; }} />
            </div>

            {subidosPorCompras.length > 0 && (
              <div className="rounded-lg border border-zinc-100 divide-y divide-zinc-100 max-h-48 overflow-y-auto">
                {subidosPorCompras.map((d, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 px-3 py-2">
                    <a href={d.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 min-w-0 text-[12px] text-zinc-700 hover:text-teal-700 truncate">
                      <FileText size={13} className="flex-shrink-0 text-zinc-400" /> {d.nombre}
                      <Eye size={12} className="flex-shrink-0 text-zinc-400" />
                    </a>
                    <button onClick={() => eliminar(d)} disabled={ocupado === d.nombre}
                      className="flex-shrink-0 text-zinc-300 hover:text-rose-600 disabled:opacity-50">
                      {ocupado === d.nombre ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div
              onDrop={onDrop} onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDragOver={onDragOver}
              className={`flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-3 py-4 text-center transition-colors ${
                arrastrando ? 'border-teal-400 bg-teal-50' : 'border-zinc-200 bg-zinc-50/40'
              }`}>
              <UploadCloud size={16} className={arrastrando ? 'text-teal-500' : 'text-zinc-300'} />
              <p className="text-[11px] text-zinc-400">Arrastra archivos acá, o usa "Subir documento(s)"</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
