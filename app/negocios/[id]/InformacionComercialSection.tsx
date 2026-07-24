'use client';

// SECCIÓN "INFORMACIÓN COMERCIAL" — el auditor de la etapa ANEXOS.
//
// El asistente arma la oferta (anexos con los datos de la empresa, respaldo técnico, precio) y
// el asesor VISA punto por punto. El checklist no se escribe a mano: sale del informe de
// viabilidad, así que cada fila trae su ponderación, su criticidad y la cita a las bases —
// el asesor ve, al lado del check, cuántos puntos se juega ahí.
//
// Tiempo real: cualquier carga o visado se refleja al instante en la pantalla del otro (SSE).
import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Banner } from '@/app/components/ui/Banner';
import { Select } from '@/app/components/ui/Select';
import { useRealtime } from '@/app/lib/use-realtime';
import {
  ShieldCheck, Building2, Check, X, Upload, Loader2, AlertTriangle, Copy,
  FileText, DollarSign, Wrench, ClipboardCheck, RefreshCw, Undo2, Sparkles, ExternalLink,
} from 'lucide-react';

// ── Tipos (espejo de lo que devuelve /api/negocios/[id]/comercial) ──────────────
interface Item {
  id: number;
  bloque: 'ADMINISTRATIVO' | 'TECNICO' | 'COMERCIAL';
  tipo: 'documento' | 'dato' | 'precio';
  titulo: string;
  descripcion: string | null;
  criticidad: string;
  ponderacion: number | null;
  fuente_cita: string | null;
  generable: boolean;
  linea_numero: number | null;
  ofertamos: boolean | null;
  estado: 'PENDIENTE' | 'CARGADO' | 'APROBADO' | 'OBSERVADO';
  valor_texto: string | null;
  valor_numero: number | null;
  documento_url: string | null;
  documento_nombre: string | null;
  observacion: string | null;
  cargado_por_nombre: string | null;
  cargado_at: string | null;
  aprobado_por_nombre: string | null;
  aprobado_at: string | null;
}

interface Resumen {
  total: number; aprobados: number; porAprobar: number; pendientes: number;
  observados: number; bloqueantesPendientes: number; listoParaPostular: boolean; avance: number;
}

interface Empresa {
  id: number; razon_social: string; rut: string; direccion: string | null; region: string | null;
  giro: string | null; tipo_persona_juridica: string | null;
  representante_nombre: string | null; representante_rut: string | null; representante_cargo: string | null;
  email1: string | null; telefono1: string | null;
  banco_tipo_cuenta: string | null; banco_numero: string | null; banco_nombre: string | null;
}

const BLOQUES = [
  { key: 'ADMINISTRATIVO', label: 'Administrativo', icon: FileText,   hint: 'Anexos y garantías — se llenan con los datos de la empresa' },
  { key: 'TECNICO',        label: 'Técnico',        icon: Wrench,     hint: 'Respaldo de los criterios con que nos evalúan' },
  { key: 'COMERCIAL',      label: 'Comercial',      icon: DollarSign, hint: 'Precio y plazo ofertados' },
] as const;

const CRIT_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  ADMISIBILIDAD_DURA:    { bg: 'bg-rose-100',    text: 'text-rose-700',    label: 'Admisibilidad' },
  PUNTAJE_CONDICIONANTE: { bg: 'bg-amber-100',   text: 'text-amber-700',   label: 'Puntaje' },
  COMPROMISO_EJECUCION:  { bg: 'bg-sky-100',     text: 'text-sky-700',     label: 'Ejecución' },
  INFORMATIVO:           { bg: 'bg-zinc-100',    text: 'text-zinc-500',    label: 'Informativo' },
};

const ESTADO_STYLE: Record<Item['estado'], { bg: string; text: string; label: string }> = {
  PENDIENTE: { bg: 'bg-zinc-100',    text: 'text-zinc-500',    label: 'Pendiente' },
  CARGADO:   { bg: 'bg-indigo-100',  text: 'text-indigo-700',  label: 'Por aprobar' },
  APROBADO:  { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Aprobado' },
  OBSERVADO: { bg: 'bg-orange-100',  text: 'text-orange-700',  label: 'Observado' },
};

const fmtCLP = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

const fmtFecha = (s: string | null) => {
  if (!s) return '';
  try {
    return new Date(s.replace(' ', 'T')).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
};

// ════════════════════════════════════════════════════════════════════════════════
export function InformacionComercialSection({ negocioId, licitacionCodigo, empresaId, onEmpresaChange }: {
  negocioId: number;
  licitacionCodigo: string;
  empresaId: number | null;
  onEmpresaChange: (id: number) => void;
}) {
  const toast = useToast();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [empresa, setEmpresa] = useState<Empresa | null>(null);
  const [modalidad, setModalidad] = useState<{ porLinea: boolean; dudosa: boolean; tipo: string | null; comoSeAdjudica: string | null } | null>(null);
  const [puedeAprobar, setPuedeAprobar] = useState(false);
  const [sinViabilidad, setSinViabilidad] = useState(false);
  const [migracionPendiente, setMigracionPendiente] = useState(false);
  const [empresas, setEmpresas] = useState<Array<{ id: number; razon_social: string }>>([]);
  const [ocupado, setOcupado] = useState<number | null>(null);   // itemId con acción en curso
  const [resincronizando, setResincronizando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/negocios/${negocioId}/comercial`);
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'No se pudo cargar'); return; }
      setItems(d.items || []);
      setResumen(d.resumen || null);
      setEmpresa(d.empresa || null);
      setModalidad(d.modalidad || null);
      setPuedeAprobar(!!d.puedeAprobar);
      setSinViabilidad(!!d.sinViabilidad);
      setMigracionPendiente(!!d.migracionPendiente);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setCargando(false);
    }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);
  // El asesor tiene que poder aprobar el mismo día, en el momento: si el asistente carga algo
  // mientras esta pantalla está abierta, aparece solo.
  useRealtime(cargar);

  useEffect(() => {
    fetch('/api/empresas').then(r => r.json()).then(d => setEmpresas(d.empresas || [])).catch(() => {});
  }, []);

  // ── Acciones ─────────────────────────────────────────────────────────────────
  const accionar = useCallback(async (itemId: number, accion: string, extra: Record<string, unknown> = {}) => {
    setOcupado(itemId);
    try {
      const r = await fetch(`/api/negocios/${negocioId}/comercial`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, accion, ...extra }),
      });
      const d = await r.json();
      if (!r.ok) { toast.error(d.error || 'No se pudo completar la acción'); return false; }
      setItems(d.items || []);
      setResumen(d.resumen || null);
      return true;
    } catch (e) {
      toast.error('Error de red', String(e));
      return false;
    } finally {
      setOcupado(null);
    }
  }, [negocioId, toast]);

  const resincronizar = async () => {
    setResincronizando(true);
    try {
      const r = await fetch(`/api/negocios/${negocioId}/comercial`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'resincronizar' }),
      });
      const d = await r.json();
      if (!r.ok) { toast.error(d.error || 'No se pudo resincronizar'); return; }
      setItems(d.items || []);
      setResumen(d.resumen || null);
      toast.success(d.nuevos ? `${d.nuevos} punto${d.nuevos === 1 ? '' : 's'} nuevo${d.nuevos === 1 ? '' : 's'}` : 'Ya estaba al día');
    } finally {
      setResincronizando(false);
    }
  };

  const elegirEmpresa = async (id: string) => {
    const r = await fetch(`/api/negocios/${negocioId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empresa_id: Number(id) }),
    });
    if (!r.ok) { toast.error('No se pudo guardar la empresa'); return; }
    onEmpresaChange(Number(id));
    toast.success('Empresa asignada');
    cargar();
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  if (cargando) {
    return <div className="flex items-center gap-2 text-[13px] text-zinc-400 py-10 justify-center">
      <Loader2 size={14} className="animate-spin" /> Cargando información comercial…
    </div>;
  }

  if (error) return <Banner variante="error" accion={{ label: 'Reintentar', onClick: cargar }}>{error}</Banner>;

  // Las migraciones se aplican a mano en phpMyAdmin: decirlo claro vale más que un 500 opaco.
  if (migracionPendiente) {
    return (
      <Banner variante="warning" accion={{ label: 'Reintentar', onClick: cargar }}>
        Falta aplicar la <strong>migración 48</strong> (<code>docs/migration-48-checklist-comercial.sql</code>) en la
        base de datos. Sin las tablas <code>checklist_comercial</code>, el módulo no puede guardar nada.
      </Banner>
    );
  }

  const sinEmpresa = !empresa;

  return (
    <div className="space-y-5 fade-in">

      {/* ── Cabecera + avance ────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-zinc-200 p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center">
              <ShieldCheck size={16} className="text-violet-600" />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-zinc-900 leading-tight">Información Comercial</h2>
              <p className="text-[11.5px] text-zinc-400">
                El asistente carga · el asesor aprueba
              </p>
            </div>
          </div>
          <button
            onClick={resincronizar}
            disabled={resincronizando}
            title="Trae al checklist los puntos nuevos del informe de viabilidad, sin tocar lo ya aprobado"
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11.5px] font-semibold text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 rounded-lg border border-zinc-200 transition-colors disabled:opacity-50"
          >
            {resincronizando ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Resincronizar
          </button>
        </div>

        {resumen && resumen.total > 0 && (
          <>
            <div className="flex items-baseline justify-between mb-1.5">
              <p className="text-[12.5px] font-semibold text-zinc-700">
                {resumen.listoParaPostular
                  ? <span className="text-emerald-600">Listo para postular</span>
                  : <>Faltan <span className="text-rose-600">{resumen.bloqueantesPendientes}</span> punto{resumen.bloqueantesPendientes === 1 ? '' : 's'} de admisibilidad</>}
              </p>
              <p className="text-[12px] text-zinc-400">{resumen.aprobados}/{resumen.total} aprobados</p>
            </div>
            <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${resumen.listoParaPostular ? 'bg-emerald-500' : 'bg-violet-500'}`}
                style={{ width: `${resumen.avance}%` }}
              />
            </div>
            <div className="flex gap-3 mt-2 text-[11px]">
              {resumen.porAprobar > 0 && <span className="text-indigo-600 font-semibold">{resumen.porAprobar} por aprobar</span>}
              {resumen.observados > 0 && <span className="text-orange-600 font-semibold">{resumen.observados} observado{resumen.observados === 1 ? '' : 's'}</span>}
              {resumen.pendientes > 0 && <span className="text-zinc-400">{resumen.pendientes} sin cargar</span>}
            </div>
          </>
        )}
      </div>

      {sinViabilidad && (
        <Banner variante="warning">
          Esta licitación aún no tiene informe de viabilidad, así que el checklist no se puede armar solo.
          Corre el análisis de viabilidad y vuelve, o agrega los puntos a mano.
        </Banner>
      )}

      {modalidad?.dudosa && !sinViabilidad && (
        <Banner variante="warning">
          La modalidad no quedó determinada en el informe ({modalidad.tipo || 'sin dato'}). Antes de cargar precios,
          confirma en las bases si se oferta un total único (suma alzada) o línea por línea — el bloque comercial
          se armó con lo que dice el informe.
        </Banner>
      )}

      {/* ── Empresa con la que se postula ────────────────────────────────────── */}
      <BloqueEmpresa
        empresa={empresa}
        empresas={empresas}
        onElegir={elegirEmpresa}
        toast={toast}
      />

      {/* ── Los tres bloques ─────────────────────────────────────────────────── */}
      {BLOQUES.map(b => {
        const delBloque = items.filter(i => i.bloque === b.key);
        if (delBloque.length === 0) return null;
        const Icono = b.icon;
        const bloqueadoPorEmpresa = b.key === 'ADMINISTRATIVO' && sinEmpresa;

        return (
          <div key={b.key} className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100 flex items-center gap-2">
              <Icono size={14} className="text-zinc-400" />
              <h3 className="text-[13px] font-bold text-zinc-800">{b.label}</h3>
              <span className="text-[10.5px] text-zinc-400">{b.hint}</span>
              <span className="ml-auto text-[11px] font-bold text-zinc-400">
                {delBloque.filter(i => i.estado === 'APROBADO').length}/{delBloque.length}
              </span>
            </div>

            {bloqueadoPorEmpresa && (
              <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-100 text-[11.5px] text-amber-800 flex items-center gap-1.5">
                <AlertTriangle size={13} /> Elige primero la empresa: sin eso no se pueden llenar los anexos.
              </div>
            )}

            <div className="divide-y divide-zinc-100">
              {delBloque.map(item => (
                <FilaItem
                  key={item.id}
                  item={item}
                  licitacionCodigo={licitacionCodigo}
                  puedeAprobar={puedeAprobar}
                  bloqueado={bloqueadoPorEmpresa}
                  ocupado={ocupado === item.id}
                  onAccion={accionar}
                  toast={toast}
                />
              ))}
            </div>

            {/* Total de la oferta, solo en el bloque comercial por línea */}
            {b.key === 'COMERCIAL' && modalidad?.porLinea && (
              <div className="px-4 py-3 bg-zinc-50 border-t border-zinc-100 flex items-center justify-between">
                <span className="text-[12px] font-semibold text-zinc-500">
                  Total ofertado ({delBloque.filter(i => i.tipo === 'precio' && i.ofertamos !== false).length} línea(s))
                </span>
                <span className="text-[15px] font-bold text-emerald-700">
                  {fmtCLP(delBloque
                    .filter(i => i.tipo === 'precio' && i.ofertamos !== false)
                    .reduce((s, i) => s + (i.valor_numero || 0), 0))}
                </span>
              </div>
            )}
          </div>
        );
      })}

      {items.length === 0 && !sinViabilidad && (
        <div className="bg-white rounded-xl border border-zinc-200 p-10 text-center">
          <ClipboardCheck size={26} className="text-zinc-300 mx-auto mb-3" />
          <p className="text-[13px] font-semibold text-zinc-700 mb-1">Sin puntos todavía</p>
          <p className="text-[12px] text-zinc-400 mb-4 max-w-sm mx-auto">
            El checklist se arma desde el informe de viabilidad. Si el informe existe, resincroniza.
          </p>
          <button onClick={resincronizar} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-[12px] font-semibold rounded-lg">
            Armar checklist
          </button>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// Bloque de empresa: sin esto no se pueden llenar los anexos, así que va arriba y bloquea.
function BloqueEmpresa({ empresa, empresas, onElegir, toast }: {
  empresa: Empresa | null;
  empresas: Array<{ id: number; razon_social: string }>;
  onElegir: (id: string) => void;
  toast: ReturnType<typeof useToast>;
}) {
  const copiar = (valor: string | null, etiqueta: string) => {
    if (!valor) return;
    navigator.clipboard.writeText(valor).then(
      () => toast.success(`${etiqueta} copiado`),
      () => toast.error('No se pudo copiar'),
    );
  };

  if (!empresa) {
    return (
      <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Building2 size={15} className="text-amber-600" />
          <h3 className="text-[13px] font-bold text-amber-900">¿Con qué empresa se postula?</h3>
        </div>
        <p className="text-[12px] text-amber-800 mb-3">
          Los anexos administrativos se llenan con los datos de la empresa. Elige antes de empezar.
        </p>
        <Select
          value=""
          onChange={onElegir}
          placeholder="Elegir empresa…"
          options={empresas.map(e => ({ value: String(e.id), label: e.razon_social }))}
        />
      </div>
    );
  }

  const campos: Array<[string, string | null]> = [
    ['Razón social', empresa.razon_social],
    ['RUT', empresa.rut],
    ['Dirección', empresa.direccion],
    ['Giro', empresa.giro],
    ['Representante', empresa.representante_nombre],
    ['RUT representante', empresa.representante_rut],
    ['Cargo', empresa.representante_cargo],
    ['Email', empresa.email1],
    ['Teléfono', empresa.telefono1],
    ['Banco', [empresa.banco_nombre, empresa.banco_tipo_cuenta, empresa.banco_numero].filter(Boolean).join(' · ') || null],
  ];

  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Building2 size={15} className="text-zinc-400" />
        <h3 className="text-[13px] font-bold text-zinc-800">Se postula con {empresa.razon_social}</h3>
        <span className="text-[10.5px] text-zinc-400">· datos para llenar los anexos</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {campos.filter(([, v]) => v).map(([label, valor]) => (
          <button
            key={label}
            onClick={() => copiar(valor, label)}
            className="group flex items-center gap-2 text-left px-2.5 py-1.5 rounded-lg hover:bg-zinc-50 transition-colors"
            title={`Copiar ${label.toLowerCase()}`}
          >
            <div className="min-w-0 flex-1">
              <p className="text-[9.5px] text-zinc-400 uppercase font-bold tracking-wide">{label}</p>
              <p className="text-[12px] text-zinc-700 font-medium truncate">{valor}</p>
            </div>
            <Copy size={12} className="text-zinc-300 group-hover:text-zinc-500 flex-shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// Una fila del checklist: el punto, su evidencia, y las acciones según quién mira.
function FilaItem({ item, licitacionCodigo, puedeAprobar, bloqueado, ocupado, onAccion, toast }: {
  item: Item;
  licitacionCodigo: string;
  puedeAprobar: boolean;
  bloqueado: boolean;
  ocupado: boolean;
  onAccion: (itemId: number, accion: string, extra?: Record<string, unknown>) => Promise<boolean>;
  toast: ReturnType<typeof useToast>;
}) {
  const [editando, setEditando] = useState(false);
  const [valorTexto, setValorTexto] = useState(item.valor_texto || '');
  const [valorNumero, setValorNumero] = useState(item.valor_numero != null ? String(item.valor_numero) : '');
  const [observando, setObservando] = useState(false);
  const [observacion, setObservacion] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const crit = CRIT_STYLE[item.criticidad] || CRIT_STYLE.INFORMATIVO;
  const est = ESTADO_STYLE[item.estado];
  const noOfertada = item.tipo === 'precio' && item.ofertamos === false;

  const guardar = async () => {
    const extra: Record<string, unknown> = {};
    if (item.tipo === 'precio') {
      const n = Number(String(valorNumero).replace(/[^\d.-]/g, ''));
      if (!Number.isFinite(n) || n <= 0) { toast.error('Escribe un precio válido'); return; }
      extra.valorNumero = n;
      extra.ofertamos = true;
    } else {
      if (!valorTexto.trim() && !item.documento_url) { toast.error('Escribe el dato o adjunta el documento'); return; }
      extra.valorTexto = valorTexto.trim();
    }
    if (await onAccion(item.id, 'CARGAR', extra)) setEditando(false);
  };

  const subirArchivo = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append('licitacionCodigo', licitacionCodigo);
      fd.append('files', files[0]);
      const r = await fetch('/api/documentos/subir', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok || !d.documentos?.[0]) { toast.error(d.error || 'No se pudo subir el archivo'); return; }
      const doc = d.documentos[0];
      await onAccion(item.id, 'CARGAR', {
        documentoUrl: doc.url, documentoNombre: doc.nombre, valorTexto: valorTexto.trim() || null,
      });
      setEditando(false);
    } finally {
      setSubiendo(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const observar = async () => {
    if (!observacion.trim()) { toast.error('Escribe qué hay que corregir'); return; }
    if (await onAccion(item.id, 'OBSERVAR', { observacion: observacion.trim() })) {
      setObservando(false); setObservacion('');
    }
  };

  return (
    <div className={`px-4 py-3 ${noOfertada ? 'opacity-50' : ''} ${item.estado === 'OBSERVADO' ? 'bg-orange-50/40' : ''}`}>
      <div className="flex items-start gap-3">

        {/* Estado */}
        <div className="pt-0.5">
          {item.estado === 'APROBADO'
            ? <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center"><Check size={12} className="text-white" /></div>
            : item.estado === 'OBSERVADO'
              ? <div className="w-5 h-5 rounded-full bg-orange-500 flex items-center justify-center"><X size={12} className="text-white" /></div>
              : <div className={`w-5 h-5 rounded-full border-2 ${item.estado === 'CARGADO' ? 'border-indigo-400 bg-indigo-50' : 'border-zinc-200'}`} />}
        </div>

        {/* Contenido */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2 flex-wrap">
            <p className="text-[13px] font-semibold text-zinc-800 leading-snug">{item.titulo}</p>
            <span className={`text-[9.5px] font-bold px-1.5 py-px rounded ${crit.bg} ${crit.text}`}>{crit.label}</span>
            {item.ponderacion != null && item.ponderacion > 0 && (
              <span className="text-[9.5px] font-bold px-1.5 py-px rounded bg-violet-100 text-violet-700">{item.ponderacion}%</span>
            )}
            <span className={`text-[9.5px] font-bold px-1.5 py-px rounded ${est.bg} ${est.text}`}>{est.label}</span>
          </div>

          {item.descripcion && <p className="text-[11.5px] text-zinc-500 leading-snug mt-0.5">{item.descripcion}</p>}
          {item.fuente_cita && <p className="text-[10px] text-zinc-400 truncate mt-0.5" title={item.fuente_cita}>Fuente: {item.fuente_cita}</p>}

          {/* Evidencia cargada */}
          {(item.valor_numero != null || item.valor_texto || item.documento_nombre) && !editando && (
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              {item.valor_numero != null && (
                <span className="text-[13px] font-bold text-emerald-700">{fmtCLP(item.valor_numero)}</span>
              )}
              {item.valor_texto && <span className="text-[12px] text-zinc-700">{item.valor_texto}</span>}
              {item.documento_nombre && (
                <a href={item.documento_url || '#'} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1 text-[11.5px] text-indigo-600 hover:underline">
                  <FileText size={11} /> {item.documento_nombre} <ExternalLink size={9} />
                </a>
              )}
            </div>
          )}

          {/* Observación del asesor */}
          {item.estado === 'OBSERVADO' && item.observacion && (
            <div className="mt-2 text-[11.5px] text-orange-800 bg-orange-100/60 rounded-lg px-2.5 py-1.5">
              <span className="font-bold">Observado:</span> {item.observacion}
            </div>
          )}

          {/* Firmas */}
          {(item.cargado_por_nombre || item.aprobado_por_nombre) && (
            <p className="text-[10px] text-zinc-400 mt-1.5">
              {item.cargado_por_nombre && <>Cargó {item.cargado_por_nombre} · {fmtFecha(item.cargado_at)}</>}
              {item.aprobado_por_nombre && <> · Aprobó {item.aprobado_por_nombre} · {fmtFecha(item.aprobado_at)}</>}
            </p>
          )}

          {/* ── Edición ────────────────────────────────────────────────────── */}
          {editando && (
            <div className="mt-2.5 space-y-2">
              {item.tipo === 'precio' ? (
                <input
                  type="text" inputMode="numeric" autoFocus
                  value={valorNumero}
                  onChange={e => setValorNumero(e.target.value)}
                  placeholder="Precio neto ofertado"
                  className="w-full px-3 py-2 text-[13px] border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200"
                />
              ) : (
                <textarea
                  value={valorTexto} autoFocus
                  onChange={e => setValorTexto(e.target.value)}
                  placeholder={item.tipo === 'dato' ? 'Escribe el dato comprometido…' : 'Nota (opcional) y adjunta el documento'}
                  rows={2}
                  className="w-full px-3 py-2 text-[13px] border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200 resize-none"
                />
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={guardar} disabled={ocupado}
                  className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-[11.5px] font-semibold rounded-lg disabled:opacity-50">
                  {ocupado ? <Loader2 size={12} className="animate-spin" /> : 'Guardar y enviar a visar'}
                </button>
                {item.tipo !== 'precio' && (
                  <>
                    <input ref={fileRef} type="file" className="hidden" onChange={e => subirArchivo(e.target.files)} />
                    <button onClick={() => fileRef.current?.click()} disabled={subiendo}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-zinc-200 text-zinc-600 hover:bg-zinc-50 text-[11.5px] font-semibold rounded-lg disabled:opacity-50">
                      {subiendo ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Adjuntar
                    </button>
                  </>
                )}
                {item.generable && (
                  <button disabled title="Generar el documento desde la app — próximamente"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-zinc-200 text-zinc-300 text-[11.5px] font-semibold rounded-lg cursor-not-allowed">
                    <Sparkles size={12} /> Generar
                  </button>
                )}
                <button onClick={() => setEditando(false)} className="text-[11.5px] text-zinc-400 hover:text-zinc-600 px-1">Cancelar</button>
              </div>
            </div>
          )}

          {/* ── Observar (asesor) ──────────────────────────────────────────── */}
          {observando && (
            <div className="mt-2.5 space-y-2">
              <textarea
                value={observacion} autoFocus
                onChange={e => setObservacion(e.target.value)}
                placeholder="¿Qué hay que corregir? (obligatorio)"
                rows={2}
                className="w-full px-3 py-2 text-[13px] border border-orange-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-200 resize-none"
              />
              <div className="flex items-center gap-2">
                <button onClick={observar} disabled={ocupado}
                  className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-[11.5px] font-semibold rounded-lg disabled:opacity-50">
                  Devolver al asistente
                </button>
                <button onClick={() => setObservando(false)} className="text-[11.5px] text-zinc-400 hover:text-zinc-600 px-1">Cancelar</button>
              </div>
            </div>
          )}
        </div>

        {/* ── Acciones ─────────────────────────────────────────────────────── */}
        {!editando && !observando && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Asistente: cargar / corregir */}
            {!bloqueado && item.estado !== 'APROBADO' && (
              <button
                onClick={() => setEditando(true)}
                className="px-2.5 py-1 text-[11.5px] font-semibold text-violet-600 hover:bg-violet-50 rounded-lg transition-colors"
              >
                {item.estado === 'PENDIENTE' ? 'Cargar' : 'Corregir'}
              </button>
            )}

            {/* Línea que decidimos no ofertar (solo en por-línea) */}
            {item.tipo === 'precio' && item.linea_numero != null && item.estado !== 'APROBADO' && (
              <button
                onClick={() => onAccion(item.id, 'CARGAR', { ofertamos: !noOfertada ? false : true })}
                title={noOfertada ? 'Volver a incluir esta línea en la oferta' : 'No ofertamos esta línea'}
                className="px-2.5 py-1 text-[11.5px] font-semibold text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 rounded-lg transition-colors"
              >
                {noOfertada ? 'Incluir' : 'No ofertar'}
              </button>
            )}

            {/* Asesor: visar */}
            {puedeAprobar && item.estado === 'CARGADO' && (
              <>
                <button
                  onClick={() => onAccion(item.id, 'APROBAR')}
                  disabled={ocupado}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11.5px] font-semibold rounded-lg disabled:opacity-50 transition-colors"
                >
                  {ocupado ? <Loader2 size={11} className="animate-spin" /> : <Check size={12} />} Aprobar
                </button>
                <button
                  onClick={() => setObservando(true)}
                  className="px-2.5 py-1 text-[11.5px] font-semibold text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                >
                  Observar
                </button>
              </>
            )}

            {/* Asesor: deshacer una aprobación */}
            {puedeAprobar && item.estado === 'APROBADO' && (
              <button
                onClick={() => onAccion(item.id, 'REABRIR')}
                title="Reabrir este punto"
                className="p-1.5 text-zinc-300 hover:text-zinc-600 hover:bg-zinc-50 rounded-lg transition-colors"
              >
                <Undo2 size={13} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
