'use client';

// SECCIÓN "INFORMACIÓN COMERCIAL" — el Auditor Técnico.
//
// El asistente arma la oferta (precio, respaldo técnico, anexos con los datos de la empresa) y
// el asesor VISA punto por punto. El checklist no se escribe a mano: sale del informe de
// viabilidad, así que cada fila trae su ponderación, su criticidad y la cita a las bases —
// el asesor ve, al lado del check, cuántos puntos se juega ahí.
//
// Los 3 bloques NO se trabajan al mismo tiempo (ver tieneAnexosAuditor en checklist-comercial.ts):
// COMERCIAL (precio/plazo) es lo PRIMERO, apenas se asigna la licitación y corre la viabilidad —
// ahí el asesor fija el precio. ADMINISTRATIVO/TECNICO (los anexos) recién se muestran cuando la
// licitación entra a la etapa ANEXOS — ya están generados desde antes, solo colapsados hasta
// entonces.
//
// Tiempo real: cualquier carga o visado se refleja al instante en la pantalla del otro (SSE).
import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '@/app/components/ui/toast';
import { useConfirm } from '@/app/components/ui/confirm';
import { Banner } from '@/app/components/ui/Banner';
import { Select } from '@/app/components/ui/Select';
import { useRealtime } from '@/app/lib/use-realtime';
import { useSession } from '@/app/lib/session-context';
import { DocumentViewerModal, type VisorDoc } from '@/app/components/DocumentViewerModal';
import { AnexoRellenoModal, type AnexoDoc } from '@/app/components/AnexoRellenoModal';
import type { DecisionGeneracion, DocumentoCandidato } from '@/app/lib/auditor-generacion';
import { SelectorDocumentoAnexo } from '@/app/components/SelectorDocumentoAnexo';
import { repartirArchivosGenerados } from '@/app/lib/anexos-match';
import { FilaLineaTecnica } from './FilaLineaTecnica';
import { MotorComercialCard } from './MotorComercialCard';
import { ModalAuditorLineaTecnica } from '@/app/components/ModalAuditorLineaTecnica';
import {
  tieneAnexosAuditor, CLAVE_ITEM_PLAZO, rangoPlazoDeDescripcion, validarPlazoOfertado,
} from '@/app/lib/checklist-comercial';
import {
  ShieldCheck, Building2, Check, X, Upload, Loader2, AlertTriangle, Copy,
  FileText, DollarSign, Wrench, ClipboardCheck, RefreshCw, Undo2, Sparkles,
  Eye, Download, Trash2, History, FileStack,
} from 'lucide-react';

// ── Tipos (espejo de lo que devuelve /api/negocios/[id]/comercial) ──────────────
interface Documento {
  id: number;
  url: string;
  nombre: string;
  subidoPorNombre: string | null;
  subidoAt: string | null;
}

interface ResumenTecnico { total: number; cumplen: number; noCumplen: number; conComplemento: number; sinEvaluar: number; pendientesProveedor: number }

interface CausalBloqueo { codigo: string; descripcion: string; rutaDesbloqueo: string }
type Semaforo = 'VERDE' | 'AMARILLO' | 'ROJO';

interface Item {
  id: number;
  bloque: 'ADMINISTRATIVO' | 'TECNICO' | 'COMERCIAL';
  tipo: 'documento' | 'dato' | 'precio' | 'linea_tecnica';
  clave_origen: string | null;
  titulo: string;
  descripcion: string | null;
  criticidad: string;
  ponderacion: number | null;
  fuente_cita: string | null;
  generable: boolean;
  linea_numero: number | null;
  ofertamos: boolean | null;
  estado: 'PENDIENTE' | 'CARGADO' | 'APROBADO' | 'OBSERVADO';
  valor_texto: string | null;
  valor_numero: number | null;
  documentos: Documento[];
  observacion: string | null;
  cargado_por_nombre: string | null;
  cargado_at: string | null;
  aprobado_por_nombre: string | null;
  aprobado_at: string | null;
  resumen_tecnico: ResumenTecnico | null;
}

interface Resumen {
  total: number; aprobados: number; porAprobar: number; pendientes: number;
  observados: number; bloqueantesPendientes: number; listoParaPostular: boolean; avance: number;
}

/** "$0.42 USD · 63 llamadas". Se muestra con 2 decimales: bajo eso el número no dice nada útil. */
function textoCosto(c?: { llamadas: number; usd: number } | null): string | null {
  if (!c || c.llamadas === 0) return null;
  return `~$${c.usd < 0.01 ? c.usd.toFixed(4) : c.usd.toFixed(2)} USD · ${c.llamadas} llamada(s) de IA`;
}

/** Resultado de una línea dentro de la comparación masiva. */
interface ResultadoMasivoLinea {
  lineaNumero: number; itemId: number; titulo: string;
  total: number; cumplen: number; noCumplen: number;
  fuenteRequisitos?: 'ya_clasificadas' | 'informe' | 'bases_tecnicas' | null;
  segmentada?: boolean; error?: string;
}

/** Trabajo de fondo de "Comparar contra un documento" (ver migración 70). */
interface JobMasivo {
  estado: 'procesando' | 'listo' | 'error';
  fase: string | null;
  documento: string | null;
  total: number; procesadas: number;
  error: string | null;
  elapsedSeg: number;
  costo?: { llamadas: number; tokensIn: number; tokensOut: number; usd: number };
  resumen: {
    documento: string; lineasTotales: number; lineasComparadas: number;
    bloquesFicha: number; resultados: ResultadoMasivoLinea[];
    costo?: { llamadas: number; tokensIn: number; tokensOut: number; usd: number };
  } | null;
}

interface Empresa {
  id: number; razon_social: string; rut: string; direccion: string | null; region: string | null;
  giro: string | null; tipo_persona_juridica: string | null;
  representante_nombre: string | null; representante_rut: string | null; representante_cargo: string | null;
  email1: string | null; telefono1: string | null;
  banco_tipo_cuenta: string | null; banco_numero: string | null; banco_nombre: string | null;
}

const BLOQUES = [
  { key: 'ADMINISTRATIVO', label: 'Administrativo', icon: FileText,   hint: 'Anexos y garantías — se llenan con los datos de la empresa' },
  { key: 'TECNICO',        label: 'Técnico',        icon: Wrench,     hint: 'Respaldo de los criterios con que nos evalúan' },
  { key: 'COMERCIAL',      label: 'Comercial',      icon: DollarSign, hint: 'Precio y plazo ofertados' },
] as const;

/**
 * ¿Esta fila va abajo, en "Alertas de cumplimiento", o dentro de su bloque?
 * Regla: arriba solo lo que se prepara y se adjunta (anexos, formularios, precios, líneas
 * técnicas) más el plazo ofertado, que se compromete junto al precio. Todo lo demás tipo 'dato'
 * (cotizar el 100%, garantías post-adjudicación, criterios sin documento propio, bloqueantes)
 * es una condición a tener presente y baja al final.
 */
function esAlerta(i: { tipo: string; clave_origen?: string | null }): boolean {
  return i.tipo === 'dato' && i.clave_origen !== CLAVE_ITEM_PLAZO;
}

const CRIT_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  ADMISIBILIDAD_DURA:    { bg: 'bg-rose-100',    text: 'text-rose-700',    label: 'Admisibilidad' },
  PUNTAJE_CONDICIONANTE: { bg: 'bg-amber-100',   text: 'text-amber-700',   label: 'Puntaje' },
  COMPROMISO_EJECUCION:  { bg: 'bg-sky-100',     text: 'text-sky-700',     label: 'Ejecución' },
  INFORMATIVO:           { bg: 'bg-zinc-100',    text: 'text-zinc-500',    label: 'Informativo' },
};

// Semáforo del Auditor Técnico (spec §9.4) — ver app/lib/semaforo-auditor.ts para las reglas.
const SEMAFORO_BADGE: Record<'VERDE' | 'AMARILLO' | 'ROJO', { bg: string; text: string; label: string }> = {
  VERDE:    { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Verde' },
  AMARILLO: { bg: 'bg-amber-100',   text: 'text-amber-700',   label: 'Amarillo' },
  ROJO:     { bg: 'bg-rose-100',    text: 'text-rose-700',    label: 'Rojo' },
};

const ESTADO_STYLE: Record<Item['estado'], { bg: string; text: string; label: string }> = {
  PENDIENTE: { bg: 'bg-zinc-100',    text: 'text-zinc-500',    label: 'Pendiente' },
  CARGADO:   { bg: 'bg-indigo-100',  text: 'text-indigo-700',  label: 'Por aprobar' },
  APROBADO:  { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Aprobado' },
  OBSERVADO: { bg: 'bg-orange-100',  text: 'text-orange-700',  label: 'Observado' },
};

const fmtCLP = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

const fmtFecha = (s: string | null) => {
  if (!s) return '';
  try {
    return new Date(s.replace(' ', 'T')).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
};

// Banner de "las bases cambiaron desde el análisis de viabilidad" (spec §11.1). Es informativo:
// se puede cerrar, y solo vuelve a aparecer si `ultimoDeltaAt` cambia (un delta nuevo de verdad), no en
// cada recarga de la página.
function BannerCambioForo({ negocioId, snapshot }: {
  negocioId: number;
  snapshot: { ultimoDelta: Array<{ tipo: string; numero: number | null; detalle: string }>; ultimoDeltaAt: string | null; bloquesRevertidos: string[] };
}) {
  const clave = `foro-cambio-visto-${negocioId}-${snapshot.ultimoDeltaAt}`;
  const [cerrado, setCerrado] = useState(false);

  useEffect(() => {
    try { setCerrado(sessionStorage.getItem(clave) === '1'); } catch { setCerrado(false); }
  }, [clave]);

  if (cerrado || snapshot.ultimoDelta.length === 0) return null;

  const cerrar = () => {
    try { sessionStorage.setItem(clave, '1'); } catch { /* no bloquear por storage */ }
    setCerrado(true);
  };

  return (
    <div className="bg-sky-50 border border-sky-200 rounded-xl px-4 py-3 flex items-start gap-2.5">
      <History size={15} className="text-sky-600 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-bold text-sky-800">Las bases cambiaron desde el análisis de viabilidad</p>
        <ul className="mt-1 space-y-0.5">
          {snapshot.ultimoDelta.map((d, i) => (
            <li key={i} className="text-[11.5px] text-sky-700">{d.detalle}</li>
          ))}
        </ul>
        {snapshot.bloquesRevertidos.length > 0 && (
          <p className="text-[11.5px] text-sky-800 font-semibold mt-1">
            Se revirtió la aprobación de {snapshot.bloquesRevertidos.map(b => b === 'TECNICO' ? 'técnico' : 'comercial').join(' y ')} — vuelve a la bandeja del asesor.
          </p>
        )}
      </div>
      <button onClick={cerrar} className="p-1 rounded-lg text-sky-500 hover:text-sky-700 hover:bg-sky-100 transition-colors flex-shrink-0" aria-label="Cerrar">
        <X size={14} />
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
export function InformacionComercialSection({ negocioId, licitacionCodigo, empresaId, estadoPipeline, onEmpresaChange }: {
  negocioId: number;
  licitacionCodigo: string;
  empresaId: number | null;
  estadoPipeline: string | null;
  onEmpresaChange: (id: number) => void;
}) {
  const toast = useToast();
  // El "Generar" (creador de anexos) queda solo para admin por ahora, mismo pedido que en
  // Documentos — mientras se decide quiénes más lo van a usar.
  const { usuario } = useSession();
  const isAdmin = usuario?.rol === 'admin';
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [semaforo, setSemaforo] = useState<Semaforo>('VERDE');
  const [causalesBloqueo, setCausalesBloqueo] = useState<CausalBloqueo[]>([]);
  // Decisión de "¿ya se puede generar el anexo de este bloque?" — la calcula el backend con
  // auditor-generacion.ts y trae también el documento de la licitación pre-seleccionado.
  const [generacion, setGeneracion] = useState<Record<string, DecisionGeneracion> | null>(null);
  const [foroSnapshot, setForoSnapshot] = useState<{ ultimoDelta: Array<{ tipo: string; numero: number | null; detalle: string }>; ultimoDeltaAt: string | null; bloquesRevertidos: string[] } | null>(null);
  const [congelado, setCongelado] = useState<{ congeladoAt: string; congeladoPorNombre: string | null } | null>(null);
  const [empresa, setEmpresa] = useState<Empresa | null>(null);
  const [modalidad, setModalidad] = useState<{ porLinea: boolean; dudosa: boolean; tipo: string | null; comoSeAdjudica: string | null } | null>(null);
  const [puedeAprobar, setPuedeAprobar] = useState(false);
  const [sinViabilidad, setSinViabilidad] = useState(false);
  const [migracionPendiente, setMigracionPendiente] = useState(false);
  const [empresas, setEmpresas] = useState<Array<{ id: number; razon_social: string }>>([]);
  const [ocupado, setOcupado] = useState<number | null>(null);   // itemId con acción en curso
  const [resincronizando, setResincronizando] = useState(false);
  const [visorDoc, setVisorDoc] = useState<VisorDoc | null>(null);
  // Flujo "Generar" (E.1 ↔ Auditor Técnico): el ítem que abrió el flujo se mantiene mientras se
  // elige el documento fuente Y mientras se rellena — se necesita al final para saber dónde
  // caen los archivos que ningún punto matcheó con confianza (ver repartirArchivosGenerados).
  const [generandoItem, setGenerandoItem] = useState<Item | null>(null);
  const [anexoDocSeleccionado, setAnexoDocSeleccionado] = useState<AnexoDoc | null>(null);
  // Con licitaciones de 100+ ítems, revisar línea por línea es inviable — por defecto el bloque
  // TECNICO solo muestra las líneas técnicas que aún no están aprobadas.
  const [soloExcepcionesTecnico, setSoloExcepcionesTecnico] = useState(true);
  // Carga masiva: UN documento (catálogo, ficha completa) comparado contra TODAS las líneas
  // técnicas de una vez — evita subir el mismo archivo N veces, una por línea.
  // Es un TRABAJO DE FONDO (migración 70): con 88 líneas la comparación dura minutos, así que el
  // POST solo la arranca y esta pantalla sigue el avance por polling. Sobrevive a un F5.
  const [jobMasivo, setJobMasivo] = useState<JobMasivo | null>(null);
  const [subiendoMasivo, setSubiendoMasivo] = useState(false);
  const [verLineaId, setVerLineaId] = useState<number | null>(null);
  const fileMasivoRef = useRef<HTMLInputElement>(null);
  const comparandoMasivo = subiendoMasivo || jobMasivo?.estado === 'procesando';
  const resultadoMasivo = jobMasivo?.estado === 'listo' ? (jobMasivo.resumen?.resultados ?? []) : null;

  const leerJobMasivo = useCallback(async (): Promise<JobMasivo | null> => {
    try {
      const r = await fetch(`/api/negocios/${negocioId}/comercial/comparacion-masiva`);
      if (!r.ok) return null;
      const d = await r.json();
      setJobMasivo(d.job ?? null);
      return d.job ?? null;
    } catch { return null; }
  }, [negocioId]);

  const compararDocumentoMasivo = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setSubiendoMasivo(true);
    try {
      const fd = new FormData();
      fd.append('licitacionCodigo', licitacionCodigo);
      fd.append('files', files[0]);
      const rSubida = await fetch('/api/documentos/subir', { method: 'POST', body: fd });
      const dSubida = await rSubida.json();
      if (!rSubida.ok || !dSubida.documentos?.length) { toast.error(dSubida.error || 'No se pudo subir el documento'); return; }
      const doc = dSubida.documentos[0];

      const r = await fetch(`/api/negocios/${negocioId}/comercial/comparacion-masiva`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentoUrl: doc.url, documentoNombre: doc.nombre }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.error || 'No se pudo comparar el documento'); return; }
      await leerJobMasivo();
    } catch (e) {
      toast.error('Error de red', String(e));
    } finally {
      setSubiendoMasivo(false);
      if (fileMasivoRef.current) fileMasivoRef.current.value = '';
    }
  };

  /** Cierra la tabla de resultados: borra el job para que no reaparezca en el próximo render. */
  const cerrarResultadoMasivo = async () => {
    setJobMasivo(null);
    try {
      const r = await fetch(`/api/negocios/${negocioId}/comercial/comparacion-masiva`, { method: 'DELETE' });
      const d = await r.json();
      if (r.ok && d.resumen) setResumen(d.resumen);
    } catch { /* el job se limpia solo en la próxima corrida */ }
  };

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/negocios/${negocioId}/comercial`);
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'No se pudo cargar'); return; }
      setItems(d.items || []);
      setResumen(d.resumen || null);
      setSemaforo(d.semaforo || 'VERDE');
      setGeneracion(d.generacion || null);
      setCausalesBloqueo(d.causalesBloqueo || []);
      setForoSnapshot(d.foroSnapshot || null);
      setCongelado(d.congelado || null);
      setEmpresa(d.empresa || null);
      setModalidad(d.modalidad || null);
      setPuedeAprobar(!!d.puedeAprobar);
      setSinViabilidad(!!d.sinViabilidad);
      setMigracionPendiente(!!d.migracionPendiente);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setCargando(false);
    }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);
  // Al entrar (o volver tras un F5) puede haber una comparación corriendo desde antes.
  useEffect(() => { leerJobMasivo(); }, [leerJobMasivo]);

  // Polling del trabajo de fondo: solo mientras está vivo, y se apaga solo al terminar.
  useEffect(() => {
    if (jobMasivo?.estado !== 'procesando') return;
    const t = setInterval(async () => {
      const job = await leerJobMasivo();
      if (job?.estado === 'listo') { cargar(); toast.success('Comparación lista', `${job.resumen?.lineasComparadas ?? 0} línea(s) comparadas.`); }
      else if (job?.estado === 'error') toast.error('La comparación falló', job.error || undefined);
    }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobMasivo?.estado, leerJobMasivo, cargar]);
  // El asesor tiene que poder aprobar el mismo día, en el momento: si el asistente carga algo
  // mientras esta pantalla está abierta, aparece solo.
  useRealtime(cargar);

  useEffect(() => {
    fetch('/api/empresas').then(r => r.json()).then(d => setEmpresas(d.empresas || [])).catch(() => {});
  }, []);

  // ── Acciones ─────────────────────────────────────────────────────────────────
  const accionar = useCallback(async (itemId: number, accion: string, extra: Record<string, unknown> = {}) => {
    setOcupado(itemId);
    try {
      const r = await fetch(`/api/negocios/${negocioId}/comercial`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, accion, ...extra }),
      });
      const d = await r.json();
      if (!r.ok) { toast.error(d.error || 'No se pudo completar la acción'); return false; }
      setItems(d.items || []);
      setResumen(d.resumen || null);
      return true;
    } catch (e) {
      toast.error('Error de red', String(e));
      return false;
    } finally {
      setOcupado(null);
    }
  }, [negocioId, toast]);

  const resincronizar = async () => {
    setResincronizando(true);
    try {
      const r = await fetch(`/api/negocios/${negocioId}/comercial`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'resincronizar' }),
      });
      const d = await r.json();
      if (!r.ok) { toast.error(d.error || 'No se pudo resincronizar'); return; }
      setItems(d.items || []);
      setResumen(d.resumen || null);
      toast.success(d.nuevos ? `${d.nuevos} punto${d.nuevos === 1 ? '' : 's'} nuevo${d.nuevos === 1 ? '' : 's'}` : 'Ya estaba al día');
    } finally {
      setResincronizando(false);
    }
  };

  // ── Cierre del flujo "Generar" (E.1 ↔ Auditor Técnico) ──────────────────────────
  // El .docx que se generó ya quedó subido a R2 + Documentos Propios (lo hizo /api/anexos/generar
  // dentro del modal) — acá solo falta ADJUNTARLO al punto correcto del checklist, con la misma
  // acción CARGAR que usa la carga manual. Si el documento fuente traía varios formularios
  // pegados, cada archivo dividido va a SU propio punto (repartirArchivosGenerados), no todos al
  // que abrió el modal.
  const handleAnexoGenerado = async (archivos: { nombre: string; url: string }[]) => {
    const itemOrigen = generandoItem;
    setAnexoDocSeleccionado(null);
    setGenerandoItem(null);
    if (!itemOrigen || archivos.length === 0) return;

    const elegibles = items.filter(i => i.bloque === 'ADMINISTRATIVO' && i.tipo === 'documento' && i.generable);
    const reparto = repartirArchivosGenerados(archivos, elegibles, itemOrigen.id);

    // accionar() ya muestra su propio toast.error por cada PATCH que falle (congelamiento, red,
    // etc.) — antes este bucle ignoraba el resultado y SIEMPRE mostraba "listo, quedó en
    // CARGADO" abajo, aunque uno de los puntos hubiera fallado en silencio. Ahora se cuentan los
    // fallos y el toast final dice la verdad: éxito solo si los N puntos quedaron cargados.
    let fallidos = 0;
    for (const [itemId, docs] of reparto) {
      const ok = await accionar(itemId, 'CARGAR', { documentos: docs });
      if (!ok) fallidos++;
    }
    const puntos = reparto.size;
    if (fallidos === 0) {
      toast.success(
        archivos.length > 1 ? `${archivos.length} anexos generados` : 'Anexo generado',
        puntos > 1 ? `Se repartieron en ${puntos} puntos del checklist — quedaron en CARGADO` : 'Quedó en CARGADO, listo para que el asesor lo apruebe',
      );
    } else {
      // El/los archivos igual quedaron subidos a Documentos Propios (eso ya lo confirmó el modal
      // antes de llegar acá) — lo que falló es solo adjuntarlos al checklist, así que no se
      // pierde nada: se pueden adjuntar a mano desde "Adjuntar" en el punto correspondiente.
      toast.error(
        fallidos === puntos ? 'No se pudo adjuntar al checklist' : `${puntos - fallidos}/${puntos} puntos quedaron cargados`,
        'El archivo ya está en Documentos Propios — puedes adjuntarlo a mano en el punto que falló.',
      );
    }
  };

  const elegirEmpresa = async (id: string) => {
    const r = await fetch(`/api/negocios/${negocioId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empresa_id: Number(id) }),
    });
    if (!r.ok) { toast.error('No se pudo guardar la empresa'); return; }
    onEmpresaChange(Number(id));
    toast.success('Empresa asignada');
    cargar();
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  if (cargando) {
    return <div className="flex items-center gap-2 text-[13px] text-zinc-400 py-10 justify-center">
      <Loader2 size={14} className="animate-spin" /> Cargando información comercial…
    </div>;
  }

  if (error) return <Banner variante="error" accion={{ label: 'Reintentar', onClick: cargar }}>{error}</Banner>;

  // Las migraciones se aplican a mano en phpMyAdmin: decirlo claro vale más que un 500 opaco.
  if (migracionPendiente) {
    return (
      <Banner variante="warning" accion={{ label: 'Reintentar', onClick: cargar }}>
        Falta aplicar la <strong>migración 48</strong> (<code>docs/migration-48-checklist-comercial.sql</code>) en la
        base de datos. Sin las tablas <code>checklist_comercial</code>, el módulo no puede guardar nada.
      </Banner>
    );
  }

  const sinEmpresa = !empresa;

  // Agregado del bloque TECNICO: no vive en el backend (es una suma en caliente de los
  // resumen_tecnico que ya trae cada línea), así que sincronizar() sigue sin tocar IA.
  const lineasTecnicas = items.filter(i => i.tipo === 'linea_tecnica');
  const resumenTecnicoGlobal = lineasTecnicas.reduce((acc, i) => {
    acc.totalLineas++;
    if (i.estado === 'APROBADO') acc.aprobadas++;
    const r = i.resumen_tecnico;
    if (!r || r.total === 0) acc.sinValidar++;
    else if (r.noCumplen > 0) acc.noCumplen++;
    else if (r.conComplemento > 0 || r.pendientesProveedor > 0) acc.conComplemento++;
    return acc;
  }, { totalLineas: 0, aprobadas: 0, noCumplen: 0, conComplemento: 0, sinValidar: 0 });

  return (
    <div className="space-y-5 fade-in">

      {congelado ? (
        <div className="bg-zinc-800 text-white rounded-xl px-4 py-3 flex items-center gap-2.5">
          <ShieldCheck size={16} className="text-zinc-300 flex-shrink-0" />
          <div>
            <p className="text-[12.5px] font-bold">Congelado — registro histórico, de solo lectura</p>
            <p className="text-[11px] text-zinc-400">
              Se postuló el {fmtFecha(congelado.congeladoAt)}{congelado.congeladoPorNombre ? ` · ${congelado.congeladoPorNombre}` : ''}. Ya no se puede cargar, aprobar ni corregir nada acá.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Antes acá iba un popup modal "Esta licitación está en rojo" que había que reconocer
              antes de trabajar. Se eliminó (19-ago-2026, a pedido del usuario): no aportaba nada
              que no dijeran ya los avisos de causales de bloqueo que se listan más abajo en la
              propia sección, y obligaba a un clic extra en cada entrada al auditor. */}
          {foroSnapshot && <BannerCambioForo negocioId={negocioId} snapshot={foroSnapshot} />}
        </>
      )}

      {/* ── Cabecera + avance ────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-zinc-200 p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center">
              <ShieldCheck size={16} className="text-violet-600" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[15px] font-bold text-zinc-900 leading-tight">Auditor Técnico</h2>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${SEMAFORO_BADGE[semaforo].bg} ${SEMAFORO_BADGE[semaforo].text}`}>
                  {SEMAFORO_BADGE[semaforo].label}
                </span>
              </div>
              <p className="text-[11.5px] text-zinc-400">
                El asistente carga · el asesor aprueba
              </p>
            </div>
          </div>
          <button
            onClick={resincronizar}
            disabled={resincronizando}
            title="Trae al checklist los puntos nuevos del informe de viabilidad, sin tocar lo ya aprobado"
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11.5px] font-semibold text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 rounded-lg border border-zinc-200 transition-colors disabled:opacity-50"
          >
            {resincronizando ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Resincronizar
          </button>
        </div>

        {causalesBloqueo.length > 0 && (
          <div className={`mb-3 rounded-lg px-3 py-2 space-y-1 border ${semaforo === 'ROJO' ? 'bg-rose-50 border-rose-200' : 'bg-amber-50 border-amber-200'}`}>
            {causalesBloqueo.map(c => (
              <p key={c.codigo} className={`text-[11.5px] leading-snug ${semaforo === 'ROJO' ? 'text-rose-700' : 'text-amber-800'}`}>
                <span className="font-semibold">{c.descripcion}.</span> {c.rutaDesbloqueo}
              </p>
            ))}
          </div>
        )}

        {resumen && resumen.total > 0 && (
          <>
            <div className="flex items-baseline justify-between mb-1.5">
              <p className="text-[12.5px] font-semibold text-zinc-700">
                {resumen.listoParaPostular
                  ? <span className="text-emerald-600">Listo para postular</span>
                  : <>Faltan <span className="text-rose-600">{resumen.bloqueantesPendientes}</span> punto{resumen.bloqueantesPendientes === 1 ? '' : 's'} de admisibilidad</>}
              </p>
              <p className="text-[12px] text-zinc-400">{resumen.aprobados}/{resumen.total} aprobados</p>
            </div>
            <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${resumen.listoParaPostular ? 'bg-emerald-500' : 'bg-violet-500'}`}
                style={{ width: `${resumen.avance}%` }}
              />
            </div>
            <div className="flex gap-3 mt-2 text-[11px]">
              {resumen.porAprobar > 0 && <span className="text-indigo-600 font-semibold">{resumen.porAprobar} por aprobar</span>}
              {resumen.observados > 0 && <span className="text-orange-600 font-semibold">{resumen.observados} observado{resumen.observados === 1 ? '' : 's'}</span>}
              {resumen.pendientes > 0 && <span className="text-zinc-400">{resumen.pendientes} sin cargar</span>}
            </div>
          </>
        )}
      </div>

      {sinViabilidad && (
        <Banner variante="warning">
          Esta licitación aún no tiene informe de viabilidad, así que el checklist no se puede armar solo.
          Corre el análisis de viabilidad y vuelve, o agrega los puntos a mano.
        </Banner>
      )}

      {modalidad?.dudosa && !sinViabilidad && (
        <Banner variante="warning">
          La modalidad no quedó determinada en el informe ({modalidad.tipo || 'sin dato'}). Antes de cargar precios,
          confirma en las bases si se oferta un total único (suma alzada) o línea por línea — el bloque comercial
          se armó con lo que dice el informe.
        </Banner>
      )}

      {/* ── Empresa con la que se postula ────────────────────────────────────── */}
      <BloqueEmpresa
        empresa={empresa}
        empresas={empresas}
        onElegir={elegirEmpresa}
        toast={toast}
        bloqueado={!!congelado}
      />

      {/* El plazo comprometido es tipo 'dato' pero NO es una alerta: es lo que se oferta junto
          con el precio, y el asistente lo llena en el mismo momento. Vivía abajo, entre las
          alertas, separado del precio que lo acompaña (pedido 24-ago-2026). */}
      {/* ── Los tres bloques ─────────────────────────────────────────────────── */}
      {/* tipo 'dato' (alertas de cumplimiento sin documento propio: cotizar 100%, suscripción de
          contrato, bloqueantes sueltos, plazo comprometido…) se saca de acá y se agrupa aparte,
          debajo de todo — ver la sección "Alertas de cumplimiento". Antes vivían mezcladas con
          los anexos reales a subir, en la misma lista, y no había forma de distinguir "esto hay
          que adjuntarlo" de "esto solo hay que tenerlo presente" (pedido 24-ago-2026). */}
      {BLOQUES.map(b => {
        const delBloque = items.filter(i => i.bloque === b.key && !esAlerta(i));
        if (delBloque.length === 0) return null;
        const Icono = b.icon;
        const bloqueadoPorEmpresa = b.key === 'ADMINISTRATIVO' && sinEmpresa;

        // Administrativo/Técnico (los anexos) recién se trabajan cuando la licitación entra a
        // ANEXOS — antes de eso lo único que importa es fijar el precio con el asesor (bloque
        // Comercial, ver tieneAnexosAuditor). Los ítems YA están generados desde la viabilidad,
        // solo se ocultan — así no hay que volver a sincronizar ni arriesgar perderlos al llegar
        // a ANEXOS. Se deja el encabezado colapsado (no null) para que quede claro que ya están
        // listos y no parezca que faltan.
        const esAnexo = b.key === 'ADMINISTRATIVO' || b.key === 'TECNICO';
        if (esAnexo && !tieneAnexosAuditor(estadoPipeline)) {
          return (
            <div key={b.key} className="bg-white rounded-xl border border-zinc-200 overflow-hidden opacity-60">
              <div className="px-4 py-3 flex items-center gap-2">
                <Icono size={14} className="text-zinc-400" />
                <h3 className="text-[13px] font-bold text-zinc-800">{b.label}</h3>
                <span className="text-[10.5px] text-zinc-400">{delBloque.length} punto{delBloque.length !== 1 ? 's' : ''} listo{delBloque.length !== 1 ? 's' : ''} para cuando pase a Anexos</span>
              </div>
            </div>
          );
        }

        return (
          <div key={b.key} className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100 flex items-center gap-2">
              <Icono size={14} className="text-zinc-400" />
              <h3 className="text-[13px] font-bold text-zinc-800">{b.label}</h3>
              <span className="text-[10.5px] text-zinc-400">{b.hint}</span>
              <span className="ml-auto text-[11px] font-bold text-zinc-400">
                {delBloque.filter(i => i.estado === 'APROBADO').length}/{delBloque.length}
              </span>
            </div>

            {bloqueadoPorEmpresa && (
              <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-100 text-[11.5px] text-amber-800 flex items-center gap-1.5">
                <AlertTriangle size={13} /> Elige primero la empresa: sin eso no se pueden llenar los anexos.
              </div>
            )}

            {/* Generar el anexo ECONÓMICO / TÉCNICO desde el bloque, no desde una fila: es UN
                documento que consume TODAS las líneas del bloque (12 líneas de precio = un solo
                anexo económico). El backend ya decidió si se puede y con qué documento de la
                LICITACIÓN — nunca una plantilla nuestra. Ver app/lib/auditor-generacion.ts. */}
            {isAdmin && (b.key === 'COMERCIAL' || b.key === 'TECNICO') && generacion?.[b.key] && (
              <GenerarAnexoDeBloque
                decision={generacion[b.key]!}
                etiqueta={b.key === 'COMERCIAL' ? 'económico' : 'técnico'}
                onGenerar={doc => setAnexoDocSeleccionado({ id: doc.id, nombre: doc.nombre, url: doc.url || '' })}
              />
            )}

            {b.key === 'COMERCIAL' && <MotorComercialCard negocioId={negocioId} licitacionCodigo={licitacionCodigo} />}

            {b.key === 'TECNICO' && lineasTecnicas.length > 0 && (
              <div className="px-4 py-2.5 bg-zinc-50 border-b border-zinc-100 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-3 text-[11.5px] flex-wrap">
                  <span className="font-semibold text-zinc-600">{resumenTecnicoGlobal.totalLineas} línea{resumenTecnicoGlobal.totalLineas === 1 ? '' : 's'}</span>
                  <span className="text-emerald-600 font-semibold">{resumenTecnicoGlobal.aprobadas} aprobada{resumenTecnicoGlobal.aprobadas === 1 ? '' : 's'}</span>
                  {resumenTecnicoGlobal.noCumplen > 0 && <span className="text-rose-600 font-semibold">{resumenTecnicoGlobal.noCumplen} no cumple</span>}
                  {resumenTecnicoGlobal.conComplemento > 0 && <span className="text-amber-600 font-semibold">{resumenTecnicoGlobal.conComplemento} con complemento</span>}
                  {resumenTecnicoGlobal.sinValidar > 0 && <span className="text-zinc-400">{resumenTecnicoGlobal.sinValidar} sin validar</span>}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input ref={fileMasivoRef} type="file" className="hidden" onChange={e => compararDocumentoMasivo(e.target.files)} />
                  <button
                    onClick={() => fileMasivoRef.current?.click()}
                    disabled={comparandoMasivo}
                    title="Un solo documento con las especificaciones de varias líneas — se compara contra cada una automáticamente"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-violet-600 hover:bg-violet-50 rounded-lg border border-violet-200 transition-colors disabled:opacity-50"
                  >
                    {comparandoMasivo ? <Loader2 size={12} className="animate-spin" /> : <FileStack size={12} />}
                    {!comparandoMasivo ? 'Comparar contra un documento'
                      : jobMasivo?.estado === 'procesando' && jobMasivo.total > 0
                        ? `Comparando… ${jobMasivo.procesadas}/${jobMasivo.total}`
                        : 'Comparando…'}
                  </button>
                  {/* La comparación dura minutos: sin esto la pantalla parece colgada. */}
                  {jobMasivo?.estado === 'procesando' && (
                    <span className="text-[11px] text-zinc-400">
                      {jobMasivo.fase || 'Preparando'}
                      {jobMasivo.total > 0 && ` · ${Math.round((jobMasivo.procesadas / jobMasivo.total) * 100)}%`}
                      {textoCosto(jobMasivo.costo) && <span className="text-amber-600"> · {textoCosto(jobMasivo.costo)}</span>}
                    </span>
                  )}
                  {jobMasivo?.estado === 'error' && (
                    <span className="text-[11px] text-rose-600 font-semibold">
                      {jobMasivo.error || 'La comparación falló'}
                      {textoCosto(jobMasivo.costo) && <span className="text-amber-600 font-normal"> · alcanzó a gastar {textoCosto(jobMasivo.costo)}</span>}
                    </span>
                  )}
                  <button onClick={() => setSoloExcepcionesTecnico(v => !v)} className="text-[11px] font-semibold text-violet-600 hover:text-violet-800">
                    {soloExcepcionesTecnico ? 'Mostrar todas las líneas' : 'Mostrar solo pendientes'}
                  </button>
                </div>
              </div>
            )}

            <div className="divide-y divide-zinc-100">
              {delBloque.map(item => {
                if (b.key === 'TECNICO' && item.tipo === 'linea_tecnica' && soloExcepcionesTecnico && item.estado === 'APROBADO') return null;
                return item.tipo === 'linea_tecnica' ? (
                  <FilaLineaTecnica
                    key={item.id}
                    item={item}
                    negocioId={negocioId}
                    licitacionCodigo={licitacionCodigo}
                    puedeAprobar={puedeAprobar}
                    bloqueado={bloqueadoPorEmpresa}
                    ocupado={ocupado === item.id}
                    onAccion={accionar}
                  />
                ) : (
                  <FilaItem
                    key={item.id}
                    item={item}
                    licitacionCodigo={licitacionCodigo}
                    puedeAprobar={puedeAprobar}
                    bloqueado={bloqueadoPorEmpresa}
                    ocupado={ocupado === item.id}
                    onAccion={accionar}
                    onVer={setVisorDoc}
                    onGenerar={isAdmin ? setGenerandoItem : undefined}
                    toast={toast}
                  />
                );
              })}
              {b.key === 'TECNICO' && soloExcepcionesTecnico && lineasTecnicas.length > 0 && resumenTecnicoGlobal.aprobadas === resumenTecnicoGlobal.totalLineas && (
                <p className="px-4 py-3 text-[12px] text-emerald-600 font-medium">Todas las líneas técnicas están aprobadas.</p>
              )}
            </div>

            {/* Total de la oferta, solo en el bloque comercial por línea */}
            {b.key === 'COMERCIAL' && modalidad?.porLinea && (
              <div className="px-4 py-3 bg-zinc-50 border-t border-zinc-100 flex items-center justify-between">
                <span className="text-[12px] font-semibold text-zinc-500">
                  Total ofertado ({delBloque.filter(i => i.tipo === 'precio' && i.ofertamos !== false).length} línea(s))
                </span>
                <span className="text-[15px] font-bold text-emerald-700">
                  {fmtCLP(delBloque
                    .filter(i => i.tipo === 'precio' && i.ofertamos !== false)
                    .reduce((s, i) => s + (i.valor_numero || 0), 0))}
                </span>
              </div>
            )}
          </div>
        );
      })}

      {/* ── Alertas de cumplimiento: condiciones sin documento propio ───────────
          Todo lo tipo 'dato' de cualquier bloque (cotizar 100%, contrato, plazo comprometido,
          bloqueantes sueltos) va acá, debajo de lo económico. No se borran ni se ocultan: el
          asistente las confirma (sin necesidad de adjuntar nada) y el asesor las visa igual que
          el resto — así queda registro de que se leyeron y se tuvieron en cuenta, o de que la
          licitación quedó fuera por no cumplirlas. */}
      {(() => {
        // Mismo criterio de "¿ya toca mostrar esto?" que cada bloque de origen: una alerta que
        // nació del informe administrativo no debe aparecer antes de que la licitación entre a
        // Anexos, aunque ya esté generada.
        const bloqueVisible = (bq: Item['bloque']) => (bq !== 'ADMINISTRATIVO' && bq !== 'TECNICO') || tieneAnexosAuditor(estadoPipeline);
        const alertas = items.filter(i => esAlerta(i) && bloqueVisible(i.bloque));
        if (alertas.length === 0) return null;
        return (
          <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100 flex items-center gap-2">
              <AlertTriangle size={14} className="text-zinc-400" />
              <h3 className="text-[13px] font-bold text-zinc-800">Alertas de cumplimiento</h3>
              <span className="text-[10.5px] text-zinc-400">Condiciones a tener en cuenta — sin documento que subir</span>
              <span className="ml-auto text-[11px] font-bold text-zinc-400">
                {alertas.filter(i => i.estado === 'APROBADO').length}/{alertas.length}
              </span>
            </div>
            <div className="divide-y divide-zinc-100">
              {alertas.map(item => (
                <FilaItem
                  key={item.id}
                  item={item}
                  licitacionCodigo={licitacionCodigo}
                  puedeAprobar={puedeAprobar}
                  bloqueado={false}
                  ocupado={ocupado === item.id}
                  onAccion={accionar}
                  onVer={setVisorDoc}
                  toast={toast}
                />
              ))}
            </div>
          </div>
        );
      })()}

      {items.length === 0 && !sinViabilidad && (
        <div className="bg-white rounded-xl border border-zinc-200 p-10 text-center">
          <ClipboardCheck size={26} className="text-zinc-300 mx-auto mb-3" />
          <p className="text-[13px] font-semibold text-zinc-700 mb-1">Sin puntos todavía</p>
          <p className="text-[12px] text-zinc-400 mb-4 max-w-sm mx-auto">
            El checklist se arma desde el informe de viabilidad. Si el informe existe, resincroniza.
          </p>
          <button onClick={resincronizar} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-[12px] font-semibold rounded-lg">
            Armar checklist
          </button>
        </div>
      )}

      <DocumentViewerModal doc={visorDoc} onClose={() => setVisorDoc(null)} />

      {resultadoMasivo && (
        <ModalResultadoMasivo
          resultados={resultadoMasivo}
          resumen={jobMasivo?.resumen ?? null}
          onVerLinea={id => { cerrarResultadoMasivo(); setVerLineaId(id); }}
          onClose={cerrarResultadoMasivo}
        />
      )}

      {verLineaId != null && (
        <ModalAuditorLineaTecnica
          negocioId={negocioId}
          itemId={verLineaId}
          licitacionCodigo={licitacionCodigo}
          puedeAprobar={puedeAprobar}
          bloqueado={sinEmpresa}
          onClose={() => setVerLineaId(null)}
          onAccion={accionar}
        />
      )}

      {/* Flujo "Generar" — paso 1: elegir a cuál Word real de la licitación corresponde este
          anexo. Se oculta en cuanto se elige uno (paso 2, el modal de relleno, toma el relevo). */}
      <SelectorDocumentoAnexo
        codigo={generandoItem && !anexoDocSeleccionado ? licitacionCodigo : null}
        tituloItem={generandoItem && !anexoDocSeleccionado ? generandoItem.titulo : null}
        onSeleccionar={setAnexoDocSeleccionado}
        onClose={() => setGenerandoItem(null)}
      />

      {/* Flujo "Generar" — paso 2: mismo modal que usa Documentos, pero al terminar el archivo
          se adjunta directo al punto del checklist en vez de solo refrescar una lista. */}
      <AnexoRellenoModal
        doc={anexoDocSeleccionado}
        codigo={licitacionCodigo}
        empresaId={empresaId}
        onClose={() => { setAnexoDocSeleccionado(null); setGenerandoItem(null); }}
        onGenerado={handleAnexoGenerado}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// Resultado de "Comparar contra un documento" (carga masiva) — una fila por línea procesada,
// con acceso directo a la comparación completa de la que tenga algo pendiente.
function ModalResultadoMasivo({ resultados, resumen, onVerLinea, onClose }: {
  resultados: ResultadoMasivoLinea[];
  resumen: JobMasivo['resumen'];
  onVerLinea: (itemId: number) => void;
  onClose: () => void;
}) {
  const totalCumplen = resultados.filter(r => !r.error && r.total > 0 && r.noCumplen === 0).length;
  const totalNoCumplen = resultados.filter(r => r.noCumplen > 0).length;
  const totalErrores = resultados.filter(r => r.error).length;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3" onClick={onClose} role="dialog" aria-modal="true" aria-label="Resultado de la comparación masiva">
      <div className="w-full max-w-lg max-h-[85vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-zinc-100 flex items-start gap-3 flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center flex-shrink-0"><FileStack size={15} className="text-violet-600" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px] font-bold text-zinc-900">Comparación masiva</p>
            <p className="text-[12px] text-zinc-400 mt-0.5">
              {resultados.length} línea{resultados.length === 1 ? '' : 's'} procesada{resultados.length === 1 ? '' : 's'} · {totalCumplen} sin problemas
              {totalNoCumplen > 0 && <span className="text-rose-600 font-semibold"> · {totalNoCumplen} con incumplimientos</span>}
              {totalErrores > 0 && <span className="text-amber-600 font-semibold"> · {totalErrores} con error</span>}
            </p>
            {/* Sin esto no se distingue "la ficha no cubre esa línea" de "la línea sí cumple". */}
            {resumen && (
              <p className="text-[11px] text-zinc-400 mt-0.5 truncate">
                {resumen.documento} · {resumen.lineasComparadas} de {resumen.lineasTotales} línea(s) del checklist
                {resumen.bloquesFicha > 0
                  ? ` · ficha segmentada en ${resumen.bloquesFicha} bloque(s)`
                  : ' · ficha sin segmentar (se comparó contra el texto completo)'}
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg transition-colors flex-shrink-0" aria-label="Cerrar"><X size={16} /></button>
        </div>
        <div className="px-3 py-2 overflow-y-auto flex-1 space-y-1">
          {resultados.map(r => {
            const ok = !r.error && r.total > 0 && r.noCumplen === 0;
            return (
              <button key={r.itemId} onClick={() => onVerLinea(r.itemId)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-zinc-50 text-left transition-colors">
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium text-zinc-800 truncate">Línea {r.lineaNumero} — {r.titulo}</p>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    {r.error ? r.error : `${r.cumplen} de ${r.total} cumple${r.noCumplen > 0 ? ` · ${r.noCumplen} no cumple` : ''}`}
                  </p>
                </div>
                <span className={`flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  r.error ? 'bg-amber-100 text-amber-700' : ok ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                }`}>
                  {r.error ? 'Error' : ok ? 'Sin problemas' : `${r.noCumplen} no cumple`}
                </span>
              </button>
            );
          })}
        </div>
        <div className="px-5 py-3 border-t border-zinc-100 flex-shrink-0">
          {/* Es la operación más cara del sistema: el gasto se muestra, no se esconde en el log. */}
          {textoCosto(resumen?.costo) && (
            <p className="text-[11px] text-amber-600 text-center mb-2">
              Costo de esta comparación: {textoCosto(resumen?.costo)}
              {resumen?.costo && ` (${(resumen.costo.tokensIn + resumen.costo.tokensOut).toLocaleString('es-CL')} tokens)`}
            </p>
          )}
          <button onClick={onClose} className="w-full px-3 py-1.5 text-[12px] font-semibold text-zinc-500 hover:text-zinc-700">Cerrar</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// Bloque de empresa: sin esto no se pueden llenar los anexos, así que va arriba y bloquea.
function BloqueEmpresa({ empresa, empresas, onElegir, toast, bloqueado }: {
  empresa: Empresa | null;
  empresas: Array<{ id: number; razon_social: string }>;
  onElegir: (id: string) => void;
  toast: ReturnType<typeof useToast>;
  bloqueado?: boolean;
}) {
  const [cambiando, setCambiando] = useState(false);

  const copiar = (valor: string | null, etiqueta: string) => {
    if (!valor) return;
    navigator.clipboard.writeText(valor).then(
      () => toast.success(`${etiqueta} copiado`),
      () => toast.error('No se pudo copiar'),
    );
  };

  const elegirYCerrar = (id: string) => {
    onElegir(id);
    setCambiando(false);
  };

  if (!empresa || cambiando) {
    return (
      <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Building2 size={15} className="text-amber-600" />
          <h3 className="text-[13px] font-bold text-amber-900">¿Con qué empresa se postula?</h3>
        </div>
        <p className="text-[12px] text-amber-800 mb-3">
          Los anexos administrativos se llenan con los datos de la empresa. Elige antes de empezar.
        </p>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <Select
              value={empresa ? String(empresa.id) : ''}
              onChange={elegirYCerrar}
              placeholder="Elegir empresa…"
              options={empresas.map(e => ({ value: String(e.id), label: e.razon_social }))}
            />
          </div>
          {empresa && (
            <button
              onClick={() => setCambiando(false)}
              className="text-[12px] font-semibold text-amber-800 hover:text-amber-900 px-2 py-2"
            >
              Cancelar
            </button>
          )}
        </div>
      </div>
    );
  }

  const campos: Array<[string, string | null]> = [
    ['Razón social', empresa.razon_social],
    ['RUT', empresa.rut],
    ['Dirección', empresa.direccion],
    ['Giro', empresa.giro],
    ['Representante', empresa.representante_nombre],
    ['RUT representante', empresa.representante_rut],
    ['Cargo', empresa.representante_cargo],
    ['Email', empresa.email1],
    ['Teléfono', empresa.telefono1],
    ['Banco', [empresa.banco_nombre, empresa.banco_tipo_cuenta, empresa.banco_numero].filter(Boolean).join(' · ') || null],
  ];

  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Building2 size={15} className="text-zinc-400" />
        <h3 className="text-[13px] font-bold text-zinc-800">Se postula con {empresa.razon_social}</h3>
        <span className="text-[10.5px] text-zinc-400">· datos para llenar los anexos</span>
        {!bloqueado && (
          <button
            onClick={() => setCambiando(true)}
            className="ml-auto text-[11.5px] font-semibold text-indigo-600 hover:text-indigo-700"
          >
            Cambiar empresa
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {campos.filter(([, v]) => v).map(([label, valor]) => (
          <button
            key={label}
            onClick={() => copiar(valor, label)}
            className="group flex items-center gap-2 text-left px-2.5 py-1.5 rounded-lg hover:bg-zinc-50 transition-colors"
            title={`Copiar ${label.toLowerCase()}`}
          >
            <div className="min-w-0 flex-1">
              <p className="text-[9.5px] text-zinc-400 uppercase font-bold tracking-wide">{label}</p>
              <p className="text-[12px] text-zinc-700 font-medium truncate">{valor}</p>
            </div>
            <Copy size={12} className="text-zinc-300 group-hover:text-zinc-500 flex-shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// Una fila del checklist: el punto, su evidencia, y las acciones según quién mira.
/**
 * Botón para generar el anexo ECONÓMICO / TÉCNICO del bloque completo.
 *
 * Va en la cabecera del bloque y no en cada fila porque el anexo es UNO solo que consume todas las
 * líneas (12 líneas de precio = un anexo económico). Cuando todavía no se puede, en vez de un botón
 * deshabilitado y mudo se muestra EXACTAMENTE qué falta — es lo que diferencia a un auditor de una
 * lista de tareas. Ver app/lib/auditor-generacion.ts.
 */
function GenerarAnexoDeBloque({ decision, etiqueta, onGenerar }: {
  decision: DecisionGeneracion;
  etiqueta: string;
  onGenerar: (doc: DocumentoCandidato) => void;
}) {
  if (!decision.puede) {
    return (
      <div className="px-4 py-2.5 bg-zinc-50 border-b border-zinc-100 text-[11.5px] text-zinc-600 flex items-start gap-1.5">
        <AlertTriangle size={13} className="text-zinc-400 mt-px flex-shrink-0" />
        <span><b className="text-zinc-700">Anexo {etiqueta}:</b> {decision.motivo}</span>
      </div>
    );
  }
  const docs = [decision.documentoSugerido!, ...decision.alternativas];
  return (
    <div className="px-4 py-2.5 bg-violet-50 border-b border-violet-100">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11.5px] text-violet-900"><b>Anexo {etiqueta} listo para generar.</b> {decision.motivo}</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap mt-2">
        {docs.map(d => (
          <button key={d.id} onClick={() => onGenerar(d)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-[11.5px] font-semibold rounded-lg transition-colors">
            <Sparkles size={12} /> {docs.length > 1 ? d.nombre.slice(0, 40) : `Generar anexo ${etiqueta}`}
          </button>
        ))}
      </div>
      {/* El documento es SIEMPRE el que publicó el organismo; el motor escribe dentro de ese
          archivo y verifica que no cambió su estructura antes de subirlo. */}
      <p className="text-[10.5px] text-violet-700/80 mt-1.5">Se rellena el documento original de la licitación, no una plantilla.</p>
    </div>
  );
}

function FilaItem({ item, licitacionCodigo, puedeAprobar, bloqueado, ocupado, onAccion, onVer, onGenerar, toast }: {
  item: Item;
  licitacionCodigo: string;
  puedeAprobar: boolean;
  bloqueado: boolean;
  ocupado: boolean;
  onAccion: (itemId: number, accion: string, extra?: Record<string, unknown>) => Promise<boolean>;
  onVer: (doc: VisorDoc) => void;
  onGenerar?: (item: Item) => void;
  toast: ReturnType<typeof useToast>;
}) {
  const confirmar = useConfirm();
  const [editando, setEditando] = useState(false);
  const [valorTexto, setValorTexto] = useState(item.valor_texto || '');
  const [valorNumero, setValorNumero] = useState(item.valor_numero != null ? String(item.valor_numero) : '');
  const [observando, setObservando] = useState(false);
  const [observacion, setObservacion] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const [eliminando, setEliminando] = useState<number | null>(null);   // documentoId en curso
  const fileRef = useRef<HTMLInputElement>(null);
  const cargadoAtRef = useRef(item.cargado_at);

  // El flujo "Generar" adjunta el archivo desde AFUERA de esta fila (el modal vive en el
  // componente padre, para poder repartir varios archivos entre varios ítems) — sin esto, tras
  // generar el panel de edición se quedaba abierto con el textarea vacío y el documento nuevo
  // no se veía (la lista de adjuntos solo se muestra con editando=false). cargado_at cambia en
  // CUALQUIER CARGAR exitoso (manual o generado), así que cerrar acá cubre los dos caminos.
  useEffect(() => {
    if (item.cargado_at !== cargadoAtRef.current) {
      cargadoAtRef.current = item.cargado_at;
      setEditando(false);
    }
  }, [item.cargado_at]);

  const crit = CRIT_STYLE[item.criticidad] || CRIT_STYLE.INFORMATIVO;
  const avisoPlazo = (() => {
    if (item.clave_origen !== CLAVE_ITEM_PLAZO || !item.valor_texto) return null;
    const v = validarPlazoOfertado(item.valor_texto, rangoPlazoDeDescripcion(item.descripcion));
    return v.nivel === 'ok' ? null : v;
  })();
  const est = ESTADO_STYLE[item.estado];
  const noOfertada = item.tipo === 'precio' && item.ofertamos === false;

  const guardar = async () => {
    const extra: Record<string, unknown> = {};
    if (item.tipo === 'precio') {
      const n = Number(String(valorNumero).replace(/[^\d.-]/g, ''));
      if (!Number.isFinite(n) || n <= 0) { toast.error('Escribe un precio válido'); return; }
      extra.valorNumero = n;
      extra.ofertamos = true;
    } else {
      // 'dato' es una alerta de cumplimiento, no un documento: basta con que el asistente la haya
      // visto y la mande a visar — no todas tienen un valor propio que anotar (ej. "Cotizar el
      // 100% de los ítems" no tiene "dato" que escribir, solo hay que tenerlo presente).
      if (item.tipo === 'documento' && !valorTexto.trim() && item.documentos.length === 0) { toast.error('Escribe el dato o adjunta el documento'); return; }
      // El plazo NO puede pasarse del máximo que declaran las bases: fuera de rango la oferta se
      // cae entera, y hasta ahora se guardaba y se aprobaba sin que nadie lo cruzara.
      if (item.clave_origen === CLAVE_ITEM_PLAZO) {
        const v = validarPlazoOfertado(valorTexto, rangoPlazoDeDescripcion(item.descripcion));
        if (v.nivel === 'error') { toast.error(v.mensaje || 'El plazo está fuera del rango admisible'); return; }
        if (v.nivel === 'aviso' && v.mensaje) toast.warning(v.mensaje);
      }
      extra.valorTexto = valorTexto.trim() || null;
    }
    if (await onAccion(item.id, 'CARGAR', extra)) setEditando(false);
  };

  // Suben TODOS los archivos elegidos en una sola llamada; se AGREGAN a los que ya tenía el
  // punto (nunca se reemplazan) — un punto puede necesitar más de una evidencia.
  const subirArchivo = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append('licitacionCodigo', licitacionCodigo);
      for (const f of Array.from(files)) fd.append('files', f);
      const r = await fetch('/api/documentos/subir', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok || !d.documentos?.length) { toast.error(d.error || 'No se pudo subir el archivo'); return; }
      await onAccion(item.id, 'CARGAR', {
        documentos: (d.documentos as Array<{ url: string; nombre: string }>).map(doc => ({ url: doc.url, nombre: doc.nombre })),
        valorTexto: valorTexto.trim() || null,
      });
      setEditando(false);
    } finally {
      setSubiendo(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // Corrige un error de carga: cualquiera que pueda cargar puede borrar un documento subido de
  // más. Con confirmación porque no hay deshacer.
  const eliminarDocumento = async (doc: Documento) => {
    const ok = await confirmar({
      titulo: '¿Eliminar este documento?',
      mensaje: doc.nombre,
      confirmarLabel: 'Eliminar',
      peligro: true,
    });
    if (!ok) return;
    setEliminando(doc.id);
    try {
      await onAccion(item.id, 'ELIMINAR_DOCUMENTO', { documentoId: doc.id });
    } finally {
      setEliminando(null);
    }
  };

  const observar = async () => {
    if (!observacion.trim()) { toast.error('Escribe qué hay que corregir'); return; }
    if (await onAccion(item.id, 'OBSERVAR', { observacion: observacion.trim() })) {
      setObservando(false); setObservacion('');
    }
  };

  return (
    <div className={`px-4 py-3 ${noOfertada ? 'opacity-50' : ''} ${item.estado === 'OBSERVADO' ? 'bg-orange-50/40' : ''}`}>
      <div className="flex items-start gap-3">

        {/* Estado */}
        <div className="pt-0.5">
          {item.estado === 'APROBADO'
            ? <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center"><Check size={12} className="text-white" /></div>
            : item.estado === 'OBSERVADO'
              ? <div className="w-5 h-5 rounded-full bg-orange-500 flex items-center justify-center"><X size={12} className="text-white" /></div>
              : <div className={`w-5 h-5 rounded-full border-2 ${item.estado === 'CARGADO' ? 'border-indigo-400 bg-indigo-50' : 'border-zinc-200'}`} />}
        </div>

        {/* Contenido */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2 flex-wrap">
            <p className="text-[13px] font-semibold text-zinc-800 leading-snug">{item.titulo}</p>
            <span className={`text-[9.5px] font-bold px-1.5 py-px rounded ${crit.bg} ${crit.text}`}>{crit.label}</span>
            {item.ponderacion != null && item.ponderacion > 0 && (
              <span className="text-[9.5px] font-bold px-1.5 py-px rounded bg-violet-100 text-violet-700">{item.ponderacion}%</span>
            )}
            <span className={`text-[9.5px] font-bold px-1.5 py-px rounded ${est.bg} ${est.text}`}>{est.label}</span>
          </div>

          {item.descripcion && <p className="text-[11.5px] text-zinc-500 leading-snug mt-0.5">{item.descripcion}</p>}
          {item.fuente_cita && <p className="text-[10px] text-zinc-400 truncate mt-0.5" title={item.fuente_cita}>Fuente: {item.fuente_cita}</p>}

          {/* Evidencia cargada */}
          {(item.valor_numero != null || item.valor_texto) && !editando && (
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              {item.valor_numero != null && (
                <span className="text-[13px] font-bold text-emerald-700">{fmtCLP(item.valor_numero)}</span>
              )}
              {item.valor_texto && <span className="text-[12px] text-zinc-700">{item.valor_texto}</span>}
            </div>
          )}

          {/* Plazo fuera de rango YA guardado (o aprobado antes de que existiera este cruce):
              se marca en rojo en la fila, no solo al escribirlo. */}
          {avisoPlazo && (
            <p className={`mt-1.5 text-[11.5px] font-semibold flex items-start gap-1 ${avisoPlazo.nivel === 'error' ? 'text-rose-600' : 'text-amber-600'}`}>
              <AlertTriangle size={12} className="flex-shrink-0 mt-px" /> {avisoPlazo.mensaje}
            </p>
          )}

          {/* Documentos adjuntos — puede haber varios; cada uno con Ver (visor inline) y Descargar */}
          {item.documentos.length > 0 && !editando && (
            <div className="mt-1.5 space-y-1">
              {item.documentos.map(doc => (
                <div key={doc.id} className="flex items-center gap-1 max-w-full">
                  <FileText size={11} className="text-zinc-400 flex-shrink-0" />
                  <span className="text-[11.5px] text-zinc-700 truncate" title={doc.nombre}>{doc.nombre}</span>
                  <button
                    onClick={() => onVer({ nombre: doc.nombre, url: doc.url })}
                    title="Ver documento"
                    className="p-0.5 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors flex-shrink-0"
                  >
                    <Eye size={12} />
                  </button>
                  <a
                    href={doc.url} download={doc.nombre}
                    title="Descargar"
                    className="p-0.5 text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors flex-shrink-0"
                  >
                    <Download size={12} />
                  </a>
                  {!bloqueado && (
                    <button
                      onClick={() => eliminarDocumento(doc)}
                      disabled={eliminando === doc.id}
                      title="Eliminar (subido por error)"
                      className="p-0.5 text-zinc-300 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors flex-shrink-0 disabled:opacity-50"
                    >
                      {eliminando === doc.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Observación del asesor */}
          {item.estado === 'OBSERVADO' && item.observacion && (
            <div className="mt-2 text-[11.5px] text-orange-800 bg-orange-100/60 rounded-lg px-2.5 py-1.5">
              <span className="font-bold">Observado:</span> {item.observacion}
            </div>
          )}

          {/* Firmas */}
          {(item.cargado_por_nombre || item.aprobado_por_nombre) && (
            <p className="text-[10px] text-zinc-400 mt-1.5">
              {item.cargado_por_nombre && <>Cargó {item.cargado_por_nombre} · {fmtFecha(item.cargado_at)}</>}
              {item.aprobado_por_nombre && <> · Aprobó {item.aprobado_por_nombre} · {fmtFecha(item.aprobado_at)}</>}
            </p>
          )}

          {/* ── Edición ────────────────────────────────────────────────────── */}
          {editando && (
            <div className="mt-2.5 space-y-2">
              {item.tipo === 'precio' ? (
                <input
                  type="text" inputMode="numeric" autoFocus
                  value={valorNumero}
                  onChange={e => setValorNumero(e.target.value)}
                  placeholder="Precio neto ofertado"
                  className="w-full px-3 py-2 text-[13px] border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200"
                />
              ) : (
                <textarea
                  value={valorTexto} autoFocus
                  onChange={e => setValorTexto(e.target.value)}
                  // El texto SOLO ya bastaba para cargar un punto (ver `guardar`: exige texto O
                  // documento, nunca los dos), pero el placeholder decía "y adjunta el documento"
                  // y el usuario entendía que el archivo era obligatorio — no había forma visible
                  // de argumentar por qué un punto no aplica. Es lo mismo que ya se guarda en
                  // valor_texto; solo faltaba decirlo.
                  placeholder={item.tipo === 'dato'
                    ? 'Escribe el dato comprometido (opcional) — o guarda para confirmar que quedó tomado en cuenta'
                    : 'Adjunta el documento, o explica acá por qué no aplica o no lo tienes'}
                  rows={2}
                  className="w-full px-3 py-2 text-[13px] border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200 resize-none"
                />
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={guardar} disabled={ocupado}
                  className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-[11.5px] font-semibold rounded-lg disabled:opacity-50">
                  {ocupado ? <Loader2 size={12} className="animate-spin" /> : 'Guardar y enviar a visar'}
                </button>
                {/* El adjunto también existe en las alertas: varias piden evidencia real
                    (certificado de Tesorería, F30, documentación de experiencia, programa de
                    integridad) aunque no sean un anexo de las bases. Sigue siendo OPCIONAL — un
                    'dato' se puede confirmar sin subir nada, y guardar() no lo exige. */}
                {item.tipo !== 'precio' && (
                  <>
                    <input ref={fileRef} type="file" multiple className="hidden" onChange={e => subirArchivo(e.target.files)} />
                    <button onClick={() => fileRef.current?.click()} disabled={subiendo}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-zinc-200 text-zinc-600 hover:bg-zinc-50 text-[11.5px] font-semibold rounded-lg disabled:opacity-50">
                      {subiendo ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                      {item.documentos.length > 0 ? 'Adjuntar más' : item.tipo === 'dato' ? 'Adjuntar (opcional)' : 'Adjuntar'}
                    </button>
                  </>
                )}
                {item.generable && onGenerar && (
                  <button
                    type="button"
                    onClick={() => onGenerar(item)}
                    title="Rellenar este anexo con los datos de la empresa"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-indigo-200 text-indigo-600 hover:bg-indigo-50 text-[11.5px] font-semibold rounded-lg transition-colors"
                  >
                    <Sparkles size={12} /> Generar
                  </button>
                )}
                <button onClick={() => setEditando(false)} className="text-[11.5px] text-zinc-400 hover:text-zinc-600 px-1">Cancelar</button>
              </div>
            </div>
          )}

          {/* ── Observar (asesor) ──────────────────────────────────────────── */}
          {observando && (
            <div className="mt-2.5 space-y-2">
              <textarea
                value={observacion} autoFocus
                onChange={e => setObservacion(e.target.value)}
                placeholder="¿Qué hay que corregir? (obligatorio)"
                rows={2}
                className="w-full px-3 py-2 text-[13px] border border-orange-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-200 resize-none"
              />
              <div className="flex items-center gap-2">
                <button onClick={observar} disabled={ocupado}
                  className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-[11.5px] font-semibold rounded-lg disabled:opacity-50">
                  Devolver al asistente
                </button>
                <button onClick={() => setObservando(false)} className="text-[11.5px] text-zinc-400 hover:text-zinc-600 px-1">Cancelar</button>
              </div>
            </div>
          )}
        </div>

        {/* ── Acciones ─────────────────────────────────────────────────────── */}
        {!editando && !observando && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Asistente: cargar / corregir */}
            {!bloqueado && item.estado !== 'APROBADO' && (
              <button
                onClick={() => setEditando(true)}
                className="px-2.5 py-1 text-[11.5px] font-semibold text-violet-600 hover:bg-violet-50 rounded-lg transition-colors"
              >
                {item.estado === 'PENDIENTE' ? 'Cargar' : 'Corregir'}
              </button>
            )}

            {/* Línea que decidimos no ofertar (solo en por-línea) */}
            {item.tipo === 'precio' && item.linea_numero != null && item.estado !== 'APROBADO' && (
              <button
                onClick={() => onAccion(item.id, 'CARGAR', { ofertamos: !noOfertada ? false : true })}
                title={noOfertada ? 'Volver a incluir esta línea en la oferta' : 'No ofertamos esta línea'}
                className="px-2.5 py-1 text-[11.5px] font-semibold text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 rounded-lg transition-colors"
              >
                {noOfertada ? 'Incluir' : 'No ofertar'}
              </button>
            )}

            {/* Asesor: visar */}
            {puedeAprobar && item.estado === 'CARGADO' && (
              <>
                <button
                  onClick={() => {
                    // Un plazo sobre el máximo no se puede visar: aprobarlo es firmar una oferta
                    // inadmisible (pasó en 2724-35-LP26 con 31 días contra un tope de 30).
                    if (avisoPlazo?.nivel === 'error') { toast.error(avisoPlazo.mensaje || 'Plazo fuera de rango'); return; }
                    onAccion(item.id, 'APROBAR');
                  }}
                  disabled={ocupado}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11.5px] font-semibold rounded-lg disabled:opacity-50 transition-colors"
                >
                  {ocupado ? <Loader2 size={11} className="animate-spin" /> : <Check size={12} />} Aprobar
                </button>
                <button
                  onClick={() => setObservando(true)}
                  className="px-2.5 py-1 text-[11.5px] font-semibold text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                >
                  Observar
                </button>
              </>
            )}

            {/* Asesor: deshacer una aprobación */}
            {puedeAprobar && item.estado === 'APROBADO' && (
              <button
                onClick={() => onAccion(item.id, 'REABRIR')}
                title="Reabrir este punto"
                className="p-1.5 text-zinc-300 hover:text-zinc-600 hover:bg-zinc-50 rounded-lg transition-colors"
              >
                <Undo2 size={13} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
