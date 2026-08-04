'use client';

// Pantalla de relleno de un anexo de oferente: a la izquierda el documento REAL (visor de
// Office Online, el mismo que usa el ojo "Ver" en Documentos), a la derecha el formulario con
// lo que se completó solo y los campos que le faltan a un humano — para que se pueda mirar el
// Word mientras se llena, en vez de adivinar a ciegas desde un fragmento de texto corto. Al
// generar, el .docx final se sube a R2 y queda registrado como documento propio — aparece en
// "Documentos para MP" (misma lista que el costeo/informe generados).
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, AlertTriangle, Wand2, FileText, ExternalLink, Download, ChevronDown, ShieldAlert, ListChecks } from 'lucide-react';
import { useToast } from '@/app/components/ui/toast';

// Mismo problema que el visor del ojo "Ver" en Documentos (ver DocumentViewerModal): el visor
// de Office de Microsoft no avisa si el documento real nunca termina de cargar adentro suyo —
// a veces se queda pegado sin mostrar nada ni error. Pasado este tiempo sin confirmación, se
// muestra un aviso con la salida real (abrir/descargar) en vez de un spinner para siempre.
const TIMEOUT_VISOR_OFFICE_MS = 14_000;

export interface AnexoDoc { id: number; nombre: string; url: string }

interface CampoCompletado { etiqueta: string; campo: string; valor: string; via: 'ia' | 'costeo'; formulario?: string; indice?: number }
interface PendienteCelda { id: string; etiqueta: string; formulario?: string; categoria?: string; motivo?: string }
interface PendienteInline {
  id: string; contexto: string; formulario?: string;
  parrafoCompleto?: string; posEnParrafo?: number; largoBlanco?: number;
  categoria?: string; motivo?: string;
}
interface CeldaTablaUI { texto: string; auto?: { valor: string; via: 'ia' | 'costeo' }; input?: { id: string } }
interface TablaUI { filas: CeldaTablaUI[][]; formulario?: string; titulo?: string }
interface AlertaInadmisibilidad { riesgo: string; datoQueLoResuelve: string; disponible: boolean }

interface Analisis {
  completadosAuto: CampoCompletado[];
  pendientesCelda: PendienteCelda[];
  pendientesInline: PendienteInline[];
  tablas: TablaUI[];
  firma: { detectada: boolean; disponible: boolean };
  ordenFormularios?: string[]; // títulos en el orden del documento
  alertasInadmisibilidad?: AlertaInadmisibilidad[];
  checklistPendientes?: string[];
}

// Vista de tabla REAL: mismas filas/columnas que el Word, para que quede claro a qué celda
// corresponde cada input (pedido explícito del usuario tras probar la lista plana con un anexo
// económico real de 160 blancos sueltos — imposible saber cuál era cuál sin esto).
function TablaReal({
  tabla, respuestas, onChange,
}: { tabla: TablaUI; respuestas: Record<string, string>; onChange: (id: string, v: string) => void }) {
  // Una fila con MENOS celdas que el resto es un título mergeado (ver indiceFilaEncabezado en
  // anexos-detectar.ts — "DATOS DEL PROPONENTE:", "INTEGRANTES DE LA UTP"...): se le da colSpan a
  // su última celda para que ocupe todo el ancho, igual que en el Word, en vez de verse como una
  // celda angosta suelta pegada al borde izquierdo.
  const maxCols = Math.max(1, ...tabla.filas.map(f => f.length));
  return (
    <div className="space-y-1">
      {tabla.titulo && (
        <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">{tabla.titulo}</p>
      )}
      {/* Ancho mínimo por columna (en vez de `w-full` a secas): con muchas columnas (tablas de
          especificaciones técnicas, 6+), forzar el 100% del contenedor angosto aplastaba cada
          celda a unos pocos caracteres de ancho — nunca desbordaba, así que `overflow-x-auto`
          nunca entraba a tallar y el texto quedaba amontonado en filas altísimas. Con un mínimo
          por columna, una tabla ancha SÍ desborda y se puede desplazar horizontalmente para leerla
          cómoda, en vez de comprimirse hasta ser ilegible. */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 max-w-full">
      <table className="w-full text-[11.5px] border-collapse table-fixed" style={{ minWidth: maxCols * 130 }}>
        <tbody>
          {tabla.filas.map((fila, i) => (
            <tr key={i} className={i === 0 ? 'bg-slate-100' : 'odd:bg-white even:bg-slate-50/60'}>
              {fila.map((c, j) => (
                <td
                  key={j}
                  colSpan={j === fila.length - 1 && fila.length < maxCols ? maxCols - fila.length + 1 : undefined}
                  className={`border border-slate-200 px-2 py-1 align-middle break-words ${i === 0 ? 'font-semibold text-slate-700' : ''}`}
                >
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
// parrafoCompleto/posEnParrafo/largoBlanco solo existen para blancos inline (una celda vacía ya
// tiene su propia etiqueta clara, no vive dentro de una oración que haya que mostrar entera).
interface PendienteUnificado {
  id: string; etiqueta: string; formulario?: string;
  parrafoCompleto?: string; posEnParrafo?: number; largoBlanco?: number;
  motivo?: string;
}

// Muestra el párrafo completo con el blanco resaltado — pedido explícito del usuario (caso real
// 1058086-43-LP26): con solo la etiqueta recortada ("de ___ de ___", "RUT N°") no se entendía qué
// pedía cada blanco de una declaración jurada corrida sin abrir el Word al lado.
function ParrafoConBlanco({ texto, pos, largo }: { texto: string; pos?: number; largo?: number }) {
  if (pos == null || largo == null || pos < 0 || pos + largo > texto.length) return <>{texto}</>;
  return (
    <>
      {texto.slice(0, pos)}
      <mark className="bg-indigo-100 text-indigo-700 rounded px-0.5 not-italic">
        {texto.slice(pos, pos + largo) || '____'}
      </mark>
      {texto.slice(pos + largo)}
    </>
  );
}

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

// Por qué el motor de IA (anexos-ia-motor.ts) no autocompletó esta casilla — se muestra bajo la
// etiqueta en vez de dejar el input mudo. Pedido explícito del usuario: "que me pregunte... si
// tiene alguna duda", no solo un blanco sin explicación.
function MotivoPendiente({ motivo }: { motivo: string }) {
  return (
    <p className="text-[11px] text-amber-700 leading-snug mb-1 flex items-start gap-1">
      <ShieldAlert size={11} className="flex-shrink-0 mt-0.5" />
      <span>{motivo}</span>
    </p>
  );
}

// Una CASILLA del documento — la unidad visual mínima de la réplica: una cajita con borde, la
// etiqueta chica arriba (como en el Word) y el valor/input adentro. Antes cada campo pendiente era
// una fila suelta en una lista vertical larga; agrupadas en una grilla (ver GrillaCampos) esto es
// lo que hace que el panel se vea como el formulario real y no como una lista de "etiqueta: valor".
function CampoInput({ etiqueta, valor, onChange, parrafoCompleto, posEnParrafo, largoBlanco, motivo }: {
  etiqueta: string; valor: string; onChange: (v: string) => void;
  parrafoCompleto?: string; posEnParrafo?: number; largoBlanco?: number; motivo?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 min-w-0">
      <label className="flex items-baseline text-[10.5px] font-medium text-slate-500 mb-1" title={etiqueta}>
        <EtiquetaCampo etiqueta={etiqueta} />
      </label>
      {parrafoCompleto && (
        <p className="text-[11px] text-slate-400 italic leading-snug mb-1">
          <ParrafoConBlanco texto={parrafoCompleto} pos={posEnParrafo} largo={largoBlanco} />
        </p>
      )}
      {motivo && <MotivoPendiente motivo={motivo} />}
      <input
        type="text"
        value={valor}
        onChange={e => onChange(e.target.value)}
        placeholder="Escribe el valor…"
        className="w-full text-[12.5px] px-2 py-1 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
      />
    </div>
  );
}

// Misma cajita, pero para lo que ya se completó solo — mismo tamaño y forma que CampoInput para
// que en la grilla se lean como parte de UN mismo formulario, no como dos secciones distintas.
function CampoAuto({ etiqueta, valor, via }: { etiqueta: string; valor: string; via: 'ia' | 'costeo' }) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-2.5 py-2 min-w-0">
      <p className="flex items-center gap-1 text-[10.5px] font-medium text-emerald-700/80 mb-0.5" title={etiqueta}>
        <EtiquetaCampo etiqueta={etiqueta} />
        {via === 'costeo' && (
          <span className="shrink-0 text-[9px] font-bold px-1 py-px rounded-full bg-cyan-100 text-cyan-700" title="Precio cruzado con el costeo subido — revisa antes de generar">
            $
          </span>
        )}
      </p>
      <p className="text-[12.5px] font-semibold text-emerald-800 truncate" title={valor}>{valor}</p>
    </div>
  );
}

// Arma una única grilla de casillas EN EL ORDEN DEL DOCUMENTO — auto-completadas y pendientes
// mezcladas, tal como se leen una tras otra en el Word (no dos bloques separados, "lo que se llenó
// solo" arriba y "lo que falta" abajo, como era antes). El orden sale del índice de párrafo/celda
// que cada una trae desde el backend (celda:N, inline:N:pos) — ninguno se muestra realmente, solo
// ordena. Las que traen frase de contexto u motivo ocupan las 2 columnas (no entran cómodas en media).
function GrillaCampos({ autos, items, respuestas, onChange }: {
  autos: CampoCompletado[]; items: PendienteUnificado[];
  respuestas: Record<string, string>; onChange: (id: string, v: string) => void;
}) {
  if (!autos.length && !items.length) return null;
  const indiceDeId = (id: string) => Number(id.split(':')[1]) || 0;
  type Tarjeta = { orden: number; anchoCompleto: boolean; key: string; el: ReactNode };
  const tarjetas: Tarjeta[] = [
    ...autos.map((c, i): Tarjeta => ({
      orden: c.indice ?? Number.MAX_SAFE_INTEGER,
      anchoCompleto: false,
      key: `auto:${i}:${c.etiqueta}`,
      el: <CampoAuto etiqueta={c.etiqueta} valor={c.valor} via={c.via} />,
    })),
    ...items.map((p): Tarjeta => ({
      orden: indiceDeId(p.id),
      anchoCompleto: !!(p.parrafoCompleto || p.motivo),
      key: p.id,
      el: (
        <CampoInput
          etiqueta={p.etiqueta} valor={respuestas[p.id] || ''} onChange={v => onChange(p.id, v)}
          parrafoCompleto={p.parrafoCompleto} posEnParrafo={p.posEnParrafo} largoBlanco={p.largoBlanco} motivo={p.motivo}
        />
      ),
    })),
  ].sort((a, b) => a.orden - b.orden);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {tarjetas.map(t => (
        <div key={t.key} className={t.anchoCompleto ? 'sm:col-span-2' : undefined}>{t.el}</div>
      ))}
    </div>
  );
}

// Paso 1 del motor de IA (ver anexos-ia-motor.ts): riesgos de inadmisibilidad detectados en las
// BASES antes de tocar cualquier campo — lo primero que se ve, antes que cualquier casilla, tal
// como lo pidió el usuario ("que me lea las bases... y me alerte"). Solo se muestran las que NO
// están resueltas (disponible:false) — si el dato ya está disponible, no es una alerta real.
function AlertasInadmisibilidad({ alertas }: { alertas: AlertaInadmisibilidad[] }) {
  const pendientes = alertas.filter(a => !a.disponible);
  if (!pendientes.length) return null;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50/80 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[12px] font-bold text-red-700 mb-1.5">
        <ShieldAlert size={13} className="flex-shrink-0" /> Riesgo de inadmisibilidad — revisa antes de postular
      </p>
      <ul className="space-y-1 pl-1">
        {pendientes.map((a, i) => (
          <li key={i} className="text-[11.5px] text-red-800 leading-snug">
            <span className="font-semibold">{a.riesgo}</span>
            {a.datoQueLoResuelve && <span className="text-red-600"> — {a.datoQueLoResuelve}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// checklist_pendientes del motor: lo que el usuario debe confirmar/escribir antes de generar,
// aparte de las casillas individuales (plazo de entrega, certificaciones, decisiones que la IA
// no puede tomar). Plegable — es un recordatorio, no algo que bloquee.
function ChecklistPendientes({ items }: { items: string[] }) {
  const [abierto, setAbierto] = useState(true);
  if (!items.length) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/70">
      <button
        type="button"
        onClick={() => setAbierto(v => !v)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11.5px] font-semibold text-amber-800 hover:bg-amber-100/60 rounded-lg transition-colors"
      >
        <ListChecks size={12} className="flex-shrink-0" />
        <span className="flex-1 text-left">Antes de generar ({items.length})</span>
        <ChevronDown size={13} className={`transition-transform ${abierto ? 'rotate-180' : ''}`} />
      </button>
      {abierto && (
        <ul className="px-2.5 pb-2 space-y-1">
          {items.map((it, i) => (
            <li key={i} className="text-[11.5px] text-amber-800 leading-snug pl-1">· {it}</li>
          ))}
        </ul>
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
    ...analisis.pendientesCelda.map(p => ({ id: p.id, etiqueta: p.etiqueta, formulario: p.formulario, motivo: p.motivo })),
    ...analisis.pendientesInline.map(p => ({
      id: p.id, etiqueta: p.contexto.replace(/\s*:\s*$/, ''), formulario: p.formulario,
      parrafoCompleto: p.parrafoCompleto, posEnParrafo: p.posEnParrafo, largoBlanco: p.largoBlanco,
      motivo: p.motivo,
    })),
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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-2"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Rellenar anexo: ${doc.nombre}`}
    >
      {/* Casi toda la pantalla (no un ancho fijo tipo max-w-[1400px]): pedido explícito del
          usuario — con tablas de varias columnas (especificaciones técnicas), cuanto más angosto
          el panel del formulario, más se aprietan las celdas. */}
      <div
        className="flex flex-col w-[98vw] h-[97vh] bg-white rounded-2xl overflow-hidden shadow-2xl"
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
          {/* Visor — mismo mecanismo que el ojo "Ver" en Documentos (Office Online embed). 40% en
              vez de 50/50: el formulario es el que necesita el espacio (tablas de varias columnas),
              el visor del Word se lee bien más angosto. */}
          <div className="relative w-full lg:w-[40%] h-64 lg:h-full bg-slate-100 border-b lg:border-b-0 lg:border-r border-slate-200 flex-shrink-0">
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

          {/* Formulario — `min-w-0` es OBLIGATORIO acá: en una fila flex un item vale por defecto
              `min-width: auto`, o sea NO puede encogerse por debajo de su contenido. Con el visor
              de al lado en `flex-shrink-0 w-1/2`, esta columna se desbordaba fuera del modal y los
              inputs quedaban cortados por el borde derecho de la pantalla. */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col">
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
              {analisis.alertasInadmisibilidad && analisis.alertasInadmisibilidad.length > 0 && (
                <AlertasInadmisibilidad alertas={analisis.alertasInadmisibilidad} />
              )}
              {analisis.checklistPendientes && analisis.checklistPendientes.length > 0 && (
                <ChecklistPendientes items={analisis.checklistPendientes} />
              )}
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
                        {g.tablas.map((t, i) => (
                          <TablaReal key={i} tabla={t} respuestas={respuestas} onChange={setRespuesta} />
                        ))}
                        <GrillaCampos autos={g.autos} items={g.items} respuestas={respuestas} onChange={setRespuesta} />
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
                      {tablasSinFormulario.map((t, i) => (
                        <TablaReal key={i} tabla={t} respuestas={respuestas} onChange={setRespuesta} />
                      ))}
                      <GrillaCampos autos={autosSinFormulario} items={sinFormulario} respuestas={respuestas} onChange={setRespuesta} />
                    </div>
                  )}
                </>
              ) : (
                <>
                  {totalPendientes === 0 && analisis.completadosAuto.length > 0 && (
                    <p className="text-[12px] text-slate-400">No quedan campos pendientes por completar a mano.</p>
                  )}
                  {tablasSinFormulario.map((t, i) => (
                    <TablaReal key={i} tabla={t} respuestas={respuestas} onChange={setRespuesta} />
                  ))}
                  <GrillaCampos autos={autosSinFormulario} items={sinFormulario} respuestas={respuestas} onChange={setRespuesta} />
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
