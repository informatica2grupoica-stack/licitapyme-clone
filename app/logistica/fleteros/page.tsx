'use client';

// FLETEROS (spec §13.3) — catálogo transversal de proveedores de flete: dos categorías con
// variables distintas (carga única / consolidada), evaluación por experiencia (§13.4) y sugerencia
// automática por zona (§13.5). No cuelga de una licitación puntual: se agrega un fletero UNA vez y
// queda disponible para cualquier negocio que necesite retiro en su zona.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { Select } from '@/app/components/ui/Select';
import { IconTruck as Truck, IconLoader2 as Loader2, IconPlus as Plus, IconX as X, IconStar as Star, IconAlertTriangle as AlertTriangle, IconSearch as Search, IconMapPin as MapPin } from '@tabler/icons-react';
import { Encabezado, Esqueleto, Vacio } from '@/app/components/ui/kit/Estructura';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Banner } from '@/app/components/ui/Banner';

type Categoria = 'UNICA' | 'CONSOLIDADA';

interface Fletero {
  id: number; rut: string | null; nombre: string; categoria: Categoria;
  capacidadCamion: string | null; tipoCamion: string | null; precio: number | null; costoKm: number | null;
  incluyeDescarga: boolean; tienePionetas: boolean; plazoDespachoDias: number | null;
  quedoEnPana: boolean; nota: number | null; activo: boolean; zonas: string[];
}
interface Sugerencia extends Fletero { costoTentativo: number | null }

const fmtCLP = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const CATEGORIA_LABEL: Record<Categoria, string> = { UNICA: 'Carga única', CONSOLIDADA: 'Carga consolidada' };

export default function FleterosPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [fleteros, setFleteros] = useState<Fletero[]>([]);
  const [loading, setLoading] = useState(true);
  const [formAbierto, setFormAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [form, setForm] = useState({
    nombre: '', rut: '', categoria: 'UNICA' as Categoria, capacidadCamion: '', tipoCamion: '',
    precio: '', costoKm: '', plazoDespachoDias: '', zonas: '', incluyeDescarga: false, tienePionetas: false,
  });
  // §13.3: la identidad del fletero (razón social) debería salir de OBUMA, no tipearse a mano —
  // antes el RUT era solo un dato suelto "para cuando se resuelva la integración" y nunca se
  // consultaba de verdad.
  const [buscandoObuma, setBuscandoObuma] = useState(false);
  const [obumaResultado, setObumaResultado] = useState<{ estado: 'encontrado'; identidad: { razonSocial: string; contacto: string | null; direccion: string | null; comuna: string | null } } | { estado: 'no_encontrado' } | null>(null);
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
        setForm(f => ({ ...f, nombre: data.identidad.razonSocial }));
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

  const crear = async () => {
    if (!form.nombre.trim()) return;
    setGuardando(true);
    try {
      const res = await fetch('/api/logistica/fleteros', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: form.nombre.trim(), rut: form.rut.trim() || null, categoria: form.categoria,
          capacidadCamion: form.capacidadCamion.trim() || null, tipoCamion: form.tipoCamion.trim() || null,
          precio: form.precio ? Number(form.precio) : null, costoKm: form.costoKm ? Number(form.costoKm) : null,
          plazoDespachoDias: form.plazoDespachoDias ? Number(form.plazoDespachoDias) : null,
          zonas: form.zonas.split(',').map(z => z.trim()).filter(Boolean),
          incluyeDescarga: form.incluyeDescarga, tienePionetas: form.tienePionetas,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo crear');
      toast.success('Fletero agregado');
      setFleteros(data.fleteros);
      setForm({ nombre: '', rut: '', categoria: 'UNICA', capacidadCamion: '', tipoCamion: '', precio: '', costoKm: '', plazoDespachoDias: '', zonas: '', incluyeDescarga: false, tienePionetas: false });
      setObumaResultado(null);
      setFormAbierto(false);
    } catch (e: any) {
      toast.error('No se pudo agregar el fletero', e.message);
    } finally {
      setGuardando(false);
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

  const buscarSugerencia = async () => {
    if (!zonaBusqueda.trim()) return;
    setBuscando(true);
    try {
      const res = await fetch(`/api/logistica/fleteros/sugerencia?zona=${encodeURIComponent(zonaBusqueda.trim())}&urgente=${urgente ? '1' : '0'}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo buscar');
      setSugerencias(data.sugerencias || []);
    } catch (e: any) {
      toast.error('No se pudo calcular la sugerencia', e.message);
    } finally {
      setBuscando(false);
    }
  };

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
      <div className="@container p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
        <Encabezado
          titulo="Fleteros"
          descripcion={`${fleteros.length} fletero${fleteros.length === 1 ? '' : 's'} en el catálogo`}
          acciones={!soloLectura ? (
            <Boton variante="primario" onClick={() => setFormAbierto(v => !v)} icono={<Plus size={16} stroke={1.75} />}>Agregar fletero</Boton>
          ) : undefined}
        />

        {formAbierto && (
          <div className={`${SUPERFICIE} p-5 space-y-3`}>
            <div>
              <h2 className="text-[15px] font-semibold text-tinta dark:text-slate-100">Nuevo fletero</h2>
              <p className="text-xs text-tinta-2 dark:text-slate-400 mt-0.5">La identidad se busca en Obuma, no se tipea a ciegas (spec §13.3).</p>
              <div className="mt-3 flex items-center gap-2">
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
              <input value={form.zonas} onChange={e => setForm(f => ({ ...f, zonas: e.target.value }))} placeholder="Zonas que cubre (separadas por coma)" aria-label="Zonas que cubre" className={CAMPO} />
              <input value={form.capacidadCamion} onChange={e => setForm(f => ({ ...f, capacidadCamion: e.target.value }))} placeholder="Capacidad del camión" aria-label="Capacidad del camión" className={CAMPO} />
              <input value={form.tipoCamion} onChange={e => setForm(f => ({ ...f, tipoCamion: e.target.value }))} placeholder="Tipo de camión" aria-label="Tipo de camión" className={CAMPO} />
              <input inputMode="numeric" value={form.precio} onChange={e => setForm(f => ({ ...f, precio: e.target.value }))} placeholder="Precio" aria-label="Precio" className={CAMPO} />
              <input inputMode="numeric" value={form.costoKm} onChange={e => setForm(f => ({ ...f, costoKm: e.target.value }))} placeholder="Costo por km" aria-label="Costo por km" className={CAMPO} />
              {form.categoria === 'CONSOLIDADA' && (
                <input inputMode="numeric" value={form.plazoDespachoDias} onChange={e => setForm(f => ({ ...f, plazoDespachoDias: e.target.value }))}
                  placeholder="Plazo de despacho (días) — acá el plazo manda" aria-label="Plazo de despacho en días"
                  className={`${CAMPO} @xl:col-span-2`} />
              )}
            </div>
            <div className="flex items-center gap-5">
              <label className={CHECK}>
                <input type="checkbox" checked={form.incluyeDescarga} onChange={e => setForm(f => ({ ...f, incluyeDescarga: e.target.checked }))} className="accent-teal-600" /> Incluye descarga
              </label>
              <label className={CHECK}>
                <input type="checkbox" checked={form.tienePionetas} onChange={e => setForm(f => ({ ...f, tienePionetas: e.target.checked }))} className="accent-teal-600" /> Tiene pionetas
              </label>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Boton onClick={() => setFormAbierto(false)}>Cancelar</Boton>
              <Boton variante="primario" onClick={crear} disabled={!form.nombre.trim() || guardando}
                icono={guardando ? <Loader2 size={16} className="animate-spin" /> : undefined}>
                {guardando ? 'Guardando…' : 'Guardar fletero'}
              </Boton>
            </div>
          </div>
        )}

        {/* §13.5: sugerencia automática por zona */}
        <div className={`${SUPERFICIE} p-5 space-y-3`}>
          <h2 className="text-[15px] font-semibold text-tinta dark:text-slate-100 flex items-center gap-2"><MapPin size={18} stroke={1.75} className="text-slate-400" /> Sugerencia por zona de entrega</h2>
          <div className="flex items-center gap-3 flex-wrap">
            <input value={zonaBusqueda} onChange={e => setZonaBusqueda(e.target.value)} placeholder="Ej: Coyhaique" aria-label="Zona de entrega"
              onKeyDown={e => e.key === 'Enter' && buscarSugerencia()}
              className={`flex-1 min-w-[160px] ${CAMPO}`} />
            <label className={CHECK}>
              <input type="checkbox" checked={urgente} onChange={e => setUrgente(e.target.checked)} className="accent-teal-600" /> Cadena de Urgencia (solo carga única)
            </label>
            <Boton variante="primario" onClick={buscarSugerencia} disabled={!zonaBusqueda.trim() || buscando}
              icono={buscando ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} stroke={1.75} />}>Buscar</Boton>
          </div>
          {sugerencias != null && (
            sugerencias.length === 0 ? (
              <p className="text-[13px] text-tinta-2 dark:text-slate-400">Ningún fletero cubre esa zona todavía.</p>
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

        {loading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <Esqueleto key={i} className="h-16 rounded-xl" />)}</div>
        ) : fleteros.length === 0 ? (
          <Vacio icono={<Truck size={28} stroke={1.75} />} titulo="Sin fleteros todavía" texto={soloLectura ? 'Cuando el equipo agregue fleteros, aparecerán aquí.' : 'Agrega el primero con el botón «Agregar fletero».'} />
        ) : (
          <div className={`${SUPERFICIE} overflow-hidden`}>
            <div className="divide-y divide-linea dark:divide-slate-800">
              {fleteros.map(f => (
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
                      {f.zonas.length > 0 ? f.zonas.join(', ') : 'sin zonas'}
                      {f.precio != null && ` · ${fmtCLP(f.precio)}`}
                      {f.plazoDespachoDias != null && ` · ${f.plazoDespachoDias} día(s)`}
                      {f.nota != null && <span className="inline-flex items-center gap-0.5 ml-1"><Star size={14} stroke={1.75} className="fill-amber-400 text-amber-400" /> {f.nota}</span>}
                    </p>
                  </div>
                  {(
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Boton variante="fantasma" tamano="sm" onClick={() => evaluar(f.id)}>Calificar</Boton>
                      {!f.quedoEnPana && <Boton variante="peligro" tamano="sm" onClick={() => marcarPana(f.id)}>Marcar en pana</Boton>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
