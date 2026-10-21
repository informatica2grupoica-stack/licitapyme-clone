'use client';

// RUTA DE IMPORTACIÓN Y COSTEO ATERRIZADO (spec §12). Solo se muestra completo cuando el origen es
// IMPORTACION: "la cotización FOB no es el costo del producto" — acá se suma flete internacional +
// aduana + logística local, prorrateados POR UNIDAD, para saber el costo real puesto en bodega.
// 21-oct-2026 (pedido del dueño): VARIOS embarques por negocio (migration-160). Cada embarque tiene
// sus productos, su seguimiento (etapa con fecha + datos para ubicarlo) y sus costos, que se reparten
// solo entre sus unidades. Estilo según la skill ui-sin-aspecto-ia.
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { useCompras } from '@/app/compras/[negocioId]/ComprasContext';
import { IconLoader2 as Loader2 } from '@tabler/icons-react';

type Origen = 'LOCAL' | 'IMPORTACION';
type Etapa = 'PEDIDO' | 'PRODUCCION' | 'EMBARCADO' | 'EN_ADUANA' | 'LIBERADO' | 'EN_BODEGA';
type Medio = 'MARITIMO' | 'AEREO' | 'TERRESTRE' | 'COURIER';
interface ProductoImp { productoId: number; descripcion: string; cantidad: number | null; proveedor: string | null; importado: boolean; embarqueId: number | null }
interface ItemAterrizado { importado: boolean; productoId: number; descripcion: string; embarqueId: number | null; cantidad: number | null; precioUnitarioFob: number | null; extraPorUnidad: number; costoUnitarioAterrizado: number | null }
interface CostoAterrizado { items: ItemAterrizado[]; totalAterrizado: number; totalFob: number; costoSinRepartir: number }
interface DatosEmbarque {
  nombre: string; proveedorExtranjero: string | null; paisOrigen: string | null; medio: Medio | null; incoterm: string | null;
  numeroSeguimiento: string | null; transportista: string | null; agenteAduana: string | null; puertoLlegada: string | null;
  fechaSalida: string | null; fechaLlegadaEstimada: string | null; numeroDin: string | null;
  fleteInternacional: number | null; costosAduana: number | null; costoLogisticoLocal: number | null;
}
interface Embarque extends DatosEmbarque { id: number; estado: Etapa | null; fechas: Partial<Record<Etapa, string>>; productoIds: number[] }

const ETAPAS: Array<{ clave: Etapa; titulo: string; ayuda: string }> = [
  { clave: 'PEDIDO', titulo: 'Pedido', ayuda: 'Se envió la orden al proveedor extranjero y hay factura proforma.' },
  { clave: 'PRODUCCION', titulo: 'En producción', ayuda: 'El proveedor lo está fabricando o preparando (normalmente después del pago o anticipo).' },
  { clave: 'EMBARCADO', titulo: 'Embarcado', ayuda: 'Salió del país de origen: ya hay N° de BL, guía aérea o tracking.' },
  { clave: 'EN_ADUANA', titulo: 'En aduana', ayuda: 'Llegó a Chile y el agente de aduana está haciendo la internación.' },
  { clave: 'LIBERADO', titulo: 'Liberado', ayuda: 'Aduana lo liberó (DIN pagada); falta traerlo a la bodega.' },
  { clave: 'EN_BODEGA', titulo: 'En bodega', ayuda: 'Llegó a nuestra bodega. Este embarque terminó.' },
];
const MEDIOS: Array<{ clave: Medio; titulo: string }> = [
  { clave: 'MARITIMO', titulo: 'Marítimo' }, { clave: 'AEREO', titulo: 'Aéreo' }, { clave: 'TERRESTRE', titulo: 'Terrestre' }, { clave: 'COURIER', titulo: 'Courier' },
];

const fmtCLP = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const fechaCorta = (f: string | null | undefined) => f ? f.split('-').reverse().join('-') : '';
const hoy = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD en hora local
const nombreProducto = (d: string) => d.split(' - ')[0];
const costoDe = (e: DatosEmbarque) => (e.fleteInternacional || 0) + (e.costosAduana || 0) + (e.costoLogisticoLocal || 0);
const conPunto = (color: string, label: string) => (
  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 whitespace-nowrap">
    <span aria-hidden style={{ backgroundColor: color }} className="w-1.5 h-1.5 rounded-full flex-shrink-0" />{label}
  </span>
);
const campoCls = 'mt-0.5 block w-full text-xs text-slate-800 border border-slate-300 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-600 bg-white disabled:bg-slate-50';
const Paso = ({ n, titulo, extra }: { n: number; titulo: string; extra?: React.ReactNode }) => (
  <p className="text-[13px] font-medium text-slate-800 flex items-center gap-2 flex-wrap">
    <span className="inline-flex w-5 h-5 rounded-full bg-teal-700 text-white text-[11px] items-center justify-center">{n}</span>{titulo}{extra}
  </p>
);
// Días de atraso según la llegada estimada (null si no hay ETA o ya está en bodega).
const atrasoDe = (e: Embarque) => e.fechaLlegadaEstimada && e.estado !== 'EN_BODEGA'
  ? Math.floor((new Date(hoy()).getTime() - new Date(e.fechaLlegadaEstimada).getTime()) / 86_400_000) : null;
const estadoEmbarque = (e: Embarque) => {
  const idx = ETAPAS.findIndex(x => x.clave === e.estado);
  return idx < 0 ? conPunto('#d97706', 'Sin empezar') : conPunto(e.estado === 'EN_BODEGA' ? '#059669' : '#0f766e', ETAPAS[idx].titulo);
};

type Enviar = (cuerpo: Record<string, unknown>, ok?: string) => Promise<void>;

// Ficha de importación POR PRODUCTO (migration-162): los costos van en el embarque, esto es lo propio de cada producto.
interface Ficha {
  fabricante: string | null; paisOrigen: string | null; partidaArancelaria: string | null; numeroFactura: string | null;
  incoterm: string | null; moneda: string | null; precioFob: number | null; cantidadPedida: number | null;
  bultos: number | null; pesoKg: number | null; volumenM3: number | null; arancelPct: number | null; seguro: number | null; notas: string | null;
}
const CAMPOS_FICHA: Array<{ clave: keyof Ficha; titulo: string; ph: string; num?: boolean; ancho?: boolean }> = [
  { clave: 'fabricante', titulo: 'Fabricante / proveedor extranjero', ph: 'Ej. Roco Import Co. Ltd', ancho: true },
  { clave: 'paisOrigen', titulo: 'País de origen', ph: 'Ej. China' },
  { clave: 'partidaArancelaria', titulo: 'Partida arancelaria (HS)', ph: 'Ej. 7324.10' },
  { clave: 'numeroFactura', titulo: 'N° proforma / factura comercial', ph: 'Ej. PI-2026-118' },
  { clave: 'incoterm', titulo: 'Incoterm', ph: 'FOB, CIF, EXW…' },
  { clave: 'moneda', titulo: 'Moneda', ph: 'USD, EUR, CNY…' },
  { clave: 'precioFob', titulo: 'Precio FOB unitario', ph: '0', num: true },
  { clave: 'cantidadPedida', titulo: 'Cantidad pedida', ph: '0', num: true },
  { clave: 'bultos', titulo: 'Bultos', ph: '0', num: true },
  { clave: 'pesoKg', titulo: 'Peso total (kg)', ph: '0', num: true },
  { clave: 'volumenM3', titulo: 'Volumen total (m³)', ph: '0', num: true },
  { clave: 'arancelPct', titulo: 'Arancel (%)', ph: '0', num: true },
  { clave: 'seguro', titulo: 'Seguro internacional', ph: '0', num: true },
];
const fmtNum = (n: number | null | undefined, dec = 2) => n == null ? '—' : new Intl.NumberFormat('es-CL', { maximumFractionDigits: dec }).format(n);

/** Formulario de un producto importado: se despliega al marcar el check. */
function FichaForm({ p, ficha, puedeOperar, enviar, onCerrar }: { p: ProductoImp; ficha: Ficha | undefined; puedeOperar: boolean; enviar: Enviar; onCerrar: () => void }) {
  const toast = useToast();
  const inicial = () => Object.fromEntries(CAMPOS_FICHA.map(c => [c.clave, ficha?.[c.clave] == null ? '' : String(ficha[c.clave])])) as Record<keyof Ficha, string>;
  const [form, setForm] = useState<Record<keyof Ficha, string>>(inicial);
  const [notas, setNotas] = useState(ficha?.notas ?? '');
  const [guardando, setGuardando] = useState(false);
  const guardar = async () => {
    setGuardando(true);
    try { await enviar({ accion: 'fichaProducto', productoId: p.productoId, datos: { ...form, notas } }, 'Ficha guardada'); onCerrar(); }
    catch (e: any) { toast.error('No se pudo guardar la ficha', e.message); }
    finally { setGuardando(false); }
  };
  return (
    <div className="basis-full rounded-lg border border-teal-200 bg-white p-3 space-y-3" data-testid={`ficha-importacion-${p.productoId}`}>
      <p className="text-xs font-medium text-slate-800">Ficha de importación · <span className="font-normal text-slate-600">{nombreProducto(p.descripcion)}</span></p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {CAMPOS_FICHA.map(c => (
          <label key={c.clave} className={`text-[11px] text-slate-500 ${c.ancho ? 'sm:col-span-2' : ''}`}>{c.titulo}
            <input value={form[c.clave]} onChange={ev => setForm(f => ({ ...f, [c.clave]: ev.target.value }))} disabled={!puedeOperar}
              placeholder={c.clave === 'cantidadPedida' && p.cantidad != null ? String(p.cantidad) : c.ph}
              inputMode={c.num ? 'decimal' : undefined} className={`${campoCls}${c.num ? ' tabular-nums' : ''}`} />
          </label>
        ))}
        <label className="text-[11px] text-slate-500 sm:col-span-2 lg:col-span-4">Notas
          <textarea value={notas} onChange={ev => setNotas(ev.target.value)} disabled={!puedeOperar} rows={2} className={campoCls} placeholder="Observaciones del producto" />
        </label>
      </div>
      <div className="flex items-center gap-2 justify-end">
        <button type="button" onClick={onCerrar} className="text-xs text-slate-500 hover:text-slate-800 px-2 py-1">Cerrar</button>
        {puedeOperar && (
          <button type="button" onClick={guardar} disabled={guardando} className="text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg px-3 py-1.5 inline-flex items-center gap-1.5">
            {guardando && <Loader2 className="w-3 h-3 animate-spin" />}Guardar ficha
          </button>
        )}
      </div>
    </div>
  );
}

/** Un embarque: sus productos, su línea de etapas, sus datos y sus costos. */
function EmbarqueCard({ e, productos, puedeOperar, enviar }: { e: Embarque; productos: ProductoImp[]; puedeOperar: boolean; enviar: Enviar }) {
  const toast = useToast();
  const [etapaNueva, setEtapaNueva] = useState<Etapa | null>(null);
  const [fechaEtapa, setFechaEtapa] = useState('');
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState<Record<keyof DatosEmbarque, string>>({} as Record<keyof DatosEmbarque, string>);
  const [guardando, setGuardando] = useState(false);

  const idxActual = ETAPAS.findIndex(x => x.clave === e.estado);
  const terminado = e.estado === 'EN_BODEGA';
  const siguiente = ETAPAS[idxActual + 1] ?? null;
  const atraso = atrasoDe(e);
  const suyos = productos.filter(p => e.productoIds.includes(p.productoId));
  const unidades = suyos.reduce((s, p) => s + (p.cantidad || 0), 0);
  const costo = costoDe(e);
  const tieneDatos = !!(e.proveedorExtranjero || e.paisOrigen || e.medio || e.incoterm || e.numeroSeguimiento || e.transportista || e.agenteAduana || e.puertoLlegada || e.fechaSalida || e.fechaLlegadaEstimada || e.numeroDin);

  const correr = async (f: () => Promise<void>, error: string) => {
    setGuardando(true);
    try { await f(); } catch (err: any) { toast.error(error, err.message); } finally { setGuardando(false); }
  };
  const abrirEtapa = (et: Etapa) => { setEtapaNueva(et); setFechaEtapa(e.fechas[et] || hoy()); };
  const abrirEdicion = () => {
    const v = (x: string | number | null) => x == null ? '' : String(x);
    setForm({
      nombre: e.nombre, proveedorExtranjero: v(e.proveedorExtranjero), paisOrigen: v(e.paisOrigen), medio: v(e.medio), incoterm: v(e.incoterm),
      numeroSeguimiento: v(e.numeroSeguimiento), transportista: v(e.transportista), agenteAduana: v(e.agenteAduana), puertoLlegada: v(e.puertoLlegada),
      fechaSalida: v(e.fechaSalida), fechaLlegadaEstimada: v(e.fechaLlegadaEstimada), numeroDin: v(e.numeroDin),
      fleteInternacional: v(e.fleteInternacional), costosAduana: v(e.costosAduana), costoLogisticoLocal: v(e.costoLogisticoLocal),
    });
    setEditando(true);
  };
  const guardarDatos = () => correr(async () => {
    const monto = (s: string) => { const n = Number(s.replace(/[^\d]/g, '')); return s.trim() === '' ? null : n; };
    const txt = (s: string) => s.trim() || null;
    await enviar({
      accion: 'embarqueGuardar', embarqueId: e.id, datos: {
        nombre: form.nombre, proveedorExtranjero: txt(form.proveedorExtranjero), paisOrigen: txt(form.paisOrigen), medio: txt(form.medio), incoterm: txt(form.incoterm),
        numeroSeguimiento: txt(form.numeroSeguimiento), transportista: txt(form.transportista), agenteAduana: txt(form.agenteAduana), puertoLlegada: txt(form.puertoLlegada),
        fechaSalida: txt(form.fechaSalida), fechaLlegadaEstimada: txt(form.fechaLlegadaEstimada), numeroDin: txt(form.numeroDin),
        fleteInternacional: monto(form.fleteInternacional), costosAduana: monto(form.costosAduana), costoLogisticoLocal: monto(form.costoLogisticoLocal),
      },
    }, 'Embarque guardado');
    setEditando(false);
  }, 'No se pudo guardar el embarque');
  const eliminar = () => {
    if (!window.confirm(`¿Quitar el ${e.nombre}? Sus productos quedan sin embarque (siguen marcados como del extranjero).`)) return;
    void correr(() => enviar({ accion: 'embarqueEliminar', embarqueId: e.id }, 'Embarque quitado'), 'No se pudo quitar el embarque');
  };

  const campo = (clave: keyof DatosEmbarque, titulo: string, placeholder: string, tipo: 'text' | 'date' = 'text', numerico = false) => (
    <label className="text-[11px] text-slate-500">{titulo}
      <input type={tipo} value={form[clave] ?? ''} onChange={ev => setForm(f => ({ ...f, [clave]: ev.target.value }))} placeholder={placeholder}
        inputMode={numerico ? 'numeric' : undefined} className={`${campoCls}${numerico ? ' tabular-nums' : ''}`} />
    </label>
  );
  const dato = (titulo: string, valor: React.ReactNode) => (
    <div>
      <dt className="text-[11px] text-slate-500">{titulo}</dt>
      <dd className="mt-0.5 text-xs text-slate-800">{valor || <span className="text-slate-400">—</span>}</dd>
    </div>
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm px-4 py-3 space-y-3" data-testid={`embarque-${e.id}`}>
      {/* Cabecera: nombre, etapa, N° de seguimiento y llegada */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium text-slate-900">{e.nombre}</p>
          <p className="text-[11px] text-slate-500">
            {[e.proveedorExtranjero, e.paisOrigen, MEDIOS.find(m => m.clave === e.medio)?.titulo].filter(Boolean).join(' · ') || 'Sin datos del envío todavía'}
          </p>
        </div>
        <dl className="flex items-start gap-5 flex-wrap">
          <div><dt className="text-[11px] text-slate-500">Etapa</dt><dd className="mt-0.5">{estadoEmbarque(e)}</dd></div>
          {e.numeroSeguimiento && <div><dt className="text-[11px] text-slate-500">N° de seguimiento</dt><dd className="mt-0.5 text-xs font-medium tabular-nums text-slate-900">{e.numeroSeguimiento}</dd></div>}
          {e.fechaLlegadaEstimada && <div>
            <dt className="text-[11px] text-slate-500">Llegada estimada</dt>
            <dd className={`mt-0.5 text-xs tabular-nums ${atraso != null && atraso > 3 ? 'font-medium text-red-600' : atraso != null && atraso > 0 ? 'font-medium text-amber-700' : 'text-slate-800'}`}>
              {fechaCorta(e.fechaLlegadaEstimada)}{atraso != null && atraso > 0 && ` · ${atraso} día${atraso === 1 ? '' : 's'} de atraso`}
            </dd>
          </div>}
        </dl>
      </div>

      {/* Productos de este embarque */}
      <div>
        <p className="text-[11px] text-slate-500">Productos en este embarque{unidades > 0 && <> · <span className="tabular-nums">{unidades}</span> unidades</>}</p>
        {suyos.length ? (
          <ul className="mt-0.5 text-xs text-slate-700 flex flex-wrap gap-x-4 gap-y-0.5">
            {suyos.map(p => <li key={p.productoId}><span className="font-medium tabular-nums text-slate-900">{p.cantidad ?? '?'} ×</span> {nombreProducto(p.descripcion)}</li>)}
          </ul>
        ) : <p className="mt-0.5 text-xs text-amber-700">Sin productos: asígnalos en el paso 1 con «Embarque».</p>}
      </div>

      {/* Línea de etapas: hecha (verde), actual (teal), pendiente (gris) */}
      <ol className="grid grid-cols-3 lg:grid-cols-6 gap-1.5">
        {ETAPAS.map((et, i) => {
          const hecha = i < idxActual || (i === idxActual && terminado);
          const actual = i === idxActual && !terminado;
          return (
            <li key={et.clave} title={et.ayuda} className={`rounded-lg border px-2 py-1.5 ${actual ? 'border-teal-600/50 bg-teal-50/50' : 'border-slate-200'}`}>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className={`w-4 h-4 rounded-full text-[10px] font-semibold flex items-center justify-center flex-shrink-0 ${hecha ? 'bg-emerald-600 text-white' : actual ? 'bg-teal-700 text-white' : 'bg-slate-200 text-slate-500'}`}>{hecha ? '✓' : i + 1}</span>
                <span className={`text-xs truncate ${actual ? 'font-semibold text-teal-900' : hecha ? 'font-medium text-slate-800' : 'text-slate-500'}`}>{et.titulo}</span>
              </span>
              <span className="block mt-0.5 pl-5.5 text-[11px] tabular-nums text-slate-500">{e.fechas[et.clave] ? fechaCorta(e.fechas[et.clave]) : ' '}</span>
            </li>
          );
        })}
      </ol>

      {puedeOperar && (etapaNueva ? (
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 flex items-end gap-2 flex-wrap max-w-2xl">
          <label className="text-[11px] text-slate-500">Etapa
            <select value={etapaNueva} onChange={ev => abrirEtapa(ev.target.value as Etapa)} className={campoCls}>
              {ETAPAS.map(et => <option key={et.clave} value={et.clave}>{et.titulo}</option>)}
            </select>
          </label>
          <label className="text-[11px] text-slate-500">Fecha en que pasó
            <input type="date" value={fechaEtapa} onChange={ev => setFechaEtapa(ev.target.value)} className={campoCls} />
          </label>
          <button type="button" disabled={guardando || !fechaEtapa}
            onClick={() => correr(async () => { await enviar({ accion: 'embarqueEtapa', embarqueId: e.id, estado: etapaNueva, fecha: fechaEtapa }, 'Etapa actualizada'); setEtapaNueva(null); }, 'No se pudo marcar la etapa')}
            className="text-[12px] font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5">
            {guardando && <Loader2 size={12} className="animate-spin" />} Guardar
          </button>
          <button type="button" onClick={() => setEtapaNueva(null)} className="text-[12px] font-medium text-slate-500 hover:text-slate-800 py-1.5">Cancelar</button>
          <p className="basis-full text-[11px] text-slate-500">{ETAPAS.find(et => et.clave === etapaNueva)?.ayuda}{idxActual >= 0 && ETAPAS.findIndex(et => et.clave === etapaNueva) < idxActual && ' Al volver a una etapa anterior se borran las fechas de las siguientes.'}</p>
        </div>
      ) : !editando && (
        <div className="flex items-center gap-3 flex-wrap">
          {siguiente && (
            <button type="button" onClick={() => abrirEtapa(siguiente.clave)} data-testid={`embarque-${e.id}-siguiente`}
              className="text-[12px] font-semibold text-white bg-teal-700 hover:bg-teal-800 px-3 py-1.5 rounded-lg">Marcar «{siguiente.titulo}»</button>
          )}
          {idxActual >= 0 && <button type="button" onClick={() => abrirEtapa(e.estado!)} className="text-[12px] font-medium text-slate-500 hover:text-slate-800">Corregir etapa o fecha</button>}
          <button type="button" onClick={abrirEdicion} className="text-[12px] font-medium text-teal-700 hover:text-teal-900">{tieneDatos || costo > 0 ? 'Editar datos y costos' : 'Agregar datos y costos'}</button>
        </div>
      ))}

      {/* Datos del envío y costos: resumen rotulado o formulario */}
      {editando ? (
        <div className="pt-3 border-t border-slate-100 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {campo('nombre', 'Nombre del embarque', 'Ej: Bancas desde China')}
            {campo('proveedorExtranjero', 'Proveedor en el extranjero', 'Ej: Foshan Furniture Co.')}
            {campo('paisOrigen', 'País de origen', 'Ej: China')}
            <label className="text-[11px] text-slate-500">Medio
              <select value={form.medio} onChange={ev => setForm(f => ({ ...f, medio: ev.target.value }))} className={campoCls}>
                <option value="">Sin definir</option>
                {MEDIOS.map(m => <option key={m.clave} value={m.clave}>{m.titulo}</option>)}
              </select>
            </label>
            {campo('incoterm', 'Incoterm', 'Ej: FOB, EXW, CIF')}
            {campo('numeroSeguimiento', 'N° de seguimiento (BL, guía aérea o tracking)', 'Ej: MEDU1234567')}
            {campo('transportista', 'Naviera, aerolínea o courier', 'Ej: MSC, DHL')}
            {campo('agenteAduana', 'Agente de aduana', 'Ej: Agencia Pérez')}
            {campo('puertoLlegada', 'Puerto o aeropuerto de llegada', 'Ej: San Antonio')}
            {campo('numeroDin', 'N° de DIN (declaración de ingreso)', 'Cuando la haga el agente')}
            {campo('fechaSalida', 'Fecha de salida (ETD)', '', 'date')}
            {campo('fechaLlegadaEstimada', 'Llegada estimada (ETA)', '', 'date')}
          </div>
          <div>
            <p className="text-xs font-medium text-slate-800">Lo que costó traer este embarque</p>
            <p className="text-[11px] text-slate-500">Se reparte solo entre las unidades de este embarque. Si algo no hubo, déjalo vacío.</p>
            <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-3 gap-2">
              {campo('fleteInternacional', 'Flete internacional', '$ total del flete (barco o avión)', 'text', true)}
              {campo('costosAduana', 'Aduana', '$ aranceles, impuestos y agencia', 'text', true)}
              {campo('costoLogisticoLocal', 'Traslado dentro de Chile', '$ del puerto a la bodega', 'text', true)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={guardarDatos} disabled={guardando}
              className="text-[12px] font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5">
              {guardando && <Loader2 size={12} className="animate-spin" />} Guardar embarque
            </button>
            <button type="button" onClick={() => setEditando(false)} className="text-[12px] font-medium text-slate-500 hover:text-slate-800">Cancelar</button>
            <button type="button" onClick={eliminar} disabled={guardando} className="ml-auto text-[12px] font-medium text-slate-400 hover:text-red-600">Quitar embarque</button>
          </div>
        </div>
      ) : (tieneDatos || costo > 0) && (
        <dl className="pt-3 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-2.5">
          {dato('Incoterm', e.incoterm)}
          {dato('Transporte', e.transportista)}
          {dato('Agente de aduana', e.agenteAduana)}
          {dato('Llega a', e.puertoLlegada)}
          {dato('N° de DIN', e.numeroDin)}
          {dato('Salida (ETD)', fechaCorta(e.fechaSalida))}
          {dato('Flete internacional', e.fleteInternacional != null && <span className="tabular-nums">{fmtCLP(e.fleteInternacional)}</span>)}
          {dato('Aduana', e.costosAduana != null && <span className="tabular-nums">{fmtCLP(e.costosAduana)}</span>)}
          {dato('Traslado en Chile', e.costoLogisticoLocal != null && <span className="tabular-nums">{fmtCLP(e.costoLogisticoLocal)}</span>)}
          {dato('Costo del embarque', costo > 0 && <><b className="tabular-nums">{fmtCLP(costo)}</b>{unidades > 0 && <span className="text-slate-500"> · {fmtCLP(Math.round(costo / unidades))} por unidad</span>}</>)}
        </dl>
      )}
    </div>
  );
}

export function ImportacionCard({ negocioId, puedeOperar }: { negocioId: number; puedeOperar: boolean }) {
  const toast = useToast();
  const { recargar: recargarCompartido } = useCompras();
  const [origen, setOrigen] = useState<Origen | null>(null);
  const [costoAterrizado, setCostoAterrizado] = useState<CostoAterrizado | null>(null);
  const [productos, setProductos] = useState<ProductoImp[]>([]);
  const [embarques, setEmbarques] = useState<Embarque[]>([]);
  const [loading, setLoading] = useState(true);
  const [creando, setCreando] = useState(false);
  const [fichas, setFichas] = useState<Record<number, Ficha>>({});
  const [fichaAbierta, setFichaAbierta] = useState<number | null>(null);

  const aplicar = (data: any) => {
    setOrigen(data.origen?.origen || null);
    setCostoAterrizado(data.costoAterrizado); setProductos(data.productos || []); setEmbarques(data.embarques || []);
    setFichas(data.fichas || {});
  };

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/importacion`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      aplicar(data);
    } catch (e: any) {
      toast.error('No se pudo cargar la ruta de importación', e.message);
    } finally {
      setLoading(false);
    }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);

  // El costo aterrizado alimenta el margen de la Compuerta 2: después de cada cambio se recarga lo compartido.
  const enviar: Enviar = async (cuerpo, ok) => {
    const res = await fetch(`/api/compras/${negocioId}/importacion`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
    aplicar(data);
    recargarCompartido();
    if (ok) toast.success(ok);
  };

  const definirOrigen = async (v: Origen) => {
    try { await enviar({ accion: 'origen', origen: v }); } catch (e: any) { toast.error('No se pudo definir el origen', e.message); }
  };
  const marcar = async (productoId: number, importado: boolean) => {
    setProductos(ps => ps.map(p => p.productoId === productoId ? { ...p, importado } : p));
    setFichaAbierta(importado ? productoId : null);
    try { await enviar({ accion: 'producto', productoId, importado }); }
    catch (e: any) { toast.error('No se pudo marcar el producto', e.message); cargar(); }
  };
  const asignar = async (productoId: number, embarqueId: string) => {
    try { await enviar({ accion: 'productoEmbarque', productoId, embarqueId: embarqueId ? Number(embarqueId) : null }); }
    catch (e: any) { toast.error('No se pudo cambiar el embarque', e.message); }
  };
  const agregarEmbarque = async () => {
    setCreando(true);
    try { await enviar({ accion: 'embarqueCrear' }, 'Embarque agregado'); }
    catch (e: any) { toast.error('No se pudo agregar el embarque', e.message); }
    finally { setCreando(false); }
  };

  if (loading) return <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>;

  const importados = productos.filter(p => p.importado);
  const sinEmbarque = embarques.length > 0 ? importados.filter(p => p.embarqueId == null) : [];
  const enBodega = embarques.filter(e => e.estado === 'EN_BODEGA').length;
  const atrasados = embarques.filter(e => (atrasoDe(e) ?? 0) > 0).length;
  const nombreEmbarque = new Map(embarques.map(e => [e.id, e.nombre]));

  return (
    <div className="space-y-4" data-testid="importacion-guia">
      {/* PASO 1: origen de la compra y, si hay importación, qué productos vienen de afuera y en qué embarque */}
      <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div>
          <Paso n={1} titulo="¿De dónde viene lo que compraste?"
            extra={origen && conPunto(origen === 'LOCAL' ? '#0f766e' : '#d97706', origen === 'LOCAL' ? 'Todo en Chile' : `${importados.length} producto(s) importado(s)`)} />
          {!origen && <p className="mt-0.5 text-xs text-slate-500">Elige una opción para seguir. Si no estás seguro, pregunta a quien hizo la compra.</p>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 max-w-3xl" role="radiogroup" aria-label="Origen de la compra">
          {([
            { v: 'LOCAL', t: 'Todo se compró en Chile', d: 'Proveedores nacionales: no hay nada más que hacer aquí.' },
            { v: 'IMPORTACION', t: 'Algo viene del extranjero', d: 'Marcas qué viene de afuera, en qué embarque, y sigues cada embarque.' },
          ] as const).map(o => {
            const on = origen === o.v;
            return (
              <button key={o.v} type="button" role="radio" aria-checked={on} onClick={() => definirOrigen(o.v)} disabled={!puedeOperar} data-testid={`origen-${o.v}`}
                className={`text-left rounded-md px-3 py-2 transition-colors disabled:cursor-not-allowed ${on ? 'bg-white shadow-sm ring-1 ring-teal-600/40' : 'hover:bg-white/60'}`}>
                <span className={`block text-xs ${on ? 'font-semibold text-teal-800' : 'font-medium text-slate-700'}`}>{o.t}</span>
                <span className="block mt-0.5 text-[11px] text-slate-500 leading-snug">{o.d}</span>
              </button>
            );
          })}
        </div>

        {origen === 'LOCAL' && (
          <p className="text-xs text-slate-600"><b className="font-medium text-slate-800">Aquí no hay nada más que hacer.</b> Como la compra es local, no se suman costos de importación. Si algún día un producto viene de afuera, cambia arriba a «Algo viene del extranjero».</p>
        )}

        {origen === 'IMPORTACION' && (
          <div className="space-y-2 pt-1" data-testid="importacion-productos">
            <p className="text-xs font-medium text-slate-800">¿Cuáles productos vienen del extranjero? <span className="font-normal text-slate-500">Marca solo esos y elige en qué embarque vienen; el resto se compra en Chile.</span></p>
            {productos.length === 0 ? <p className="text-xs text-slate-500">Todavía no hay productos en esta compra.</p> : (
              <ul className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                {productos.map(p => (
                  <li key={p.productoId} className={`flex items-center gap-3 px-3 py-2 flex-wrap ${p.importado ? 'bg-teal-50/40' : ''}`}>
                    <label className="flex items-center gap-3 flex-1 min-w-[240px] cursor-pointer">
                      <input type="checkbox" checked={p.importado} disabled={!puedeOperar} onChange={ev => marcar(p.productoId, ev.target.checked)} className="accent-teal-700" />
                      <span className="text-xs">
                        <span className="font-medium text-slate-900">{nombreProducto(p.descripcion)}</span>
                        {p.cantidad != null && <span className="text-slate-500 tabular-nums"> · {p.cantidad} un.</span>}
                        {p.proveedor && <span className="text-slate-500"> · {p.proveedor}</span>}
                      </span>
                    </label>
                    {p.importado && embarques.length > 0 ? (
                      <label className="flex items-center gap-1.5 text-[11px] text-slate-500">Embarque
                        <select value={p.embarqueId ?? ''} onChange={ev => asignar(p.productoId, ev.target.value)} disabled={!puedeOperar}
                          className={`text-xs border rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-teal-600 bg-white ${p.embarqueId == null ? 'border-amber-400 text-amber-800' : 'border-slate-300 text-slate-800'}`}>
                          <option value="">Sin embarque</option>
                          {embarques.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                        </select>
                      </label>
                    ) : p.importado ? conPunto('#d97706', 'Del extranjero') : conPunto('#94a3b8', 'En Chile')}
                    {p.importado && (
                      <button type="button" onClick={() => setFichaAbierta(fichaAbierta === p.productoId ? null : p.productoId)}
                        className="text-[11px] font-medium text-teal-700 hover:text-teal-900 border border-teal-200 rounded-lg px-2 py-1 bg-white">
                        {fichas[p.productoId] ? 'Ficha' : 'Completar ficha'}
                      </button>
                    )}
                    {p.importado && fichaAbierta === p.productoId && (
                      <FichaForm key={p.productoId} p={p} ficha={fichas[p.productoId]} puedeOperar={puedeOperar} enviar={enviar} onCerrar={() => setFichaAbierta(null)} />
                    )}
                  </li>
                ))}
              </ul>
            )}
            {importados.length > 0 && (
              <div className="pt-1" data-testid="importacion-fichas-tabla">
                <p className="text-xs font-medium text-slate-800 mb-1.5">Datos de importación por producto</p>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-xs min-w-[900px]">
                    <thead>
                      <tr className="text-left text-[11px] font-medium text-slate-500 bg-slate-50 border-b border-slate-200">
                        <th className="px-3 py-2">Producto</th><th className="px-2 py-2">Fabricante</th><th className="px-2 py-2">Origen</th>
                        <th className="px-2 py-2">Partida HS</th><th className="px-2 py-2">N° factura</th><th className="px-2 py-2">Incoterm</th>
                        <th className="px-2 py-2 text-right">FOB c/u</th><th className="px-2 py-2 text-right">Cant.</th><th className="px-2 py-2 text-right">Bultos</th>
                        <th className="px-2 py-2 text-right">Peso kg</th><th className="px-2 py-2 text-right">m³</th><th className="px-2 py-2 text-right">Arancel</th>
                        <th className="px-2 py-2 text-right">Seguro</th><th className="px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {importados.map(p => { const f = fichas[p.productoId]; const v = (t: string | null | undefined) => t || <span className="text-slate-300">—</span>; return (
                        <tr key={p.productoId}>
                          <td className="px-3 py-2 text-slate-800">{nombreProducto(p.descripcion)}{!f && <span className="ml-1.5 text-amber-700">sin ficha</span>}</td>
                          <td className="px-2 py-2 text-slate-600">{v(f?.fabricante)}</td><td className="px-2 py-2 text-slate-600">{v(f?.paisOrigen)}</td>
                          <td className="px-2 py-2 text-slate-600">{v(f?.partidaArancelaria)}</td><td className="px-2 py-2 text-slate-600">{v(f?.numeroFactura)}</td>
                          <td className="px-2 py-2 text-slate-600">{v(f?.incoterm)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-600 whitespace-nowrap">{f?.precioFob != null ? `${fmtNum(f.precioFob, 4)} ${f.moneda ?? ''}` : '—'}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-600">{fmtNum(f?.cantidadPedida ?? p.cantidad, 3)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-600">{fmtNum(f?.bultos, 0)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-600">{fmtNum(f?.pesoKg, 3)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-600">{fmtNum(f?.volumenM3, 3)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-600">{f?.arancelPct != null ? `${fmtNum(f.arancelPct)} %` : '—'}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-slate-600">{fmtNum(f?.seguro, 2)}</td>
                          <td className="px-2 py-2 text-right"><button type="button" onClick={() => { setFichaAbierta(p.productoId); setTimeout(() => document.querySelector(`[data-testid="ficha-importacion-${p.productoId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100); }} className="text-teal-700 hover:text-teal-900 font-medium">Editar</button></td>
                        </tr>
                      ); })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {importados.length === 0 && <p className="text-xs text-amber-700">Marca al menos un producto para seguir con los embarques.</p>}
          </div>
        )}
      </section>

      {origen === 'IMPORTACION' && importados.length > 0 && (<>
        {/* PASO 2: embarques — cada uno con sus productos, su seguimiento y sus costos */}
        <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3" data-testid="importacion-embarques">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <Paso n={2} titulo="Embarques"
                extra={embarques.length > 0 && <span className="text-xs text-slate-500">
                  <span className="font-semibold tabular-nums text-slate-700">{embarques.length}</span> en total · <span className="tabular-nums">{enBodega}</span> en bodega
                  {atrasados > 0 && <span className="font-medium text-amber-700"> · {atrasados} atrasado{atrasados === 1 ? '' : 's'}</span>}
                </span>} />
              <p className="mt-0.5 text-xs text-slate-500">Un embarque es lo que viaja junto (mismo proveedor, mismo barco, avión o courier). Si los productos vienen por separado, crea un embarque para cada envío.</p>
            </div>
            {puedeOperar && (
              <button type="button" onClick={agregarEmbarque} disabled={creando} data-testid="importacion-agregar-embarque"
                className="flex-shrink-0 text-[12px] font-semibold text-teal-700 border border-teal-200 hover:bg-teal-50 disabled:opacity-50 px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5">
                {creando && <Loader2 size={12} className="animate-spin" />} + Agregar embarque
              </button>
            )}
          </div>
          {embarques.length === 0 ? (
            <p className="text-xs text-slate-600">Todavía no hay embarques. Agrega el primero: los productos marcados arriba entran a él, y si después llega otro envío por separado, agregas otro y cambias sus productos.</p>
          ) : (
            <>
              {sinEmbarque.length > 0 && (
                <p className="text-xs text-amber-700">{sinEmbarque.length} producto(s) del extranjero sin embarque ({sinEmbarque.map(p => nombreProducto(p.descripcion)).join(', ')}): elige su embarque en el paso 1 para que se le sumen sus costos.</p>
              )}
              <div className="space-y-3 bg-slate-50/70 -mx-1 p-1 rounded-xl">
                {embarques.map(e => <EmbarqueCard key={e.id} e={e} productos={productos} puedeOperar={puedeOperar} enviar={enviar} />)}
              </div>
            </>
          )}
        </section>

        {/* PASO 3: costo real por producto */}
        <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <Paso n={3} titulo="Costo real de cada producto" />
          {costoAterrizado ? (
            <div>
              <p className="text-xs text-slate-500 mb-2">A cada unidad se le suma lo que costó traer <b className="font-medium text-slate-700">su</b> embarque, repartido entre las unidades de ese embarque.</p>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs min-w-[620px]">
                  <thead>
                    <tr className="text-left text-[11px] font-medium text-slate-500 bg-slate-50 border-b border-slate-200">
                      <th className="px-3 py-2">Producto</th>
                      <th className="px-2 py-2">Embarque</th>
                      <th className="px-2 py-2 text-right">Precio proveedor (FOB)</th>
                      <th className="px-2 py-2 text-right">+ importación c/u</th>
                      <th className="px-3 py-2 text-right">Costo real c/u</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {costoAterrizado.items.filter(it => it.importado).map(it => (
                      <tr key={it.productoId}>
                        <td className="px-3 py-2 text-slate-800">{nombreProducto(it.descripcion)}</td>
                        <td className="px-2 py-2 text-slate-600">{it.embarqueId != null ? nombreEmbarque.get(it.embarqueId) : <span className="text-amber-700">Sin embarque</span>}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-500">{fmtCLP(it.precioUnitarioFob)}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-slate-500">{fmtCLP(Math.round(it.extraPorUnidad))}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold text-slate-900">{fmtCLP(it.costoUnitarioAterrizado)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 border-t border-slate-200">
                      <td className="px-3 py-2 font-medium text-slate-800" colSpan={2}>Costo real total de la compra</td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-500">{fmtCLP(costoAterrizado.totalFob)}</td>
                      <td />
                      <td className="px-3 py-2 text-right tabular-nums font-bold text-slate-900">{fmtCLP(costoAterrizado.totalAterrizado)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {costoAterrizado.costoSinRepartir > 0 && (
                <p className="mt-1.5 text-xs text-amber-700">{fmtCLP(costoAterrizado.costoSinRepartir)} de embarques sin productos están sumados al total, pero no a ningún producto: asígnales sus productos.</p>
              )}
              <p className="mt-1.5 text-[11px] text-slate-500">El total incluye también lo comprado en Chile. Este costo real (no el FOB) es el que se usa para calcular la ganancia del proyecto.</p>
            </div>
          ) : (
            <p className="text-xs text-amber-700">Todavía no se puede calcular: falta elegir un escenario de compra en «Costeo y auditoría» o anotar los costos de algún embarque.</p>
          )}
        </section>
      </>)}
    </div>
  );
}
