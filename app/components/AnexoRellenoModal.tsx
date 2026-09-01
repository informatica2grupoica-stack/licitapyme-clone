'use client';

// Pantalla de relleno de un anexo de oferente: a la izquierda el documento REAL (visor de
// Office Online, el mismo que usa el ojo "Ver" en Documentos), a la derecha el formulario con
// lo que se completó solo y los campos que le faltan a un humano — para que se pueda mirar el
// Word mientras se llena, en vez de adivinar a ciegas desde un fragmento de texto corto. Al
// generar, el .docx final se sube a R2 y queda registrado como documento propio — aparece en
// "Documentos para MP" (misma lista que el costeo/informe generados).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, AlertTriangle, Wand2, FileText, ExternalLink, ChevronDown, ShieldAlert, ListChecks, Pencil, Check, GraduationCap } from 'lucide-react';
import { useToast } from '@/app/components/ui/toast';
import { AnexoFirmarPdf } from '@/app/components/AnexoFirmarPdf';

export interface AnexoDoc { id: number; nombre: string; url: string }

interface CampoCompletado { etiqueta: string; campo: string; valor: string; via: 'ia' | 'costeo' | 'bases' | 'ordenes_compra' | 'auditor'; formulario?: string; indice?: number }
interface PendienteCelda { id: string; etiqueta: string; formulario?: string; categoria?: string; motivo?: string }
interface PendienteInline {
  id: string; contexto: string; formulario?: string;
  parrafoCompleto?: string; posEnParrafo?: number; largoBlanco?: number;
  categoria?: string; motivo?: string;
}
type SegmentoCeldaUI =
  | { t: 'texto'; v: string }
  | { t: 'auto'; v: string; via: 'ia' | 'costeo' | 'bases' | 'ordenes_compra' | 'auditor'; etiqueta?: string; id?: string }
  | { t: 'input'; id: string };
interface CeldaTablaUI {
  texto: string; auto?: { valor: string; via: 'ia' | 'costeo' | 'bases' | 'ordenes_compra' | 'auditor'; etiqueta?: string; id?: string }; input?: { id: string };
  // Blanco inline DENTRO de una celda con texto propio ("SI ____ NO ____ declaro...") — ver el
  // mismo campo en anexos-rellenar.ts.
  segmentosInline?: SegmentoCeldaUI[];
}
interface TablaUI { filas: CeldaTablaUI[][]; formulario?: string; titulo?: string }
interface AlertaInadmisibilidad { riesgo: string; datoQueLoResuelve: string; disponible: boolean }
// Sección pegada como FOTO/ESCANEO (ver anexos-imagen-escaneada.ts) — nunca se autocompleta (no se
// puede editar una imagen); se muestra qué pide y con qué dato de la ficha, para copiarlo a mano.
interface CampoSeccionEscaneada { etiqueta: string; valor: string | null; campo: string | null }
interface SeccionEscaneada { titulo: string; campos: CampoSeccionEscaneada[]; ocrFallido: boolean }

// Réplica del documento en orden (ver anexos-documento-ui.ts en el backend, que arma esto
// recorriendo el .docx real): un bloque por cada párrafo o tabla, con su alineación/sangría/
// numeración reales y sus trozos de texto — para que el panel se lea EXACTAMENTE como el Word,
// con los blancos intercalados donde van, en vez de una lista de campos aparte.
type Alineacion = 'izquierda' | 'centro' | 'derecha' | 'justificado';
type SegmentoUI =
  | { t: 'texto'; v: string; negrita?: boolean; subrayado?: boolean }
  | { t: 'auto'; v: string; via: 'ia' | 'costeo' | 'bases' | 'ordenes_compra' | 'auditor'; etiqueta?: string; id?: string }
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
    // Todas las firmas de la empresa (migration-84) — el paso de firma muestra una miniatura
    // arrastrable por cada una. `firmaUrl` es la principal (el default de siempre).
    firmas?: { id: number; etiqueta: string; url: string; esPrincipal: boolean }[];
    lugares: { id: string; contexto: string; pideTimbre: boolean; porDefecto: string }[];
  };
  // El propio anexo dice que no nos corresponde presentarlo (ej. "si el oferente no es una UTP no
  // debe presentar este anexo"). Cuando viene, NADA se autocompletó — ver detectarAvisoNoAplica.
  avisoNoAplica?: { motivo: string; evidencia: string } | null;
  ordenFormularios?: string[]; // títulos en el orden del documento
  alertasInadmisibilidad?: AlertaInadmisibilidad[];
  checklistPendientes?: string[];
  faltantesFicha?: { campo: string; nombre: string; etiqueta: string; origen: 'ficha' | 'licitacion' }[];
  seccionesEscaneadas?: SeccionEscaneada[];
}

// Un valor que el motor completó solo, mostrado en su lugar dentro de la réplica del documento —
// clickeable para corregirlo. Pedido explícito del usuario (6-ago-2026, caso 4777-24-LE26 con
// "Calle"/"N°"/"Comuna" mal separados): "eso se debe aprender y que si sale otra igual logre
// rellenarla". Al corregir, la corrección se destila en una regla GENERAL por tipo de etiqueta
// (ver anexos-feedback.ts) — no queda atada a esta licitación — y se re-analiza el documento en el
// acto para que el mismo anexo también quede corregido, sin esperar al próximo.
//
// Sin `etiqueta` (algunos totales de costeo insertados directo por paraId, ver
// `rellenosPorParaId` en anexos-rellenar.ts) no hay con qué enseñarle una regla al motor — se
// muestra el valor igual, solo que sin el lápiz de corrección.
function CampoAuto({
  valor, via, etiqueta, codigo, onCorregido, prefijo, id, valorEditado, onEditar,
}: {
  valor: string; via: 'ia' | 'costeo' | 'bases' | 'ordenes_compra' | 'auditor'; etiqueta?: string; codigo: string;
  onCorregido: () => void; prefijo?: string;
  // `id` + `onEditar`: corregir el valor SOLO EN ESTE DOCUMENTO, sin enseñarle nada al motor
  // (pedido explícito del usuario, 1-sep-2026: "que nos deje editar las cosas que ponemos
  // automáticas... no para que aprenda a llenar sino para no cometer errores"). La corrección se
  // guarda en `respuestas[id]`, el mismo canal por donde viajan las casillas escritas a mano, y el
  // generador la respeta por encima de lo que él había resuelto.
  id?: string; valorEditado?: string; onEditar?: (id: string, valor: string) => void;
}) {
  const toast = useToast();
  const [editando, setEditando] = useState(false);
  // Lo que se muestra es la corrección si existe; si no, lo que resolvió el motor.
  const valorMostrado = valorEditado != null && valorEditado.trim() ? valorEditado : valor;
  const [valorNuevo, setValorNuevo] = useState(valorMostrado);
  const [guardando, setGuardando] = useState(false);
  const editable = !!(id && onEditar);
  const corregidoAMano = valorMostrado !== valor;

  // Guardar la corrección en el documento y nada más: no toca el motor, no enseña ninguna regla,
  // no re-analiza (re-analizar volvería a resolver la casilla y pisaría lo recién escrito).
  const guardarSoloAqui = () => {
    const nuevo = valorNuevo.trim();
    if (!nuevo || !id || !onEditar) return;
    onEditar(id, nuevo);
    setEditando(false);
  };
  // 'ordenes_compra' (14-ago-2026): candidato de experiencia sacado de una OC REAL nuestra —
  // mismo color de aviso que 'bases' (ámbar, no verde) a propósito: es un dato real, pero la
  // pertinencia frente a lo que ESTA licitación pide de experiencia la tiene que confirmar un
  // humano (ver el instructivo interno, punto 8 — "no basta con que exista una OC").
  // 'auditor' (21-ago-2026): sale del Auditor Técnico/Comercial YA APROBADO por el asesor — mismo
  // verde que 'ia' pero con su propia marca, es la fuente más autoritativa que hay (pasó por
  // Aprobaciones), no un dato adivinado.
  const colorClase = via === 'costeo' ? 'text-cyan-700' : via === 'bases' || via === 'ordenes_compra' ? 'text-amber-700' : via === 'auditor' ? 'text-violet-700' : 'text-emerald-700';

  // La corrección que además ENSEÑA: la casilla se corrige acá y el motor aprende la regla para
  // los próximos anexos. Es la de siempre, ahora explícita en su propio botón — antes era el único
  // camino, así que arreglar una errata puntual dejaba una regla aprendida que nadie pidió.
  const guardarCorreccion = async () => {
    const corregido = valorNuevo.trim();
    if (!corregido || !etiqueta) return;
    if (id && onEditar) onEditar(id, corregido);
    setGuardando(true);
    try {
      const r = await fetch('/api/anexos/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo, etiqueta, valorIA: valor, valorCorrecto: corregido }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.success) throw new Error(data.error || 'No se pudo guardar la corrección');
      // El backend responde si la corrección se pudo traducir a un campo de la ficha (`aplicable`).
      // Solo esas se aplican solas de aquí en adelante; el resto queda anotada pero la casilla hay
      // que seguir corrigiéndola a mano. Decirlo es el punto: hasta el 28-ago-2026 este mensaje
      // prometía el aprendizaje SIEMPRE, y en realidad no ocurría nunca (ver anexos-feedback.ts).
      if (data.aplicable) {
        toast.success('Corrección aprendida', 'De ahora en adelante una casilla con este nombre se va a llenar sola con ese dato de la ficha.');
      } else {
        toast.success('Corrección guardada', 'Quedó anotada, pero ese valor no es un dato de la ficha de la empresa: esta casilla se sigue completando a mano.');
      }
      setEditando(false);
      onCorregido();
    } catch (e: any) {
      toast.error('No se pudo guardar la corrección', e.message);
    } finally {
      setGuardando(false);
    }
  };

  if (editando) {
    return (
      <span className="inline-flex items-center gap-1 align-baseline">
        {prefijo && <span className="shrink-0 font-medium text-slate-600">{prefijo}</span>}
        <input
          type="text"
          value={valorNuevo}
          onChange={e => setValorNuevo(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { editable ? guardarSoloAqui() : guardarCorreccion(); }
            if (e.key === 'Escape') setEditando(false);
          }}
          autoFocus
          className="inline-block w-40 px-1 py-0.5 text-[12px] bg-white border border-indigo-300 rounded-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
        {editable && (
          <button
            type="button" disabled={!valorNuevo.trim()} onClick={guardarSoloAqui}
            title="Usar este valor en este documento (no enseña nada al sistema)"
            className="inline-flex items-center justify-center w-5 h-5 rounded bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white"
          >
            <Check size={10} />
          </button>
        )}
        {etiqueta && (
          <button
            type="button" disabled={guardando || !valorNuevo.trim()} onClick={guardarCorreccion}
            title="Usarlo acá Y enseñárselo al sistema para los próximos anexos"
            className="inline-flex items-center justify-center h-5 px-1.5 gap-0.5 rounded bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white text-[9.5px] font-bold"
          >
            {guardando ? <Loader2 size={10} className="animate-spin" /> : <GraduationCap size={10} />}
            aprender
          </button>
        )}
        <button
          type="button" onClick={() => { setEditando(false); setValorNuevo(valorMostrado); }} title="Cancelar"
          className="inline-flex items-center justify-center w-5 h-5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100"
        >
          <X size={10} />
        </button>
      </span>
    );
  }

  return (
    <span
      className={`group/campo inline-flex items-center gap-0.5 font-semibold ${corregidoAMano ? 'text-indigo-700 underline decoration-dotted' : colorClase} ${etiqueta || editable ? 'cursor-pointer' : ''}`}
      title={
        corregidoAMano ? 'Lo corregiste a mano para este documento — clic para volver a editarlo'
          : !etiqueta && !editable ? undefined
          : via === 'costeo' ? 'Precio cruzado con el costeo subido — clic para corregir'
          : via === 'auditor' ? 'Sacado del Auditor Técnico/Comercial ya aprobado por el asesor — clic para corregir'
          : via === 'bases' ? 'Sacado del texto de las Bases — clic para corregir'
          : via === 'ordenes_compra' ? 'Candidato de una Orden de Compra real nuestra — verifica que sea pertinente antes de presentar, clic para corregir'
          : 'Completado por IA — clic para corregir'
      }
      onClick={etiqueta || editable ? () => { setValorNuevo(valorMostrado); setEditando(true); } : undefined}
    >
      {prefijo ? `${prefijo} ${valorMostrado}` : valorMostrado}
      {via === 'costeo' && <span className="shrink-0 text-[9px] font-bold align-super">$</span>}
      {via === 'auditor' && <span className="shrink-0 text-[9px] font-bold align-super">auditor</span>}
      {via === 'bases' && <span className="shrink-0 text-[9px] font-bold align-super">bases</span>}
      {via === 'ordenes_compra' && <span className="shrink-0 text-[9px] font-bold align-super">OC</span>}
      {(etiqueta || editable) && <Pencil size={9} className="shrink-0 opacity-0 group-hover/campo:opacity-60 transition-opacity" />}
    </span>
  );
}

// Vista de tabla REAL: mismas filas/columnas que el Word, para que quede claro a qué celda
// corresponde cada input (pedido explícito del usuario tras probar la lista plana con un anexo
// económico real de 160 blancos sueltos — imposible saber cuál era cuál sin esto).
// Un blanco del documento ORIGINAL (panel izquierdo): la raya tal como venía en el Word, sin nada
// escrito. No es un input — ese panel es de solo lectura, está para comparar contra el de la
// derecha. El largo se acota para que una raya larguísima no descuadre la línea.
function BlancoOriginal({ largo }: { largo?: number }) {
  return (
    <span className="text-slate-400 select-none">{'_'.repeat(Math.min(40, Math.max(6, largo ?? 12)))}</span>
  );
}

function TablaReal({
  tabla, respuestas, onChange, codigo, onCorregido, modoOriginal = false,
}: {
  tabla: TablaUI; respuestas: Record<string, string>; onChange: (id: string, v: string) => void;
  codigo: string; onCorregido: () => void; modoOriginal?: boolean;
}) {
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
                  {modoOriginal ? (
                    // Panel izquierdo (documento original): la celda como vino — su texto fijo, y
                    // una raya donde haya algo por completar. Nunca un input ni un valor resuelto.
                    c.segmentosInline ? (
                      <span className="leading-relaxed">
                        {c.segmentosInline.map((s, k) => (
                          s.t === 'texto'
                            ? <span key={k}>{s.v}</span>
                            : <BlancoOriginal key={k} largo={s.t === 'auto' ? s.v.length : undefined} />
                        ))}
                      </span>
                    ) : c.input || c.auto ? (
                      <span>{c.texto}<BlancoOriginal largo={c.auto?.valor.length} /></span>
                    ) : (
                      <span className="text-slate-700">{c.texto}</span>
                    )
                  ) : c.segmentosInline ? (
                    // Celda con texto propio que trae un blanco INLINE adentro ("SI ____ NO ____
                    // declaro...", "Plazo de entrega ……… días hábiles") — antes se mostraba como
                    // texto fijo de solo lectura, el blanco desaparecía. Mismo tipo de segmento
                    // que la réplica de párrafo (BloqueParrafo), pero en línea dentro de la celda.
                    <span className="leading-relaxed">
                      {c.segmentosInline.map((s, k) => {
                        if (s.t === 'texto') return <span key={k}>{s.v}</span>;
                        if (s.t === 'auto') {
                          return (
                            <CampoAuto
                              key={k} valor={s.v} via={s.via} etiqueta={s.etiqueta} codigo={codigo} onCorregido={onCorregido}
                              id={s.id} valorEditado={s.id ? respuestas[s.id] : undefined} onEditar={onChange}
                            />
                          );
                        }
                        return (
                          <input
                            key={k}
                            type="text"
                            value={respuestas[s.id] || ''}
                            onChange={e => onChange(s.id, e.target.value)}
                            placeholder="…"
                            className="inline-block w-20 mx-0.5 px-1 py-0.5 text-[11.5px] bg-indigo-50/50 border-0 border-b-2 border-indigo-300 rounded-sm focus:outline-none focus:bg-indigo-50 focus:border-indigo-500"
                          />
                        );
                      })}
                    </span>
                  ) : c.input ? (
                    <div className="flex items-center gap-1">
                      {/* Prefijo ya escrito en el Word (ej. "$") — el valor va PEGADO después, así
                          que se muestra para que el usuario sepa que no debe repetirlo. */}
                      {c.texto && <span className="shrink-0 font-medium text-slate-600">{c.texto}</span>}
                      <input
                        type="text"
                        value={respuestas[c.input.id] || ''}
                        onChange={e => onChange(c.input!.id, e.target.value)}
                        placeholder="…"
                        className="w-full min-w-0 text-[11.5px] px-1.5 py-1 border border-indigo-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
                      />
                    </div>
                  ) : c.auto ? (
                    // Prefijo ya escrito en el Word (ej. "$"), si lo hay — igual criterio que la
                    // celda con input de al lado.
                    <CampoAuto
                      valor={c.auto.valor} via={c.auto.via} etiqueta={c.auto.etiqueta} prefijo={c.texto || undefined}
                      codigo={codigo} onCorregido={onCorregido}
                      id={c.auto.id} valorEditado={c.auto.id ? respuestas[c.auto.id] : undefined} onEditar={onChange}
                    />
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
//
// La firma/timbre NUNCA se posicionan acá (ver AnexoFirmarPdf): un .docx es texto que fluye, sin
// coordenadas de píxel, así que no hay forma de "soltarla donde uno quiere" con precisión real
// sobre esta réplica. Hubo una versión (29-ago-2026, misma sesión) que dejaba soltarla sobre el
// lugar detectado dentro de esta vista — se retiró antes de llegar a producción: el pedido real
// del usuario ("moverla por toda la hoja, como ecert Chile") solo se puede cumplir sobre un PDF
// con página fija, y tener DOS mecanismos de arrastre (uno acá que no hace nada al generar, otro
// en el paso de firma que sí) es peor que tener uno solo.
function BloqueParrafo({ b, respuestas, onChange, motivoPorId, codigo, onCorregido, modoOriginal = false }: {
  b: BloqueParrafoUI; respuestas: Record<string, string>; onChange: (id: string, v: string) => void;
  motivoPorId: Map<string, string>; codigo: string; onCorregido: () => void;
  // Panel IZQUIERDO: el documento como VINO, sin nada completado — misma estructura de bloques que
  // el de la derecha (por eso reusa este mismo componente y no otro), así los dos paneles tienen
  // exactamente los mismos párrafos en el mismo orden y el scroll sincronizado calza de verdad.
  modoOriginal?: boolean;
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
        if (modoOriginal) return <BlancoOriginal key={i} largo={s.t === 'input' ? s.largo : s.v.length} />;
        if (s.t === 'auto') {
          return (
            <CampoAuto
              key={i} valor={s.v} via={s.via} etiqueta={s.etiqueta} codigo={codigo} onCorregido={onCorregido}
              id={s.id} valorEditado={s.id ? respuestas[s.id] : undefined} onEditar={onChange}
            />
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
function DocumentoReplica({ documento, respuestas, onChange, motivoPorId, codigo, onCorregido, modoOriginal = false }: {
  documento: BloqueUI[]; respuestas: Record<string, string>; onChange: (id: string, v: string) => void;
  motivoPorId: Map<string, string>; codigo: string; onCorregido: () => void; modoOriginal?: boolean;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
      {documento.map((bloque, i) => bloque.tipo === 'tabla'
        ? <div key={i} className="my-2.5"><TablaReal tabla={bloque.tabla} respuestas={respuestas} onChange={onChange} codigo={codigo} onCorregido={onCorregido} modoOriginal={modoOriginal} /></div>
        : <BloqueParrafo key={i} b={bloque} respuestas={respuestas} onChange={onChange} motivoPorId={motivoPorId} codigo={codigo} onCorregido={onCorregido} modoOriginal={modoOriginal} />)}
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

// FALTA EN LA FICHA — lo primero que hay que arreglar, y lo único que se arregla UNA sola vez.
//
// Estas son casillas que el motor SÍ reconoció (sabe exactamente qué dato piden), pero cuyo dato
// está vacío en la ficha de la empresa. Antes del 28-ago-2026 no existía esta distinción: se
// mezclaban con las casillas que el motor no entiende, bajo el motivo "la etiqueta no corresponde
// a ningún dato de la ficha" — que decía justo lo contrario de lo que pasaba. El hueco se
// descubría al abrir el .docx ya generado, y había que rehacer el anexo entero.
//
// Va ARRIBA de todo y antes del botón a propósito: completar la ficha una vez arregla esta
// casilla en ESTE anexo y en todos los que vengan, sin volver a generar nada.
function FaltaEnLaFicha({ campos }: { campos: { campo: string; nombre: string; etiqueta: string; origen: 'ficha' | 'licitacion' }[] }) {
  // Dos causas distintas con dos soluciones distintas, así que se muestran por separado: los datos
  // de la FICHA se completan una vez en /empresas; los de la LICITACIÓN los trae Mercado Público en
  // cada análisis y, si faltan, es que MP no respondió — ahí lo que corresponde es reintentar, no
  // ir a llenar un campo que no existe en esa pantalla.
  const deFicha = campos.filter(c => c.origen !== 'licitacion');
  const deLicitacion = campos.filter(c => c.origen === 'licitacion');
  if (!campos.length) return null;

  const Lista = ({ items }: { items: typeof campos }) => (
    <ul className="space-y-0.5 pl-1">
      {items.map(c => (
        <li key={c.campo} className="text-[11.5px] text-amber-900 leading-snug">
          <span className="font-semibold">{c.nombre}</span>
          {c.etiqueta && <span className="text-amber-700"> — lo pide la casilla “{c.etiqueta.slice(0, 60)}”</span>}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-2">
      {deFicha.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[12px] font-bold text-amber-800 mb-1">
            <AlertTriangle size={13} className="flex-shrink-0" />
            {deFicha.length === 1 ? 'Falta 1 dato en la ficha de la empresa' : `Faltan ${deFicha.length} datos en la ficha de la empresa`}
          </p>
          <p className="text-[11.5px] text-amber-700 mb-1.5 leading-snug">
            Este anexo los pide y el motor sabe exactamente dónde van. Complétalos en{' '}
            <a href="/empresas" target="_blank" rel="noreferrer" className="font-semibold underline">Empresas</a>{' '}
            y vuelve a abrir esta pantalla: se llenan solos, acá y en todos los anexos que vengan.
          </p>
          <Lista items={deFicha} />
        </div>
      )}
      {deLicitacion.length > 0 && (
        <div className="rounded-lg border border-orange-300 bg-orange-50 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[12px] font-bold text-orange-800 mb-1">
            <AlertTriangle size={13} className="flex-shrink-0" />
            No se pudieron leer {deLicitacion.length} dato(s) de la licitación desde Mercado Público
          </p>
          <p className="text-[11.5px] text-orange-700 mb-1.5 leading-snug">
            Estos NO se completan en Empresas: los trae Mercado Público cada vez que se abre el anexo.
            Cierra esta pantalla y vuelve a abrirla para reintentar antes de generar.
          </p>
          <Lista items={deLicitacion} />
        </div>
      )}
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

// Sección del anexo pegada como FOTO/ESCANEO (ver anexos-imagen-escaneada.ts): no hay texto real
// que autocompletar (no se puede editar una imagen), así que se le muestra al usuario QUÉ pide el
// formulario y CON QUÉ DATO de su ficha lo llenaría, para copiarlo a mano — a papel, o al portal
// externo del organismo si el propio documento dice que corresponde presentarlo aparte.
function SeccionesEscaneadas({ secciones }: { secciones: SeccionEscaneada[] }) {
  if (!secciones.length) return null;
  return (
    <div className="space-y-2">
      {secciones.map((s, i) => (
        <div key={i} className="rounded-lg border border-indigo-200 bg-indigo-50/70 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[12px] font-bold text-indigo-800 mb-1">
            <AlertTriangle size={13} className="flex-shrink-0" /> Esta sección es una imagen escaneada — {s.titulo}
          </p>
          <p className="text-[11.5px] text-indigo-700 mb-1.5">
            No se puede rellenar automáticamente (no hay texto que editar, es una foto). Complétala a mano con estos datos:
          </p>
          {s.ocrFallido ? (
            <p className="text-[11.5px] text-indigo-600 italic">No se pudo leer la imagen (falló el OCR). Revísala directamente en el documento.</p>
          ) : s.campos.length === 0 ? (
            <p className="text-[11.5px] text-indigo-600 italic">No se identificaron casillas — revísala directamente en el documento.</p>
          ) : (
            <ul className="space-y-0.5 pl-1">
              {s.campos.map((c, j) => (
                <li key={j} className="text-[11.5px] text-indigo-900 leading-snug">
                  <span className="font-semibold">{c.etiqueta}:</span>{' '}
                  {c.valor
                    ? <span className="text-indigo-700">{c.valor}</span>
                    : <span className="text-indigo-400 italic">complétalo tú (no es un dato de tu ficha)</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Firma y timbre: aviso, la posición se elige en el paso siguiente (sobre el PDF) ──────────
// Historia: primero 4 botones (firma+timbre / solo firma / solo timbre / ninguna) + 3 de posición.
// Se quitaron el 13-ago-2026 (pedido del usuario: "que el programa lo detecte automático y lo
// ponga, no dejar que yo seleccione") y el backend pasó a estampar solo con `porDefectoEnLugar`.
// El 29-ago-2026 (pedido explícito, en sentido contrario: "moverla por toda la hoja, como ecert
// Chile") se intentó primero arrastrar sobre esta MISMA réplica del Word — se retiró en la misma
// sesión: un .docx no tiene coordenadas de píxel, así que "donde la suelto, ahí queda" con
// precisión real solo se puede lograr sobre un PDF de página fija. Ver AnexoFirmarPdf — ese
// componente (no este panel) es donde de verdad se arrastra la firma/timbre.
function BloqueFirmaTimbre({ firma }: { firma: Analisis['firma'] }) {
  const hayAlgunaImagen = !!firma.firmaUrl || !!firma.timbreUrl;
  const cuantasFirmas = firma.firmas?.length ?? 0;
  return (
    <div className="border border-slate-200 rounded-xl p-3 space-y-1.5">
      <p className="text-[12.5px] font-semibold text-slate-700">Firma y timbre</p>
      <p className="text-[11.5px] text-slate-500 leading-snug">
        {hayAlgunaImagen
          ? (cuantasFirmas > 1
            ? `Este documento pide firma/timbre. En el paso siguiente eliges cuál de las ${cuantasFirmas} firmas de la empresa va en cada lugar y la ubicas donde quieras, sobre el PDF ya generado.`
            : 'Este documento pide firma/timbre. Vas a poder ubicarlas exactamente donde quieras en el paso siguiente, sobre el PDF ya generado.')
          : <>No hay firma ni timbre cargados en la ficha de la empresa — súbelos en <strong>/empresas</strong> para poder colocarlas.</>}
      </p>
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
  // Paso de firma libre sobre PDF (ver AnexoFirmarPdf) — solo existe cuando el documento tiene
  // al menos un lugar de firma/timbre detectado. `pdfParaFirmar` se pide recién al pulsar
  // "Continuar", nunca antes: convertir a PDF cuesta una llamada al conversor y no tiene sentido
  // pagarla si el usuario todavía está corrigiendo campos de texto.
  const [paso, setPaso] = useState<'formulario' | 'firma'>('formulario');
  const [pdfParaFirmar, setPdfParaFirmar] = useState<ArrayBuffer | null>(null);
  const [cargandoPdf, setCargandoPdf] = useState(false);
  // Scroll acoplado entre los dos paneles (original ↔ completado). Se sincroniza por PROPORCIÓN
  // (cuánto del alto total llevás recorrido), no por píxeles: los dos paneles tienen los mismos
  // bloques pero no exactamente el mismo alto — un input o un valor largo ocupan un poco más que la
  // raya del original — así que copiar el scrollTop crudo los iría desfasando hacia el final.
  // `sincronizando` corta el rebote: mover un panel dispara el onScroll del otro, que si no
  // quedaría reposicionando al primero en un ida y vuelta infinito.
  const panelOriginalRef = useRef<HTMLDivElement>(null);
  const panelRellenoRef = useRef<HTMLDivElement>(null);
  const sincronizando = useRef(false);
  const sincronizarScroll = (
    desde: React.RefObject<HTMLDivElement | null>, hacia: React.RefObject<HTMLDivElement | null>,
  ) => {
    if (sincronizando.current) return;
    const a = desde.current;
    const b = hacia.current;
    if (!a || !b) return;
    const recorribleA = a.scrollHeight - a.clientHeight;
    const recorribleB = b.scrollHeight - b.clientHeight;
    if (recorribleA <= 0 || recorribleB <= 0) return;
    sincronizando.current = true;
    b.scrollTop = (a.scrollTop / recorribleA) * recorribleB;
    // El navegador dispara el onScroll del otro panel de forma asíncrona — se libera el candado en
    // el siguiente frame, cuando ese evento ya pasó.
    requestAnimationFrame(() => { sincronizando.current = false; });
  };
  // "Sí, este anexo nos corresponde": ignora el aviso del propio documento (ej. es de UTP y esta
  // vez sí postulamos en UTP). Re-dispara el análisis, y viaja también en `respuestas` para que la
  // generación tome la misma decisión que la pantalla mostró.
  const [forzarAplica, setForzarAplica] = useState(false);

  useEffect(() => { setForzarAplica(false); setPaso('formulario'); setPdfParaFirmar(null); }, [doc]);

  useEffect(() => {
    if (!doc) return;
    setCargando(true);
    setError(null);
    setAnalisis(null);
    setRespuestas(forzarAplica ? { anexoAplica: '1' } : {});

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
    if (forzarAplica) params.set('aplica', '1');
    fetch(`/api/anexos/analizar?${params}`)
      .then(async r => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.success) throw new Error(data.error || 'No se pudo analizar el documento');
        setAnalisis(data);
      })
      .catch(e => setError(e.message || 'Error al analizar el documento'))
      .finally(() => setCargando(false));

    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
  }, [doc, codigo, empresaId, onClose, forzarAplica]);

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

  // Tras guardar una corrección (ver CampoAuto), se re-analiza el documento EN EL ACTO — la regla
  // recién aprendida ya se inyecta en este mismo re-análisis (ver cargarReglasAprendidasAnexo en
  // anexos-rellenar.ts), así que lo más probable es que la casilla corregida salga bien esta vez.
  // A propósito NO toca `respuestas`: lo que el usuario ya tecleó a mano en los pendientes se
  // mantiene igual, solo se refresca lo que decidió la IA.
  const recargarAnalisis = async () => {
    if (!doc || !empresaId) return;
    try {
      const params = new URLSearchParams({ codigo, documentoId: String(doc.id), empresaId: String(empresaId) });
      if (forzarAplica) params.set('aplica', '1');
      const r = await fetch(`/api/anexos/analizar?${params}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.success) throw new Error(data.error || 'No se pudo re-analizar el documento');
      setAnalisis(data);
    } catch (e: any) {
      toast.error('No se pudo actualizar la vista', e.message);
    }
  };

  // Compartido entre el camino .docx directo y el camino PDF firmado: mismo toast, mismo aviso de
  // firma/timbre que no se pudo descargar, mismo cierre del modal. El camino firmado no manda
  // completados/respondidos (no regenera el texto, ver generar-firmado/route.ts) — se omite esa
  // parte del mensaje en vez de mostrar "undefined campos".
  const avisarYCerrar = (data: any) => {
    const resumenCampos = typeof data.completados === 'number' && typeof data.respondidos === 'number'
      ? `${data.completados} campo${data.completados !== 1 ? 's' : ''} automático${data.completados !== 1 ? 's' : ''} · ${data.respondidos} manual${data.respondidos !== 1 ? 'es' : ''} — `
      : '';
    toast.success(
      data.dividido ? `${data.archivos?.length || 0} formularios generados` : 'Anexo generado',
      `${resumenCampos}disponible${data.dividido ? 's' : ''} en Documentos para MP`,
    );
    const avisos: string[] = Array.isArray(data.avisos) ? data.avisos : [];
    if (avisos.length > 0) toast.warning('Revisa antes de enviar', avisos.join(' '));
    onGenerado(data.archivos || []);
    onClose();
  };

  // btoa espera una cadena "binaria" (un char por byte) — se arma leyendo el ArrayBuffer en
  // trozos para no romper con call stack overflow en PDFs grandes (String.fromCharCode con un
  // array gigante de una sola vez puede reventar el límite de argumentos del motor JS).
  const arrayBufferABase64 = (buf: ArrayBuffer): string => {
    const bytes = new Uint8Array(buf);
    let binario = '';
    const TAMANO_TROZO = 0x8000;
    for (let i = 0; i < bytes.length; i += TAMANO_TROZO) {
      binario += String.fromCharCode(...bytes.subarray(i, i + TAMANO_TROZO));
    }
    return btoa(binario);
  };

  // Camino de siempre: el documento no tiene ningún lugar de firma/timbre detectado, así que no
  // hay nada que posicionar — se genera el .docx directo, sin pasar por el paso de firma sobre PDF.
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
      avisarYCerrar(data);
    } catch (e: any) {
      toast.error('No se pudo generar el anexo', e.message);
    } finally {
      setGenerando(false);
    }
  };

  // El documento SÍ tiene firma/timbre que posicionar: en vez de generar directo, se pide la
  // vista previa en PDF (texto ya puesto, sin firma) y se pasa al paso de firma libre.
  const handleContinuarAFirma = async () => {
    setCargandoPdf(true);
    try {
      const r = await fetch('/api/anexos/vista-previa-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo, documentoId: doc.id, empresaId, respuestas }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo preparar el PDF para firmar');
      }
      setPdfParaFirmar(await r.arrayBuffer());
      setPaso('firma');
    } catch (e: any) {
      toast.error('No se pudo pasar al paso de firma', e.message);
    } finally {
      setCargandoPdf(false);
    }
  };

  const handleGenerarFirmado = async (estampas: { tipo: 'firma' | 'timbre'; pagina: number; xPct: number; yPct: number; anchoPct: number }[]) => {
    if (!pdfParaFirmar) return;
    setGenerando(true);
    try {
      // Se manda el MISMO PDF que el usuario tenía delante al posicionar (nunca se regenera del
      // lado del servidor) — BUG REAL (29-ago-2026, reportado con video): regenerar el .docx→PDF
      // una segunda vez para el paso final no garantiza la MISMA paginación que la vista previa, y
      // el porcentaje guardado terminaba apuntando a otro lugar de la página ("no tiene
      // coherencia"). Ver el comentario largo en generar-firmado/route.ts.
      const pdfBase64 = arrayBufferABase64(pdfParaFirmar);
      const r = await fetch('/api/anexos/generar-firmado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo, documentoId: doc.id, empresaId, pdfBase64, estampas }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.success) throw new Error(data.error || 'No se pudo generar el documento firmado');
      avisarYCerrar(data);
    } catch (e: any) {
      toast.error('No se pudo generar el anexo firmado', e.message);
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

        {paso === 'firma' && pdfParaFirmar ? (
          <AnexoFirmarPdf
            pdfBytes={pdfParaFirmar}
            firmaUrl={analisis?.firma.firmaUrl ?? null}
            timbreUrl={analisis?.firma.timbreUrl ?? null}
            firmas={analisis?.firma.firmas ?? []}
            generando={generando}
            onConfirmar={handleGenerarFirmado}
            onVolver={() => setPaso('formulario')}
          />
        ) : (
        <>
        {/* Cuerpo: documento ORIGINAL a la izquierda, documento COMPLETADO a la derecha */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
          {/* Panel izquierdo: el anexo TAL COMO VINO. Antes era un <iframe> al visor de Office
              Online de Microsoft; se reemplazó (13-ago-2026, pedido del usuario) porque ese visor es
              de OTRO dominio y el navegador no deja leer ni mover su scroll desde acá — sincronizar
              los dos paneles era imposible por diseño, no por falta de código. Renderizando el
              original con la MISMA réplica que la derecha (`modoOriginal`), los dos paneles tienen
              exactamente los mismos bloques en el mismo orden y el scroll sí se puede acoplar.
              El Word real sigue a un clic, en el botón de la cabecera. */}
          <div
            ref={panelOriginalRef}
            onScroll={() => sincronizarScroll(panelOriginalRef, panelRellenoRef)}
            className="w-full lg:w-[40%] h-64 lg:h-full overflow-y-auto bg-slate-100 border-b lg:border-b-0 lg:border-r border-slate-200 flex-shrink-0 px-3 py-4"
          >
            {cargando && (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
                <Loader2 size={16} className="animate-spin text-indigo-500" /> Cargando documento…
              </div>
            )}
            {!cargando && analisis && analisis.documento.length > 0 && (
              <>
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Documento original</p>
                <DocumentoReplica
                  documento={analisis.documento} respuestas={{}} onChange={() => {}} motivoPorId={motivoPorId}
                  codigo={codigo} onCorregido={() => {}} modoOriginal
                />
              </>
            )}
            {!cargando && (!analisis || analisis.documento.length === 0) && (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <FileText size={20} className="text-slate-300" />
                <p className="text-[12px] text-slate-500">No se pudo reconstruir la vista del documento.</p>
                <a
                  href={doc.url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-[12px] font-semibold rounded-lg transition-colors"
                >
                  <ExternalLink size={12} /> Abrir el Word original
                </a>
              </div>
            )}
          </div>

          {/* Formulario — `min-w-0` es OBLIGATORIO acá: en una fila flex un item vale por defecto
              `min-width: auto`, o sea NO puede encogerse por debajo de su contenido. Con el visor
              de al lado en `flex-shrink-0 w-1/2`, esta columna se desbordaba fuera del modal y los
              inputs quedaban cortados por el borde derecho de la pantalla. */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        <div
          ref={panelRellenoRef}
          onScroll={() => sincronizarScroll(panelRellenoRef, panelOriginalRef)}
          className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
        >
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
              {analisis.faltantesFicha && analisis.faltantesFicha.length > 0 && (
                <FaltaEnLaFicha campos={analisis.faltantesFicha} />
              )}
              {analisis.alertasInadmisibilidad && analisis.alertasInadmisibilidad.length > 0 && (
                <AlertasInadmisibilidad alertas={analisis.alertasInadmisibilidad} />
              )}
              {analisis.checklistPendientes && analisis.checklistPendientes.length > 0 && (
                <ChecklistPendientes items={analisis.checklistPendientes} />
              )}
              {analisis.seccionesEscaneadas && analisis.seccionesEscaneadas.length > 0 && (
                <SeccionesEscaneadas secciones={analisis.seccionesEscaneadas} />
              )}
              {analisis.firma.detectada && !analisis.firma.disponible && (
                <div className="flex items-start gap-2.5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-[12.5px] text-amber-800">
                    Este documento tiene línea de firma, pero la empresa no tiene una firma escaneada cargada — no hay nada que arrastrar.
                    Súbela en <strong>/empresas</strong> (sección "Firma escaneada") para poder colocarla.
                  </p>
                </div>
              )}
              {analisis.firma.timbreDetectado && !analisis.firma.timbreDisponible && (
                <div className="flex items-start gap-2.5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-[12.5px] text-amber-800">
                    Este documento pide <strong>firma y timbre</strong>, pero esta empresa no tiene un timbre cargado — solo puedes arrastrar la firma.
                    Súbelo en <strong>/empresas</strong> (sección "Timbre digital") para poder colocarlo también.
                  </p>
                </div>
              )}

              {analisis.avisoNoAplica && (
                <div className="flex items-start gap-2.5 px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl">
                  <ShieldAlert size={15} className="text-rose-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 space-y-1.5">
                    <p className="text-[12.5px] text-rose-900 font-semibold">Este anexo no corresponde presentarlo</p>
                    <p className="text-[12.5px] text-rose-800">{analisis.avisoNoAplica.motivo}</p>
                    <p className="text-[11.5px] text-rose-700 italic border-l-2 border-rose-300 pl-2">
                      El documento dice: “{analisis.avisoNoAplica.evidencia}”
                    </p>
                    <p className="text-[11.5px] text-rose-700">
                      Por eso no se completó ningún dato ni se estampó la firma: entregar este anexo a medio llenar es peor que no entregarlo.
                    </p>
                    <button
                      type="button"
                      onClick={() => setForzarAplica(true)}
                      className="text-[11.5px] font-medium px-2.5 py-1 rounded-md border border-rose-300 bg-white text-rose-700 hover:bg-rose-100 transition"
                    >
                      Sí nos corresponde — completar igual
                    </button>
                  </div>
                </div>
              )}

              {analisis.firma.lugares?.length > 0 && (
                <BloqueFirmaTimbre firma={analisis.firma} />
              )}

              {totalPendientes === 0 && analisis.completadosAuto.length > 0 && (
                <p className="text-[12px] text-slate-400">No quedan campos pendientes por completar a mano.</p>
              )}

              {analisis.documento.length > 0 ? (
                <DocumentoReplica
                  documento={analisis.documento} respuestas={respuestas} onChange={setRespuesta} motivoPorId={motivoPorId}
                  codigo={codigo} onCorregido={recargarAnalisis}
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
        {!cargando && !error && analisis && (analisis.completadosAuto.length > 0 || totalPendientes > 0 || analisis.firma.lugares.length > 0) && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 bg-slate-50 flex-shrink-0">
            <p className="text-[11px] text-slate-400">
              {totalPendientes > 0 ? `${totalRespondidas}/${totalPendientes} respondidos (opcional)` : 'Listo para generar'}
            </p>
            {analisis.firma.lugares.length > 0 ? (
              <button
                type="button"
                onClick={handleContinuarAFirma}
                disabled={generando || cargandoPdf}
                className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 px-4 py-2 rounded-lg transition-colors"
              >
                {cargandoPdf
                  ? <><Loader2 size={13} className="animate-spin" /> Preparando PDF…</>
                  : <><Wand2 size={13} /> Continuar a firma</>}
              </button>
            ) : (
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
            )}
          </div>
        )}
          </div>
        </div>
        </>
        )}
      </div>
    </div>,
    document.body,
  );
}
