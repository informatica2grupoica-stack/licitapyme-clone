'use client';

// Pantalla de relleno de un anexo de oferente: a la izquierda el documento REAL (visor de
// Office Online, el mismo que usa el ojo "Ver" en Documentos), a la derecha el formulario con
// lo que se completó solo y los campos que le faltan a un humano — para que se pueda mirar el
// Word mientras se llena, en vez de adivinar a ciegas desde un fragmento de texto corto. Al
// generar, el .docx final se sube a R2 y queda registrado como documento propio — aparece en
// "Documentos para MP" (misma lista que el costeo/informe generados).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, CheckCircle2, AlertTriangle, Wand2, FileText, ExternalLink } from 'lucide-react';
import { useToast } from '@/app/components/ui/toast';

export interface AnexoDoc { id: number; nombre: string; url: string }

interface CampoCompletado { etiqueta: string; campo: string; valor: string; via: 'diccionario' | 'ia' }
interface PendienteCelda { id: string; etiqueta: string; formulario?: string }
interface PendienteInline { id: string; contexto: string; formulario?: string }
interface CeldaTablaUI { texto: string; auto?: { valor: string; via: 'diccionario' | 'ia' }; input?: { id: string } }
interface TablaUI { filas: CeldaTablaUI[][]; formulario?: string }

interface Analisis {
  completadosAuto: CampoCompletado[];
  pendientesCelda: PendienteCelda[];
  pendientesInline: PendienteInline[];
  tablas: TablaUI[];
  firma: { detectada: boolean; disponible: boolean };
}

// Vista de tabla REAL: mismas filas/columnas que el Word, para que quede claro a qué celda
// corresponde cada input (pedido explícito del usuario tras probar la lista plana con un anexo
// económico real de 160 blancos sueltos — imposible saber cuál era cuál sin esto).
function TablaReal({
  tabla, respuestas, onChange,
}: { tabla: TablaUI; respuestas: Record<string, string>; onChange: (id: string, v: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-[11.5px] border-collapse">
        <tbody>
          {tabla.filas.map((fila, i) => (
            <tr key={i} className={i === 0 ? 'bg-slate-100' : 'odd:bg-white even:bg-slate-50/60'}>
              {fila.map((c, j) => (
                <td key={j} className={`border border-slate-200 px-2 py-1 align-middle whitespace-nowrap ${i === 0 ? 'font-semibold text-slate-700' : ''}`}>
                  {c.input ? (
                    <input
                      type="text"
                      value={respuestas[c.input.id] || ''}
                      onChange={e => onChange(c.input!.id, e.target.value)}
                      placeholder="…"
                      className="w-full min-w-[80px] text-[11.5px] px-1.5 py-1 border border-indigo-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
                    />
                  ) : c.auto ? (
                    <span
                      className="inline-flex items-center gap-1 text-emerald-700 font-medium"
                      title={c.auto.via === 'ia' ? 'Completado por IA' : 'Completado automático'}
                    >
                      {c.auto.valor}
                    </span>
                  ) : (
                    <span className="text-slate-700">{c.texto}</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Un pendiente unificado (celda o blanco inline) con la etiqueta ya lista para mostrar — usado
// para agrupar por formulario cuando el documento trae varios pegados (ver anexos-dividir.ts).
interface PendienteUnificado { id: string; etiqueta: string; formulario?: string }

function limpiarTituloFormulario(t: string): string {
  return t.replace(/[.:]+$/, '').trim();
}

function CampoInput({ etiqueta, valor, onChange }: { etiqueta: string; valor: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[11.5px] font-medium text-slate-600 mb-1 truncate" title={etiqueta}>
        {etiqueta}
      </label>
      <input
        type="text"
        value={valor}
        onChange={e => onChange(e.target.value)}
        placeholder="Escribe el valor…"
        className="w-full text-[12.5px] px-2.5 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
      />
    </div>
  );
}

export function AnexoRellenoModal({
  doc, codigo, empresaId, onClose, onGenerado,
}: {
  doc: AnexoDoc | null;
  codigo: string;
  empresaId: number | null;
  onClose: () => void;
  onGenerado: () => void;
}) {
  const toast = useToast();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analisis, setAnalisis] = useState<Analisis | null>(null);
  const [respuestas, setRespuestas] = useState<Record<string, string>>({});
  const [generando, setGenerando] = useState(false);
  const [cargandoVisor, setCargandoVisor] = useState(true);

  useEffect(() => {
    if (!doc) return;
    setCargando(true);
    setError(null);
    setAnalisis(null);
    setRespuestas({});
    setCargandoVisor(true);

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    if (!empresaId) {
      setCargando(false);
      setError('Esta licitación no tiene una empresa asignada. Asígnala en «Información Comercial» antes de rellenar anexos.');
      return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
    }

    const params = new URLSearchParams({ codigo, documentoId: String(doc.id), empresaId: String(empresaId) });
    fetch(`/api/anexos/analizar?${params}`)
      .then(async r => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.success) throw new Error(data.error || 'No se pudo analizar el documento');
        setAnalisis(data);
      })
      .catch(e => setError(e.message || 'Error al analizar el documento'))
      .finally(() => setCargando(false));

    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
  }, [doc, codigo, empresaId, onClose]);

  if (!doc) return null;

  const totalInputsTabla = (analisis?.tablas || []).reduce(
    (acc, t) => acc + t.filas.reduce((a2, f) => a2 + f.filter(c => c.input).length, 0), 0,
  );
  const totalPendientes = (analisis?.pendientesCelda.length || 0) + (analisis?.pendientesInline.length || 0) + totalInputsTabla;
  const totalRespondidas = Object.values(respuestas).filter(v => v.trim()).length;

  // Unifica celdas + blancos inline en una sola lista, y agrupa por formulario (igual que las
  // tablas reales) cuando el documento trae varios pegados. Si NINGÚN pendiente tiene
  // formulario (caso común: un solo formulario), queda todo en "sinFormulario"/"tablasSinFormulario"
  // y se muestra como antes, sin encabezados extra.
  const pendientesTodos: PendienteUnificado[] = analisis ? [
    ...analisis.pendientesCelda.map(p => ({ id: p.id, etiqueta: p.etiqueta, formulario: p.formulario })),
    ...analisis.pendientesInline.map(p => ({ id: p.id, etiqueta: `…${p.contexto}____`, formulario: p.formulario })),
  ] : [];
  const gruposFormulario: { titulo: string; items: PendienteUnificado[]; tablas: TablaUI[] }[] = [];
  const sinFormulario: PendienteUnificado[] = [];
  const tablasSinFormulario: TablaUI[] = [];
  const grupoDe = (titulo: string) => {
    let grupo = gruposFormulario.find(g => g.titulo === titulo);
    if (!grupo) { grupo = { titulo, items: [], tablas: [] }; gruposFormulario.push(grupo); }
    return grupo;
  };
  for (const p of pendientesTodos) {
    if (!p.formulario) { sinFormulario.push(p); continue; }
    grupoDe(p.formulario).items.push(p);
  }
  for (const t of analisis?.tablas || []) {
    if (!t.formulario) { tablasSinFormulario.push(t); continue; }
    grupoDe(t.formulario).tablas.push(t);
  }
  const hayFormularios = gruposFormulario.length > 0;

  const handleGenerar = async () => {
    setGenerando(true);
    try {
      const r = await fetch('/api/anexos/generar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo, documentoId: doc.id, empresaId, respuestas }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.success) throw new Error(data.error || 'No se pudo generar el documento');
      const resumenCampos = `${data.completados} campo${data.completados !== 1 ? 's' : ''} automático${data.completados !== 1 ? 's' : ''} · ${data.respondidos} manual${data.respondidos !== 1 ? 'es' : ''}`;
      toast.success(
        data.dividido ? `${data.archivos?.length || 0} formularios generados` : 'Anexo generado',
        `${resumenCampos} — disponible${data.dividido ? 's' : ''} en Documentos para MP`,
      );
      onGenerado();
      onClose();
    } catch (e: any) {
      toast.error('No se pudo generar el anexo', e.message);
    } finally {
      setGenerando(false);
    }
  };

  const setRespuesta = (id: string, v: string) => setRespuestas(prev => ({ ...prev, [id]: v }));

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-3"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Rellenar anexo: ${doc.nombre}`}
    >
      <div
        className="flex flex-col w-full max-w-[1400px] h-[92vh] bg-white rounded-2xl overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-slate-50 flex-shrink-0">
          <Wand2 size={16} className="text-indigo-600 flex-shrink-0" />
          <p className="flex-1 min-w-0 text-[13px] font-semibold text-slate-800 truncate" title={doc.nombre}>
            {doc.nombre}
          </p>
          <a
            href={doc.url} target="_blank" rel="noopener noreferrer"
            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
            title="Abrir en pestaña nueva"
          >
            <ExternalLink size={15} />
          </a>
          <button
            type="button" onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Cuerpo: visor del documento a la izquierda, formulario a la derecha */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
          {/* Visor — mismo mecanismo que el ojo "Ver" en Documentos (Office Online embed) */}
          <div className="relative w-full lg:w-1/2 h-64 lg:h-full bg-slate-100 border-b lg:border-b-0 lg:border-r border-slate-200 flex-shrink-0">
            {cargandoVisor && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-slate-500 pointer-events-none">
                <Loader2 size={16} className="animate-spin text-indigo-500" /> Cargando documento…
              </div>
            )}
            <iframe
              src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(doc.url)}`}
              title={doc.nombre}
              className="w-full h-full border-0"
              onLoad={() => setCargandoVisor(false)}
            />
          </div>

          {/* Formulario */}
          <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {cargando && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin text-indigo-500" /> Analizando documento…
            </div>
          )}

          {!cargando && error && (
            <div className="flex items-start gap-2.5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
              <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-[12.5px] text-amber-800">{error}</p>
            </div>
          )}

          {!cargando && !error && analisis && (
            <>
              {analisis.firma.detectada && !analisis.firma.disponible && (
                <div className="flex items-start gap-2.5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-[12.5px] text-amber-800">
                    Este documento tiene línea de firma, pero la empresa no tiene una firma escaneada cargada — la línea queda en blanco.
                    Súbela en <strong>/empresas</strong> (sección "Firma escaneada") para que se inserte sola la próxima vez.
                  </p>
                </div>
              )}

              {analisis.completadosAuto.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider flex items-center gap-1">
                    <CheckCircle2 size={12} /> Se completa solo ({analisis.completadosAuto.length})
                  </p>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 divide-y divide-emerald-100">
                    {analisis.completadosAuto.map((c, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 px-3 py-1.5 text-[12px]">
                        <span className="text-emerald-800 font-medium truncate flex items-center gap-1.5">
                          {c.etiqueta}
                          {c.via === 'ia' && (
                            <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700" title="Completado por IA (no por match exacto del diccionario)">
                              IA
                            </span>
                          )}
                        </span>
                        <span className="text-emerald-700 truncate">{c.valor}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {totalPendientes === 0 && analisis.completadosAuto.length > 0 && (
                <p className="text-[12px] text-slate-400">No quedan campos pendientes por completar a mano.</p>
              )}

              {hayFormularios ? (
                <>
                  {gruposFormulario.map(g => (
                    <div key={g.titulo} className="space-y-2">
                      <p className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider border-b border-indigo-100 pb-1">
                        {limpiarTituloFormulario(g.titulo)} ({g.items.length + g.tablas.reduce((a, t) => a + t.filas.reduce((a2, f) => a2 + f.filter(c => c.input).length, 0), 0)})
                      </p>
                      {g.tablas.map((t, i) => (
                        <TablaReal key={i} tabla={t} respuestas={respuestas} onChange={setRespuesta} />
                      ))}
                      {g.items.length > 0 && (
                        <div className="space-y-2">
                          {g.items.map(p => (
                            <CampoInput key={p.id} etiqueta={p.etiqueta} valor={respuestas[p.id] || ''} onChange={v => setRespuesta(p.id, v)} />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {(sinFormulario.length > 0 || tablasSinFormulario.length > 0) && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                        Otros campos ({sinFormulario.length + tablasSinFormulario.reduce((a, t) => a + t.filas.reduce((a2, f) => a2 + f.filter(c => c.input).length, 0), 0)})
                      </p>
                      {tablasSinFormulario.map((t, i) => (
                        <TablaReal key={i} tabla={t} respuestas={respuestas} onChange={setRespuesta} />
                      ))}
                      {sinFormulario.length > 0 && (
                        <div className="space-y-2">
                          {sinFormulario.map(p => (
                            <CampoInput key={p.id} etiqueta={p.etiqueta} valor={respuestas[p.id] || ''} onChange={v => setRespuesta(p.id, v)} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <>
                  {tablasSinFormulario.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                        Tablas con datos pendientes
                      </p>
                      <div className="space-y-2">
                        {tablasSinFormulario.map((t, i) => (
                          <TablaReal key={i} tabla={t} respuestas={respuestas} onChange={setRespuesta} />
                        ))}
                      </div>
                    </div>
                  )}

                  {analisis.pendientesCelda.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                        Necesita tu respuesta ({analisis.pendientesCelda.length})
                      </p>
                      <div className="space-y-2">
                        {analisis.pendientesCelda.map(p => (
                          <CampoInput key={p.id} etiqueta={p.etiqueta} valor={respuestas[p.id] || ''} onChange={v => setRespuesta(p.id, v)} />
                        ))}
                      </div>
                    </div>
                  )}

                  {analisis.pendientesInline.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                        Blancos dentro del texto ({analisis.pendientesInline.length})
                      </p>
                      <div className="space-y-2">
                        {analisis.pendientesInline.map(p => (
                          <CampoInput key={p.id} etiqueta={`…${p.contexto}____`} valor={respuestas[p.id] || ''} onChange={v => setRespuesta(p.id, v)} />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {analisis.completadosAuto.length === 0 && totalPendientes === 0 && (
                <div className="flex items-center gap-2 text-[12.5px] text-slate-400 py-6 justify-center">
                  <FileText size={14} /> No se detectaron campos para completar en este documento.
                </div>
              )}
            </>
          )}
        </div>

        {/* Pie */}
        {!cargando && !error && analisis && (analisis.completadosAuto.length > 0 || totalPendientes > 0) && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 bg-slate-50 flex-shrink-0">
            <p className="text-[11px] text-slate-400">
              {totalPendientes > 0 ? `${totalRespondidas}/${totalPendientes} respondidos (opcional)` : 'Listo para generar'}
            </p>
            <button
              type="button"
              onClick={handleGenerar}
              disabled={generando}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 px-4 py-2 rounded-lg transition-colors"
            >
              {generando
                ? <><Loader2 size={13} className="animate-spin" /> Generando…</>
                : <><Wand2 size={13} /> Generar documento</>}
            </button>
          </div>
        )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
