'use client';

// CATÁLOGO DE PROVEEDORES — ficha completa (nombre de empresa, RUT, contacto, categoría, giro,
// datos bancarios). Transversal a todos los negocios, mismo criterio que Fleteros: se da de alta
// una vez y queda disponible para cualquier cotización futura.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { IconLoader2 as Loader2, IconPlus as Plus, IconX as X, IconSearch as Search, IconBuilding as Building2, IconMail as Mail, IconPhone as Phone, IconBuildingBank as Landmark, IconChevronDown as ChevronDown, IconChevronUp as ChevronUp, IconRefresh as RefreshCw, IconCreditCard as CreditCard, IconShoppingCart as ShoppingCart, IconPackage as PackageSearch, IconUsers as Users, IconWallet as Wallet, IconTrendingUp as TrendingUp } from '@tabler/icons-react';

interface Proveedor {
  id: number; rut: string | null; nombreEmpresa: string; nombreFantasia: string | null;
  categoria: string | null; giro: string | null; contactoNombre: string | null; correo: string | null; telefono: string | null;
  direccion: string | null; comuna: string | null; region: string | null;
  banco: string | null; tipoCuenta: string | null; numeroCuenta: string | null; titularCuenta: string | null;
  rutTitular: string | null; correoPagos: string | null; obumaProveedorId: string | null;
  obumaTieneCuentaBancaria: boolean | null; obumaNumeroCuenta: string | null;
  obumaTipoCuenta: string | null; obumaFormaPago: string | null;
  obumaComprasCantidad: number; obumaComprasMontoTotal: number; obumaUltimaCompraFecha: string | null;
  notas: string | null; activo: boolean;
}

interface CompraOcResumen { id: string; folio: string | null; fecha: string; total: number; estado: string }
interface ItemCompraOc { nombre: string; cantidad: number; precioUnitario: number; subtotal: number }
interface ProveedorPorProducto {
  proveedorId: number | null; obumaProveedorId: string; nombreEmpresa: string; rut: string | null;
  productos: Array<{ nombre: string; veces: number; ultimaFecha: string | null }>;
}

const fmtCLP = (n: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

const FORM_VACIO = {
  rut: '', nombreEmpresa: '', nombreFantasia: '', categoria: '', giro: '', contactoNombre: '', correo: '', telefono: '',
  direccion: '', comuna: '', region: '', banco: '', tipoCuenta: '', numeroCuenta: '', titularCuenta: '', rutTitular: '',
  correoPagos: '', notas: '',
};

export default function ProveedoresPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [formAbierto, setFormAbierto] = useState(false);
  const [form, setForm] = useState(FORM_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [expandido, setExpandido] = useState<number | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  // Historial de compras REAL a cada proveedor (pedido explícito, 14-sep-2026: "si les hemos
  // comprado" y "qué le hemos comprado") — se pide a Obuma solo cuando se despliega ESE proveedor
  // puntual, nunca para los 388 de una vez.
  const [historiales, setHistoriales] = useState<Record<number, { estado: 'cargando' } | { estado: 'error' } | { estado: 'listo'; tieneObuma: boolean; compras: CompraOcResumen[]; totalComprado: number; hayMas: boolean }>>({});
  const [itemsPorFolio, setItemsPorFolio] = useState<Record<string, { estado: 'cargando' } | { estado: 'error' } | { estado: 'listo'; items: ItemCompraOc[] }>>({});
  const [ocAbierta, setOcAbierta] = useState<string | null>(null);
  // Filtros en pantalla (pedido explícito, 14-sep-2026) — todo client-side sobre lo ya cargado, el
  // catálogo entero son 388 filas, no vale la pena un viaje al servidor por cada toggle.
  const [filtroCuenta, setFiltroCuenta] = useState(false);
  const [filtroCompras, setFiltroCompras] = useState(false);
  // Búsqueda por PRODUCTO (pedido explícito, 14-sep-2026: "si pongo martillo, decime a quién le
  // hemos comprado martillo") — corre en paralelo a la búsqueda normal de nombre/RUT, sobre el mismo
  // campo de texto. Independiente de `cargar`: esta pega contra Obuma, no contra el catálogo local.
  const [busquedaProducto, setBusquedaProducto] = useState<{ estado: 'idle' } | { estado: 'buscando' } | { estado: 'error' } | { estado: 'listo'; resultados: ProveedorPorProducto[] }>({ estado: 'idle' });
  // Backfill de ÍTEMS del historial (pedido explícito, 14-sep-2026: "todo en nuestra base de
  // datos") — se hace por lotes (traer los ítems es una llamada a Obuma POR CADA OC), la UI llama
  // al endpoint repetidas veces hasta vaciar el pendiente, mostrando progreso.
  const [sincronizandoItems, setSincronizandoItems] = useState(false);
  const [progresoItems, setProgresoItems] = useState<{ pendientes: number; guardados: number } | null>(null);

  const stats = useMemo(() => {
    const conCuenta = proveedores.filter(p => p.obumaTieneCuentaBancaria).length;
    const conCompras = proveedores.filter(p => p.obumaComprasCantidad > 0).length;
    const montoTotal = proveedores.reduce((s, p) => s + p.obumaComprasMontoTotal, 0);
    return { total: proveedores.length, conCuenta, conCompras, montoTotal };
  }, [proveedores]);

  const proveedoresFiltrados = useMemo(() => {
    return proveedores.filter(p => {
      if (filtroCuenta && !p.obumaTieneCuentaBancaria) return false;
      if (filtroCompras && p.obumaComprasCantidad <= 0) return false;
      return true;
    });
  }, [proveedores, filtroCuenta, filtroCompras]);

  // "Ser admin" ya no alcanza solo (pedido explícito, 10-sep-2026) — mismo criterio que el backend
  // (app/api/compras/proveedores/route.ts).
  const puedeVer = !!usuario?.permisos?.compras_todo || !!usuario?.permisos?.compras || !!usuario?.permisos?.aprobar_comercial;

  const cargar = useCallback(async (busqueda?: string) => {
    try {
      const res = await fetch(`/api/compras/proveedores${busqueda ? `?q=${encodeURIComponent(busqueda)}` : ''}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setProveedores(data.proveedores || []);
    } catch (e: any) {
      toast.error('No se pudieron cargar los proveedores', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cargandoSesion) return;
    if (!puedeVer) { router.replace('/dashboard'); return; }
    cargar();
  }, [cargandoSesion, puedeVer, router, cargar]);

  useEffect(() => {
    const t = setTimeout(() => cargar(q), 300);
    return () => clearTimeout(t);
  }, [q, cargar]);

  // Mismo debounce, búsqueda independiente: el catálogo local (compras_proveedor) no tiene ítems de
  // compra — buscar "martillo" ahí nunca iba a encontrar nada. Se pega directo a Obuma (producto →
  // ítems de OC → proveedor). Solo corre con 3+ caracteres, igual que buscarProductosObumaPorNombre.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 3) { setBusquedaProducto({ estado: 'idle' }); return; }
    setBusquedaProducto({ estado: 'buscando' });
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/compras/proveedores/buscar-producto?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo buscar');
        setBusquedaProducto({ estado: 'listo', resultados: data.resultados || [] });
      } catch {
        setBusquedaProducto({ estado: 'error' });
      }
    }, 400);
    return () => clearTimeout(t);
  }, [q]);

  // Trae el catálogo REAL de Obuma y lo refleja acá (pedido explícito, 14-sep-2026) — reemplaza o
  // enlaza fichas existentes por RUT/obuma_proveedor_id, nunca duplica. Acción consciente por botón.
  const sincronizarObuma = async () => {
    setSincronizando(true);
    try {
      const res = await fetch('/api/compras/proveedores/importar-obuma', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo sincronizar');
      setProveedores(data.proveedores);
      toast.success('Catálogo sincronizado con Obuma', `${data.creados} nuevo(s), ${data.actualizados} actualizado(s) de ${data.total} en Obuma. ${data.historialOc?.procesadas || 0} orden(es) de compra en el historial.`);
      sincronizarItemsHistorial();
    } catch (e: any) {
      toast.error('No se pudo sincronizar con Obuma', e.message);
    } finally {
      setSincronizando(false);
    }
  };

  // Backfill de ítems, por lotes — el propio "Sincronizar con Obuma" lo dispara al terminar, y
  // también hay un botón aparte para seguir/reintentar sin repetir todo lo demás. Se llama a sí
  // misma hasta que `pendientesRestantes` llegue a 0 — así el usuario ve la barra avanzar sin tener
  // que ir apretando el botón de nuevo.
  const sincronizarItemsHistorial = async () => {
    setSincronizandoItems(true);
    let guardadosAcum = 0;
    try {
      let cuotaAgotada = false;
      while (true) {
        const res = await fetch('/api/compras/proveedores/sincronizar-historial-items', { method: 'POST' });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo sincronizar');
        guardadosAcum += data.itemsGuardados;
        setProgresoItems({ pendientes: data.pendientesRestantes, guardados: guardadosAcum });
        cuotaAgotada = !!data.cuotaAgotada;
        if (data.pendientesRestantes === 0 || data.procesadas === 0 || cuotaAgotada) break;
      }
      if (cuotaAgotada) {
        toast.error('Cuota diaria de Obuma agotada', `${guardadosAcum} ítem(s) guardados por ahora — sigue mañana solo, o apreta "Sincronizar con Obuma" de nuevo cuando se resetee.`);
      } else {
        toast.success('Historial de ítems sincronizado', `${guardadosAcum} ítem(s) de compra guardados localmente.`);
      }
    } catch (e: any) {
      toast.error('No se pudo completar el historial de ítems', e.message);
    } finally {
      setSincronizandoItems(false);
    }
  };

  // Carga perezosa: solo se pide a Obuma cuando la persona despliega ESE proveedor.
  const cargarHistorial = async (proveedorId: number) => {
    setHistoriales(h => ({ ...h, [proveedorId]: { estado: 'cargando' } }));
    try {
      const res = await fetch(`/api/compras/proveedores/${proveedorId}/compras-obuma`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo consultar');
      setHistoriales(h => ({ ...h, [proveedorId]: { estado: 'listo', tieneObuma: data.tieneObuma, compras: data.compras, totalComprado: data.totalComprado, hayMas: !!data.hayMas } }));
    } catch (e: any) {
      setHistoriales(h => ({ ...h, [proveedorId]: { estado: 'error' } }));
      toast.error('No se pudo consultar el historial de compras', e.message);
    }
  };

  const toggleExpandido = (p: Proveedor) => {
    const abrir = expandido !== p.id;
    setExpandido(abrir ? p.id : null);
    if (abrir && !historiales[p.id]) cargarHistorial(p.id);
  };

  // Desde un resultado de "búsqueda por producto" — salta al proveedor en la lista de abajo, quita
  // cualquier filtro que lo estuviera tapando, y lo despliega directo (sin esto, "a quién le
  // compramos martillo" mostraba el nombre pero la persona tenía que buscarlo de nuevo a mano).
  const irAProveedor = (proveedorId: number) => {
    setFiltroCuenta(false); setFiltroCompras(false);
    setExpandido(proveedorId);
    if (!historiales[proveedorId]) cargarHistorial(proveedorId);
    setTimeout(() => document.getElementById(`proveedor-${proveedorId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };

  // Ítems de UNA orden de compra puntual — recién al desplegarla (un proveedor puede tener decenas
  // de OC, pedir los ítems de todas de una sería lento y en su mayoría nunca se miran).
  const toggleOc = async (folio: string) => {
    if (ocAbierta === folio) { setOcAbierta(null); return; }
    setOcAbierta(folio);
    if (itemsPorFolio[folio]) return;
    setItemsPorFolio(m => ({ ...m, [folio]: { estado: 'cargando' } }));
    try {
      const res = await fetch(`/api/compras/proveedores/${expandido}/compras-obuma?folio=${encodeURIComponent(folio)}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo consultar');
      setItemsPorFolio(m => ({ ...m, [folio]: { estado: 'listo', items: data.items } }));
    } catch (e: any) {
      setItemsPorFolio(m => ({ ...m, [folio]: { estado: 'error' } }));
      toast.error('No se pudieron cargar los ítems de la OC', e.message);
    }
  };

  const crear = async () => {
    if (!form.nombreEmpresa.trim()) return;
    setGuardando(true);
    try {
      const res = await fetch('/api/compras/proveedores', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo crear');
      toast.success('Proveedor agregado');
      setProveedores(data.proveedores);
      setForm(FORM_VACIO); setFormAbierto(false);
    } catch (e: any) {
      toast.error('No se pudo agregar el proveedor', e.message);
    } finally {
      setGuardando(false);
    }
  };

  if (cargandoSesion || (!puedeVer && loading)) {
    return (
      <AppLayout breadcrumb={[{ label: 'Proveedores' }]}>
        <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="w-6 h-6 animate-spin text-zinc-400" /></div>
      </AppLayout>
    );
  }
  if (!puedeVer) return null;

  return (
    <AppLayout breadcrumb={[{ label: 'Proveedores' }]}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center flex-shrink-0"><Building2 size={17} className="text-teal-600" /></div>
            <div>
              <h1 className="text-[16px] font-bold text-zinc-900 leading-tight">Proveedores</h1>
              <p className="text-[12px] text-zinc-500">{proveedores.length} proveedor(es) en el catálogo</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar nombre o RUT…"
                className="pl-8 pr-3 py-2 text-[12.5px] border border-zinc-200 rounded-lg outline-none focus:ring-1 focus:ring-teal-500 w-56" />
            </div>
            <button onClick={sincronizarObuma} disabled={sincronizando || sincronizandoItems} className="flex items-center gap-1.5 text-[12px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 px-3 py-2 rounded-lg">
              {sincronizando ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Sincronizar con Obuma
            </button>
            <button onClick={() => setFormAbierto(v => !v)} className="flex items-center gap-1.5 text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 px-3 py-2 rounded-lg">
              <Plus size={14} /> Agregar
            </button>
          </div>
        </div>

        {/* Progreso del backfill de ítems del historial (pedido explícito, 14-sep-2026: "todo en
            nuestra base de datos") — traer los ítems es una llamada a Obuma POR CADA orden de
            compra, así que avanza por lotes; esto se ve mientras corre y desaparece al terminar. */}
        {sincronizandoItems && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2.5 flex items-center gap-2 text-[12px] text-indigo-700">
            <Loader2 size={13} className="animate-spin flex-shrink-0" />
            Guardando el historial de compras en nuestra base de datos
            {progresoItems && ` — ${progresoItems.guardados} ítem(s) guardados, ${progresoItems.pendientes} orden(es) de compra pendiente(s)`}…
          </div>
        )}

        {/* Estadísticas en cuadros (pedido explícito, 14-sep-2026) — resumen de lo mismo que hoy solo
            se veía proveedor por proveedor. Los dos primeros son filtros clicables: activan/desactivan
            el mismo criterio que se muestra abajo, para no duplicar controles. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="bg-white rounded-xl border border-zinc-200 p-3">
            <p className="text-[10.5px] font-bold text-zinc-400 uppercase flex items-center gap-1"><Users size={11} /> Total</p>
            <p className="text-[19px] font-bold text-zinc-900 mt-0.5">{stats.total}</p>
          </div>
          <button onClick={() => setFiltroCuenta(v => !v)}
            className={`text-left rounded-xl border p-3 transition-colors ${filtroCuenta ? 'border-teal-400 bg-teal-50 ring-1 ring-teal-200' : 'border-zinc-200 bg-white hover:bg-zinc-50'}`}>
            <p className="text-[10.5px] font-bold text-zinc-400 uppercase flex items-center gap-1"><CreditCard size={11} /> Con cuenta bancaria</p>
            <p className="text-[19px] font-bold text-zinc-900 mt-0.5">{stats.conCuenta}</p>
          </button>
          <button onClick={() => setFiltroCompras(v => !v)}
            className={`text-left rounded-xl border p-3 transition-colors ${filtroCompras ? 'border-teal-400 bg-teal-50 ring-1 ring-teal-200' : 'border-zinc-200 bg-white hover:bg-zinc-50'}`}>
            <p className="text-[10.5px] font-bold text-zinc-400 uppercase flex items-center gap-1"><ShoppingCart size={11} /> Con compras registradas</p>
            <p className="text-[19px] font-bold text-zinc-900 mt-0.5">{stats.conCompras}</p>
          </button>
          <div className="bg-white rounded-xl border border-zinc-200 p-3">
            <p className="text-[10.5px] font-bold text-zinc-400 uppercase flex items-center gap-1"><Wallet size={11} /> Comprado histórico</p>
            <p className="text-[16px] font-bold text-zinc-900 mt-0.5">{fmtCLP(stats.montoTotal)}</p>
          </div>
        </div>

        {(filtroCuenta || filtroCompras) && (
          <div className="flex items-center gap-2 text-[11.5px] text-zinc-500">
            <TrendingUp size={12} /> Mostrando {proveedoresFiltrados.length} de {stats.total}
            {filtroCuenta && <span className="text-teal-700 font-semibold">· con cuenta bancaria</span>}
            {filtroCompras && <span className="text-teal-700 font-semibold">· con compras</span>}
            <button onClick={() => { setFiltroCuenta(false); setFiltroCompras(false); }} className="text-zinc-400 hover:text-zinc-600 underline">limpiar</button>
          </div>
        )}

        {/* Búsqueda por PRODUCTO (pedido explícito, 14-sep-2026) — mismo campo de arriba, pero esto
            busca en las compras REALES de Obuma, no en el catálogo local. Solo se muestra con 3+
            caracteres, para no disparar la búsqueda en cada letra suelta. */}
        {q.trim().length >= 3 && (
          <div className="bg-white rounded-xl border border-indigo-200 overflow-hidden">
            <p className="px-4 py-2.5 text-[11px] font-bold text-indigo-700 uppercase bg-indigo-50 border-b border-indigo-100 flex items-center gap-1.5">
              <PackageSearch size={13} /> ¿A quién le hemos comprado "{q.trim()}"?
            </p>
            {busquedaProducto.estado === 'buscando' && (
              <p className="px-4 py-3 text-[12px] text-zinc-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Buscando en las compras de Obuma…</p>
            )}
            {busquedaProducto.estado === 'error' && (
              <p className="px-4 py-3 text-[12px] text-amber-600">No se pudo buscar por producto ahora.</p>
            )}
            {busquedaProducto.estado === 'listo' && busquedaProducto.resultados.length === 0 && (
              <p className="px-4 py-3 text-[12px] text-zinc-400">Nunca le hemos comprado "{q.trim()}" a nadie (o no calza con ningún producto del catálogo de Obuma).</p>
            )}
            {busquedaProducto.estado === 'listo' && busquedaProducto.resultados.length > 0 && (
              <div className="divide-y divide-zinc-100">
                {busquedaProducto.resultados.map(r => (
                  <button key={r.obumaProveedorId} onClick={() => r.proveedorId && irAProveedor(r.proveedorId)}
                    disabled={!r.proveedorId}
                    className="w-full text-left px-4 py-2.5 hover:bg-indigo-50/60 transition-colors disabled:cursor-default disabled:hover:bg-transparent">
                    <p className="text-[12px] font-semibold text-zinc-800">{r.nombreEmpresa}{r.rut && <span className="text-zinc-400 font-normal"> · {r.rut}</span>}</p>
                    <div className="mt-0.5 flex flex-wrap gap-1.5">
                      {r.productos.map((p, i) => (
                        <span key={i} className="text-[10.5px] text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded-full">
                          {p.nombre} · {p.veces}× {p.ultimaFecha && `· última ${p.ultimaFecha.slice(0, 10)}`}
                        </span>
                      ))}
                    </div>
                    {!r.proveedorId && <p className="text-[10px] text-zinc-400 mt-0.5">No está en el catálogo local todavía — sincroniza para verlo con ficha completa.</p>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {formAbierto && (
          <div className="bg-white rounded-xl border border-zinc-200 p-4 space-y-3">
            <p className="text-[10.5px] font-bold text-zinc-400 uppercase flex items-center gap-1"><Building2 size={11} /> Identidad</p>
            <div className="grid grid-cols-2 gap-2.5">
              <input value={form.nombreEmpresa} onChange={e => setForm(f => ({ ...f, nombreEmpresa: e.target.value }))} placeholder="Nombre de la empresa (razón social) *"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500 col-span-2" />
              <input value={form.nombreFantasia} onChange={e => setForm(f => ({ ...f, nombreFantasia: e.target.value }))} placeholder="Nombre de fantasía"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.rut} onChange={e => setForm(f => ({ ...f, rut: e.target.value }))} placeholder="RUT"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))} placeholder="Categoría / rubro"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.giro} onChange={e => setForm(f => ({ ...f, giro: e.target.value }))} placeholder="Giro"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
            </div>

            <p className="text-[10.5px] font-bold text-zinc-400 uppercase flex items-center gap-1 pt-1"><Mail size={11} /> Contacto</p>
            <div className="grid grid-cols-2 gap-2.5">
              <input value={form.contactoNombre} onChange={e => setForm(f => ({ ...f, contactoNombre: e.target.value }))} placeholder="Nombre de contacto"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} placeholder="Teléfono"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.correo} onChange={e => setForm(f => ({ ...f, correo: e.target.value }))} placeholder="Correo"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.direccion} onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))} placeholder="Dirección"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.comuna} onChange={e => setForm(f => ({ ...f, comuna: e.target.value }))} placeholder="Comuna"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.region} onChange={e => setForm(f => ({ ...f, region: e.target.value }))} placeholder="Región"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
            </div>

            <p className="text-[10.5px] font-bold text-zinc-400 uppercase flex items-center gap-1 pt-1"><Landmark size={11} /> Datos de transferencia</p>
            <div className="grid grid-cols-2 gap-2.5">
              <input value={form.banco} onChange={e => setForm(f => ({ ...f, banco: e.target.value }))} placeholder="Banco"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.tipoCuenta} onChange={e => setForm(f => ({ ...f, tipoCuenta: e.target.value }))} placeholder="Tipo de cuenta"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.numeroCuenta} onChange={e => setForm(f => ({ ...f, numeroCuenta: e.target.value }))} placeholder="N° de cuenta"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.titularCuenta} onChange={e => setForm(f => ({ ...f, titularCuenta: e.target.value }))} placeholder="Titular de la cuenta"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.rutTitular} onChange={e => setForm(f => ({ ...f, rutTitular: e.target.value }))} placeholder="RUT del titular"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.correoPagos} onChange={e => setForm(f => ({ ...f, correoPagos: e.target.value }))} placeholder="Correo para pagos/facturas"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
            </div>

            <textarea value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} rows={2} placeholder="Notas…"
              className="w-full text-[12px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />

            <div className="flex items-center gap-2">
              <button onClick={crear} disabled={!form.nombreEmpresa.trim() || guardando} className="text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-3 py-1.5 rounded-lg">
                {guardando ? <Loader2 size={13} className="animate-spin" /> : 'Guardar'}
              </button>
              <button onClick={() => setFormAbierto(false)} className="text-zinc-400 hover:text-zinc-600"><X size={16} /></button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>
        ) : (
          <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
            <div className="divide-y divide-zinc-100">
              {proveedoresFiltrados.map(p => {
                const activo = expandido === p.id;
                return (
                <div key={p.id} id={`proveedor-${p.id}`} className={activo ? 'bg-teal-50/70 border-l-[3px] border-teal-500' : 'border-l-[3px] border-transparent'}>
                  <button onClick={() => toggleExpandido(p)} className={`w-full flex items-center justify-between gap-3 px-4 py-3 transition-colors text-left ${activo ? 'hover:bg-teal-50' : 'hover:bg-zinc-50'}`}>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[12.5px] font-semibold ${activo ? 'text-teal-800' : 'text-zinc-800'}`}>{p.nombreEmpresa}{p.nombreFantasia && <span className="text-zinc-400 font-normal"> ({p.nombreFantasia})</span>}</p>
                      <p className="text-[11px] text-zinc-400">{[p.rut, p.categoria].filter(Boolean).join(' · ')}</p>
                    </div>
                    {/* Badges de estado en la fila colapsada (pedido explícito, 14-sep-2026: no se
                        diferenciaba nada al recorrer la lista larga) — así se escanea sin desplegar. */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {p.obumaTieneCuentaBancaria && (
                        <span title="Tiene cuenta bancaria en Obuma" className="flex items-center gap-0.5 text-[10px] font-semibold text-teal-700 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded-full"><CreditCard size={10} /></span>
                      )}
                      {p.obumaComprasCantidad > 0 && (
                        <span title={`${p.obumaComprasCantidad} orden(es) de compra`} className="flex items-center gap-0.5 text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded-full"><ShoppingCart size={10} /> {p.obumaComprasCantidad}</span>
                      )}
                      {activo ? <ChevronUp size={15} className="text-teal-600" /> : <ChevronDown size={15} className="text-zinc-400" />}
                    </div>
                  </button>
                  {activo && (
                    <div className="px-4 pb-3 bg-white space-y-3">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11.5px] text-zinc-600">
                        {p.giro && <p><span className="text-zinc-400">Giro:</span> {p.giro}</p>}
                        {p.contactoNombre && <p className="flex items-center gap-1"><Mail size={11} className="text-zinc-400" /> {p.contactoNombre}</p>}
                        {p.telefono && <p className="flex items-center gap-1"><Phone size={11} className="text-zinc-400" /> {p.telefono}</p>}
                        {p.correo && <p>{p.correo}</p>}
                        {(p.direccion || p.comuna) && <p>{[p.direccion, p.comuna, p.region].filter(Boolean).join(', ')}</p>}
                        {p.banco && <p className="flex items-center gap-1"><Landmark size={11} className="text-zinc-400" /> {p.banco} — {p.tipoCuenta} {p.numeroCuenta}</p>}
                        {p.titularCuenta && <p>Titular: {p.titularCuenta} {p.rutTitular && `(${p.rutTitular})`}</p>}
                        {p.correoPagos && <p>Pagos: {p.correoPagos}</p>}
                        {p.notas && <p className="col-span-2 text-zinc-400 italic">{p.notas}</p>}
                      </div>

                      {/* Cuenta bancaria EN OBUMA (solo lectura — pedido explícito, 14-sep-2026).
                          Obuma no expone el nombre del banco, solo si tiene cuenta, número, tipo y
                          forma de pago. */}
                      {p.obumaProveedorId && (
                        <div className="border-t border-zinc-200 pt-2.5">
                          <p className="text-[10.5px] font-bold text-zinc-400 uppercase flex items-center gap-1 mb-1"><CreditCard size={11} /> Cuenta bancaria en Obuma</p>
                          {p.obumaTieneCuentaBancaria ? (
                            <p className="text-[11.5px] text-zinc-600">
                              {p.obumaTipoCuenta || 'Cuenta'} N° {p.obumaNumeroCuenta || '—'}
                              {p.obumaFormaPago && ` · forma de pago: ${p.obumaFormaPago}`}
                            </p>
                          ) : (
                            <p className="text-[11.5px] text-zinc-400">No tiene cuenta bancaria cargada en Obuma.</p>
                          )}
                        </div>
                      )}

                      {/* Historial de compras REAL (OC de Obuma) — carga perezosa, ver toggleExpandido. */}
                      <div className="border-t border-zinc-200 pt-2.5">
                        <p className="text-[10.5px] font-bold text-zinc-400 uppercase flex items-center gap-1 mb-1"><ShoppingCart size={11} /> Compras a este proveedor</p>
                        {!p.obumaProveedorId ? (
                          <p className="text-[11.5px] text-zinc-400">Todavía no está enlazado a una ficha de Obuma — no se puede consultar el historial. Usa "Sincronizar con Obuma".</p>
                        ) : historiales[p.id]?.estado === 'cargando' ? (
                          <p className="text-[11px] text-zinc-400 flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Consultando en Obuma…</p>
                        ) : historiales[p.id]?.estado === 'error' ? (
                          <p className="text-[11.5px] text-amber-600">No se pudo consultar el historial ahora.</p>
                        ) : historiales[p.id]?.estado === 'listo' ? (
                          (() => {
                            const h = historiales[p.id] as { estado: 'listo'; tieneObuma: boolean; compras: CompraOcResumen[]; totalComprado: number; hayMas: boolean };
                            if (h.compras.length === 0) return <p className="text-[11.5px] text-zinc-400">Nunca le hemos comprado (sin órdenes de compra en Obuma).</p>;
                            return (
                              <div className="space-y-1.5">
                                <p className="text-[11.5px] font-semibold text-emerald-700">
                                  Sí le hemos comprado — {h.compras.length}{h.hayMas ? '+' : ''} orden(es) de compra, {fmtCLP(h.totalComprado)}{h.hayMas ? ' (de las mostradas)' : ' en total'}.
                                </p>
                                {h.hayMas && <p className="text-[10.5px] text-zinc-400">Mostrando las {h.compras.length} más recientes — hay más en Obuma.</p>}
                                <div className="space-y-1">
                                  {h.compras.map(c => (
                                    <div key={c.id} className="border border-zinc-200 rounded-lg bg-white">
                                      <button onClick={() => c.folio && toggleOc(c.folio)} className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left hover:bg-zinc-50">
                                        <span className="text-[11px] text-zinc-600">
                                          {c.folio ? `OC ${c.folio}` : `#${c.id}`} · {c.fecha.slice(0, 10)} · {c.estado}
                                        </span>
                                        <span className="text-[11px] font-semibold text-zinc-700 flex items-center gap-1">{fmtCLP(c.total)} <PackageSearch size={11} className="text-zinc-400" /></span>
                                      </button>
                                      {c.folio && ocAbierta === c.folio && (
                                        <div className="px-2 pb-1.5 border-t border-zinc-100">
                                          {itemsPorFolio[c.folio]?.estado === 'cargando' && (
                                            <p className="text-[10.5px] text-zinc-400 flex items-center gap-1 pt-1"><Loader2 size={10} className="animate-spin" /> Cargando ítems…</p>
                                          )}
                                          {itemsPorFolio[c.folio]?.estado === 'error' && <p className="text-[10.5px] text-amber-600 pt-1">No se pudieron cargar los ítems.</p>}
                                          {itemsPorFolio[c.folio]?.estado === 'listo' && (
                                            <ul className="pt-1 space-y-0.5">
                                              {(itemsPorFolio[c.folio] as { estado: 'listo'; items: ItemCompraOc[] }).items.map((it, i) => (
                                                <li key={i} className="text-[10.5px] text-zinc-500">{it.cantidad}× {it.nombre} — {fmtCLP(it.subtotal)}</li>
                                              ))}
                                            </ul>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })()
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
                );
              })}
              {proveedoresFiltrados.length === 0 && (
                <p className="px-4 py-10 text-center text-[12px] text-zinc-400">
                  {proveedores.length === 0 ? 'Sin proveedores todavía.' : 'Ningún proveedor calza con el filtro activo.'}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
