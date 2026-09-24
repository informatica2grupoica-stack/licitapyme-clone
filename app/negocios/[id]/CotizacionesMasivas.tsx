'use client';

// CARGA MASIVA DE COTIZACIONES (24-sep-2026). Se sueltan varios PDF/imágenes a la vez; cada uno se
// sube, se lee con OCR y se registra como cotización con el MISMO camino que el formulario individual
// (POST /cotizaciones con solo el archivo: el servidor extrae proveedor, precio, plazo, flete… y, sin
// productos marcados a mano, el agente activo la homologa contra los productos ganados).
//
// Esto NO decide nada por sí solo: lo que la IA asignó queda a la vista, fila por fila, para que se
// revise — y cada cotización se puede corregir con "Asignar productos". Un documento del que no se
// puede identificar el proveedor NO se registra (se avisa), en vez de guardar una cotización a ciegas.
import { useState, useRef, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { IconLoader2 as Loader2, IconUpload as Upload, IconCircleCheck as CheckCircle2, IconAlertTriangle as AlertTriangle, IconClock as Clock, IconX as X } from '@tabler/icons-react';

interface ProductoLite { id: number; descripcion: string }
interface ItemCot { productoId: number; precioUnitario: number | null; cumple: string }
interface CotServidor { id: number; proveedorNombre: string; precioUnitarioClp: number | null; homologadaAt: string | null; items: ItemCot[] }

type Estado = 'espera' | 'leyendo' | 'registrada' | 'sin_proveedor' | 'error';
interface Fila { key: string; file: File; estado: Estado; mensaje?: string; cotizacionId?: number }

const MAX_ARCHIVOS = 30;
const MAX_MB = 20;
const CONCURRENCIA = 2; // el OCR + la IA son lentos y con cuota: de a dos, no todos a la vez
const fmtCLP = (n: number | null | undefined) => n == null ? '—'
  : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const CUMPLE_TXT: Record<string, string> = {
  CUMPLE: 'cumple', MEJORA: 'mejora', INFERIOR_NEGOCIABLE: 'inferior (negociable)',
  INFERIOR_INSALVABLE: 'inferior (insalvable)', NO_ES_EL_PRODUCTO: 'no es el producto',
};

export function CotizacionesMasivas({ negocioId, productos, onTerminado, onCerrar }: {
  negocioId: number; productos: ProductoLite[]; onTerminado: () => void | Promise<void>; onCerrar: () => void;
}) {
  const toast = useToast();
  const [filas, setFilas] = useState<Fila[]>([]);
  const [procesando, setProcesando] = useState(false);
  const [cotizaciones, setCotizaciones] = useState<Map<number, CotServidor>>(new Map());
  const [esperandoIA, setEsperandoIA] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const actualizar = (key: string, patch: Partial<Fila>) =>
    setFilas(fs => fs.map(f => f.key === key ? { ...f, ...patch } : f));

  const registrarUna = async (fila: Fila): Promise<number | null> => {
    actualizar(fila.key, { estado: 'leyendo' });
    try {
      const fd = new FormData();
      fd.set('file', fila.file);
      fd.set('origen', fila.file.type === 'application/pdf' ? 'pdf' : 'imagen');
      const res = await fetch(`/api/compras/${negocioId}/cotizaciones`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) { actualizar(fila.key, { estado: 'registrada', cotizacionId: data.id }); return data.id as number; }
      if (res.status === 400 && /proveedor/i.test(data.error || '')) {
        actualizar(fila.key, { estado: 'sin_proveedor', mensaje: 'No se pudo identificar al proveedor en el documento. Regístrala a mano con "Registrar cotización".' });
        return null;
      }
      actualizar(fila.key, { estado: 'error', mensaje: data.error || 'No se pudo registrar' });
    } catch (e: any) {
      actualizar(fila.key, { estado: 'error', mensaje: e?.message || 'Error de red' });
    }
    return null;
  };

  // La homologación de la IA corre en segundo plano y tarda unos segundos por cotización: se consulta
  // hasta que todas las registradas tengan su resultado (o pasen ~2 minutos).
  const esperarHomologacion = async (ids: number[]) => {
    if (ids.length === 0) return;
    setEsperandoIA(true);
    const limite = Date.now() + 120_000;
    try {
      while (Date.now() < limite) {
        const r = await fetch(`/api/compras/${negocioId}/cotizaciones`);
        const d = await r.json().catch(() => ({}));
        if (d.success) {
          const m = new Map<number, CotServidor>((d.cotizaciones as CotServidor[]).map(c => [c.id, c]));
          setCotizaciones(m);
          if (ids.every(id => m.get(id)?.homologadaAt)) break;
        }
        await new Promise(res => setTimeout(res, 4000));
      }
    } finally { setEsperandoIA(false); }
  };

  const procesar = useCallback(async (nuevas: Fila[]) => {
    setProcesando(true);
    const cola = [...nuevas];
    const ids: number[] = [];
    const trabajador = async () => { for (let f = cola.shift(); f; f = cola.shift()) { const id = await registrarUna(f); if (id != null) ids.push(id); } };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, nuevas.length) }, trabajador));
    setProcesando(false);
    await onTerminado();
    await esperarHomologacion(ids);
    await onTerminado();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [negocioId]);

  const agregarArchivos = (lista: FileList | File[]) => {
    const validos: Fila[] = [];
    const yaEstan = new Set(filas.map(f => `${f.file.name}|${f.file.size}`));
    let rechazados = 0, repetidos = 0;
    for (const file of Array.from(lista)) {
      const okTipo = file.type === 'application/pdf' || file.type.startsWith('image/');
      if (!okTipo || file.size > MAX_MB * 1024 * 1024) { rechazados++; continue; }
      const firma = `${file.name}|${file.size}`;
      if (yaEstan.has(firma)) { repetidos++; continue; }
      yaEstan.add(firma);
      validos.push({ key: `${firma}|${Math.random().toString(36).slice(2, 7)}`, file, estado: 'espera' });
    }
    const cupo = Math.max(0, MAX_ARCHIVOS - filas.length);
    const aceptados = validos.slice(0, cupo);
    if (validos.length > cupo) toast.info(`Máximo ${MAX_ARCHIVOS} archivos por tanda`, `Se cargaron ${aceptados.length}; sube el resto en otra tanda.`);
    if (rechazados) toast.info(`${rechazados} archivo(s) omitidos`, `Solo PDF o imagen de hasta ${MAX_MB} MB.`);
    if (repetidos) toast.info(`${repetidos} archivo(s) repetidos omitidos`);
    if (aceptados.length === 0) return;
    setFilas(fs => [...fs, ...aceptados]);
    void procesar(aceptados);
  };

  const nombreProducto = (id: number) => productos.find(p => p.id === id)?.descripcion || `#${id}`;
  const registradas = filas.filter(f => f.estado === 'registrada').length;

  return (
    <div className="border-b border-zinc-100 px-4 py-3 space-y-3 bg-indigo-50/30">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[12px] font-bold text-zinc-700">Cargar varias cotizaciones a la vez</p>
          <p className="text-[11px] text-zinc-500">Suelta los PDF o imágenes: cada uno se lee, se registra y la IA lo asigna al producto que corresponde. Revisa la asignación abajo; puedes corregirla con &quot;Asignar productos&quot;.</p>
        </div>
        <button onClick={onCerrar} className="text-zinc-400 hover:text-zinc-600 flex-shrink-0" title="Cerrar"><X size={14} /></button>
      </div>

      <div
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); if (e.dataTransfer.files?.length) agregarArchivos(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className="cursor-pointer border-2 border-dashed border-indigo-200 hover:border-indigo-400 bg-white rounded-xl px-4 py-5 text-center transition-colors">
        <Upload size={18} className="mx-auto text-indigo-400 mb-1" />
        <p className="text-[12px] font-semibold text-zinc-600">Arrastra los archivos aquí o haz clic para elegirlos</p>
        <p className="text-[10.5px] text-zinc-400">PDF o imagen · hasta {MAX_ARCHIVOS} archivos · {MAX_MB} MB cada uno</p>
        <input ref={inputRef} type="file" multiple accept=".pdf,image/*" className="hidden"
          onChange={e => { if (e.target.files?.length) agregarArchivos(e.target.files); e.target.value = ''; }} />
      </div>

      {filas.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-zinc-500">
            {procesando ? <span className="inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Leyendo y registrando… {registradas} de {filas.length}</span>
              : <>{registradas} de {filas.length} registrada(s){esperandoIA && <span className="inline-flex items-center gap-1 text-indigo-600"> · <Loader2 size={11} className="animate-spin" /> la IA está asignando productos…</span>}</>}
          </p>
          {filas.map(f => {
            const cot = f.cotizacionId != null ? cotizaciones.get(f.cotizacionId) : undefined;
            return (
              <div key={f.key} className="bg-white border border-zinc-200 rounded-lg px-3 py-2 text-[11.5px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-zinc-700 truncate">{f.file.name}</span>
                  <span className="flex-shrink-0">
                    {f.estado === 'espera' && <span className="inline-flex items-center gap-1 text-zinc-400"><Clock size={11} /> En espera</span>}
                    {f.estado === 'leyendo' && <span className="inline-flex items-center gap-1 text-indigo-600"><Loader2 size={11} className="animate-spin" /> Leyendo…</span>}
                    {f.estado === 'registrada' && <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 size={11} /> Registrada</span>}
                    {(f.estado === 'sin_proveedor' || f.estado === 'error') && <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle size={11} /> Revisar</span>}
                  </span>
                </div>
                {f.mensaje && <p className="text-[10.5px] text-amber-700 mt-0.5">{f.mensaje}</p>}
                {f.estado === 'registrada' && cot && (
                  <div className="mt-1 text-[10.5px] text-zinc-500">
                    <span className="font-semibold text-zinc-600">{cot.proveedorNombre}</span>
                    {cot.precioUnitarioClp != null && <> · {fmtCLP(cot.precioUnitarioClp)} c/u</>}
                    {cot.items.length > 0 ? (
                      <ul className="mt-0.5 space-y-0.5">
                        {cot.items.map(it => (
                          <li key={it.productoId}>→ <b className="text-zinc-700">{nombreProducto(it.productoId)}</b> · {CUMPLE_TXT[it.cumple] || it.cumple}{it.precioUnitario != null && ` · ${fmtCLP(it.precioUnitario)}`}</li>
                        ))}
                      </ul>
                    ) : cot.homologadaAt ? (
                      <p className="text-amber-700">La IA no identificó a qué producto corresponde: asígnala a mano con &quot;Asignar productos&quot;.</p>
                    ) : <p className="text-indigo-600">Asignando producto…</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
