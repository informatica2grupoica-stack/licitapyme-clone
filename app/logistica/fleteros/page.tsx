'use client';

// FLETEROS (spec §13.3) — catálogo transversal de proveedores de flete: dos categorías con
// variables distintas (carga única / consolidada), evaluación por experiencia (§13.4) y sugerencia
// automática por zona (§13.5). No cuelga de una licitación puntual: se agrega un fletero UNA vez y
// queda disponible para cualquier negocio que necesite retiro en su zona.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { MapaChile } from '@/app/components/MapaChile';
import { REGIONES, REGION_POR_KEY, nombreZona } from '@/app/lib/chile-regiones';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { Select } from '@/app/components/ui/Select';
import { IconTruck as Truck, IconLoader2 as Loader2, IconPlus as Plus, IconX as X, IconStar as Star, IconAlertTriangle as AlertTriangle, IconSearch as Search, IconMapPin as MapPin, IconDownload as Download, IconTrash as Trash } from '@tabler/icons-react';
import { Encabezado, Esqueleto, Vacio } from '@/app/components/ui/kit/Estructura';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Banner } from '@/app/components/ui/Banner';
import { Tooltip } from '@/app/components/ui/Tooltip';
import { useConfirm } from '@/app/components/ui/confirm';

type Categoria = 'UNICA' | 'CONSOLIDADA';

interface Historial { ocs: number; ultimaFecha: string | null; ultimoFlete: number | null }
interface Fletero {
  usos: number;
  id: number; rut: string | null; nombre: string; categoria: Categoria;
  contactoNombre: string | null; telefono: string | null; correo: string | null; comuna: string | null;
  precio: number | null; plazoDespachoDias: number | null;
  quedoEnPana: boolean; nota: number | null; activo: boolean; zonas: string[]; historial: Historial | null;
}
interface Sugerencia extends Fletero { costoTentativo: number | null }
interface Candidato {
  rut: string; nombre: string; contactoNombre: string | null; telefono: string | null; correo: string | null; comuna: string | null;
  historial: Historial; motivo: string;
}

const fmtFechaCorta = (f: string | null) => {
  if (!f) return null;
  const [a, m, d] = f.slice(0, 10).split('-');
  return a && m && d ? `${d}-${m}-${a}` : null;
};
const textoHistorial = (h: Historial | null) => !h || h.ocs === 0 ? null
  : `${h.ocs} OC en Obuma${h.ultimoFlete ? ` · último flete ${new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(h.ultimoFlete)}` : ''}${h.ultimaFecha ? ` · ${fmtFechaCorta(h.ultimaFecha)}` : ''}`;

const fmtCLP = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const CATEGORIA_LABEL: Record<Categoria, string> = { UNICA: 'Carga única', CONSOLIDADA: 'Carga consolidada' };

export default function FleterosPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const router = useRouter();
  const toast = useToast();
  const confirmar = useConfirm();
  const [fleteros, setFleteros] = useState<Fletero[]>([]);
  const [loading, setLoading] = useState(true);
  const [formAbierto, setFormAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const FORM_VACIO = {
    nombre: '', rut: '', categoria: 'UNICA' as Categoria, contactoNombre: '', telefono: '', correo: '', comuna: '',
    precio: '', plazoDespachoDias: '',
  };
  const [form, setForm] = useState(FORM_VACIO);
  const [filtroRegion, setFiltroRegion] = useState<string | null>(null);
  const [zonasSel, setZonasSel] = useState<string[]>([]); // regiones que cubre (clave de REGIONES); texto libre antiguo también se conserva
  const alternarZona = (key: string) => setZonasSel(z => z.includes(key) ? z.filter(x => x !== key) : [...z, key]);
  const [editandoId, setEditandoId] = useState<number | null>(null); // null = formulario de alta
  // «Traer de Obuma»: transportistas que Obuma ya conoce (por su nombre o porque sus OC son solo de flete) y aún no están aquí.
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [cargandoCand, setCargandoCand] = useState(false);
  const [importando, setImportando] = useState(false);
  // §13.3: la identidad del fletero (razón social) debería salir de OBUMA, no tipearse a mano —
  // antes el RUT era solo un dato suelto "para cuando se resuelva la integración" y nunca se
  // consultaba de verdad.
  const [buscandoObuma, setBuscandoObuma] = useState(false);
  const [obumaResultado, setObumaResultado] = useState<{ estado: 'encontrado'; identidad: { razonSocial: string; contacto: string | null; direccion: string | null; comuna: string | null; telefono: string | null; correo: string | null } } | { estado: 'no_encontrado' } | null>(null);
  const [zonaBusqueda, setZonaBusqueda] = useState('');
  const [urgente, setUrgente] = useState(false);
  const [sugerencias, setSugerencias] = useState<Sugerencia[] | null>(null);
  const [buscando, setBuscando] = useState(false);

  const esAdmin = usuario?.rol === 'admin';
  // Solo lectura (permiso compras_ver sin ninguno de operación): ve el catálogo, no lo modifica.
  const soloLectura = usuario?.rol !== 'admin' && !usuario?.permisos?.compras && !usuario?.permisos?.compras_todo && !usuario?.permisos?.aprobar_comercial;

  const puedeVer = esAdmin || !!usuario?.permisos?.compras || !!usuario?.permisos?.aprobar_comercial || !!usuario?.permisos?.compras_ver || !!usuario?.permisos?.compras_auditor;

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/logistica/fleteros');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setFleteros(data.fleteros || []);
    } catch (e: any) {
      toast.error('No se pudieron cargar los fleteros', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cargandoSesion) return;
    if (!puedeVer) { router.replace('/dashboard'); return; }
    cargar();
  }, [cargandoSesion, puedeVer, router, cargar]);

  const buscarEnObuma = async () => {
    if (!form.rut.trim()) return;
    setBuscandoObuma(true);
    setObumaResultado(null);
    try {
      const res = await fetch(`/api/logistica/fleteros?rutObuma=${encodeURIComponent(form.rut.trim())}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo buscar');
      if (data.identidad) {
        const i = data.identidad;
        setForm(f => ({ ...f, nombre: i.razonSocial, contactoNombre: f.contactoNombre || i.contacto || '', telefono: f.telefono || i.telefono || '', correo: f.correo || i.correo || '', comuna: f.comuna || i.comuna || '' }));
        setObumaResultado({ estado: 'encontrado', identidad: data.identidad });
        toast.success('Encontrado en Obuma', data.identidad.razonSocial);
      } else {
        setObumaResultado({ estado: 'no_encontrado' });
        toast.error('No aparece en Obuma', 'Puede ser un fletero nuevo, sin facturas todavía — completa el nombre a mano.');
      }
    } catch (e: any) {
      toast.error('No se pudo buscar en Obuma', e.message);
    } finally {
      setBuscandoObuma(false);
    }
  };

  const abrirAlta = () => {
    if (formAbierto && editandoId == null) { setFormAbierto(false); return; }
    setEditandoId(null); setForm(FORM_VACIO); setZonasSel([]); setObumaResultado(null); setFormAbierto(true);
  };

  const editar = (f: Fletero) => {
    setEditandoId(f.id); setObumaResultado(null);
    setForm({
      nombre: f.nombre, rut: f.rut ?? '', categoria: f.categoria, contactoNombre: f.contactoNombre ?? '', telefono: f.telefono ?? '',
      correo: f.correo ?? '', comuna: f.comuna ?? '', precio: f.precio != null ? String(f.precio) : '',
      plazoDespachoDias: f.plazoDespachoDias != null ? String(f.plazoDespachoDias) : '',
    });
    setZonasSel(f.zonas);
    setFormAbierto(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const guardarEdicion = async () => {
    if (editandoId == null || !form.nombre.trim()) return;
    setGuardando(true);
    try {
      const res = await fetch(`/api/logistica/fleteros/${editandoId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: form.nombre.trim(), categoria: form.categoria,
          contactoNombre: form.contactoNombre.trim() || null, telefono: form.telefono.trim() || null,
          correo: form.correo.trim() || null, comuna: form.comuna.trim() || null,
          precio: form.precio ? Number(form.precio) : null,
          plazoDespachoDias: form.categoria === 'CONSOLIDADA' && form.plazoDespachoDias ? Number(form.plazoDespachoDias) : null,
          zonas: zonasSel,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
      setFleteros(data.fleteros);
      toast.success('Cambios guardados');
      setEditandoId(null); setForm(FORM_VACIO); setZonasSel([]); setFormAbierto(false);
    } catch (e: any) {
      toast.error('No se pudieron guardar los cambios', e.message);
    } finally {
      setGuardando(false);
    }
  };

  const crear = async () => {
    if (!form.nombre.trim()) return;
    setGuardando(true);
    try {
      const res = await fetch('/api/logistica/fleteros', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: form.nombre.trim(), rut: form.rut.trim() || null, categoria: form.categoria,
          contactoNombre: form.contactoNombre.trim() || null, telefono: form.telefono.trim() || null,
          correo: form.correo.trim() || null, comuna: form.comuna.trim() || null,
          precio: form.precio ? Number(form.precio) : null,
          plazoDespachoDias: form.plazoDespachoDias ? Number(form.plazoDespachoDias) : null,
          zonas: zonasSel,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo crear');
      toast.success('Fletero agregado');
      setFleteros(data.fleteros);
      setForm(FORM_VACIO);
      setZonasSel([]);
      setObumaResultado(null);
      setFormAbierto(false);
    } catch (e: any) {
      toast.error('No se pudo agregar el fletero', e.message);
    } finally {
      setGuardando(false);
    }
  };

  const abrirCandidatos = async () => {
    setCargandoCand(true);
    try {
      const res = await fetch('/api/logistica/fleteros?candidatos=1');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo buscar');
      setCandidatos(data.candidatos || []);
      setElegidos(new Set((data.candidatos || []).map((c: Candidato) => c.rut)));
    } catch (e: any) {
      toast.error('No se pudo buscar en Obuma', e.message);
    } finally {
      setCargandoCand(false);
    }
  };

  const importar = async () => {
    if (elegidos.size === 0) return;
    setImportando(true);
    try {
      const res = await fetch('/api/logistica/fleteros', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ importarRuts: [...elegidos] }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo importar');
      setFleteros(data.fleteros);
      toast.success('Transportistas importados', `${data.importados} agregado${data.importados === 1 ? '' : 's'} al catálogo`);
      setCandidatos(null);
    } catch (e: any) {
      toast.error('No se pudo importar', e.message);
    } finally {
      setImportando(false);
    }
  };

  // Eliminar con validación: si ya se usó en retiros de negocios solo se explica por qué no se puede; si no, se pide confirmar.
  // El servidor repite la validación (por si otro usuario lo asignó mientras tanto).
  const eliminar = async (f: Fletero) => {
    if (f.usos > 0) {
      await confirmar({
        titulo: 'No se puede eliminar',
        mensaje: `${f.nombre} está en ${f.usos} retiro${f.usos === 1 ? '' : 's'} de negocios y se perdería ese historial. Si ya no quieres usarlo, márcalo «en pana».`,
        confirmarLabel: 'Entendido', cancelarLabel: 'Cerrar',
      });
      return;
    }
    const ok = await confirmar({
      titulo: `¿Eliminar a ${f.nombre}?`,
      mensaje: 'Se borra del catálogo junto con sus zonas y no se puede deshacer. Si solo no quieres usarlo más, mejor márcalo «en pana».',
      confirmarLabel: 'Eliminar', peligro: true,
      lista: [f.rut ? `RUT ${f.rut}` : 'Sin RUT', f.zonas.length ? `Zonas: ${f.zonas.map(nombreZona).join(', ')}` : 'Sin zonas', textoHistorial(f.historial) ?? 'Sin historial en Obuma'],
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/logistica/fleteros/${f.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo eliminar');
      setFleteros(data.fleteros);
      toast.success('Fletero eliminado', data.eliminado);
    } catch (e: any) {
      toast.error('No se pudo eliminar', e.message);
    }
  };

  const marcarPana = async (id: number) => {
    if (!window.confirm('¿Confirmas que este fletero quedó en pana? Queda descartado de las sugerencias para siempre (spec §13.3.2).')) return;
    try {
      const res = await fetch(`/api/logistica/fleteros/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'pana' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo registrar');
      setFleteros(data.fleteros);
    } catch (e: any) {
      toast.error('No se pudo registrar', e.message);
    }
  };

  const evaluar = async (id: number) => {
    const nota = window.prompt('Nota del 1 al 5 (spec §13.4 — la define el encargado tras la experiencia):');
    if (!nota) return;
    try {
      const res = await fetch(`/api/logistica/fleteros/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'evaluar', nota: Number(nota) }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo calificar');
      setFleteros(data.fleteros);
    } catch (e: any) {
      toast.error('No se pudo calificar', e.message);
    }
  };

  const buscarSugerencia = async (zona: string = zonaBusqueda) => {
    if (!zona.trim()) return;
    setZonaBusqueda(zona);
    setBuscando(true);
    try {
      const res = await fetch(`/api/logistica/fleteros/sugerencia?zona=${encodeURIComponent(zona.trim())}&urgente=${urgente ? '1' : '0'}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo buscar');
      setSugerencias(data.sugerencias || []);
    } catch (e: any) {
      toast.error('No se pudo calcular la sugerencia', e.message);
    } finally {
      setBuscando(false);
    }
  };

  // Cuántos fleteros (activos, que no quedaron en pana) cubren cada región, para pintar el mapa.
  const conteoRegiones = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of fleteros) {
      if (!f.activo || f.quedoEnPana) continue;
      for (const z of new Set(f.zonas.map(x => x.trim().toLowerCase()))) if (REGION_POR_KEY.has(z)) c[z] = (c[z] ?? 0) + 1;
    }
    return c;
  }, [fleteros]);
  // El mapa sirve para dos cosas: con el formulario abierto marca las regiones del fletero; si no, busca quién llega a esa región.
  const alMapa = (key: string) => { if (formAbierto) alternarZona(key); else setFiltroRegion(f => f === key ? null : key); };
  // Filtro de la lista por región (se activa pinchando el mapa, o con el selector en pantallas chicas).
  const visibles = filtroRegion ? fleteros.filter(f => f.zonas.some(z => z.trim().toLowerCase() === filtroRegion)) : fleteros;

  if (cargandoSesion || (!puedeVer && loading)) {
    return (
      <AppLayout breadcrumb={[{ label: 'Fleteros' }]}>
        <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-3">
          <Esqueleto className="h-7 w-48" />
          {[1, 2, 3].map(i => <Esqueleto key={i} className="h-16 rounded-xl" />)}
        </div>
      </AppLayout>
    );
  }
  if (!puedeVer) return null;

  const SUPERFICIE = 'rounded-xl border border-linea bg-white shadow-tarjeta dark:bg-slate-900 dark:border-slate-800';
  const CAMPO = 'h-9 w-full rounded-lg border border-linea bg-white px-3 text-[13px] text-tinta placeholder:text-tinta-3 outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';
  const CHECK = 'flex items-center gap-2 text-[13px] text-tinta-2 dark:text-slate-300';

  return (
    <AppLayout breadcrumb={[{ label: 'Fleteros' }]}>
      <div className="@container w-full max-w-[1800px] mx-auto px-4 py-4 @3xl:px-8 @3xl:py-6">
      <div className="grid items-start gap-6 @4xl:grid-cols-[minmax(0,1fr)_27rem]">
      <div className="min-w-0 space-y-4">
        <Encabezado
          titulo="Fleteros"
          descripcion={`${fleteros.length} fletero${fleteros.length === 1 ? '' : 's'} en el catálogo`}
          acciones={!soloLectura ? (
            <div className="flex flex-wrap items-center gap-2">
              <Boton onClick={abrirCandidatos} disabled={cargandoCand}
                icono={cargandoCand ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} stroke={1.75} />}>Traer de Obuma</Boton>
              <Boton variante="primario" onClick={abrirAlta} icono={<Plus size={16} stroke={1.75} />}>Agregar fletero</Boton>
            </div>
          ) : undefined}
        />

        {candidatos && (
          <div className={`${SUPERFICIE} p-5 space-y-3`}>
            <div>
              <h2 className="text-[15px] font-semibold text-tinta dark:text-slate-100">Transportistas que Obuma ya conoce</h2>
              <p className="text-xs text-tinta-2 dark:text-slate-400 mt-0.5">Salen de las OC de Obuma: por su nombre o porque sus OC son solo de flete. Desmarca los que no sean fleteros.</p>
            </div>
            {candidatos.length === 0 ? (
              <p className="text-[13px] text-tinta-2 dark:text-slate-400">No hay transportistas nuevos para traer.</p>
            ) : (
              <div className="divide-y divide-linea dark:divide-slate-800 border-y border-linea dark:border-slate-800">
                {candidatos.map(c => (
                  <label key={c.rut} className="flex items-start gap-3 py-2.5 cursor-pointer">
                    <input type="checkbox" className="mt-0.5 accent-teal-600" checked={elegidos.has(c.rut)}
                      onChange={() => setElegidos(s => { const n = new Set(s); if (n.has(c.rut)) n.delete(c.rut); else n.add(c.rut); return n; })} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-tinta dark:text-slate-100">{c.nombre} <span className="text-xs font-normal text-tinta-2 dark:text-slate-400 tabular-nums">· {c.rut}</span></span>
                      <span className="block text-xs text-tinta-2 dark:text-slate-400">
                        {[textoHistorial(c.historial), c.contactoNombre, c.telefono, c.comuna].filter(Boolean).join(' · ') || 'sin más datos'}
                      </span>
                    </span>
                    <span className="text-xs text-tinta-3 flex-shrink-0 hidden @xl:block">{c.motivo}</span>
                  </label>
                ))}
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <Boton onClick={() => setCandidatos(null)}>Cerrar</Boton>
              {candidatos.length > 0 && (
                <Boton variante="primario" onClick={importar} disabled={elegidos.size === 0 || importando}
                  icono={importando ? <Loader2 size={16} className="animate-spin" /> : undefined}>
                  {importando ? 'Importando…' : `Importar ${elegidos.size} seleccionado${elegidos.size === 1 ? '' : 's'}`}
                </Boton>
              )}
            </div>
          </div>
        )}

        {formAbierto && (
          <div className={`${SUPERFICIE} p-5 space-y-3`}>
            <div>
              <h2 className="text-[15px] font-semibold text-tinta dark:text-slate-100">{editandoId != null ? 'Editar fletero' : 'Nuevo fletero'}</h2>
              <p className="text-xs text-tinta-2 dark:text-slate-400 mt-0.5">{editandoId != null ? `RUT ${form.rut || 'sin RUT'} · el RUT no se cambia.` : 'La identidad se busca en Obuma, no se tipea a ciegas (spec §13.3).'}</p>
              <div className={`mt-3 flex items-center gap-2 ${editandoId != null ? 'hidden' : ''}`}>
                <input value={form.rut} onChange={e => { setForm(f => ({ ...f, rut: e.target.value })); setObumaResultado(null); }} placeholder="RUT del fletero" aria-label="RUT del fletero"
                  className={`flex-1 ${CAMPO}`} />
                <Boton onClick={buscarEnObuma} disabled={!form.rut.trim() || buscandoObuma}
                  icono={buscandoObuma ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} stroke={1.75} />}>Buscar en Obuma</Boton>
              </div>
              {obumaResultado?.estado === 'encontrado' && (
                <p className="mt-2 text-xs text-tinta-2 dark:text-slate-300">
                  <b className="font-semibold text-exito">{obumaResultado.identidad.razonSocial}</b>
                  {obumaResultado.identidad.contacto && ` · ${obumaResultado.identidad.contacto}`}
                  {obumaResultado.identidad.direccion && ` · ${obumaResultado.identidad.direccion}${obumaResultado.identidad.comuna ? `, ${obumaResultado.identidad.comuna}` : ''}`}
                </p>
              )}
              {obumaResultado?.estado === 'no_encontrado' && (
                <div className="mt-2"><Banner variante="warning">No tiene facturas en Obuma todavía — puede ser un fletero nuevo. Completa el nombre a mano abajo.</Banner></div>
              )}
            </div>
            <div className="grid grid-cols-1 @xl:grid-cols-2 gap-3">
              <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Nombre del fletero" aria-label="Nombre del fletero"
                className={`${CAMPO} @xl:col-span-2`} />
              <Select value={form.categoria} onChange={v => setForm(f => ({ ...f, categoria: v as Categoria }))}
                options={[{ value: 'UNICA', label: 'Carga única' }, { value: 'CONSOLIDADA', label: 'Carga consolidada' }]} minWidth={160} />
              <input value={form.contactoNombre} onChange={e => setForm(f => ({ ...f, contactoNombre: e.target.value }))} placeholder="Nombre de contacto" aria-label="Nombre de contacto" className={CAMPO} />
              <input type="tel" inputMode="tel" value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} placeholder="Teléfono de contacto" aria-label="Teléfono de contacto" className={CAMPO} />
              <input type="email" value={form.correo} onChange={e => setForm(f => ({ ...f, correo: e.target.value }))} placeholder="Correo (opcional)" aria-label="Correo" className={CAMPO} />
              <input value={form.comuna} onChange={e => setForm(f => ({ ...f, comuna: e.target.value }))} placeholder="Comuna donde está" aria-label="Comuna" className={CAMPO} />
              <div className="@xl:col-span-2">
                <p className="mb-1.5 text-[12px] text-tinta-2 dark:text-slate-400">Regiones que cubre <span className="text-tinta-3">· pincha en el mapa o aquí</span></p>
                <div className="flex flex-wrap gap-1.5">
                  {REGIONES.map(r => {
                    const on = zonasSel.includes(r.key);
                    return (
                      <button key={r.key} type="button" onClick={() => alternarZona(r.key)} aria-pressed={on}
                        className={`h-7 rounded-md border px-2 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 ${on ? 'border-marca bg-marca text-white' : 'border-linea text-tinta-2 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
                        {r.romano} {r.nombre}
                      </button>
                    );
                  })}
                  {zonasSel.filter(z => !REGION_POR_KEY.has(z.trim().toLowerCase())).map(z => (
                    <button key={z} type="button" onClick={() => alternarZona(z)} title="Zona antigua escrita a mano: pincha para quitarla"
                      className="h-7 rounded-md border border-dashed border-amber-400 px-2 text-[12px] text-amber-700">{z} ×</button>
                  ))}
                </div>
              </div>
              <input inputMode="numeric" value={form.precio} onChange={e => setForm(f => ({ ...f, precio: e.target.value }))} placeholder="Precio de referencia" aria-label="Precio de referencia" className={CAMPO} />
              {form.categoria === 'CONSOLIDADA' && (
                <input inputMode="numeric" value={form.plazoDespachoDias} onChange={e => setForm(f => ({ ...f, plazoDespachoDias: e.target.value }))}
                  placeholder="Plazo de despacho (días) — acá el plazo manda" aria-label="Plazo de despacho en días"
                  className={CAMPO} />
              )}
            </div>
            <div className="flex items-center justify-end gap-2">
              <Boton onClick={() => { setFormAbierto(false); setEditandoId(null); }}>Cancelar</Boton>
              <Boton variante="primario" onClick={editandoId != null ? guardarEdicion : crear} disabled={!form.nombre.trim() || guardando}
                icono={guardando ? <Loader2 size={16} className="animate-spin" /> : undefined}>
                {guardando ? 'Guardando…' : editandoId != null ? 'Guardar cambios' : 'Guardar fletero'}
              </Boton>
            </div>
          </div>
        )}

        {/* §13.5: sugerencia automática por zona */}
        <div className={`${SUPERFICIE} p-5 space-y-3`}>
          <h2 className="text-[15px] font-semibold text-tinta dark:text-slate-100 flex items-center gap-2"><MapPin size={18} stroke={1.75} className="text-slate-400" /> Sugerencia por zona de entrega</h2>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <Select value={zonaBusqueda} onChange={setZonaBusqueda} placeholder="Región de entrega" minWidth={200}
                options={REGIONES.map(r => ({ value: r.key, label: `${r.romano} · ${r.nombre}` }))} />
            </div>
            <label className={CHECK}>
              <input type="checkbox" checked={urgente} onChange={e => setUrgente(e.target.checked)} className="accent-teal-600" /> Cadena de Urgencia (solo carga única)
            </label>
            <Boton variante="primario" onClick={() => buscarSugerencia()} disabled={!zonaBusqueda.trim() || buscando}
              icono={buscando ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} stroke={1.75} />}>Buscar</Boton>
          </div>
          {sugerencias != null && (
            sugerencias.length === 0 ? (
              <p className="text-[13px] text-tinta-2 dark:text-slate-400">Ningún fletero cubre {nombreZona(zonaBusqueda)} todavía.</p>
            ) : (
              <div className="space-y-2">
                {sugerencias.map((s, i) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 border-t border-linea dark:border-slate-800 pt-2">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-tinta dark:text-slate-100">
                        {s.nombre} <span className="text-xs font-normal text-tinta-2">({CATEGORIA_LABEL[s.categoria]})</span>
                        {i === 0 && <span className="ml-2 text-xs font-medium text-exito">Mejor opción</span>}
                      </p>
                      <p className="text-xs text-tinta-2 dark:text-slate-400">
                        {s.nota != null && <span className="inline-flex items-center gap-0.5"><Star size={14} stroke={1.75} className="fill-amber-400 text-amber-400" /> {s.nota}</span>}
                        {s.plazoDespachoDias != null && ` · ${s.plazoDespachoDias} día(s) de despacho`}
                      </p>
                    </div>
                    <span className="text-[13px] font-semibold tabular-nums text-tinta dark:text-slate-100 flex-shrink-0">{fmtCLP(s.costoTentativo)}</span>
                  </div>
                ))}
              </div>
            )
          )}
        </div>

        {/* Filtro por región: en pantallas anchas se maneja desde el mapa; en chicas, con este selector */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="@4xl:hidden w-full @xl:w-64">
            <Select value={filtroRegion ?? ''} onChange={v => setFiltroRegion(v || null)} placeholder="Filtrar por región" minWidth={200}
              options={[{ value: '', label: 'Todas las regiones' }, ...REGIONES.map(r => ({ value: r.key, label: `${r.romano} · ${r.nombre}` }))]} />
          </div>
          {filtroRegion && (
            <div className="flex items-center gap-2 text-[13px] text-tinta-2 dark:text-slate-300">
              <MapPin size={16} stroke={1.75} className="text-marca" />
              <span><b className="font-semibold text-tinta dark:text-slate-100">{visibles.length}</b> fletero{visibles.length === 1 ? '' : 's'} en {nombreZona(filtroRegion)}</span>
              <Boton variante="fantasma" tamano="sm" onClick={() => setFiltroRegion(null)} icono={<X size={14} stroke={1.75} />}>Quitar filtro</Boton>
            </div>
          )}
        </div>

        {loading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <Esqueleto key={i} className="h-16 rounded-xl" />)}</div>
        ) : filtroRegion && visibles.length === 0 && fleteros.length > 0 ? (
          <Vacio icono={<MapPin size={28} stroke={1.75} />} titulo={`Ningún fletero cubre ${nombreZona(filtroRegion)}`}
            texto="Usa «Editar» en un fletero para agregarle esta región." />
        ) : fleteros.length === 0 ? (
          <Vacio icono={<Truck size={28} stroke={1.75} />} titulo="Sin fleteros todavía" texto={soloLectura ? 'Cuando el equipo agregue fleteros, aparecerán aquí.' : 'Agrega el primero con el botón «Agregar fletero».'} />
        ) : (
          <div className={`${SUPERFICIE} overflow-hidden`}>
            <div className="divide-y divide-linea dark:divide-slate-800">
              {visibles.map(f => (
                <div key={f.id} className={`px-4 py-3.5 flex items-center justify-between gap-3 flex-wrap ${f.quedoEnPana ? 'opacity-60' : ''}`}>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-tinta dark:text-slate-100 flex items-center gap-2 flex-wrap">
                      {f.nombre}
                      <span className="text-xs font-normal text-tinta-2 dark:text-slate-400">{CATEGORIA_LABEL[f.categoria]}</span>
                      {f.quedoEnPana && (
                        <span className="text-xs font-medium text-urgente flex items-center gap-1">
                          <AlertTriangle size={14} stroke={1.75} /> En pana — descartado
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-tinta-2 dark:text-slate-400 mt-0.5">
                      {f.zonas.length > 0 ? f.zonas.map(nombreZona).join(', ') : 'sin zonas'}
                      {f.precio != null && ` · ${fmtCLP(f.precio)}`}
                      {f.plazoDespachoDias != null && ` · ${f.plazoDespachoDias} día(s)`}
                      {f.nota != null && <span className="inline-flex items-center gap-0.5 ml-1"><Star size={14} stroke={1.75} className="fill-amber-400 text-amber-400" /> {f.nota}</span>}
                    </p>
                    {(f.contactoNombre || f.telefono || f.correo) && (
                      <p className="text-xs text-tinta-2 dark:text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        {f.contactoNombre && <span>{f.contactoNombre}</span>}
                        {f.telefono && <a href={`tel:${f.telefono.replace(/\s/g, '')}`} className="text-marca hover:underline tabular-nums">{f.telefono}</a>}
                        {f.correo && <a href={`mailto:${f.correo}`} className="text-marca hover:underline break-all">{f.correo}</a>}
                      </p>
                    )}
                    {textoHistorial(f.historial) && <p className="text-xs text-tinta-3 mt-0.5">{textoHistorial(f.historial)}</p>}
                  </div>
                  {(
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {!soloLectura && <Boton variante="fantasma" tamano="sm" onClick={() => editar(f)}>Editar</Boton>}
                      <Boton variante="fantasma" tamano="sm" onClick={() => evaluar(f.id)}>Calificar</Boton>
                      {!f.quedoEnPana && <Boton variante="peligro" tamano="sm" onClick={() => marcarPana(f.id)}>Marcar en pana</Boton>}
                      {!soloLectura && (
                        <Tooltip label={f.usos > 0 ? `En uso en ${f.usos} retiro${f.usos === 1 ? '' : 's'}: no se puede eliminar` : 'Eliminar del catálogo'}>
                          <button type="button" onClick={() => eliminar(f)} aria-label={`Eliminar ${f.nombre}`}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-rose-50 hover:text-urgente focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:hover:bg-slate-800">
                            <Trash size={16} stroke={1.75} />
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <aside className="hidden @4xl:block sticky top-4">
        <div className={`${SUPERFICIE} flex h-[calc(100vh-7rem)] min-h-[560px] flex-col p-4`}>
          <h2 className="text-[15px] font-semibold text-tinta dark:text-slate-100">Cobertura por región</h2>
          <p className="mt-0.5 text-xs text-tinta-2 dark:text-slate-400">
            {formAbierto ? 'Pincha las regiones que cubre este fletero.' : 'Pincha una región para filtrar la lista. Las más oscuras tienen más fleteros.'}
          </p>
          <div className="mt-2 min-h-0 flex-1">
            <MapaChile conteo={conteoRegiones} seleccion={formAbierto ? zonasSel : filtroRegion ? [filtroRegion] : []} onElegir={alMapa} />
          </div>
        </div>
      </aside>
      </div>
      </div>
    </AppLayout>
  );
}
