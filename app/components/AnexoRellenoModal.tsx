'use client';

// Pantalla de relleno de un anexo de oferente: a la izquierda el documento REAL (visor de
// Office Online, el mismo que usa el ojo "Ver" en Documentos), a la derecha el formulario con
// lo que se completó solo y los campos que le faltan a un humano — para que se pueda mirar el
// Word mientras se llena, en vez de adivinar a ciegas desde un fragmento de texto corto. Al
// generar, el .docx final se sube a R2 y queda registrado como documento propio — aparece en
// "Documentos para MP" (misma lista que el costeo/informe generados).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, AlertTriangle, Wand2, FileText, ExternalLink, Download, ChevronDown, ShieldAlert, ListChecks } from 'lucide-react';
import { useToast } from '@/app/components/ui/toast';

// Mismo problema que el visor del ojo "Ver" en Documentos (ver DocumentViewerModal): el visor
// de Office de Microsoft no avisa si el documento real nunca termina de cargar adentro suyo —
// a veces se queda pegado sin mostrar nada ni error. Pasado este tiempo sin confirmación, se
// muestra un aviso con la salida real (abrir/descargar) en vez de un spinner para siempre.
const TIMEOUT_VISOR_OFFICE_MS = 14_000;

export interface AnexoDoc { id: number; nombre: string; url: string }

interface CampoCompletado { etiqueta: string; campo: string; valor: string; via: 'ia' | 'costeo' | 'bases'; formulario?: string; indice?: number }
interface PendienteCelda { id: string; etiqueta: string; formulario?: string; categoria?: string; motivo?: string }
interface PendienteInline {
  id: string; contexto: string; formulario?: string;
  parrafoCompleto?: string; posEnParrafo?: number; largoBlanco?: number;
  categoria?: string; motivo?: string;
}
interface CeldaTablaUI { texto: string; auto?: { valor: string; via: 'ia' | 'costeo' | 'bases' }; input?: { id: string } }
interface TablaUI { filas: CeldaTablaUI[][]; formulario?: string; titulo?: string }
interface AlertaInadmisibilidad { riesgo: string; datoQueLoResuelve: string; disponible: boolean }

// Réplica del documento en orden (ver anexos-documento-ui.ts en el backend, que arma esto
// recorriendo el .docx real): un bloque por cada párrafo o tabla, con su alineación/sangría/
// numeración reales y sus trozos de texto — para que el panel se lea EXACTAMENTE como el Word,
// con los blancos intercalados donde van, en vez de una lista de campos aparte.
type Alineacion = 'izquierda' | 'centro' | 'derecha' | 'justificado';
type SegmentoUI =
  | { t: 'texto'; v: string; negrita?: boolean; subrayado?: boolean }
  | { t: 'auto'; v: string; via: 'ia' | 'costeo' | 'bases' }
  | { t: 'input'; id: string; largo?: number }
  | { t: 'salto' };
interface BloqueParrafoUI {
  tipo: 'parrafo'; indice: number; alineacion: Alineacion; sangriaPx: number; marcador?: string; segmentos: SegmentoUI[];
}
interface BloqueTablaUI { tipo: 'tabla'; tabla: TablaUI }
type BloqueUI = BloqueParrafoUI | BloqueTablaUI;

interface Analisis {
  completadosAuto: CampoCompletado[];
  pendientesCelda: PendienteCelda[];
  pendientesInline: PendienteInline[];
  tablas: TablaUI[];
  documento: BloqueUI[];
  firma: {
    detectada: boolean; disponible: boolean; timbreDetectado: boolean; timbreDisponible: boolean;
    firmaUrl: string | null; timbreUrl: string | null;
    lugares: { id: string; contexto: string; pideTimbre: boolean }[];
  };
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
                      className={`inline-flex items-center gap-1 font-medium ${
                        c.auto.via === 'costeo' ? 'text-cyan-700' : c.auto.via === 'bases' ? 'text-amber-700' : 'text-emerald-700'
                      }`}
                      title={
                        c.auto.via === 'costeo' ? 'Precio cruzado con el costeo subido — revisa antes de generar'
                          : c.auto.via === 'bases' ? 'Sacado del texto de las Bases — revisa antes de generar'
                          : 'Completado por IA'
                      }
                    >
                      {c.auto.valor}
                      {c.auto.via === 'costeo' && (
                        <span className="shrink-0 text-[9px] font-bold px-1 py-px rounded-full bg-cyan-100 text-cyan-700">$</span>
                      )}
                      {c.auto.via === 'bases' && (
                        <span className="shrink-0 text-[9px] font-bold px-1 py-px rounded-full bg-amber-100 text-amber-700">bases</span>
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

// Un párrafo de la réplica — se lee igual que la línea correspondiente en el Word: misma
// alineación, misma sangría, mismo marcador de lista, y los trozos de texto con su negrita o
// subrayado. Los blancos van INTERCALADOS en el texto: un valor ya resuelto se ve destacado en
// su lugar, y uno pendiente es un input angosto (tamaño según el largo real del "____" en el
// Word) justo donde va — no una tarjeta aparte más abajo.
function BloqueParrafo({ b, respuestas, onChange, motivoPorId }: {
  b: BloqueParrafoUI; respuestas: Record<string, string>; onChange: (id: string, v: string) => void;
  motivoPorId: Map<string, string>;
}) {
  const alineacionClase: Record<Alineacion, string> = {
    izquierda: 'text-left', centro: 'text-center', derecha: 'text-right', justificado: 'text-justify',
  };
  if (b.segmentos.length === 0 && !b.marcador) return <div className="h-2.5" aria-hidden="true" />;
  return (
    <p
      className={`text-[12.5px] leading-relaxed text-slate-800 ${alineacionClase[b.alineacion]}`}
      style={b.sangriaPx ? { paddingLeft: b.sangriaPx } : undefined}
    >
      {b.marcador && <span className="mr-1.5">{b.marcador}</span>}
      {b.segmentos.map((s, i) => {
        if (s.t === 'salto') return <br key={i} />;
        if (s.t === 'texto') {
          return (
            <span key={i} className={`${s.negrita ? 'font-bold' : ''} ${s.subrayado ? 'underline' : ''}`}>
              {s.v}
            </span>
          );
        }
        if (s.t === 'auto') {
          return (
            <span
              key={i}
              className={`font-semibold ${
                s.via === 'costeo' ? 'text-cyan-700' : s.via === 'bases' ? 'text-amber-700' : 'text-emerald-700'
              }`}
              title={
                s.via === 'costeo' ? 'Precio cruzado con el costeo subido — revisa antes de generar'
                  : s.via === 'bases' ? 'Sacado del texto de las Bases — revisa antes de generar'
                  : 'Completado por IA'
              }
            >
              {s.v}
              {s.via === 'costeo' && <span className="ml-0.5 text-[9px] font-bold align-super">$</span>}
              {s.via === 'bases' && <span className="ml-0.5 text-[9px] font-bold align-super">bases</span>}
            </span>
          );
        }
        const motivo = motivoPorId.get(s.id);
        return (
          <input
            key={i}
            type="text"
            value={respuestas[s.id] || ''}
            onChange={e => onChange(s.id, e.target.value)}
            title={motivo}
            placeholder="…"
            style={{ width: Math.min(320, Math.max(70, (s.largo ?? 12) * 8)) }}
            className={`inline-block align-baseline mx-0.5 px-1 py-0.5 text-[12.5px] bg-indigo-50/50 border-0 border-b-2 rounded-sm focus:outline-none focus:bg-indigo-50 ${
              motivo ? 'border-amber-400' : 'border-indigo-300 focus:border-indigo-500'
            }`}
          />
        );
      })}
    </p>
  );
}

// El documento completo, en orden — un párrafo/tabla tras otro tal como está en el Word, con los
// blancos ya resueltos o por llenar en su lugar. Reemplaza la vieja grilla de tarjetas: pedido
// explícito del usuario (4-ago-2026) — "tiene que ser tal cual el mismo texto, la misma
// estructura", no una lista de campos.
function DocumentoReplica({ documento, respuestas, onChange, motivoPorId }: {
  documento: BloqueUI[]; respuestas: Record<string, string>; onChange: (id: string, v: string) => void;
  motivoPorId: Map<string, string>;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
      {documento.map((bloque, i) => bloque.tipo === 'tabla'
        ? <div key={i} className="my-2.5"><TablaReal tabla={bloque.tabla} respuestas={respuestas} onChange={onChange} /></div>
        : <BloqueParrafo key={i} b={bloque} respuestas={respuestas} onChange={onChange} motivoPorId={motivoPorId} />)}
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

// ── Firma y timbre: qué se estampa en cada bloque y dónde ────────────────────────────────────
// Pedido del usuario (4-ago-2026): poder VER cuál imagen es cuál antes de generar, y elegir por
// bloque si van las dos, solo una o ninguna. Lo de "moverla con el mouse" no se puede hacer tal
// cual: en un .docx la firma es un dibujo INLINE, vive dentro de un párrafo y no tiene coordenadas
// propias — arrastrarla a un punto arbitrario de la hoja obligaría a convertirla en un objeto
// flotante anclado, que es exactamente lo que descoloca el documento al abrirlo en otro Word. Lo
// que sí manda su posición es la alineación del párrafo, y eso es lo que se expone acá.
const OPCIONES_ESTAMPA = [
  { v: 'ambas', label: 'Firma + timbre' },
  { v: 'firma', label: 'Solo firma' },
  { v: 'timbre', label: 'Solo timbre' },
  { v: 'ninguna', label: 'Ninguna' },
] as const;
const OPCIONES_POSICION = [
  { v: 'izquierda', label: 'Izq.' },
  { v: 'centro', label: 'Centro' },
  { v: 'derecha', label: 'Der.' },
] as const;

function BloqueFirmaTimbre({ firma, respuestas, onChange }: {
  firma: Analisis['firma']; respuestas: Record<string, string>; onChange: (id: string, v: string) => void;
}) {
  const hayFirma = firma.disponible;
  const hayTimbre = firma.timbreDisponible;
  // Mismo criterio que el backend (porDefectoEnLugar en anexos-rellenar.ts): la pantalla tiene que
  // mostrar seleccionado lo que de verdad va a pasar si el usuario no toca nada.
  const porDefecto = (pideTimbre: boolean) => {
    const timbre = pideTimbre && hayTimbre;
    if (hayFirma && timbre) return 'ambas';
    if (hayFirma) return 'firma';
    if (timbre) return 'timbre';
    return 'ninguna';
  };
  const disponible = (v: string) =>
    v === 'ninguna' || (v === 'firma' && hayFirma) || (v === 'timbre' && hayTimbre) || (v === 'ambas' && hayFirma && hayTimbre);

  return (
    <div className="border border-slate-200 rounded-xl p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12.5px] font-semibold text-slate-700">Firma y timbre</p>
        <div className="flex items-center gap-3">
          {firma.firmaUrl && (
            <figure className="text-center">
              <img src={firma.firmaUrl} alt="Firma escaneada" className="h-9 max-w-[120px] object-contain" />
              <figcaption className="text-[10px] text-slate-400">firma</figcaption>
            </figure>
          )}
          {firma.timbreUrl && (
            <figure className="text-center">
              <img src={firma.timbreUrl} alt="Timbre de la empresa" className="h-9 max-w-[120px] object-contain" />
              <figcaption className="text-[10px] text-slate-400">timbre</figcaption>
            </figure>
          )}
        </div>
      </div>

      {firma.lugares.map(lugar => {
        const indice = lugar.id.split(':')[1];
        const valor = respuestas[lugar.id] || porDefecto(lugar.pideTimbre);
        const pos = respuestas[`firmaPos:${indice}`] || '';
        return (
          <div key={lugar.id} className="bg-slate-50 rounded-lg p-2 space-y-1.5">
            <p className="text-[11.5px] text-slate-600 truncate" title={lugar.contexto}>{lugar.contexto}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {OPCIONES_ESTAMPA.map(o => (
                <button
                  key={o.v}
                  type="button"
                  disabled={!disponible(o.v)}
                  title={disponible(o.v) ? undefined : `No hay ${o.v === 'ambas' ? 'firma y timbre' : o.v} cargado en la ficha de la empresa`}
                  onClick={() => onChange(lugar.id, o.v)}
                  className={`text-[11px] px-2 py-1 rounded-md border transition ${
                    valor === o.v
                      ? 'bg-indigo-600 border-indigo-600 text-white font-medium'
                      : disponible(o.v)
                        ? 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300'
                        : 'bg-slate-100 border-slate-200 text-slate-300 cursor-not-allowed'
                  }`}
                >
                  {o.label}
                </button>
              ))}
              {valor !== 'ninguna' && (
                <span className="flex items-center gap-1.5 ml-auto">
                  <span className="text-[10.5px] text-slate-400">posición</span>
                  {OPCIONES_POSICION.map(o => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => onChange(`firmaPos:${indice}`, pos === o.v ? '' : o.v)}
                      className={`text-[11px] px-1.5 py-1 rounded-md border transition ${
                        pos === o.v
                          ? 'bg-slate-700 border-slate-700 text-white'
                          : 'bg-white border-slate-200 text-slate-500 hover:border-slate-400'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </span>
              )}
            </div>
          </div>
        );
      })}
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
  // Solo las CASILLAS del documento — las claves de firma/timbre (`firma:N`, `firmaPos:N`) viajan
  // por el mismo objeto pero no son campos por responder, y contarlas inflaba el "N/M respondidos".
  const totalRespondidas = Object.entries(respuestas)
    .filter(([k, v]) => !k.startsWith('firma:') && !k.startsWith('firmaPos:') && v.trim()).length;

  // Por qué el motor de IA (anexos-ia-motor.ts) no autocompletó cada blanco pendiente — se
  // muestra como tooltip del input en la réplica (ver BloqueParrafo), no como texto aparte:
  // dentro de un párrafo corrido no hay lugar para una frase de motivo sin romper la lectura
  // exacta del documento. Pedido explícito del usuario: "que me pregunte... si tiene alguna
  // duda" sigue cumplido, solo que ahora vive en el `title` del input.
  const motivoPorId = new Map<string, string>();
  for (const p of analisis?.pendientesCelda || []) if (p.motivo) motivoPorId.set(p.id, p.motivo);
  for (const p of analisis?.pendientesInline || []) if (p.motivo) motivoPorId.set(p.id, p.motivo);

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
              {analisis.firma.timbreDetectado && !analisis.firma.timbreDisponible && (
                <div className="flex items-start gap-2.5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-[12.5px] text-amber-800">
                    Este documento pide <strong>firma y timbre</strong>, pero esta empresa no tiene un timbre cargado — solo se estampa la firma.
                    Súbelo en <strong>/empresas</strong> (sección "Timbre digital") para que se inserte solo la próxima vez.
                  </p>
                </div>
              )}

              {analisis.firma.lugares?.length > 0 && (
                <BloqueFirmaTimbre firma={analisis.firma} respuestas={respuestas} onChange={setRespuesta} />
              )}

              {totalPendientes === 0 && analisis.completadosAuto.length > 0 && (
                <p className="text-[12px] text-slate-400">No quedan campos pendientes por completar a mano.</p>
              )}

              {analisis.documento.length > 0 ? (
                <DocumentoReplica
                  documento={analisis.documento} respuestas={respuestas} onChange={setRespuesta} motivoPorId={motivoPorId}
                />
              ) : (
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
