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
import {
  Truck, Loader2, Plus, X, Star, AlertTriangle, Search, MapPin,
} from 'lucide-react';

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
  const [zonaBusqueda, setZonaBusqueda] = useState('');
  const [urgente, setUrgente] = useState(false);
  const [sugerencias, setSugerencias] = useState<Sugerencia[] | null>(null);
  const [buscando, setBuscando] = useState(false);

  const esAdmin = usuario?.rol === 'admin';
  const puedeVer = esAdmin || !!usuario?.permisos?.compras || !!usuario?.permisos?.aprobar_comercial;

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
        <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="w-6 h-6 animate-spin text-zinc-400" /></div>
      </AppLayout>
    );
  }
  if (!puedeVer) return null;

  return (
    <AppLayout breadcrumb={[{ label: 'Fleteros' }]}>
      <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center flex-shrink-0"><Truck size={17} className="text-teal-600" /></div>
            <div>
              <h1 className="text-[16px] font-bold text-zinc-900 leading-tight">Fleteros</h1>
              <p className="text-[12px] text-zinc-500">{fleteros.length} fletero(s) en el catálogo</p>
            </div>
          </div>
          <button onClick={() => setFormAbierto(v => !v)} className="flex items-center gap-1.5 text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 px-3 py-2 rounded-lg">
            <Plus size={14} /> Agregar fletero
          </button>
        </div>

        {formAbierto && (
          <div className="bg-white rounded-xl border border-zinc-200 p-4 space-y-2.5">
            <div className="grid grid-cols-2 gap-2.5">
              <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Nombre del fletero"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.rut} onChange={e => setForm(f => ({ ...f, rut: e.target.value }))} placeholder="RUT (enganche con OBUMA)"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <Select value={form.categoria} onChange={v => setForm(f => ({ ...f, categoria: v as Categoria }))}
                options={[{ value: 'UNICA', label: 'Carga única' }, { value: 'CONSOLIDADA', label: 'Carga consolidada' }]} minWidth={160} />
              <input value={form.zonas} onChange={e => setForm(f => ({ ...f, zonas: e.target.value }))} placeholder="Zonas que cubre (separadas por coma)"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.capacidadCamion} onChange={e => setForm(f => ({ ...f, capacidadCamion: e.target.value }))} placeholder="Capacidad del camión"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.tipoCamion} onChange={e => setForm(f => ({ ...f, tipoCamion: e.target.value }))} placeholder="Tipo de camión"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input inputMode="numeric" value={form.precio} onChange={e => setForm(f => ({ ...f, precio: e.target.value }))} placeholder="Precio"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input inputMode="numeric" value={form.costoKm} onChange={e => setForm(f => ({ ...f, costoKm: e.target.value }))} placeholder="Costo por km"
                className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              {form.categoria === 'CONSOLIDADA' && (
                <input inputMode="numeric" value={form.plazoDespachoDias} onChange={e => setForm(f => ({ ...f, plazoDespachoDias: e.target.value }))}
                  placeholder="Plazo de despacho (días) — acá el plazo manda"
                  className="text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              )}
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-[12px] text-zinc-600">
                <input type="checkbox" checked={form.incluyeDescarga} onChange={e => setForm(f => ({ ...f, incluyeDescarga: e.target.checked }))} className="accent-teal-600" /> Incluye descarga
              </label>
              <label className="flex items-center gap-1.5 text-[12px] text-zinc-600">
                <input type="checkbox" checked={form.tienePionetas} onChange={e => setForm(f => ({ ...f, tienePionetas: e.target.checked }))} className="accent-teal-600" /> Tiene pionetas
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={crear} disabled={!form.nombre.trim() || guardando}
                className="text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-3 py-1.5 rounded-lg">
                {guardando ? <Loader2 size={13} className="animate-spin" /> : 'Guardar'}
              </button>
              <button onClick={() => setFormAbierto(false)} className="text-zinc-400 hover:text-zinc-600"><X size={16} /></button>
            </div>
          </div>
        )}

        {/* §13.5: sugerencia automática por zona */}
        <div className="bg-white rounded-xl border border-zinc-200 p-4 space-y-2.5">
          <p className="text-[11px] font-bold text-zinc-400 uppercase flex items-center gap-1.5"><MapPin size={13} /> Sugerencia por zona de entrega</p>
          <div className="flex items-center gap-2 flex-wrap">
            <input value={zonaBusqueda} onChange={e => setZonaBusqueda(e.target.value)} placeholder="Ej: Coyhaique"
              onKeyDown={e => e.key === 'Enter' && buscarSugerencia()}
              className="flex-1 min-w-[160px] text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
            <label className="flex items-center gap-1.5 text-[12px] text-zinc-600">
              <input type="checkbox" checked={urgente} onChange={e => setUrgente(e.target.checked)} className="accent-rose-600" /> Cadena de Urgencia (solo carga única)
            </label>
            <button onClick={buscarSugerencia} disabled={!zonaBusqueda.trim() || buscando}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-white bg-zinc-800 hover:bg-zinc-900 disabled:opacity-50 px-3 py-1.5 rounded-lg">
              {buscando ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Buscar
            </button>
          </div>
          {sugerencias != null && (
            sugerencias.length === 0 ? (
              <p className="text-[12px] text-zinc-400">Ningún fletero cubre esa zona todavía.</p>
            ) : (
              <div className="space-y-1.5">
                {sugerencias.map((s, i) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 bg-zinc-50 border border-zinc-100 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-zinc-800">{i === 0 && '🏆 '}{s.nombre} <span className="text-[10.5px] font-normal text-zinc-400">({CATEGORIA_LABEL[s.categoria]})</span></p>
                      <p className="text-[11px] text-zinc-400">
                        {s.nota != null && <span className="inline-flex items-center gap-0.5"><Star size={10} className="fill-amber-400 text-amber-400" /> {s.nota}</span>}
                        {s.plazoDespachoDias != null && ` · ${s.plazoDespachoDias} día(s) de despacho`}
                      </p>
                    </div>
                    <span className="text-[13px] font-bold text-zinc-800 flex-shrink-0">{fmtCLP(s.costoTentativo)}</span>
                  </div>
                ))}
              </div>
            )
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>
        ) : (
          <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
            <div className="divide-y divide-zinc-100">
              {fleteros.map(f => (
                <div key={f.id} className={`px-4 py-3 flex items-center justify-between gap-3 flex-wrap ${f.quedoEnPana ? 'opacity-60' : ''}`}>
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold text-zinc-800 flex items-center gap-1.5">
                      {f.nombre}
                      <span className="text-[10px] font-bold text-zinc-400 bg-zinc-100 border border-zinc-200 px-1.5 py-0.5 rounded-full">{CATEGORIA_LABEL[f.categoria]}</span>
                      {f.quedoEnPana && (
                        <span className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                          <AlertTriangle size={10} /> En pana — descartado
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-zinc-400">
                      {f.zonas.length > 0 ? f.zonas.join(', ') : 'sin zonas'}
                      {f.precio != null && ` · ${fmtCLP(f.precio)}`}
                      {f.plazoDespachoDias != null && ` · ${f.plazoDespachoDias} día(s)`}
                      {f.nota != null && <span className="inline-flex items-center gap-0.5 ml-1"><Star size={10} className="fill-amber-400 text-amber-400" /> {f.nota}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => evaluar(f.id)} className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-700">Calificar</button>
                    {!f.quedoEnPana && (
                      <button onClick={() => marcarPana(f.id)} className="text-[11px] font-semibold text-rose-500 hover:text-rose-700">Marcar en pana</button>
                    )}
                  </div>
                </div>
              ))}
              {fleteros.length === 0 && (
                <p className="px-4 py-10 text-center text-[12px] text-zinc-400">Sin fleteros todavía.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
