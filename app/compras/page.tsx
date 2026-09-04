'use client';

// MÓDULO DE COMPRAS — listado transversal (Fase 1, spec §3-§5). Un negocio ganado por fila: quién
// lo tiene, si vence el plazo de asignación, si es urgente y cuánto avanzó de sus tareas. El
// detalle completo (resumen ejecutivo + tareas) vive en la pestaña "Compras" de cada negocio.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { Banner } from '@/app/components/ui/Banner';
import { MultiSelect } from '@/app/components/ui/MultiSelect';
import { Select } from '@/app/components/ui/Select';
import { colorUsuario } from '@/app/lib/user-color';
import {
  ShoppingCart, Loader2, Building2, ArrowUpRight, Search, Filter, X, Calendar,
  Users, ArrowUpDown, AlertTriangle, Clock, UserPlus, CheckCircle2,
} from 'lucide-react';

interface ComprasFila {
  negocioId: number; licitacionCodigo: string; licitacionNombre: string | null; licitacionOrganismo: string | null;
  urgente: boolean; asignadoA: number | null; asignadoNombre: string | null; asignadoAt: string | null;
  vencimientoAsignacionAt: string; ganadoAt: string; montoNuestro: number | null;
  tareasTotal: number; tareasHechas: number; tareasVencidas: number;
}
interface Candidato { id: number; nombre: string | null; carga: number }

type Orden = 'reciente' | 'antiguo' | 'monto_desc' | 'monto_asc';

const fmtCLP = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const fmtFecha = (s: string) => {
  try { return new Date(s.replace(' ', 'T')).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return s; }
};

function FilaCompras({ f, esJefeDeVentas, candidatos, onAsignado }: {
  f: ComprasFila; esJefeDeVentas: boolean; candidatos: Candidato[]; onAsignado: () => void;
}) {
  const toast = useToast();
  const [candidatoElegido, setCandidatoElegido] = useState('');
  const [asignando, setAsignando] = useState(false);
  const vencimientoPasado = new Date(f.vencimientoAsignacionAt.replace(' ', 'T')).getTime() < Date.now();

  const asignar = async () => {
    if (!candidatoElegido) return;
    setAsignando(true);
    try {
      const res = await fetch(`/api/compras/${f.negocioId}/asignar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encargadoId: Number(candidatoElegido) }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo asignar');
      toast.success('Encargado asignado');
      onAsignado();
    } catch (e: any) {
      toast.error('No se pudo asignar', e.message);
    } finally {
      setAsignando(false);
    }
  };

  return (
    <div className={`bg-white rounded-xl border overflow-hidden ${f.urgente ? 'border-rose-200' : 'border-zinc-200'}`}>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[11px] font-mono text-zinc-400">{f.licitacionCodigo}</p>
            <span className="text-[10.5px] text-zinc-400">Ganado {fmtFecha(f.ganadoAt)}</span>
            {f.urgente && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full">
                <AlertTriangle size={10} /> Urgente
              </span>
            )}
          </div>
          <Link href={`/negocios/${f.negocioId}?seccion=compras`} className="block text-[13.5px] font-bold text-zinc-800 hover:text-teal-700 leading-snug mt-0.5">
            {f.licitacionNombre || f.licitacionCodigo}
          </Link>
          <div className="flex items-center gap-3 mt-1 text-[11.5px] text-zinc-500 flex-wrap">
            {f.licitacionOrganismo && <span className="flex items-center gap-1"><Building2 size={11} /> {f.licitacionOrganismo}</span>}
            {f.tareasTotal > 0 && (
              <span className={`flex items-center gap-1 ${f.tareasVencidas > 0 ? 'text-rose-600 font-semibold' : ''}`}>
                <CheckCircle2 size={11} /> {f.tareasHechas}/{f.tareasTotal} tareas
                {f.tareasVencidas > 0 && ` · ${f.tareasVencidas} vencida(s)`}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-[12px] font-semibold text-zinc-600">{fmtCLP(f.montoNuestro)}</span>
          <Link href={`/negocios/${f.negocioId}?seccion=compras`} className="text-zinc-400 hover:text-teal-600"><ArrowUpRight size={16} /></Link>
        </div>
      </div>

      <div className="border-t border-zinc-100 px-4 py-2.5 bg-zinc-50/60 flex items-center justify-between gap-3 flex-wrap">
        {f.asignadoA ? (
          <p className="text-[12px] text-zinc-600">
            <span className="font-semibold text-zinc-800">{f.asignadoNombre}</span>
            <span className="text-zinc-400"> — asignado {fmtFecha(f.asignadoAt || f.ganadoAt)}</span>
          </p>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[11.5px] flex items-center gap-1 ${vencimientoPasado ? 'text-rose-600 font-semibold' : 'text-amber-600'}`}>
              <Clock size={12} /> {vencimientoPasado ? 'Plazo vencido — se asigna solo' : `Sin asignar (vence ${fmtFecha(f.vencimientoAsignacionAt)})`}
            </span>
            {esJefeDeVentas && (
              <>
                <Select
                  value={candidatoElegido} onChange={setCandidatoElegido}
                  placeholder="Elegir encargado…" minWidth={200}
                  options={candidatos.map(c => ({ value: String(c.id), label: `${c.nombre || `Usuario ${c.id}`} (${c.carga})` }))}
                />
                <button onClick={asignar} disabled={!candidatoElegido || asignando}
                  className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">
                  {asignando ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />} Asignar
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ComprasPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const router = useRouter();
  const [negocios, setNegocios] = useState<ComprasFila[]>([]);
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [fAsignado, setFAsignado] = useState<string[]>([]);
  const [soloUrgentes, setSoloUrgentes] = useState(false);
  const [soloSinAsignar, setSoloSinAsignar] = useState(false);
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [orden, setOrden] = useState<Orden>('reciente');

  const hayFiltro = fAsignado.length > 0 || soloUrgentes || soloSinAsignar || !!fechaDesde || !!fechaHasta;
  const limpiar = () => { setFAsignado([]); setSoloUrgentes(false); setSoloSinAsignar(false); setFechaDesde(''); setFechaHasta(''); };

  const esAdmin = usuario?.rol === 'admin';
  const puedeVer = esAdmin || !!usuario?.permisos?.compras || !!usuario?.permisos?.aprobar_comercial;
  const esJefeDeVentas = esAdmin || !!usuario?.permisos?.aprobar_comercial;

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/compras');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setNegocios(data.negocios || []);
      setCandidatos(data.candidatos || []);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cargandoSesion) return;
    if (!puedeVer) { router.replace('/dashboard'); return; }
    cargar();
  }, [cargandoSesion, puedeVer, router, cargar]);

  const opciones = useMemo(() => {
    const asig = new Map<string, { nombre: string; n: number }>();
    for (const f of negocios) {
      if (f.asignadoNombre) {
        const key = String(f.asignadoA || f.asignadoNombre);
        const cur = asig.get(key) || { nombre: f.asignadoNombre, n: 0 }; cur.n++; asig.set(key, cur);
      }
    }
    return {
      asignado: [...asig.entries()].sort((a, b) => b[1].n - a[1].n)
        .map(([v, o]) => ({ value: v, label: o.nombre, color: colorUsuario(v), count: o.n })),
    };
  }, [negocios]);

  const filtrados = useMemo(() => {
    const qn = q.trim().toLowerCase();
    const arr = negocios.filter(f => {
      if (qn) {
        const hay = [f.licitacionNombre, f.licitacionCodigo, f.licitacionOrganismo, f.asignadoNombre]
          .filter(Boolean).some(v => String(v).toLowerCase().includes(qn));
        if (!hay) return false;
      }
      if (fAsignado.length > 0 && !fAsignado.includes(String(f.asignadoA || f.asignadoNombre || ''))) return false;
      if (soloUrgentes && !f.urgente) return false;
      if (soloSinAsignar && f.asignadoA != null) return false;
      const dia = f.ganadoAt.slice(0, 10);
      if (fechaDesde && dia < fechaDesde) return false;
      if (fechaHasta && dia > fechaHasta) return false;
      return true;
    });
    const t = (s: string) => new Date(s.replace(' ', 'T')).getTime();
    arr.sort((a, b) => {
      switch (orden) {
        case 'antiguo':    return t(a.ganadoAt) - t(b.ganadoAt);
        case 'monto_desc': return (b.montoNuestro ?? -1) - (a.montoNuestro ?? -1);
        case 'monto_asc':  return (a.montoNuestro ?? -1) - (b.montoNuestro ?? -1);
        default:           return t(b.ganadoAt) - t(a.ganadoAt);
      }
    });
    // Urgentes siempre primero, dentro del orden elegido.
    arr.sort((a, b) => Number(b.urgente) - Number(a.urgente));
    return arr;
  }, [negocios, q, fAsignado, soloUrgentes, soloSinAsignar, fechaDesde, fechaHasta, orden]);

  if (cargandoSesion || (!puedeVer && loading)) {
    return (
      <AppLayout breadcrumb={[{ label: 'Compras' }]}>
        <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="w-6 h-6 animate-spin text-zinc-400" /></div>
      </AppLayout>
    );
  }
  if (!puedeVer) return null;

  return (
    <AppLayout breadcrumb={[{ label: 'Compras' }]}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center flex-shrink-0">
              <ShoppingCart size={17} className="text-teal-600" />
            </div>
            <div>
              <h1 className="text-[16px] font-bold text-zinc-900 leading-tight">Compras</h1>
              <p className="text-[12px] text-zinc-500">
                {negocios.length === 0 ? 'Sin negocios ganados todavía'
                  : hayFiltro || q ? `${filtrados.length} de ${negocios.length} negocio(s)`
                  : `${negocios.length} negocio(s) ganado(s)`}
              </p>
            </div>
          </div>
          {negocios.length > 0 && (
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar nombre, código, organismo o encargado…"
                className="pl-8 pr-3 py-2 text-[13px] border border-zinc-200 rounded-lg focus:ring-1 focus:ring-teal-500 outline-none w-72" />
            </div>
          )}
        </div>

        {error && <Banner variante="error" accion={{ label: 'Reintentar', onClick: cargar }}>{error}</Banner>}

        {!loading && negocios.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-zinc-400 font-medium flex items-center gap-1"><Filter size={13} /> Filtrar:</span>
            {opciones.asignado.length > 0 && (
              <MultiSelect label="Encargado" icon={<Users size={13} />} options={opciones.asignado} selected={fAsignado} onChange={setFAsignado} minWidth={220} />
            )}
            <button onClick={() => setSoloUrgentes(v => !v)}
              className={`inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-2 rounded-lg border transition-colors ${
                soloUrgentes ? 'text-rose-700 bg-rose-50 border-rose-200' : 'text-zinc-500 bg-white border-zinc-200 hover:bg-zinc-50'
              }`}>
              <AlertTriangle size={12} /> Urgentes
            </button>
            <button onClick={() => setSoloSinAsignar(v => !v)}
              className={`inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-2 rounded-lg border transition-colors ${
                soloSinAsignar ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-zinc-500 bg-white border-zinc-200 hover:bg-zinc-50'
              }`}>
              <Clock size={12} /> Sin asignar
            </button>
            <div className="flex items-center gap-1.5 border border-zinc-200 rounded-lg px-2.5 py-1">
              <Calendar size={13} className="text-zinc-400 flex-shrink-0" />
              <span className="text-[11px] font-semibold text-zinc-500">Ganado</span>
              <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
                max={fechaHasta || undefined}
                className="text-[12px] text-zinc-700 bg-transparent outline-none w-[118px]" title="Ganado desde" />
              <span className="text-zinc-300">–</span>
              <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
                min={fechaDesde || undefined}
                className="text-[12px] text-zinc-700 bg-transparent outline-none w-[118px]" title="Ganado hasta" />
              {(fechaDesde || fechaHasta) && (
                <button onClick={() => { setFechaDesde(''); setFechaHasta(''); }}
                  title="Quitar rango de fecha" className="text-zinc-400 hover:text-red-600 flex-shrink-0"><X size={12} /></button>
              )}
            </div>
            {hayFiltro && (
              <button onClick={limpiar}
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 px-2.5 py-2 rounded-lg transition-colors">
                <X size={12} /> Limpiar
              </button>
            )}
            <div className="inline-flex items-center gap-1.5 ml-auto">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-400"><ArrowUpDown size={12} /> Ordenar</span>
              <Select value={orden} onChange={v => setOrden(v as Orden)}
                options={[
                  { value: 'reciente', label: 'Ganado reciente' },
                  { value: 'antiguo', label: 'Ganado más antiguo' },
                  { value: 'monto_desc', label: 'Monto (mayor)' },
                  { value: 'monto_asc', label: 'Monto (menor)' },
                ]} />
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>
        ) : negocios.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
            <ShoppingCart size={28} className="text-zinc-300" />
            <p className="text-[13.5px] font-semibold text-zinc-500">Todavía no hay ningún negocio ganado</p>
            <p className="text-[12px] text-zinc-400">Cuando Mercado Público confirme que ganamos, aparece acá para asignar encargado.</p>
          </div>
        ) : filtrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
            <Search size={28} className="text-zinc-300" />
            <p className="text-[13.5px] font-semibold text-zinc-500">Sin resultados</p>
            <p className="text-[12px] text-zinc-400">Ningún negocio coincide con la búsqueda o los filtros.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtrados.map(f => (
              <FilaCompras key={f.negocioId} f={f} esJefeDeVentas={esJefeDeVentas} candidatos={candidatos} onAsignado={cargar} />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
