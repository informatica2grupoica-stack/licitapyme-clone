'use client';

// ENTREGA DE PROYECTOS (Frente F.1, Fase 4) — los proyectos que GANAMOS, con su resumen ejecutivo
// y el estado de acuse de recibo de cada involucrado.
//
// Es una vista de TRABAJO, no un panel de administración: cada persona del circuito entra, lee el
// resumen del proyecto y acusa recibo. Por eso vive en el grupo PRINCIPAL del menú (sigue el ciclo
// Negocios → Postuladas → Ganadas/Perdidas → Entregas) y no en ADMIN.
import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { Banner } from '@/app/components/ui/Banner';
import { useRealtime } from '@/app/lib/use-realtime';
import {
  Trophy, Loader2, Inbox, CheckCircle2, Clock, Building2, User, FileText,
  Users, AlertTriangle, ExternalLink, ChevronDown, ChevronRight,
} from 'lucide-react';

interface Entrega {
  negocioId: number;
  licitacionCodigo: string;
  licitacionNombre: string | null;
  organismo: string | null;
  abiertaAt: string;
  completadaAt: string | null;
  miAcuse: string | null;
  acusados: number;
  totalAcuses: number;
  resumen: any;
}

const clp = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

const fecha = (f: string | null) => {
  if (!f) return '—';
  const d = new Date(f);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function EntregasPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const toast = useToast();

  const [entregas, setEntregas] = useState<Entrega[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<number | null>(null);
  const [enviando, setEnviando] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/entregas');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setEntregas(data.entregas || []);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (!cargandoSesion) cargar(); }, [cargandoSesion, cargar]);
  useRealtime(cargar);

  const acusar = async (negocioId: number) => {
    setEnviando(negocioId);
    try {
      const res = await fetch('/api/entregas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ negocioId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo registrar');
      toast.success('Acuse de recibo registrado',
        data.completada ? 'Todos los involucrados ya reconocieron el proyecto.' : 'Queda registrado que recibiste el proyecto.');
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo registrar el acuse', e.message);
    } finally {
      setEnviando(null);
    }
  };

  const pendientes = entregas.filter(e => !e.miAcuse);

  return (
    <AppLayout title="Entregas" breadcrumb={[{ label: 'Entregas' }]}>
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-start gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center flex-shrink-0">
            <Trophy size={19} className="text-amber-500" />
          </div>
          <div>
            <h1 className="text-[19px] font-bold text-zinc-900">Entrega de proyectos</h1>
            <p className="text-[13px] text-zinc-500 mt-0.5">
              Proyectos ganados según el acta de Mercado Público, con lo que se comprometió al postular.
            </p>
          </div>
        </div>

        {pendientes.length > 0 && (
          <Banner variante="warning" className="mb-5">
            {pendientes.length === 1
              ? 'Tienes 1 proyecto ganado esperando tu acuse de recibo.'
              : `Tienes ${pendientes.length} proyectos ganados esperando tu acuse de recibo.`}
          </Banner>
        )}

        {error && <Banner variante="error" className="mb-5">{error}</Banner>}

        {loading ? (
          <div className="flex items-center justify-center py-20 text-zinc-400">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : entregas.length === 0 ? (
          <div className="text-center py-20">
            <Inbox size={34} className="mx-auto text-zinc-300" />
            <p className="text-[14px] font-semibold text-zinc-600 mt-3">Todavía no hay proyectos ganados por entregar</p>
            <p className="text-[12.5px] text-zinc-400 mt-1 max-w-md mx-auto">
              Cuando Mercado Público publique un acta donde ganemos, el proyecto aparece acá
              automáticamente con su resumen ejecutivo.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {entregas.map(e => {
              const expandida = abierta === e.negocioId;
              const r = e.resumen || {};
              return (
                <div key={e.negocioId} className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
                  {/* ── Cabecera de la tarjeta ── */}
                  <button
                    onClick={() => setAbierta(expandida ? null : e.negocioId)}
                    className="w-full px-4 py-3.5 flex items-start gap-3 text-left hover:bg-zinc-50 transition-colors"
                  >
                    <span className="mt-0.5 text-zinc-400 flex-shrink-0">
                      {expandida ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold text-zinc-900 leading-snug">
                        {e.licitacionNombre || e.licitacionCodigo}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11.5px] text-zinc-500">
                        <span className="font-mono">{e.licitacionCodigo}</span>
                        {e.organismo && <span className="inline-flex items-center gap-1"><Building2 size={11} />{e.organismo}</span>}
                        <span>Ganado el {fecha(e.abiertaAt)}</span>
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                          {clp(r.montoNuestro)}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      {e.miAcuse ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                          <CheckCircle2 size={11} /> Recibido
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                          <Clock size={11} /> Falta tu acuse
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
                        <Users size={11} /> {e.acusados}/{e.totalAcuses} recibieron
                      </span>
                    </div>
                  </button>

                  {/* ── Resumen ejecutivo ── */}
                  {expandida && (
                    <div className="border-t border-zinc-100 px-4 py-4 bg-zinc-50/60 space-y-4">
                      {Array.isArray(r.faltantes) && r.faltantes.length > 0 && (
                        <div className="flex items-start gap-2 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="font-semibold">Este resumen quedó incompleto:</p>
                            <ul className="mt-1 space-y-0.5 list-disc list-inside">
                              {r.faltantes.map((f: string, i: number) => <li key={i}>{f}</li>)}
                            </ul>
                          </div>
                        </div>
                      )}

                      {/* Qué ganamos / por qué */}
                      <div className="grid sm:grid-cols-3 gap-3">
                        <Dato etiqueta="Ofertamos" valor={clp(r.montoOfertado)} />
                        <Dato etiqueta="Nos adjudicaron" valor={clp(r.montoNuestro)} destacado />
                        <Dato etiqueta="Competencia" valor={r.numeroOferentes != null ? `${r.numeroOferentes} oferentes` : '—'} />
                        <Dato etiqueta="Empresa del grupo" valor={r.empresaNombre || '—'} />
                        <Dato etiqueta="Responsable" valor={r.responsableNombre || '—'} />
                        <Dato etiqueta="Total adjudicado" valor={clp(r.montoAdjudicadoTotal)} />
                      </div>

                      {Array.isArray(r.competidoresAdjudicados) && r.competidoresAdjudicados.length > 0 && (
                        <Seccion titulo="Otros adjudicados en esta licitación">
                          <ul className="space-y-1">
                            {r.competidoresAdjudicados.map((c: any, i: number) => (
                              <li key={i} className="text-[12.5px] text-zinc-700">
                                {c.proveedor || c.rut || 'Sin identificar'}
                                <span className="text-zinc-400"> · {c.lineas} línea{c.lineas !== 1 ? 's' : ''}</span>
                              </li>
                            ))}
                          </ul>
                        </Seccion>
                      )}

                      {Array.isArray(r.plazosComprometidos) && r.plazosComprometidos.length > 0 && (
                        <Seccion titulo="Plazos comprometidos">
                          <ul className="space-y-1">
                            {r.plazosComprometidos.map((p: any, i: number) => (
                              <li key={i} className="text-[12.5px] text-zinc-700">
                                <span className="text-zinc-500">{p.titulo}:</span> {p.valor || '—'}
                              </li>
                            ))}
                          </ul>
                        </Seccion>
                      )}

                      {Array.isArray(r.compromisosPostventa) && r.compromisosPostventa.length > 0 && (
                        <Seccion titulo="Compromisos de postventa">
                          <ul className="space-y-1">
                            {r.compromisosPostventa.map((p: any, i: number) => (
                              <li key={i} className="text-[12.5px] text-zinc-700">
                                <span className="text-zinc-500">{p.titulo}:</span> {p.descripcion || '—'}
                              </li>
                            ))}
                          </ul>
                        </Seccion>
                      )}

                      {r.contactosCliente && (
                        <Seccion titulo="Contacto del cliente">
                          <div className="text-[12.5px] text-zinc-700 space-y-0.5">
                            <p>{r.contactosCliente.organismo || '—'}{r.contactosCliente.unidad ? ` · ${r.contactosCliente.unidad}` : ''}</p>
                            {r.contactosCliente.direccion && (
                              <p className="text-zinc-500">
                                {r.contactosCliente.direccion}
                                {r.contactosCliente.comuna ? `, ${r.contactosCliente.comuna}` : ''}
                                {r.contactosCliente.region ? `, ${r.contactosCliente.region}` : ''}
                              </p>
                            )}
                            {r.contactosCliente.usuarioNombre && (
                              <p className="inline-flex items-center gap-1 text-zinc-600">
                                <User size={11} /> {r.contactosCliente.usuarioNombre}
                                {r.contactosCliente.usuarioCargo ? ` — ${r.contactosCliente.usuarioCargo}` : ''}
                              </p>
                            )}
                          </div>
                        </Seccion>
                      )}

                      {r.matrizTecnica && r.matrizTecnica.total > 0 && (
                        <Seccion titulo="Matriz técnica aprobada">
                          <p className="text-[12.5px] text-zinc-700">
                            {r.matrizTecnica.cumplen} cumplen · {r.matrizTecnica.conComplemento} con complemento ·{' '}
                            {r.matrizTecnica.noCumplen} no cumplen <span className="text-zinc-400">(de {r.matrizTecnica.total})</span>
                          </p>
                        </Seccion>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {r.urlActa && (
                          <a
                            href={r.urlActa} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-zinc-600 border border-zinc-200 bg-white hover:bg-zinc-50 transition-colors"
                          >
                            <FileText size={12} /> Ver acta en Mercado Público <ExternalLink size={11} />
                          </a>
                        )}
                        <a
                          href={`/negocios/${e.negocioId}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-zinc-600 border border-zinc-200 bg-white hover:bg-zinc-50 transition-colors"
                        >
                          Abrir el negocio
                        </a>
                        {!e.miAcuse && (
                          <button
                            onClick={() => acusar(e.negocioId)}
                            disabled={enviando === e.negocioId}
                            className="ml-auto inline-flex items-center gap-2 px-4 py-1.5 rounded-lg text-[12.5px] font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-60 transition-colors"
                          >
                            {enviando === e.negocioId
                              ? <><Loader2 size={13} className="animate-spin" /> Registrando…</>
                              : 'Acuso recibo'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function Dato({ etiqueta, valor, destacado }: { etiqueta: string; valor: string; destacado?: boolean }) {
  return (
    <div className="bg-white border border-zinc-200 rounded-lg px-3 py-2">
      <p className="text-[10.5px] font-semibold text-zinc-400 uppercase tracking-wide">{etiqueta}</p>
      <p className={`text-[13px] mt-0.5 ${destacado ? 'font-bold text-emerald-700' : 'font-semibold text-zinc-800'}`}>{valor}</p>
    </div>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10.5px] font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">{titulo}</p>
      {children}
    </div>
  );
}
