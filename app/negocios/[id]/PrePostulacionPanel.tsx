'use client';

// PRE-POSTULACIÓN (reemplaza a la etapa ANEXOS): entrada = opciones APROBADAS del Auditor. Tres cosas:
//   1. CERTIFICADO DE ADMISIBILIDAD — cada causal que puede dejarnos fuera, por línea, con su ruta para cerrarla (lo calcula el código).
//   2. BLOQUE TÉCNICO-ADMINISTRATIVO — los compromisos nuestros (capacitación, garantía, manual…), precargados como cumplidos y
//      confirmados UNO A UNO. Un check sin marcar bloquea igual que un NO CUMPLE.
//   3. EL CANDADO — mientras quede algo abierto no se generan los anexos, y dice exactamente qué falta y cómo destrabarlo.
// Spec: docs/ESPECIFICACION_AUDITOR_v1.md §2 y §11.4 · docs/RESERVA_PREPOSTULACION_Bloque_TecAdm_y_Certificado.md.
// Backend: app/api/negocios/[id]/prepostulacion/route.ts. Lógica: app/lib/auditor-prepostulacion-core.ts.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Modal } from '@/app/components/ui/Modal';
import {
  IconLoader2 as Loader2, IconSparkles as Sparkles, IconAlertTriangle as Alerta, IconCircleCheck as Check,
  IconChevronDown as ChevronDown, IconChevronRight as ChevronRight, IconLock as Lock, IconLockOpen as LockOpen,
} from '@tabler/icons-react';
import type { PrePostulacionDTO, LineaPrePostDTO } from '@/app/lib/auditor-prepostulacion';
import type { ItemPrePost, CausalCertificado } from '@/app/lib/auditor-prepostulacion-core';
import { materiaLegible } from '@/app/lib/auditor-prepostulacion-core';
import { pedirJson, ultimoJson } from '@/app/lib/pedir-json';
import { DatosEmpresaBoton } from '@/app/components/DatosEmpresaBoton';

type Dato = PrePostulacionDTO | { migracionPendiente: true };

async function post(negocioId: number, body: Record<string, unknown>) {
  const res = await fetch(`/api/negocios/${negocioId}/prepostulacion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || 'No se pudo completar la acción');
  return data;
}

const MATERIA_LABEL: Record<string, string> = {
  capacitacion: 'Capacitación', despacho: 'Despacho', plazo: 'Plazo', instalacion: 'Instalación', postventa: 'Postventa', garantia: 'Garantía',
  mantencion: 'Mantención', repuestos: 'Repuestos', documentacion: 'Documentación', otro: 'Otro',
};
const MATERIAS = Object.keys(MATERIA_LABEL);
const ORIGEN_LABEL: Record<string, { label: string; cls: string }> = {
  ia: { label: 'Detectado por IA', cls: 'bg-violet-100 text-violet-700' },
  costo_asociado: { label: 'Con costo (del Auditor)', cls: 'bg-amber-100 text-amber-800' },
  manual: { label: 'Agregado a mano', cls: 'bg-zinc-100 text-zinc-600' },
};
const MOTIVO_LABEL: Record<string, string> = { RIESGO: 'Riesgo', POR_AFINAR: 'Por afinar', SEGUNDA_PASADA: 'Falta la segunda pasada', SIN_VERIFICAR: 'Sin verificar' };

export function PrePostulacionPanel({ negocioId, empresaId, onIrAlAuditor, datoInicial, documentosSlot }: { negocioId: number; empresaId?: number | null; onIrAlAuditor: () => void; datoInicial?: PrePostulacionDTO; documentosSlot?: React.ReactNode }) {
  const toast = useToast();
  const [dato, setDato] = useState<Dato | null>(datoInicial ?? ultimoJson<Dato>(`/api/negocios/${negocioId}/prepostulacion`) ?? null);   // datoInicial: vista previa en servidor (scripts/scratch/_preview-pp.tsx)
  const [cargando, setCargando] = useState(!datoInicial && !ultimoJson(`/api/negocios/${negocioId}/prepostulacion`));
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<{ tipo: 'no_aplica'; id: number } | { tipo: 'agregar'; filaId: string } | null>(null);
  const [texto, setTexto] = useState('');
  const [nuevo, setNuevo] = useState({ materia: 'capacitacion', exigeBaseLiteral: '', seCompromete: '', fuenteBases: '', conCosto: false });

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso && !ultimoJson(`/api/negocios/${negocioId}/prepostulacion`)) setCargando(true);
    try {
      // silencioso = recarga tras una acción: lectura nueva, no la compartida (podría haber empezado antes del cambio).
      const data = await pedirJson(`/api/negocios/${negocioId}/prepostulacion`, { fresco: silencioso });
      if (!data.success) throw new Error(data.error || 'No se pudo cargar');
      setDato(data);
    } catch (e: any) { toast.error('No se pudo cargar Pre-postulación', e.message); }
    finally { setCargando(false); }
  }, [negocioId, toast]);
  useEffect(() => { if (!datoInicial) cargar(); }, [cargar, datoInicial]);

  const accion = async (clave: string, body: Record<string, unknown>, ok?: string) => {
    setOcupado(clave);
    try { const r = await post(negocioId, body); if (ok) toast.success(ok); return r; }
    catch (e: any) { toast.error('No se pudo completar', e.message); return null; }
    finally { setOcupado(null); await cargar(true); }
  };

  const revisar = async (filaId: string | null) => {
    setOcupado(filaId ? `rev-${filaId}` : 'rev-todas');
    try {
      const r = await post(negocioId, filaId ? { accion: 'revisar_linea', filaId } : { accion: 'revisar_todas' });
      const creados = r.creados ?? 0, errores = filaId ? (r.error ? 1 : 0) : (r.errores ?? 0);
      if (errores) toast.error('La revisión falló en alguna línea', (filaId ? r.error : (r.resultados || []).find((x: any) => x.error)?.error) || 'Reintenta en unos minutos.');
      else toast.success('Compromisos revisados', creados ? `${creados} compromiso${creados === 1 ? '' : 's'} para confirmar.` : 'No salió ningún compromiso técnico-administrativo nuevo.');
    } catch (e: any) { toast.error('No se pudo revisar', e.message); }
    finally { setOcupado(null); await cargar(true); }
  };

  const itemsPorLinea = useMemo(() => {
    const m = new Map<string, ItemPrePost[]>();
    if (dato && !('migracionPendiente' in dato && dato.migracionPendiente)) for (const i of (dato as PrePostulacionDTO).items) (m.get(i.filaId ?? '') || m.set(i.filaId ?? '', []).get(i.filaId ?? '')!).push(i);
    return m;
  }, [dato]);

  if (cargando && !dato) return <div className="flex items-center gap-2 text-[13px] text-zinc-500 py-10 justify-center"><Loader2 size={16} className="animate-spin" /> Cargando Pre-postulación…</div>;
  if (!dato) return null;
  if ('migracionPendiente' in dato && dato.migracionPendiente) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-[13px] text-amber-800">
        Falta aplicar la migración de Pre-postulación en la base de datos: <code className="font-mono text-[12px]">node scripts/aplicar-migration-135.mjs</code>
      </div>
    );
  }
  const d = dato as PrePostulacionDTO;
  const { candado, certificado } = d;
  const itemsDe = (filaId: string) => (itemsPorLinea.get(filaId) || []).filter(i => !(i.origen === 'costo_asociado' && i.costo?.anulado));
  const generales = (itemsPorLinea.get('') || []).filter(i => !(i.origen === 'costo_asociado' && i.costo?.anulado));
  const alternar = (k: string) => setAbiertas(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const hayPorRevisar = d.lineas.some(l => !l.noOfertada && l.opcionAprobadaId != null && !l.revisada);
  const imprimir = false;
  const compromisosVigentes = candado.resumen.total - candado.resumen.noAplica;
  const pasos = [
    { n: 1, titulo: 'Líneas con opción aprobada', avance: `${d.avance.aprobadas} de ${d.avance.ofertadas}`, ok: d.avance.puede },
    { n: 2, titulo: 'Certificado de admisibilidad', avance: certificado.total ? `${certificado.cumplidas} de ${certificado.total} causales cumplidas` : 'sin causales', ok: certificado.noCumplidas === 0 && certificado.pendientes === 0 },
    { n: 3, titulo: 'Compromisos confirmados', avance: `${candado.resumen.confirmados} de ${compromisosVigentes}`, ok: candado.resumen.abiertos === 0 && !hayPorRevisar },
  ];

  const confirmarModal = async () => {
    if (!modal) return;
    if (modal.tipo === 'no_aplica') {
      if (!texto.trim()) { toast.error('Falta el motivo', 'Indica por qué este compromiso no corresponde.'); return; }
      await accion(`it-${modal.id}`, { accion: 'no_aplica', id: modal.id, comentario: texto.trim() }, 'Marcado «No aplica»');
    } else {
      if (!nuevo.exigeBaseLiteral.trim()) { toast.error('Falta la exigencia', 'Copia lo que dicen las bases.'); return; }
      await accion('agregar', { accion: 'agregar_item', filaId: modal.filaId || null, ...nuevo }, 'Compromiso agregado');
    }
    setModal(null); setTexto('');
  };

  return (
    <div className="space-y-4">
      {/* ── El candado ── */}
      <div className={`rounded-2xl border px-5 py-4 ${candado.puedeGenerarAnexos ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
        <div className="flex items-center gap-2 flex-wrap">
          {candado.puedeGenerarAnexos ? <LockOpen size={16} className="text-emerald-700" /> : <Lock size={16} className="text-rose-700" />}
          <h3 className={`text-[14px] font-bold ${candado.puedeGenerarAnexos ? 'text-emerald-800' : 'text-rose-800'}`}>
            {candado.puedeGenerarAnexos ? 'Listo: se pueden generar los anexos económico y técnico' : `Anexos económico y técnico bloqueados — ${candado.causales.length} ${candado.causales.length === 1 ? 'pendiente' : 'pendientes'}`}
          </h3>
          <div className="ml-auto flex gap-2">
            {!d.avance.puede && <button onClick={onIrAlAuditor} className="px-3 py-1.5 rounded-lg border border-zinc-300 bg-white text-[12px] font-semibold text-zinc-700 hover:bg-zinc-50">Ir al Auditor</button>}
          </div>
        </div>
        {/* Tres pasos, con su avance */}
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {pasos.map(p => (
            <div key={p.n} className={`rounded-xl border px-3 py-2 bg-white/80 ${p.ok ? 'border-emerald-200' : 'border-rose-200'}`}>
              <p className="text-[10.5px] uppercase tracking-wide font-bold text-zinc-400">Paso {p.n}</p>
              <p className="text-[12.5px] font-semibold text-zinc-800">{p.titulo}</p>
              <p className={`text-[12px] font-semibold ${p.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{p.ok ? '✓ ' : ''}{p.avance}</p>
            </div>
          ))}
        </div>
        {candado.causales.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {candado.causales.map(c => (
              <li key={c.codigo} className="text-[12.5px] text-rose-800 leading-snug">
                <span className="font-semibold">{c.descripcion.replace(/\.+$/, '')}.</span> <span className="text-rose-700/90">→ {c.rutaDesbloqueo}</span>
              </li>
            ))}
          </ul>
        )}
        {candado.alertas.length > 0 && (
          <details className="mt-3" open={imprimir}>
            <summary className="cursor-pointer text-[12px] font-semibold text-zinc-600">Avisos que no bloquean ({candado.alertas.length})</summary>
            <ul className="mt-1.5 space-y-1">
              {candado.alertas.map((a, i) => (
                <li key={i} className={`flex items-start gap-1.5 text-[12px] ${a.nivel === 'amarillo' ? 'text-amber-800' : 'text-zinc-600'}`}><Alerta size={12} className="mt-0.5 shrink-0" /> <span>{a.texto}{a.veces && a.veces > 1 ? <b className="ml-1 text-zinc-500">×{a.veces}</b> : null}</span></li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {/* ── Anexos a generar: «Generar anexo» en cada punto; lo generado queda cargado y aparece en la pestaña Postulación ── */}
      {documentosSlot && <div className="space-y-2"><div className="px-1 flex items-start justify-between gap-3 flex-wrap"><div><h3 className="text-[13.5px] font-bold text-zinc-900">Anexos a generar</h3><p className="text-[11.5px] text-zinc-500">Genera cada anexo aquí: se rellena con los datos de la empresa y la firma. Los PDF listos para subir quedan en la pestaña Postulación.</p></div><DatosEmpresaBoton empresaId={empresaId} /></div>{documentosSlot}</div>}

      {/* ── Certificado de admisibilidad ── */}
      <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-100 flex items-center gap-2">
          <h3 className="text-[13.5px] font-bold text-zinc-900">Certificado de admisibilidad</h3>
          <span className="text-[11.5px] text-zinc-400">Cada exigencia que puede dejarnos fuera de la evaluación, por línea. Señala el ítem exacto que impediría subir la oferta.</span>
        </div>
        {certificado.lineas.length === 0 ? (
          <p className="px-5 py-6 text-[12.5px] text-zinc-400">No hay líneas ofertadas todavía.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {certificado.lineas.some(l => l.sinOpcion) && (
              <li className="px-5 py-3 text-[12.5px] text-zinc-600">
                <span className="font-bold text-zinc-800">Sin opción aprobada: </span>
                {certificado.lineas.filter(l => l.sinOpcion).map(l => `línea ${l.linea}`).join(', ')}.
                <button onClick={onIrAlAuditor} className="ml-2 text-indigo-600 font-semibold hover:underline">Ir al Auditor a aprobarlas</button>
              </li>
            )}
            {certificado.lineas.filter(l => !l.sinOpcion).map(l => (
              <li key={l.filaId} className="px-5 py-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[12.5px] font-bold text-zinc-800">Línea {l.linea}</span>
                  <span className="text-[12.5px] text-zinc-600 truncate max-w-[46ch]">{l.detalle}</span>
                  {l.producto && <span className="text-[11.5px] text-zinc-400">· {l.producto}</span>}
                  {l.sinOpcion ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-500">sin opción aprobada</span>
                    : l.causales.length === 0 ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">sin exigencias críticas</span>
                    : <span className="text-[11px] text-zinc-500">{l.cumplidas} cumplidas{l.noCumplidas ? ` · ${l.noCumplidas} no cumplen` : ''}{l.pendientes ? ` · ${l.pendientes} pendientes` : ''}</span>}
                  {l.requiereSegundaPasada && l.opcionId != null && (
                    <button disabled={ocupado === `sp-${l.opcionId}`} onClick={() => accion(`sp-${l.opcionId}`, { accion: 'segunda_pasada', opcionId: l.opcionId }, 'Segunda pasada terminada')}
                      className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-[12px] font-semibold hover:bg-amber-100 disabled:opacity-50">
                      {ocupado === `sp-${l.opcionId}` ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Correr segunda pasada
                    </button>
                  )}
                </div>
                {l.causales.length > 0 && (l.causales.every(c => c.estado === 'CUMPLIDA')
                  ? <details className="mt-1.5"><summary className="cursor-pointer text-[11.5px] font-semibold text-emerald-700">Ver las {l.causales.length} exigencias cumplidas</summary>
                      <ul className="mt-2 space-y-1.5">{l.causales.map((c, i) => <Causal key={`${c.item}-${i}`} c={c} />)}</ul></details>
                  : <ul className="mt-2 space-y-1.5">{l.causales.map((c, i) => <Causal key={`${c.item}-${i}`} c={c} />)}</ul>)}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Bloque técnico-administrativo ── */}
      <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-100 flex items-center gap-2 flex-wrap">
          <h3 className="text-[13.5px] font-bold text-zinc-900">Requisitos técnico-administrativos</h3>
          <span className="text-[11.5px] text-zinc-400">Lo que nos comprometemos a hacer. Vienen precargados como cumplidos: confírmalos uno a uno. Comprométete solo a lo que exigen las bases, ni más horas ni más plazo.</span>
          <button disabled={ocupado === 'rev-todas' || !hayPorRevisar} onClick={() => revisar(null)}
            className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-violet-200 bg-violet-50 text-violet-700 text-[12px] font-semibold hover:bg-violet-100 disabled:opacity-40">
            {ocupado === 'rev-todas' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Revisar compromisos
          </button>
        </div>
        <ul className="divide-y divide-zinc-100">
          {d.lineas.some(l => !l.noOfertada && l.opcionAprobadaId == null) && (
            <li className="px-5 py-3 text-[12.5px] text-zinc-600">
              <span className="font-bold text-zinc-800">Sin opción aprobada todavía: </span>
              {d.lineas.filter(l => !l.noOfertada && l.opcionAprobadaId == null).map(l => `línea ${l.item}`).join(', ')}.
              <span className="text-zinc-400"> Sus compromisos se revisan cuando se apruebe su opción en el Auditor.</span>
            </li>
          )}
          {d.lineas.filter(l => !l.noOfertada && l.opcionAprobadaId != null).map(l => <LineaCompromisos key={l.filaId} l={l} items={itemsDe(l.filaId)} abierta={abiertas.has(l.filaId)} onAlternar={() => alternar(l.filaId)}
            ocupado={ocupado} onRevisar={() => revisar(l.filaId)} onConfirmar={(id, v) => accion(`it-${id}`, { accion: v ? 'confirmar' : 'desconfirmar', id })}
            onConfirmarTodos={ids => accion(`lote-${l.filaId}`, { accion: 'confirmar_varios', ids }, 'Compromisos confirmados')}
            onNoAplica={id => { setTexto(''); setModal({ tipo: 'no_aplica', id }); }} onRestaurar={id => accion(`it-${id}`, { accion: 'restaurar', id })}
            onAgregar={() => { setNuevo({ materia: 'capacitacion', exigeBaseLiteral: '', seCompromete: '', fuenteBases: '', conCosto: false }); setModal({ tipo: 'agregar', filaId: l.filaId }); }} />)}
          {generales.length > 0 && (
            <li className="px-5 py-3">
              <p className="text-[12.5px] font-bold text-zinc-800 mb-1.5">Generales de la licitación (no de una línea)</p>
              <ul className="space-y-2">{generales.map(i => <ItemFila key={i.id} i={i} ocupado={ocupado} onConfirmar={v => accion(`it-${i.id}`, { accion: v ? 'confirmar' : 'desconfirmar', id: i.id })}
                onNoAplica={() => { setTexto(''); setModal({ tipo: 'no_aplica', id: i.id }); }} onRestaurar={() => accion(`it-${i.id}`, { accion: 'restaurar', id: i.id })} />)}</ul>
            </li>
          )}
        </ul>
      </div>

      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal?.tipo === 'agregar' ? 'Agregar compromiso' : 'Marcar «No aplica»'} size="md"
        footer={<>
          <button onClick={() => setModal(null)} className="px-4 py-2 text-[13px] font-semibold text-zinc-600 hover:text-zinc-900">Cancelar</button>
          <button onClick={confirmarModal} className="px-4 py-2 rounded-lg bg-amber-600 text-white text-[13px] font-semibold hover:bg-amber-700">Confirmar</button>
        </>}>
        {modal?.tipo === 'agregar' ? (
          <div className="space-y-2.5 text-[13px]">
            <select value={nuevo.materia} onChange={e => setNuevo(n => ({ ...n, materia: e.target.value }))} className="w-full border border-zinc-200 rounded-lg px-3 py-2 bg-white">
              {MATERIAS.map(m => <option key={m} value={m}>{MATERIA_LABEL[m]}</option>)}
            </select>
            <textarea value={nuevo.exigeBaseLiteral} onChange={e => setNuevo(n => ({ ...n, exigeBaseLiteral: e.target.value }))} rows={3} placeholder="Lo que exigen las bases, copiado tal cual (obligatorio)…" className="w-full border border-zinc-200 rounded-lg px-3 py-2 outline-none focus:border-amber-400" />
            <input value={nuevo.seCompromete} onChange={e => setNuevo(n => ({ ...n, seCompromete: e.target.value }))} placeholder="A qué nos comprometemos (ej.: 8 horas) — solo lo que exigen las bases" className="w-full border border-zinc-200 rounded-lg px-3 py-2 outline-none focus:border-amber-400" />
            <input value={nuevo.fuenteBases} onChange={e => setNuevo(n => ({ ...n, fuenteBases: e.target.value }))} placeholder="Dónde está en las bases (numeral o documento)" className="w-full border border-zinc-200 rounded-lg px-3 py-2 outline-none focus:border-amber-400" />
            <label className="flex items-center gap-2 text-zinc-600"><input type="checkbox" checked={nuevo.conCosto} onChange={e => setNuevo(n => ({ ...n, conCosto: e.target.checked }))} /> Esto tiene costo (se crea el costo asociado en el costeo)</label>
          </div>
        ) : (
          <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={3} autoFocus placeholder="Por qué este compromiso no corresponde (obligatorio)…" className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-amber-400" />
        )}
      </Modal>
    </div>
  );
}

function Causal({ c }: { c: CausalCertificado }) {
  const est = c.estado === 'CUMPLIDA' ? { icon: '✅', cls: 'text-emerald-700' } : c.estado === 'NO_CUMPLIDA' ? { icon: '❌', cls: 'text-rose-700' } : { icon: '⏳', cls: 'text-amber-700' };
  return (
    <li className="text-[12.5px]">
      <div className="flex items-start gap-2">
        <span className="shrink-0">{est.icon}</span>
        <div className="min-w-0">
          <p className="text-zinc-800 leading-snug">{c.causal}{c.criticidadSospechosa && <span className="ml-1.5 text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">criticidad sospechosa</span>}</p>
          <p className={`text-[11.5px] ${est.cls}`}>
            {c.estado === 'CUMPLIDA' ? 'Cumplida' : c.estado === 'NO_CUMPLIDA' ? 'No cumple' : `Pendiente · ${MOTIVO_LABEL[c.motivoPendiente || ''] || ''}`}
            {c.fuente ? <span className="text-zinc-400"> · {c.fuente}</span> : null}
            {c.evidencia ? <span className="text-zinc-400"> · {c.evidencia}</span> : null}
          </p>
          {c.rutaCierre && <p className="text-[11.5px] text-zinc-500">→ {c.rutaCierre}</p>}
        </div>
      </div>
    </li>
  );
}

function LineaCompromisos({ l, items, abierta, onAlternar, ocupado, onRevisar, onConfirmar, onConfirmarTodos, onNoAplica, onRestaurar, onAgregar }: {
  l: LineaPrePostDTO; items: ItemPrePost[]; abierta: boolean; onAlternar: () => void; ocupado: string | null; onRevisar: () => void;
  onConfirmar: (id: number, v: boolean) => void; onConfirmarTodos: (ids: number[]) => void; onNoAplica: (id: number) => void; onRestaurar: (id: number) => void; onAgregar: () => void;
}) {
  const abiertos = items.filter(i => !i.confirmado && !i.noAplica);
  const sinOpcion = l.opcionAprobadaId == null;
  return (
    <li className="px-5 py-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onAlternar} className="flex items-center gap-1.5 text-left min-w-0">
          {abierta ? <ChevronDown size={13} className="text-zinc-400 shrink-0" /> : <ChevronRight size={13} className="text-zinc-400 shrink-0" />}
          <span className="text-[12.5px] font-bold text-zinc-800">Línea {l.item}</span>
          <span className="text-[12.5px] text-zinc-600 truncate max-w-[46ch]">{l.detalle}</span>
        </button>
        {sinOpcion ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-500">sin opción aprobada</span>
          : !l.revisada ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">sin revisar</span>
          : abiertos.length ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">{abiertos.length} por confirmar</span>
          : <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">{items.length ? 'todo confirmado' : 'sin compromisos'}</span>}
        {l.errorRevision && <span className="flex items-center gap-1 text-[11.5px] text-rose-600"><Alerta size={12} /> {l.errorRevision.slice(0, 120)}</span>}
        {!sinOpcion && (
          <button disabled={ocupado === `rev-${l.filaId}`} onClick={onRevisar} className="ml-auto flex items-center gap-1.5 px-2 py-1 rounded-md border border-zinc-200 text-[11.5px] font-semibold text-zinc-600 hover:bg-zinc-50 disabled:opacity-50">
            {ocupado === `rev-${l.filaId}` ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} {l.revisada ? 'Revisar de nuevo' : 'Revisar'}
          </button>
        )}
      </div>
      {abierta && (
        <div className="mt-2 ml-5 space-y-2">
          {items.length === 0 && <p className="text-[12px] text-zinc-400">{sinOpcion ? 'Aprueba la opción de esta línea en el Auditor para revisar sus compromisos.' : l.revisada ? 'La revisión no encontró compromisos técnico-administrativos en esta línea.' : 'Todavía no se revisa esta línea.'}</p>}
          {items.map(i => <ItemFila key={i.id} i={i} ocupado={ocupado} onConfirmar={v => onConfirmar(i.id, v)} onNoAplica={() => onNoAplica(i.id)} onRestaurar={() => onRestaurar(i.id)} />)}
          <div className="flex gap-2 pt-1">
            {abiertos.length > 1 && (
              <button disabled={ocupado === `lote-${l.filaId}`} onClick={() => onConfirmarTodos(abiertos.map(i => i.id))}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold hover:bg-emerald-700 disabled:opacity-50"><Check size={12} /> Confirmar los {abiertos.length} (ya los leí)</button>
            )}
            {!sinOpcion && <button onClick={onAgregar} className="px-2.5 py-1 rounded-lg border border-zinc-200 text-[12px] font-semibold text-zinc-600 hover:bg-zinc-50">+ Agregar compromiso</button>}
          </div>
        </div>
      )}
    </li>
  );
}

function ItemFila({ i, ocupado, onConfirmar, onNoAplica, onRestaurar }: { i: ItemPrePost; ocupado: string | null; onConfirmar: (v: boolean) => void; onNoAplica: () => void; onRestaurar: () => void }) {
  const o = ORIGEN_LABEL[i.origen];
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${i.noAplica ? 'border-zinc-200 bg-zinc-50 opacity-70' : i.confirmado ? 'border-emerald-200 bg-emerald-50/40' : 'border-zinc-200 bg-white'}`}>
      <div className="flex items-start gap-2.5">
        <input type="checkbox" checked={i.confirmado} disabled={i.noAplica || ocupado === `it-${i.id}`} onChange={e => onConfirmar(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-emerald-600" title="Confirmo este compromiso" />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[12.5px] font-semibold text-zinc-800">{materiaLegible(i.materia)}</span>
            <span className={`text-[10.5px] font-bold px-1.5 py-0.5 rounded ${o.cls}`}>{o.label}</span>
            {i.criticidad && i.criticidad !== 'SIN_CLASIFICAR' && <span className="text-[10.5px] text-zinc-400">{i.criticidad.toLowerCase()}</span>}
            {i.noAplica && <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-600">No aplica</span>}
          </div>
          <p className="text-[12px] text-zinc-600 leading-snug">«{i.exigeBaseLiteral}»{i.fuenteBases ? <span className="text-zinc-400"> — {i.fuenteBases}</span> : null}</p>
          <p className="text-[12px] text-zinc-800"><span className="text-zinc-400">Nos comprometemos a:</span> {i.seCompromete || 'no cuantificado'}</p>
          {i.origen === 'costo_asociado' && i.costo && (
            <p className={`text-[11.5px] ${i.costo.montoEstimado == null ? 'text-amber-700' : 'text-zinc-500'}`}>
              {i.costo.montoEstimado == null ? 'Costo sin estimar en el costeo (el margen real está sobreestimado).' : `Costo estimado en el costeo: ${new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(i.costo.montoEstimado)}`}
            </p>
          )}
          {i.noAplica && i.nota && <p className="text-[11.5px] text-zinc-500">Motivo: {i.nota}</p>}
          {i.confirmado && i.confirmadoPorNombre && <p className="text-[11px] text-emerald-700">Confirmado por {i.confirmadoPorNombre}{i.confirmadoAt ? ` · ${new Date(i.confirmadoAt).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}` : ''}</p>}
        </div>
        {i.origen !== 'costo_asociado' && (i.noAplica
          ? <button onClick={onRestaurar} className="text-[11.5px] font-semibold text-indigo-600 hover:underline whitespace-nowrap">Restaurar</button>
          : <button onClick={onNoAplica} className="text-[11.5px] font-semibold text-zinc-500 hover:text-zinc-800 whitespace-nowrap">No aplica</button>)}
      </div>
    </div>
  );
}
