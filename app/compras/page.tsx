'use client';

// MÓDULO COMPRAS (Auditor Técnico, Fase 7, spec §12) — destino del paquete de traspaso que se
// arma al congelar el Auditor Técnico (al postular). Solo lectura: el paquete ya quedó fijo en
// ese momento (app/lib/congelamiento.ts), acá solo se consulta.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { Banner } from '@/app/components/ui/Banner';
import { MultiSelect } from '@/app/components/ui/MultiSelect';
import { Select } from '@/app/components/ui/Select';
import { colorUsuario } from '@/app/lib/user-color';
import {
  ShoppingCart, Loader2, Package, Building2, ArrowUpRight, ChevronDown, ChevronUp,
  Search, Filter, X, Calendar, Users, UserCheck, ArrowUpDown,
} from 'lucide-react';

interface Caracteristica { descripcion: string; veredicto: string | null; fundamentoCita: string | null }
interface PaqueteTraspaso {
  productoValidado: Array<{ linea: number | null; titulo: string; caracteristicas: Caracteristica[] }>;
  costeo: { totalCostoNeto: number | null; totalPrecioNeto: number | null; archivoNombre: string | null; version: number | null } | null;
  plazosComprometidos: Array<{ titulo: string; valor: string | null }>;
  matrizTecnicaAprobada: { total: number; cumplen: number; noCumplen: number; conComplemento: number };
  compromisosPostventa: Array<{ titulo: string; descripcion: string | null }>;
  contactosCliente: { organismo: string | null; unidad: string | null; direccion: string | null; comuna: string | null; region: string | null; usuarioNombre: string | null; usuarioCargo: string | null } | null;
}
interface PaqueteFila {
  negocioId: number; licitacionCodigo: string; licitacionNombre: string | null; licitacionOrganismo: string | null;
  asignadoId: number | null; asignadoNombre: string | null; asignadoEmail: string | null;
  congeladoAt: string; congeladoPorId: number | null; congeladoPorNombre: string | null;
  paquete: PaqueteTraspaso;
}

type Orden = 'reciente' | 'antiguo' | 'monto_desc' | 'monto_asc';

const fmtCLP = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const fmtFecha = (s: string) => {
  try { return new Date(s.replace(' ', 'T')).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return s; }
};

function TarjetaPaquete({ p }: { p: PaqueteFila }) {
  const [abierto, setAbierto] = useState(false);
  const { paquete } = p;

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      <button onClick={() => setAbierto(v => !v)} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-zinc-50 transition-colors">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[11px] font-mono text-zinc-400">{p.licitacionCodigo}</p>
            <span className="text-[10.5px] text-zinc-400">Congelado {fmtFecha(p.congeladoAt)}</span>
          </div>
          <p className="text-[13.5px] font-bold text-zinc-800 leading-snug mt-0.5">{p.licitacionNombre || p.licitacionCodigo}</p>
          <div className="flex items-center gap-3 mt-1 text-[11.5px] text-zinc-500">
            {p.licitacionOrganismo && <span className="flex items-center gap-1"><Building2 size={11} /> {p.licitacionOrganismo}</span>}
            {p.asignadoNombre && <span>Asistente: {p.asignadoNombre}</span>}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-[12px] font-semibold text-zinc-600">{fmtCLP(paquete.costeo?.totalPrecioNeto ?? null)}</span>
          {abierto ? <ChevronUp size={16} className="text-zinc-400" /> : <ChevronDown size={16} className="text-zinc-400" />}
        </div>
      </button>

      {abierto && (
        <div className="border-t border-zinc-100 px-4 py-4 space-y-4">
          <div className="flex items-center justify-between">
            <Link href={`/negocios/${p.negocioId}?seccion=comercial`} className="flex items-center gap-1 text-[12px] font-semibold text-indigo-600 hover:text-indigo-700">
              Ver Auditor Técnico completo <ArrowUpRight size={13} />
            </Link>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-zinc-50 rounded-lg p-2.5">
              <p className="text-[10px] font-bold text-zinc-400 uppercase">Costo neto</p>
              <p className="text-[13px] font-bold text-zinc-800">{fmtCLP(paquete.costeo?.totalCostoNeto ?? null)}</p>
            </div>
            <div className="bg-zinc-50 rounded-lg p-2.5">
              <p className="text-[10px] font-bold text-zinc-400 uppercase">Precio ofertado</p>
              <p className="text-[13px] font-bold text-zinc-800">{fmtCLP(paquete.costeo?.totalPrecioNeto ?? null)}</p>
            </div>
            <div className="bg-zinc-50 rounded-lg p-2.5">
              <p className="text-[10px] font-bold text-zinc-400 uppercase">Matriz técnica</p>
              <p className="text-[13px] font-bold text-zinc-800">
                {paquete.matrizTecnicaAprobada.cumplen}/{paquete.matrizTecnicaAprobada.total} cumple
              </p>
            </div>
            <div className="bg-zinc-50 rounded-lg p-2.5">
              <p className="text-[10px] font-bold text-zinc-400 uppercase">Costeo</p>
              <p className="text-[13px] font-bold text-zinc-800 truncate">{paquete.costeo?.archivoNombre || 'sin costeo'}{paquete.costeo?.version ? ` · v${paquete.costeo.version}` : ''}</p>
            </div>
          </div>

          {paquete.productoValidado.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-zinc-500 uppercase mb-1.5">Producto validado</p>
              <div className="space-y-1">
                {paquete.productoValidado.map((l, i) => (
                  <p key={i} className="text-[12px] text-zinc-600">
                    {l.linea != null ? `Línea ${l.linea} — ` : ''}{l.titulo} <span className="text-zinc-400">({l.caracteristicas.length} característica(s))</span>
                  </p>
                ))}
              </div>
            </div>
          )}

          {paquete.plazosComprometidos.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-zinc-500 uppercase mb-1.5">Plazos comprometidos</p>
              <div className="space-y-1">
                {paquete.plazosComprometidos.map((pl, i) => (
                  <p key={i} className="text-[12px] text-zinc-600">{pl.titulo}: <span className="font-semibold">{pl.valor || '—'}</span></p>
                ))}
              </div>
            </div>
          )}

          {paquete.compromisosPostventa.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-zinc-500 uppercase mb-1.5">Compromisos de postventa</p>
              <div className="space-y-1">
                {paquete.compromisosPostventa.map((c, i) => (
                  <p key={i} className="text-[12px] text-zinc-600">{c.titulo}{c.descripcion ? `: ${c.descripcion}` : ''}</p>
                ))}
              </div>
            </div>
          )}

          {paquete.contactosCliente && (
            <div>
              <p className="text-[11px] font-bold text-zinc-500 uppercase mb-1.5">Contactos del cliente</p>
              <p className="text-[12px] text-zinc-600">
                {[paquete.contactosCliente.organismo, paquete.contactosCliente.unidad].filter(Boolean).join(' · ')}
              </p>
              <p className="text-[12px] text-zinc-600">
                {[paquete.contactosCliente.direccion, paquete.contactosCliente.comuna, paquete.contactosCliente.region].filter(Boolean).join(', ')}
              </p>
              {paquete.contactosCliente.usuarioNombre && (
                <p className="text-[12px] text-zinc-600">{paquete.contactosCliente.usuarioNombre}{paquete.contactosCliente.usuarioCargo ? ` — ${paquete.contactosCliente.usuarioCargo}` : ''}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ComprasPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const router = useRouter();
  const [paquetes, setPaquetes] = useState<PaqueteFila[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [fAsignado, setFAsignado] = useState<string[]>([]);
  const [fCongeladoPor, setFCongeladoPor] = useState<string[]>([]);
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [orden, setOrden] = useState<Orden>('reciente');

  const hayFiltro = fAsignado.length > 0 || fCongeladoPor.length > 0 || !!fechaDesde || !!fechaHasta;
  const limpiar = () => { setFAsignado([]); setFCongeladoPor([]); setFechaDesde(''); setFechaHasta(''); };

  const puedeVer = usuario?.rol === 'admin';

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/compras');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setPaquetes(data.paquetes || []);
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

  // Opciones (con conteo) de cada MultiSelect, derivadas de lo que hay realmente cargado.
  const opciones = useMemo(() => {
    const asig = new Map<string, { nombre: string; n: number }>();
    const cong = new Map<string, { nombre: string; n: number }>();
    for (const p of paquetes) {
      if (p.asignadoNombre) {
        const key = p.asignadoEmail || String(p.asignadoId || p.asignadoNombre);
        const cur = asig.get(key) || { nombre: p.asignadoNombre, n: 0 }; cur.n++; asig.set(key, cur);
      }
      if (p.congeladoPorNombre) {
        const key = String(p.congeladoPorId || p.congeladoPorNombre);
        const cur = cong.get(key) || { nombre: p.congeladoPorNombre, n: 0 }; cur.n++; cong.set(key, cur);
      }
    }
    return {
      asignado: [...asig.entries()].sort((a, b) => b[1].n - a[1].n)
        .map(([v, o]) => ({ value: v, label: o.nombre, color: colorUsuario(v), count: o.n })),
      congeladoPor: [...cong.entries()].sort((a, b) => b[1].n - a[1].n)
        .map(([v, o]) => ({ value: v, label: o.nombre, color: colorUsuario(v), count: o.n })),
    };
  }, [paquetes]);

  const filtrados = useMemo(() => {
    const qn = q.trim().toLowerCase();
    const arr = paquetes.filter(p => {
      if (qn) {
        const hay = [p.licitacionNombre, p.licitacionCodigo, p.licitacionOrganismo, p.asignadoNombre, p.congeladoPorNombre]
          .filter(Boolean).some(v => String(v).toLowerCase().includes(qn));
        if (!hay) return false;
      }
      if (fAsignado.length > 0) {
        const key = p.asignadoEmail || String(p.asignadoId || p.asignadoNombre || '');
        if (!fAsignado.includes(key)) return false;
      }
      if (fCongeladoPor.length > 0) {
        const key = String(p.congeladoPorId || p.congeladoPorNombre || '');
        if (!fCongeladoPor.includes(key)) return false;
      }
      const dia = p.congeladoAt.slice(0, 10);
      if (fechaDesde && dia < fechaDesde) return false;
      if (fechaHasta && dia > fechaHasta) return false;
      return true;
    });
    const t = (s: string) => new Date(s.replace(' ', 'T')).getTime();
    const m = (p: PaqueteFila) => p.paquete.costeo?.totalPrecioNeto ?? -1;
    arr.sort((a, b) => {
      switch (orden) {
        case 'antiguo':    return t(a.congeladoAt) - t(b.congeladoAt);
        case 'monto_desc': return m(b) - m(a);
        case 'monto_asc':  return m(a) - m(b);
        default:           return t(b.congeladoAt) - t(a.congeladoAt);
      }
    });
    return arr;
  }, [paquetes, q, fAsignado, fCongeladoPor, fechaDesde, fechaHasta, orden]);

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
                {paquetes.length === 0 ? 'Sin negocios postulados todavía'
                  : hayFiltro || q ? `${filtrados.length} de ${paquetes.length} negocio(s)`
                  : `${paquetes.length} negocio(s) congelado(s) — registro histórico de solo lectura`}
              </p>
            </div>
          </div>
          {paquetes.length > 0 && (
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar nombre, código, organismo o perfil…"
                className="pl-8 pr-3 py-2 text-[13px] border border-zinc-200 rounded-lg focus:ring-1 focus:ring-teal-500 outline-none w-72" />
            </div>
          )}
        </div>

        {error && <Banner variante="error" accion={{ label: 'Reintentar', onClick: cargar }}>{error}</Banner>}

        {!loading && paquetes.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-zinc-400 font-medium flex items-center gap-1"><Filter size={13} /> Filtrar:</span>
            {opciones.asignado.length > 0 && (
              <MultiSelect label="Asignado a" icon={<Users size={13} />} options={opciones.asignado} selected={fAsignado} onChange={setFAsignado} minWidth={220} />
            )}
            {opciones.congeladoPor.length > 0 && (
              <MultiSelect label="Congelado por" icon={<UserCheck size={13} />} options={opciones.congeladoPor} selected={fCongeladoPor} onChange={setFCongeladoPor} minWidth={220} />
            )}
            <div className="flex items-center gap-1.5 border border-zinc-200 rounded-lg px-2.5 py-1">
              <Calendar size={13} className="text-zinc-400 flex-shrink-0" />
              <span className="text-[11px] font-semibold text-zinc-500">Congelado</span>
              <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
                max={fechaHasta || undefined}
                className="text-[12px] text-zinc-700 bg-transparent outline-none w-[118px]" title="Congelado desde" />
              <span className="text-zinc-300">–</span>
              <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
                min={fechaDesde || undefined}
                className="text-[12px] text-zinc-700 bg-transparent outline-none w-[118px]" title="Congelado hasta" />
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
                  { value: 'reciente', label: 'Congelado reciente' },
                  { value: 'antiguo', label: 'Congelado más antiguo' },
                  { value: 'monto_desc', label: 'Monto ofertado (mayor)' },
                  { value: 'monto_asc', label: 'Monto ofertado (menor)' },
                ]} />
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>
        ) : paquetes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
            <Package size={28} className="text-zinc-300" />
            <p className="text-[13.5px] font-semibold text-zinc-500">Todavía no hay ningún negocio postulado</p>
            <p className="text-[12px] text-zinc-400">Cuando un negocio pase a Postulada, su Auditor Técnico se congela y aparece acá.</p>
          </div>
        ) : filtrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
            <Search size={28} className="text-zinc-300" />
            <p className="text-[13.5px] font-semibold text-zinc-500">Sin resultados</p>
            <p className="text-[12px] text-zinc-400">Ningún negocio congelado coincide con la búsqueda o los filtros.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtrados.map(p => <TarjetaPaquete key={p.negocioId} p={p} />)}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
