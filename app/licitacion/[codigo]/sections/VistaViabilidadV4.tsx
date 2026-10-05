'use client';

// VISTA v4.0 + NIVEL DE ATRACTIVO v4.1 (02-oct-2026) — informes con `_schema: 'v4'`.
//
// Encabezado: NIVEL (MUY ALTO…EXCLUIDO), la ACCIÓN del asistente (Sigue / Consulta a CA / Suelta /
// Revisa la salida / Confirma el dato) y una línea con el porqué en lenguaje comercial. Sin
// número 0-100 ni GANABLE/NO VAMOS: el nivel lo calcula el código (score-viabilidad.ts). Si un dato
// clave quedó dudoso, el asistente lo confirma acá y el nivel se recalcula (sin IA).
//
// Pestañas (especificación 1, §6.4): Cómo ganar · Admisibilidad (antes "Riesgos": solo lo que deja
// fuera, contador del código, firma en 4 estados, causales sin analizar en ámbar) · Plazos y multa
// (hitos en su unidad original + total, inicio del plazo de entrega, multa en $/día) · Productos
// (lista única, "N de N", selector de líneas con su presupuesto y nivel) · Preparación (3 grupos).
// Cada dato con su cita: el ojo abre la página que calculó el código y resalta la FRASE exacta; si
// la frase no se encontró en las bases, la cita se ve en ámbar "no verificada".

import { useContext, useMemo, useState, Fragment } from 'react';
import { IconAlertTriangle as AlertTriangle, IconBan as Ban, IconShieldCheck as ShieldCheck, IconPackage as Package, IconScale as Scale, IconGavel as Gavel, IconTarget as Target, IconListCheck as ListChecks, IconClipboardCheck as ClipboardCheck, IconCompass as Compass, IconEye as Eye, IconFileSearch as FileSearch, IconChevronDown as ChevronDown, IconLoader2 as Loader2, IconCheck as Check, IconHelpCircle as HelpCircle, IconClock as Clock } from '@tabler/icons-react';
import { useSession } from '@/app/lib/session-context';
import { FuenteDocsContext, VisorContext, Seccion, PanelValidador, HintOjo, BotonBuscarEquipo } from './viabilidad-ui-comun';

const fmt = (n?: number | null) => n != null && Number.isFinite(Number(n)) ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(n)) : '—';
const cap = (s?: string) => (s || '').replace(/_/g, ' ');
const _norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ─── Nivel y acción ────────────────────────────────────────────────────────────────────────
const NIVEL_VISTA: Record<string, { label: string; cls: string; soft: string; tip: string }> = {
  MUY_ALTO:   { label: 'MUY ALTO',   cls: 'bg-emerald-600', soft: 'bg-emerald-50 border-emerald-200', tip: 'Proyecto muy atractivo para nosotros.' },
  ALTO:       { label: 'ALTO',       cls: 'bg-emerald-500', soft: 'bg-emerald-50 border-emerald-200', tip: 'Proyecto atractivo.' },
  MEDIO_ALTO: { label: 'MEDIO ALTO', cls: 'bg-yellow-500',  soft: 'bg-yellow-50 border-yellow-200',   tip: 'Atractivo con condiciones: consulta a CA.' },
  MEDIO:      { label: 'MEDIO',      cls: 'bg-yellow-500',  soft: 'bg-yellow-50 border-yellow-200',   tip: 'Atractivo medio: consulta a CA.' },
  MEDIO_BAJO: { label: 'MEDIO BAJO', cls: 'bg-orange-500',  soft: 'bg-orange-50 border-orange-200',   tip: 'Poco atractivo o servicio: consulta a CA.' },
  BAJO:       { label: 'BAJO',       cls: 'bg-red-500',     soft: 'bg-red-50 border-red-200',         tip: 'Poco atractivo: suelta el proyecto.' },
  EXCLUIDO:   { label: 'EXCLUIDO',   cls: 'bg-red-700',     soft: 'bg-red-50 border-red-300',         tip: 'Un filtro duro deja el proyecto fuera.' },
};
const ACCION_VISTA: Record<string, { cls: string; icon: React.ReactNode }> = {
  SEGUIR:         { cls: 'text-emerald-800 bg-emerald-100 border-emerald-300', icon: <Check size={15} /> },
  CONSULTAR_CA:   { cls: 'text-yellow-800 bg-yellow-100 border-yellow-300',   icon: <HelpCircle size={15} /> },
  SOLTAR:         { cls: 'text-red-800 bg-red-100 border-red-300',            icon: <Ban size={15} /> },
  REVISAR_SALIDA: { cls: 'text-orange-800 bg-orange-100 border-orange-300',   icon: <Compass size={15} /> },
  CONFIRMAR_DATO: { cls: 'text-sky-800 bg-sky-100 border-sky-300',            icon: <Eye size={15} /> },
};

const CLASE_BADGE: Record<string, { label: string; cls: string; tip: string }> = {
  LEY_DEL_MINIMO: { label: '⭐ LEY DEL MÍNIMO', cls: 'bg-emerald-100 text-emerald-700', tip: 'Gana quien oferte el valor más BAJO: cada unidad de mejora suma puntaje.' },
  LEY_DEL_MAXIMO: { label: '⭐ LEY DEL MÁXIMO', cls: 'bg-emerald-100 text-emerald-700', tip: 'Gana quien oferte el valor más ALTO: cada unidad de mejora suma puntaje.' },
  POR_TRAMOS:     { label: 'POR TRAMOS',       cls: 'bg-slate-100 text-slate-500',     tip: 'El puntaje va por rangos: basta con quedar en el mejor tramo.' },
  ACUMULATIVO:    { label: 'ACUMULATIVO',      cls: 'bg-indigo-50 text-indigo-600',    tip: 'Suma puntos por cada requisito que se cumple: cumple el máximo posible.' },
  BINARIO:        { label: 'BINARIO',          cls: 'bg-indigo-50 text-indigo-600',    tip: 'Se cumple o no se cumple: no hay puntaje intermedio.' },
};
const JUGADA_ICON: Record<string, string> = { OPORTUNIDAD: '🟢', RESOLVER: '🟡', EMPATE: '⚪', EN_CONTRA: '🔴' };
const FIRMA_VISTA: Record<string, { icono: string; titulo: string; accion: string }> = {
  ESCANEADA_BASTA:            { icono: '🟢', titulo: 'Basta firma escaneada', accion: 'Pega la imagen de la firma.' },
  MANO_Y_ESCANEO:             { icono: '🟡', titulo: 'Firma a mano y escanea', accion: 'Imprime, firma a mano y escanea.' },
  ORIGINAL_NOTARIAL:          { icono: '🔴', titulo: 'Original o notarial', accion: 'Requiere gestión presencial.' },
  FIRMA_ELECTRONICA_AVANZADA: { icono: '🔴', titulo: 'Firma electrónica avanzada', accion: 'Requiere token de firma electrónica avanzada.' },
};
const HITO_LABEL: Record<string, string> = {
  GARANTIA_FIEL_CUMPLIMIENTO: 'Garantía de fiel cumplimiento',
  FIRMA_CONTRATO_PROVEEDOR: 'Firma del contrato (nosotros)',
  FIRMA_CONTRATO_ORGANISMO: 'Firma o tramitación del contrato (organismo)',
  EMISION_OC: 'Emisión de la orden de compra',
  ACEPTACION_OC: 'Aceptación de la orden de compra',
};
const PERIODO: Record<string, string> = { DIA_HABIL: 'día hábil', DIA_CORRIDO: 'día corrido' };
// "0,1 %", "2 UF", "$50.000": la multa tal cual las bases, con su unidad legible.
function valorMulta(a: any): string {
  const u = String(a?.unidad || '').toUpperCase();
  const v = String(a?.valor ?? '').replace(/\s*%$/, '');
  return u === 'PORCENTAJE' ? `${v} %` : u === 'PESOS' ? `$${v}` : `${v} ${u}`.trim();
}
const EVIDENCIA_TEXTO: Record<string, string> = {
  COTIZAR_TOTALIDAD: 'obliga a ofertar todas las líneas', ADJUDICA_GLOBAL: 'se adjudica todo a un solo oferente',
  ADJUDICA_POR_LINEA: 'se adjudica por línea', TOTAL_O_PARCIAL: 'puede adjudicar total o parcialmente',
  OFERTA_POR_BIEN: 'se puede ofertar uno o más bienes por separado', DESIERTA_POR_LINEA: 'una línea puede quedar desierta',
  PRESUPUESTO_POR_LINEA: 'cada línea tiene su propio presupuesto', SUMA_ALZADA: 'contrato a suma alzada (tipo de precio)',
  FORMULARIO_TOTAL: 'el formulario pide un total', FORMULARIO_POR_LINEA: 'el formulario pide precio por línea',
  FORMULARIOS_SEPARADOS: 'un formulario económico por línea', EVALUACION_POR_ITEM: 'se evalúa por línea',
  GARANTIA_O_PLAZO_POR_LINEA: 'garantía o plazo por línea',
};

// ─── Cita estructurada {documento, numeral, frase} + página calculada por el código ─────────
function Cita({ cita, etiqueta }: { cita?: any; etiqueta?: string }) {
  const docs = useContext(FuenteDocsContext);
  const abrirVisor = useContext(VisorContext);
  if (!cita || typeof cita !== 'object') return null;
  const nombreDoc = String(cita.documento_real || cita.documento || '');
  const frase = String(cita.frase || '').trim();
  if (!nombreDoc && !frase) return null;
  const pagina: number | null = cita.pagina ?? cita.pagina_aprox ?? null;
  const doc = docs.find(d => d.nombre === nombreDoc)
    ?? docs.find(d => { const a = _norm(d.nombre), b = _norm(nombreDoc); return !!b && (a.includes(b) || b.includes(a)); });
  const noVerificada = cita.verificada === false || cita.semantica === 'NO' || cita.semantica === 'PARCIAL';
  const texto = [nombreDoc, cita.numeral, pagina ? `pág. ${pagina}${cita.pagina == null && cita.pagina_aprox ? ' aprox.' : ''}` : ''].filter(Boolean).join(' · ');
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] ${noVerificada ? 'text-amber-700' : 'text-indigo-600'}`}>
      {etiqueta && <span className="text-slate-400">{etiqueta}</span>}
      {doc
        ? <a href={pagina ? `${doc.url}#page=${pagina}` : doc.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline"><FileSearch size={10} />{texto || 'ver documento'}</a>
        : <span className="inline-flex items-center gap-1"><FileSearch size={10} />{texto}</span>}
      {doc && pagina && abrirVisor && (
        <button type="button" onClick={() => abrirVisor({ url: doc.url, pagina, paginas: [pagina], q: frase || undefined, titulo: texto })}
          title="Ver la página y resaltar la frase" className="inline-flex items-center text-violet-500 hover:text-violet-700"><Eye size={13} /></button>
      )}
      {noVerificada && (
        <span className="text-[10px] font-bold px-1 py-px rounded bg-amber-100 text-amber-700 cursor-help"
          title={cita.verificada === false ? 'La frase citada no se encontró en las bases: confírmala antes de usar el dato.' : `La frase existe, pero no sostiene el dato${cita.motivo_semantica ? `: ${cita.motivo_semantica}` : ''}.`}>
          no verificado
        </span>
      )}
    </span>
  );
}

function FraseCitada({ cita }: { cita?: any }) {
  const f = String(cita?.frase || '').trim();
  if (!f) return null;
  return <p className="text-[11.5px] text-slate-500 italic mt-0.5 leading-snug">“{f.length > 220 ? f.slice(0, 220) + '…' : f}”</p>;
}

// ─── Confirmación de datos dudosos (recalcula el nivel en el servidor, sin IA) ───────────────
function DatosDudosos({ codigo, score, adjudicacion, onCambio }: { codigo: string; score: any; adjudicacion: any; onCambio: (score: any, adj: any) => void }) {
  const [enviando, setEnviando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dudosos: any[] = Array.isArray(score?.datos_dudosos) ? score.datos_dudosos : [];
  if (!dudosos.length) return null;
  const confirmar = async (clave: string, valor?: string) => {
    setEnviando(clave + (valor || '')); setError(null);
    try {
      const r = await fetch(`/api/licitacion-viabilidad-ia/${encodeURIComponent(codigo)}/nivel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'confirmar', clave, valor }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error || 'No se pudo confirmar.'); return; }
      onCambio(j.score, j.adjudicacion);
    } catch (e: any) { setError(String(e?.message || e)); }
    finally { setEnviando(null); }
  };
  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3 space-y-2">
      <p className="text-[12.5px] font-semibold text-sky-900 flex items-center gap-1.5"><Eye size={14} /> Antes de decidir, confirma en el visor:</p>
      {dudosos.map((d: any) => (
        <div key={d.clave} className="bg-white rounded-lg border border-sky-100 p-2.5">
          <p className="text-[12.5px] text-slate-700"><strong>{String(d.dato || '').charAt(0).toUpperCase() + String(d.dato || '').slice(1)}</strong> — {d.razon}.</p>
          {d.clave === 'adjudicacion' && adjudicacion?.pregunta_foro && (
            <p className="text-[11.5px] text-slate-500 mt-0.5">Si las bases no lo aclaran, pregunta en el foro: <em>“{adjudicacion.pregunta_foro}”</em></p>
          )}
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {d.clave === 'adjudicacion' ? (<>
              <button disabled={!!enviando} onClick={() => confirmar('adjudicacion', 'GLOBAL')} className="text-[11.5px] font-semibold px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:border-sky-400 disabled:opacity-50">
                {enviando === 'adjudicacionGLOBAL' ? <Loader2 size={12} className="inline animate-spin" /> : null} Es global (todo a un proveedor)
              </button>
              <button disabled={!!enviando} onClick={() => confirmar('adjudicacion', 'POR_LINEAS')} className="text-[11.5px] font-semibold px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:border-sky-400 disabled:opacity-50">
                {enviando === 'adjudicacionPOR_LINEAS' ? <Loader2 size={12} className="inline animate-spin" /> : null} Es por línea (se puede repartir)
              </button>
            </>) : (
              <button disabled={!!enviando} onClick={() => confirmar(d.clave)} className="text-[11.5px] font-semibold px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:border-sky-400 disabled:opacity-50">
                {enviando === d.clave ? <Loader2 size={12} className="inline animate-spin" /> : <Check size={12} className="inline" />} Lo revisé en las bases: está bien
              </button>
            )}
          </div>
        </div>
      ))}
      <p className="text-[11px] text-sky-700">Si no logras confirmarlo, consulta a CA.</p>
      {error && <p className="text-[11.5px] text-red-600">{error}</p>}
    </div>
  );
}

// ─── Vista principal ───────────────────────────────────────────────────────────────────────
export function VistaV4({ informe, codigo, feedbackPanel, onInformeCambio }: { informe: any; codigo: string; feedbackPanel?: React.ReactNode; onInformeCambio?: (inf: any) => void }) {
  const { usuario } = useSession();
  const [tab, setTab] = useState<'ganar' | 'admisibilidad' | 'plazos' | 'productos' | 'preparacion'>('ganar');
  const [verDesglose, setVerDesglose] = useState(false);
  const [lineaSel, setLineaSel] = useState<string>('todas');

  const s = informe.score || {};
  const nv = NIVEL_VISTA[s.nivel] || NIVEL_VISTA.MEDIO;
  const accion = ACCION_VISTA[s.accion_asistente] || ACCION_VISTA.CONSULTAR_CA;
  const t = informe.tarjeta_decision || {};
  const enRevision = informe.veredicto?.estado_veredicto === 'REVISION_HUMANA';
  const pres = informe.presupuesto || {};
  const adj = informe.adjudicacion || {};
  const adm = informe.requisitos_admisibilidad || {};
  const plz = informe.plazos || {};
  const pp = plz.plazo_previo || null;
  const atraso = informe.multas?.atraso || null;
  const crit = informe.criterios_evaluacion || {};
  const criterios: any[] = Array.isArray(crit.criterios) ? crit.criterios : [];
  const est = informe.estrategia || {};
  const dsd = est.donde_se_decide || {};
  const acc = informe.acciones_y_advertencias || {};
  const prod = informe.productos || {};
  const items: any[] = useMemo(() => (Array.isArray(prod.items) ? prod.items : []), [prod.items]);
  const requisitos: any[] = Array.isArray(adm.requisitos) ? adm.requisitos : [];
  const causalesSin: any[] = Array.isArray(adm.posibles_causales_sin_analizar) ? adm.posibles_causales_sin_analizar : [];
  const lineasNivel: any[] = Array.isArray(s.lineas) ? s.lineas : [];
  const porLineaPres: any[] = Array.isArray(pres.por_linea_interpretado) ? pres.por_linea_interpretado : [];
  const garantias = adm.garantias || {};
  const firma = FIRMA_VISTA[String(adm.firma?.estado || '').toUpperCase()];
  const documentosSol: any[] = Array.isArray(adm.documentos_solicitados) ? adm.documentos_solicitados : [];
  const anexosOrg = documentosSol.filter(d => d?.anexo_del_organismo);
  const docsEmpresa = documentosSol.filter(d => !d?.anexo_del_organismo);
  const aCrear: any[] = Array.isArray(adm.documentos_a_crear) ? adm.documentos_a_crear : [];
  const esCA = usuario?.rol === 'admin';
  const evidenciasValidas: any[] = (Array.isArray(adj.evidencias) ? adj.evidencias : []).filter((e: any) => e?.cuenta);
  const evidenciaPrincipal = evidenciasValidas.find((e: any) => e?.cita?.frase) || null;
  const lineas = useMemo(() => [...new Set(items.map(it => String(it?.linea || 'L1')))].sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, ''))), [items]);
  // En una licitación GLOBAL (suma alzada) L1..Ln son solo el N° de cada producto en las bases: no son líneas que se coticen aparte, así que no se ofrecen como filtro.
  const esGlobal = String(informe.modalidad?.tipo || '').toLowerCase() === 'suma_alzada';
  const itemsVista = lineaSel === 'todas' || esGlobal ? items : items.filter(it => String(it?.linea) === lineaSel);
  const conteo = prod.conteo_cruzado;
  const nAdm = Number(adm.conteo ?? requisitos.length) || 0;

  const cambioNivel = (score: any, adjudicacion: any) => {
    onInformeCambio?.({ ...informe, score, ...(adjudicacion ? { adjudicacion } : {}) });
  };

  const tabs: Array<{ id: typeof tab; label: string; icon: React.ReactNode; badge?: string; badgeRojo?: boolean }> = [
    { id: 'ganar', label: 'Cómo ganar', icon: <Target size={14} /> },
    { id: 'admisibilidad', label: 'Admisibilidad', icon: <ShieldCheck size={14} />, badge: nAdm || causalesSin.length ? String(nAdm) + (causalesSin.length ? ` +${causalesSin.length}` : '') : undefined, badgeRojo: nAdm > 0 },
    { id: 'plazos', label: 'Plazos y multa', icon: <Clock size={14} /> },
    { id: 'productos', label: 'Productos', icon: <Package size={14} />, badge: items.length ? String(items.length) : undefined },
    { id: 'preparacion', label: 'Preparación', icon: <ClipboardCheck size={14} /> },
  ];

  return (
    <div className="space-y-3">
      {/* ── ENCABEZADO: nivel + acción + porqué ── */}
      <div className={`rounded-2xl border p-4 ${nv.soft}`}>
        <div className="flex items-start gap-3 flex-wrap">
          <span title={nv.tip} className={`text-[15px] font-black text-white px-3 py-1.5 rounded-lg cursor-help ${nv.cls}`}>{nv.label}</span>
          <span className={`inline-flex items-center gap-1.5 text-[13.5px] font-bold px-3 py-1.5 rounded-lg border ${accion.cls}`}>{accion.icon} {s.accion_texto || '—'}</span>
          <span title={enRevision ? 'Una persona debe revisar el informe antes de decidir' : 'Análisis firme'}
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border self-center cursor-help ${enRevision ? 'bg-amber-100 text-amber-700 border-amber-300' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>{enRevision ? 'REVISIÓN HUMANA' : 'DEFINITIVO'}</span>
        </div>
        {s.resumen_pantalla && <p className="text-[14px] font-semibold text-slate-800 mt-2 leading-snug">{String(s.resumen_pantalla).replace(/^[A-ZÁÉÍÓÚ ]+ · /, '')}</p>}
        {s.motivo_exclusion && (
          <div className="mt-2 text-[12.5px] text-red-800 bg-white/70 border border-red-200 rounded-lg p-2">
            <p><strong>Motivo:</strong> {s.motivo_exclusion.texto}</p>
            <FraseCitada cita={s.motivo_exclusion.cita} />
            <Cita cita={s.motivo_exclusion.cita} />
          </div>
        )}
        {t.titular && <p className="text-[13px] text-slate-700 mt-2 leading-snug">{t.titular}</p>}
        {(s.avisos?.length ?? 0) > 0 && (
          <ul className="mt-2 space-y-0.5">{s.avisos.map((a: string, i: number) => <li key={i} className="text-[11.5px] text-amber-800">⚠ {a}</li>)}</ul>
        )}
        {esCA && (s.pasos?.length ?? 0) > 0 && (
          <div className="mt-2">
            <button onClick={() => setVerDesglose(v => !v)} className="text-[11px] font-semibold text-violet-700 inline-flex items-center gap-1">
              <ChevronDown size={12} className={verDesglose ? 'rotate-180' : ''} /> Desglose del nivel (para CA)
            </button>
            {verDesglose && (
              <div className="mt-1 bg-white/70 rounded-lg border border-slate-200 p-2 space-y-0.5">
                {s.pasos.map((p: any, i: number) => <p key={i} className="text-[11px] text-slate-600"><span className="font-semibold">{p.regla}</span> · {p.efecto} · {p.dato}</p>)}
                <p className="text-[10px] text-slate-400 pt-1">Reglas {s.version_reglas} · calculado {s.calculado_en ? new Date(s.calculado_en).toLocaleString('es-CL') : ''}{s.supuesto_no_claro ? ` · supuesto: ${s.supuesto_no_claro === 'GLOBAL' ? 'global' : 'por línea'}` : ''}</p>
              </div>
            )}
          </div>
        )}
      </div>

      <DatosDudosos codigo={codigo} score={s} adjudicacion={adj} onCambio={cambioNivel} />

      <PanelValidador validador={informe._validador} />

      {/* ── DATOS CLAVE ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <p className="text-[10px] font-bold text-slate-400 uppercase">Presupuesto</p>
          <p className="text-[15px] font-bold text-emerald-700 leading-tight">{pres.bruto ? fmt(pres.bruto) : 'No publicado'}{pres.bruto && !pres.regimen_fora ? <span className="text-[10px] font-semibold text-slate-400"> IVA incl.</span> : null}</p>
          <span title={pres.caracter === 'EXCLUYENTE' ? 'Superar este monto deja la oferta fuera de bases' : pres.nota_art_32 || ''}
            className={`text-[9px] font-bold px-1 py-0.5 rounded cursor-help ${pres.caracter === 'EXCLUYENTE' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}>{cap(pres.caracter || 'NO_DECLARADO').toLowerCase()}</span>
          {porLineaPres.length >= 2 && (
            <div className="mt-1 space-y-0.5">{porLineaPres.map((l: any) => <p key={l.linea} className="text-[10px] text-slate-500"><span className="font-semibold">{l.linea}</span> {fmt(l.monto_pesos)}</p>)}</div>
          )}
          <div className="mt-0.5"><Cita cita={pres.cita} /></div>
        </div>
        <div className={`border rounded-xl p-3 ${adj.resultado === 'NO_CLARO' ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}>
          <p className={`text-[10px] font-bold uppercase ${adj.resultado === 'NO_CLARO' ? 'text-amber-600' : 'text-slate-400'}`}>Cómo se adjudica</p>
          <p className={`text-[14px] font-semibold leading-tight ${adj.resultado === 'NO_CLARO' ? 'text-amber-700' : 'text-slate-800'}`}>
            {adj.resultado === 'POR_LINEAS' ? 'Por línea' : adj.resultado === 'GLOBAL' ? 'Global' : 'No está claro'}
          </p>
          {adj.cotizar_100_texto && <p className="text-[10.5px] text-slate-500 mt-0.5">{adj.cotizar_100_texto}</p>}
          {evidenciaPrincipal && <p className="text-[10.5px] text-slate-500 mt-0.5">Porque las bases dicen que {EVIDENCIA_TEXTO[evidenciaPrincipal.tipo] || cap(evidenciaPrincipal.tipo).toLowerCase()}:</p>}
          {evidenciaPrincipal && <FraseCitada cita={evidenciaPrincipal.cita} />}
          {evidenciaPrincipal && <Cita cita={evidenciaPrincipal.cita} />}
          {adj.regla_aplicada === 'CONFIRMADA' && <p className="text-[10px] text-sky-700 mt-0.5">{adj.motivo}</p>}
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3" title="Tiempo administrativo entre la adjudicación y el inicio del plazo de entrega">
          <p className="text-[10px] font-bold text-slate-400 uppercase cursor-help">Plazo previo</p>
          <p className="text-[15px] font-bold text-slate-800 leading-tight">{pp ? `${pp.al_menos ? 'al menos ' : ''}${pp.total_dias_corridos} días` : '—'}</p>
          {pp && <p className="text-[10px] text-slate-400">días corridos</p>}
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <p className="text-[10px] font-bold text-slate-400 uppercase">Multa por atraso</p>
          <p className="text-[14px] font-semibold text-slate-800 leading-tight">
            {atraso?.existe === false ? 'No hay' : atraso?.calculo?.pesos_dia_estimado != null ? `≈ ${fmt(atraso.calculo.pesos_dia_estimado)}/día` : atraso?.valor ? valorMulta(atraso) : '—'}
          </p>
          {atraso?.calculo?.nota && atraso?.existe !== false && <p className="text-[10px] text-slate-400">{atraso.calculo.nota}</p>}
        </div>
      </div>

      {/* ── PESTAÑAS ── */}
      <div className="flex items-end gap-0.5 border-b border-slate-200 overflow-x-auto">
        {tabs.map(tb => (
          <button key={tb.id} onClick={() => setTab(tb.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-[13px] font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${tab === tb.id ? 'border-violet-600 text-violet-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {tb.icon} {tb.label}
            {tb.badge && <span className={`text-[10.5px] font-bold px-1.5 py-0.5 rounded-full ${tb.badgeRojo ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}>{tb.badge}</span>}
          </button>
        ))}
      </div>
      <HintOjo />

      {/* ═══ CÓMO GANAR ═══ */}
      {tab === 'ganar' && (<>
        {(t.se_gana_en || (t.para_ganar?.length ?? 0) > 0 || (t.no_quedes_fuera?.length ?? 0) > 0) && (
          <Seccion icon={<Target size={14} className="text-violet-500" />} titulo="Tarjeta de decisión" defaultOpen>
            <div className="space-y-2">
              {t.se_gana_en && <p className="text-[13px]"><span className="font-bold text-slate-700">SE GANA EN: </span><span className="text-slate-600">{t.se_gana_en}</span></p>}
              {(t.para_ganar?.length ?? 0) > 0 && <div><p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Para ganar</p><ol className="text-[13px] text-slate-700 space-y-1 list-decimal pl-5">{t.para_ganar.map((x: string, i: number) => <li key={i}>{x}</li>)}</ol></div>}
              {(t.no_quedes_fuera?.length ?? 0) > 0 && <div><p className="text-[11px] font-bold text-red-500 uppercase mb-1">No quedes fuera</p><ul className="text-[13px] text-slate-700 space-y-1 list-disc pl-5">{t.no_quedes_fuera.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></div>}
              {t.antes_de_ir && <p className="text-[12px] text-slate-500"><span className="font-bold">ANTES DE IR: </span>{t.antes_de_ir}</p>}
            </div>
          </Seccion>
        )}
        {criterios.length > 0 && (
          <Seccion icon={<Target size={14} className="text-violet-500" />} titulo="Criterios de evaluación — dónde se gana el puntaje" badge={`suma ${Math.round(Number(crit.suma_ponderaciones_real) || 0)}%${crit.suma_valida ? ' ✓' : ' ⚠'}`} defaultOpen>
            <div className="space-y-3">
              {[...criterios].sort((a, b) => (Number(b.ponderacion_efectiva) || 0) - (Number(a.ponderacion_efectiva) || 0)).map((c, i) => {
                const tb = CLASE_BADGE[String(c.clase || '').toUpperCase()];
                const pond = Number(c.ponderacion_efectiva) || Number(c.ponderacion_nominal) || 0;
                return (
                  <div key={i} className="border-b border-slate-100 last:border-0 pb-2.5 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13.5px] font-semibold text-slate-800 flex items-center gap-1.5 flex-wrap">
                        {c.nombre}
                        {tb && <span title={tb.tip} className={`text-[10px] font-bold px-1.5 py-0.5 rounded cursor-help ${tb.cls}`}>{tb.label}</span>}
                        {c.tramo_max_puntaje?.borde_comodo && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700" title="Valor que da el máximo puntaje con menos riesgo">{c.tramo_max_puntaje.borde_comodo}</span>}
                      </p>
                      <span className="text-[14px] font-bold text-slate-900 flex-shrink-0">{pond}%</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full mt-1.5 overflow-hidden"><div className={`h-full rounded-full ${i === 0 ? 'bg-emerald-500' : 'bg-violet-400'}`} style={{ width: `${Math.max(2, Math.min(100, pond))}%` }} /></div>
                    {c.forma_aplicacion && <p className="text-[12.5px] text-slate-600 mt-1.5 leading-snug">{c.forma_aplicacion}</p>}
                    {c.puntaje_minimo?.valor && <p className="text-[12px] text-red-700 mt-0.5">Puntaje mínimo: {c.puntaje_minimo.valor} {c.puntaje_minimo.unidad || ''} — {c.puntaje_minimo.consecuencia}</p>}
                    <div className="mt-0.5"><Cita cita={c.cita} /></div>
                  </div>
                );
              })}
              {crit.puntaje_minimo_total?.valor && <p className="text-[12.5px] text-red-700">Puntaje mínimo total: {crit.puntaje_minimo_total.valor} {crit.puntaje_minimo_total.unidad || ''} — {crit.puntaje_minimo_total.consecuencia} <Cita cita={crit.puntaje_minimo_total.cita} /></p>}
              {(crit.alertas?.length ?? 0) > 0 && <div className="text-[12px] text-amber-700 space-y-0.5 pt-1">{crit.alertas.map((a: string, i: number) => <p key={i}>⚠ {a}</p>)}</div>}
            </div>
          </Seccion>
        )}
        {informe.atractivo?.lectura_comercial && (
          <Seccion icon={<Scale size={14} className="text-violet-500" />} titulo="Lectura comercial" defaultOpen>
            <p className="text-[13px] text-slate-700 leading-snug">{informe.atractivo.lectura_comercial}</p>
          </Seccion>
        )}
        {((est.jugadas?.length ?? 0) > 0 || dsd.orden_final) && (
          <Seccion icon={<ListChecks size={14} className="text-violet-500" />} titulo="Estrategia — dónde se gana y qué hacer" defaultOpen>
            <div className="space-y-1.5 text-[12px]">
              {(est.jugadas || []).map((j: any, i: number) => (
                <div key={i} className="bg-slate-50 rounded-lg p-2">
                  <p className="font-semibold text-slate-700">{JUGADA_ICON[j.etiqueta] || '•'} {j.criterio}{CLASE_BADGE[String(j.clase || '').toUpperCase()] ? ` · ${CLASE_BADGE[String(j.clase).toUpperCase()].label}` : ''}{j.exige_respaldo ? ' · ⚠ EXIGE STOCK/RESPALDO' : ''}</p>
                  {j.lectura && <p className="text-slate-500 mt-0.5 leading-snug">{j.lectura}</p>}
                  {j.orden && <p className="text-slate-800 mt-0.5 font-semibold uppercase text-[11.5px]">▸ {j.orden}{j.valor_a_ofertar ? ` (${j.valor_a_ofertar})` : ''}</p>}
                  <div className="mt-0.5"><Cita cita={j.cita} /></div>
                </div>
              ))}
              {dsd.orden_final && <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-2.5"><p className="flex items-center gap-1.5 text-[12px] font-bold text-violet-800 mb-1"><Compass size={13} /> Dónde se decide</p><p className="text-[12px] text-slate-700 leading-snug">{dsd.orden_final}</p></div>}
            </div>
          </Seccion>
        )}
      </>)}

      {/* ═══ ADMISIBILIDAD ═══ */}
      {tab === 'admisibilidad' && (<>
        <Seccion icon={<ShieldCheck size={14} className="text-violet-500" />} titulo="Lo que deja la oferta fuera" badge={nAdm ? `${nAdm} requisito(s)` : 'sin requisitos detectados'} defaultOpen>
          <div className="space-y-1.5">
            {requisitos.length === 0 && <p className="text-[13px] text-slate-500">El análisis no encontró requisitos que dejen la oferta fuera.</p>}
            {requisitos.map((r: any, i: number) => (
              <div key={i} className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50/40 p-2.5">
                <Ban size={15} className="text-red-600 mt-0.5 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-red-800 leading-snug">{r.que}</p>
                  <p className="text-[12px] text-slate-600 leading-snug">
                    {[r.cuanto && `Cuánto: ${r.cuanto}`, r.cuando && `Cuándo: ${r.cuando}`, r.como && `Cómo: ${r.como}`].filter(Boolean).join(' · ')}
                  </p>
                  {r.consecuencia && <p className="text-[12px] text-red-700 leading-snug">Si no: {r.consecuencia}</p>}
                  <Cita cita={r.cita} />
                </div>
              </div>
            ))}
          </div>
        </Seccion>
        {causalesSin.length > 0 && (
          <Seccion icon={<AlertTriangle size={14} className="text-amber-500" />} titulo="Posibles causales sin analizar" badge={String(causalesSin.length)} defaultOpen>
            <p className="text-[11.5px] text-slate-500 mb-1.5">Frases de las bases que dicen que la oferta puede quedar fuera y que el análisis no cubrió. Revísalas en el documento.</p>
            <div className="space-y-1.5">{causalesSin.map((c: any, i: number) => (
              <div key={i} className="rounded-lg border border-amber-200 bg-amber-50/60 p-2.5">
                <p className="text-[12px] text-slate-700 leading-snug">“{c.oracion}”</p>
                <Cita cita={c.cita} />
              </div>
            ))}</div>
          </Seccion>
        )}
        <Seccion icon={<Gavel size={14} className="text-violet-500" />} titulo="Garantías, contrato y firma" defaultOpen>
          <div className="space-y-1.5 text-[12.5px]">
            {[['seriedad', 'Garantía de seriedad de la oferta'], ['fiel_cumplimiento', 'Garantía de fiel cumplimiento'], ['contrato', 'Contrato']].map(([k, label]) => {
              const g = garantias[k] || {};
              const est = String(g.estado || 'NO_INDICADO').toUpperCase();
              return (
                <div key={k} className="flex items-start gap-2">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${est === 'EXISTE' ? 'bg-amber-100 text-amber-700' : est === 'NO_EXISTE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{est === 'EXISTE' ? 'Se exige' : est === 'NO_EXISTE' ? 'No se exige' : 'No indicado'}</span>
                  <div className="min-w-0"><p className="text-slate-700">{label}{g.monto ? ` · ${g.monto}` : ''}</p><Cita cita={g.cita} /></div>
                </div>
              );
            })}
            {firma && (
              <div className="flex items-start gap-2 pt-1 border-t border-slate-100">
                <span className="flex-shrink-0">{firma.icono}</span>
                <div className="min-w-0"><p className="text-slate-700 font-semibold">{firma.titulo}</p><p className="text-slate-500">{firma.accion}</p><Cita cita={adm.firma?.cita} /></div>
              </div>
            )}
            {pres.caracter !== 'EXCLUYENTE' && pres.nota_art_32 && <p className="text-[11.5px] text-slate-500 pt-1 border-t border-slate-100">{pres.nota_art_32}</p>}
          </div>
        </Seccion>
      </>)}

      {/* ═══ PLAZOS Y MULTA ═══ */}
      {tab === 'plazos' && (<>
        <Seccion icon={<Clock size={14} className="text-violet-500" />} titulo="Plazo previo" badge={pp ? `${pp.al_menos ? 'al menos ' : ''}${pp.total_dias_corridos} días corridos` : undefined} defaultOpen>
          <table className="w-full text-[12.5px]">
            <tbody>
              {(Array.isArray(plz.hitos) ? plz.hitos : []).map((h: any, i: number) => {
                const est = String(h.estado || '').toUpperCase();
                return (
                  <tr key={i} className="border-t border-slate-100 align-top">
                    <td className="py-1.5 pr-2 text-slate-700">{HITO_LABEL[h.hito] || cap(h.hito)}{h.desde && est === 'EXISTE' ? <span className="text-slate-400"> · desde {h.desde}</span> : null}<div><Cita cita={h.cita} /></div></td>
                    <td className="py-1.5 text-right whitespace-nowrap font-semibold text-slate-700">{est === 'EXISTE' ? `${h.plazo ?? '?'} ${h.unidad_original || ''}` : est === 'NO_EXISTE' ? <span className="text-emerald-700 font-normal">No se exige</span> : <span className="text-slate-400 font-normal">No indicado en las bases</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {pp && <p className="text-[11.5px] text-slate-500 mt-2">Total: <strong>{pp.al_menos ? 'al menos ' : ''}{pp.total_dias_corridos} días corridos</strong>, contados desde la {pp.fecha_base_origen} ({pp.fecha_base}).</p>}
          {(pp?.avisos?.length ?? 0) > 0 && pp.avisos.map((a: string, i: number) => <p key={i} className="text-[11.5px] text-amber-700">⚠ {a}</p>)}
          {plz.nota_aceptacion_oc && <p className="text-[11.5px] text-sky-800 bg-sky-50 border border-sky-100 rounded-lg p-2 mt-2">{plz.nota_aceptacion_oc}</p>}
          {plz.inicio_plazo_entrega?.evento && (
            <div className="text-[12.5px] text-slate-600 mt-2 bg-slate-50 rounded-lg p-2">
              <span className="font-semibold text-slate-700">Inicio del plazo de entrega:</span> {plz.inicio_plazo_entrega.evento}
              {plz.inicio_plazo_entrega.desfase?.cantidad != null ? ` (+${plz.inicio_plazo_entrega.desfase.cantidad} ${plz.inicio_plazo_entrega.desfase.unidad || ''})` : ''}
              <div><Cita cita={plz.inicio_plazo_entrega.cita} /></div>
            </div>
          )}
          {plz.plazo_entrega && (plz.plazo_entrega.min || plz.plazo_entrega.max) && (
            <div className="text-[12.5px] text-slate-600 mt-2">
              <span className="font-semibold text-slate-700">Plazo de entrega:</span> {[plz.plazo_entrega.min && `mínimo ${plz.plazo_entrega.min}`, plz.plazo_entrega.max && `máximo ${plz.plazo_entrega.max}`].filter(Boolean).join(' · ')} {plz.plazo_entrega.unidad || ''}
              {plz.plazo_entrega.fuera_de_rango_inadmisible ? <span className="text-red-700"> · fuera de rango la oferta es inadmisible</span> : null}
              <div><Cita cita={plz.plazo_entrega.cita} /></div>
            </div>
          )}
        </Seccion>
        <Seccion icon={<Gavel size={14} className="text-violet-500" />} titulo="Multa por atraso" defaultOpen>
          {!atraso || atraso.existe === false ? <p className="text-[13px] text-slate-500">Las bases no establecen multa por atraso.</p> : (
            <div className="text-[12.5px] text-slate-700 space-y-1">
              <p><strong>{valorMulta(atraso)}</strong> por {PERIODO[String(atraso.periodo || '').toUpperCase()] || 'día'}{atraso.base_calculo ? ` · sobre ${atraso.base_calculo}` : ''}</p>
              {atraso.calculo?.pesos_dia_estimado != null && <p>≈ <strong>{fmt(atraso.calculo.pesos_dia_estimado)}</strong> por día{atraso.calculo.tope_estimado != null ? ` · tope ≈ ${fmt(atraso.calculo.tope_estimado)}` : ''} <span className="text-slate-400">({atraso.calculo.nota}{atraso.calculo.valor_uf_utm ? ` · valor ${fmt(atraso.calculo.valor_uf_utm)} del ${atraso.calculo.fecha_valor}` : ''})</span></p>}
              {atraso.calculo?.pesos_dia_estimado == null && atraso.calculo?.nota && <p className="text-amber-700">{atraso.calculo.nota}</p>}
              {(atraso.tope?.valor || atraso.al_superar_tope) && <p>Tope: {atraso.tope?.valor || 'no indicado'} {atraso.tope?.unidad || ''}{atraso.al_superar_tope ? ` · al superarlo: ${atraso.al_superar_tope}` : ''}</p>}
              <Cita cita={atraso.cita} />
            </div>
          )}
        </Seccion>
      </>)}

      {/* ═══ PRODUCTOS ═══ */}
      {tab === 'productos' && (<>
        {lineasNivel.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setLineaSel('todas')} className={`text-[11.5px] font-semibold px-2.5 py-1 rounded-lg border ${lineaSel === 'todas' ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200'}`}>Todas</button>
            {lineasNivel.map((l: any) => (
              <button key={l.linea} onClick={() => setLineaSel(l.linea)}
                className={`text-[11.5px] font-semibold px-2.5 py-1 rounded-lg border ${lineaSel === l.linea ? 'bg-violet-600 text-white border-violet-600' : l.viable ? 'bg-white text-slate-600 border-slate-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
                {l.linea} · {l.presupuesto_neto != null ? `${fmt(l.presupuesto_neto)} neto` : 'sin monto'} · {l.viable ? NIVEL_VISTA[l.nivel]?.label || l.nivel : 'no viable'}
              </button>
            ))}
          </div>
        )}
        {lineasNivel.length <= 1 && lineas.length > 1 && !esGlobal && (
          <div className="flex flex-wrap gap-1.5">
            {['todas', ...lineas].map(l => <button key={l} onClick={() => setLineaSel(l)} className={`text-[11.5px] font-semibold px-2.5 py-1 rounded-lg border ${lineaSel === l ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200'}`}>{l === 'todas' ? 'Todas' : `${l}${porLineaPres.find((p: any) => p.linea === l) ? ` · ${fmt(porLineaPres.find((p: any) => p.linea === l).monto_pesos)}` : ''}`}</button>)}
          </div>
        )}
        <Seccion icon={<Package size={14} className="text-violet-500" />} titulo="Productos a cotizar" badge={conteo ? `${conteo.final} de ${conteo.declarado ?? conteo.final}` : `${items.length}`} defaultOpen>
          {conteo && conteo.cuadra === false && <p className="text-[11.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mb-2">⚠ El conteo no cuadra: {conteo.detalle}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="text-left text-[10.5px] text-slate-400 uppercase"><th className="py-1.5 pr-2 font-bold w-10">L</th><th className="py-1.5 pr-2 font-bold">Descripción</th><th className="py-1.5 pr-2 font-bold text-right w-24 whitespace-nowrap">Cant.</th><th className="py-1.5 font-bold w-24">Tipo</th></tr></thead>
              <tbody>
                {itemsVista.map((p: any, i: number) => {
                  const cs: string[] = Array.isArray(p.caracteristicas) ? p.caracteristicas : [];
                  const noEnc: string[] = Array.isArray(p.caracteristicas_no_encontradas) ? p.caracteristicas_no_encontradas : [];
                  const esEsp = String(p.clasificacion || '').toLowerCase().startsWith('espec');
                  return (
                    <Fragment key={i}>
                      <tr className="border-t border-slate-100 align-top">
                        <td className="py-1.5 pr-2 text-slate-400 whitespace-nowrap">{p.linea}</td>
                        <td className="py-1.5 pr-2 text-slate-700">
                          {p.nombre}{p.marca_modelo_referencia ? <span className="text-slate-500"> · {p.marca_modelo_referencia}</span> : null}
                          {p.libertad_de_oferta && <span className="ml-1.5 text-[10.5px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700" title="Las bases no detallan características: se puede ofertar el que más nos convenga">🟢 Libertad de oferta</span>}
                          {p.libertad_de_pricing && <span className="ml-1.5 text-[10.5px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500" title="Las bases no publican el monto de esta línea">precio libre</span>}
                        </td>
                        <td className="py-1.5 pr-2 text-right text-slate-600 whitespace-nowrap">
                          {p.cantidad != null ? <>{p.cantidad}{p.unidad_medida ? ` ${p.unidad_medida}` : ''}{p.unidad_inferida ? '*' : ''}</> : '—'}
                          {p.cantidad_variable?.porcentaje && <div className="text-[10.5px] text-amber-700" title="Las bases permiten variar la cantidad">± {p.cantidad_variable.porcentaje}</div>}
                        </td>
                        <td className="py-1.5">{esEsp ? <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">Específico</span> : <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">Genérico</span>}</td>
                      </tr>
                      {(cs.length > 0 || noEnc.length > 0) && (
                        <tr><td /><td colSpan={3} className="pb-2">
                          {cs.length > 0 && (
                            <details>
                              <summary className="text-[11px] text-violet-600 cursor-pointer select-none">Ficha técnica ({cs.length})</summary>
                              <ul className="text-[11px] text-slate-500 list-disc pl-4 mt-0.5 space-y-0.5">{cs.map((c, k) => <li key={k}>{c}</li>)}</ul>
                            </details>
                          )}
                          {noEnc.length > 0 && (
                            <details className="mt-0.5">
                              <summary className="text-[11px] text-amber-700 cursor-pointer select-none">⚠ {noEnc.length} característica(s) no encontrada(s) en las bases — no pasan al AUDITOR hasta revisarlas</summary>
                              <ul className="text-[11px] text-amber-800 list-disc pl-4 mt-0.5 space-y-0.5">{noEnc.map((c, k) => <li key={k}>{c}</li>)}</ul>
                            </details>
                          )}
                          {cs.length >= 3 && <BotonBuscarEquipo codigo={String(informe.meta?.id || codigo)} region={informe.meta?.region} producto={{ descripcion: p.nombre, caracteristicas: cs, cantidad: p.cantidad }} />}
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {items.some(p => p.unidad_inferida) && <p className="text-[10.5px] text-slate-400 pt-1">* unidad de medida no indicada en las bases</p>}
        </Seccion>
        {(prod.requisitos_generales?.length ?? 0) > 0 && (
          <Seccion icon={<ClipboardCheck size={14} className="text-violet-500" />} titulo="Requisitos generales de los productos" badge={String(prod.requisitos_generales.length)}>
            <p className="text-[11.5px] text-slate-500 mb-1">Garantía, capacitación, manuales, certificados, mantenciones… Van al bloque técnico-administrativo del AUDITOR.</p>
            <ul className="text-[12px] text-slate-700 space-y-1 list-disc pl-4">{prod.requisitos_generales.map((r: any, i: number) => <li key={i}>{r.producto ? <span className="text-slate-400">{r.producto}: </span> : null}{r.texto} <Cita cita={r.cita} /></li>)}</ul>
          </Seccion>
        )}
      </>)}

      {/* ═══ PREPARACIÓN (3 grupos) ═══ */}
      {tab === 'preparacion' && (<>
        <Seccion icon={<ClipboardCheck size={14} className="text-violet-500" />} titulo="Documentos de empresa" badge={docsEmpresa.length ? String(docsEmpresa.length) : undefined} defaultOpen>
          {docsEmpresa.length === 0 ? <p className="text-[12.5px] text-slate-500">Las bases no piden documentos de empresa aparte de los anexos.</p> : (
            <details>
              <summary className="text-[12.5px] text-slate-700 cursor-pointer select-none">Piden {docsEmpresa.length} documento(s) de la empresa (estatuto, vigencia, certificados…)</summary>
              <ul className="text-[12px] text-slate-600 space-y-1 list-disc pl-4 mt-1">{docsEmpresa.map((d: any, i: number) => <li key={i}>{d.nombre}{d.antiguedad_maxima ? <span className="text-amber-700"> · antigüedad máxima {d.antiguedad_maxima}</span> : null} <Cita cita={d.cita} /></li>)}</ul>
            </details>
          )}
        </Seccion>
        <Seccion icon={<ClipboardCheck size={14} className="text-violet-500" />} titulo="Anexos del organismo" badge={anexosOrg.length ? String(anexosOrg.length) : undefined} defaultOpen>
          {anexosOrg.length === 0 ? <p className="text-[12.5px] text-slate-500">Sin anexos del organismo detectados.</p> : (
            <ul className="text-[12.5px] text-slate-700 space-y-1">{anexosOrg.map((d: any, i: number) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="text-slate-400">•</span>
                <span className="flex-1">{d.nombre}{d.copias ? <span className="text-slate-500"> · {d.copias}</span> : null}
                  {d._agregado_por_cruce && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700" title="Publicado por el organismo; el análisis no lo listó — confirma en las bases si es obligatorio">por cruce</span>}
                  <span className="ml-1"><Cita cita={d.cita} /></span></span>
              </li>
            ))}</ul>
          )}
        </Seccion>
        <Seccion icon={<ClipboardCheck size={14} className="text-violet-500" />} titulo="Documentos a crear" badge={aCrear.length ? String(aCrear.length) : undefined} defaultOpen>
          {aCrear.length === 0 ? <p className="text-[12.5px] text-slate-500">No hay documentos propios que crear.</p> : (
            <div className="space-y-1.5">{aCrear.map((d: any, i: number) => (
              <div key={i} className="bg-slate-50 rounded-lg p-2 text-[12.5px]">
                <p className="font-semibold text-slate-800">{d.que_crear}</p>
                {d.contenido_exigido && <p className="text-slate-500 leading-snug">Contenido exigido: {d.contenido_exigido}</p>}
                <Cita cita={d.cita} />
              </div>
            ))}</div>
          )}
        </Seccion>
        {((acc.acciones?.length ?? 0) > 0 || (acc.advertencias?.length ?? 0) > 0) && (
          <Seccion icon={<Target size={14} className="text-violet-500" />} titulo="Acciones y advertencias" defaultOpen>
            {(acc.acciones?.length ?? 0) > 0 && <><p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Para postular</p><ul className="text-[12px] text-slate-700 space-y-1 list-decimal pl-4 mb-2">{acc.acciones.map((a: any, i: number) => <li key={i}><span className="font-semibold">{a.orden}</span>{a.por_que ? ` — ${a.por_que}` : ''} <Cita cita={a.cita} /></li>)}</ul></>}
            {(acc.advertencias?.length ?? 0) > 0 && <><p className="text-[11px] font-bold text-red-500 uppercase mb-1">Advertencias</p><ul className="text-[12px] text-amber-700 space-y-1 list-disc pl-4">{acc.advertencias.map((a: any, i: number) => <li key={i}>⚠ {a.riesgo}{a.consecuencia ? ` — ${a.consecuencia}` : ''} <Cita cita={a.cita} /></li>)}</ul></>}
          </Seccion>
        )}
        {feedbackPanel}
      </>)}

      <p className="text-[11px] text-slate-400 text-center pt-1">
        {(informe.pendientes_fase3?.length ?? 0) > 0 && <>Pendiente Fase 3: {informe.pendientes_fase3.join(', ')} · </>}
        Leídos {informe.documentos_leidos?.length ?? 0} doc(s){informe._citas ? ` · ${informe._citas.verificadas}/${informe._citas.total} citas verificadas` : ''} · <span className="text-violet-500 font-semibold">v4.0</span>
      </p>
    </div>
  );
}
