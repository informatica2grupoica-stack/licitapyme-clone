'use client';

// PANEL DEL COMPARADOR DE FICHAS (PROMPT 4, PARTE XI — vista en pantalla) — dentro del modal del
// Auditor Técnico. Lo que muestra viene calculado por el servidor (comparador/route.ts): veredicto
// global, alerta de sobredimensionamiento, certificado de admisibilidad y bloqueos salen del
// código, no de la aritmética del modelo. Acá solo se dibuja y se dispara lo que una persona decide:
// elegir el modelo de un catálogo, confirmar un emparejamiento, marcar un compromiso, habilitar un dato.
import { useState, type ReactNode } from 'react';
import {
  IconLoader2 as Loader2, IconCopy as Copy, IconChevronDown as ChevronDown, IconChevronRight as ChevronRight,
  IconFileText as FileText, IconLock as Lock, IconCircleCheck as CircleCheck, IconAlertTriangle as AlertTriangle,
} from '@tabler/icons-react';
import { useToast } from '@/app/components/ui/toast';
import { urlComparador, type EstadoComparador, type FilaEstado } from '@/app/lib/auditor-comparador-cliente';
import type { OrigenDato, CriticidadP4 } from '@/app/lib/auditor-comparador-core';

const CRITICIDAD: Record<CriticidadP4, { label: string; cls: string }> = {
  INADMISIBLE: { label: 'INADMISIBLE', cls: 'bg-rose-100 text-rose-700' },
  PUNTAJE: { label: 'PUNTAJE', cls: 'bg-amber-100 text-amber-700' },
  COMPROMISO: { label: 'COMPROMISO', cls: 'bg-emerald-100 text-emerald-700' },
  SIN_CLASIFICAR: { label: 'SIN CLASIFICAR', cls: 'bg-zinc-200 text-zinc-700' },
};

const ORIGEN: Record<OrigenDato, { label: string; cls: string; title: string }> = {
  FICHA: { label: 'ficha', cls: 'bg-zinc-100 text-zinc-500', title: 'Escrito en el documento formal del fabricante o distribuidor' },
  CONFIRMACION_INFORMAL: { label: 'informal', cls: 'bg-amber-100 text-amber-700', title: 'Dato con respaldo de fuente informal (foto, captura, WhatsApp, correo): requiere habilitación del Encargado de Mercado Público' },
  DECLARADO: { label: 'declarado', cls: 'bg-amber-100 text-amber-700', title: 'La ficha calla y el asistente lo declara con respaldo: requiere habilitación del Encargado de Mercado Público' },
  CONTRADICE_FICHA: { label: 'contradice la ficha', cls: 'bg-rose-100 text-rose-700', title: 'La ficha dice lo contrario de lo declarado: requiere habilitación' },
  HEREDADO: { label: 'heredado', cls: 'bg-zinc-100 text-zinc-500', title: 'Proviene de la fase previa' },
  NO_LEGIBLE: { label: 'no legible', cls: 'bg-zinc-200 text-zinc-600', title: 'No se pudo leer' },
};

const ESTADO_STYLE = {
  NO_CUMPLIDA: { label: 'NO CUMPLE', cls: 'bg-rose-100 text-rose-700', borde: 'border-rose-200' },
  PENDIENTE: { label: 'PENDIENTE', cls: 'bg-sky-100 text-sky-700', borde: 'border-sky-200' },
  CUMPLIDA: { label: 'CUMPLE', cls: 'bg-emerald-100 text-emerald-700', borde: 'border-emerald-200' },
} as const;

function exigidoDe(f: FilaEstado): string {
  const u = f.unidad_requerida ? ` ${f.unidad_requerida}` : '';
  const pref = ({ PISO: '≥ ', TECHO: '≤ ', EXACTO: '= ', RANGO: '', CUALITATIVO: '', NORMATIVO: '' } as Record<string, string>)[f.tipo] ?? '';
  if (f.valor_requerido_numero != null && f.valor_requerido_numero !== 0) {
    return f.tipo === 'RANGO' && f.valor_requerido_numero_max != null
      ? `${f.valor_requerido_numero} a ${f.valor_requerido_numero_max}${u}` : `${pref}${f.valor_requerido_numero}${u}`;
  }
  return f.valor_requerido_texto || '—';
}
function ofertadoDe(f: FilaEstado): string {
  if (f.valor_ofertado_texto?.trim()) return f.unidad_ofertada_original && /^[\d.,\s]+$/.test(f.valor_ofertado_texto) ? `${f.valor_ofertado_texto} ${f.unidad_ofertada_original}` : f.valor_ofertado_texto;
  if (f.valor_ofertado_numero != null) return `${f.valor_convertido_numero ?? f.valor_ofertado_numero}${f.unidad_ofertada_original ? ` ${f.unidad_ofertada_original}` : ''}`;
  return 'no declarado en la ficha';
}

function useCopiar() {
  const [copiado, setCopiado] = useState<string | null>(null);
  const copiar = async (clave: string, texto: string) => {
    try { await navigator.clipboard.writeText(texto); setCopiado(clave); setTimeout(() => setCopiado(c => (c === clave ? null : c)), 1500); }
    catch { /* sin portapapeles (http o permisos) */ }
  };
  return { copiado, copiar };
}

// ════════════════════════════════════════════════════════════════════════════════
export function ComparadorFichasPanel({ estado, negocioId, itemId, puedeAprobar, bloqueado, onEstado, onElegirModelo, renderTabla }: {
  estado: EstadoComparador;
  negocioId: number;
  itemId: number;
  puedeAprobar: boolean;
  bloqueado: boolean;
  onEstado: (e: EstadoComparador) => void;
  /** Un catálogo con varios modelos espera que una persona elija: vuelve a comparar con esa elección. */
  onElegirModelo: (archivo: string, modelo: string) => Promise<void>;
  /** La tabla clásica (editar/responder una característica a mano). */
  renderTabla: () => ReactNode;
}) {
  const toast = useToast();
  const { copiado, copiar } = useCopiar();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [verTodas, setVerTodas] = useState(false);
  const [verFichas, setVerFichas] = useState(estado.requiere_confirmacion_modelo || estado.archivos_sin_asignar.length > 0 || estado.no_pude_leer.length > 0);
  const url = urlComparador(negocioId, itemId);

  const enviar = async (clave: string, body: Record<string, unknown>, avisoOk?: string) => {
    setOcupado(clave);
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.error || 'No se pudo guardar'); return null; }
      onEstado(d as EstadoComparador);
      if (avisoOk) toast.success(avisoOk);
      return d as EstadoComparador;
    } catch (e) { toast.error('Error de red', String(e)); return null; }
    finally { setOcupado(null); }
  };

  const confirmarPropuesta = async (f: FilaEstado, aceptar: boolean) => {
    const d = await enviar(`prop-${f.id}`, { accion: 'confirmar_propuesta', caracteristicaId: f.id, aceptar }, aceptar ? 'Propuesta confirmada' : 'Propuesta rechazada');
    // Un CUMPLE crítico que acaba de cerrarse por confirmación humana también se relee antes del certificado.
    if (d && aceptar && f.criticidad === 'INADMISIBLE') await enviar(`rev-${f.id}`, { accion: 'reverificar' });
  };

  const tecnicas = estado.caracteristicas.filter(f => f.analisis.ambito === 'tecnico');
  const porResolver = tecnicas.filter(f => f.estado !== 'CUMPLIDA');
  const noCumplen = estado.resumen.noCumplen;
  const pendientes = porResolver.filter(f => f.estado === 'PENDIENTE').length;
  const causalesAbiertas = estado.certificado_admisibilidad.filter(c => c.estado !== 'CUMPLIDA');
  const noCumplidas = causalesAbiertas.filter(c => c.estado === 'NO_CUMPLIDA').length;
  const pend = causalesAbiertas.length - noCumplidas;
  const adminPendientes = estado.tecnico_administrativo.filter(a => !a.check_confirmado).length;

  return (
    <div className="space-y-4">
      {/* Resumen — el veredicto global lo calcula el sistema, no el modelo. */}
      <div className="flex items-center gap-2 flex-wrap text-[11.5px] font-bold">
        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">{estado.resumen.cumplen} CUMPLE</span>
        {noCumplen > 0 && <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">{noCumplen} NO CUMPLE</span>}
        {pendientes > 0 && <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">{pendientes} PENDIENTE</span>}
        {estado.resumen.sobrecumplen > 0 && <span className="px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600">{estado.resumen.sobrecumplen} sobrecumplen</span>}
        <span className="text-zinc-400 font-medium">de {estado.resumen.total} características técnicas</span>
      </div>

      {estado.alerta_sobredimensionamiento.activa && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg border border-amber-200 bg-amber-50 text-[12px] text-amber-800">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{estado.alerta_sobredimensionamiento.mensaje}</span>
        </div>
      )}

      {/* ── Fichas: inventario y asignación ── */}
      <div className="border border-zinc-100 rounded-lg overflow-hidden">
        <button type="button" onClick={() => setVerFichas(v => !v)}
          className="w-full flex items-center gap-1.5 px-3 py-2 bg-zinc-50 text-left text-[11px] font-bold text-zinc-500 uppercase tracking-wide">
          {verFichas ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          Fichas cargadas ({estado.inventario_fichas.length})
          {estado.requiere_confirmacion_modelo && <span className="ml-2 normal-case text-amber-700">· elige el modelo del catálogo</span>}
        </button>
        {verFichas && (
          <div className="divide-y divide-zinc-100">
            {estado.inventario_fichas.length === 0 && <p className="px-3 py-2 text-[12px] text-zinc-400">Todavía no hay fichas: arrastra la ficha del producto a esta línea.</p>}
            {estado.inventario_fichas.map(f => {
              const asign = estado.mapa_asignacion.find(m => m.archivo === f.archivo);
              const sinAsignar = estado.archivos_sin_asignar.find(a => a.archivo === f.archivo);
              return (
                <div key={f.archivo} className="px-3 py-2.5 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <FileText size={13} className="text-zinc-400 flex-shrink-0" />
                    <span className="text-[12px] font-semibold text-zinc-800 break-all">{f.archivo}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500">{f.tipo.replace('_', ' ')}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${f.formalidad === 'informal' ? 'bg-amber-100 text-amber-700' : 'bg-zinc-100 text-zinc-500'}`}>{f.emisor} · {f.formalidad}</span>
                    {f.legibilidad !== 'completa' && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">legibilidad {f.legibilidad}</span>}
                    {f.duplicado_de && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500">duplicado de {f.duplicado_de}</span>}
                  </div>
                  {(f.marca || f.modelos.length > 0) && (
                    <p className="text-[11.5px] text-zinc-600">
                      {f.marca && <b>{f.marca}</b>} {f.modelos.join(' · ')}{f.tipo_equipo ? ` — ${f.tipo_equipo}` : ''}
                      {f.idioma_original && <span className="text-zinc-400"> · idioma {f.idioma_original}{f.traducido ? ' (traducido)' : ''}</span>}
                    </p>
                  )}
                  {f.no_legible_detalle && <p className="text-[11px] text-amber-700">No pude leer: {f.no_legible_detalle}</p>}
                  {sinAsignar && <p className="text-[11px] text-rose-600">Sin asignar — {sinAsignar.motivo}</p>}
                  {asign && !asign.confirmado_por_humano && (
                    <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50/70 p-2.5 space-y-1.5">
                      <p className="text-[11.5px] text-amber-800 font-semibold">Este documento trae varios modelos. Propongo, no elijo: confirma cuál se ofrece.</p>
                      <div className="flex flex-wrap gap-1.5">
                        {(f.candidatos.length ? f.candidatos : f.modelos.map(m => ({ modelo: m, razon: '' }))).map(c => (
                          <button key={c.modelo} disabled={bloqueado || ocupado != null}
                            onClick={async () => { setOcupado(`mod-${c.modelo}`); try { await onElegirModelo(f.archivo, c.modelo); } finally { setOcupado(null); } }}
                            title={c.razon}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11.5px] font-semibold rounded-lg bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 disabled:opacity-50">
                            {ocupado === `mod-${c.modelo}` && <Loader2 size={11} className="animate-spin" />} Usar el {c.modelo}
                          </button>
                        ))}
                      </div>
                      {f.candidatos[0]?.razon && <p className="text-[10.5px] text-amber-700">Mejor ajuste propuesto: {f.candidatos[0].modelo} — {f.candidatos[0].razon}</p>}
                    </div>
                  )}
                  {asign?.confirmado_por_humano && asign.modelo_propuesto && f.modelos.length > 1 && (
                    <p className="text-[11px] text-emerald-700">Modelo confirmado: {asign.modelo_propuesto}</p>
                  )}
                </div>
              );
            })}
            {estado.no_pude_leer.filter(x => !estado.inventario_fichas.some(f => f.archivo === x.archivo)).map((x, i) => (
              <p key={i} className="px-3 py-2 text-[11.5px] text-amber-700">No pude leer ({x.archivo}): {x.que}{x.donde ? ` — ${x.donde}` : ''}</p>
            ))}
          </div>
        )}
      </div>

      {/* ── Ítems que no quedaron cerrados como CUMPLE: con sus cinco campos de ayuda ── */}
      {porResolver.length > 0 && (
        <div className="space-y-2.5">
          <p className="text-[11.5px] font-bold text-zinc-500 uppercase tracking-wide">Por resolver ({porResolver.length})</p>
          {porResolver.map(f => (
            <TarjetaPendiente key={f.id} f={f} puedeAprobar={puedeAprobar} bloqueado={bloqueado} ocupado={ocupado} copiado={copiado} copiar={copiar}
              onConfirmar={confirmarPropuesta} onHabilitar={(fila, habilitar) => enviar(`hab-${fila.id}`, { accion: 'habilitar', caracteristicaId: fila.id, habilitar }, habilitar ? 'Dato habilitado' : 'Habilitación retirada')} />
          ))}
        </div>
      )}

      {/* ── Las características (tabla clásica, editable a mano) ── */}
      <div>
        <button type="button" onClick={() => setVerTodas(v => !v)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-violet-600 hover:text-violet-800">
          {verTodas ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Ver las {estado.caracteristicas.length} características
        </button>
        {verTodas && <div className="mt-2">{renderTabla()}</div>}
      </div>

      {/* ── Requisitos técnico-administrativos: precargados, se confirman uno a uno ── */}
      {estado.tecnico_administrativo.length > 0 && (
        <div className="border border-zinc-100 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-zinc-50 flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">Requisitos técnico-administrativos</p>
            <span className="text-[10.5px] text-zinc-400">{adminPendientes > 0 ? `${adminPendientes} por confirmar — bloquean igual que un NO CUMPLE` : 'todos confirmados'}</span>
          </div>
          <div className="divide-y divide-zinc-100">
            {estado.tecnico_administrativo.map(a => (
              <label key={a.id} className={`flex items-start gap-2.5 px-3 py-2.5 ${bloqueado ? '' : 'cursor-pointer hover:bg-zinc-50'}`}>
                <input type="checkbox" checked={a.check_confirmado} disabled={bloqueado || ocupado != null} className="mt-0.5 accent-emerald-600"
                  onChange={e => enviar(`adm-${a.id}`, { accion: 'check_administrativo', caracteristicaId: a.id, marcado: e.target.checked })} />
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] text-zinc-800 leading-snug">{a.exige_base_literal}</p>
                  <p className="text-[10.5px] text-zinc-400 mt-0.5">
                    Me comprometo exactamente a lo que exige la base (ni más ni menos) · {a.fuente_bases} · {a.materia}
                  </p>
                </div>
                {ocupado === `adm-${a.id}` ? <Loader2 size={13} className="animate-spin text-zinc-400 mt-0.5" /> : (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${CRITICIDAD[a.criticidad].cls}`}>{CRITICIDAD[a.criticidad].label}</span>
                )}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* ── Mensajes al proveedor: UNO por proveedor ── */}
      {estado.mensajes_proveedor.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11.5px] font-bold text-zinc-500 uppercase tracking-wide">Mensaje al proveedor</p>
          {estado.mensajes_proveedor.map(m => (
            <div key={m.proveedor} className="border border-zinc-100 rounded-lg p-3 bg-zinc-50/60">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <p className="text-[12px] font-semibold text-zinc-700">{m.proveedor} <span className="text-zinc-400 font-normal">· {m.productos_incluidos.join(', ')}</span></p>
                <button onClick={() => copiar(`msg-${m.proveedor}`, m.mensaje)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-600 hover:text-violet-800">
                  <Copy size={11} /> {copiado === `msg-${m.proveedor}` ? 'Copiado' : 'Copiar mensaje'}
                </button>
              </div>
              <pre className="text-[11.5px] text-zinc-600 whitespace-pre-wrap font-sans leading-snug">{m.mensaje}</pre>
            </div>
          ))}
        </div>
      )}

      {/* ── Certificado de admisibilidad ── */}
      {estado.certificado_admisibilidad.length > 0 && (
        <div className="border border-zinc-100 rounded-lg overflow-hidden">
          <p className="px-3 py-2 bg-zinc-50 text-[11px] font-bold text-zinc-500 uppercase tracking-wide">Certificado de admisibilidad</p>
          <div className="divide-y divide-zinc-100">
            {estado.certificado_admisibilidad.map(c => (
              <div key={c.caracteristica_id} className="px-3 py-2 flex items-start gap-2.5">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap mt-0.5 ${c.estado === 'CUMPLIDA' ? 'bg-emerald-100 text-emerald-700' : c.estado === 'NO_CUMPLIDA' ? 'bg-rose-100 text-rose-700' : 'bg-sky-100 text-sky-700'}`}>
                  {c.estado.replace('_', ' ')}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-zinc-800 leading-snug">{c.causal}</p>
                  <p className="text-[10.5px] text-zinc-400">{c.fuente}{c.ruta_cierre ? ` → ${c.ruta_cierre}` : ''}</p>
                </div>
              </div>
            ))}
          </div>
          <div className={`px-3 py-2.5 flex items-center gap-2 text-[12px] font-semibold ${causalesAbiertas.length ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
            {causalesAbiertas.length
              ? <><Lock size={13} /> No se puede aprobar la línea: {noCumplidas} causal(es) no cumplida(s), {pend} pendiente(s).</>
              : <><CircleCheck size={13} /> Todas las causales de inadmisibilidad de la línea están cumplidas.</>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Un ítem no cerrado: brecha, causa, pregunta lista para enviar, equivalencia y ruta ─────────
function TarjetaPendiente({ f, puedeAprobar, bloqueado, ocupado, copiado, copiar, onConfirmar, onHabilitar }: {
  f: FilaEstado; puedeAprobar: boolean; bloqueado: boolean; ocupado: string | null; copiado: string | null;
  copiar: (clave: string, texto: string) => void;
  onConfirmar: (f: FilaEstado, aceptar: boolean) => Promise<void>;
  onHabilitar: (f: FilaEstado, habilitar: boolean) => Promise<unknown>;
}) {
  const a = f.analisis;
  const est = ESTADO_STYLE[f.estado];
  const origen = a.origen_dato ? ORIGEN[a.origen_dato] : null;
  const prop = a.propuesta && a.propuesta.confirmado == null ? a.propuesta : null;
  const ayuda = a.ayuda;
  const necesitaHabilitar = f.veredicto === 'CUMPLE' && (a.requiere_habilitacion === 'EM' || a.requiere_habilitacion === 'CA');

  return (
    <div className={`rounded-lg border ${est.borde} bg-white p-3 space-y-2`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10.5px] font-bold px-1.5 py-0.5 rounded ${est.cls}`}>
          {f.estado === 'PENDIENTE' && f.veredicto === 'CUMPLE' ? 'CUMPLE — falta cerrar' : est.label}
        </span>
        <span className="text-[12.5px] font-semibold text-zinc-800">{f.descripcion}</span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${CRITICIDAD[f.criticidad].cls}`}>{CRITICIDAD[f.criticidad].label}</span>
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500">{f.tipo}</span>
        {origen && <span title={origen.title} className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${origen.cls}`}>{origen.label}</span>}
      </div>

      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-[11.5px]">
        <p><span className="text-zinc-400">Exigido:</span> <b className="text-zinc-800">{exigidoDe(f)}</b> <span className="text-zinc-400">· {a.fuente_bases || 'Bases técnicas'}</span></p>
        <p><span className="text-zinc-400">Ofertado:</span> <b className="text-zinc-800">{ofertadoDe(f)}</b>{a.fuente_ficha && <span className="text-zinc-400"> · {a.fuente_ficha}</span>}</p>
      </div>
      {a.puntaje_en_riesgo && <p className="text-[11px] text-amber-700">Puntaje en riesgo: {a.puntaje_en_riesgo}</p>}

      {a.notas_sistema?.map((n, i) => <p key={i} className="text-[11px] text-zinc-500 bg-zinc-50 rounded px-2 py-1">⚙ {n}</p>)}
      {a.rectificacion && <p className="text-[11.5px] text-rose-700 bg-rose-50 rounded px-2 py-1">Rectificado en la segunda lectura: {a.rectificacion}</p>}

      {prop && (
        <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-2.5 space-y-1.5">
          <p className="text-[11.5px] text-violet-900 leading-snug">
            Las bases piden <b>{prop.parametro_bases}</b>. La ficha declara <b>{prop.parametro_ficha || '(sin indicar)'}</b>, que interpreto como {prop.tipo === 'equivalencia_normativa' ? 'una norma equivalente' : 'el mismo parámetro'}
            {prop.razon ? ` porque ${prop.razon}` : ''}. <b>{prop.tipo === 'equivalencia_normativa' ? 'CONFIRMA ESTA EQUIVALENCIA.' : 'CONFIRMA ESTE EMPAREJAMIENTO.'}</b>
          </p>
          {prop.fuente_equivalencia && <p className="text-[10.5px] text-violet-700">Fuente de la equivalencia: {prop.fuente_equivalencia}</p>}
          {prop.veredicto_propuesto && <p className="text-[10.5px] text-violet-700">Si lo confirmas, el ítem queda: {prop.veredicto_propuesto.replace(/_/g, ' ')}.</p>}
          {!bloqueado && (
            <div className="flex items-center gap-2">
              <button disabled={ocupado != null} onClick={() => onConfirmar(f, true)} className="px-2.5 py-1 bg-violet-600 hover:bg-violet-700 text-white text-[11.5px] font-semibold rounded-lg disabled:opacity-50">
                {ocupado?.startsWith(`prop-${f.id}`) || ocupado === `rev-${f.id}` ? <Loader2 size={11} className="animate-spin inline" /> : 'Confirmar'}
              </button>
              <button disabled={ocupado != null} onClick={() => onConfirmar(f, false)} className="text-[11.5px] font-semibold text-zinc-500 hover:text-zinc-800 disabled:opacity-50">No es equivalente</button>
            </div>
          )}
        </div>
      )}

      {a.conflicto_fuentes?.existe && (
        <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-2.5 space-y-1">
          <p className="text-[11.5px] font-semibold text-rose-800">Conflicto de fuentes — dos documentos dicen cosas distintas (no elijo):</p>
          {a.conflicto_fuentes.versiones.map((v, i) => <p key={i} className="text-[11.5px] text-rose-900"><b>{v.documento}</b>: {v.valor} <span className="text-rose-500">· {v.cita}</span></p>)}
        </div>
      )}

      {necesitaHabilitar && (
        <div className="flex items-center gap-2 flex-wrap text-[11.5px]">
          <span className="text-amber-700">Dato de origen {a.origen_dato === 'CONFIRMACION_INFORMAL' ? 'informal' : a.origen_dato === 'CONTRADICE_FICHA' ? 'que contradice la ficha' : 'declarado'}: requiere habilitación del Encargado de Mercado Público.</span>
          {puedeAprobar && !bloqueado && (
            <button disabled={ocupado != null} onClick={() => onHabilitar(f, true)} className="px-2 py-0.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold disabled:opacity-50">Habilitar</button>
          )}
        </div>
      )}

      {ayuda && (ayuda.diagnostico || ayuda.hipotesis_causa.length > 0 || ayuda.pregunta_proveedor || ayuda.veredicto_equivalencia || ayuda.ruta) && (
        <div className="space-y-1.5 text-[11.5px] text-zinc-700 leading-snug border-t border-zinc-100 pt-2">
          {ayuda.diagnostico && <p><b className="text-zinc-500">Diagnóstico:</b> {ayuda.diagnostico}</p>}
          {ayuda.hipotesis_causa.length > 0 && <p><b className="text-zinc-500">Causa probable:</b> {ayuda.hipotesis_causa.join(' · ')}</p>}
          {ayuda.pregunta_proveedor && (
            <div className="rounded-lg bg-zinc-50 px-2.5 py-2 flex items-start gap-2">
              <p className="flex-1"><b className="text-zinc-500">Pregunta al proveedor:</b> “{ayuda.pregunta_proveedor}”</p>
              <button onClick={() => copiar(`preg-${f.id}`, ayuda.pregunta_proveedor)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-600 hover:text-violet-800 flex-shrink-0">
                <Copy size={11} /> {copiado === `preg-${f.id}` ? 'Copiado' : 'Copiar'}
              </button>
            </div>
          )}
          {ayuda.veredicto_equivalencia && <p><b className="text-zinc-500">Por qué no satisface lo exigido:</b> {ayuda.veredicto_equivalencia}</p>}
          {ayuda.ruta && (
            <p>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded mr-1.5 ${ayuda.ruta === 'SALVABLE' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{ayuda.ruta}</span>
              {ayuda.accion_concreta || (ayuda.ruta === 'INSALVABLE' ? 'Volver a la búsqueda de producto.' : '')}
            </p>
          )}
        </div>
      )}

      <p className="text-[10.5px] text-zinc-400">Para cerrarlo: {f.ruta_cierre}</p>
    </div>
  );
}
