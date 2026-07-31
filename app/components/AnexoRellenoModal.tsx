'use client';

// Pantalla de relleno de un anexo de oferente: a la izquierda el documento REAL (visor de
// Office Online, el mismo que usa el ojo "Ver" en Documentos), a la derecha el formulario con
// lo que se completó solo y los campos que le faltan a un humano — para que se pueda mirar el
// Word mientras se llena, en vez de adivinar a ciegas desde un fragmento de texto corto. Al
// generar, el .docx final se sube a R2 y queda registrado como documento propio — aparece en
// "Documentos para MP" (misma lista que el costeo/informe generados).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, CheckCircle2, AlertTriangle, Wand2, FileText, ExternalLink, Download, ChevronDown } from 'lucide-react';
import { useToast } from '@/app/components/ui/toast';

// Mismo problema que el visor del ojo "Ver" en Documentos (ver DocumentViewerModal): el visor
// de Office de Microsoft no avisa si el documento real nunca termina de cargar adentro suyo —
// a veces se queda pegado sin mostrar nada ni error. Pasado este tiempo sin confirmación, se
// muestra un aviso con la salida real (abrir/descargar) en vez de un spinner para siempre.
const TIMEOUT_VISOR_OFFICE_MS = 14_000;

export interface AnexoDoc { id: number; nombre: string; url: string }

interface CampoCompletado { etiqueta: string; campo: string; valor: string; via: 'diccionario' | 'ia' | 'costeo'; formulario?: string }
interface PendienteCelda { id: string; etiqueta: string; formulario?: string }
interface PendienteInline { id: string; contexto: string; formulario?: string }
interface CeldaTablaUI { texto: string; auto?: { valor: string; via: 'diccionario' | 'ia' | 'costeo' }; input?: { id: string } }
interface TablaUI { filas: CeldaTablaUI[][]; formulario?: string; titulo?: string }

interface Analisis {
  completadosAuto: CampoCompletado[];
  pendientesCelda: PendienteCelda[];
  pendientesInline: PendienteInline[];
  tablas: TablaUI[];
  firma: { detectada: boolean; disponible: boolean };
  ordenFormularios?: string[]; // títulos en el orden del documento
}

// Vista de tabla REAL: mismas filas/columnas que el Word, para que quede claro a qué celda
// corresponde cada input (pedido explícito del usuario tras probar la lista plana con un anexo
// económico real de 160 blancos sueltos — imposible saber cuál era cuál sin esto).
function TablaReal({
  tabla, respuestas, onChange,
}: { tabla: TablaUI; respuestas: Record<string, string>; onChange: (id: string, v: string) => void }) {
  return (
    <div className="space-y-1">
      {tabla.titulo && (
        <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">{tabla.titulo}</p>
      )}
      <div className="overflow-x-auto rounded-lg border border-slate-200 max-w-full">
      <table className="w-full text-[11.5px] border-collapse table-fixed">
        <tbody>
          {tabla.filas.map((fila, i) => (
            <tr key={i} className={i === 0 ? 'bg-slate-100' : 'odd:bg-white even:bg-slate-50/60'}>
              {fila.map((c, j) => (
                <td key={j} className={`border border-slate-200 px-2 py-1 align-middle break-words ${i === 0 ? 'font-semibold text-slate-700' : ''}`}>
                  {c.input ? (
                    <input
                      type="text"
                      value={respuestas[c.input.id] || ''}
                      onChange={e => onChange(c.input!.id, e.target.value)}
                      placeholder="…"
                      className="w-full min-w-0 text-[11.5px] px-1.5 py-1 border border-indigo-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
                    />
                  ) : c.auto ? (
                    <span
                      className={`inline-flex items-center gap-1 font-medium ${c.auto.via === 'costeo' ? 'text-cyan-700' : 'text-emerald-700'}`}
                      title={
                        c.auto.via === 'costeo' ? 'Precio cruzado con el costeo subido — revisa antes de generar'
                          : c.auto.via === 'ia' ? 'Completado por IA' : 'Completado automático'
                      }
                    >
                      {c.auto.valor}
                      {c.auto.via === 'costeo' && (
                        <span className="shrink-0 text-[9px] font-bold px-1 py-px rounded-full bg-cyan-100 text-cyan-700">$</span>
                      )}
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
    </div>
  );
}

// Un pendiente unificado (celda o blanco inline) con la etiqueta ya lista para mostrar — usado
// para agrupar por formulario cuando el documento trae varios pegados (ver anexos-dividir.ts).
interface PendienteUnificado { id: string; etiqueta: string; formulario?: string }

function limpiarTituloFormulario(t: string): string {
  return t.replace(/[.:]+$/, '').trim();
}

// Las etiquetas compuestas vienen del backend como dos partes separadas por " — " (ver
// desambiguarDuplicados y detectarCandidatosTabla): mostrarlas crudas era ilegible ("Nombre: —
// Para uso exclusivo Proveedor Adjudicado"). Se parten para mostrar la primera destacada y la
// segunda chica al lado, que es lo que ubica al usuario en el documento.
//
// Se respeta el ORDEN original a propósito: cuál de las dos partes es "el campo" depende de quién
// armó la etiqueta —en una tabla es la primera (fila — columna), en un duplicado desambiguado es
// la segunda (contexto — campo)— así que elegir una como principal daría vuelta la mitad de los
// casos. Mostrando las dos en su orden, la etiqueta siempre se lee igual que en el Word.
function partirEtiqueta(etiqueta: string): { campo: string; contexto?: string } {
  const m = etiqueta.match(/^(.+?)\s+—\s+(.+)$/);
  if (!m) return { campo: etiqueta.replace(/\s*:\s*$/, '') };
  return { campo: m[1].replace(/\s*:\s*$/, ''), contexto: m[2].replace(/\s*:\s*$/, '') };
}

function EtiquetaCampo({ etiqueta }: { etiqueta: string }) {
  const { campo, contexto } = partirEtiqueta(etiqueta);
  return (
    <span className="min-w-0 truncate" title={etiqueta}>
      {campo}
      {contexto && <span className="ml-1.5 text-[10.5px] text-slate-400 font-normal">· {contexto}</span>}
    </span>
  );
}

function CampoInput({ etiqueta, valor, onChange }: { etiqueta: string; valor: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="flex items-baseline text-[11.5px] font-medium text-slate-600 mb-1" title={etiqueta}>
        <EtiquetaCampo etiqueta={etiqueta} />
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

// Lo que se completa solo, dentro de su formulario: compacto y plegado por defecto. Es información
// de confirmación ("esto ya está"), no algo que el usuario deba leer campo por campo — antes iba
// todo junto arriba, sin decir a qué formulario correspondía cada uno, y con la misma etiqueta
// repetida cuatro veces ("CORREO ELECTRÓNICO") era imposible saber cuál era cuál.
function ResumenAuto({ campos }: { campos: CampoCompletado[] }) {
  const [abierto, setAbierto] = useState(false);
  if (!campos.length) return null;
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/70">
      <button
        type="button"
        onClick={() => setAbierto(v => !v)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11.5px] font-semibold text-emerald-800 hover:bg-emerald-100/60 rounded-lg transition-colors"
      >
        <CheckCircle2 size={12} className="flex-shrink-0" />
        <span className="flex-1 text-left">Se completan solos ({campos.length})</span>
        <ChevronDown size={13} className={`transition-transform ${abierto ? 'rotate-180' : ''}`} />
      </button>
      {abierto && (
        <div className="px-2.5 pb-2 divide-y divide-emerald-100">
          {campos.map((c, i) => (
            <div key={i} className="flex items-baseline justify-between gap-3 py-1 text-[11.5px]">
              <span className="flex items-baseline gap-1.5 min-w-0 text-emerald-800 font-medium">
                <EtiquetaCampo etiqueta={c.etiqueta} />
                {c.via === 'ia' && (
                  <span className="shrink-0 text-[9px] font-bold px-1 py-px rounded-full bg-violet-100 text-violet-700" title="Completado por IA, no por match exacto">
                    IA
                  </span>
                )}
                {c.via === 'costeo' && (
                  <span className="shrink-0 text-[9px] font-bold px-1 py-px rounded-full bg-cyan-100 text-cyan-700" title="Precio cruzado con el costeo subido — revisa antes de generar">
                    COSTEO
                  </span>
                )}
              </span>
              <span className="text-emerald-700 truncate max-w-[45%] text-right">{c.valor}</span>
            </div>
          ))}
        </div>
      )}
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
  // Recibe los archivos subidos (uno, o varios si el Word traía formularios pegados y se
  // dividió) — quien abre el modal decide qué hacer con ellos (ej. adjuntarlos a un punto del
  // Auditor Técnico), no solo refrescar la lista de Documentos.
  onGenerado: (archivos: { nombre: string; url: string }[]) => void;
}) {
  const toast = useToast();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analisis, setAnalisis] = useState<Analisis | null>(null);
  const [respuestas, setRespuestas] = useState<Record<string, string>>({});
  const [generando, setGenerando] = useState(false);
  const [cargandoVisor, setCargandoVisor] = useState(true);
  const [visorLento, setVisorLento] = useState(false);
  const [avisoLentoCerrado, setAvisoLentoCerrado] = useState(false);

  useEffect(() => {
    if (!doc) return;
    setCargando(true);
    setError(null);
    setAnalisis(null);
    setRespuestas({});
    setCargandoVisor(true);
    setVisorLento(false);
    setAvisoLentoCerrado(false);

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timerVisor = window.setTimeout(() => setVisorLento(true), TIMEOUT_VISOR_OFFICE_MS);

    if (!empresaId) {
      setCargando(false);
      setError('Esta licitación no tiene una empresa asignada. Asígnala en «Información Comercial» antes de rellenar anexos.');
      return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; window.clearTimeout(timerVisor); };
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

    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; window.clearTimeout(timerVisor); };
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
    ...analisis.pendientesInline.map(p => ({ id: p.id, etiqueta: p.contexto.replace(/\s*:\s*$/, ''), formulario: p.formulario })),
  ] : [];
  const gruposFormulario: { titulo: string; items: PendienteUnificado[]; tablas: TablaUI[]; autos: CampoCompletado[] }[] = [];
  const sinFormulario: PendienteUnificado[] = [];
  const tablasSinFormulario: TablaUI[] = [];
  const autosSinFormulario: CampoCompletado[] = [];
  const grupoDe = (titulo: string) => {
    let grupo = gruposFormulario.find(g => g.titulo === titulo);
    if (!grupo) { grupo = { titulo, items: [], tablas: [], autos: [] }; gruposFormulario.push(grupo); }
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
  // Lo que se completa solo va DENTRO de su formulario, igual que los pendientes: verlo junto a la
  // tabla de ese formulario es lo que hace entendible un documento con 5 formularios pegados que
  // piden los mismos datos una y otra vez.
  for (const c of analisis?.completadosAuto || []) {
    if (!c.formulario) { autosSinFormulario.push(c); continue; }
    grupoDe(c.formulario).autos.push(c);
  }
  // En el orden del documento, no en el orden en que los fue encontrando cada lista.
  const orden = analisis?.ordenFormularios || [];
  gruposFormulario.sort((a, b) => {
    const ia = orden.indexOf(a.titulo), ib = orden.indexOf(b.titulo);
    return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib);
  });
  const hayFormularios = gruposFormulario.length > 0;
  const contarInputs = (tablas: TablaUI[]) =>
    tablas.reduce((a, t) => a + t.filas.reduce((a2, f) => a2 + f.filter(c => c.input).length, 0), 0);

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
      onGenerado(data.archivos || []);
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
            {cargandoVisor && !visorLento && (
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
            {visorLento && !avisoLentoCerrado && (
              <div className="absolute top-3 left-3 right-3 z-10 flex items-start gap-2.5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl shadow-lg">
                <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] text-amber-800">
                    El visor de Microsoft está tardando más de lo normal (servicio externo sin garantía) — si no ves el documento, abrilo directo:
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <a
                      href={doc.url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-amber-300 hover:bg-amber-100 text-amber-800 text-[12px] font-semibold rounded-lg transition-colors"
                    >
                      <ExternalLink size={12} /> Abrir en pestaña nueva
                    </a>
                    <a
                      href={doc.url} download={doc.nombre}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-amber-300 hover:bg-amber-100 text-amber-800 text-[12px] font-semibold rounded-lg transition-colors"
                    >
                      <Download size={12} /> Descargar
                    </a>
                  </div>
                </div>
                <button
                  type="button" onClick={() => setAvisoLentoCerrado(true)}
                  className="p-1 text-amber-400 hover:text-amber-700 hover:bg-amber-100 rounded-lg transition-colors flex-shrink-0"
                  aria-label="Cerrar aviso"
                >
                  <X size={14} />
                </button>
              </div>
            )}
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

              {hayFormularios ? (
                <>
                  {/* Un bloque por formulario, con TODO lo suyo adentro: lo que se completa solo,
                      la tabla tal cual está en el Word, y lo que hay que escribir. Antes los
                      completados iban en una sola lista arriba, sin decir a qué formulario
                      pertenecía cada uno — en un documento con 5 formularios que piden los mismos
                      datos, esa lista era ilegible. */}
                  {gruposFormulario.map(g => {
                    const porLlenar = g.items.length + contarInputs(g.tablas);
                    return (
                      <div key={g.titulo} className="space-y-2">
                        <div className="flex items-baseline justify-between gap-2 border-b border-indigo-100 pb-1">
                          <p className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider truncate" title={g.titulo}>
                            {limpiarTituloFormulario(g.titulo)}
                          </p>
                          <p className="text-[10.5px] text-slate-400 flex-shrink-0">
                            {porLlenar > 0 ? `${porLlenar} por llenar` : 'nada por llenar'}
                          </p>
                        </div>
                        <ResumenAuto campos={g.autos} />
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
                    );
                  })}
                  {(sinFormulario.length > 0 || tablasSinFormulario.length > 0 || autosSinFormulario.length > 0) && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100 pb-1">
                        Otros campos
                        {sinFormulario.length + contarInputs(tablasSinFormulario) > 0
                          && ` (${sinFormulario.length + contarInputs(tablasSinFormulario)})`}
                      </p>
                      <ResumenAuto campos={autosSinFormulario} />
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
                <ResumenAuto campos={analisis.completadosAuto} />
                {totalPendientes === 0 && analisis.completadosAuto.length > 0 && (
                  <p className="text-[12px] text-slate-400">No quedan campos pendientes por completar a mano.</p>
                )}
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
                          <CampoInput key={p.id} etiqueta={p.contexto.replace(/\s*:\s*$/, '')} valor={respuestas[p.id] || ''} onChange={v => setRespuesta(p.id, v)} />
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
