'use client';

// AUDITOR unificado — pestaña "Compra": cotizaciones de Documentos leídas con el Lector (Prompt 6),
// OPCIONES por línea del costeo (línea + producto + proveedor), verificación calculada por código,
// cuadro comparativo de costo por línea y el ciclo firma → aprobación.
// Spec: docs/ESPECIFICACION_AUDITOR_v1.md. Backend: app/api/negocios/[id]/auditor/route.ts.
import { useState, useEffect, useCallback, useRef, Fragment, createContext, useContext } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Modal } from '@/app/components/ui/Modal';
import { useConfirm } from '@/app/components/ui/confirm';
import { resumenLicitacion, type LineaParaResumen } from '@/app/lib/auditor-resumen-licitacion';
import {
  IconLoader2 as Loader2, IconFileText as FileText, IconSparkles as Sparkles, IconChevronDown as ChevronDown,
  IconChevronRight as ChevronRight, IconAlertTriangle as Alerta, IconCircleCheck as Check, IconExternalLink as ExternalLink,
  IconRefresh as Refresh, IconEye as Eye, IconPaperclip as Clip, IconUpload as Upload, IconCopy as Copy, IconDownload as Download, IconTrash as Trash,
} from '@tabler/icons-react';
import { pedirJson, ultimoJson } from '@/app/lib/pedir-json';
import type { PanelAuditorDTO, LineaAuditorDTO, OpcionDTO, DocumentoCotizacionDTO } from '@/app/lib/auditor-opciones';

// Formatos de una ficha técnica (26-oct-2026: cuando la página del link no trae la ficha, se adjunta foto, PDF, Word, Excel o el texto).
// El Lector los transcribe todos (transcribirDocumento: OCR para imagen/PDF escaneado, mammoth/word-extractor, xlsx→csv, texto plano).
const EXT_FICHA = /\.(pdf|png|jpe?g|webp|docx?|xlsx?|txt|csv)$/i;
const ACCEPT_FICHA = '.pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt,.csv';

const fmtCLP = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

const ESTADO_OPCION: Record<string, { label: string; cls: string }> = {
  tanteo: { label: 'Tanteo', cls: 'bg-zinc-100 text-zinc-600' },
  formalizada: { label: 'Formalizada', cls: 'bg-sky-100 text-sky-700' },
  verificada: { label: 'Verificada', cls: 'bg-emerald-100 text-emerald-700' },
  definitiva: { label: 'Definitiva', cls: 'bg-teal-100 text-teal-700' },
  en_aprobacion: { label: 'En aprobación', cls: 'bg-amber-100 text-amber-700' },
  aprobada: { label: 'Aprobada', cls: 'bg-emerald-600 text-white' },
  descartada: { label: 'Descartada', cls: 'bg-zinc-200 text-slate-600 line-through' },
};
const VEREDICTO: Record<string, { label: string; cls: string }> = {
  VERIFICADO: { label: 'Verificado', cls: 'bg-emerald-100 text-emerald-700' },
  VERIFICADO_CON_ALERTAS: { label: 'Verificado con alertas', cls: 'bg-lime-100 text-lime-800' },
  REQUIERE_HABILITACION: { label: 'Requiere habilitación EM', cls: 'bg-amber-100 text-amber-800' },
  NO_VERIFICADO: { label: 'No verificado', cls: 'bg-red-100 text-red-700' },
  SIN_RESPALDO: { label: 'Sin respaldo', cls: 'bg-red-100 text-red-700' },
  PENDIENTE_CRUCE_TECNICO: { label: 'Pendiente cruce técnico', cls: 'bg-zinc-100 text-zinc-600' },
};

async function post(negocioId: number, body: Record<string, unknown>) {
  const res = await fetch(`/api/negocios/${negocioId}/auditor`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || 'No se pudo completar la acción');
  return data;
}

/** Modo impresión (?imprimir=1): el servidor abre esta MISMA pantalla y la imprime a PDF. Todo se muestra desplegado, tal cual la vista. */
const ImprimirCtx = createContext(false);

export function AuditorOpcionesPanel({ negocioId, licitacionCodigo, puedeAprobar, panelInicial, onIrAPrePostulacion }: {
  negocioId: number; licitacionCodigo: string; puedeAprobar: boolean;
  /** Último paso del recorrido: con todas las líneas aprobadas, el «Siguiente paso» lleva a la pestaña Pre-postulación. */
  onIrAPrePostulacion?: () => void;
  /** Solo para revisar la pantalla sin sesión (script de vista previa): si viene, no se pide el panel al servidor. */
  panelInicial?: PanelAuditorDTO;
}) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [panel, setPanel] = useState<PanelAuditorDTO | null>(panelInicial ?? ultimoJson<PanelAuditorDTO>(`/api/negocios/${negocioId}/auditor`) ?? null);   // lo último visto se pinta al tiro y se refresca por detrás
  const panelRef = useRef<PanelAuditorDTO | null>(null);
  const yaIntentadasCosto = useRef<Set<number>>(new Set());
  const yaIntentadas = useRef<Set<number>>(new Set());   // opciones a las que la verificación automática ya lo intentó en esta sesión
  panelRef.current = panel;
  const [cargando, setCargando] = useState(!panelInicial && !ultimoJson(`/api/negocios/${negocioId}/auditor`));
  const [leyendo, setLeyendo] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [abiertas, setAbiertas] = useState<Set<string>>(() => new Set<string>());
  const [agregarEn, setAgregarEn] = useState<Set<string>>(() => new Set<string>());   // líneas con el recuadro «Otra opción» abierto
  const [resolviendoEM, setResolviendoEM] = useState(false);   // el EM aprueba/acepta varias desde el recuadro «Esperan tu aprobación»
  const [docAbierto, setDocAbierto] = useState<number | null>(null);   // cotización abierta en el detalle
  const [imprimir, setImprimir] = useState(false);
  useEffect(() => { if (new URLSearchParams(window.location.search).has('imprimir')) setImprimir(true); }, []);
  const [cotizacionesAbierto, setCotizacionesAbierto] = useState(true);   // la lista de cotizaciones se puede esconder
  const [pestanaDocs, setPestanaDocs] = useState<'cotizaciones' | 'fichas'>('cotizaciones');   // 1 · Cotizaciones | Fichas técnicas
  const [destinoFicha, setDestinoFicha] = useState('');   // a qué opción («o<id>») o línea («l<filaId>») va la ficha que se sube desde la pestaña
  const inputFichaRef = useRef<HTMLInputElement>(null);
  const [sugiriendo, setSugiriendo] = useState(false);   // «Revisar con IA» de los productos sin línea
  const [mensajesAbierto, setMensajesAbierto] = useState(false);          // la tarjeta de mensajes parte plegada
  const [mensajesAbiertos, setMensajesAbiertos] = useState<Set<string>>(new Set());
  const [traiendo, setTraiendo] = useState<{ actual: number; total: number } | null>(null);
  const [agregandoLink, setAgregandoLink] = useState<string | null>(null);
  const [verificando, setVerificando] = useState<Set<number>>(new Set());
  const [modal, setModal] = useState<{ tipo: 'descartar' | 'rechazar' | 'no_ofertar' | 'anular_costo'; ref: number | string } | null>(null);
  const [texto, setTexto] = useState('');

  const cargar = useCallback(async (silencioso = false): Promise<PanelAuditorDTO | null> => {
    if (!silencioso && !ultimoJson(`/api/negocios/${negocioId}/auditor`)) setCargando(true);
    try {
      const data = await pedirJson(`/api/negocios/${negocioId}/auditor`, { fresco: silencioso });   // silencioso = tras una acción: lectura nueva
      if (!data.success) throw new Error(data.error || 'No se pudo cargar');
      setPanel(data);
      return data as PanelAuditorDTO;
    } catch (e: any) {
      toast.error('No se pudo cargar el Auditor', e.message);
      return null;
    } finally {
      setCargando(false);
    }
  }, [negocioId, toast]);
  useEffect(() => { if (!panelInicial) cargar(); }, [cargar, panelInicial]);

  const leerDocumento = async (d: DocumentoCotizacionDTO, auto = true) => {
    setLeyendo(prev => new Set(prev).add(d.url));
    try {
      const r = await post(negocioId, { accion: 'leer_documento', url: d.url });
      const n = (r.creadas || []).length, sin = (r.sinEmparejar || []).length;
      toast.success(`"${d.nombre}" leída`, `${n} producto${n === 1 ? '' : 's'} emparejado${n === 1 ? '' : 's'} con su línea${sin ? ` · ${sin} sin emparejar (asígnalos a mano)` : ''}.`);
    } catch (e: any) {
      toast.error(`No se pudo leer "${d.nombre}"`, e.message);
    } finally {
      setLeyendo(prev => { const n = new Set(prev); n.delete(d.url); return n; });
      const data = await cargar(true);
      if (auto) await autoVerificar(data);
    }
  };

  // «Volver a leer»: análisis nuevo de UNA cotización con los dos OCR juntos (para cuando el Lector leyó mal, p. ej. una imagen con precios grandes).
  // No repara nada solo: rehace la lectura y, si el producto se reconoce, el respaldo pasa a la lectura nueva (el anterior queda en el historial).
  const releerDocumento = async (d: DocumentoCotizacionDTO) => {
    const ok = await confirmar({
      titulo: `¿Volver a leer «${d.nombre}»?`,
      mensaje: 'Se analiza de nuevo solo esta cotización, usando los dos lectores de texto a la vez. Los productos que ya estaban en una opción pasan a la lectura nueva (con su precio nuevo) y la lectura anterior queda en el historial. Puede tardar un minuto.',
      confirmarLabel: 'Volver a leer',
    });
    if (!ok) return;
    setLeyendo(prev => new Set(prev).add(d.url));
    try {
      const r = await post(negocioId, { accion: 'releer_documento', url: d.url });
      toast.success(`"${d.nombre}" leída de nuevo`, [`${r.actualizadas} respaldo${r.actualizadas === 1 ? '' : 's'} actualizado${r.actualizadas === 1 ? '' : 's'}`, r.creadas ? `${r.creadas} opción(es) nueva(s)` : '', r.sinEmparejar ? `${r.sinEmparejar} producto(s) sin emparejar` : '', r.sinEquivalente ? `${r.sinEquivalente} ya no aparece(n) en la lectura nueva` : ''].filter(Boolean).join(' · ') + '.');
    } catch (e: any) { toast.error(`No se pudo volver a leer "${d.nombre}"`, e.message); }
    finally { setLeyendo(prev => { const n = new Set(prev); n.delete(d.url); return n; }); const data = await cargar(true); await autoVerificar(data); }
  };

  // Eliminar una cotización: borra el documento (caja «Cotizaciones») y todo lo que el Auditor sacó de él (lecturas, respaldos y opciones sin otro respaldo).
  const eliminarDocumento = async (d: DocumentoCotizacionDTO) => {
    const ok = await confirmar({
      titulo: `¿Eliminar «${d.nombre}»?`,
      mensaje: 'Se borra el archivo y todo lo que el Auditor leyó de él: sus productos emparejados y las opciones que solo se apoyaban en esta cotización. No se puede deshacer.',
      confirmarLabel: 'Eliminar',
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/documentos/${encodeURIComponent(licitacionCodigo)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: d.url, nombre: d.nombre }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo eliminar');
      toast.success('Cotización eliminada', d.nombre);
      setDocAbierto(null);
    } catch (e: any) { toast.error(`No se pudo eliminar "${d.nombre}"`, e.message); }
    finally { await cargar(true); }
  };

  const leerTodas = async () => {
    for (const d of (panel?.documentos || []).filter(x => !x.leido)) await leerDocumento(d, false);
    await autoVerificar(await cargar(true));
  };

  // Subir cotizaciones (una o varias, con botón o arrastrando): quedan en la caja «Cotizaciones» de Documentos Propios
  // (la misma que usa la pestaña Documentos) y se leen con el Lector en cuanto termina la subida.
  const [subiendo, setSubiendo] = useState<{ actual: number; total: number; nombre: string } | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  // Progreso visible de lo que se acaba de subir: cada archivo pasa por «en cola → subiendo → leyendo → listo/error» y el panel lo muestra.
  type FaseTrabajo = 'cola' | 'subiendo' | 'por_leer' | 'leyendo' | 'listo' | 'error';
  const [trabajo, setTrabajo] = useState<{ nombre: string; fase: FaseTrabajo; detalle?: string }[]>([]);
  const [analizando, setAnalizando] = useState(false);   // verificación automática posterior a la lectura
  const fase = (nombre: string, f: FaseTrabajo, detalle?: string) => setTrabajo(prev => prev.map(t => t.nombre === nombre ? { ...t, fase: f, detalle } : t));
  const inputCotRef = useRef<HTMLInputElement>(null);
  const EXT_OK = /\.(pdf|png|jpe?g|webp|docx?|xlsx?|txt|csv)$/i;

  // Sube UN archivo a Documentos Propios (subcategoría dada) y devuelve su URL pública. Lanza si algo falla.
  const subirADocumentos = async (f: File, subcategoria: 'cotizaciones' | 'fichas_tecnicas' | 'respaldos_auditor'): Promise<string> => {
    if (f.size > 100 * 1024 * 1024) throw new Error(`"${f.name}" supera los 100 MB.`);
    if (f.size === 0) throw new Error(`"${f.name}" está vacío (0 bytes): vuelve a exportarlo o descargarlo.`);
    const tipo = f.type || 'application/octet-stream';
    const pres = await fetch('/api/documentos/presign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licitacionCodigo, filename: f.name, contentType: tipo, size: f.size }),
    });
    const p = await pres.json();
    if (!pres.ok || !p.uploadUrl) throw new Error(p.error || 'No se pudo preparar la subida');
    const put = await fetch(p.uploadUrl, { method: 'PUT', headers: { 'Content-Type': tipo }, body: f });
    if (!put.ok) throw new Error('Falló la subida del archivo');
    const save = await fetch('/api/documentos/guardar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licitacionCodigo, documentoNombre: f.name, url: p.publicUrl, size: f.size, categoria: 'DOCUMENTOS_PROPIOS', subcategoria }),
    });
    if (!save.ok) throw new Error('No se pudo registrar el documento');
    return p.publicUrl as string;
  };

  const subirCotizaciones = async (archivos: File[]) => {
    const validos = archivos.filter(f => EXT_OK.test(f.name));
    const rechazados = archivos.length - validos.length;
    if (rechazados) toast.error(`${rechazados} archivo(s) no se subieron`, 'Solo PDF, imágenes, Word, Excel o texto (.txt).');
    if (!validos.length) return;
    const subidos: DocumentoCotizacionDTO[] = [];
    setTrabajo(validos.map(f => ({ nombre: f.name, fase: 'cola' as FaseTrabajo })));
    for (let i = 0; i < validos.length; i++) {
      const f = validos[i];
      fase(f.name, 'subiendo');
      setSubiendo({ actual: i + 1, total: validos.length, nombre: f.name });
      try {
        if (f.size > 100 * 1024 * 1024) throw new Error(`"${f.name}" supera los 100 MB.`);
        if (f.size === 0) throw new Error(`"${f.name}" está vacío (0 bytes): vuelve a exportarlo o descargarlo.`);
        const url = await subirADocumentos(f, 'cotizaciones');
        subidos.push({ url, nombre: f.name } as DocumentoCotizacionDTO);
        fase(f.name, 'por_leer');
      } catch (e: any) {
        fase(f.name, 'error', e.message);
        toast.error(`No se pudo subir "${f.name}"`, e.message);
      }
    }
    setSubiendo(null);
    if (!subidos.length) return;
    toast.success(`${subidos.length} cotización(es) subida(s)`, 'Leyéndolas con el Lector…');
    for (const d of subidos) {
      fase(d.nombre, 'leyendo');
      await leerDocumento(d, false);
      const err = panelRef.current?.documentos.find(x => x.url === d.url)?.error;
      if (err) fase(d.nombre, 'error', err); else fase(d.nombre, 'listo');
    }
    setAnalizando(true);
    try { await autoVerificar(await cargar(true)); } finally { setAnalizando(false); }
    setTimeout(() => setTrabajo(prev => prev.filter(t => t.fase === 'error')), 8000);   // lo terminado se esconde solo; los errores quedan
  };

  const agregarLink = async (filaId: string, url: string, auto = true): Promise<boolean> => {
    setAgregandoLink(filaId);
    try {
      const r = await post(negocioId, { accion: 'agregar_link', filaId, url });
      if (r.estadoLink === 'ya_registrado') toast.success('Ese link ya estaba registrado en esta línea');
      else if (r.opcionId == null) toast.error('No se agregó el link', r.error || 'La página no se pudo leer.');
      else if (r.error) toast.error('Link agregado, pero no se pudo leer el precio', r.error);
      else toast.success('Link agregado como opción de tanteo', 'El precio es el de la web: cuando tengas la cotización del proveedor, súbela y reemplaza este dato.');
      return true;
    } catch (e: any) { toast.error('No se pudo registrar el link', e.message); return false; }
    finally { setAgregandoLink(null); const data = await cargar(true); if (auto) await autoVerificar(data); }
  };


  // ── Ficha técnica: se sube a la OPCIÓN (o a la LÍNEA, y entonces la opción nace de la ficha). El Lector la lee completa y el
  //    verificador técnico la compara contra las bases en cuanto queda cargada. ──
  // Qué opciones (o líneas, si la ficha crea la opción) están leyendo una ficha: cada una muestra su propio «Leyendo ficha…».
  const [subiendoFicha, setSubiendoFicha] = useState<Set<string>>(new Set());
  const claveFicha = (ref: { opcionId?: number; filaId?: string }) => ref.opcionId != null ? `o${ref.opcionId}` : `l${ref.filaId ?? ''}`;
  const marcarFicha = (ref: { opcionId?: number; filaId?: string }, on: boolean) => setSubiendoFicha(prev => { const n = new Set(prev); if (on) n.add(claveFicha(ref)); else n.delete(claveFicha(ref)); return n; });
  // moverDe: la ficha se está cambiando de opción (pestaña Fichas técnicas); el servidor la quita de esa solo si quedó agregada en la nueva.
  const [fichaPorResolver, setFichaPorResolver] = useState<{ res: any; ref: { opcionId?: number; filaId?: string }; url: string; nombre: string; moverDe?: number } | null>(null);
  const procesarResultadoFicha = async (r: any, ref: { opcionId?: number; filaId?: string }, url: string, nombre: string, moverDe?: number) => {
    if (r.estado === 'elegir_producto' || r.estado === 'producto_distinto') { setFichaPorResolver({ res: r, ref, url, nombre, moverDe }); return; }
    setFichaPorResolver(null);
    if (r.movidaDe) {
      const lineaOrigen = etiquetaItem.get(r.movidaDe.filaId);
      toast.success('Ficha cambiada de opción', `Se compara con la nueva. La línea ${lineaOrigen ?? ''} de donde salió conserva su comparación anterior: usa «Volver a comparar la línea» ahí.`);
    } else toast.success(r.opcionCreada ? 'Opción creada desde la ficha' : 'Ficha técnica agregada a la opción', [...(r.avisos || []), 'Comparándola con las bases…'].join(' '));
    await cargar(true);
    const opc = (panelRef.current?.lineas || []).flatMap(l => l.opciones).find(o => o.id === r.opcionId);
    if (opc && opc.via === 'completa' && opc.tecnico.requisitosTotal > 0) await verificarTecnico(r.opcionId, true);
  };
  const subirFichas = async (archivos: File[], ref: { opcionId?: number; filaId?: string }) => {
    const validos = archivos.filter(f => EXT_FICHA.test(f.name));
    if (validos.length < archivos.length) toast.error('La ficha técnica puede ser PDF, foto (JPG, PNG, WEBP), Word, Excel o texto (.txt).');
    for (const f of validos) {
      marcarFicha(ref, true);
      try {
        const url = await subirADocumentos(f, 'fichas_tecnicas');
        const r = await post(negocioId, { accion: 'agregar_ficha', url, ...ref });
        await procesarResultadoFicha(r, ref, url, f.name);
      } catch (e: any) { toast.error(`No se pudo agregar "${f.name}"`, e.message); }
      finally { marcarFicha(ref, false); await cargar(true); }
    }
  };
  // Pestaña «Fichas técnicas»: cambiar una ficha de opción (o crear una opción nueva en otra línea con ella), o dejar de usarla.
  // respaldoId null = ficha sin asignar: solo se agrega al destino.
  const moverFicha = async (respaldoId: number | null, url: string, nombre: string, destino: { opcionId?: number; filaId?: string }) => {
    marcarFicha(destino, true);
    const moverDe = respaldoId ?? undefined;
    try { const r = await post(negocioId, { accion: 'agregar_ficha', url, ...destino, moverDe }); await procesarResultadoFicha(r, destino, url, nombre, moverDe); }
    catch (e: any) { toast.error('No se pudo cambiar la ficha', e.message); }
    finally { marcarFicha(destino, false); await cargar(true); }
  };
  // Eliminar la FICHA (el archivo): mismo borrado que una cotización (DELETE /api/documentos), que limpia lo que el Auditor sacó de ella y se
  // niega si respalda una opción firmada o en aprobación. Distinto de «Dejar de usar»: aquí el archivo desaparece de Documentos.
  const eliminarFicha = async (url: string, nombre: string, usos: number) => {
    const ok = await confirmar({
      titulo: `¿Eliminar la ficha «${nombre}»?`,
      mensaje: usos > 0
        ? `Se borra el archivo y deja de respaldar ${usos === 1 ? 'la opción donde está' : `las ${usos} opciones donde está`}. Si una opción se había creado solo con esta ficha, esa opción también se borra. Vuelve a comparar la línea después. No se puede deshacer.`
        : 'Se borra el archivo de Documentos. No se puede deshacer.',
      confirmarLabel: 'Eliminar la ficha',
      peligro: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/documentos/${encodeURIComponent(licitacionCodigo)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, nombre }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo eliminar');
      toast.success('Ficha eliminada', nombre);
    } catch (e: any) { toast.error(`No se pudo eliminar «${nombre}»`, e.message); }
    finally { await cargar(true); }
  };
  const quitarFicha = async (respaldoId: number, nombre: string, filaId: string) => {
    const ok = await confirmar({
      titulo: `¿Dejar de usar «${nombre}»?`,
      mensaje: `La ficha deja de respaldar esta opción (el archivo sigue en Documentos y se puede volver a asignar). La comparación de la línea ${etiquetaItem.get(filaId) ?? ''} no cambia sola: vuelve a compararla.`,
      confirmarLabel: 'Dejar de usarla',
    });
    if (!ok) return;
    try { await post(negocioId, { accion: 'quitar_ficha', respaldoId }); toast.success('Ficha quitada de la opción'); }
    catch (e: any) { toast.error('No se pudo quitar la ficha', e.message); }
    finally { await cargar(true); }
  };
  // Complemento de UN requisito: texto, documento/imagen, o ambos (la nota va con cada archivo). Queda en la celda para que el EM lo vea; no cierra nada.
  const respaldarCelda = async (opcionId: number, n: number, archivos: File[], nota = ''): Promise<boolean> => {
    const clave = `r${opcionId}-${n}`;
    setSubiendoFicha(prev => new Set(prev).add(clave));
    let ok = true;
    try {
      if (!archivos.length) {
        try { await post(negocioId, { accion: 'respaldar_celda', opcionId, n, url: '', nota }); toast.success('Nota agregada', `Quedó en el requisito ${n}. Lo revisa el EM.`); }
        catch (e: any) { ok = false; toast.error('No se pudo guardar la nota', e.message); }
      }
      for (const f of archivos) {
        try {
          const url = await subirADocumentos(f, 'respaldos_auditor');
          await post(negocioId, { accion: 'respaldar_celda', opcionId, n, url, nombre: f.name, nota });
          toast.success('Respaldo adjuntado', `«${f.name}» quedó en el requisito ${n}. Lo revisa el EM.`);
        } catch (e: any) { ok = false; toast.error(`No se pudo adjuntar "${f.name}"`, e.message); }
      }
    } finally { setSubiendoFicha(prev => { const x = new Set(prev); x.delete(clave); return x; }); await cargar(true); }
    return ok;
  };
  const subirFichasDesdeUrl = async (url: string, nombre: string, ref: { opcionId?: number; filaId?: string }, moverDe?: number) => {
    marcarFicha(ref, true);
    try { const r = await post(negocioId, { accion: 'agregar_ficha', url, ...ref, productoIdx: fichaPorResolver?.res.productoIdx, moverDe }); await procesarResultadoFicha(r, ref, url, nombre, moverDe); }
    catch (e: any) { toast.error('No se pudo agregar la ficha', e.message); }
    finally { marcarFicha(ref, false); await cargar(true); }
  };
  const resolverFicha = async (extra: { productoIdx?: number; forzar?: boolean }) => {
    if (!fichaPorResolver) return;
    const { ref, url, nombre, moverDe } = fichaPorResolver;
    marcarFicha(ref, true);
    try {
      const r = await post(negocioId, { accion: 'agregar_ficha', url, ...ref, ...extra, moverDe });
      await procesarResultadoFicha(r, ref, url, nombre, moverDe);
    } catch (e: any) { toast.error('No se pudo agregar la ficha', e.message); }
    finally { marcarFicha(ref, false); await cargar(true); }
  };
  const crearOpcionManual = async (filaId: string, d: { marca: string; modelo: string; proveedor: string }): Promise<boolean> => {
    try { await post(negocioId, { accion: 'crear_opcion', filaId, ...d }); toast.success('Opción creada', 'Sube su ficha técnica para compararla con las bases.'); return true; }
    catch (e: any) { toast.error('No se pudo crear la opción', e.message); return false; }
    finally { await cargar(true); }
  };

  // Comparador técnico (Prompt 4 v3.0): UNA llamada por LÍNEA compara todas sus opciones contra los requisitos. Puede tardar 1-3 minutos.
  // `solo`: compara únicamente esa opción (la que recibió una ficha o un link): más rápido y no toca el resultado de las demás.
  const verificarTecnico = async (opcionId: number, solo = false) => {
    const linea = (panelRef.current?.lineas || []).find(l => l.opciones.some(o => o.id === opcionId));
    const ids = solo || !linea ? [opcionId] : linea.opciones.filter(o => o.via === 'completa' && o.estado !== 'descartada').map(o => o.id);
    setVerificando(prev => new Set([...prev, ...ids]));
    try {
      let r: any;
      try { r = await post(negocioId, { accion: 'verificar_tecnico', opcionId, solo }); }
      catch (e: any) {
        // La IA a veces se cae por tiempo (caso real: «Request timed out»): se reintenta UNA vez antes de molestar al asistente.
        if (!/timed? ?out|timeout|tiempo|429|502|503|504|fetch failed|Failed to fetch/i.test(String(e?.message))) throw e;
        toast.info('La IA tardó demasiado', 'Reintentando la comparación técnica…');
        r = await post(negocioId, { accion: 'verificar_tecnico', opcionId, solo });
      }
      const ops: Array<{ estado: string }> = r.opciones || [];
      const n = (e: string) => ops.filter(x => x.estado === e).length;
      toast.success(solo ? 'Opción comparada' : 'Línea comparada', `${n('CUMPLE')} cumple${n('CUMPLE') === 1 ? '' : 'n'} · ${n('FALTA_DATO')} con falta de dato · ${n('NO_CUMPLE')} no cumple${n('NO_CUMPLE') === 1 ? '' : 'n'}.`);
    } catch (e: any) { toast.error('No se pudo comparar la línea', e.message); }
    finally { setVerificando(prev => { const n = new Set(prev); for (const id of ids) n.delete(id); return n; }); await cargar(true); }
  };

  // Verificador de costo con IA (Prompt 5 v2.0, L1-C): costos ocultos, unidad/empaque, producto distinto, plazo y la ayuda de cinco campos.
  const [verificandoCosto, setVerificandoCosto] = useState<Set<number>>(new Set());
  const verificarCostoIA = async (opcionId: number, silencioso = false) => {
    setVerificandoCosto(prev => new Set(prev).add(opcionId));
    try {
      const r = await post(negocioId, { accion: 'verificar_costo_ia', opcionId });
      if (!silencioso) toast.success('Verificación de costo lista', `${r.alertas} alerta${r.alertas === 1 ? '' : 's'} nueva${r.alertas === 1 ? '' : 's'}${r.descartados ? ` · ${r.descartados} hallazgo(s) descartado(s) por no tener cita en el documento` : ''}.`);
    } catch (e: any) { if (!silencioso) toast.error('No se pudo verificar el costo con la IA', e.message); }
    finally { setVerificandoCosto(prev => { const n = new Set(prev); n.delete(opcionId); return n; }); await cargar(true); }
  };

  // Mercado (Prompt 5 V9/V10/V10-b/V10-c): busca referencias del MISMO producto en la web, el historial del proveedor en MercadoPúblico y precios de mercado público.
  const [buscandoMercado, setBuscandoMercado] = useState<Set<number>>(new Set());
  const buscarMercado = async (opcionId: number) => {
    setBuscandoMercado(prev => new Set(prev).add(opcionId));
    try {
      const r = await post(negocioId, { accion: 'verificar_mercado', opcionId });
      if (r.error) toast.error('Mercado: no se pudo completar la búsqueda', r.error);
      else toast.success(`Mercado revisado: ${r.referencias} referencia${r.referencias === 1 ? '' : 's'} del mismo producto`, r.descartadas ? `${r.descartadas} descartada${r.descartadas === 1 ? '' : 's'} por no ser el mismo modelo.` : undefined);
    } catch (e: any) { toast.error('No se pudo revisar el mercado', e.message); }
    finally { setBuscandoMercado(prev => { const n = new Set(prev); n.delete(opcionId); return n; }); await cargar(true); }
  };

  // Informe COMPLETO (todo desplegado, sin que falte nada): «Copiar todo» lo deja como texto en el portapapeles y «PDF» lo descarga. Salen del servidor,
  // de los mismos datos que la pantalla, así que no dependen de qué esté plegado.
  const [exportando, setExportando] = useState<'copiar' | 'pdf' | null>(null);
  const copiarInforme = async () => {
    setExportando('copiar');
    try {
      const res = await fetch(`/api/negocios/${negocioId}/auditor/informe?formato=texto`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'No se pudo armar el informe');
      const texto = await res.text();
      await navigator.clipboard.writeText(texto);
      toast.success('Informe completo copiado', `${texto.length.toLocaleString('es-CL')} caracteres, con todo desplegado.`);
    } catch (e: any) { toast.error('No se pudo copiar el informe', e.message); }
    finally { setExportando(null); }
  };
  const descargarInformePdf = async () => {
    setExportando('pdf');
    try {
      const res = await fetch(`/api/negocios/${negocioId}/auditor/informe?formato=pdf`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        if (d.alternativa) { toast.error(d.error || 'No se pudo generar el PDF', 'Se descarga la versión en documento.'); window.open(d.alternativa, '_blank'); return; }
        throw new Error(d.error || 'No se pudo generar el PDF');
      }
      const blob = await res.blob();
      const nombre = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || `Auditor_${licitacionCodigo}.pdf`;
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e: any) { toast.error('No se pudo descargar el PDF', e.message); }
    finally { setExportando(null); }
  };

  const [calculandoPosicion, setCalculandoPosicion] = useState(false);
  const calcularPosicion = async () => {
    setCalculandoPosicion(true);
    try { await post(negocioId, { accion: 'posicion_precio' }); toast.success('Posición de precio calculada'); }
    catch (e: any) { toast.error('No se pudo calcular la posición de precio', e.message); }
    finally { setCalculandoPosicion(false); await cargar(true); }
  };

  // Verificación automática (spec: cada documento nuevo dispara el verificador técnico de su opción): corre sola sobre las opciones de
  // vía completa que todavía no se verificaron. Se llama después de agregar un link, leer una cotización o subir una ficha.
  const autoVerificar = async (data: PanelAuditorDTO | null) => {
    if (!data) return;
    // Una llamada por LÍNEA: si varias opciones de la misma línea esperan, se compara la línea una sola vez.
    for (const l of data.lineas) {
      const pend = l.opciones.filter(o => o.via === 'completa' && o.estado !== 'descartada' && !['aprobada', 'en_aprobacion'].includes(o.estado)
        && o.tecnico.estado === 'NO_CORRIDO' && !o.tecnico.error && o.tecnico.requisitosTotal > 0 && o.respaldos.some(r => r.extraccionId != null) && !yaIntentadas.current.has(o.id));
      if (!pend.length) continue;
      for (const o of l.opciones) yaIntentadas.current.add(o.id);
      // Si la línea ya tenía comparación, solo se compara lo nuevo; si nunca se comparó, va completa (una sola llamada).
      const yaComparada = l.opciones.some(o => o.tecnico.resultado);
      if (yaComparada) { for (const o of pend) await verificarTecnico(o.id, true); } else await verificarTecnico(pend[0].id);
    }
    // El verificador de costo con IA corre sobre las opciones con un respaldo de costo leído que todavía no pasaron por él.
    const sinCosto = data.lineas.flatMap(l => l.opciones.filter(o => o.via === 'completa' && o.estado !== 'descartada' && !['aprobada', 'en_aprobacion'].includes(o.estado)
      && o.costoIA == null && o.respaldos.some(r => r.tipo !== 'ficha_tecnica' && r.extraccionId != null) && !yaIntentadasCosto.current.has(o.id)));
    for (const o of sinCosto) { yaIntentadasCosto.current.add(o.id); await verificarCostoIA(o.id, true); }
  };

  const verificarTodoTecnico = async () => {
    for (const l of panel?.lineas || []) {
      const pend = l.opciones.filter(o => o.via === 'completa' && o.estado !== 'descartada' && o.tecnico.estado === 'NO_CORRIDO' && o.tecnico.requisitosTotal > 0 && o.respaldos.some(r => r.extraccionId != null));
      if (pend.length) await verificarTecnico(pend[0].id);
    }
  };

  // Registra de a uno los links que el Costeo ya trae (link1..link3 de cada fila): cada uno se visita, se captura y se lee.
  const traerLinksDelCosteo = async () => {
    const lista = panel?.linksPendientes || [];
    for (let i = 0; i < lista.length; i++) {
      setTraiendo({ actual: i + 1, total: lista.length });
      await agregarLink(lista[i].filaId, lista[i].url, false);
    }
    setTraiendo(null);
    await autoVerificar(await cargar(true));
  };

  const accion = async (opcionId: number, a: string, extra: Record<string, unknown> = {}, ok?: string) => {
    setOcupado(opcionId);
    try {
      const r = await post(negocioId, { accion: a, opcionId, ...extra });
      if (ok) toast.success(ok, Array.isArray(r.cambios) && r.cambios.length ? r.cambios.join(' ') : undefined);
    }
    catch (e: any) { toast.error('No se pudo completar', e.message); }
    finally { setOcupado(null); await cargar(true); }
  };

  const emparejarDeNuevo = async (d: DocumentoCotizacionDTO) => {
    if (d.extraccionId == null) return;
    try {
      const r = await post(negocioId, { accion: 'emparejar_documento', extraccionId: d.extraccionId });
      const n = (r.creadas || []).length;
      toast.success(n ? `${n} producto${n === 1 ? '' : 's'} emparejado${n === 1 ? '' : 's'}` : 'No hay productos nuevos que emparejar');
    } catch (e: any) { toast.error('No se pudo emparejar', e.message); }
    finally { await cargar(true); }
  };

  // Recuadro del EM: aprobar varias opciones o dar por cumplidos varios requisitos complementados de una vez (cada una con la regla de siempre).
  const enLoteEM = async (pasos: Array<() => Promise<unknown>>, ok: (n: number) => string) => {
    setResolviendoEM(true);
    let bien = 0; const errores: string[] = [];
    for (const paso of pasos) { try { await paso(); bien++; } catch (e: any) { errores.push(e.message); } }
    setResolviendoEM(false);
    if (errores.length) toast.error(`${bien} listo${bien === 1 ? '' : 's'}, ${errores.length} con problema`, errores[0]);
    else toast.success(ok(bien));
    await cargar(true);
  };
  const aprobarOpcionesEM = async (ids: number[]) => {
    const si = await confirmar({
      titulo: ids.length === 1 ? '¿Aprobar esta opción?' : `¿Aprobar ${ids.length} opciones?`,
      mensaje: 'Quedan aprobadas como la oferta de su línea y al asistente le llega el aviso en la campana.',
      confirmarLabel: ids.length === 1 ? 'Aprobar' : `Aprobar ${ids.length}`,
    });
    if (si) await enLoteEM(ids.map(id => () => post(negocioId, { accion: 'aprobar', opcionId: id })), n => n === 1 ? 'Opción aprobada' : `${n} opciones aprobadas`);
  };
  const aceptarRequisitosEM = async (items: Array<{ opcionId: number; n: number }>) => {
    const si = await confirmar({
      titulo: items.length === 1 ? '¿Dar este requisito por cumplido?' : `¿Dar ${items.length} requisitos por cumplidos?`,
      mensaje: 'Queda como cumplido a tu nombre, con el complemento del asistente como respaldo. Después el asistente puede firmar la opción.',
      confirmarLabel: items.length === 1 ? 'Dar por cumplido' : `Dar por cumplidos (${items.length})`,
    });
    if (si) await enLoteEM(items.map(it => () => post(negocioId, { accion: 'confirmar_celda', opcionId: it.opcionId, n: it.n, confirmada: true, motivo: 'Aceptado por el EM con el complemento del asistente.' })),
      n => n === 1 ? 'Requisito dado por cumplido' : `${n} requisitos dados por cumplidos`);
  };

  // Acciones que no son de una opción (líneas y costos asociados).
  const accionLinea = async (a: string, extra: Record<string, unknown>, ok?: string) => {
    try { await post(negocioId, { accion: a, ...extra }); if (ok) toast.success(ok); }
    catch (e: any) { toast.error('No se pudo completar', e.message); }
    finally { await cargar(true); }
  };

  const asignar = async (d: DocumentoCotizacionDTO, productoIdx: number, filaId: string) => {
    if (!filaId || d.extraccionId == null) return;
    try { await post(negocioId, { accion: 'asignar_producto', extraccionId: d.extraccionId, productoIdx, filaId }); toast.success('Producto asignado a la línea'); }
    catch (e: any) { toast.error('No se pudo asignar', e.message); }
    finally { await cargar(true); }
  };

  const sugerirLineasIA = async () => {
    setSugiriendo(true);
    try {
      const r = await post(negocioId, { accion: 'sugerir_lineas' });
      if (r.error) toast.error('La IA no pudo revisar los productos', r.error);
      else toast.success('Productos revisados', `${r.asignados} asignado(s) solos · ${r.sugeridos} con sugerencia · ${r.ninguna} que no van en ninguna línea`);
    } catch (e: any) { toast.error('No se pudo sugerir', e.message); }
    finally { setSugiriendo(false); await cargar(true); }
  };
  const ignorarProducto = async (d: DocumentoCotizacionDTO, productoIdx: number, ignorado: boolean) => {
    if (d.extraccionId == null) return;
    try { await post(negocioId, { accion: 'ignorar_producto', extraccionId: d.extraccionId, productoIdx, ignorado }); }
    catch (e: any) { toast.error('No se pudo guardar', e.message); }
    finally { await cargar(true); }
  };

  const confirmarModal = async () => {
    if (!modal) return;
    const { tipo, ref } = modal;
    if (!texto.trim()) { toast.error(({ descartar: 'Indica el motivo del descarte', rechazar: 'El rechazo requiere un comentario', no_ofertar: 'Indica el motivo por el que no se oferta la línea', anular_costo: 'Anular un costo asociado exige un comentario' })[tipo]); return; }
    setModal(null);
    if (tipo === 'descartar') await accion(Number(ref), 'descartar', { motivo: texto }, 'Opción descartada');
    else if (tipo === 'rechazar') await accion(Number(ref), 'rechazar', { comentario: texto }, 'Opción devuelta a verificada');
    else if (tipo === 'no_ofertar') await accionLinea('no_ofertar', { filaId: String(ref), motivo: texto }, 'Línea marcada como NO OFERTADA');
    else await accionLinea('anular_costo_asociado', { id: Number(ref), comentario: texto }, 'Costo asociado anulado');
    setTexto('');
  };

  // Varias filas del costeo pueden compartir el número de ítem (caso real 2427-98-LE26: tomógrafo y notebook, ambos «#1»): se numeran 1.1, 1.2…
  const etiquetaItem = etiquetasDeItem(panel?.lineas || []);
  const lineasSinAsignar = (panel?.lineas || []).map(l => ({ id: l.filaId, label: `Ítem ${etiquetaItem.get(l.filaId)} · ${l.detalle.slice(0, 48)}` }));

  if (cargando) {
    return <div className="bg-white rounded-2xl border border-zinc-200 p-10 flex items-center justify-center gap-2 text-slate-500"><Loader2 size={18} className="animate-spin" /> Cargando Auditor…</div>;
  }
  if (!panel) return null;
  if (panel.sinCosteo) {
    return <div className="bg-white rounded-2xl border border-zinc-200 p-10 text-center text-[13px] text-slate-600">Este negocio todavía no tiene un Costeo guardado: el Auditor trabaja sobre sus líneas.</div>;
  }

  const sinLeer = panel.documentos.filter(d => !d.leido).length;
  // Fichas técnicas en uso: una tarjeta por ficha y opción (la misma ficha puede respaldar dos opciones).
  const fichasCargadas = panel.lineas.flatMap(l => l.opciones.filter(o => o.estado !== 'descartada')
    .flatMap(o => o.respaldos.filter(r => r.tipo === 'ficha_tecnica' && r.vigente).map(r => ({ r, o, l }))));
  const fichasSinAsignar = panel.fichasSinAsignar ?? [];   // ?? []: un panel guardado en caché de antes de este campo
  const ocupadoGeneral = !!subiendo || leyendo.size > 0 || analizando || verificando.size > 0 || !!traiendo;
  const pendientesComparar = panel.lineas.filter(l => l.opciones.some(o => o.via === 'completa' && o.estado !== 'descartada' && o.tecnico.estado === 'NO_CORRIDO' && o.tecnico.requisitosTotal > 0 && o.respaldos.some(r => r.extraccionId != null))).length;
  const recorrido = recorridoAuditor(panel, puedeAprobar);

  const sinLineaTodos = panel.documentos.flatMap(d => d.productos.filter(p => !p.filaId && !p.esCargo && p.precio != null).map(p => ({ d, p })));
  const productosSinLinea = sinLineaTodos.filter(({ p }) => !p.noCorresponde);          // los que siguen esperando una decisión
  const productosSobrantes = sinLineaTodos.filter(({ p }) => !!p.noCorresponde);        // cotizados de más: no van en ninguna línea
  const resumenDeLinea = new Map(resumenLicitacion(lineasParaResumen(panel), panel.presupuesto?.neto ?? null).filas.map(f => [f.filaId, f]));
  // Desde el resumen se salta a la línea: se abre y la pantalla baja hasta ella.
  const irALinea = (filaId: string) => {
    setAbiertas(prev => new Set(prev).add(filaId));
    setTimeout(() => document.getElementById(`linea-${filaId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };
  const cotAbierta = cotizacionesAbierto || imprimir;
  const msgAbierto = mensajesAbierto || imprimir;
  const msgAbiertos = imprimir ? new Set(panel.mensajes.map(m => m.opcionIds.join('-'))) : mensajesAbiertos;

  return (
    <ImprimirCtx.Provider value={imprimir}>
    <div className="space-y-4" data-auditor-panel data-auditor-listo="1">
      {/* ── Encabezado: lo esencial y las acciones de la pantalla ── */}
      <div className="bg-white rounded-2xl border border-zinc-200 px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div>
          <h2 className="text-[15px] font-medium text-zinc-900">Auditor</h2>
          <p className="text-[13px] text-slate-600">
            {recorrido.total} línea{recorrido.total === 1 ? '' : 's'} a ofertar{panel.lineas.length > recorrido.total ? ` · ${panel.lineas.length - recorrido.total} no ofertada${panel.lineas.length - recorrido.total === 1 ? '' : 's'}` : ''}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-[12.5px]">
          <button data-no-pdf onClick={copiarInforme} disabled={exportando !== null} title="Copiar TODO el contenido del Auditor como texto (con todo desplegado)"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 text-zinc-700 font-semibold hover:bg-zinc-50 disabled:opacity-50">
            {exportando === 'copiar' ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />} Copiar todo
          </button>
          <button data-no-pdf onClick={descargarInformePdf} disabled={exportando !== null} title="Descargar TODO el contenido del Auditor en PDF (con todo desplegado)"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 text-zinc-700 font-semibold hover:bg-zinc-50 disabled:opacity-50">
            {exportando === 'pdf' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} PDF
          </button>
          <button data-no-pdf onClick={() => cargar(true)} className="text-slate-500 hover:text-zinc-700" title="Actualizar"><Refresh size={16} /></button>
        </div>
      </div>
      {recorrido.total > 0 && (<>
        {/* Recorrido del Auditor: cada paso cuenta líneas a ofertar; el primero sin terminar es el que toca */}
        <ol className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-x-3 gap-y-3">
          {recorrido.pasos.map((p, i) => {
            const hecho = p.hechas >= recorrido.total, actual = i === recorrido.actual;
            return (
              <li key={p.titulo} aria-current={actual ? 'step' : undefined}>
                <div className={`h-1 rounded-full ${hecho ? 'bg-teal-600' : actual ? 'bg-amber-500' : 'bg-zinc-200'}`} />
                <p className={`mt-1.5 text-[13px] font-medium ${actual ? 'text-slate-900' : 'text-slate-600'}`}>{i + 1} · {p.titulo}</p>
                <p className={`text-xs tabular-nums ${hecho ? 'text-teal-700' : 'text-slate-600'}`}>{hecho ? '✓ ' : ''}{p.hechas} de {recorrido.total}</p>
              </li>
            );
          })}
          <li aria-current={recorrido.actual === recorrido.pasos.length ? 'step' : undefined}>
            <div className={`h-1 rounded-full ${recorrido.actual === recorrido.pasos.length ? 'bg-teal-600' : 'bg-zinc-200'}`} />
            <p className={`mt-1.5 text-[13px] font-medium ${recorrido.actual === recorrido.pasos.length ? 'text-slate-900' : 'text-slate-600'}`}>5 · Pre-postulación</p>
            <p className="text-xs text-slate-600">{recorrido.actual === recorrido.pasos.length ? 'lista para seguir' : 'al aprobar todo'}</p>
          </li>
        </ol>
        <div data-no-pdf className="mt-4 pt-3 border-t border-zinc-100 flex flex-wrap items-center gap-3">
          <div className="min-w-[16rem] flex-1">
            <p className="text-xs text-slate-600">Siguiente paso</p>
            <p className="text-[13px] font-medium text-slate-800">{recorrido.texto}</p>
          </div>
          {(() => {
            const primario = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-700 text-white text-[13px] font-semibold hover:bg-teal-800 disabled:opacity-50';
            const secundario = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 text-zinc-700 text-[13px] font-semibold hover:bg-zinc-50 disabled:opacity-50';
            const girando = ocupadoGeneral ? <Loader2 size={13} className="animate-spin" /> : null;
            switch (recorrido.accion.tipo) {
              case 'subir': return <>
                {(panel.linksPendientes?.length ?? 0) > 0 && <button onClick={traerLinksDelCosteo} disabled={ocupadoGeneral} className={secundario}><Sparkles size={13} /> Traer {panel.linksPendientes.length} link{panel.linksPendientes.length === 1 ? '' : 's'} del costeo</button>}
                <button onClick={() => inputCotRef.current?.click()} disabled={ocupadoGeneral} className={primario}>{girando ?? <Upload size={13} />} Subir cotizaciones</button>
              </>;
              case 'comparar': return pendientesComparar > 0
                ? <button onClick={verificarTodoTecnico} disabled={ocupadoGeneral} className={primario}>{girando}{verificando.size > 0 ? 'Comparando… (1-3 min por línea)' : `Comparar ${pendientesComparar === 1 ? 'la línea pendiente' : `las ${pendientesComparar} líneas pendientes`}`}</button>
                : <button onClick={() => irALinea(recorrido.accion.filaId!)} className={primario}>Abrir la línea {etiquetaItem.get(recorrido.accion.filaId!)}</button>;
              case 'linea': return <button onClick={() => irALinea(recorrido.accion.filaId!)} className={primario}>Abrir la línea {etiquetaItem.get(recorrido.accion.filaId!)}</button>;
              case 'prepostulacion': return onIrAPrePostulacion ? <button onClick={onIrAPrePostulacion} className={primario}>Ir a Pre-postulación</button> : null;
              default: return null;
            }
          })()}
        </div>
      </>)}
      </div>

      {/* ── Solo el EM: lo que espera su decisión en ESTE negocio, con los botones ahí mismo (también está en Aprobaciones, junto a los demás negocios) ── */}
      {puedeAprobar && !imprimir && (
        <EsperanAlEM panel={panel} etiquetaItem={etiquetaItem} ocupado={resolviendoEM} onIrALinea={irALinea}
          onAprobar={aprobarOpcionesEM} onRechazar={id => { setTexto(''); setModal({ tipo: 'rechazar', ref: id }); }} onAceptar={aceptarRequisitosEM} />
      )}

      {/* ── 1 · Cotizaciones: una tarjeta por archivo; al abrirla se ve y se corrige todo lo de esa cotización ── */}
      <div
        onDragOver={e => { if (!subiendo && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setArrastrando(true); } }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setArrastrando(false); }}
        onDrop={e => {
          e.preventDefault(); setArrastrando(false);
          if (subiendo || !e.dataTransfer.files.length) return;
          if (pestanaDocs === 'fichas') { const ref = refDestinoFicha(destinoFicha); if (ref) subirFichas(Array.from(e.dataTransfer.files), ref); else toast.error('Elige primero para qué línea u opción es la ficha'); }
          else subirCotizaciones(Array.from(e.dataTransfer.files));
        }}
        className={`bg-white rounded-2xl border overflow-hidden transition-colors ${arrastrando ? 'border-teal-400 ring-2 ring-teal-200 bg-teal-50/40' : 'border-zinc-200'}`}>
        <div className="px-5 py-3.5 flex items-center gap-x-3 gap-y-2 flex-wrap">
          <button onClick={() => setCotizacionesAbierto(v => !v)} className="flex items-center gap-2 text-left min-w-0" title={cotAbierta ? 'Esconder' : 'Mostrar'}>
            {cotAbierta ? <ChevronDown size={14} className="text-slate-500 shrink-0" /> : <ChevronRight size={14} className="text-slate-500 shrink-0" />}
            <FileText size={16} className="text-amber-600 shrink-0" />
            <h3 className="text-[13.5px] font-medium text-zinc-900 whitespace-nowrap">1 · Documentos del proveedor</h3>
          </button>
          {/* Pestañas: las cotizaciones (sostienen el precio) y las fichas técnicas (solo lo técnico), cada una con a qué opción quedó */}
          <div role="tablist" className="flex items-center gap-1 rounded-lg bg-zinc-100 p-0.5 text-[13px]">
            {([['cotizaciones', 'Cotizaciones', panel.documentos.length], ['fichas', 'Fichas técnicas', fichasCargadas.length + fichasSinAsignar.length]] as const).map(([k, label, n]) => (
              <button key={k} role="tab" aria-selected={pestanaDocs === k} onClick={() => { setPestanaDocs(k); setCotizacionesAbierto(true); }}
                className={`px-2.5 py-1 rounded-md font-medium ${pestanaDocs === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
                {label} <span className="tabular-nums text-slate-500">{n}</span>
              </button>
            ))}
          </div>
          {pestanaDocs === 'cotizaciones' && <span className="text-[12.5px] text-slate-600">
            {panel.documentos.length} archivo{panel.documentos.length === 1 ? '' : 's'}
            {sinLeer > 0 && <> · <b className="text-amber-700">{sinLeer} sin leer</b></>}
            {productosSinLinea.length > 0 && <> · <b className="text-amber-700">{productosSinLinea.length} producto{productosSinLinea.length === 1 ? '' : 's'} sin línea</b></>}
            {sinLeer === 0 && productosSinLinea.length === 0 && panel.documentos.length > 0 && <> · <span className="text-emerald-700">{productosSobrantes.length ? 'todo leído' : 'todo leído y con su línea'}</span></>}
            {productosSobrantes.length > 0 && <> · {productosSobrantes.length} no va{productosSobrantes.length === 1 ? '' : 'n'} en ninguna línea</>}
          </span>}
          {pestanaDocs === 'fichas' ? (
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <select value={destinoFicha} onChange={e => setDestinoFicha(e.target.value)} className="max-w-[300px] rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-[13px] text-slate-700">
                <option value="">¿Para qué línea u opción es?</option>
                <OpcionesDestinoFicha panel={panel} etiquetaItem={etiquetaItem} />
              </select>
              <input ref={inputFichaRef} type="file" multiple accept={ACCEPT_FICHA} className="hidden"
                onChange={e => { const fs = Array.from(e.target.files || []); e.target.value = ''; const ref = refDestinoFicha(destinoFicha); if (fs.length && ref) subirFichas(fs, ref); }} />
              <button data-no-pdf onClick={() => inputFichaRef.current?.click()} disabled={!destinoFicha || subiendoFicha.size > 0}
                title={destinoFicha ? 'Subir la ficha (PDF o imagen) a esa línea u opción' : 'Elige primero para qué línea u opción es'}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-700 text-white text-[13px] font-medium hover:bg-teal-800 disabled:opacity-50">
                {subiendoFicha.size > 0 ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} {subiendoFicha.size > 0 ? 'Leyendo ficha…' : 'Subir fichas técnicas'}
              </button>
            </div>
          ) : (
          <div className="ml-auto flex items-center gap-2">
            {sinLeer > 0 && (
              <button data-no-pdf onClick={leerTodas} disabled={leyendo.size > 0 || !!subiendo}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-[13px] font-semibold hover:bg-amber-700 disabled:opacity-50">
                <Sparkles size={13} /> Leer {sinLeer} sin leer
              </button>
            )}
            <input ref={inputCotRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt,.csv" className="hidden"
              onChange={e => { const fs = Array.from(e.target.files || []); e.target.value = ''; if (fs.length) subirCotizaciones(fs); }} />
            <button data-no-pdf onClick={() => inputCotRef.current?.click()} disabled={!!subiendo || leyendo.size > 0 || analizando}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-700 text-white text-[13px] font-medium hover:bg-teal-800 disabled:opacity-50">
              {subiendo || leyendo.size > 0 || analizando ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              {subiendo ? `Subiendo ${subiendo.actual}/${subiendo.total}…` : leyendo.size > 0 ? 'Leyendo…' : analizando ? 'Verificando…' : 'Subir cotizaciones'}
            </button>
          </div>
          )}
        </div>
        {(trabajo.length > 0 || analizando) && (
          <div data-no-pdf className="mx-5 mb-3 rounded-xl border border-teal-200 bg-teal-50/60 px-4 py-3">
            <p className="text-[13.5px] font-medium text-teal-900">
              {trabajo.some(t => t.fase === 'cola' || t.fase === 'subiendo') ? 'Paso 1 de 3 · Subiendo el archivo…'
                : trabajo.some(t => t.fase === 'por_leer' || t.fase === 'leyendo') ? 'Paso 2 de 3 · Leyendo la cotización (puede tardar hasta un minuto)…'
                : analizando ? 'Paso 3 de 3 · Comparando con el costeo y verificando precios…'
                : trabajo.some(t => t.fase === 'error') ? 'Terminó, pero hubo un problema' : 'Listo: ya puedes revisar las líneas de abajo'}
            </p>
            <ul className="mt-2 space-y-1">
              {trabajo.map(t => (
                <li key={t.nombre} className="flex items-center gap-2 text-[13px] text-zinc-700">
                  {t.fase === 'listo' ? <Check size={14} className="text-emerald-600 shrink-0" />
                    : t.fase === 'error' ? <Alerta size={14} className="text-red-600 shrink-0" />
                    : t.fase === 'cola' || t.fase === 'por_leer' ? <span className="w-3.5 h-3.5 rounded-full border-2 border-zinc-300 shrink-0" />
                    : <Loader2 size={14} className="animate-spin text-teal-700 shrink-0" />}
                  <span className="font-medium truncate">{t.nombre}</span>
                  <span className="text-slate-600 shrink-0">
                    {t.fase === 'cola' ? 'en espera' : t.fase === 'subiendo' ? 'subiendo…' : t.fase === 'por_leer' ? 'subido, falta leerlo' : t.fase === 'leyendo' ? 'leyendo proveedor, productos y precios…'
                      : t.fase === 'listo' ? 'leído' : (t.detalle || 'no se pudo leer')}
                  </span>
                </li>
              ))}
            </ul>
            {(trabajo.some(t => t.fase !== 'listo' && t.fase !== 'error') || analizando) && (
              <div className="mt-2 h-1 rounded-full bg-teal-100 overflow-hidden">
                {/* Avance real: subir pesa poco, leer la mitad, terminar el resto; la verificación final deja la barra casi llena. */}
                <div className="h-full rounded-full bg-teal-600 transition-[width] duration-500" style={{ width: `${analizando ? 92 : Math.max(6, Math.round(trabajo.reduce((s, t) => s + ({ cola: 0, subiendo: 0.15, por_leer: 0.3, leyendo: 0.5, listo: 1, error: 1 } as Record<FaseTrabajo, number>)[t.fase], 0) / Math.max(1, trabajo.length) * 85))}%` }} />
              </div>
            )}
          </div>
        )}
        {cotAbierta && pestanaDocs === 'fichas' && (fichasCargadas.length + fichasSinAsignar.length === 0 ? (
          <p className="px-5 pb-5 text-[13.5px] text-slate-500">Todavía no hay fichas técnicas. Elige arriba para qué línea u opción es y súbela (PDF o imagen), o arrástrala aquí. Solo sirve para lo técnico: el precio sale de la cotización.</p>
        ) : (
          <div className="px-5 pb-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {/* Sin asignar primero: es lo que hay que resolver */}
            {fichasSinAsignar.map(fsa => {
              const moviendo = [...subiendoFicha].some(k => k.startsWith('o') || k.startsWith('l'));
              return (
                <div key={`sa${fsa.documentoId}`} className="rounded-xl border border-amber-200 bg-amber-50/40 px-3.5 py-3 shadow-sm">
                  <div className="flex items-start gap-2">
                    <FileText size={16} className="text-slate-500 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-slate-900 truncate" title={fsa.nombre}>{fsa.nombre}</p>
                      <p className="text-xs text-slate-600">{fsa.subidaAt ? `Subida el ${fsa.subidaAt.slice(0, 10).split('-').reverse().join('-')}` : 'Ficha técnica'}</p>
                    </div>
                    <a href={fsa.url} target="_blank" rel="noopener noreferrer" title="Ver la ficha" className="p-1 rounded-md text-teal-700 hover:bg-teal-50"><Eye size={15} /></a>
                    <button data-no-pdf onClick={() => eliminarFicha(fsa.url, fsa.nombre, 0)} title="Eliminar esta ficha (borra el archivo)" className="p-1 rounded-md text-slate-500 hover:text-red-600 hover:bg-red-50"><Trash size={15} /></button>
                  </div>
                  <dl className="mt-3 pt-3 border-t border-amber-100 space-y-2">
                    <div>
                      <dt className="text-xs text-slate-600">Va en</dt>
                      <dd className="mt-0.5 inline-flex items-center gap-1.5 text-[13px] font-medium text-amber-800"><span aria-hidden className="w-1.5 h-1.5 rounded-full bg-amber-500" />Sin asignar: no se usa en ninguna opción</dd>
                      {fsa.error && <dd className="mt-0.5 text-xs text-red-600">No se pudo leer: {fsa.error}</dd>}
                    </div>
                    <div data-no-pdf>
                      <dt className="text-xs text-slate-600">Asignar a</dt>
                      <dd className="mt-0.5">
                        <select value="" disabled={moviendo}
                          onChange={e => { const ref = refDestinoFicha(e.target.value); if (ref) moverFicha(null, fsa.url, fsa.nombre, ref); }}
                          className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-[13px] text-slate-700 disabled:opacity-50">
                          <option value="">{moviendo ? 'Leyendo…' : 'Elegir línea u opción…'}</option>
                          <OpcionesDestinoFicha panel={panel} etiquetaItem={etiquetaItem} />
                        </select>
                      </dd>
                    </div>
                  </dl>
                </div>
              );
            })}
            {fichasCargadas.map(({ r, o, l }) => {
              const bloqueada = ['en_aprobacion', 'aprobada'].includes(o.estado);
              const moviendo = [...subiendoFicha].some(k => k.startsWith('o') || k.startsWith('l'));
              return (
                <div key={r.id} className="rounded-xl border border-zinc-200 bg-white px-3.5 py-3 shadow-sm">
                  <div className="flex items-start gap-2">
                    <FileText size={16} className="text-slate-500 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-slate-900 truncate" title={r.documentoNombre || ''}>{r.documentoNombre || 'Ficha técnica'}</p>
                      <p className="text-xs text-slate-600 truncate">{r.cargadoPorNombre ? `Subida por ${r.cargadoPorNombre}` : 'Ficha técnica'}{r.cargadoAt ? ` · ${r.cargadoAt.slice(0, 10).split('-').reverse().join('-')}` : ''}</p>
                    </div>
                    {r.documentoUrl && <a href={r.documentoUrl} target="_blank" rel="noopener noreferrer" title="Ver la ficha" className="p-1 rounded-md text-teal-700 hover:bg-teal-50"><Eye size={15} /></a>}
                    {r.documentoUrl && (
                      <button data-no-pdf disabled={bloqueada}
                        onClick={() => eliminarFicha(r.documentoUrl!, r.documentoNombre || 'ficha', fichasCargadas.filter(x => x.r.documentoUrl === r.documentoUrl).length)}
                        title={bloqueada ? 'La opción ya está aprobada o en aprobación: el EM tiene que rechazarla antes de eliminar su ficha' : 'Eliminar esta ficha (borra el archivo)'}
                        className="p-1 rounded-md text-slate-500 hover:text-red-600 hover:bg-red-50 disabled:opacity-40"><Trash size={15} /></button>
                    )}
                  </div>
                  <dl className="mt-3 pt-3 border-t border-zinc-100 space-y-2">
                    <div>
                      <dt className="text-xs text-slate-600">Va en</dt>
                      <dd className="mt-0.5 text-[13px] text-slate-800">
                        <button onClick={() => irALinea(l.filaId)} className="text-left hover:underline" title="Abrir esa línea">
                          <span className="font-medium">Línea {etiquetaItem.get(l.filaId)}</span> · {[o.marca, o.modelo].filter(Boolean).join(' ') || 'producto sin identificar'}
                        </button>
                        <span className="block text-xs text-slate-600 truncate">{o.proveedorRazonSocial || 'proveedor sin identificar'} · {ESTADO_OPCION[o.estado]?.label}</span>
                      </dd>
                    </div>
                    <div data-no-pdf>
                      <dt className="text-xs text-slate-600">Cambiar a</dt>
                      <dd className="mt-0.5">
                        <select value="" disabled={bloqueada || moviendo}
                          title={bloqueada ? 'La opción está en aprobación: pide rechazarla antes de cambiar sus documentos' : 'Mover la ficha a otra opción o línea'}
                          onChange={e => {
                            const v = e.target.value;
                            if (v === '__quitar') quitarFicha(r.id, r.documentoNombre || 'la ficha', l.filaId);
                            else { const ref = refDestinoFicha(v); if (ref && r.documentoUrl) moverFicha(r.id, r.documentoUrl, r.documentoNombre || 'ficha', ref); }
                          }}
                          className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-[13px] text-slate-700 disabled:opacity-50">
                          <option value="">{moviendo ? 'Leyendo…' : 'Elegir otra línea u opción…'}</option>
                          <OpcionesDestinoFicha panel={panel} etiquetaItem={etiquetaItem} excluirOpcionId={o.id} />
                          <option value="__quitar">✕ Dejar de usar esta ficha</option>
                        </select>
                      </dd>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>
        ))}
        {cotAbierta && pestanaDocs === 'cotizaciones' && (panel.documentos.length === 0 ? (
          <p className="px-5 pb-5 text-[13.5px] text-slate-500">Todavía no hay cotizaciones. Arrastra aquí uno o varios archivos (PDF, imagen, Word, Excel o .txt) o usa «Subir cotizaciones»: se leen solas y cada producto se asigna a su línea.</p>
        ) : (
          <div className="px-5 pb-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {panel.documentos.map(d => {
              const productos = d.productos.filter(p => !p.esCargo);
              // «No va» = la IA (o una persona) ya decidió que no corresponde a ninguna línea: no es un pendiente, no se cuenta como «sin línea».
              const sinLinea = productos.filter(p => !p.filaId && p.precio != null && !p.noCorresponde).length;
              const noVan = productos.filter(p => !p.filaId && p.precio != null && !!p.noCorresponde).length;
              const leyendoEste = leyendo.has(d.url);
              return (
                <div key={d.documentoId} className="relative group">
                <button onClick={() => setDocAbierto(d.documentoId)} title="Abrir esta cotización"
                  className="w-full text-left rounded-xl border border-zinc-200 bg-white px-3.5 py-3 shadow-sm hover:shadow-md hover:-translate-y-px hover:border-teal-300 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
                  <div className="flex items-start gap-2 pr-6">
                    <FileText size={16} className="text-slate-500 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-slate-900 truncate">{d.proveedor || d.nombre}</p>
                      <p className="text-xs text-slate-600 truncate">{d.nombre}{d.fechaEmision ? ` · ${d.fechaEmision}` : ''}</p>
                    </div>
                  </div>
                  {leyendoEste ? <p className="mt-3 pt-3 border-t border-zinc-100 inline-flex items-center gap-1.5 text-[13px] font-medium text-amber-700"><Loader2 size={12} className="animate-spin" /> Leyendo…</p>
                    : d.error ? <p className="mt-3 pt-3 border-t border-zinc-100 text-[13px] font-medium text-red-600">No se pudo leer</p>
                    : !d.leido ? <p className="mt-3 pt-3 border-t border-zinc-100 text-[13px] font-medium text-amber-700">Sin leer</p>
                    : (
                      <dl className="mt-3 pt-3 border-t border-zinc-100 grid grid-cols-3 gap-x-3">
                        <div><dt className="text-xs text-slate-600">Productos</dt><dd className="mt-0.5 text-[13px] font-bold tabular-nums text-slate-800">{productos.length}</dd></div>
                        <div><dt className="text-xs text-slate-600">Con su línea</dt><dd className="mt-0.5 text-[13px] font-bold tabular-nums text-slate-800">{productos.filter(p => p.filaId).length}</dd></div>
                        {noVan > 0 && sinLinea === 0
                          ? <div><dt className="text-xs text-slate-600">No van</dt><dd className="mt-0.5 text-[13px] font-bold tabular-nums text-slate-600">{noVan}</dd></div>
                          : <div><dt className="text-xs text-slate-600">Sin línea</dt><dd className={`mt-0.5 text-[13px] font-bold tabular-nums ${sinLinea > 0 ? 'text-amber-700' : 'text-slate-500'}`}>{sinLinea}</dd></div>}
                        {d.formalidad === 'informal' && <div className="col-span-3 mt-1.5 text-xs text-slate-600">Cotización informal</div>}
                      </dl>
                    )}
                </button>
                <button data-no-pdf onClick={() => eliminarDocumento(d)} title="Eliminar esta cotización y lo que se leyó de ella" disabled={leyendoEste}
                  className="absolute top-2 right-2 p-1 rounded-md text-slate-500 hover:text-red-600 hover:bg-red-50 disabled:opacity-40"><Trash size={14} /></button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* ── Documentos sin línea (Prompt 4 v3.0, salida 3): lo que se leyó pero no se sabe a qué línea va ── */}
      {(productosSinLinea.length > 0 || productosSobrantes.length > 0) && (
        <div className={`rounded-2xl border px-5 py-3.5 ${productosSinLinea.length > 0 ? 'border-amber-200 bg-amber-50/60' : 'border-zinc-200 bg-white'}`}>
          {productosSinLinea.length > 0 && <>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[13.5px] font-bold text-amber-900">Productos sin línea ({productosSinLinea.length})</p>
              <span className="text-[12.5px] text-amber-800/80">— cotizados por un proveedor pero no se sabe a qué línea van. La IA los revisa sola al leer la cotización.</span>
              <button data-no-pdf onClick={sugerirLineasIA} disabled={sugiriendo}
                className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-600 text-white text-[12.5px] font-semibold hover:bg-amber-700 disabled:opacity-60">
                {sugiriendo ? <><Loader2 size={12} className="animate-spin" /> Revisando…</> : <><Sparkles size={12} /> Revisar con IA</>}
              </button>
            </div>
            <ul className="mt-2 space-y-2">
              {productosSinLinea.map(({ d, p }) => {
                const linea = p.sugerencia ? panel.lineas.find(l => l.filaId === p.sugerencia!.filaId) : null;
                return (
                  <li key={`${d.documentoId}-${p.idx}`} className="text-[13px] text-zinc-700">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-zinc-900">{p.nombre}</span>
                      <span className="text-slate-600">{fmtCLP(p.precio)}{p.iva === 'no_declarado' ? '' : p.iva === 'incluido' ? ' con IVA' : ' + IVA'}</span>
                      <span className="text-slate-500 text-xs">de {d.proveedor || d.nombre}</span>
                      <select defaultValue="" onChange={e => asignar(d, p.idx, e.target.value)} className="ml-auto text-[12.5px] border border-amber-300 rounded-md px-1.5 py-0.5 bg-white text-zinc-700">
                        <option value="">Asignar a la línea…</option>
                        {lineasSinAsignar.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                      </select>
                      <button data-no-pdf onClick={() => ignorarProducto(d, p.idx, true)} title="Es un producto cotizado de más (accesorio, otra capacidad…): sale de esta lista"
                        className="text-xs text-slate-600 hover:text-red-600 underline">No va en ninguna línea</button>
                    </div>
                    {p.sugerencia && linea && (
                      <div className="mt-1 ml-0 flex items-center gap-2 flex-wrap rounded-md bg-white/70 border border-amber-200 px-2 py-1">
                        <span className="text-[12.5px]">🤖 La IA cree que va en la <b>línea {p.sugerencia.item}</b>{p.sugerencia.motivo ? <span className="text-slate-600"> — {p.sugerencia.motivo}</span> : null}</span>
                        <button data-no-pdf onClick={() => asignar(d, p.idx, p.sugerencia!.filaId)} className="ml-auto px-2 py-0.5 rounded bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700">Aceptar</button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>}
          {productosSobrantes.length > 0 && (
            <details className={productosSinLinea.length > 0 ? 'mt-3' : ''} open={imprimir}>
              <summary className="cursor-pointer text-[13px] font-semibold text-zinc-600">{productosSobrantes.length} producto{productosSobrantes.length === 1 ? '' : 's'} cotizado{productosSobrantes.length === 1 ? ' que no va' : 's que no van'} en ninguna línea</summary>
              <ul className="mt-1.5 space-y-1">
                {productosSobrantes.map(({ d, p }) => (
                  <li key={`${d.documentoId}-${p.idx}`} className="flex items-center gap-2 flex-wrap text-[12.5px] text-slate-600">
                    <span className="font-medium text-zinc-700">{p.nombre}</span><span>{fmtCLP(p.precio)}</span><span className="text-slate-500">de {d.proveedor || d.nombre}</span>
                    <span className="italic">— {p.noCorresponde!.motivo}</span>
                    <select data-no-pdf defaultValue="" onChange={e => asignar(d, p.idx, e.target.value)} className="ml-auto text-xs border border-zinc-200 rounded-md px-1.5 py-0.5 bg-white">
                      <option value="">Asignar igual a una línea…</option>
                      {lineasSinAsignar.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                    </select>
                    {p.noCorresponde!.por !== 'la IA' && <button data-no-pdf onClick={() => ignorarProducto(d, p.idx, false)} className="text-xs underline hover:text-zinc-800">deshacer</button>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* ── 2 · Resumen de la licitación ── */}
      <ResumenLicitacionCard panel={panel} etiquetaItem={etiquetaItem} onIrALinea={irALinea} />

      {/* ── Líneas con su cuadro comparativo ── */}
      {/* Cada línea es su propia tarjeta (antes iban pegadas en una lista y al abrir una no se sabía dónde terminaba ni cuál era la siguiente). */}
      <section>
        <div className="px-1 pb-2.5 flex items-center gap-2 flex-wrap">
          <h3 className="text-[14px] font-medium text-zinc-900">3 · Líneas</h3>
          <span className="hidden sm:inline text-[13px] text-slate-600">— abre una línea para comparar sus opciones, confirmar datos y firmar</span>
          {(() => {
            const pend = pendientesComparar;
            return pend > 0 ? (
              <button data-no-pdf onClick={verificarTodoTecnico} disabled={verificando.size > 0}
                className={`${(panel.linksPendientes?.length ?? 0) > 0 ? '' : 'ml-auto'} flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-teal-200 text-teal-700 text-[13px] font-semibold hover:bg-teal-50 disabled:opacity-60`}>
                {verificando.size > 0 ? <><Loader2 size={13} className="animate-spin" /> Comparando…</> : <>{pend === 1 ? 'Comparar la línea pendiente' : `Comparar las ${pend} líneas pendientes`}</>}
              </button>
            ) : null;
          })()}
          {(panel.linksPendientes?.length ?? 0) > 0 && (
            <button onClick={traerLinksDelCosteo} disabled={!!traiendo || leyendo.size > 0}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 text-zinc-700 text-[13px] font-semibold hover:bg-zinc-50 disabled:opacity-60">
              {traiendo ? <><Loader2 size={13} className="animate-spin" /> Leyendo link {traiendo.actual} de {traiendo.total}…</> : <><Sparkles size={13} /> Traer {panel.linksPendientes.length} link{panel.linksPendientes.length === 1 ? '' : 's'} del costeo</>}
            </button>
          )}
        </div>
        <ul className="space-y-3">
          {panel.lineas.map(l => {
            const abierta = abiertas.has(l.filaId) || imprimir;
            const activas = l.opciones.filter(o => o.estado !== 'descartada');
            return (
              <li key={l.filaId} id={`linea-${l.filaId}`}
                className={`scroll-mt-4 rounded-2xl border bg-white overflow-clip transition-shadow ${abierta ? 'border-teal-300 shadow-md' : 'border-zinc-200 shadow-sm hover:shadow-md'} ${l.noOfertada ? 'opacity-60' : ''}`}>
                <button onClick={() => setAbiertas(prev => { const n = new Set(prev); if (n.has(l.filaId)) n.delete(l.filaId); else n.add(l.filaId); return n; })}
                  aria-expanded={abierta}
                  className={`w-full flex items-center gap-2 px-5 py-3.5 text-left ${abierta ? 'bg-teal-50/50 border-b border-teal-100' : 'hover:bg-zinc-50'}`}>
                  {abierta ? <ChevronDown size={14} className="text-slate-500 shrink-0" /> : <ChevronRight size={14} className="text-slate-500 shrink-0" />}
                  <span className="text-[13px] font-semibold tabular-nums text-slate-700 shrink-0 whitespace-nowrap">Línea {etiquetaItem.get(l.filaId)}</span>
                  <span className="text-[13.5px] font-medium text-zinc-800 truncate flex-1" title={l.detalle}>{l.detalle}</span>
                  <span className="text-[13px] text-slate-600 whitespace-nowrap tabular-nums">x{l.cantidad}</span>
                  {l.costeadoNeto != null && <span title="Costo unitario neto que quedó en el Costeo para esta línea" className="hidden md:inline text-[13px] text-slate-600 whitespace-nowrap">Costeo <b className="text-slate-700 tabular-nums">{fmtCLP(l.costeadoNeto)}</b></span>}
                  {(() => {
                    const punto = (color: string, texto: React.ReactNode) => <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-700 whitespace-nowrap"><span aria-hidden className={`w-1.5 h-1.5 rounded-full shrink-0 ${color}`} />{texto}</span>;
                    if (l.noOfertada) return punto('bg-slate-400', 'No ofertada');
                    const def = l.opciones.find(o => o.id === l.opcionDefinitivaId);
                    if (def) return punto(def.estado === 'aprobada' ? 'bg-emerald-600' : 'bg-teal-600', def.estado === 'aprobada' ? 'Aprobada' : def.estado === 'en_aprobacion' ? 'En aprobación' : 'Firmada');
                    const f = resumenDeLinea.get(l.filaId);
                    if (!f?.mejor) {
                      if (!activas.length) return punto('bg-slate-300', 'Sin opciones');
                      const nunca = activas.some(porComparar) && !activas.some(o => o.tecnico.resultado);
                      if (!nunca && activas.some(precioPendiente)) return punto('bg-amber-500', 'Falta confirmar el precio');
                      return punto(nunca ? 'bg-amber-500' : 'bg-slate-400', nunca ? 'Sin comparar' : 'Ninguna cumple todavía');
                    }
                    return punto(f.faltaDato ? 'bg-amber-500' : 'bg-emerald-600', <>{f.faltaDato ? 'Falta dato' : 'Cumple'} · <span className="tabular-nums">{fmtCLP(f.mejor.costoUnitNeto)}</span></>);
                  })()}
                  {activas.length > 0 && <span className="text-[13px] text-slate-600 whitespace-nowrap tabular-nums">{activas.length === 1 ? '1 opción' : `${activas.length} opciones`}</span>}
                </button>
                {abierta && (
                  <div className="px-5 pt-3.5 pb-5">
                    {l.noOfertada && <p className="text-[13px] text-slate-600 ml-6 mb-2">No se oferta: {l.motivoNoOfertada}</p>}
                    <div className="flex items-center gap-2 flex-wrap mb-3">
                      {(() => {
                        const comparables = l.opciones.filter(o => o.via === 'completa' && o.tecnico.requisitosTotal > 0 && ['tanteo', 'formalizada', 'verificada', 'definitiva'].includes(o.estado) && o.respaldos.some(r => r.extraccionId != null));
                        if (!comparables.length || l.noOfertada) return null;
                        const ocupada = comparables.some(o => verificando.has(o.id));
                        return (
                          <button data-no-pdf onClick={() => verificarTecnico(comparables[0].id)} disabled={ocupada}
                            title="Compara todas las opciones de esta línea contra sus requisitos (una sola consulta a la IA, tarda 1-3 minutos)"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-700 text-white text-[13px] font-semibold hover:bg-teal-800 disabled:opacity-60">
                            {ocupada ? <><Loader2 size={13} className="animate-spin" /> Comparando… (1-3 min)</> : l.opciones.some(o => o.tecnico.resultado) ? 'Volver a comparar la línea' : 'Comparar la línea'}
                          </button>
                        );
                      })()}
                      {(() => {
                        // Otra alternativa para la línea (otro proveedor o modelo, por link, ficha o a mano). Solo hace falta para comparar alternativas
                        // o si la línea no tiene cotización: con opciones ya cargadas queda como un botón chico que abre el recuadro.
                        const conOpciones = l.opciones.some(o => o.estado !== 'descartada');
                        const abiertoAgregar = !conOpciones || agregarEn.has(l.filaId);
                        return <>
                          {conOpciones && !l.noOfertada && (
                            <button data-no-pdf onClick={() => setAgregarEn(prev => { const s = new Set(prev); if (s.has(l.filaId)) s.delete(l.filaId); else s.add(l.filaId); return s; })}
                              title="Sumar otra alternativa (otro proveedor o modelo) para compararla: con su link, su ficha técnica o marca y modelo"
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-zinc-200 text-[13px] font-medium text-slate-700 hover:bg-zinc-50">
                              {abiertoAgregar ? '✕ Cerrar' : '＋ Otra opción'}
                            </button>
                          )}
                          {l.noOfertada
                            ? <button data-no-pdf onClick={() => accionLinea('reofertar', { filaId: l.filaId }, 'Línea vuelve a ofertarse')} className="text-[12.5px] font-semibold text-teal-700 hover:underline">Volver a ofertar</button>
                            : <button data-no-pdf onClick={() => { setTexto(''); setModal({ tipo: 'no_ofertar', ref: l.filaId }); }} className="text-[12.5px] font-semibold text-slate-600 hover:text-red-600">No ofertar esta línea</button>}
                          {abiertoAgregar && !l.noOfertada && (
                            <div data-no-pdf className="basis-full mt-1 rounded-lg border border-zinc-200 bg-zinc-50/60 px-3 py-2.5">
                              <p className="text-[13px] font-medium text-slate-700">{conOpciones ? 'Agregar otra opción para comparar' : 'Esta línea todavía no tiene cotización'}</p>
                              <p className="text-[12.5px] text-slate-600 mb-2">Lo ideal es la cotización del proveedor (súbela en «1 · Documentos del proveedor»). Si no la tienes, con el link del producto o su ficha técnica igual se compara lo técnico; el precio del link queda como tanteo.</p>
                              <div className="flex items-start gap-x-6 gap-y-2 flex-wrap">
                                <AgregarLink filaId={l.filaId} ocupado={agregandoLink === l.filaId} onAgregar={agregarLink} />
                                <OpcionSinLink filaId={l.filaId} ocupadoFicha={subiendoFicha.has(`l${l.filaId}`)} onCrear={crearOpcionManual} onSubirFicha={(f) => subirFichas(f, { filaId: l.filaId })} />
                              </div>
                            </div>
                          )}
                        </>;
                      })()}
                    </div>
                    {l.opciones.length === 0 ? (
                      <p className="text-[13px] text-slate-600">Esta línea todavía no tiene productos.{l.links.length > 0 && <> Link de referencia del costeo: <a href={l.links[0]} target="_blank" rel="noopener noreferrer" className="text-teal-700 hover:underline inline-flex items-center gap-0.5">abrir <ExternalLink size={10} /></a></>}</p>
                    ) : (
                      <CuadroLinea negocioId={negocioId} linea={l} ocupado={ocupado} verificando={verificando} onVerificar={verificarTecnico} puedeAprobar={puedeAprobar}
                        subiendoFicha={subiendoFicha} onSubirFicha={(opcionId, f) => subirFichas(f, { opcionId })} onRespaldarCelda={respaldarCelda}
                        buscandoMercado={buscandoMercado} onMercado={buscarMercado} verificandoCosto={verificandoCosto} onCostoIA={(id) => verificarCostoIA(id)}
                        onAccion={accion} onModal={(tipo, opcionId) => { setTexto(''); setModal({ tipo, ref: opcionId }); }} />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Mensaje único por proveedor: la tarjeta y cada mensaje se pliegan (la lista es larga) ── */}
      {panel.mensajes.length > 0 && (
        <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
          <div className="px-5 py-3 flex items-center gap-2">
            <button onClick={() => setMensajesAbierto(v => !v)} className="flex items-center gap-2 text-left flex-1 min-w-0">
              {msgAbierto ? <ChevronDown size={14} className="text-slate-500 shrink-0" /> : <ChevronRight size={14} className="text-slate-500 shrink-0" />}
              <h3 className="text-[13.5px] font-bold text-zinc-900 whitespace-nowrap">Mensaje al proveedor</h3>
              <span className="text-[12.5px] text-slate-500 truncate">— {panel.mensajes.length} proveedor{panel.mensajes.length === 1 ? '' : 'es'}{panel.mensajes.some(m => m.bloquea) ? ` · ${panel.mensajes.filter(m => m.bloquea).length} con algo que bloquea` : ''}. Lo envías tú.</span>
            </button>
            {msgAbierto && (
              <button onClick={() => setMensajesAbiertos(prev => prev.size === panel.mensajes.length ? new Set() : new Set(panel.mensajes.map(m => m.opcionIds.join('-'))))}
                className="text-[12.5px] font-semibold text-teal-700 hover:underline whitespace-nowrap">
                {msgAbiertos.size === panel.mensajes.length ? 'Plegar todos' : 'Desplegar todos'}
              </button>
            )}
          </div>
          {msgAbierto && (
            <ul className="divide-y divide-zinc-100 border-t border-zinc-100">
              {panel.mensajes.map(m => {
                const clave = m.opcionIds.join('-'), abierto = msgAbiertos.has(clave);
                return (
                  <li key={clave} className="px-5 py-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => setMensajesAbiertos(prev => { const n = new Set(prev); if (n.has(clave)) n.delete(clave); else n.add(clave); return n; })}
                        className="flex items-center gap-1.5 text-left min-w-0">
                        {abierto ? <ChevronDown size={13} className="text-slate-500 shrink-0" /> : <ChevronRight size={13} className="text-slate-500 shrink-0" />}
                        <span className="text-[13.5px] font-semibold text-zinc-800">{m.proveedor}</span>
                      </button>
                      {m.bloquea && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">responde algo que bloquea</span>}
                      <span className="text-xs text-slate-500">{m.preguntas} pregunta{m.preguntas === 1 ? '' : 's'}</span>
                      <span className="text-[12.5px] text-slate-500 truncate">{[m.vendedor, m.email, m.telefono].filter(Boolean).join(' · ')}</span>
                      <button onClick={() => { navigator.clipboard?.writeText(m.texto); toast.success('Mensaje copiado'); }}
                        className="ml-auto px-2.5 py-1 rounded-md border border-zinc-200 text-[12.5px] font-semibold text-zinc-600 hover:bg-zinc-50">Copiar</button>
                    </div>
                    {abierto && <pre className="mt-2 whitespace-pre-wrap text-[13px] text-zinc-600 bg-zinc-50 rounded-lg px-3 py-2 font-sans">{m.texto}</pre>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* ── Más herramientas: lo que NO pide el comparador técnico, guardado aparte para no estorbar ── */}
      <details className="bg-white rounded-2xl border border-zinc-200 overflow-hidden" open={imprimir}>
        <summary className="cursor-pointer px-5 py-3.5 text-[13.5px] font-bold text-zinc-900 flex items-center gap-2">
          Más herramientas <span className="text-[12.5px] font-normal text-slate-500">— posición de precio, costos asociados, avance a PRE-POSTULACIÓN y datos para OBUMA</span>
        </summary>
        <div className="p-4 space-y-4 border-t border-zinc-100 bg-zinc-50/40">
          <PosicionPrecioCard posicion={panel.posicion ?? null} calculando={calculandoPosicion} onCalcular={calcularPosicion} />
      {/* ── Avance a PRE-POSTULACIÓN (avance parcial permitido salvo licitación GLOBAL) ── */}
      <div className={`rounded-2xl border px-5 py-3 text-[13.5px] ${panel.avance.puede ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-zinc-200 bg-white text-zinc-600'}`}>
        <span className="font-bold">{panel.avance.puede ? '✓ Listo para PRE-POSTULACIÓN' : 'Avance a PRE-POSTULACIÓN'}</span>
        <span className="ml-2">{panel.avance.mensaje}</span>
        <span className="ml-2 text-slate-500">({panel.avance.aprobadas} de {panel.avance.ofertadas} líneas ofertadas con opción aprobada)</span>
      </div>

      {/* ── Costos asociados (compromisos de las bases con costo) ── */}
      <CostosAsociados costos={panel.costosAsociados} total={panel.totalCostosAsociados} lineas={panel.lineas}
        onAccion={accionLinea} onAnular={id => { setTexto(''); setModal({ tipo: 'anular_costo', ref: id }); }} />

          <div className="flex items-center gap-3 text-[12.5px]">
            <span className="text-slate-500">Datos OBUMA (opciones firmadas):</span>
            <a href={`/api/negocios/${negocioId}/auditor/obuma?tipo=proveedores&incluir=firmadas`} className="text-teal-700 hover:underline">Proveedores CSV</a>
            <a href={`/api/negocios/${negocioId}/auditor/obuma?tipo=productos&incluir=firmadas`} className="text-teal-700 hover:underline">Productos CSV</a>
          </div>
        </div>
      </details>

      <Modal open={docAbierto !== null} onClose={() => setDocAbierto(null)} size="xl" title={panel.documentos.find(x => x.documentoId === docAbierto)?.nombre || 'Cotización'}
        subtitle={(() => { const d = panel.documentos.find(x => x.documentoId === docAbierto); return d ? [d.proveedor, d.rut, d.fechaEmision, d.formalidad === 'informal' ? 'informal' : d.leido ? 'formal' : ''].filter(Boolean).join(' · ') : undefined; })()}
        footer={(() => {
          const d = panel.documentos.find(x => x.documentoId === docAbierto);
          if (!d) return null;
          const ocupadaDoc = leyendo.has(d.url);
          return (
            <div className="flex items-center gap-2 flex-wrap w-full">
              <a href={d.url} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 rounded-lg border border-zinc-200 text-zinc-700 text-[13.5px] font-semibold hover:bg-zinc-50 flex items-center gap-1.5"><ExternalLink size={13} /> Ver el archivo</a>
              {!d.leido && <button onClick={() => leerDocumento(d)} disabled={ocupadaDoc} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-[13.5px] font-semibold hover:bg-amber-700 disabled:opacity-60 flex items-center gap-1.5"><Sparkles size={13} /> {d.error ? 'Reintentar la lectura' : 'Leer con IA'}</button>}
              {d.leido && <button onClick={() => releerDocumento(d)} disabled={ocupadaDoc} title="Analiza de nuevo esta cotización con los dos lectores de texto a la vez (útil cuando el Lector leyó mal)" className="px-3 py-1.5 rounded-lg border border-teal-200 text-teal-700 text-[13.5px] font-semibold hover:bg-teal-50 disabled:opacity-60">Volver a leer</button>}
              {d.leido && d.productos.some(p => !p.filaId && !p.esCargo && p.precio != null) && <button onClick={() => emparejarDeNuevo(d)} className="px-3 py-1.5 rounded-lg border border-amber-200 text-amber-800 text-[13.5px] font-semibold hover:bg-amber-50">Emparejar de nuevo</button>}
              {ocupadaDoc && <span className="flex items-center gap-1.5 text-[13px] text-amber-700"><Loader2 size={13} className="animate-spin" /> Leyendo…</span>}
              <button onClick={() => setDocAbierto(null)} className="ml-auto px-4 py-1.5 text-[13px] font-semibold text-zinc-600 hover:text-zinc-900">Cerrar</button>
            </div>
          );
        })()}>
        {(() => {
          const d = panel.documentos.find(x => x.documentoId === docAbierto);
          if (!d) return null;
          if (d.error) return <p className="text-[13.5px] text-red-600 flex items-center gap-1.5"><Alerta size={14} /> {d.error}</p>;
          if (!d.leido) return <p className="text-[13.5px] text-slate-600">Esta cotización todavía no se lee. Usa «Leer con IA» para que el Lector saque sus productos y precios.</p>;
          return (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] border-collapse">
                <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="py-2 pr-3 font-bold">Producto</th><th className="py-2 pr-3 font-bold text-right">Precio</th><th className="py-2 pr-3 font-bold">IVA</th><th className="py-2 pr-3 font-bold">Cant.</th><th className="py-2 font-bold">Línea a la que va</th></tr></thead>
                <tbody>
                  {d.productos.map(p => (
                    <tr key={p.idx} className="border-t border-zinc-100 align-top">
                      <td className="py-2 pr-3 font-medium text-zinc-900">{p.nombre}</td>
                      <td className="py-2 pr-3 text-right text-zinc-700 whitespace-nowrap">{p.precio != null ? fmtCLP(p.precio) : <span className="text-slate-500">sin precio legible</span>}</td>
                      <td className="py-2 pr-3 text-slate-600 whitespace-nowrap">{p.precio == null ? '' : p.iva === 'no_declarado' ? 'no declarado' : p.iva === 'incluido' ? 'con IVA' : '+ IVA'}</td>
                      <td className="py-2 pr-3 text-slate-600">{p.cantidad ?? '—'}</td>
                      <td className="py-2">
                        {p.esCargo ? <span className="text-slate-500">cargo aparte (flete/despacho): no es un producto</span>
                          : p.filaId ? (
                            <select value={p.filaId} title="Cambiar la línea de este producto, o quitarlo de ella"
                              onChange={e => {
                                if (p.opcionId == null) return;
                                if (e.target.value === '__quitar') accion(p.opcionId, 'descartar', { motivo: 'Emparejada con la línea equivocada: se quitó de la línea (el producto queda libre para asignarlo).' }, 'Producto quitado de la línea');
                                else accion(p.opcionId, 'mover_linea', { filaId: e.target.value }, 'Producto movido a otra línea');
                              }}
                              className="text-[12.5px] border border-emerald-200 rounded-md px-1.5 py-1 bg-emerald-50/50 text-emerald-700 font-semibold max-w-[320px]">
                              {lineasSinAsignar.map(l => <option key={l.id} value={l.id}>→ {l.label}</option>)}
                              <option value="__quitar">✕ Quitar de la línea</option>
                            </select>
                          ) : p.precio != null ? (
                            <select defaultValue="" onChange={e => asignar(d, p.idx, e.target.value)} className="text-[12.5px] border border-amber-300 rounded-md px-1.5 py-1 bg-amber-50 text-amber-900 max-w-[320px]">
                              <option value="">Sin línea — asignar a…</option>
                              {lineasSinAsignar.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                            </select>
                          ) : <span className="text-slate-500">sin precio: no se puede asignar</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
      </Modal>
      <Modal open={fichaPorResolver !== null} onClose={() => setFichaPorResolver(null)} title={fichaPorResolver?.res.estado === 'producto_distinto' ? (fichaPorResolver.res.parecido ? '¿Es el mismo producto?' : 'La ficha es de otro producto') : 'Elige el producto de la ficha'} size="md"
        footer={<button onClick={() => setFichaPorResolver(null)} className="px-4 py-2 text-[13px] font-semibold text-zinc-600 hover:text-zinc-900">Cancelar</button>}>
        {fichaPorResolver?.res.estado === 'producto_distinto' ? (
          <div className="space-y-3 text-[13px] text-zinc-700">
            {fichaPorResolver.res.parecido
              ? <p>La ficha «{fichaPorResolver.nombre}» es del modelo <b>{[fichaPorResolver.res.marca, fichaPorResolver.res.modelo].filter(Boolean).join(' ')}</b> y esta opción está como <b>{fichaPorResolver.res.modeloOpcion}</b>. Se diferencian en una sola letra o número: <b>probablemente es el mismo producto</b> y la cotización o la ficha tiene un error de tipeo. Si lo es, úsala igual.</p>
              : <p>«{fichaPorResolver.nombre}» corresponde a <b>{[fichaPorResolver.res.marca, fichaPorResolver.res.modelo].filter(Boolean).join(' ') || 'otro producto'}</b>, no a <b>{fichaPorResolver.res.modeloOpcion || 'el de esta opción'}</b>. Todavía no se comparó contra ella.</p>}
            <div className="flex flex-wrap gap-2">
              {fichaPorResolver.res.parecido && <button onClick={() => resolverFicha({ forzar: true })} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[13.5px] font-semibold hover:bg-emerald-700">Sí, es el mismo: usar la ficha</button>}
              {fichaPorResolver.ref.opcionId != null && (() => {
                const filaId = (panel?.lineas || []).find(l => l.opciones.some(o => o.id === fichaPorResolver.ref.opcionId))?.filaId;
                return filaId ? <button onClick={() => { const { url, nombre, moverDe } = fichaPorResolver; setFichaPorResolver(null); subirFichasDesdeUrl(url, nombre, { filaId }, moverDe); }}
                  className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-[13.5px] font-semibold hover:bg-amber-700">Crear una opción nueva con esta ficha</button> : null;
              })()}
              <button onClick={() => resolverFicha({ forzar: true })} className={`px-3 py-1.5 rounded-lg border border-zinc-200 text-zinc-700 text-[13.5px] font-semibold hover:bg-zinc-50 ${fichaPorResolver.res.parecido ? 'hidden' : ''}`}>Es el mismo producto: usarla igual</button>
            </div>
          </div>
        ) : (
          <div className="space-y-2 text-[13px] text-zinc-700">
            <p>{fichaPorResolver?.res.motivo}</p>
            {(fichaPorResolver?.res.productos || []).map((p: { idx: number; nombre: string }) => (
              <button key={p.idx} onClick={() => resolverFicha({ productoIdx: p.idx })} className="block w-full text-left px-3 py-2 rounded-lg border border-zinc-200 hover:bg-amber-50 hover:border-amber-300">{p.nombre}</button>
            ))}
          </div>
        )}
      </Modal>
      {(() => {
        // Acciones que sacan algo del flujo: el aviso dice qué pasa y el botón dice exactamente qué se hace (no un «Confirmar» genérico).
        const lineaModal = modal?.tipo === 'no_ofertar' ? etiquetaItem.get(String(modal.ref)) : null;
        const t = ({
          no_ofertar: { titulo: `¿Sacar la línea ${lineaModal ?? ''} de la oferta?`, boton: `Sí, sacar la línea ${lineaModal ?? ''}`,
            aviso: 'La línea no se oferta: sale del resumen, del margen y de Pre-postulación, y no se le genera anexo. Si la licitación es global (suma alzada) no se puede postular sin ella. Se puede volver a ofertar después.' },
          descartar: { titulo: '¿Descartar esta opción?', boton: 'Sí, descartarla', aviso: 'La opción sale de la comparación de la línea. Queda en «opciones descartadas» y se puede restaurar.' },
          rechazar: { titulo: '¿Rechazar esta opción?', boton: 'Rechazar y devolver', aviso: 'Vuelve al asistente sin firma, con tu comentario. Tendrá que corregirla y volver a firmarla.' },
          anular_costo: { titulo: '¿Anular este costo asociado?', boton: 'Sí, anularlo', aviso: 'Deja de sumarse al costo. Se puede restaurar.' },
        } as Record<string, { titulo: string; boton: string; aviso: string }>)[modal?.tipo || 'descartar'];
        return (
      <Modal open={modal !== null} onClose={() => setModal(null)} title={t.titulo} size="md"
        footer={<>
          <button onClick={() => setModal(null)} className="px-4 py-2 rounded-lg border border-zinc-200 text-[13px] font-semibold text-zinc-700 hover:bg-zinc-50">Cancelar</button>
          <button onClick={confirmarModal} disabled={!texto.trim()} className="px-4 py-2 rounded-lg bg-red-600 text-white text-[13px] font-semibold hover:bg-red-700 disabled:opacity-50">{t.boton}</button>
        </>}>
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">{t.aviso}</p>
        <label className="block text-[13px] font-medium text-slate-700 mb-1">{modal?.tipo === 'rechazar' ? 'Comentario para el asistente' : 'Motivo'} <span className="font-normal text-slate-500">(obligatorio)</span></label>
        <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={3} autoFocus
          placeholder={({ descartar: 'Motivo del descarte (obligatorio)…', rechazar: 'Comentario para el asistente (obligatorio)…', no_ofertar: 'Motivo por el que no se oferta esta línea (obligatorio)…', anular_costo: 'Por qué este costo no aplica (obligatorio)…' } as Record<string, string>)[modal?.tipo || 'descartar']}
          className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-amber-400" />
      </Modal>
        );
      })()}
    </div>
    </ImprimirCtx.Provider>
  );
}

const MATERIAS = ['capacitacion', 'instalacion', 'puesta_en_marcha', 'despacho', 'visitas', 'mantencion', 'garantia_extendida', 'repuestos', 'calibracion', 'personalizacion', 'otro'];

function CostosAsociados({ costos, total, lineas, onAccion, onAnular }: {
  costos: PanelAuditorDTO['costosAsociados']; total: number; lineas: LineaAuditorDTO[];
  onAccion: (accion: string, extra: Record<string, unknown>, ok?: string) => Promise<void>; onAnular: (id: number) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [nuevo, setNuevo] = useState({ materia: 'capacitacion', cuantificacion: '', filaId: '', monto: '' });
  const [montos, setMontos] = useState<Record<number, string>>({});
  const activos = costos.filter(c => !c.anulado), sinMonto = activos.filter(c => c.montoEstimado == null).length;
  return (
    <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
      <button onClick={() => setAbierto(a => !a)} className="w-full px-5 py-3.5 flex items-center gap-2 text-left hover:bg-zinc-50">
        {abierto ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
        <h3 className="text-[13.5px] font-bold text-zinc-900">Costos asociados</h3>
        <span className="text-[12.5px] text-slate-500">— compromisos de las bases que cuestan plata: solo suben el costo, sin margen, y los estimas tú</span>
        <span className="ml-auto text-[13px] font-semibold text-zinc-700">{activos.length} activo{activos.length === 1 ? '' : 's'} · {fmtCLP(total)}{sinMonto > 0 && <span className="text-red-600"> · {sinMonto} sin estimar</span>}</span>
      </button>
      {abierto && (
        <div className="px-5 pb-4">
          {costos.length === 0 && <p className="text-[13px] text-slate-500 mb-3">Todavía no hay costos asociados. El verificador técnico los crea al detectar compromisos de las bases; también puedes agregar uno a mano.</p>}
          <ul className="divide-y divide-zinc-100 mb-3">
            {costos.map(c => (
              <li key={c.id} className={`py-2 flex items-start gap-3 flex-wrap ${c.anulado ? 'opacity-50' : ''}`}>
                <div className="flex-1 min-w-[240px]">
                  <p className="text-[13.5px] font-semibold text-zinc-800">{c.materia.replace(/_/g, ' ')}{c.cuantificacion ? ` · ${c.cuantificacion}` : ''}
                    <span className="ml-2 text-xs font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">ESTIMACIÓN</span>
                    {c.origen === 'tecnico' && <span className="ml-1 text-xs text-slate-500">detectado por el verificador técnico</span>}</p>
                  {c.exigeBaseLiteral && <p className="text-[12.5px] text-slate-600">«{c.exigeBaseLiteral}»{c.fuenteBases ? ` — ${c.fuenteBases}` : ''}</p>}
                  {c.filaId && <p className="text-xs text-slate-500">Línea {lineas.find(l => l.filaId === c.filaId)?.item ?? '?'}</p>}
                  {c.anulado && <p className="text-[12.5px] text-slate-600">Anulado: {c.comentarioAnulacion}</p>}
                </div>
                {!c.anulado ? <>
                  <input value={montos[c.id] ?? (c.montoEstimado != null ? String(c.montoEstimado) : '')} placeholder="Monto neto"
                    onChange={e => setMontos(m => ({ ...m, [c.id]: e.target.value }))} inputMode="numeric"
                    onBlur={() => { const v = (montos[c.id] ?? '').replace(/[^\d]/g, ''); if (montos[c.id] !== undefined && (v ? Number(v) : null) !== c.montoEstimado) onAccion('estimar_costo_asociado', { id: c.id, monto: v ? Number(v) : null }, 'Estimación guardada'); }}
                    className="w-32 text-right text-[13.5px] font-semibold text-amber-700 bg-amber-50/60 border border-amber-200 rounded-lg px-2 py-1 outline-none focus:border-amber-400" />
                  <button onClick={() => onAnular(c.id)} className="text-[12.5px] text-slate-600 hover:text-red-600">Anular</button>
                </> : <button onClick={() => onAccion('restaurar_costo_asociado', { id: c.id }, 'Costo restaurado')} className="text-[12.5px] text-teal-700 hover:underline">Restaurar</button>}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2 flex-wrap text-[13px]">
            <select value={nuevo.materia} onChange={e => setNuevo(n => ({ ...n, materia: e.target.value }))} className="border border-zinc-200 rounded-md px-2 py-1 bg-white">
              {MATERIAS.map(m => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
            </select>
            <input value={nuevo.cuantificacion} onChange={e => setNuevo(n => ({ ...n, cuantificacion: e.target.value }))} placeholder="Como lo exigen las bases (ej. 8 horas)" className="w-56 border border-zinc-200 rounded-md px-2 py-1" />
            <select value={nuevo.filaId} onChange={e => setNuevo(n => ({ ...n, filaId: e.target.value }))} className="border border-zinc-200 rounded-md px-2 py-1 bg-white max-w-[180px]">
              <option value="">General (toda la licitación)</option>
              {lineas.map(l => <option key={l.filaId} value={l.filaId}>Línea {l.item}</option>)}
            </select>
            <input value={nuevo.monto} onChange={e => setNuevo(n => ({ ...n, monto: e.target.value.replace(/[^\d]/g, '') }))} placeholder="Monto neto" inputMode="numeric" className="w-28 text-right border border-zinc-200 rounded-md px-2 py-1" />
            <button onClick={async () => { await onAccion('agregar_costo_asociado', { materia: nuevo.materia, cuantificacion: nuevo.cuantificacion, filaId: nuevo.filaId || null, montoEstimado: nuevo.monto || null }, 'Costo asociado agregado'); setNuevo({ materia: 'capacitacion', cuantificacion: '', filaId: '', monto: '' }); }}
              className="px-3 py-1 rounded-md bg-amber-600 text-white font-semibold hover:bg-amber-700">Agregar</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AgregarLink({ filaId, ocupado, onAgregar }: { filaId: string; ocupado: boolean; onAgregar: (filaId: string, url: string) => Promise<boolean> }) {
  const [url, setUrl] = useState('');
  const enviar = async () => { if (url.trim() && await onAgregar(filaId, url.trim())) setUrl(''); };
  return (
    <div className="flex items-center gap-2 mb-3 ml-6">
      <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') enviar(); }} disabled={ocupado}
        placeholder="Pega aquí el link del producto (precio de tanteo + técnico)…"
        className="flex-1 max-w-xl text-[13px] border border-zinc-200 rounded-lg px-3 py-1.5 outline-none focus:border-amber-400 disabled:opacity-50" />
      <button onClick={enviar} disabled={ocupado || !url.trim()}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-[13px] font-semibold hover:bg-amber-100 disabled:opacity-40">
        {ocupado ? <><Loader2 size={12} className="animate-spin" /> Leyendo página…</> : 'Agregar link'}
      </button>
    </div>
  );
}

// Verificador de costo con IA de UNA opción: ayuda de cinco campos (solo si no quedó verificada) y qué hallazgos del modelo se descartaron por no tener cita.
function CostoIAOpcion({ o, verificando, onVerificar }: { o: OpcionDTO; verificando: boolean; onVerificar: (opcionId: number) => void }) {
  const imprimirIA = useContext(ImprimirCtx);
  const c = o.costoIA;
  const puede = o.via === 'completa' && o.estado !== 'descartada' && !['aprobada', 'en_aprobacion'].includes(o.estado) && o.respaldos.some(r => r.tipo !== 'ficha_tecnica' && r.extraccionId != null);
  const a = o.verificacion?.veredicto !== 'VERIFICADO' ? c?.ayuda : null;
  return (
    <div className="text-[12.5px] text-zinc-600">
      {!c && <p className="text-slate-500">{o.via !== 'completa' ? 'Vía liviana: no corre' : puede ? 'Aún no se verifica' : 'Sin respaldo de costo leído'}</p>}
      {c?.error && <p className="text-red-600">{c.error}</p>}
      {c && !c.error && <p className="text-slate-500">{c.alertas} alerta{c.alertas === 1 ? '' : 's'} agregada{c.alertas === 1 ? '' : 's'} · {c.creadoAt.slice(0, 16).replace('T', ' ')}</p>}
      {a && (
        <div className="mt-1 rounded-md bg-teal-50/60 border border-teal-100 px-2 py-1.5 space-y-0.5">
          {a.diagnostico && <p><b>Diagnóstico:</b> {a.diagnostico}</p>}
          {a.causaProbable && <p><b>Causa probable:</b> {a.causaProbable}</p>}
          {a.preguntaProveedor && <p><b>Pregunta al proveedor:</b> {a.preguntaProveedor}</p>}
          {a.accionConcreta && <p><b>Qué hacer:</b> {a.accionConcreta}</p>}
          {a.datosParaImpacto && <p className="text-slate-600"><b>Impacto:</b> {a.datosParaImpacto}</p>}
        </div>
      )}
      {c && c.descartados.length > 0 && (
        <details className="mt-1" open={imprimirIA}><summary className="cursor-pointer text-xs text-slate-500">{c.descartados.length} hallazgo{c.descartados.length === 1 ? '' : 's'} de la IA descartado{c.descartados.length === 1 ? '' : 's'} (sin cita en el documento)</summary>
          <ul className="text-xs text-slate-500 list-disc ml-4">{c.descartados.slice(0, 6).map((d, i) => <li key={i}>{d}</li>)}</ul></details>
      )}
      {puede && (
        <button onClick={() => onVerificar(o.id)} disabled={verificando}
          className="mt-1 flex items-center gap-1 px-2 py-0.5 rounded-md border border-teal-200 text-teal-700 text-xs font-semibold hover:bg-teal-50 disabled:opacity-50">
          {verificando ? <><Loader2 size={11} className="animate-spin" /> Verificando…</> : c ? 'Volver a verificar' : 'Verificar costo con IA'}
        </button>
      )}
    </div>
  );
}

// Mercado de UNA opción: referencias del MISMO producto (V10), comparador por costo neto (V10-c) y, si la más barata pesa ≥ 5%, la justificación que exige V10.
function MercadoOpcion({ o, buscando, onBuscar, onAccion }: {
  o: OpcionDTO; buscando: boolean; onBuscar: (opcionId: number) => void;
  onAccion: (opcionId: number, accion: string, extra?: Record<string, unknown>, ok?: string) => void;
}) {
  const [justificando, setJustificando] = useState(false);
  const [texto, setTexto] = useState('');
  const m = o.mercado;
  const puede = o.via === 'completa' && o.estado !== 'descartada' && !['aprobada', 'en_aprobacion'].includes(o.estado) && !!(o.modelo || o.sku);
  const pideJustificar = !!o.verificacion?.bloqueos.some(b => b.codigo === 'V10');
  return (
    <div className="text-[12.5px] text-zinc-600">
      {!m && <p className="text-slate-500">{o.via !== 'completa' ? 'Vía liviana: no corre' : !(o.modelo || o.sku) ? 'Sin modelo ni SKU no se puede buscar el mismo producto' : 'Aún no se busca'}</p>}
      {m && (
        <>
          {m.error && <p className="text-slate-600">{m.error}</p>}
          {m.comparador.length > 0 && (
            <ul className="mb-1">
              {m.comparador.slice(0, 5).map((f, i) => (
                <li key={i} className={f.origen === 'opcion' ? 'font-semibold text-zinc-800' : ''}>
                  {fmtCLP(f.precioNeto)} · {f.origen === 'opcion' ? 'esta opción' : f.url ? <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-teal-700 hover:underline">{f.nombre}</a> : f.nombre}
                </li>
              ))}
            </ul>
          )}
          {m.medianaReferencias != null && <p className="text-slate-500">Mediana de {m.referencias.length} referencia{m.referencias.length === 1 ? '' : 's'}: {fmtCLP(m.medianaReferencias)}</p>}
          {m.mercadoPublico?.neto != null && m.mercadoPublico.n > 0 && <p className="text-slate-500">Mercado público: {fmtCLP(m.mercadoPublico.neto)} ({m.mercadoPublico.n} OC · {m.mercadoPublico.calidad === 'mismo_producto' ? 'mismo producto' : 'comparable, dato débil'})</p>}
          {m.descartadas.length > 0 && <p className="text-slate-500">{m.descartadas.length} descartada{m.descartadas.length === 1 ? '' : 's'} (no eran el mismo modelo)</p>}
          <p className="text-xs text-slate-500">Buscado {m.creadoAt.slice(0, 16).replace('T', ' ')}</p>
        </>
      )}
      {puede && (
        <button onClick={() => onBuscar(o.id)} disabled={buscando}
          className="mt-1 flex items-center gap-1 px-2 py-0.5 rounded-md border border-teal-200 text-teal-700 text-xs font-semibold hover:bg-teal-50 disabled:opacity-50">
          {buscando ? <><Loader2 size={11} className="animate-spin" /> Buscando…</> : m ? 'Volver a buscar' : 'Buscar referencias de mercado'}
        </button>
      )}
      {pideJustificar && (
        <div className="mt-1.5">
          {!justificando
            ? <button onClick={() => setJustificando(true)} className="text-xs font-semibold text-red-600 hover:underline">Justificar por qué no usaste la referencia más barata</button>
            : <>
                <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={2} placeholder="Plazo, garantía, respaldo formal, confiabilidad, stock, despacho, factura…"
                  className="w-full text-[12.5px] border border-zinc-200 rounded-md px-2 py-1 outline-none focus:border-amber-400" />
                <button onClick={() => { onAccion(o.id, 'justificar_ahorro', { texto }, 'Justificación registrada'); setJustificando(false); setTexto(''); }} disabled={texto.trim().length < 10}
                  className="mt-1 px-2 py-0.5 rounded-md bg-amber-600 text-white text-xs font-semibold disabled:opacity-40">Guardar justificación</button>
              </>}
        </div>
      )}
    </div>
  );
}

/** Recuadro del EM dentro del Auditor del negocio: opciones EN APROBACIÓN y requisitos ❓/❌ que el asistente complementó, con sus botones.
 *  No aparece si no hay nada. Lo mismo, de todos los negocios, está en Aprobaciones → «Opciones del Auditor». */
function EsperanAlEM({ panel, etiquetaItem, ocupado, onIrALinea, onAprobar, onRechazar, onAceptar }: {
  panel: PanelAuditorDTO; etiquetaItem: Map<string, string>; ocupado: boolean; onIrALinea: (filaId: string) => void;
  onAprobar: (ids: number[]) => void; onRechazar: (opcionId: number) => void; onAceptar: (items: Array<{ opcionId: number; n: number }>) => void;
}) {
  const ofertadas = panel.lineas.filter(l => !l.noOfertada);
  const porAprobar = ofertadas.flatMap(l => l.opciones.filter(o => o.estado === 'en_aprobacion').map(o => ({ l, o })));
  const complementados = ofertadas.flatMap(l => l.opciones.filter(o => !['descartada', 'en_aprobacion', 'aprobada'].includes(o.estado))
    .flatMap(o => (o.tecnico.resultado?.filas ?? []).filter(f => {
      const e = estadoVisible(f);
      return (e === 'FALTA_DATO' || e === 'NO_CUMPLE') && (o.tecnico.respaldosCelda?.[f.n]?.length ?? 0) > 0;
    }).map(f => ({ l, o, f }))));
  if (!porAprobar.length && !complementados.length) return null;
  const nombre = (o: OpcionDTO) => [o.marca, o.modelo].filter(Boolean).join(' ') || o.producto?.nombre || 'Producto sin identificar';
  const btnSolido = 'px-3 py-1.5 rounded-lg bg-teal-700 text-white text-[13px] font-semibold hover:bg-teal-800 disabled:opacity-50';
  const btnBorde = 'px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-[13px] font-semibold text-slate-700 hover:bg-zinc-50 disabled:opacity-50';
  return (
    <div className="rounded-2xl border border-teal-300 bg-white shadow-sm overflow-hidden" data-no-pdf>
      <div className="px-5 py-3 bg-teal-50/60 border-b border-teal-100 flex items-center gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-medium text-slate-900">Esperan tu aprobación</h3>
          <p className="text-[13px] text-slate-600">
            {[porAprobar.length && `${porAprobar.length} opción${porAprobar.length === 1 ? '' : 'es'} firmada${porAprobar.length === 1 ? '' : 's'}`,
              complementados.length && `${complementados.length} requisito${complementados.length === 1 ? '' : 's'} complementado${complementados.length === 1 ? '' : 's'} por el asistente`].filter(Boolean).join(' · ')}
          </p>
        </div>
        {complementados.length > 1 && <button disabled={ocupado} onClick={() => onAceptar(complementados.map(c => ({ opcionId: c.o.id, n: c.f.n })))} className={btnBorde}>Dar por cumplidos los {complementados.length}</button>}
        {porAprobar.length > 1 && <button disabled={ocupado} onClick={() => onAprobar(porAprobar.map(p => p.o.id))} className={btnSolido}>{ocupado ? <Loader2 size={14} className="animate-spin" /> : `Aprobar las ${porAprobar.length}`}</button>}
      </div>
      <ul className="divide-y divide-zinc-100">
        {porAprobar.map(({ l, o }) => {
          const c = o.verificacion?.costoNetoUnitario ?? null;
          return (
            <li key={`o${o.id}`} className="px-5 py-3 flex items-start gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] text-slate-900">
                  <button onClick={() => onIrALinea(l.filaId)} className="font-semibold hover:underline">Línea {etiquetaItem.get(l.filaId)}</button> · {nombre(o)} <span className="text-slate-600">· {o.proveedorRazonSocial || 'proveedor sin identificar'}</span>
                </p>
                <dl className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1">
                  <div><dt className="text-xs text-slate-500">Costo neto unitario</dt><dd className="text-[13px] font-bold tabular-nums text-slate-900">{fmtCLP(c)}<DifCosteo costo={c} costeo={l.costeadoNeto} /></dd></div>
                  <div><dt className="text-xs text-slate-500">En el costeo</dt><dd className="text-[13px] tabular-nums text-slate-800">{fmtCLP(l.costeadoNeto)}</dd></div>
                  {o.firmadaPorNombre && <div><dt className="text-xs text-slate-500">Firmada por</dt><dd className="text-[13px] text-slate-800">{o.firmadaPorNombre}</dd></div>}
                </dl>
              </div>
              <div className="flex items-center gap-2">
                <button disabled={ocupado} onClick={() => onRechazar(o.id)} className={btnBorde}>Rechazar…</button>
                <button disabled={ocupado} onClick={() => onAprobar([o.id])} className={btnSolido}>Aprobar</button>
              </div>
            </li>
          );
        })}
        {complementados.map(({ l, o, f }) => {
          const comp = o.tecnico.respaldosCelda?.[f.n] ?? [];
          const ultimo = comp[comp.length - 1];
          return (
            <li key={`r${o.id}-${f.n}`} className="px-5 py-3 flex items-start gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-slate-600">
                  <button onClick={() => onIrALinea(l.filaId)} className="font-semibold text-slate-800 hover:underline">Línea {etiquetaItem.get(l.filaId)}</button> · {nombre(o)} · requisito {f.n}
                  {f.rojo && <span className="ml-1.5 font-medium text-red-600">· puede dejarnos fuera</span>}
                </p>
                <p className="text-[13.5px] text-slate-900 leading-snug line-clamp-2" title={f.requeridoTexto}>{f.requeridoTexto}</p>
                {ultimo && (
                  <p className="mt-1 text-[13px] text-slate-700">
                    <span className="text-slate-500">{ultimo.url.startsWith('nota:') ? 'Nota' : 'Archivo'} de {ultimo.por}:</span>{' '}
                    {ultimo.nota ? <span className="italic">«{ultimo.nota}»</span> : !ultimo.url.startsWith('nota:') && <a href={ultimo.url} target="_blank" rel="noopener noreferrer" className="text-teal-700 hover:underline">{ultimo.nombre}</a>}
                    {comp.length > 1 && <span className="text-slate-500"> (+{comp.length - 1} más)</span>}
                  </p>
                )}
              </div>
              <button disabled={ocupado} onClick={() => onAceptar([{ opcionId: o.id, n: f.n }])} className={btnSolido}>Dar por cumplido</button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Valor del selector de destino de una ficha: «o<id>» = esa opción, «l<filaId>» = la línea (la opción nace de la ficha o se suma a la del mismo producto). */
function refDestinoFicha(v: string): { opcionId?: number; filaId?: string } | null {
  if (v.startsWith('o') && Number.isFinite(Number(v.slice(1)))) return { opcionId: Number(v.slice(1)) };
  if (v.startsWith('l') && v.length > 1) return { filaId: v.slice(1) };
  return null;
}

/** Opciones del selector de destino de una ficha, agrupadas por línea: sus opciones abiertas y «nueva opción con esta ficha». */
function OpcionesDestinoFicha({ panel, etiquetaItem, excluirOpcionId }: { panel: PanelAuditorDTO; etiquetaItem: Map<string, string>; excluirOpcionId?: number }) {
  return <>
    {panel.lineas.filter(l => !l.noOfertada).map(l => (
      <optgroup key={l.filaId} label={`Línea ${etiquetaItem.get(l.filaId)} · ${l.detalle.slice(0, 50)}`}>
        {l.opciones.filter(o => o.id !== excluirOpcionId && !['descartada', 'en_aprobacion', 'aprobada'].includes(o.estado)).map(o => (
          <option key={o.id} value={`o${o.id}`}>{[o.marca, o.modelo].filter(Boolean).join(' ') || 'Producto sin identificar'} · {o.proveedorRazonSocial || 'sin proveedor'}</option>
        ))}
        <option value={`l${l.filaId}`}>＋ Nueva opción con esta ficha</option>
      </optgroup>
    ))}
  </>;
}

/** Número visible de cada línea: el de la LÍNEA de Mercado Público (lineaReal; caso 1414396-26-LP26: solo la línea 7) o, si no se sabe, el ítem
 *  del costeo. Si una línea tiene varios ítems (o dos filas comparten número), 7.1, 7.2… en el orden del costeo. */
function etiquetasDeItem(lineas: LineaAuditorDTO[]): Map<string, string> {
  const veces = new Map<string, number>();
  for (const l of lineas) veces.set(String(l.lineaReal ?? l.item), (veces.get(String(l.lineaReal ?? l.item)) ?? 0) + 1);
  const vistos = new Map<string, number>();
  return new Map(lineas.map(l => {
    const k = String(l.lineaReal ?? l.item);
    if ((veces.get(k) ?? 0) < 2) return [l.filaId, k];
    const n = (vistos.get(k) ?? 0) + 1; vistos.set(k, n);
    return [l.filaId, `${k}.${n}`];
  }));
}

/** Dónde va el Auditor: cuántas líneas a ofertar pasaron cada paso, cuál toca ahora y qué hacer (lo que muestra el encabezado). */
function recorridoAuditor(panel: PanelAuditorDTO, puedeAprobar: boolean) {
  const ofertadas = panel.lineas.filter(l => !l.noOfertada);
  const vivas = (l: LineaAuditorDTO) => l.opciones.filter(o => o.estado !== 'descartada');
  const conOpcion = ofertadas.filter(l => vivas(l).length > 0);
  const comparadas = ofertadas.filter(l => vivas(l).some(o => o.via === 'liviana' || o.tecnico.resultado || sinRequisitos(o)));   // sin requisitos en las bases = nada que comparar
  const firmadas = ofertadas.filter(l => l.opcionDefinitivaId != null);
  const aprobadas = ofertadas.filter(l => l.opciones.some(o => o.estado === 'aprobada'));
  const pasos = [
    { titulo: 'Cotizaciones', hechas: conOpcion.length },
    { titulo: 'Comparar', hechas: comparadas.length },
    { titulo: 'Firmar', hechas: firmadas.length },
    { titulo: 'Aprobar', hechas: aprobadas.length },
  ];
  const total = ofertadas.length;
  const actualIdx = pasos.findIndex(p => p.hechas < total);
  const actual = actualIdx === -1 ? pasos.length : actualIdx;
  const et = etiquetasDeItem(panel.lineas);
  const n = (k: number) => `${k} línea${k === 1 ? '' : 's'}`;
  let texto: string;
  let accion: { tipo: 'subir' | 'comparar' | 'linea' | 'prepostulacion' | 'esperar'; filaId?: string };
  if (actual === 0) {
    const faltan = total - conOpcion.length;
    texto = `Faltan cotizaciones en ${faltan === total ? (total === 1 ? 'la línea' : `las ${total} líneas`) : `${n(faltan)} de ${total}`}. Súbelas (PDF, foto, Word o Excel): se leen solas y cada producto va a su línea.`
      + ((panel.linksPendientes?.length ?? 0) > 0 ? ' Si todavía no las tienes, trae los links que ya están en el costeo.' : '');
    accion = { tipo: 'subir' };
  } else if (actual === 1) {
    const l = ofertadas.find(x => !comparadas.includes(x))!;
    texto = `Compara ${total - comparadas.length === 1 ? 'la línea que falta' : `las ${total - comparadas.length} líneas que faltan`} contra los requisitos de las bases: la IA revisa cada producto (1 a 3 minutos por línea).`;
    accion = { tipo: 'comparar', filaId: l.filaId };
  } else if (actual === 2) {
    const l = ofertadas.find(x => x.opcionDefinitivaId == null)!;
    // Si ninguna opción de la línea se puede firmar todavía, se dice por qué (la primera razón de la opción más avanzada).
    const motivos = l.opciones.filter(o => ['tanteo', 'formalizada', 'verificada'].includes(o.estado)).map(motivoNoFirmable);
    const traba = motivos.length && motivos.every(Boolean) ? motivos[0] : null;
    texto = traba ? `Línea ${et.get(l.filaId)}: ${traba}. Ábrela para resolverlo y firmar la opción que se oferta.`
      : `Elige la opción que se oferta en la línea ${et.get(l.filaId)} y fírmala. Si algo no cumple o falta un dato, se resuelve dentro de la línea.`;
    accion = { tipo: 'linea', filaId: l.filaId };
  } else if (actual === 3) {
    const porSolicitar = ofertadas.find(x => x.opciones.some(o => o.estado === 'definitiva'));
    const porAprobar = ofertadas.find(x => x.opciones.some(o => o.estado === 'en_aprobacion'));
    if (porSolicitar) { texto = `La línea ${et.get(porSolicitar.filaId)} está firmada: solicita su aprobación.`; accion = { tipo: 'linea', filaId: porSolicitar.filaId }; }
    else if (porAprobar && puedeAprobar) { texto = `La línea ${et.get(porAprobar.filaId)} espera tu aprobación.`; accion = { tipo: 'linea', filaId: porAprobar.filaId }; }
    else { texto = `${n(total - aprobadas.length)} en aprobación: esperando al EM.`; accion = { tipo: 'esperar' }; }
  } else {
    texto = 'Todas las líneas tienen su opción aprobada. Sigue en Pre-postulación: certificado de admisibilidad, compromisos y anexos.';
    accion = { tipo: 'prepostulacion' };
  }
  return { total, pasos, actual, texto, accion };
}

/** Las líneas del panel en la forma que pide el resumen de la licitación (Prompt 4 v3.0, Paso 5). */
function lineasParaResumen(panel: PanelAuditorDTO): LineaParaResumen[] {
  return panel.lineas.map(l => ({
    filaId: l.filaId, item: l.item, nombre: l.detalle.split(' - ')[0] || l.detalle, cantidad: l.cantidad, noOfertada: l.noOfertada,
    opciones: l.opciones.filter(o => o.estado !== 'descartada').map(o => ({
      opcionId: o.id, etiqueta: `${[o.marca, o.modelo].filter(Boolean).join(' ') || 'Producto sin identificar'} · ${o.proveedorRazonSocial || 'proveedor sin identificar'}`,
      costoUnitNeto: o.verificacion?.costoNetoUnitario ?? null,
      // Vía liviana: no pasa por el comparador técnico (compite por precio). Vía completa sin comparar: todavía no compite.
      estado: o.via === 'liviana' || sinRequisitos(o) ? 'CUMPLE' as const : o.tecnico.resultado ? (o.tecnico.resultado.estado === 'CUMPLE' ? 'CUMPLE' as const : o.tecnico.resultado.estado === 'NO_CUMPLE' ? 'NO_CUMPLE' as const : 'FALTA_DATO' as const) : 'SIN_VERIFICAR' as const,
    })).filter(o => o.estado !== 'SIN_VERIFICAR'),
  }));
}

// Diferencia de un costo cotizado contra lo que quedó en el Costeo (neto unitario): rojo = más caro que el costeo, verde = más barato.
function DifCosteo({ costo, costeo, conTexto }: { costo: number | null; costeo: number | null; conTexto?: boolean }) {
  if (costo == null || costeo == null || costeo <= 0) return null;
  const pct = Math.round(((costo - costeo) / costeo) * 1000) / 10;
  const cls = pct > 0 ? 'text-red-600' : pct < 0 ? 'text-emerald-600' : 'text-slate-500';
  const txt = pct > 0 ? 'más caro que el costeo' : pct < 0 ? 'más barato que el costeo' : 'igual al costeo';
  return <span className={`${conTexto ? 'block' : 'ml-1.5'} text-xs font-semibold ${cls}`}>{pct > 0 ? '+' : ''}{pct}%{conTexto && <> ({fmtCLP(costo - costeo)}) {txt}</>}</span>;
}

// Resumen de la licitación (Prompt 4 v3.0, Paso 5): por línea la opción más barata que CUMPLE (si no hay, la más barata con FALTA DATO, marcada), y el costo
// total contra el presupuesto del organismo. Lo calcula el código (auditor-resumen-licitacion.ts), nunca el modelo.
function ResumenLicitacionCard({ panel, etiquetaItem, onIrALinea }: { panel: PanelAuditorDTO; etiquetaItem: Map<string, string>; onIrALinea: (filaId: string) => void }) {
  const lineas = lineasParaResumen(panel);
  const r = resumenLicitacion(lineas, panel.presupuesto?.neto ?? null);
  const sinComparar = panel.lineas.filter(l => !l.noOfertada && l.opciones.some(o => o.estado !== 'descartada' && porComparar(o))).length;
  const [verTodas, setVerTodas] = useState(false);
  const tieneOpcion = (filaId: string) => (panel.lineas.find(x => x.filaId === filaId)?.opciones || []).some(o => o.estado !== 'descartada');
  const conOpcion = r.filas.filter(f => tieneOpcion(f.filaId));
  const sinOpcion = r.filas.length - conOpcion.length;
  const filasVisibles = verTodas || conOpcion.length === 0 ? r.filas : conOpcion;
  const ALERTA = { rojo: ['🔴', 'text-red-600', 'El costo total supera el presupuesto'], amarillo: ['🟡', 'text-amber-700', 'Queda menos del 20% del presupuesto'], verde: ['✅', 'text-emerald-600', 'Queda el 20% o más del presupuesto'], sin_presupuesto: ['ℹ️', 'text-slate-600', 'Sin presupuesto del organismo'] }[r.alerta];
  // Lo que ya quedó en el Costeo (neto unitario × cantidad) contra el presupuesto: avisa antes de cotizar si el negocio ya no da.
  const costeoTotal = panel.lineas.filter(l => !l.noOfertada && l.costeadoNeto != null).reduce((s, l) => s + (l.costeadoNeto as number) * (l.cantidad || 1), 0);
  const presupuesto = panel.presupuesto?.neto ?? null;
  const costeoExcede = presupuesto != null && presupuesto > 0 && costeoTotal > presupuesto;
  return (
    <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-zinc-100 flex items-center gap-2 flex-wrap">
        <h3 className="text-[13.5px] font-medium text-zinc-900">2 · Resumen de la licitación</h3>
        <span className="text-[13px] text-slate-600">— la opción más barata que cumple en cada línea, y el costo total contra el presupuesto</span>
      </div>
      {conOpcion.length === 0 ? (
        <p className="px-5 py-3 text-[13px] text-slate-600">Se arma solo cuando las líneas tengan cotización: aquí verás la mejor opción de cada una y el total contra el presupuesto.</p>
      ) : (<>
      <div className="px-5 py-2 border-b border-zinc-100 flex items-center justify-between gap-3 text-[13px] text-slate-600">
        <span>{conOpcion.length} de {r.filas.length} líneas con cotización</span>
        {sinOpcion > 0 && <button onClick={() => setVerTodas(v => !v)} className="font-medium text-teal-700 hover:underline">{verTodas ? 'Ocultar líneas sin cotización' : `Mostrar ${sinOpcion === 1 ? 'la línea' : `las ${sinOpcion} líneas`} sin cotización`}</button>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] border-collapse">
          <thead><tr className="text-left text-xs text-slate-600"><th className="px-5 py-2 font-medium">Línea</th><th className="py-2 pr-3 font-medium text-right">Cant.</th><th className="py-2 pr-3 font-medium">Mejor opción</th><th className="py-2 pr-3 font-medium">Estado</th><th className="py-2 pr-3 font-medium text-right">Costeo unit.</th><th className="py-2 pr-3 font-medium text-right">Precio cotizado unit.</th><th className="py-2 pr-5 font-medium text-right">Total neto</th></tr></thead>
          <tbody>
            {filasVisibles.map(f => {
              const l = panel.lineas.find(x => x.filaId === f.filaId);
              const vivas = (l?.opciones || []).filter(o => o.estado !== 'descartada');
              const costeo = l?.costeadoNeto ?? null;
              const c = f.mejor?.costoUnitNeto ?? null;
              // Sin costo neto verificado (p. ej. la cotización no dice si el precio lleva IVA): se muestra igual lo que dice el documento.
              const cotizado = c == null ? vivas.filter(o => o.producto?.precio != null).sort((x, y) => (x.producto!.precio as number) - (y.producto!.precio as number))[0] : null;
              return (
              <tr key={f.filaId} onClick={() => onIrALinea(f.filaId)} title="Abrir esta línea" className="border-t border-zinc-100 cursor-pointer hover:bg-teal-50/40">
                <td className="px-5 py-2 text-slate-800"><span className="text-slate-500 font-medium mr-1.5 tabular-nums">#{etiquetaItem.get(f.filaId) ?? f.item}</span>{f.nombre}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-600">{f.cantidad ?? '—'}</td>
                <td className="py-2 pr-3 text-slate-700 max-w-[340px]">{f.mejor ? f.mejor.etiqueta : (() => {
                  if (!vivas.length) return <span className="text-slate-500">Sin cotización</span>;
                  if (vivas.some(porComparar)) return <span className="text-amber-700 font-medium">Falta comparar la línea</span>;
                  if (vivas.some(precioPendiente)) return <span className="text-amber-700 font-medium">Falta confirmar el precio</span>;
                  return <span className="text-slate-600">Ninguna cumple todavía</span>;
                })()}</td>
                <td className="py-2 pr-3">{f.mejor ? <span className="inline-flex items-center gap-1.5 font-medium text-slate-700 whitespace-nowrap"><span aria-hidden className={`w-1.5 h-1.5 rounded-full ${f.faltaDato ? 'bg-amber-500' : 'bg-emerald-600'}`} />{f.faltaDato ? 'Falta dato' : 'Cumple'}</span> : <span className="text-slate-300">—</span>}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-600">{fmtCLP(costeo)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-800">
                  {c != null ? <>{fmtCLP(c)}<DifCosteo costo={c} costeo={costeo} /><span className="block text-xs text-slate-500">neto</span></>
                    : cotizado ? <>{fmtCLP(cotizado.producto!.precio)}<span className="block text-xs text-amber-700">{cotizado.producto!.iva === 'no_declarado' ? 'IVA sin definir' : 'sin verificar'}</span></>
                    : <span className="text-slate-300">—</span>}
                </td>
                <td className="py-2 pr-5 text-right font-bold tabular-nums text-slate-900">{f.totalNeto != null ? fmtCLP(f.totalNeto) : <span className="font-normal text-slate-300">—</span>}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </>)}
      {costeoExcede && (
        <p className="px-5 py-2.5 border-t border-zinc-100 text-[13px] text-red-600">
          <b>Lo costeado ya supera el presupuesto:</b> {fmtCLP(costeoTotal)} neto contra {fmtCLP(presupuesto)} ({Math.round(((costeoTotal - presupuesto!) / presupuesto!) * 100)}% más). Revisa el costeo o busca opciones más baratas antes de seguir.
        </p>
      )}
      {conOpcion.length > 0 && <div className="px-5 py-3 border-t border-zinc-100 text-[13.5px] text-zinc-700">
        <b>COSTO TOTAL {r.completo ? '' : '(parcial) '}{fmtCLP(r.costoTotal)}</b> · PRESUPUESTO {r.presupuesto != null ? fmtCLP(r.presupuesto) : '—'}
        {r.completo && r.queda != null && <> · QUEDA {fmtCLP(r.queda)}{r.quedaPct != null ? ` (${r.quedaPct}%)` : ''}</>}
        {(r.completo || r.alerta === 'rojo')
          ? <span className={`ml-2 font-semibold ${ALERTA[1]}`}>{ALERTA[0]} {ALERTA[2]}</span>
          : <span className="ml-2 font-semibold text-slate-600">ℹ️ Total parcial: todavía no se puede comparar con el presupuesto</span>}
        {(r.lineasSinOpcion > 0 || sinComparar > 0) && <p className="mt-1 text-[12.5px] text-slate-600">{r.lineasSinOpcion > 0 && <>Faltan {r.lineasSinOpcion} línea(s) con una opción que cumpla (o que se compare): no suman al total. </>}{sinComparar > 0 && <>{sinComparar} línea(s) tienen opciones sin comparar con los requisitos.</>}</p>}
      </div>}
    </div>
  );
}

// Posición de precio (Prompt 5 Parte IX): presupuesto ≥ precio mercado público > precio mercado privado ≥ nuestro costo. Todo calculado por el sistema.
function PosicionPrecioCard({ posicion, calculando, onCalcular }: { posicion: import('@/app/lib/auditor-posicion').PosicionGuardadaDTO | null; calculando: boolean; onCalcular: () => void }) {
  const p = posicion?.posicion;
  const monto = (n: number | null | undefined) => (n == null ? '—' : fmtCLP(n));
  const color = { rojo: 'text-red-600', amarillo: 'text-amber-700', info: 'text-slate-600', ok: 'text-emerald-600' } as Record<string, string>;
  const icono = { rojo: '🔴', amarillo: '🟡', info: 'ℹ️', ok: '✅' } as Record<string, string>;
  return (
    <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-zinc-100 flex items-center gap-2">
        <h3 className="text-[13.5px] font-bold text-zinc-900">Posición de precio</h3>
        <span className="text-[12.5px] text-slate-500">— dónde está nuestro costo frente al mercado y al presupuesto, para fijar el precio de venta</span>
        <button onClick={onCalcular} disabled={calculando}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-teal-200 text-teal-700 text-[13px] font-semibold hover:bg-teal-50 disabled:opacity-60">
          {calculando ? <><Loader2 size={13} className="animate-spin" /> Calculando…</> : p ? 'Recalcular' : 'Calcular posición de precio'}
        </button>
      </div>
      {!p ? <p className="px-5 py-4 text-[13px] text-slate-500">Todavía no se calculó. Conviene hacerlo con el mercado ya revisado en las opciones.</p> : (
        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
            <Stat label={`Presupuesto organismo${p.presupuesto.nivel ? ` (${p.presupuesto.nivel})` : ''}`} valor={monto(p.presupuesto.monto_neto)} />
            <Stat label={`Mercado público${p.mercado_publico.n_datos ? ` · ${p.mercado_publico.n_datos} OC` : ''}`} valor={p.mercado_publico.calidad === 'sin_datos' ? 'sin datos' : monto(p.mercado_publico.monto_neto)} />
            <Stat label={`Mercado privado${p.mercado_privado.lineas_con_referencias ? ` · ${p.mercado_privado.lineas_con_referencias} línea(s)` : ''}`} valor={monto(p.mercado_privado.monto_neto)} />
            <Stat label={`Nuestro costo${p.costo_verificado.lineas_pendientes ? ` · ${p.costo_verificado.lineas_pendientes} sin verificar` : ''}`} valor={monto(p.costo_verificado.monto_neto)} />
          </div>
          <p className="text-[13px] text-zinc-600">
            Espacio de maniobra: <b>{monto(p.espacio_maniobra.monto)}</b>{p.espacio_maniobra.pct_sobre_costo != null && <> ({p.espacio_maniobra.pct_sobre_costo}% sobre el costo)</>}
            {p.margen.con_precio_venta != null && <> · margen con el precio de venta registrado: <b className={p.margen.con_precio_venta < 20 ? 'text-red-600' : ''}>{p.margen.con_precio_venta}%</b></>}
            {p.orden_sano != null && <> · {p.orden_sano ? '✅ orden sano' : '⚠️ el orden presupuesto ≥ público > privado ≥ costo no se cumple'}</>}
          </p>
          {posicion.provisorias > 0 && <p className="text-[12.5px] text-amber-700">{posicion.provisorias} línea{posicion.provisorias === 1 ? '' : 's'} sin opción firmada: su costo es PROVISORIO (la opción más avanzada).</p>}
          {p.alertas.length > 0 && <ul className="space-y-0.5">{p.alertas.map((a, i) => <li key={i} className={`text-[13px] ${color[a.nivel]}`}>{icono[a.nivel]} {a.detalle}{a.lineas_que_mas_aportan.length > 0 && <> (líneas que más aportan: {a.lineas_que_mas_aportan.join(', ')})</>}</li>)}</ul>}
          {p.lectura && <p className="text-[13.5px] text-zinc-700 bg-zinc-50 rounded-lg px-3 py-2 whitespace-pre-line">{p.lectura}</p>}
          <p className="text-xs text-slate-500">Calculada {posicion.creadoAt.slice(0, 16).replace('T', ' ')}. No es el precio de venta: es la referencia para fijarlo (lo aprueba el jefe de ventas o el EM).</p>
        </div>
      )}
    </div>
  );
}

// Botón que abre el selector de archivos (o recibe arrastrados) para subir una ficha técnica.
// Ficha técnica que ofrece la página del link: primero se MIRA la página y se listan los archivos; solo se descarga el que la persona acepta.
// «Corregir precio o IVA»: cuando el Lector no pudo decidir (el documento no dice si el precio lleva IVA, o la página muestra un precio de relleno)
// la persona lo fija a mano. El motivo es obligatorio y queda registrado; se puede deshacer.
function CorregirCosto({ o, editable, ocupado, onAccion }: { o: OpcionDTO; editable: boolean; ocupado: boolean; onAccion: (opcionId: number, accion: string, extra?: Record<string, unknown>, ok?: string) => void }) {
  const [abierto, setAbierto] = useState(false);
  const [precio, setPrecio] = useState('');
  const [iva, setIva] = useState('');
  const [motivo, setMotivo] = useState('');
  const c = o.correccionCosto;
  const campo = 'text-[12.5px] border border-zinc-200 rounded-md px-2 py-1 outline-none focus:border-amber-400';
  if (c) return (
    <div className="mt-1.5 text-xs text-slate-600">
      ✏️ Corregido a mano por {c.por}: {[c.precio != null ? `precio ${fmtCLP(c.precio)}` : '', c.iva ? (c.iva === 'neto' ? 'el precio es NETO' : 'el precio INCLUYE IVA') : ''].filter(Boolean).join(' · ')}
      <span className="block italic">«{c.motivo}»</span>
      {c.leido.precio != null ? <span className="block text-slate-500">el documento decía: {fmtCLP(c.leido.precio)} ({c.leido.iva === 'no_declarado' ? 'IVA sin definir' : c.leido.iva})</span> : <span className="block text-amber-700">Sin documento: es un precio de tanteo hasta tener la cotización.</span>}
      {editable && <button data-no-pdf onClick={() => onAccion(o.id, 'quitar_correccion_costo', {}, 'Corrección deshecha')} disabled={ocupado} className="underline hover:text-zinc-800">deshacer</button>}
    </div>
  );
  if (!editable) return null;
  const sinDocumento = !o.producto || o.producto.precio == null;   // no hay cotización ni link con precio: se ingresa el precio a mano
  if (!abierto) return <button data-no-pdf onClick={() => setAbierto(true)} className="mt-1.5 text-xs font-semibold text-teal-700 hover:underline">{sinDocumento ? '＋ Ingresar precio a mano…' : 'Corregir precio o IVA…'}</button>;
  const guardar = () => { onAccion(o.id, 'corregir_costo', { precio: precio ? Number(precio.replace(/\./g, '').replace(',', '.')) : null, iva: iva || null, motivo: motivo.trim() }, 'Costo corregido a mano'); setAbierto(false); };
  return (
    <div data-no-pdf className="mt-1.5 space-y-1.5 rounded-md border border-amber-200 bg-amber-50/50 p-2">
      <label className="block text-xs text-slate-600">{sinDocumento ? '¿El precio que ingresas incluye IVA?' : '¿El precio del documento incluye IVA?'}
        <select value={iva} onChange={e => setIva(e.target.value)} className={`${campo} block w-full mt-0.5 bg-white`}>
          <option value="">— no cambiar —</option><option value="neto">No: es precio NETO (+ IVA)</option><option value="incluido">Sí: ya INCLUYE IVA</option>
        </select></label>
      <label className="block text-xs text-slate-600">{sinDocumento ? 'Precio unitario (obligatorio)' : 'Precio unitario correcto (opcional)'}
        <input value={precio} onChange={e => setPrecio(e.target.value)} inputMode="numeric" placeholder="ej. 346546" className={`${campo} block w-full mt-0.5`} /></label>
      <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2} placeholder={sinDocumento ? 'Motivo (obligatorio): ej. «precio que me dio el proveedor por teléfono»' : 'Motivo (obligatorio): ej. «la cotización suma el IVA aparte al final»'} className={`${campo} block w-full`} />
      <div className="flex gap-2">
        <button onClick={guardar} disabled={motivo.trim().length < 8 || (sinDocumento ? !(iva && precio) : (!iva && !precio))} className="px-2 py-0.5 rounded bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-40">Guardar</button>
        <button onClick={() => setAbierto(false)} className="text-xs text-slate-500 hover:text-zinc-700">Cancelar</button>
      </div>
    </div>
  );
}

function BuscarFichaLink({ negocioId, opcionId, ocupado, onTraer }: { negocioId: number; opcionId: number; ocupado: boolean; onTraer: (url: string, nombre: string) => void }) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [buscando, setBuscando] = useState(false);
  const [fichas, setFichas] = useState<Array<{ url: string; texto: string; nombre: string }> | null>(null);
  const buscar = async () => {
    setBuscando(true);
    try { const r = await post(negocioId, { accion: 'buscar_ficha_link', opcionId }); setFichas(r.fichas || []); }
    catch (e: any) { toast.error('No se pudo revisar la página', e.message); }
    finally { setBuscando(false); }
  };
  const traer = async (f: { url: string; texto: string; nombre: string }) => {
    const ok = await confirmar({
      titulo: `¿Descargar «${f.nombre}»?`,
      mensaje: `La página ofrece este archivo («${f.texto}»). Si aceptas, el sistema lo descarga, lo lee y lo usa como ficha técnica de esta opción. Origen: ${(() => { try { return new URL(f.url).hostname; } catch { return f.url; } })()}`,
      confirmarLabel: 'Sí, descargar',
    });
    if (ok) { setFichas(null); onTraer(f.url, f.nombre); }
  };
  return (
    <div data-no-pdf className="mt-1">
      {fichas === null
        ? <button onClick={buscar} disabled={buscando || ocupado} className="text-xs font-semibold text-teal-700 hover:underline disabled:opacity-50">{buscando ? 'Mirando la página…' : 'Buscar ficha en la página del link'}</button>
        : fichas.length === 0
          ? <span className="text-xs text-slate-600">La página no ofrece una ficha para descargar. <button onClick={() => setFichas(null)} className="underline">cerrar</button></span>
          : <ul className="space-y-1">
              <li className="text-xs text-slate-600">La página ofrece:</li>
              {fichas.map(f => (
                <li key={f.url} className="flex items-center gap-1.5 text-[12.5px]">
                  <span className="truncate max-w-[150px] text-zinc-700" title={f.url}>{f.texto}</span>
                  <button onClick={() => traer(f)} className="px-1.5 py-0.5 rounded border border-teal-200 bg-teal-50 text-xs font-semibold text-teal-700 hover:bg-teal-100">Descargar…</button>
                </li>
              ))}
              <li><button onClick={() => setFichas(null)} className="text-xs text-slate-500 underline">cerrar</button></li>
            </ul>}
    </div>
  );
}

/** Pegar el texto de la ficha (copiado de la página del producto, de un correo del proveedor…): se guarda como un .txt y sigue el mismo camino que
 *  una ficha subida (el Lector lo lee y el comparador lo usa contra las bases). */
function PegarTextoFicha({ ocupado, nombreBase, onArchivo }: { ocupado: boolean; nombreBase: string; onArchivo: (f: File) => void }) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  if (!abierto) return <button data-no-pdf onClick={() => setAbierto(true)} disabled={ocupado} className="mt-1.5 text-[13px] font-medium text-teal-700 hover:underline disabled:opacity-50">Pegar el texto de la ficha</button>;
  const guardar = () => {
    const limpio = texto.trim();
    if (limpio.length < 40) return;
    const nombre = `Ficha (texto) ${nombreBase}`.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80).trim() + '.txt';
    onArchivo(new File([limpio], nombre, { type: 'text/plain' }));
    setTexto(''); setAbierto(false);
  };
  return (
    <div data-no-pdf className="mt-2 w-full rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
      <p className="text-[13px] font-medium text-slate-700">Pegar el texto de la ficha técnica</p>
      <p className="text-xs text-slate-600">Cópialo de la página del producto o del correo del proveedor (especificaciones, medidas, normas…).</p>
      <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={6} autoFocus placeholder="Ej.: Material: acero galvanizado · Diámetro: 4&quot; · Espesor: 3 mm · Largo: 6 m · Norma ISO 65 clase media…"
        className="mt-2 w-full rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-700 outline-none focus:border-teal-500" />
      <div className="mt-2 flex items-center gap-3">
        <span className="text-xs text-slate-500 tabular-nums">{texto.trim().length < 40 ? 'Pega al menos unas líneas' : `${texto.trim().length.toLocaleString('es-CL')} caracteres`}</span>
        <button onClick={() => { setAbierto(false); setTexto(''); }} className="ml-auto text-[13px] text-slate-600 hover:text-slate-900">Cancelar</button>
        <button onClick={guardar} disabled={ocupado || texto.trim().length < 40} className="px-3 py-1 rounded-md bg-teal-700 text-white text-[13px] font-semibold hover:bg-teal-800 disabled:opacity-40">Usar como ficha</button>
      </div>
    </div>
  );
}

function BotonSubirFicha({ ocupado, etiqueta, onArchivos, discreto = false }: { ocupado: boolean; etiqueta: string; onArchivos: (f: File[]) => void;
  /** Enlace de texto en vez de botón: para cuando la ficha es opcional (la cotización ya trajo las especificaciones). */
  discreto?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept={ACCEPT_FICHA} multiple className="hidden"
        onChange={e => { if (e.target.files?.length) onArchivos(Array.from(e.target.files)); e.target.value = ''; }} />
      <button onClick={() => ref.current?.click()} disabled={ocupado}
        className={discreto
          ? 'mt-1.5 flex items-center gap-1 text-[13px] font-medium text-teal-700 hover:underline disabled:opacity-50'
          : 'mt-1 flex items-center gap-1 px-2 py-0.5 rounded-md border border-amber-200 bg-amber-50 text-amber-700 text-xs font-semibold hover:bg-amber-100 disabled:opacity-50'}>
        {ocupado ? <><Loader2 size={11} className="animate-spin" /> Leyendo ficha…</> : <><Upload size={11} /> {etiqueta}</>}
      </button>
    </>
  );
}

// Producto que no está en la web: se crea la opción a mano (marca y modelo) o se sube su ficha técnica y la opción nace de ella.
function OpcionSinLink({ filaId, ocupadoFicha, onCrear, onSubirFicha }: {
  filaId: string; ocupadoFicha: boolean; onCrear: (filaId: string, d: { marca: string; modelo: string; proveedor: string }) => Promise<boolean>; onSubirFicha: (f: File[]) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [d, setD] = useState({ marca: '', modelo: '', proveedor: '' });
  const [creando, setCreando] = useState(false);
  const campo = 'text-[13px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-amber-400 w-36';
  const crear = async () => { setCreando(true); const ok = await onCrear(filaId, d); setCreando(false); if (ok) { setD({ marca: '', modelo: '', proveedor: '' }); setAbierto(false); } };
  return (
    <div className="flex items-center gap-2 mb-3 flex-wrap">
      <BotonSubirFicha ocupado={ocupadoFicha} etiqueta="Subir la ficha técnica del producto" onArchivos={onSubirFicha} />
      {!abierto
        ? <button onClick={() => setAbierto(true)} className="mt-1 text-[12.5px] font-semibold text-teal-700 hover:underline">+ Opción sin link (marca y modelo)</button>
        : <>
            <input value={d.marca} onChange={e => setD({ ...d, marca: e.target.value })} placeholder="Marca" className={campo} />
            <input value={d.modelo} onChange={e => setD({ ...d, modelo: e.target.value })} placeholder="Modelo" className={campo} />
            <input value={d.proveedor} onChange={e => setD({ ...d, proveedor: e.target.value })} placeholder="Proveedor (opcional)" className={campo} />
            <button onClick={crear} disabled={creando || (!d.marca.trim() && !d.modelo.trim())} className="px-2.5 py-1.5 rounded-lg bg-amber-600 text-white text-[13px] font-semibold hover:bg-amber-700 disabled:opacity-40">{creando ? 'Creando…' : 'Crear opción'}</button>
            <button onClick={() => setAbierto(false)} className="text-[12.5px] text-slate-500 hover:text-zinc-700">Cancelar</button>
          </>}
    </div>
  );
}

function Stat({ label, valor, rojo }: { label: string; valor: string; rojo?: boolean }) {
  return <div><p className="text-xs text-slate-600">{label}</p><p className={`text-[15px] font-bold tabular-nums ${rojo ? 'text-red-600' : 'text-zinc-800'}`}>{valor}</p></div>;
}

// ── Cuadro comparativo de UNA línea: columnas = opciones, filas = costo y verificación ────────────
function CuadroLinea({ negocioId, linea, ocupado, verificando, onVerificar, puedeAprobar, subiendoFicha, onSubirFicha, onRespaldarCelda, buscandoMercado, onMercado, verificandoCosto, onCostoIA, onAccion, onModal }: {
  negocioId: number; linea: LineaAuditorDTO; ocupado: number | null; verificando: Set<number>; onVerificar: (opcionId: number) => void; puedeAprobar: boolean;
  subiendoFicha: Set<string>; onSubirFicha: (opcionId: number, archivos: File[]) => void; onRespaldarCelda: (opcionId: number, n: number, archivos: File[], nota?: string) => Promise<boolean>;
  buscandoMercado: Set<number>; onMercado: (opcionId: number) => void;
  verificandoCosto: Set<number>; onCostoIA: (opcionId: number) => void;
  onAccion: (opcionId: number, accion: string, extra?: Record<string, unknown>, ok?: string) => void;
  onModal: (tipo: 'descartar' | 'rechazar', opcionId: number) => void;
}) {
  const vivas = linea.opciones.filter(o => o.estado !== 'descartada');
  const costos = vivas.map(o => o.verificacion?.costoNetoUnitario).filter((x): x is number => x != null);
  const minimo = costos.length > 1 ? Math.min(...costos) : null;
  const columnas = [...vivas, ...linea.opciones.filter(o => o.estado === 'descartada')];

  const imprimirLinea = useContext(ImprimirCtx);
  return (
    <div>
      <CuadroTecnico negocioId={negocioId} linea={linea} ocupado={ocupado} puedeAprobar={puedeAprobar} verificando={verificando} subiendoFicha={subiendoFicha} onSubirFicha={onSubirFicha} onRespaldarCelda={onRespaldarCelda} onAccion={onAccion} onModal={onModal} />
      <details className="mt-4 rounded-lg border border-zinc-200" open={imprimirLinea}>
        <summary className="cursor-pointer px-3 py-2 text-[13px] font-semibold text-zinc-600 hover:text-zinc-900">Detalle avanzado — respaldos, costo frente a lo costeado, mercado, verificación de costo con IA y vía</summary>
        <div className="overflow-x-auto p-3 pt-1">
      <table className="w-full text-[13px] border-collapse">
        <thead>
          <tr className="text-left align-top">
            <th className="w-32 pr-3 pb-2 text-xs uppercase tracking-wide text-slate-500 font-bold">Opción</th>
            {columnas.map(o => (
              <th key={o.id} className={`pb-2 pr-4 min-w-[210px] font-normal ${o.estado === 'descartada' ? 'opacity-50' : ''}`}>
                <p className="font-semibold text-zinc-800">{o.proveedorRazonSocial || 'Proveedor sin identificar'}</p>
                <p className="text-slate-600">{[o.marca, o.modelo].filter(Boolean).join(' ') || o.producto?.nombre || 'Producto sin identificar'}</p>
                <span className={`inline-block mt-1 text-xs font-bold px-2 py-0.5 rounded-full ${ESTADO_OPCION[o.estado]?.cls}`}>{ESTADO_OPCION[o.estado]?.label}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="align-top">
          <Fila etiqueta="Costo unit. neto">
            {columnas.map(o => {
              const c = o.verificacion?.costoNetoUnitario ?? null;
              return <td key={o.id} className="py-1.5 pr-4"><span className={`text-[13px] font-bold ${c != null && c === minimo ? 'text-emerald-600' : 'text-zinc-800'}`}>{fmtCLP(c)}</span>{c != null && c === minimo && <span className="ml-1 text-xs text-emerald-600 font-bold">más barata</span>}
                {c == null && o.producto?.precio != null && <span className="block text-xs text-slate-500">el documento dice {fmtCLP(o.producto.precio)} ({o.producto.iva === 'no_declarado' ? 'IVA sin definir' : o.producto.moneda})</span>}
                <ConversionMoneda p={o.producto} compacto />
                {c != null && o.producto?.ivaSupuesto && <span className="block text-xs text-slate-500">precio web {fmtCLP(o.producto.precio)} con IVA (asumido: la página no lo dice): se sacó el IVA</span>}</td>;
            })}
          </Fila>
          <Fila etiqueta="Costeado">
            {columnas.map(o => {
              const v = o.verificacion;
              return <td key={o.id} className="py-1.5 pr-4 text-zinc-600">{fmtCLP(linea.costeadoNeto)}{v?.diffPct != null && <span className={`ml-1.5 font-semibold ${v.direccion === 'MAS_CARO' ? 'text-red-600' : v.direccion === 'MAS_BARATO' ? 'text-emerald-600' : 'text-slate-500'}`}>{v.diffPct > 0 ? '+' : ''}{v.diffPct}%</span>}</td>;
            })}
          </Fila>
          <Fila etiqueta="Veredicto">
            {columnas.map(o => <td key={o.id} className="py-1.5 pr-4">{o.verificacion ? <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full ${VEREDICTO[o.verificacion.veredicto]?.cls}`}>{VEREDICTO[o.verificacion.veredicto]?.label}</span> : <span className="text-zinc-300">—</span>}</td>)}
          </Fila>
          <Fila etiqueta="Técnico">
            {columnas.map(o => <td key={o.id} className="py-1.5 pr-4"><EstadoTecnico o={o} ocupado={verificando.has(o.id)} onVerificar={onVerificar} /></td>)}
          </Fila>
          <Fila etiqueta="Respaldo">
            {columnas.map(o => {
              const r = o.respaldos.find(x => x.sostieneCosto) || o.respaldos[0];
              return <td key={o.id} className="py-1.5 pr-4 text-zinc-600">{r ? <a href={r.documentoUrl || r.url || '#'} target="_blank" rel="noopener noreferrer" className="text-teal-700 hover:underline">{r.documentoNombre || 'Ver'}</a> : '—'}{o.respaldos.length > 1 && <span className="text-slate-500"> (+{o.respaldos.length - 1})</span>}<br /><span className="text-xs text-slate-500">{o.verificacion?.origenDato === 'RESPALDO_INFORMAL' ? 'informal' : o.respaldos[0]?.tipo?.replace(/_/g, ' ')}</span>
                {o.capturas[0] && <><br /><span className="text-xs text-slate-500">captura {o.capturas[0].capturadoAt.slice(0, 16).replace('T', ' ')} · {o.capturas[0].estado}{o.capturas[0].hayImagen && <> · <a href={`/api/negocios/${negocioId}/auditor/captura/${o.capturas[0].id}`} target="_blank" rel="noopener noreferrer" className="text-teal-700 hover:underline">ver</a></>}</span></>}</td>;
            })}
          </Fila>
          <Fila etiqueta="Ficha técnica">
            {columnas.map(o => {
              const fichas = o.respaldos.filter(r => r.tipo === 'ficha_tecnica' && r.vigente);
              const editable = !['descartada', 'en_aprobacion', 'aprobada'].includes(o.estado);
              return (
                <td key={o.id} className="py-1.5 pr-4 text-zinc-600">
                  {fichas.length === 0
                    ? <span className="text-xs text-slate-500">{o.respaldos.some(r => r.tipo === 'link_web') ? 'Se usa la página del link' : 'Sin ficha: sube la del producto'}</span>
                    : fichas.map(f => <a key={f.id} href={f.documentoUrl || '#'} target="_blank" rel="noopener noreferrer" className="block text-teal-700 hover:underline truncate max-w-[200px]">{f.documentoNombre || 'Ficha'}</a>)}
                  {editable && <BotonSubirFicha ocupado={subiendoFicha.has(`o${o.id}`)} etiqueta={fichas.length ? 'Agregar otra ficha' : 'Subir ficha técnica'} onArchivos={f => onSubirFicha(o.id, f)} />}
                  {editable && o.respaldos.some(r => r.tipo === 'link_web' && r.vigente) && <BuscarFichaLink negocioId={negocioId} opcionId={o.id} ocupado={ocupado === o.id} onTraer={(url, nombre) => onAccion(o.id, 'traer_ficha_link', { url }, `Ficha «${nombre}» agregada. Ahora pulsa «Comparar la línea».`)} />}
                </td>
              );
            })}
          </Fila>
          <Fila etiqueta="Stock · Plazo">
            {columnas.map(o => <td key={o.id} className="py-1.5 pr-4 text-zinc-600">{o.producto?.stock || '—'}<br /><span className="text-xs text-slate-500">{o.producto?.plazoTexto || 'plazo no declarado'}</span></td>)}
          </Fila>
          <Fila etiqueta="Costo (IA)">
            {columnas.map(o => <td key={o.id} className="py-1.5 pr-4"><CostoIAOpcion o={o} verificando={verificandoCosto.has(o.id)} onVerificar={onCostoIA} /></td>)}
          </Fila>
          <Fila etiqueta="Mercado">
            {columnas.map(o => <td key={o.id} className="py-1.5 pr-4"><MercadoOpcion o={o} buscando={buscandoMercado.has(o.id)} onBuscar={onMercado} onAccion={onAccion} /></td>)}
          </Fila>
          <Fila etiqueta="Bloqueos y alertas">
            {columnas.map(o => (
              <td key={o.id} className="py-1.5 pr-4">
                {(o.verificacion?.bloqueos || []).map((b, i) => (
                  <div key={`b${i}`} className="mb-1.5 rounded-md bg-red-50 border border-red-100 px-2 py-1.5">
                    <p className="text-red-700 font-semibold">🔴 {b.codigo} — {b.mensaje}</p>
                    <p className="text-xs text-red-600/80 mt-0.5">Salida: {b.salida}</p>
                  </div>
                ))}
                {(o.verificacion?.alertas || []).filter(a => a.nivel !== 'info').map((a, i) => (
                  <p key={`a${i}`} className={`mb-1 ${a.nivel === 'rojo' ? 'text-red-600' : 'text-amber-700'}`}>{a.nivel === 'rojo' ? '🔴' : '🟡'} {a.codigo} — {a.mensaje}</p>
                ))}
                {(o.verificacion?.alertas || []).filter(a => a.nivel === 'info').map((a, i) => <p key={`i${i}`} className="mb-1 text-slate-600">ℹ️ {a.codigo} — {a.mensaje}</p>)}
                {o.motivoDescarte && <p className="text-slate-600">Descartada: {o.motivoDescarte}</p>}
              </td>
            ))}
          </Fila>
          <Fila etiqueta="Vía de verificación">
            {columnas.map(o => <td key={o.id} className="py-2 pr-4"><Acciones modo="via" o={o} exigeViaCompleta={linea.exigeViaCompleta} ocupado={ocupado === o.id} puedeAprobar={puedeAprobar} onAccion={onAccion} onModal={onModal} /></td>)}
          </Fila>
        </tbody>
      </table>
        </div>
      </details>
    </div>
  );
}

const CHIP_TECNICO: Record<string, { label: string; cls: string }> = {
  CUMPLE: { label: 'CUMPLE', cls: 'bg-emerald-100 text-emerald-700' },
  CON_PENDIENTES: { label: 'FALTA DATO', cls: 'bg-amber-100 text-amber-800' },
  NO_CUMPLE: { label: 'NO CUMPLE', cls: 'bg-red-100 text-red-700' },
  NO_CORRIDO: { label: 'Sin comparar', cls: 'bg-zinc-100 text-zinc-600' },
  SIN_REQUISITOS: { label: 'Sin requisitos heredados', cls: 'bg-zinc-100 text-slate-600' },
  NO_APLICA: { label: 'Vía liviana: no corre', cls: 'bg-zinc-100 text-slate-600' },
  SIN_EVALUAR: { label: 'Sin evaluar', cls: 'bg-zinc-100 text-zinc-600' },
};
const ICONO_VEREDICTO: Record<string, string> = { CUMPLE: '✅', NO_CUMPLE: '❌', CUMPLE_CON_COMPLEMENTO: '➕', SIN_VEREDICTO: '⏳' };
const MARCA_ORIGEN: Record<string, string> = { FICHA_WEB: '🌐', CONFIRMACION_INFORMAL: '💬', DECLARADO: '✍️', CONTRADICE_FICHA: '⚠️' };

function EstadoTecnico({ o, ocupado, onVerificar }: { o: OpcionDTO; ocupado: boolean; onVerificar: (opcionId: number) => void }) {
  const t = o.tecnico;
  const r = t.resultado;
  const puede = o.via === 'completa' && t.requisitosTotal > 0 && o.estado !== 'descartada' && !['aprobada', 'en_aprobacion'].includes(o.estado);
  return (
    <div>
      <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full ${CHIP_TECNICO[t.estado]?.cls}`}>{CHIP_TECNICO[t.estado]?.label}</span>
      {r && <span className="ml-1.5 text-xs text-slate-600">{r.resumen.cumple} ✅ · {r.resumen.noCumple} ❌ · {r.resumen.sinVeredicto} ❓</span>}
      {t.error && <p className="text-xs text-red-600 mt-0.5">{t.error}</p>}
      {t.corridoAt && <p className="text-xs text-slate-500">Comparado {t.corridoAt.slice(0, 16).replace('T', ' ')}</p>}
      {puede && (
        <button onClick={() => onVerificar(o.id)} disabled={ocupado}
          className="mt-1 flex items-center gap-1 px-2 py-0.5 rounded-md border border-teal-200 text-teal-700 text-xs font-semibold hover:bg-teal-50 disabled:opacity-50">
          {ocupado ? <><Loader2 size={11} className="animate-spin" /> Comparando…</> : t.corridoAt ? 'Volver a comparar la línea' : 'Comparar la línea'}
        </button>
      )}
    </div>
  );
}

// ── Cuadro comparativo TÉCNICO de una línea (Prompt 4 v3.0): filas = requisitos (texto de las bases), columnas = opciones ────
// ✅ cumple · 🟩 sobrecumple (dato ofertado entre paréntesis, verde oscuro) · ❌ no cumple (dato entre paréntesis) · ❓ falta dato (se cierra con un clic).
// Penúltima fila: ESTADO del producto. Última fila: COSTO UNIT. NETO. Debajo, máximo 3 notas por producto. La cita NO se muestra (queda guardada para el EM).
/** Respaldos de UN requisito: documentos o imágenes que subió el asistente para complementar el dato. No cierran el requisito: el EM los mira con el «ojo» y decide. */
function RespaldosCelda({ respaldos, editable, subiendo, onSubir, onQuitar, sinSubir = false }: {
  respaldos: { url: string; nombre: string; nota?: string; por: string; at: string }[]; editable: boolean; subiendo: boolean;
  onSubir: (archivos: File[]) => void; onQuitar: (r: { url: string; nombre: string }) => void;
  /** Solo la lista (quitar incluido), sin el botón de adjuntar: el panel del requisito tiene su propio recuadro para complementar. */
  sinSubir?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className="mt-1.5 block font-normal space-y-1" data-no-pdf>
      {respaldos.map(r => {
        const esNota = r.url.startsWith('nota:');   // complemento solo con texto
        return (
          <span key={r.url} className="block text-[12.5px] text-slate-600">
            <span className="flex items-center gap-1">
              {esNota ? <span aria-hidden className="text-slate-500">💬</span> : <Clip size={11} className="text-slate-500 shrink-0" />}
              {!esNota && <span className="truncate max-w-[180px]" title={r.nombre}>{r.nombre}</span>}
              {!esNota && <a href={r.url} target="_blank" rel="noopener noreferrer" title="Ver el respaldo" className="p-0.5 rounded text-teal-700 hover:bg-teal-50"><Eye size={14} /></a>}
              <span className="text-xs text-slate-500">{esNota ? 'Nota de ' : ''}{r.por}</span>
              {editable && <button onClick={() => onQuitar(r)} title="Quitar" className="ml-1 text-xs text-slate-500 underline hover:text-slate-700">quitar</button>}
            </span>
            {r.nota && <span className="block pl-4 italic text-slate-600">«{r.nota}»</span>}
          </span>
        );
      })}
      {editable && !sinSubir && (<>
        <input ref={ref} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx" multiple className="hidden"
          onChange={e => { if (e.target.files?.length) onSubir(Array.from(e.target.files)); e.target.value = ''; }} />
        <button onClick={() => ref.current?.click()} disabled={subiendo}
          className="mt-0.5 flex items-center gap-1 text-[13px] font-medium text-slate-600 hover:text-slate-800 hover:underline disabled:opacity-50">
          {subiendo ? <><Loader2 size={11} className="animate-spin" /> Subiendo…</> : <><Clip size={11} /> Adjuntar respaldo</>}
        </button>
      </>)}
    </span>
  );
}

function CeldaTecnica({ f, editable, puedeEM, onConfirmar, onComplementar, subiendo, respaldos = [], onRespaldar, onQuitarRespaldo, subiendoRespaldo }: { f: any; editable: boolean; puedeEM: boolean; onConfirmar: (confirmada: boolean, motivo?: string) => void; onComplementar?: (archivos: File[]) => void; subiendo?: boolean;
  respaldos?: { url: string; nombre: string; nota?: string; por: string; at: string }[]; onRespaldar?: (archivos: File[]) => void; onQuitarRespaldo?: (r: { url: string; nombre: string }) => void; subiendoRespaldo?: boolean }) {
  const estado: string = f.estadoCelda ?? (f.veredicto === 'NO_CUMPLE' ? 'NO_CUMPLE' : f.veredicto === 'SIN_VEREDICTO' ? 'FALTA_DATO' : f.sobrecumple ? 'SOBRECUMPLE' : 'CUMPLE');
  const dato = f.valorCorto && !f.confirmada ? ` (${f.valorCorto})` : '';
  const aviso = f.revisar ? <span title="Número sin unidad que no calza con lo exigido: revisa el dato." className="ml-1 text-amber-600">⚠</span> : null;
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const corregido = f.confirmada && f.valorCorto === 'corregido a mano';
  // Decisión CA (1-oct-2026): un ❌ (siempre) y un ❓ de una exigencia inadmisible (rojo) solo los cierra el EM.
  const soloEM = estado === 'NO_CUMPLE' || (estado === 'FALTA_DATO' && !!f.rojo);
  if (f.confirmada) return (
    <span className="text-emerald-700">✅ <span className="text-xs text-slate-600">{corregido ? 'corregido' : 'confirmado'} por {f.confirmada.por || 'el asistente'}</span>
      {f.confirmada.motivo && <span className="block text-xs text-slate-600 italic">«{f.confirmada.motivo}»</span>}
      {corregido && f.partes?.[0]?.ofertadoValor && <span className="block text-xs text-slate-500">el documento decía: {f.partes[0].ofertadoValor}</span>}
      {editable && (puedeEM || !(corregido || f.rojo)) && <button onClick={() => onConfirmar(false)} className="text-xs text-slate-500 underline hover:text-zinc-700">deshacer</button>}
      {respaldos.length > 0 && <RespaldosCelda respaldos={respaldos} editable={false} subiendo={false} onSubir={() => {}} onQuitar={() => {}} />}</span>
  );
  if (estado === 'SOBRECUMPLE') return <span className="font-semibold text-emerald-800">🟩{dato}{aviso}</span>;
  if (estado === 'CUMPLE') return <span className="text-emerald-700">✅{f.valorCorto ? <span className="text-xs text-slate-500"> ({f.valorCorto})</span> : null}{aviso}</span>;
  const noCumple = estado === 'NO_CUMPLE';
  const guardar = () => { onConfirmar(true, motivo.trim()); setAbierto(false); setMotivo(''); };
  return (
    <span className={noCumple ? 'text-red-600' : 'text-amber-700'}>
      <span className="text-[13px] font-medium">{noCumple ? <>❌ No cumple{dato}{aviso}</> : <>❓ Falta dato</>}</span>
      {editable && !abierto && soloEM && !puedeEM && (<>
        <span title="Esta exigencia puede dejarnos fuera de la licitación: la aprueba el Encargado de Mercado Público (EM). Tú complementas la ficha técnica y el sistema vuelve a revisarla: si la ficha trae el dato, pasa sola; si no, el EM decide." className="ml-1.5 text-xs font-normal text-slate-500">· la aprueba el EM</span>
        {onComplementar && <BotonSubirFicha ocupado={!!subiendo} discreto etiqueta="Complementar con la ficha" onArchivos={onComplementar} />}
      </>)}
      {editable && !abierto && (!soloEM || puedeEM) && <span aria-hidden className="mx-1.5 text-slate-300">·</span>}
      {editable && !abierto && (!soloEM || puedeEM) && (
        <button onClick={() => setAbierto(true)}
          title={noCumple ? 'Si sabes que sí lo cumple (el proveedor te lo confirmó, hay otra ficha…), dalo por cumplido dejando el motivo' : 'Sé que lo cumple: lo doy por cumplido (queda registrado quién y cuándo)'}
          className="text-[13px] font-medium text-teal-700 hover:underline">{noCumple ? 'Sí cumple…' : 'Lo confirmo'}</button>)}
      {editable && abierto && (
        <span className="mt-1.5 block font-normal">
          <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2} autoFocus
            placeholder={soloEM ? 'Motivo y respaldo (obligatorio): ¿cómo se sabe que sí cumple? (ej. «el proveedor lo confirmó por correo; el correo está adjunto en la opción»)' : 'Detalle (opcional): ¿cómo lo sabes?'}
            className="w-full min-w-[200px] text-[12.5px] text-zinc-700 border border-zinc-200 rounded-md px-2 py-1 outline-none focus:border-amber-400" />
          <span className="flex gap-2 mt-1">
            <button onClick={guardar} disabled={soloEM && motivo.trim().length < 8} className="px-2 py-0.5 rounded bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-40">Dar por cumplido</button>
            <button onClick={() => { setAbierto(false); setMotivo(''); }} className="text-xs text-slate-500 hover:text-zinc-700">Cancelar</button>
          </span>
        </span>
      )}
      <RespaldosCelda respaldos={respaldos} editable={editable && !!onRespaldar} subiendo={!!subiendoRespaldo} onSubir={fs => onRespaldar?.(fs)} onQuitar={r => onQuitarRespaldo?.(r)} />
    </span>
  );
}

// Precio que la lectura dejó como dudoso (caso real 2427-98-LE26: «$ 5.33 0.000» con un espacio del PDF, «USD $36.250» ¿36 mil o 36 dólares?).
// No entra al costo hasta que una persona lo mira en el documento y lo confirma: un clic, queda registrado quién (como «Corregir precio o IVA…»).
function PrecioPorConfirmar({ o, editable, ocupado, onAccion }: { o: OpcionDTO; editable: boolean; ocupado: boolean; onAccion: (opcionId: number, accion: string, extra?: Record<string, unknown>, ok?: string) => void }) {
  const p = o.producto!;
  const leido = p.conversion ? `${p.conversion.monedaOriginal} ${p.conversion.precioOriginal.toLocaleString('es-CL')} (${fmtCLP(p.precio)})` : fmtCLP(p.precio);
  const doc = o.respaldos.find(r => r.vigente && r.sostieneCosto) ?? o.respaldos.find(r => r.vigente && r.tipo !== 'ficha_tecnica');
  const href = doc?.documentoUrl || doc?.url;
  return (
    <span className="mt-1 block text-[12.5px] leading-snug text-amber-800">
      <b>Precio por confirmar:</b> el número del documento se leyó dudoso. Se entendió <b className="tabular-nums">{leido}</b>.
      {href && <> <a href={href} target="_blank" rel="noopener noreferrer" className="text-teal-700 hover:underline whitespace-nowrap">Ver el documento</a></>}
      {editable && (
        <button data-no-pdf disabled={ocupado}
          onClick={() => onAccion(o.id, 'corregir_costo', { precio: p.precio, iva: null, motivo: `Precio confirmado contra el documento: ${leido}` }, 'Precio confirmado')}
          className="mt-1 block px-2 py-0.5 rounded-md bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800 disabled:opacity-50">
          Sí, es {fmtCLP(p.precio)}{p.conversion ? ' (en pesos)' : ''}
        </button>
      )}
      {editable && <span className="block text-xs text-slate-600">Si no es ese, corrígelo con «Corregir precio o IVA…».</span>}
    </span>
  );
}

// Con qué documentos se comparó la opción. El comparador lee TODO lo que respalda la opción (cotización, ficha, página del link): si la cotización
// trae las especificaciones, el cuadro se llena sin ficha aparte (caso real 2427-98-LE26: cotización GETAC B360 de Comercial MP con CPU, RAM, disco…).
const TIPO_RESPALDO: Record<string, string> = { cotizacion_formal: 'Cotización', cotizacion_informal: 'Cotización informal', ficha_tecnica: 'Ficha técnica', link_web: 'Página web' };
function FuenteTecnica({ o }: { o: OpcionDTO }) {
  const docs = o.respaldos.filter(r => r.vigente);
  if (!docs.length) return null;
  return (
    <span className="mt-1.5 block text-xs leading-snug text-slate-600">
      Comparado con:
      {docs.map(r => {
        const href = r.documentoUrl || r.url;
        const nombre = r.documentoNombre || (r.url ? (() => { try { return new URL(r.url!).hostname.replace(/^www\./, ''); } catch { return 'link'; } })() : 'documento');
        return <span key={r.id} className="block truncate max-w-[260px]" title={nombre}>
          {TIPO_RESPALDO[r.tipo] || r.tipo.replace(/_/g, ' ')} · {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-teal-700 hover:underline">{nombre}</a> : nombre}
        </span>;
      })}
      {!docs.some(r => r.tipo === 'ficha_tecnica') && o.tecnico.resultado && <span className="block text-slate-500">Sin ficha aparte: los datos técnicos salen de {docs.some(r => r.tipo.startsWith('cotizacion')) ? 'la cotización' : 'la página del link'}.</span>}
    </span>
  );
}

// Solo para cotizaciones en moneda extranjera: el precio que dice el documento, el tipo de cambio del día de la lectura y el resultado en pesos.
function ConversionMoneda({ p, compacto = false, plano = false }: { p: OpcionDTO['producto']; compacto?: boolean;
  /** Una línea de texto, sin recuadro (dentro de la tarjeta de la opción). */
  plano?: boolean }) {
  const cv = p?.conversion;
  if (!cv || p?.precio == null) return null;
  const simbolo = cv.monedaOriginal === 'EUR' ? '€' : 'US$';
  const nombre = cv.monedaOriginal === 'EUR' ? 'Euro' : 'Dólar';
  const fecha = cv.fecha.split('-').reverse().join('-');
  if (plano) return (
    <p className="mt-1 text-[12.5px] text-slate-600 tabular-nums">
      Cotizado en {cv.monedaOriginal}: <b className="text-slate-800">{simbolo} {cv.precioOriginal.toLocaleString('es-CL')}</b> · {nombre.toLowerCase()} del {fecha}: ${cv.tipoCambio.toLocaleString('es-CL')}
    </p>
  );
  return (
    <span className={`mt-1 block rounded-md border border-teal-200 bg-teal-50 px-2 py-1 leading-snug text-teal-900 ${compacto ? 'text-xs' : 'text-[12.5px]'}`}>
      <b>Cotizado en {cv.monedaOriginal}:</b> {simbolo} {cv.precioOriginal.toLocaleString('es-CL')}<br />
      <b>{nombre} del día ({fecha}):</b> ${cv.tipoCambio.toLocaleString('es-CL')}<br />
      <b>En pesos:</b> {fmtCLP(p.precio)}
    </span>
  );
}

// De dónde sale el precio de una opción, para poder comprobarlo: el link o el documento que sostiene el costo, lo que dice ese precio tal cual
// (con o sin IVA) y la captura de la página con su fecha.
function FuenteCosto({ o, negocioId }: { o: OpcionDTO; negocioId: number }) {
  const costeables = o.respaldos.filter(r => r.vigente && r.tipo !== 'ficha_tecnica');
  const r = costeables.find(x => x.sostieneCosto) ?? costeables[0];
  if (!r) return null;
  const href = r.url || r.documentoUrl;
  const etiqueta = r.url ? (() => { try { return new URL(r.url!).hostname.replace(/^www\./, ''); } catch { return r.url!; } })() : (r.documentoNombre || 'documento');
  const p = o.producto;
  const iva = p?.iva === 'incluido' ? 'con IVA' : p?.iva === 'neto' ? 'neto' : 'IVA sin definir';
  const cap = r.url ? o.capturas[0] : null;
  return (
    <span className="mt-1 block text-xs text-slate-600 leading-snug">
      Fuente: {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-teal-700 hover:underline inline-flex items-center gap-0.5 break-all">{etiqueta} <ExternalLink size={10} /></a> : etiqueta}
      {p?.precio != null && <> · dice <b className="text-zinc-700">{p.conversion ? `US$ ${p.conversion.precioOriginal.toLocaleString('es-CL')}`.replace('US$', p.conversion.monedaOriginal === 'EUR' ? '€' : 'US$') : fmtCLP(p.precio)}</b> {iva}</>}
      {cap && <> · captura {cap.capturadoAt.slice(0, 10)}{cap.hayImagen && <> · <a href={`/api/negocios/${negocioId}/auditor/captura/${cap.id}`} target="_blank" rel="noopener noreferrer" className="text-teal-700 hover:underline">ver imagen</a></>}</>}
    </span>
  );
}

function CuadroTecnico({ negocioId, linea, ocupado, puedeAprobar, verificando, subiendoFicha, onSubirFicha, onRespaldarCelda, onAccion, onModal }: {
  negocioId: number; linea: LineaAuditorDTO; ocupado: number | null; puedeAprobar: boolean; verificando: Set<number>; subiendoFicha: Set<string>;
  onSubirFicha: (opcionId: number, archivos: File[]) => void; onRespaldarCelda: (opcionId: number, n: number, archivos: File[], nota?: string) => Promise<boolean>;
  onAccion: (opcionId: number, accion: string, extra?: Record<string, unknown>, ok?: string) => void;
  onModal: (tipo: 'descartar' | 'rechazar', opcionId: number) => void;
}) {
  // Diseño «primero las excepciones» (26-oct-2026): con 50+ requisitos la tabla plana obligaba a recorrer todo para hallar los 5 que importan.
  // Arriba una tarjeta por opción (lo que se decide); abajo los requisitos por gravedad, SOLO PARA LEER; al hacer clic en uno se abre el panel
  // del requisito con el texto completo, la cita del documento y las acciones (confirmar, complementar con texto y/o archivo).
  const [verCumplidos, setVerCumplidos] = useState(false);   // hooks antes del return temprano
  const [soloDifieren, setSoloDifieren] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [detalle, setDetalle] = useState<number | null>(null);   // n del requisito abierto en el panel
  const imprimirCuadro = useContext(ImprimirCtx);
  const columnas = linea.opciones.filter(o => o.estado !== 'descartada');
  const descartadas = linea.opciones.filter(o => o.estado === 'descartada');
  if (columnas.length === 0) return descartadas.length ? <p className="text-[13px] text-slate-600">Todas las opciones de esta línea están descartadas ({descartadas.length}). Restaura una o agrega otro producto.</p> : null;
  const conResultado = columnas.filter(o => o.tecnico.resultado);
  const base = conResultado[0]?.tecnico.resultado!.filas ?? [];
  const fila = (o: OpcionDTO, n: number) => o.tecnico.resultado?.filas.find(f => f.n === n);
  const editable = (o: OpcionDTO) => !['descartada', 'en_aprobacion', 'aprobada'].includes(o.estado);
  const costos = columnas.map(o => o.verificacion?.costoNetoUnitario ?? null).filter((x): x is number => x != null);
  const minimo = costos.length > 1 ? Math.min(...costos) : null;
  // Un ❓/❌ que el asistente ya complementó (nota y/o archivo) sigue abierto hasta que el EM decida, pero NO es lo mismo que uno sin tocar:
  // se cuenta y se muestra aparte («Complementado · espera al EM»). Caso real 26-oct-2026: Consuelo complementó el requisito 9 y la pantalla seguía en «Falta dato».
  const complementada = (o: OpcionDTO, n: number) => (o.tecnico.respaldosCelda?.[n]?.length ?? 0) > 0;
  const cuenta = (o: OpcionDTO) => {
    const fs = o.tecnico.resultado?.filas ?? [];
    const abiertas = fs.filter(f => estadoVisible(f) !== 'CUMPLE');
    return {
      cumple: fs.length - abiertas.length,
      complementadas: abiertas.filter(f => complementada(o, f.n)).length,
      falta: abiertas.filter(f => estadoVisible(f) === 'FALTA_DATO' && !complementada(o, f.n)).length,
      no: abiertas.filter(f => estadoVisible(f) === 'NO_CUMPLE' && !complementada(o, f.n)).length,
    };
  };
  // Gravedad de un requisito = la peor celda entre las opciones (0 = no cumple, 1 = falta un dato, 1.5 = complementado esperando al EM, 2 = cumple).
  const gravedad = (n: number) => Math.min(...columnas.map(o => {
    const e = estadoVisible(fila(o, n));
    if (e === 'CUMPLE' || e == null) return 2;
    if (complementada(o, n)) return 1.5;
    return e === 'NO_CUMPLE' ? 0 : 1;
  }));
  const difieren = (n: number) => new Set(columnas.map(o => estadoVisible(fila(o, n)))).size > 1;
  const q = busqueda.trim().toLowerCase();
  const pendientes = base.filter(f0 => gravedad(f0.n) < 2).sort((a, b) => gravedad(a.n) - gravedad(b.n) || a.n - b.n);
  const cumplidos = base.filter(f0 => gravedad(f0.n) === 2);
  const mostrarCumplidos = verCumplidos || imprimirCuadro || !!q || soloDifieren;
  const filas = [...pendientes, ...(mostrarCumplidos ? cumplidos : [])]
    .filter(f0 => !q || f0.requeridoTexto.toLowerCase().includes(q))
    .filter(f0 => !soloDifieren || difieren(f0.n));
  const nombreCorto = (o: OpcionDTO) => [o.marca, o.modelo].filter(Boolean).join(' ') || o.producto?.nombre || 'Producto sin identificar';
  // El panel recorre los pendientes en el orden de la lista (si el abierto ya no está pendiente, recorre todo lo visible).
  const recorrido = pendientes.some(f => f.n === detalle) ? pendientes : filas;
  const idx = recorrido.findIndex(f => f.n === detalle);
  const filaDetalle = base.find(f => f.n === detalle) ?? null;

  return (
    <div className="space-y-3">
      {/* ── Una tarjeta por opción: aquí se decide. Tres partes: el producto y su precio · qué falta · respaldo y acciones.
             Con UNA opción la tarjeta usa todo el ancho y las tres partes van lado a lado; con varias, cada tarjeta las apila. ── */}
      <div className={`grid gap-3 ${columnas.length === 2 ? 'lg:grid-cols-2' : columnas.length >= 3 ? 'lg:grid-cols-2 2xl:grid-cols-3' : ''}`}>
        {columnas.map(o => {
          const c = o.verificacion?.costoNetoUnitario ?? null, r = o.tecnico.resultado, k = cuenta(o);
          const bloqueos = (o.verificacion?.bloqueos || []).filter(b => !(b.codigo === 'LECTURA' && o.producto?.precioAmbiguo));   // el precio dudoso tiene su propio aviso
          const notas = [...(r?.notas || []).slice(0, 3), ...(r?.alertas.filter(a => a.nivel !== 'info').slice(0, 1).map(a => a.texto) || [])];
          const ancha = columnas.length === 1;
          const precioPendiente = c == null && o.producto?.precio != null;
          const nadaFalta = !precioPendiente && !bloqueos.length && !notas.length && !(r && (k.falta || k.no || k.complementadas));
          const rotulo = 'text-xs text-slate-600';
          return (
            <div key={o.id} className="rounded-xl border border-zinc-200 bg-white shadow-sm">
              <div className={`grid ${ancha ? 'md:grid-cols-3 md:divide-x' : ''} divide-zinc-100`}>
                {/* 1 · El producto y su precio */}
                <div className="px-4 py-3">
                  <p className="text-[13.5px] font-medium text-slate-900 leading-tight">{nombreCorto(o)}</p>
                  <p className="text-[13px] text-slate-600">{o.proveedorRazonSocial || 'Proveedor sin identificar'} · {ESTADO_OPCION[o.estado]?.label}</p>
                  {(() => {
                    // Directo al grano (pedido 26-oct-2026): cotización vs costeo, ambos netos unitarios, y si estamos más bajos o no.
                    // Sin costo verificado todavía (precio dudoso, IVA sin definir) se usa lo que dice el documento, marcado «por confirmar».
                    const p = o.producto;
                    const neto = c ?? (p?.precio == null ? null : p.iva === 'incluido' ? Math.round(p.precio / 1.19) : p.iva === 'neto' ? p.precio : null);
                    const costeo = linea.costeadoNeto;
                    const dif = neto != null && costeo ? neto - costeo : null;
                    const pct = dif != null && costeo ? Math.round((dif / costeo) * 1000) / 10 : null;
                    return (
                      <dl className="mt-3 rounded-lg bg-zinc-50 px-3 py-2.5 space-y-1.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="text-[13px] text-slate-600">Cotización <span className="text-xs text-slate-500">(neto unit.)</span></dt>
                          <dd className="text-[15px] font-bold tabular-nums text-slate-900">{neto != null ? fmtCLP(neto) : p?.precio != null ? fmtCLP(p.precio) : '—'}</dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="text-[13px] text-slate-600">Costeo</dt>
                          <dd className="text-[15px] font-bold tabular-nums text-slate-900">{fmtCLP(costeo)}</dd>
                        </div>
                        <div className="pt-1.5 border-t border-zinc-200">
                          {dif == null
                            ? <p className="text-[13px] text-amber-800">{p?.precio != null && neto == null ? 'No se puede comparar: la cotización no dice si el precio lleva IVA.' : 'Sin precio para comparar.'}</p>
                            : <p className={`text-[13.5px] font-semibold tabular-nums ${dif < 0 ? 'text-emerald-700' : dif > 0 ? 'text-red-600' : 'text-slate-700'}`}>
                                {dif < 0 ? `Más barato que el costeo: ${fmtCLP(-dif)} menos (${pct}%)` : dif > 0 ? `Más caro que el costeo: ${fmtCLP(dif)} más (+${pct}%)` : 'Igual al costeo'}
                              </p>}
                          {c == null && dif != null && <p className="text-xs text-amber-800">Precio por confirmar: hasta confirmarlo no entra al costo.</p>}
                          {c != null && c === minimo && <p className="text-xs font-medium text-emerald-700">La más barata de la línea</p>}
                        </div>
                      </dl>
                    );
                  })()}
                  <ConversionMoneda p={o.producto} plano />
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                    <div>
                      <dt className={rotulo}>Técnico</dt>
                      <dd className="mt-0.5 text-[13px] text-slate-700">
                        {!r ? (sinRequisitos(o) ? <><span className="font-medium text-slate-700">Sin requisitos técnicos</span><span className="block text-xs text-slate-600">las bases no traen exigencias para esta línea</span></> : <span className="font-medium text-slate-600">{verificando.has(o.id) ? 'Comparando…' : 'Sin comparar'}</span>) : (<>
                          <span className="inline-flex items-center gap-1.5 font-medium"><span aria-hidden className={`w-1.5 h-1.5 rounded-full ${k.no ? 'bg-red-600' : k.falta ? 'bg-amber-500' : k.complementadas ? 'bg-teal-600' : 'bg-emerald-600'}`} />{k.no ? `${k.no} no cumple${k.no === 1 ? '' : 'n'}` : k.falta ? `${k.falta} por confirmar` : k.complementadas ? `${k.complementadas} espera${k.complementadas === 1 ? '' : 'n'} al EM` : 'Cumple todo'}</span>
                          {k.complementadas > 0 && (k.no > 0 || k.falta > 0) && <span className="block text-xs text-teal-700">{k.complementadas} complementado{k.complementadas === 1 ? '' : 's'}, espera{k.complementadas === 1 ? '' : 'n'} al EM</span>}
                          <span className="block text-xs text-slate-600 tabular-nums">{k.cumple} de {k.cumple + k.falta + k.no + k.complementadas} cumplen</span>
                        </>)}
                      </dd>
                    </div>
                  </dl>
                </div>

                {/* 2 · Qué falta para poder firmarla */}
                <div className={`px-4 py-3 ${ancha ? 'border-t md:border-t-0' : 'border-t'} border-zinc-100`}>
                  <p className={rotulo}>Qué falta</p>
                  {nadaFalta && <p className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-medium text-emerald-700"><span aria-hidden className="w-1.5 h-1.5 rounded-full bg-emerald-600" />Nada: lista para firmar</p>}
                  {precioPendiente && (o.producto!.precioAmbiguo
                    ? <PrecioPorConfirmar o={o} editable={editable(o)} ocupado={ocupado === o.id} onAccion={onAccion} />
                    : <p className="mt-1 text-[12.5px] text-amber-700">Precio del documento · {o.producto!.iva === 'no_declarado' ? 'IVA sin definir, aún no hay costo neto' : 'sin verificar'}</p>)}
                  {c != null && o.producto?.ivaSupuesto && <p className="mt-1 text-xs text-slate-500">IVA asumido (página web): ya descontado</p>}
                  {bloqueos.slice(0, 2).map((b, i) => <p key={i} className="mt-1.5 text-[12.5px] text-red-600 leading-snug">{b.mensaje}<span className="block text-red-500/80">→ {b.salida}</span></p>)}
                  {bloqueos.length > 2 && <p className="text-xs text-slate-500">+{bloqueos.length - 2} más en el detalle avanzado</p>}
                  {r && (k.falta > 0 || k.no > 0) && <p className="mt-1.5 text-[12.5px] text-slate-600">{k.no > 0 ? `${k.no} requisito${k.no === 1 ? '' : 's'} no cumple${k.no === 1 ? '' : 'n'}` : `${k.falta} requisito${k.falta === 1 ? '' : 's'} por confirmar`}: revísalos abajo, en «Requisitos de las bases».</p>}
                  {r && k.complementadas > 0 && <p className="mt-1.5 text-[12.5px] text-teal-800">{k.complementadas} requisito{k.complementadas === 1 ? '' : 's'} ya complementado{k.complementadas === 1 ? '' : 's'}: {puedeAprobar ? 'revísalo y acéptalo con «Lo confirmo» (o «Sí cumple…»).' : 'lo revisa el EM.'}</p>}
                  {notas.length > 0 && <ul className="mt-2 space-y-0.5">{notas.map((t, i) => <li key={i} className="text-[12.5px] leading-snug text-slate-600">• {t}</li>)}</ul>}
                  {o.tecnico.legado && <p className="mt-1 text-xs italic text-slate-500">Comparación anterior, hecha antes del comparador nuevo. Se conserva como estaba.</p>}
                </div>

                {/* 3 · Respaldo y acciones */}
                <div className={`px-4 py-3 flex flex-col ${ancha ? 'border-t md:border-t-0' : 'border-t'} border-zinc-100`}>
                  <p className={rotulo}>Respaldo</p>
                  <FuenteTecnica o={o} />
                  {/* De dónde sale el precio: solo si agrega algo (un link con su captura, o varios documentos); con una sola cotización ya está arriba. */}
                  {(o.respaldos.filter(x => x.vigente).length > 1 || o.respaldos.some(x => x.vigente && x.url)) && <FuenteCosto o={o} negocioId={negocioId} />}
                  <div data-no-pdf className="mt-auto pt-3">
                    <Acciones o={o} exigeViaCompleta={linea.exigeViaCompleta} ocupado={ocupado === o.id} puedeAprobar={puedeAprobar} onAccion={onAccion} onModal={onModal} />
                    <div className="flex flex-wrap items-center gap-x-4">
                      <CorregirCosto o={o} editable={editable(o)} ocupado={ocupado === o.id} onAccion={onAccion} />
                      {editable(o) && <BotonSubirFicha ocupado={subiendoFicha.has(`o${o.id}`)} discreto etiqueta={o.respaldos.some(x => x.tipo === 'ficha_tecnica') ? 'Agregar otra ficha técnica' : 'Agregar ficha técnica'} onArchivos={f => onSubirFicha(o.id, f)} />}
                      {editable(o) && <PegarTextoFicha ocupado={subiendoFicha.has(`o${o.id}`)} nombreBase={nombreCorto(o)} onArchivo={f => onSubirFicha(o.id, [f])} />}
                    </div>
                    {editable(o) && !o.respaldos.some(x => x.tipo === 'ficha_tecnica' && x.vigente) && o.respaldos.some(x => x.tipo === 'link_web' && x.vigente) && (
                      <p className="mt-1.5 text-xs text-slate-600">¿La página no trae la ficha? Adjúntala como foto, PDF, Word o Excel, o pega su texto: se compara igual con las bases.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Requisitos: primero lo que falta resolver. Solo lectura: clic en una fila abre su panel ── */}
      {base.length === 0 ? (
        <p className="rounded-xl border border-zinc-200 px-4 py-4 text-center text-[13.5px] text-slate-600">
          {columnas.length && columnas.every(sinRequisitos) ? <>Las bases no traen <b>requisitos técnicos</b> para esta línea: no hay nada que comparar, compite solo por precio. Si sabes que hay exigencias (por ejemplo en un anexo técnico), revisa la viabilidad de la línea.</> : columnas.some(porComparar) ? <>Esta línea todavía no se compara. Pulsa <b>«Comparar la línea»</b> (arriba): la IA revisa cada producto contra los requisitos de las bases.</> : 'Las opciones de esta línea van por vía liviana: no pasan por el comparador técnico.'}
        </p>
      ) : (
        // overflow-clip (no hidden): así el encabezado puede quedar fijo al bajar por la página.
        <div className="rounded-xl border border-zinc-200 overflow-clip">
          <table className="w-full text-[13px] border-collapse table-fixed">
            <thead className="sticky top-0 z-10 bg-zinc-50 shadow-[0_1px_0_0_rgb(228_228_231)]">
              <tr><th colSpan={columnas.length + 1} className="px-4 py-2.5 text-left font-normal">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-slate-600">
                  <span><span className="font-medium text-slate-800">Requisitos de las bases</span> · {base.length}</span>
                  {(() => {
                    const esperan = pendientes.filter(f => gravedad(f.n) === 1.5).length, porResolver = pendientes.length - esperan;
                    return <>
                      <span className={porResolver ? 'font-medium text-amber-700' : 'font-medium text-emerald-700'}>{porResolver ? `${porResolver} por resolver` : 'Nada por resolver'}</span>
                      {esperan > 0 && <span className="font-medium text-teal-700">{esperan} complementado{esperan === 1 ? '' : 's'} · espera{esperan === 1 ? '' : 'n'} al EM</span>}
                    </>;
                  })()}
                  {cumplidos.length > 0 && !imprimirCuadro && !q && !soloDifieren ? (
                    <button data-no-pdf onClick={() => setVerCumplidos(v => !v)} aria-expanded={verCumplidos}
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-white px-2 py-0.5 font-medium text-emerald-700 hover:bg-emerald-50">
                      {verCumplidos ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      {cumplidos.length} cumple{cumplidos.length === 1 ? '' : 'n'} · {verCumplidos ? 'ocultar' : 'ver'}
                    </button>
                  ) : <span>{cumplidos.length} cumple{cumplidos.length === 1 ? '' : 'n'}</span>}
                  {columnas.length > 1 && (
                    <label data-no-pdf className="inline-flex items-center gap-1.5 cursor-pointer text-slate-600">
                      <input type="checkbox" checked={soloDifieren} onChange={e => setSoloDifieren(e.target.checked)} className="accent-teal-700" /> Solo donde las opciones difieren
                    </label>
                  )}
                  {base.length > 15 && (
                    <input data-no-pdf value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar requisito (pantalla, garantía…)"
                      className="ml-auto w-56 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[13px] text-slate-700 outline-none focus:border-teal-500" />
                  )}
                </div>
              </th></tr>
              <tr className="text-left border-t border-zinc-200">
                <th className={`px-4 py-1.5 font-medium text-slate-600 text-xs ${columnas.length === 1 ? "w-[60%]" : columnas.length === 2 ? "w-[46%]" : "w-[34%]"}`}>Requisito <span className="font-normal text-slate-500">· clic para ver el detalle y resolverlo</span></th>
                {columnas.map(o => <th key={o.id} className="px-3 py-1.5 font-medium text-slate-700 text-xs border-l border-zinc-200 truncate" title={nombreCorto(o)}>{nombreCorto(o)}</th>)}
              </tr>
            </thead>
            <tbody className="align-top">
              {filas.map(f0 => (
                <tr key={f0.n} onClick={() => setDetalle(f0.n)} aria-selected={detalle === f0.n}
                  className={`border-t border-zinc-100 cursor-pointer ${detalle === f0.n ? 'bg-teal-50/60' : 'hover:bg-zinc-50'}`}>
                  <td className="px-4 py-2 text-slate-700 leading-snug">
                    <span className="line-clamp-2" title={f0.requeridoTexto}><span className="tabular-nums text-slate-500 mr-1">{f0.n}.</span>{f0.requeridoTexto}</span>
                  </td>
                  {columnas.map(o => <td key={o.id} className="px-3 py-2 border-l border-zinc-100"><CeldaCompacta f={fila(o, f0.n)} respaldos={o.tecnico.respaldosCelda?.[f0.n]?.length ?? 0} /></td>)}
                </tr>
              ))}
              {filas.length === 0 && <tr><td colSpan={columnas.length + 1} className="px-4 py-4 text-center text-[13px] text-slate-600">{q ? `Ningún requisito contiene «${busqueda}».` : 'No hay requisitos en los que las opciones difieran.'}</td></tr>}
            </tbody>
          </table>
          <p className="border-t border-zinc-100 px-4 py-1.5 text-xs text-slate-500">✅ cumple · 🟩 supera lo exigido · ❌ no cumple · ❓ falta dato · 📎 tiene complemento</p>
        </div>
      )}

      {filaDetalle && !imprimirCuadro && (
        <PanelRequisito f0={filaDetalle} posicion={idx >= 0 ? `${idx + 1} de ${recorrido.length}${recorrido === pendientes ? ' por resolver' : ''}` : ''}
          onAnterior={idx > 0 ? () => setDetalle(recorrido[idx - 1].n) : undefined}
          onSiguiente={idx >= 0 && idx < recorrido.length - 1 ? () => setDetalle(recorrido[idx + 1].n) : undefined}
          onCerrar={() => setDetalle(null)}>
          {columnas.map(o => {
            const f = fila(o, filaDetalle.n);
            const n = filaDetalle.n;
            const respaldos = o.tecnico.respaldosCelda?.[n] ?? [];
            const pendiente = !!f && estadoVisible(f) !== 'CUMPLE';
            const parte = f?.partes?.[0];
            return (
              <section key={o.id} className="border-t border-zinc-100 pt-3">
                <p className="text-[13px] font-medium text-slate-800">{nombreCorto(o)} <span className="font-normal text-slate-600">· {o.proveedorRazonSocial || 'proveedor sin identificar'}</span></p>
                {!f ? <p className="mt-1 text-[13px] text-slate-500">Esta opción todavía no se compara.</p> : (<>
                  <div className="mt-1.5 text-[13px]">
                    <CeldaTecnica f={f} editable={editable(o)} puedeEM={puedeAprobar} onConfirmar={(c, motivo) => onAccion(o.id, 'confirmar_celda', { n, confirmada: c, motivo: motivo || '' }, c ? 'Requisito dado por cumplido' : 'Cambio deshecho')}
                      onComplementar={fs => onSubirFicha(o.id, fs)} subiendo={subiendoFicha.has(`o${o.id}`)} />
                  </div>
                  <dl className="mt-2 space-y-1.5 text-[13px]">
                    {parte?.ofertadoValor && <div><dt className="text-xs text-slate-600">Lo que ofrece</dt><dd className="text-slate-800">{parte.ofertadoValor}</dd></div>}
                    {parte?.citaOriginal && <div><dt className="text-xs text-slate-600">Lo que dice el documento</dt><dd className="italic text-slate-700">«{parte.citaOriginal}»</dd></div>}
                    {!!parte?.guardarrailes?.length && <div><dt className="text-xs text-slate-600">Ojo</dt><dd className="text-amber-700">{parte.guardarrailes.join(' · ')}</dd></div>}
                    {pendiente && f.rutaCierre && !respaldos.length && <div><dt className="text-xs text-slate-600">Cómo se cierra</dt><dd className="text-slate-700">{f.rutaCierre}</dd></div>}
                  </dl>
                  {respaldos.length > 0 && (
                    <div className={`mt-3 rounded-lg px-3 py-2.5 ${pendiente ? 'border border-teal-200 bg-teal-50/60' : 'border border-zinc-200'}`}>
                      {pendiente && (() => {
                        const ultimo = respaldos[respaldos.length - 1];
                        const cuando = ultimo.at ? new Date(ultimo.at.replace(' ', 'T')).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : '';
                        return <p className="text-[13px] font-medium text-teal-800">📎 Complementado por {ultimo.por || 'el asistente'}{cuando ? ` · ${cuando}` : ''}
                          <span className="block text-xs font-normal text-slate-600">{puedeAprobar ? 'Revisa el complemento y, si corresponde, acéptalo con «Lo confirmo» (o «Sí cumple…») más arriba.' : 'Queda esperando al EM: él lo revisa y lo acepta.'}</span></p>;
                      })()}
                      {!pendiente && <p className="text-xs text-slate-600">Complementos</p>}
                      <RespaldosCelda respaldos={respaldos} editable={editable(o)} subiendo={false} sinSubir onSubir={() => {}} onQuitar={r => onAccion(o.id, 'respaldar_celda', { n, url: r.url, nombre: r.nombre, quitar: true }, 'Complemento quitado')} />
                    </div>
                  )}
                  {pendiente && editable(o) && (respaldos.length > 0
                    ? <details className="mt-2"><summary className="cursor-pointer text-[13px] font-medium text-teal-700 hover:underline">＋ Agregar otro complemento</summary>
                        <ComplementoRequisito ocupado={subiendoFicha.has(`r${o.id}-${n}`)} onEnviar={(archivos, nota) => onRespaldarCelda(o.id, n, archivos, nota)} /></details>
                    : <ComplementoRequisito ocupado={subiendoFicha.has(`r${o.id}-${n}`)} onEnviar={(archivos, nota) => onRespaldarCelda(o.id, n, archivos, nota)} />)}
                </>)}
              </section>
            );
          })}
        </PanelRequisito>
      )}

      {descartadas.length > 0 && (
        <details data-no-pdf>
          <summary className="cursor-pointer text-[12.5px] text-slate-500 hover:text-zinc-700">{descartadas.length} opción{descartadas.length === 1 ? '' : 'es'} descartada{descartadas.length === 1 ? '' : 's'}</summary>
          <ul className="mt-1 space-y-1">
            {descartadas.map(o => (
              <li key={o.id} className="flex items-center gap-2 text-[12.5px] text-slate-600">
                <span>{o_nombre(o)}{o.motivoDescarte ? ` — ${o.motivoDescarte}` : ''}</span>
                <button onClick={() => onAccion(o.id, 'restaurar', {}, 'Opción restaurada')} className="px-2 py-0.5 rounded-md border border-zinc-200 text-zinc-600 font-semibold hover:bg-zinc-50">Restaurar</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Estado de una celda tal como se ve: confirmada a mano = cumple; «supera lo exigido» cuenta como cumple. */
function estadoVisible(f: any): 'NO_CUMPLE' | 'FALTA_DATO' | 'CUMPLE' | null {
  if (!f) return null;
  if (f.confirmada) return 'CUMPLE';
  const e = f.estadoCelda ?? (f.veredicto === 'NO_CUMPLE' ? 'NO_CUMPLE' : f.veredicto === 'SIN_VEREDICTO' ? 'FALTA_DATO' : 'CUMPLE');
  return e === 'NO_CUMPLE' || e === 'FALTA_DATO' ? e : 'CUMPLE';
}

/** Celda de la tabla, solo para leer: el estado y el dato ofertado. Las acciones viven en el panel del requisito. */
function CeldaCompacta({ f, respaldos }: { f: any; respaldos: number }) {
  if (!f) return <span className="text-zinc-300">—</span>;
  const e = estadoVisible(f);
  // ❓/❌ con complemento del asistente: ya no es «falta dato», está en manos del EM.
  if (e !== 'CUMPLE' && respaldos > 0) return (
    <span className="text-[13px] font-medium text-teal-700">📎 Complementado <span className="font-normal text-slate-600">· espera al EM</span>
      {e === 'NO_CUMPLE' && <span className="block text-xs font-normal text-red-600">la IA lo marcó como «no cumple»</span>}</span>
  );
  const dato = f.valorCorto && !f.confirmada ? f.valorCorto : '';
  const clip = respaldos > 0 ? <span title={`${respaldos} complemento${respaldos === 1 ? '' : 's'}`} className="ml-1.5 text-xs text-slate-600">📎{respaldos}</span> : null;
  if (f.confirmada) return <span className="text-[13px] text-emerald-700">✅ <span className="text-slate-600">confirmado por {f.confirmada.por || 'el asistente'}</span>{clip}</span>;
  if (e === 'NO_CUMPLE') return <span className="text-[13px] font-medium text-red-600">❌ No cumple{dato && <span className="font-normal"> ({dato})</span>}{clip}</span>;
  if (e === 'FALTA_DATO') return <span className="text-[13px] font-medium text-amber-700">❓ Falta dato{f.rojo && <span className="font-normal text-slate-600"> · lo aprueba el EM</span>}{clip}</span>;
  return <span className="text-[13px] text-slate-600">{f.sobrecumple || f.estadoCelda === 'SOBRECUMPLE' ? '🟩' : '✅'}{dato && <> ({dato})</>}{f.revisar && <span title="Número sin unidad que no calza con lo exigido: revisa el dato." className="ml-1 text-amber-600">⚠</span>}{clip}</span>;
}

/** Panel lateral de UN requisito: texto completo de la base, la cita del documento por opción y las acciones. No tapa la tabla (sin fondo oscuro), se recorre con Anterior/Siguiente. */
function PanelRequisito({ f0, posicion, onAnterior, onSiguiente, onCerrar, children }: {
  f0: { n: number; requeridoTexto: string; fuenteBases?: string; criticidad?: string; rojo?: boolean }; posicion: string;
  onAnterior?: () => void; onSiguiente?: () => void; onCerrar: () => void; children: React.ReactNode;
}) {
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onCerrar]);
  const btn = 'px-2.5 py-1 rounded-md border border-zinc-200 text-[13px] font-medium text-slate-700 hover:bg-zinc-50 disabled:opacity-40';
  return (
    <aside data-no-pdf role="dialog" aria-label={`Requisito ${f0.n}`}
      className="fixed inset-y-0 right-0 z-50 w-full sm:w-[460px] bg-white border-l border-zinc-200 shadow-xl flex flex-col">
      <div className="px-5 py-3 border-b border-zinc-200 flex items-center gap-2">
        <p className="text-[13px] text-slate-600">Requisito {f0.n}{posicion ? ` · ${posicion}` : ''}</p>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={onAnterior} disabled={!onAnterior} className={btn}>‹ Anterior</button>
          <button onClick={onSiguiente} disabled={!onSiguiente} className={btn}>Siguiente ›</button>
          <button onClick={onCerrar} title="Cerrar (Esc)" className="ml-1 px-2 py-1 text-slate-500 hover:text-slate-700">✕</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        <div>
          <p className="text-[13.5px] leading-snug text-slate-900">{f0.requeridoTexto}</p>
          <p className="mt-1 text-xs text-slate-600">
            {f0.rojo ? <span className="font-medium text-red-600">Puede dejarnos fuera de la licitación</span> : f0.criticidad ? f0.criticidad.toLowerCase().replace(/_/g, ' ') : ''}
            {f0.fuenteBases ? `${f0.rojo || f0.criticidad ? ' · ' : ''}${f0.fuenteBases}` : ''}
          </p>
        </div>
        {children}
      </div>
    </aside>
  );
}

/** Complementar un requisito con texto, con archivo o con ambos (el asistente explica lo que sabe y/o adjunta el respaldo). No lo cierra: lo revisa el EM. */
function ComplementoRequisito({ ocupado, onEnviar }: { ocupado: boolean; onEnviar: (archivos: File[], nota: string) => Promise<boolean> }) {
  const [nota, setNota] = useState('');
  const [archivos, setArchivos] = useState<File[]>([]);
  const ref = useRef<HTMLInputElement>(null);
  const puede = !ocupado && (archivos.length > 0 || nota.trim().length >= 8);
  const enviar = async () => { if (await onEnviar(archivos, nota.trim())) { setNota(''); setArchivos([]); } };
  return (
    <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
      <p className="text-[13px] font-medium text-slate-700">Complementar</p>
      <p className="text-xs text-slate-600">Escribe lo que sabes, adjunta el respaldo, o ambos. No cierra el requisito: lo revisa el EM.</p>
      <textarea value={nota} onChange={e => setNota(e.target.value)} rows={3}
        placeholder="Ej.: el proveedor confirmó por correo que trae Wi-Fi 6 y pantalla de 1.000 nits"
        className="mt-2 w-full rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-700 outline-none focus:border-teal-500" />
      <input ref={ref} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx" multiple className="hidden"
        onChange={e => { if (e.target.files?.length) setArchivos(prev => [...prev, ...Array.from(e.target.files!)]); e.target.value = ''; }} />
      {archivos.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {archivos.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-1.5 text-[12.5px] text-slate-600">
              <Clip size={11} className="text-slate-500" /><span className="truncate max-w-[260px]">{f.name}</span>
              <button onClick={() => setArchivos(prev => prev.filter((_, j) => j !== i))} className="text-xs text-slate-500 underline hover:text-slate-700">quitar</button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex items-center gap-3">
        <button onClick={() => ref.current?.click()} disabled={ocupado} className="flex items-center gap-1 text-[13px] font-medium text-slate-600 hover:text-slate-900 hover:underline disabled:opacity-50"><Clip size={12} /> Adjuntar archivo</button>
        <button onClick={enviar} disabled={!puede} className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-md bg-teal-700 text-white text-[13px] font-semibold hover:bg-teal-800 disabled:opacity-40">
          {ocupado ? <><Loader2 size={12} className="animate-spin" /> Guardando…</> : 'Agregar al requisito'}
        </button>
      </div>
    </div>
  );
}

const o_nombre = (o: OpcionDTO) => [o.proveedorRazonSocial, [o.marca, o.modelo].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || `Opción #${o.id}`;

function Fila({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return <tr className="border-t border-zinc-100"><td className="pr-3 py-1.5 text-xs uppercase tracking-wide text-slate-500 font-bold align-top">{etiqueta}</td>{children}</tr>;
}

/** Vía completa y las bases no traen requisitos técnicos para su línea: no hay nada que comparar (compite solo por precio). */
function sinRequisitos(o: OpcionDTO): boolean { return o.via === 'completa' && o.tecnico.estado === 'SIN_REQUISITOS'; }
/** Falta correr el comparador: vía completa, con requisitos, y sin resultado todavía. */
function porComparar(o: OpcionDTO): boolean { return o.via === 'completa' && o.tecnico.requisitosTotal > 0 && !o.tecnico.resultado; }

/** La opción ya se comparó y no está descartada por técnica, pero su costo no entra porque falta confirmar el precio o el IVA del documento. */
function precioPendiente(o: OpcionDTO): boolean {
  return o.estado !== 'descartada' && !!o.tecnico.resultado && o.tecnico.resultado.estado !== 'NO_CUMPLE'
    && o.verificacion?.costoNetoUnitario == null && o.producto?.precio != null;
}

/** Por qué todavía no se puede firmar esta opción (en lenguaje simple), o null si se puede. */
function motivoNoFirmable(o: OpcionDTO): string | null {
  const v = o.verificacion, t = o.tecnico;
  if (v?.bloqueos.some(b => b.codigo === 'LECTURA')) return 'falta confirmar el precio: el número del documento se leyó dudoso (mira la fila «Costo unit. neto»)';
  if ((v?.bloqueos.length ?? 0) > 0) return `el costo tiene ${v!.bloqueos.length === 1 ? '1 problema' : `${v!.bloqueos.length} problemas`} por resolver (mira la fila «Costo»)`;
  if (t.estado === 'NO_CORRIDO') return 'Falta comparar la línea';
  if (t.resultado?.bloqueos.length) return t.resultado.estado === 'NO_CUMPLE' ? 'No cumple un requisito' : 'Falta confirmar un ❓ o pedir el dato al proveedor';
  if (o.estado !== 'verificada' && v?.veredicto !== 'REQUIERE_HABILITACION') return 'Todavía no está verificada';
  return null;
}

function Acciones({ o, exigeViaCompleta, ocupado, puedeAprobar, onAccion, onModal, modo = 'principal' }: {
  o: OpcionDTO; exigeViaCompleta: boolean; ocupado: boolean; puedeAprobar: boolean;
  onAccion: (opcionId: number, accion: string, extra?: Record<string, unknown>, ok?: string) => void;
  onModal: (tipo: 'descartar' | 'rechazar', opcionId: number) => void;
  /** 'via' = solo el selector de vía (vive en el detalle avanzado); 'principal' = firmar, aprobar, descartar… */
  modo?: 'principal' | 'via';
}) {
  const btn = 'px-2.5 py-1 rounded-md text-[12.5px] font-semibold disabled:opacity-40';
  if (ocupado) return <Loader2 size={14} className="animate-spin text-slate-500" />;
  const viaEditable = !['descartada', 'aprobada', 'en_aprobacion', 'definitiva'].includes(o.estado);
  if (modo === 'via') return viaEditable ? (
    <select value={o.via} onChange={e => onAccion(o.id, 'cambiar_via', { via: e.target.value })}
      title={exigeViaCompleta ? 'Esta línea tiene exigencias que pueden dejarnos fuera: requiere verificación completa.' : 'Vía de verificación de esta opción'}
      className="text-xs border border-zinc-200 rounded-md px-1.5 py-1 bg-white text-zinc-600">
      <option value="completa">Vía completa</option>
      <option value="liviana" disabled={exigeViaCompleta}>Vía liviana{exigeViaCompleta ? ' (no permitida)' : ''}</option>
    </select>
  ) : <span className="text-slate-500">{o.via === 'liviana' ? 'Liviana' : 'Completa'}</span>;
  const motivo = ['tanteo', 'formalizada', 'verificada'].includes(o.estado) ? motivoNoFirmable(o) : null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {o.estado === 'descartada' && <button className={`${btn} border border-zinc-200 text-zinc-600`} onClick={() => onAccion(o.id, 'restaurar')}>Restaurar</button>}
      {['tanteo', 'formalizada', 'verificada'].includes(o.estado) && (
        <button className={`${btn} bg-teal-700 text-white hover:bg-teal-800`} disabled={!!motivo}
          title={motivo ?? 'Firmar como la opción a ofertar'} onClick={() => onAccion(o.id, 'firmar', {}, 'Opción firmada como definitiva')}>Firmar esta opción</button>
      )}
      {o.estado === 'definitiva' && <>
        <button className={`${btn} bg-amber-600 text-white hover:bg-amber-700`} onClick={() => onAccion(o.id, 'solicitar_aprobacion', {}, 'Pasada final correcta: en aprobación')}>Solicitar aprobación</button>
        <button className={`${btn} border border-zinc-200 text-zinc-600`} onClick={() => onAccion(o.id, 'quitar_firma')}>Quitar firma</button>
      </>}
      {o.estado === 'en_aprobacion' && puedeAprobar && <>
        <button className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`} onClick={() => onAccion(o.id, 'aprobar', {}, 'Opción aprobada')}>Aprobar</button>
        <button className={`${btn} border border-red-200 text-red-600`} onClick={() => onModal('rechazar', o.id)}>Rechazar</button>
      </>}
      {o.estado === 'en_aprobacion' && !puedeAprobar && <span className="text-[12.5px] text-amber-700">Esperando al EM</span>}
      {o.estado === 'aprobada' && <span className="text-[12.5px] text-emerald-700 font-semibold">✓ Aprobada</span>}
      {!['descartada', 'aprobada', 'en_aprobacion'].includes(o.estado) && <button className={`${btn} border border-zinc-200 text-slate-600 hover:text-red-600`} onClick={() => onModal('descartar', o.id)}>Descartar</button>}
      {motivo && <p className="w-full text-xs text-slate-500">Aún no se puede firmar: {motivo.charAt(0).toLowerCase()}{motivo.slice(1)}</p>}
      {o.firmadaPorNombre && <p className="w-full text-xs text-slate-500">Firmada por {o.firmadaPorNombre}</p>}
    </div>
  );
}
