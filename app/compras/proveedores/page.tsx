'use client';

// CATÁLOGO DE PROVEEDORES — ficha completa (nombre de empresa, RUT, contacto, categoría, giro,
// datos bancarios). Transversal a todos los negocios, mismo criterio que Fleteros: se da de alta
// una vez y queda disponible para cualquier cotización futura.
import { Fragment, useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { CrearProveedorObumaModal } from '@/app/negocios/[id]/CrearProveedorObumaModal';
import { IconLoader2 as Loader2, IconPlus as Plus, IconX as X, IconSearch as Search, IconBuilding as Building2, IconMail as Mail, IconPhone as Phone, IconBuildingBank as Landmark, IconChevronDown as ChevronDown, IconChevronUp as ChevronUp, IconRefresh as RefreshCw, IconCreditCard as CreditCard, IconShoppingCart as ShoppingCart, IconPackage as PackageSearch, IconUsers as Users, IconWallet as Wallet, IconTrendingUp as TrendingUp } from '@tabler/icons-react';
import { Encabezado, Esqueleto, Vacio } from '@/app/components/ui/kit/Estructura';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Indicador } from '@/app/components/ui/kit/Indicador';
import { Dato, Estado } from '@/app/components/ui/kit/Tarjeta';
import { Lista } from '@/app/components/ui/kit/Aparecer';
import { Banner } from '@/app/components/ui/Banner';

interface Proveedor {
  id: number; rut: string | null; nombreEmpresa: string; nombreFantasia: string | null;
  categoria: string | null; giro: string | null; contactoNombre: string | null; correo: string | null; telefono: string | null;
  direccion: string | null; comuna: string | null; region: string | null;
  banco: string | null; tipoCuenta: string | null; numeroCuenta: string | null; titularCuenta: string | null;
  rutTitular: string | null; correoPagos: string | null; obumaProveedorId: string | null;
  obumaTieneCuentaBancaria: boolean | null; obumaNumeroCuenta: string | null;
  obumaTipoCuenta: string | null; obumaFormaPago: string | null;
  obumaBanco: string | null; bancoPendienteEnObuma: boolean;
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
  const [crearObumaAbierto, setCrearObumaAbierto] = useState(false);
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
  // Los proveedores dados de baja en Obuma están en la base pero no se muestran salvo que se pida.
  const [verInactivos, setVerInactivos] = useState(false);
  const [enviandoObuma, setEnviandoObuma] = useState<number | null>(null);
  // Edición de la ficha (23-nov-2026: antes solo se podía mirar; el botón de Obuma reenviaba lo mismo que ya había).
  const [editando, setEditando] = useState<number | null>(null);
  const [edicion, setEdicion] = useState<Record<string, string>>({});
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);
  // Filtros desplegables (todo en pantalla, sobre lo ya cargado).
  const [fCategoria, setFCategoria] = useState('');
  const [fBanco, setFBanco] = useState('');
  const [fFalta, setFFalta] = useState('');
  const [fUltima, setFUltima] = useState('');
  const [orden, setOrden] = useState('nombre');
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

  const norm = (s: string | null | undefined) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const opciones = useMemo(() => {
    const uniq = (f: (p: Proveedor) => string | null) => Array.from(new Set(proveedores.map(f).filter((x): x is string => !!x && !!x.trim()))).sort((a, b) => a.localeCompare(b, 'es'));
    return { categorias: uniq(p => p.categoria), bancos: uniq(p => p.obumaBanco || p.banco) };
  }, [proveedores]);

  // Proveedores a los que SÍ se les compró lo que se escribió en el buscador (búsqueda por ítem, contra las OC de Obuma).
  const idsPorItem = useMemo(() => {
    const s = new Set<number>();
    if (busquedaProducto.estado === 'listo') for (const r of busquedaProducto.resultados) if (r.proveedorId) s.add(r.proveedorId);
    return s;
  }, [busquedaProducto]);

  const hayFiltros = !!(filtroCuenta || filtroCompras || fCategoria || fBanco || fFalta || fUltima);
  const limpiarFiltros = () => { setFiltroCuenta(false); setFiltroCompras(false); setFCategoria(''); setFBanco(''); setFFalta(''); setFUltima(''); };

  const proveedoresFiltrados = useMemo(() => {
    const t = norm(q.trim());
    const hace12m = new Date(); hace12m.setFullYear(hace12m.getFullYear() - 1);
    const lista = proveedores.filter(p => {
      // Buscador: calza por nombre/RUT o porque se le compró ese ítem.
      if (t && !(norm(p.nombreEmpresa).includes(t) || norm(p.nombreFantasia).includes(t) || norm(p.rut).includes(t) || idsPorItem.has(p.id))) return false;
      if (filtroCuenta && !p.obumaTieneCuentaBancaria) return false;
      if (filtroCompras && p.obumaComprasCantidad <= 0) return false;
      if (fCategoria && p.categoria !== fCategoria) return false;
      if (fBanco && (p.obumaBanco || p.banco) !== fBanco) return false;
      if (fFalta === 'correo' && p.correo) return false;
      if (fFalta === 'telefono' && p.telefono) return false;
      if (fFalta === 'contacto' && p.contactoNombre) return false;
      if (fFalta === 'direccion' && p.direccion) return false;
      if (fFalta === 'cuenta' && (p.obumaTieneCuentaBancaria || p.banco)) return false;
      if (fFalta === 'pendiente' && !p.bancoPendienteEnObuma) return false;
      if (fUltima === 'nunca' && p.obumaUltimaCompraFecha) return false;
      if (fUltima === '12m' && !(p.obumaUltimaCompraFecha && new Date(p.obumaUltimaCompraFecha) >= hace12m)) return false;
      if (fUltima === 'antiguo' && !(p.obumaUltimaCompraFecha && new Date(p.obumaUltimaCompraFecha) < hace12m)) return false;
      return true;
    });
    if (orden === 'monto') lista.sort((a, b) => b.obumaComprasMontoTotal - a.obumaComprasMontoTotal);
    else if (orden === 'compras') lista.sort((a, b) => b.obumaComprasCantidad - a.obumaComprasCantidad);
    else if (orden === 'ultima') lista.sort((a, b) => (b.obumaUltimaCompraFecha || '').localeCompare(a.obumaUltimaCompraFecha || ''));
    return lista;
  }, [proveedores, q, idsPorItem, filtroCuenta, filtroCompras, fCategoria, fBanco, fFalta, fUltima, orden]);

  // "Ser admin" ya no alcanza solo (pedido explícito, 10-sep-2026) — mismo criterio que el backend
  // (app/api/compras/proveedores/route.ts).
  // Solo lectura (permiso compras_ver sin ninguno de operación): ve el catálogo, no lo modifica.
  const soloLectura = usuario?.rol !== 'admin' && !usuario?.permisos?.compras && !usuario?.permisos?.compras_todo && !usuario?.permisos?.aprobar_comercial;
  // Lectura abierta a todo perfil interno; el externo (cliente) sigue sin acceso.
  const puedeVer = !!usuario && usuario.rol !== 'externo';

  // Envía a Obuma los datos de contacto de la ficha (correo, teléfono, dirección…). Banco y cuenta no: la API de Obuma no los guarda.
  const guardarEnObuma = async (p: Proveedor) => {
    setEnviandoObuma(p.id);
    try {
      const res = await fetch(`/api/compras/proveedores/${p.id}/guardar-obuma`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar en Obuma');
      if (data.noGuardados?.length) toast.warning('Obuma no guardó todo', `No quedaron: ${data.noGuardados.join(', ')}`);
      else toast.success('Guardado en Obuma', p.nombreEmpresa);
      if (data.alterados?.length) toast.warning('Revisa la ficha en Obuma', `Cambiaron campos que no se tocaron: ${data.alterados.join(', ')}`);
    } catch (e: any) {
      toast.error('No se pudo guardar en Obuma', e.message);
    } finally {
      setEnviandoObuma(null);
    }
  };

  const CAMPOS_EDICION = ['contactoNombre', 'telefono', 'correo', 'direccion', 'comuna', 'region', 'giro', 'banco', 'tipoCuenta', 'numeroCuenta', 'titularCuenta', 'rutTitular', 'correoPagos'] as const;
  const iniciarEdicion = (p: Proveedor) => {
    setEdicion(Object.fromEntries(CAMPOS_EDICION.map(c => [c, ((p as any)[c] as string | null) || ''])));
    setEditando(p.id);
  };

  // Guarda en Licitank y, si se pide y la ficha está enlazada, lo envía también a Obuma (solo contacto: banco/cuenta no los guarda su API).
  const guardarEdicion = async (p: Proveedor, aObuma: boolean) => {
    setGuardandoEdicion(true);
    try {
      const res = await fetch(`/api/compras/proveedores/${p.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(edicion) });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
      const nuevo: Proveedor = { ...p, ...Object.fromEntries(Object.entries(edicion).map(([k, v]) => [k, v.trim() || null])) } as Proveedor;
      nuevo.bancoPendienteEnObuma = !!nuevo.obumaProveedorId && !!(nuevo.numeroCuenta || nuevo.banco) && !nuevo.obumaNumeroCuenta;
      setProveedores(lista => lista.map(x => x.id === p.id ? nuevo : x));
      setEditando(null);
      if (aObuma && p.obumaProveedorId) await guardarEnObuma(nuevo);
      else toast.success('Guardado en Licitank', p.nombreEmpresa);
    } catch (e: any) {
      toast.error('No se pudo guardar', e.message);
    } finally {
      setGuardandoEdicion(false);
    }
  };

  const copiarDatosBancarios = async (p: Proveedor) => {
    const texto = [p.nombreEmpresa, p.rut && `RUT ${p.rut}`, p.banco && `Banco: ${p.banco}`, p.tipoCuenta && `Tipo: ${p.tipoCuenta}`, p.numeroCuenta && `N° cuenta: ${p.numeroCuenta}`, p.titularCuenta && `Titular: ${p.titularCuenta}`].filter(Boolean).join('\n');
    try { await navigator.clipboard.writeText(texto); toast.success('Datos bancarios copiados', 'Pégalos en la ficha del proveedor en Obuma.'); }
    catch { toast.error('No se pudo copiar', 'Selecciona y copia el texto a mano.'); }
  };

  // Se carga el catálogo completo y se filtra en pantalla (buscador incluido) para poder combinar nombre, ítem y filtros.
  const cargar = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (verInactivos) qs.set('inactivos', '1');
      const res = await fetch(`/api/compras/proveedores${qs.size ? `?${qs}` : ''}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setProveedores(data.proveedores || []);
    } catch (e: any) {
      toast.error('No se pudieron cargar los proveedores', e.message);
    } finally {
      setLoading(false);
    }
  }, [verInactivos]);

  useEffect(() => {
    if (cargandoSesion) return;
    if (!puedeVer) { router.replace('/dashboard'); return; }
    cargar();
  }, [cargandoSesion, puedeVer, router, cargar]);

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
    limpiarFiltros();
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
        <div className="p-4 sm:p-6 space-y-3"><Esqueleto className="h-7 w-48" />{[1, 2, 3].map(i => <Esqueleto key={i} className="h-14 rounded-xl" />)}</div>
      </AppLayout>
    );
  }
  if (!puedeVer) return null;

  return (
    <AppLayout breadcrumb={[{ label: 'Proveedores' }]}>
      <div className="@container p-4 sm:p-6 w-full space-y-4">
        <Encabezado
          titulo="Proveedores"
          descripcion={`${proveedores.length} proveedor${proveedores.length === 1 ? '' : 'es'} en el catálogo`}
          acciones={
            <>
              <div className="relative">
                <Search size={16} stroke={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar nombre, RUT o ítem…" aria-label="Buscar proveedores"
                  className="h-9 w-56 rounded-lg border border-linea bg-white pl-9 pr-3 text-[13px] text-tinta placeholder:text-tinta-3 outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
              </div>
              {!soloLectura && <Boton onClick={sincronizarObuma} disabled={sincronizando || sincronizandoItems}
                icono={sincronizando ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} stroke={1.75} />}>Sincronizar con Obuma</Boton>}
              {!soloLectura && <Boton onClick={() => setCrearObumaAbierto(true)} icono={<Plus size={16} stroke={1.75} />}>Crear en Obuma</Boton>}
              {!soloLectura && <Boton variante="primario" onClick={() => setFormAbierto(v => !v)} icono={<Plus size={16} stroke={1.75} />}>Agregar</Boton>}
            </>
          }
        />
        {(() => {
          const p = editando != null ? proveedores.find(x => x.id === editando) : null;
          if (!p) return null;
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={e => { if (e.target === e.currentTarget && !guardandoEdicion) setEditando(null); }}>
              <div role="dialog" aria-modal="true" aria-label={`Editar ${p.nombreEmpresa}`} className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[15px] font-semibold text-tinta dark:text-slate-100">Editar proveedor</h2>
                    <p className="text-xs text-tinta-2">{p.nombreEmpresa}{p.rut && ` · ${p.rut}`}</p>
                  </div>
                  <button onClick={() => setEditando(null)} disabled={guardandoEdicion} aria-label="Cerrar" className="text-tinta-2 hover:text-tinta"><X size={18} stroke={1.75} /></button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {([['contactoNombre', 'Contacto'], ['telefono', 'Teléfono'], ['correo', 'Correo'], ['direccion', 'Dirección'], ['comuna', 'Comuna'], ['region', 'Región'], ['giro', 'Giro'],
                    ['banco', 'Banco'], ['tipoCuenta', 'Tipo de cuenta'], ['numeroCuenta', 'N° de cuenta'], ['titularCuenta', 'Titular'], ['rutTitular', 'RUT del titular'], ['correoPagos', 'Correo de pagos']] as const).map(([c, rotulo]) => (
                    <input key={c} value={edicion[c] ?? ''} onChange={e => setEdicion(m => ({ ...m, [c]: e.target.value }))} placeholder={rotulo} aria-label={rotulo}
                      className="h-9 text-[13px] text-tinta placeholder:text-tinta-3 border border-linea dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-slate-100 rounded-lg px-3 outline-none focus-visible:ring-2 focus-visible:ring-marca/60" />
                  ))}
                </div>
                <p className="text-xs text-tinta-2">A Obuma van contacto, teléfono, correo, dirección, comuna, región y giro (sin vaciar lo que ya tenga). Banco y cuenta quedan solo en Licitank: la API de Obuma no los guarda.</p>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Boton onClick={() => setEditando(null)} disabled={guardandoEdicion}>Cancelar</Boton>
                  <Boton variante={p.obumaProveedorId ? undefined : 'primario'} onClick={() => guardarEdicion(p, false)} disabled={guardandoEdicion}>{p.obumaProveedorId ? 'Guardar solo en Licitank' : 'Guardar'}</Boton>
                  {p.obumaProveedorId && <Boton variante="primario" onClick={() => guardarEdicion(p, true)} disabled={guardandoEdicion}
                    icono={guardandoEdicion ? <Loader2 size={16} className="animate-spin" /> : undefined}>Guardar y enviar a Obuma</Boton>}
                </div>
              </div>
            </div>
          );
        })()}
        {crearObumaAbierto && (
          <CrearProveedorObumaModal onCerrar={() => setCrearObumaAbierto(false)}
            onCreado={() => { setCrearObumaAbierto(false); cargar(); }} />
        )}

        {/* Progreso del backfill de ítems del historial (pedido explícito, 14-sep-2026: "todo en
            nuestra base de datos") — traer los ítems es una llamada a Obuma POR CADA orden de
            compra, así que avanza por lotes; esto se ve mientras corre y desaparece al terminar. */}
        {sincronizandoItems && (
          <Banner variante="info">
            <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin flex-shrink-0" />
              Guardando el historial de compras en nuestra base de datos
              {progresoItems && ` — ${progresoItems.guardados} ítem(s) guardados, ${progresoItems.pendientes} orden(es) de compra pendiente(s)`}…
            </span>
          </Banner>
        )}

        {/* Estadísticas en cuadros (pedido explícito, 14-sep-2026) — resumen de lo mismo que hoy solo
            se veía proveedor por proveedor. Los dos primeros son filtros clicables: activan/desactivan
            el mismo criterio que se muestra abajo, para no duplicar controles. */}
        <Lista className="grid grid-cols-2 @xl:grid-cols-4 gap-3">
          <Indicador rotulo="Total" valor={stats.total} />
          <button onClick={() => setFiltroCuenta(v => !v)} aria-pressed={filtroCuenta}
            className={`text-left w-full h-full rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 ${filtroCuenta ? 'ring-2 ring-marca ring-offset-2 dark:ring-offset-slate-950' : ''}`}>
            <Indicador rotulo="Con cuenta bancaria" valor={stats.conCuenta} detalle={filtroCuenta ? 'filtrando' : 'toca para filtrar'} />
          </button>
          <button onClick={() => setFiltroCompras(v => !v)} aria-pressed={filtroCompras}
            className={`text-left w-full h-full rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 ${filtroCompras ? 'ring-2 ring-marca ring-offset-2 dark:ring-offset-slate-950' : ''}`}>
            <Indicador rotulo="Con compras registradas" valor={stats.conCompras} detalle={filtroCompras ? 'filtrando' : 'toca para filtrar'} />
          </button>
          <Indicador rotulo="Comprado histórico" valor={stats.montoTotal} formato={fmtCLP} />
        </Lista>

        <label className="flex items-center gap-2 text-xs text-tinta-2 dark:text-slate-400 w-fit cursor-pointer">
          <input type="checkbox" checked={verInactivos} onChange={e => setVerInactivos(e.target.checked)} className="accent-teal-600" />
          Mostrar también los dados de baja en Obuma
        </label>

        {/* Filtros: se combinan entre sí y con el buscador (nombre, RUT o ítem comprado). */}
        <div className="flex flex-wrap items-center gap-2">
          {([
            ...(opciones.categorias.length ? [['Categoría', fCategoria, setFCategoria, opciones.categorias.map(c => [c, c])] as [string, string, (v: string) => void, string[][]]] : []),
            ['Banco', fBanco, setFBanco, opciones.bancos.map(c => [c, c])],
            ['Falta completar', fFalta, setFFalta, [['correo', 'Sin correo'], ['telefono', 'Sin teléfono'], ['contacto', 'Sin contacto'], ['direccion', 'Sin dirección'], ['cuenta', 'Sin cuenta bancaria'], ['pendiente', 'Banco pendiente en Obuma']]],
            ['Última compra', fUltima, setFUltima, [['12m', 'En los últimos 12 meses'], ['antiguo', 'Hace más de 12 meses'], ['nunca', 'Nunca']]],
          ] as [string, string, (v: string) => void, string[][]][]).map(([rotulo, valor, set, ops]) => (
            <select key={rotulo} value={valor} onChange={e => set(e.target.value)} aria-label={rotulo}
              className={`h-8 text-xs rounded-lg border px-2 bg-white dark:bg-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-marca/60 max-w-[190px] ${valor ? 'border-marca text-marca font-medium' : 'border-linea dark:border-slate-700 text-tinta-2 dark:text-slate-400'}`}>
              <option value="">{rotulo}: todos</option>
              {ops.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          ))}
          <select value={orden} onChange={e => setOrden(e.target.value)} aria-label="Ordenar"
            className="h-8 text-xs rounded-lg border border-linea dark:border-slate-700 px-2 bg-white dark:bg-slate-900 text-tinta-2 dark:text-slate-400 outline-none focus-visible:ring-2 focus-visible:ring-marca/60">
            <option value="nombre">Orden: nombre</option>
            <option value="monto">Orden: más comprado ($)</option>
            <option value="compras">Orden: más órdenes de compra</option>
            <option value="ultima">Orden: compra más reciente</option>
          </select>
          {(hayFiltros || q.trim()) && (
            <span className="flex items-center gap-2 text-xs text-tinta-2 dark:text-slate-400">
              <TrendingUp size={16} stroke={1.75} /> Mostrando {proveedoresFiltrados.length} de {stats.total}
              {idsPorItem.size > 0 && <span className="text-marca font-medium">· incluye a quienes les compramos "{q.trim()}"</span>}
              {hayFiltros && <button onClick={limpiarFiltros} className="underline">limpiar filtros</button>}
            </span>
          )}
        </div>

        {/* Búsqueda por PRODUCTO (pedido explícito, 14-sep-2026) — mismo campo de arriba, pero esto
            busca en las compras REALES de Obuma, no en el catálogo local. Solo se muestra con 3+
            caracteres, para no disparar la búsqueda en cada letra suelta. */}
        {q.trim().length >= 3 && (
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-linea dark:border-slate-800 shadow-tarjeta overflow-hidden">
            <p className="px-4 py-3 text-[13px] font-medium text-tinta dark:text-slate-100 border-b border-linea dark:border-slate-800 flex items-center gap-2">
              <PackageSearch size={16} stroke={1.75} className="text-slate-400" /> ¿A quién le hemos comprado "{q.trim()}"?
            </p>
            {busquedaProducto.estado === 'buscando' && (
              <p className="px-4 py-3 text-[13px] text-tinta-2 flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Buscando en las compras de Obuma…</p>
            )}
            {busquedaProducto.estado === 'error' && (
              <p className="px-4 py-3 text-[13px] text-alerta">No se pudo buscar por producto ahora.</p>
            )}
            {busquedaProducto.estado === 'listo' && busquedaProducto.resultados.length === 0 && (
              <p className="px-4 py-3 text-[13px] text-tinta-2">Nunca le hemos comprado "{q.trim()}" a nadie (o no calza con ningún producto del catálogo de Obuma).</p>
            )}
            {busquedaProducto.estado === 'listo' && busquedaProducto.resultados.length > 0 && (
              <div className="divide-y divide-linea dark:divide-slate-800">
                {busquedaProducto.resultados.map(r => (
                  <button key={r.obumaProveedorId} onClick={() => r.proveedorId && irAProveedor(r.proveedorId)}
                    disabled={!r.proveedorId}
                    className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors disabled:cursor-default disabled:hover:bg-transparent">
                    <p className="text-[13px] font-medium text-tinta dark:text-slate-100">{r.nombreEmpresa}{r.rut && <span className="text-tinta-2 font-normal"> · {r.rut}</span>}</p>
                    <div className="mt-0.5 flex flex-wrap gap-1.5">
                      {r.productos.map((p, i) => (
                        <span key={i} className="text-xs text-marca">
                          {p.nombre} · {p.veces}× {p.ultimaFecha && `· última ${p.ultimaFecha.slice(0, 10)}`}
                        </span>
                      ))}
                    </div>
                    {!r.proveedorId && <p className="text-xs text-tinta-2 mt-0.5">No está en el catálogo local todavía — sincroniza para verlo con ficha completa.</p>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {formAbierto && (
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-linea dark:border-slate-800 shadow-tarjeta p-5 space-y-3">
            <h2 className="text-[15px] font-semibold text-tinta dark:text-slate-100 flex items-center gap-2"><Building2 size={18} stroke={1.75} className="text-slate-400" /> Identidad</h2>
            <div className="grid grid-cols-2 gap-2.5">
              <input value={form.nombreEmpresa} onChange={e => setForm(f => ({ ...f, nombreEmpresa: e.target.value }))} placeholder="Nombre de la empresa (razón social)" aria-label="Razón social"
                className="h-9 text-[13px] text-tinta placeholder:text-tinta-3 border border-linea dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-slate-100 rounded-lg px-3 outline-none focus-visible:ring-2 focus-visible:ring-marca/60 col-span-2" />
              <input value={form.nombreFantasia} onChange={e => setForm(f => ({ ...f, nombreFantasia: e.target.value }))} placeholder="Nombre de fantasía"
                className="h-9 text-[13px] text-tinta placeholder:text-tinta-3 border border-linea dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-slate-100 rounded-lg px-3 outline-none focus-visible:ring-2 focus-visible:ring-marca/60" />
              <input value={form.rut} onChange={e => setForm(f => ({ ...f, rut: e.target.value }))} placeholder="RUT"
                className="h-9 text-[13px] text-tinta placeholder:text-tinta-3 border border-linea dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-slate-100 rounded-lg px-3 outline-none focus-visible:ring-2 focus-visible:ring-marca/60" />
              <input value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))} placeholder="Categoría / rubro"
                className="h-9 text-[13px] text-tinta placeholder:text-tinta-3 border border-linea dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-slate-100 rounded-lg px-3 outline-none focus-visible:ring-2 focus-visible:ring-marca/60" />
              <input value={form.giro} onChange={e => setForm(f => ({ ...f, giro: e.target.value }))} placeholder="Giro"
                className="h-9 text-[13px] text-tinta placeholder:text-tinta-3 border border-linea dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-slate-100 rounded-lg px-3 outline-none focus-visible:ring-2 focus-visible:ring-marca/60" />
            </div>

            <h2 className="text-[15px] font-semibold text-tinta dark:text-slate-100 flex items-center gap-2 pt-2"><Mail size={18} stroke={1.75} className="text-slate-400" /> Contacto</h2>
            <div className="grid grid-cols-2 gap-2.5">
              <input value={form.contactoNombre} onChange={e => setForm(f => ({ ...f, contactoNombre: e.target.value }))} placeholder="Nombre de contacto"
                className="h-9 text-[13px] text-tinta placeholder:text-tinta-3 border border-linea dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-slate-100 rounded-lg px-3 outline-none focus-visible:ring-2 focus-visible:ring-marca/60" />
              <input value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} placeholder="Teléfono"
                className="h-9 text-[13px] text-tinta placeholder:text-tinta-3 border border-linea dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-slate-100 rounded-lg px-3 outline-none focus-visible:ring-2 focus-visible:ring-marca/60" />
              <input value={form.correo} onChange={e => setForm(f => ({ ...f, correo: e.target.value }))} placeholder="Correo"
                className="h-9 text-[13px] text-tinta placeholder:text-tinta-3 border border-linea dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-slate-100 rounded-lg px-3 outline-none focus-visible:ring-2 focus-visible:ring-marca/60" />
              <input value={form.direccion} onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))} placeholder="Dirección"
                className="h-9 text-[13px] text-tinta placeholder:text-tinta-3 border border-linea dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-slate-100 rounded-lg px-3 outline-none focus-visible:ring-2 focus-visible:ring-marca/60" />
              <input value={form.comuna} onChange={e => setForm(f => ({ ...f, comuna: e.target.value }))} placeholder="Comuna"
                className="h-9 text-[13px] text-tinta placeholder:text-tinta-3 border border-linea dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-slate-100 rounded-lg px-3 outline-none focus-visible:ring-2 focus-visible:ring-marca/60" />
              <input value={form.region} onChange={e => setForm(f => ({ ...f, region: e.target.value }))} placeholder="Región"
                className="h-9 text-[13px] text-tinta placeholder:text-tinta-3 border border-linea dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-slate-100 rounded-lg px-3 outline-none focus-visible:ring-2 focus-visible:ring-marca/60" />
            </div>

            <h2 className="text-[15px] font-semibold text-tinta dark:text-slate-100 flex items-center gap-2 pt-2"><Landmark size={18} stroke={1.75} className="text-slate-400" /> Datos de transferencia</h2>
            <div className="grid grid-cols-2 gap-2.5">
              <input value={form.banco} onChange={e => setForm(f => ({ ...f, banco: e.target.value }))} placeholder="Banco"
                className="h-9 text-[13px] text-tinta placeholder:text-tinta-3 border border-linea dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-slate-100 rounded-lg px-3 outline-none focus-visible:ring-2 focus-visible:ring-marca/60" />
              <input value={form.tipoCuenta} onChange={e => setForm(f => ({ ...f, tipoCuenta: e.target.value }))} placeholder="Tipo de cuenta"
                className="h-9 text-[13px] text-tinta placeholder:text-tinta-3 border border-linea dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-slate-100 rounded-lg px-3 outline-none focus-visible:ring-2 focus-visible:ring-marca/60" />
              <input value={form.numeroCuenta} onChange={e => setForm(f => ({ ...f, numeroCuenta: e.target.value }))} placeholder="N° de cuenta"
                className="h-9 text-[13px] text-tinta placeholder:text-tinta-3 border border-linea dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-slate-100 rounded-lg px-3 outline-none focus-visible:ring-2 focus-visible:ring-marca/60" />
              <input value={form.titularCuenta} onChange={e => setForm(f => ({ ...f, titularCuenta: e.target.value }))} placeholder="Titular de la cuenta"
                className="h-9 text-[13px] text-tinta placeholder:text-tinta-3 border border-linea dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-slate-100 rounded-lg px-3 outline-none focus-visible:ring-2 focus-visible:ring-marca/60" />
              <input value={form.rutTitular} onChange={e => setForm(f => ({ ...f, rutTitular: e.target.value }))} placeholder="RUT del titular"
                className="h-9 text-[13px] text-tinta placeholder:text-tinta-3 border border-linea dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-slate-100 rounded-lg px-3 outline-none focus-visible:ring-2 focus-visible:ring-marca/60" />
              <input value={form.correoPagos} onChange={e => setForm(f => ({ ...f, correoPagos: e.target.value }))} placeholder="Correo para pagos/facturas"
                className="h-9 text-[13px] text-tinta placeholder:text-tinta-3 border border-linea dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-slate-100 rounded-lg px-3 outline-none focus-visible:ring-2 focus-visible:ring-marca/60" />
            </div>

            <textarea value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} rows={2} placeholder="Notas…"
              className="w-full text-[13px] text-tinta placeholder:text-tinta-3 border border-linea dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-slate-100 rounded-lg px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-marca/60" />

            <div className="flex items-center justify-end gap-2">
              <Boton onClick={() => setFormAbierto(false)}>Cancelar</Boton>
              <Boton variante="primario" onClick={crear} disabled={!form.nombreEmpresa.trim() || guardando}
                icono={guardando ? <Loader2 size={16} className="animate-spin" /> : undefined}>{guardando ? 'Guardando…' : 'Guardar proveedor'}</Boton>
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-2">{[1, 2, 3, 4, 5].map(i => <Esqueleto key={i} className="h-11 rounded-lg" />)}</div>
        ) : (
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-linea dark:border-slate-800 shadow-tarjeta overflow-x-auto @container/tabla">
            <table className="w-full min-w-[960px] text-[13px]">
              <thead>
                <tr className="border-b border-linea dark:border-slate-800 text-left text-[11px] text-tinta-2 dark:text-slate-400">
                    <th className="px-3 h-10 font-medium ">Proveedor</th>
                    <th className="px-3 h-10 font-medium ">RUT</th>
                    <th className="px-3 h-10 font-medium ">Categoría</th>
                    <th className="px-3 h-10 font-medium ">Contacto</th>
                    <th className="px-3 h-10 font-medium ">Teléfono</th>
                    <th className="px-3 h-10 font-medium ">Correo</th>
                    <th className="px-3 h-10 font-medium ">Cuenta</th>
                    <th className="px-3 h-10 font-medium text-right">Compras</th>
                    <th className="px-3 h-10 font-medium text-right">Comprado</th>
                    <th className="px-3 h-10 font-medium ">Última compra</th>
                    <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-linea dark:divide-slate-800">
              {proveedoresFiltrados.map(p => {
                const activo = expandido === p.id;
                const td = 'px-3 py-2.5 align-middle';
                return (
                <Fragment key={p.id}>
                  <tr id={`proveedor-${p.id}`} onClick={() => toggleExpandido(p)}
                    className={`cursor-pointer transition-colors ${activo ? 'bg-marca-suave' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}>
                    <td className={`${td} font-medium ${activo ? 'text-marca' : 'text-tinta dark:text-slate-100'}`}>{p.nombreEmpresa}{p.nombreFantasia && <span className="text-tinta-2 font-normal"> ({p.nombreFantasia})</span>}</td>
                    <td className={`${td} text-tinta-2 dark:text-slate-400 whitespace-nowrap`}>{p.rut || '—'}</td>
                    <td className={`${td} text-tinta-2 dark:text-slate-400`}>{p.categoria || '—'}</td>
                    <td className={`${td} text-tinta-2 dark:text-slate-400`}>{p.contactoNombre || '—'}</td>
                    <td className={`${td} text-tinta-2 dark:text-slate-400 whitespace-nowrap`}>{p.telefono || '—'}</td>
                    <td className={`${td} text-tinta-2 dark:text-slate-400 max-w-[200px] truncate`} title={p.correo || ''}>{p.correo || '—'}</td>
                    <td className={td}>{p.obumaTieneCuentaBancaria || p.banco ? <span title="Tiene cuenta bancaria" className="inline-flex items-center gap-1 text-xs font-medium text-tinta dark:text-slate-200"><CreditCard size={14} stroke={1.75} className="text-slate-400" /> Sí</span> : <span className="text-tinta-3">—</span>}</td>
                    <td className={`${td} text-right`}>{p.obumaComprasCantidad > 0 ? <span title={`${p.obumaComprasCantidad} orden(es) de compra`} className="inline-flex items-center gap-1 text-xs font-medium text-tinta dark:text-slate-200 tabular-nums"><ShoppingCart size={14} stroke={1.75} className="text-slate-400" /> {p.obumaComprasCantidad}</span> : <span className="text-tinta-3">—</span>}</td>
                    <td className={`${td} text-right text-tinta dark:text-slate-200 whitespace-nowrap`}>{p.obumaComprasMontoTotal > 0 ? fmtCLP(p.obumaComprasMontoTotal) : '—'}</td>
                    <td className={`${td} text-tinta-2 dark:text-slate-400 whitespace-nowrap`}>{p.obumaUltimaCompraFecha ? p.obumaUltimaCompraFecha.slice(0, 10) : '—'}</td>
                    <td className={td}>{activo ? <ChevronUp size={16} stroke={1.75} className="text-marca" /> : <ChevronDown size={16} stroke={1.75} className="text-slate-400" />}</td>
                  </tr>
                  {activo && (
                  <tr className="bg-slate-50/70 dark:bg-slate-950/40"><td colSpan={11} className="px-4 py-4">
                    <div className="space-y-4 sticky left-0 w-[calc(100cqw-2rem)]">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="text-[15px] font-semibold tracking-tight text-tinta dark:text-slate-50">{p.nombreEmpresa}</h3>
                          {p.giro && <p className="text-xs text-tinta-2 dark:text-slate-400 mt-0.5">{p.giro}</p>}
                        </div>
                        {!soloLectura && (
                          <div className="flex flex-wrap items-center gap-2">
                            {p.obumaProveedorId && <Boton onClick={() => guardarEnObuma(p)} disabled={enviandoObuma === p.id}
                              icono={enviandoObuma === p.id ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} stroke={1.75} />}>Reenviar contacto a Obuma</Boton>}
                            <Boton variante="primario" onClick={() => iniciarEdicion(p)}>Editar datos</Boton>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-1 @4xl:grid-cols-3 gap-3">
                        {/* Contacto */}
                        <div className="bg-white dark:bg-slate-900 border border-linea dark:border-slate-800 rounded-xl p-4">
                          <p className="text-[13px] font-semibold text-tinta dark:text-slate-100 flex items-center gap-2 mb-3"><Mail size={18} stroke={1.75} className="text-slate-400" /> Contacto</p>
                          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                            <Dato rotulo="Nombre">{p.contactoNombre}</Dato>
                            <Dato rotulo="Teléfono">{p.telefono}</Dato>
                            <div className="col-span-2"><Dato rotulo="Correo">{p.correo}</Dato></div>
                            <div className="col-span-2"><Dato rotulo="Dirección">{[p.direccion, p.comuna, p.region].filter(Boolean).join(', ')}</Dato></div>
                          </dl>
                          {!(p.contactoNombre || p.telefono || p.correo || p.direccion) && <p className="text-xs text-tinta-2">Sin datos de contacto. Usa «Editar datos» para completarlos.</p>}
                        </div>

                        {/* Cuenta bancaria: lo de Obuma manda; si Obuma no la tiene se muestra lo cargado en Licitank. */}
                        <div className="bg-white dark:bg-slate-900 border border-linea dark:border-slate-800 rounded-xl p-4">
                          <p className="text-[13px] font-semibold text-tinta dark:text-slate-100 flex items-center gap-2 mb-3"><Landmark size={18} stroke={1.75} className="text-slate-400" /> Cuenta bancaria</p>
                          {(p.obumaBanco || p.banco || p.obumaNumeroCuenta || p.numeroCuenta) ? (
                            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                              <div className="col-span-2"><Dato rotulo="Banco">{p.obumaBanco || p.banco}</Dato></div>
                              <Dato rotulo="Tipo">{p.obumaTipoCuenta || p.tipoCuenta}</Dato>
                              <Dato rotulo="N° de cuenta">{p.obumaNumeroCuenta || p.numeroCuenta}</Dato>
                              <Dato rotulo="Titular">{p.titularCuenta}</Dato>
                              <Dato rotulo="RUT del titular">{p.rutTitular}</Dato>
                              <Dato rotulo="Forma de pago">{p.obumaFormaPago}</Dato>
                              <Dato rotulo="Correo de pagos">{p.correoPagos}</Dato>
                            </dl>
                          ) : (
                            <p className="text-xs text-tinta-2">No tiene cuenta bancaria cargada{p.obumaProveedorId ? ' en Obuma ni en Licitank' : ''}.</p>
                          )}
                          {p.bancoPendienteEnObuma && !soloLectura && (
                            <div className="mt-3 pt-3 border-t border-linea dark:border-slate-800 space-y-2">
                              <p className="text-xs text-alerta">Falta cargar estos datos bancarios en Obuma (su API no los guarda).</p>
                              <Boton tamano="sm" onClick={() => copiarDatosBancarios(p)}>Copiar datos bancarios</Boton>
                            </div>
                          )}
                        </div>

                        {/* Resumen de compras */}
                        <div className="bg-white dark:bg-slate-900 border border-linea dark:border-slate-800 rounded-xl p-4">
                          <p className="text-[13px] font-semibold text-tinta dark:text-slate-100 flex items-center gap-2 mb-3"><ShoppingCart size={18} stroke={1.75} className="text-slate-400" /> Lo que le hemos comprado</p>
                          <p className="text-2xl font-semibold tracking-tight tabular-nums text-tinta dark:text-slate-50">{fmtCLP(p.obumaComprasMontoTotal)}</p>
                          <p className="text-xs text-tinta-2 dark:text-slate-400 mt-1">
                            {p.obumaComprasCantidad > 0
                              ? `${p.obumaComprasCantidad} orden(es) de compra${p.obumaUltimaCompraFecha ? ` · última el ${p.obumaUltimaCompraFecha.slice(0, 10)}` : ''}`
                              : 'Nunca le hemos comprado.'}
                          </p>
                        </div>
                      </div>

                      {/* Historial de compras REAL (OC de Obuma) — carga perezosa, ver toggleExpandido. */}
                      <div className="bg-white dark:bg-slate-900 border border-linea dark:border-slate-800 rounded-xl overflow-hidden">
                        <p className="px-4 py-3 text-[13px] font-semibold text-tinta dark:text-slate-100 flex items-center gap-2 border-b border-linea dark:border-slate-800"><PackageSearch size={18} stroke={1.75} className="text-slate-400" /> Órdenes de compra</p>
                        {!p.obumaProveedorId ? (
                          <p className="px-4 py-3 text-xs text-tinta-2">Todavía no está enlazado a una ficha de Obuma, así que no se puede consultar el historial. Usa «Sincronizar con Obuma».</p>
                        ) : historiales[p.id]?.estado === 'cargando' ? (
                          <div className="p-4 space-y-2">{[1, 2, 3].map(i => <Esqueleto key={i} className="h-8 rounded-lg" />)}</div>
                        ) : historiales[p.id]?.estado === 'error' ? (
                          <p className="px-4 py-3 text-xs text-alerta">No se pudo consultar el historial ahora.</p>
                        ) : historiales[p.id]?.estado === 'listo' ? (
                          (() => {
                            const h = historiales[p.id] as { estado: 'listo'; tieneObuma: boolean; compras: CompraOcResumen[]; totalComprado: number; hayMas: boolean };
                            if (h.compras.length === 0) return <p className="px-4 py-3 text-xs text-tinta-2">Nunca le hemos comprado (sin órdenes de compra en Obuma).</p>;
                            return (
                              <div>
                                <table className="w-full text-[13px]">
                                  <thead>
                                    <tr className="text-left text-[11px] text-tinta-2 dark:text-slate-400 border-b border-linea dark:border-slate-800">
                                      <th className="px-4 h-9 font-medium">Orden</th>
                                      <th className="px-3 h-9 font-medium">Fecha</th>
                                      <th className="px-3 h-9 font-medium">Estado</th>
                                      <th className="px-4 h-9 font-medium text-right">Monto</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-linea dark:divide-slate-800">
                                    {h.compras.map(c => (
                                      <Fragment key={c.id}>
                                        <tr onClick={() => c.folio && toggleOc(c.folio)} className={c.folio ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50' : ''}>
                                          <td className="px-4 h-10 font-medium text-tinta dark:text-slate-100 whitespace-nowrap">{c.folio ? `OC ${c.folio}` : `#${c.id}`}</td>
                                          <td className="px-3 h-10 text-tinta-2 dark:text-slate-400 whitespace-nowrap">{c.fecha.slice(0, 10)}</td>
                                          <td className="px-3 h-10 text-tinta-2 dark:text-slate-400"><Estado color={/FACTURADA|RECIBIDA|PAGADA/i.test(c.estado) ? '#16a34a' : /ANULADA|RECHAZADA/i.test(c.estado) ? '#dc2626' : '#94a3b8'}>{c.estado.charAt(0) + c.estado.slice(1).toLowerCase()}</Estado></td>
                                          <td className="px-4 h-10 text-right font-semibold tabular-nums text-tinta dark:text-slate-100 whitespace-nowrap">{fmtCLP(c.total)}</td>
                                        </tr>
                                        {c.folio && ocAbierta === c.folio && (
                                          <tr><td colSpan={4} className="px-4 pb-3 pt-1 bg-slate-50/70 dark:bg-slate-950/40">
                                            {itemsPorFolio[c.folio]?.estado === 'cargando' && <Esqueleto className="h-6 rounded-lg" />}
                                            {itemsPorFolio[c.folio]?.estado === 'error' && <p className="text-xs text-alerta">No se pudieron cargar los ítems.</p>}
                                            {itemsPorFolio[c.folio]?.estado === 'listo' && (
                                              <ul className="space-y-1">
                                                {(itemsPorFolio[c.folio] as { estado: 'listo'; items: ItemCompraOc[] }).items.map((it, i) => (
                                                  <li key={i} className="flex items-baseline justify-between gap-3 text-xs text-tinta-2 dark:text-slate-400">
                                                    <span className="min-w-0">{it.cantidad}× {it.nombre}</span>
                                                    <span className="tabular-nums whitespace-nowrap">{fmtCLP(it.subtotal)}</span>
                                                  </li>
                                                ))}
                                              </ul>
                                            )}
                                          </td></tr>
                                        )}
                                      </Fragment>
                                    ))}
                                  </tbody>
                                </table>
                                {h.hayMas && <p className="px-4 py-2 text-xs text-tinta-2 border-t border-linea dark:border-slate-800">Mostrando las {h.compras.length} más recientes: hay más en Obuma.</p>}
                              </div>
                            );
                          })()
                        ) : null}
                      </div>
                    </div>
                  </td></tr>
                  )}
                </Fragment>
                );
              })}
              </tbody>
            </table>
            {proveedoresFiltrados.length === 0 && (
              <div className="p-5"><Vacio icono={<Building2 size={28} stroke={1.75} />}
                titulo={proveedores.length === 0 ? 'Sin proveedores todavía' : 'Ningún proveedor calza con el filtro'}
                texto={proveedores.length === 0 ? 'Agrega el primero o sincroniza con Obuma.' : 'Quita el filtro o cambia la búsqueda.'} /></div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
