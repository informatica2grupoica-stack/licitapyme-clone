'use client';

// Sección "Empresas" (solo admin): ficha de cada empresa con la que se postula.
// Crear / editar / eliminar. Los datos se usan al marcar una licitación como Postulada
// (selector de empresa) y se muestran/filtran en el apartado Postuladas.

import { useState, useEffect, useCallback, useRef } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import { Encabezado, Esqueleto, Vacio } from '@/app/components/ui/kit/Estructura';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Lista } from '@/app/components/ui/kit/Aparecer';
import { Tarjeta } from '@/app/components/ui/kit/Tarjeta';
import { Tooltip } from '@/app/components/ui/Tooltip';
import { Banner } from '@/app/components/ui/Banner';
import { useSession } from '@/app/lib/session-context';
import { useConfirm } from '@/app/components/ui/confirm';
import { useToast } from '@/app/components/ui/toast';
import { IconBuilding as Building2, IconPlus as Plus, IconPencil as Pencil, IconTrash as Trash2, IconLoader2 as Loader2, IconX as X, IconDeviceFloppy as Save, IconInbox as Inbox, IconUser as User, IconBuildingBank as Landmark, IconMail as Mail, IconPhone as Phone, IconMapPin as MapPin, IconShieldCheck as ShieldCheck, IconUpload as Upload, IconEye as Eye, IconAward as Award, IconPencil as PenLine, IconStar as Star } from '@tabler/icons-react';

interface Empresa {
  id: number;
  razon_social: string;
  rut: string;
  direccion?: string | null;
  region?: string | null;
  giro?: string | null;
  tipo_persona_juridica?: string | null;
  fecha_sociedad?: string | null;
  fecha_escritura?: string | null;
  notaria?: string | null;
  numero_repertorio?: string | null;
  fojas_numero_anio?: string | null;
  representante_nombre?: string | null;
  representante_rut?: string | null;
  representante_cargo?: string | null;
  representante_profesion?: string | null;
  email1?: string | null;
  telefono1?: string | null;
  email2?: string | null;
  telefono2?: string | null;
  banco_tipo_cuenta?: string | null;
  banco_numero?: string | null;
  banco_nombre?: string | null;
  banco_email?: string | null;
  banco_titular_nombre?: string | null;
  banco_titular_rut?: string | null;
  logo_url?: string | null;
  logo_nombre?: string | null;
  firma_url?: string | null;
  firma_nombre?: string | null;
  timbre_url?: string | null;
  timbre_nombre?: string | null;
}

// Una firma escaneada de las VARIAS que puede tener la empresa (migration-84). `es_principal` es
// la que se usa cuando nadie elige: la del .docx, la de la ficha tecnica y la marcada por defecto
// al firmar el PDF - es el espejo de `empresas.firma_url`, ver app/lib/empresa-firmas.ts.
interface FirmaEmpresa {
  id: number;
  etiqueta: string;
  url: string;
  nombre: string | null;
  es_principal: boolean;
}

interface EmpresaDocumento {
  id: number;
  tipo: string;
  titulo: string;
  descripcion: string | null;
  url: string | null;
  nombre: string | null;
  subido_por_nombre: string | null;
  subido_at: string | null;
}

const VACIA: Partial<Empresa> = { razon_social: '', rut: '' };

// Un input etiquetado, compacto y consistente.
function Campo({ label, value, onChange, placeholder, required }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium text-tinta">
        {label}{required && <span className="text-red-500"> *</span>}
      </span>
      <input
        value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="mt-1 h-9 w-full border border-linea rounded-lg px-3 text-sm text-tinta outline-none focus-visible:ring-2 focus-visible:ring-marca/60"
      />
    </label>
  );
}

// Logo / timbre: un archivo cada uno, se reemplaza al subir uno nuevo. La FIRMA se salio de aca
// (migration-84): ahora son varias y viven en su propia tabla - ver SeccionFirmas mas abajo.
function SubidaArchivoUnico({ empresaId, tipo, label, urlActual, nombreActual, onCambio }: {
  empresaId: number; tipo: 'logo' | 'timbre'; label: string;
  urlActual: string | null | undefined; nombreActual: string | null | undefined; onCambio: () => void;
}) {
  const [subiendo, setSubiendo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const subir = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append('tipo', tipo);
      fd.append('file', files[0]);
      const r = await fetch(`/api/empresas/${empresaId}/documentos`, { method: 'POST', body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) { toast.error(d.error || `No se pudo subir ${label.toLowerCase()}`); return; }
      toast.success(`${label} actualizado`);
      onCambio();
    } finally {
      setSubiendo(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const eliminar = async () => {
    const r = await fetch(`/api/empresas/${empresaId}/documentos?tipo=${tipo}`, { method: 'DELETE' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.success) { toast.error(d.error || 'No se pudo eliminar'); return; }
    onCambio();
  };

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 border border-slate-200 rounded-lg">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-tinta">{label}</p>
        <p className="text-[11.5px] text-slate-500 truncate">{nombreActual || 'Sin archivo'}</p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {urlActual && (
          <a href={urlActual} target="_blank" rel="noreferrer" title="Ver" className="p-1.5 text-slate-400 hover:text-marca hover:bg-slate-100 rounded transition-colors"><Eye size={14} stroke={1.75} /></a>
        )}
        <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={e => subir(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} disabled={subiendo} title="Subir"
          className="p-1.5 text-slate-400 hover:text-marca hover:bg-slate-100 rounded transition-colors disabled:opacity-50">
          {subiendo ? <Loader2 size={14} stroke={1.75} className="animate-spin" /> : <Upload size={14} stroke={1.75} />}
        </button>
        {urlActual && (
          <button onClick={eliminar} title="Quitar" className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"><Trash2 size={14} stroke={1.75} /></button>
        )}
      </div>
    </div>
  );
}

// Firmas escaneadas: VARIAS por empresa (pedido explicito del usuario, 1-sep-2026 - "tener la
// posibilidad de tener varias firmas"). Antes era un slot unico que se pisaba al subir otro, con
// el resultado de que una empresa con representante titular y suplente tenia que reemplazar el
// archivo a mano antes de cada anexo. La marcada como principal (estrella) es la que se usa sola
// en todo lo que no pregunta -el .docx, la ficha tecnica-; al firmar un PDF se puede arrastrar
// cualquiera de las otras. Nunca hay cero principales mientras exista al menos una firma: lo
// garantiza el backend (sincronizarFirmaPrincipal), no esta pantalla.
function SeccionFirmas({ empresaId, onCambio }: { empresaId: number; onCambio: () => void }) {
  const [firmas, setFirmas] = useState<FirmaEmpresa[]>([]);
  const [cargando, setCargando] = useState(true);
  const [etiqueta, setEtiqueta] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const confirmar = useConfirm();

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await fetch(`/api/empresas/${empresaId}/firmas`);
      const d = await r.json().catch(() => ({}));
      setFirmas(d.firmas || []);
    } finally {
      setCargando(false);
    }
  }, [empresaId]);

  useEffect(() => { cargar(); }, [cargar]);

  // `onCambio` recarga la ficha de la empresa del padre: la columna espejo `firma_url` cambia con
  // cada alta/baja/cambio de principal, y sin esto el resto del formulario se queda con la vieja.
  const aplicar = (nuevas: FirmaEmpresa[]) => { setFirmas(nuevas); onCambio(); };

  const subir = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setSubiendo(true);
    try {
      // Varias a la vez: elegir 3 firmas en el explorador sube las 3, cada una con el nombre de su
      // archivo como etiqueta (la etiqueta escrita solo se usa cuando se sube UNA - si no, las
      // tres quedarian con el mismo rotulo y no habria como distinguirlas al firmar).
      for (const file of Array.from(files)) {
        const fd = new FormData();
        if (files.length === 1 && etiqueta.trim()) fd.append('etiqueta', etiqueta.trim());
        fd.append('file', file);
        const r = await fetch(`/api/empresas/${empresaId}/firmas`, { method: 'POST', body: fd });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.success) { toast.error(d.error || `No se pudo subir "${file.name}"`); break; }
        aplicar(d.firmas || []);
      }
      setEtiqueta('');
    } finally {
      setSubiendo(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const marcarPrincipal = async (f: FirmaEmpresa) => {
    const r = await fetch(`/api/empresas/${empresaId}/firmas?firmaId=${f.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ principal: true }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.success) { toast.error(d.error || 'No se pudo marcar por defecto'); return; }
    aplicar(d.firmas || []);
  };

  const renombrar = async (f: FirmaEmpresa, valor: string) => {
    const nueva = valor.trim();
    if (!nueva || nueva === f.etiqueta) return;
    const r = await fetch(`/api/empresas/${empresaId}/firmas?firmaId=${f.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ etiqueta: nueva }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.success) { toast.error(d.error || 'No se pudo renombrar'); return; }
    aplicar(d.firmas || []);
  };

  const eliminar = async (f: FirmaEmpresa) => {
    const ok = await confirmar({
      titulo: 'Eliminar firma',
      mensaje: `Se quita "${f.etiqueta}" de la ficha. Los anexos ya generados con ella no cambian.`,
      confirmarLabel: 'Eliminar', peligro: true,
    });
    if (!ok) return;
    const r = await fetch(`/api/empresas/${empresaId}/firmas?firmaId=${f.id}`, { method: 'DELETE' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.success) { toast.error(d.error || 'No se pudo eliminar'); return; }
    aplicar(d.firmas || []);
  };

  return (
    <div className="border border-slate-200 rounded-lg p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[13px] font-medium text-tinta flex items-center gap-1.5">
          <PenLine size={12} stroke={1.75} className="text-slate-400" /> Firmas escaneadas
          {firmas.length > 0 && <span className="text-slate-400 font-normal">({firmas.length})</span>}
        </p>
        <p className="text-[10.5px] text-slate-400">PNG o JPG · la estrella es la que se usa por defecto</p>
      </div>

      {cargando && (
        <p className="text-[11.5px] text-slate-400 flex items-center gap-1.5 py-2">
          <Loader2 size={12} stroke={1.75} className="animate-spin" /> Cargando firmas…
        </p>
      )}

      {!cargando && firmas.length === 0 && (
        <p className="text-[11.5px] text-slate-400 py-2">
          Sin firmas cargadas. Sube una imagen de la firma (fondo blanco, recortada) para que se pueda estampar en los anexos.
        </p>
      )}

      {!cargando && firmas.length > 0 && (
        <ul className="space-y-1.5 mb-2">
          {firmas.map(f => (
            <li key={f.id} className="flex items-center gap-2 px-2 py-1.5 border border-slate-200 rounded-lg bg-white">
              <img src={f.url} alt={f.etiqueta} className="h-8 w-16 object-contain flex-shrink-0 bg-white border border-slate-100 rounded" />
              <input
                defaultValue={f.etiqueta}
                onBlur={e => renombrar(f, e.target.value)}
                title="De quien es esta firma - es lo que ves al elegirla en el anexo"
                className="flex-1 min-w-0 text-[12.5px] text-slate-700 bg-transparent border border-transparent hover:border-slate-200 focus:border-marca rounded px-1.5 py-0.5 outline-none"
              />
              <button
                onClick={() => marcarPrincipal(f)} disabled={f.es_principal}
                title={f.es_principal ? 'Es la firma por defecto' : 'Usar esta por defecto'}
                className={`p-1.5 rounded transition-colors ${f.es_principal ? 'text-amber-500' : 'text-slate-300 hover:text-amber-500 hover:bg-amber-50'}`}
              >
                <Star size={14} stroke={1.75} fill={f.es_principal ? 'currentColor' : 'none'} />
              </button>
              <a href={f.url} target="_blank" rel="noreferrer" title="Ver"
                className="p-1.5 text-slate-400 hover:text-marca hover:bg-slate-100 rounded transition-colors"><Eye size={14} stroke={1.75} /></a>
              <button onClick={() => eliminar(f)} title="Eliminar"
                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"><Trash2 size={14} stroke={1.75} /></button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <input
          value={etiqueta} onChange={e => setEtiqueta(e.target.value)}
          placeholder="De quien es (ej: Juan Perez - Rep. legal)"
          className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-marca/60"
        />
        <input ref={fileRef} type="file" accept="image/png,image/jpeg" multiple className="hidden" onChange={e => subir(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} disabled={subiendo}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-marca bg-marca-suave hover:bg-teal-100 rounded-lg transition-colors disabled:opacity-50">
          {subiendo ? <Loader2 size={13} stroke={1.75} className="animate-spin" /> : <Upload size={13} stroke={1.75} />} Subir firma
        </button>
      </div>
    </div>
  );
}

// Certificados / experiencia acreditable: acumulan, nunca se reemplazan.
function SeccionDocumentosEmpresa({ empresaId, tipo, label, placeholder }: {
  empresaId: number; tipo: 'certificado' | 'experiencia'; label: string; placeholder: string;
}) {
  const [docs, setDocs] = useState<EmpresaDocumento[]>([]);
  const [cargando, setCargando] = useState(true);
  const [titulo, setTitulo] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const confirmar = useConfirm();

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await fetch(`/api/empresas/${empresaId}/documentos`);
      const d = await r.json();
      setDocs((d.documentos || []).filter((doc: EmpresaDocumento) => doc.tipo === tipo));
    } finally {
      setCargando(false);
    }
  }, [empresaId, tipo]);

  useEffect(() => { cargar(); }, [cargar]);

  const subir = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!titulo.trim()) { toast.error('Escribe un título antes de subir'); return; }
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append('tipo', tipo);
      fd.append('titulo', titulo.trim());
      fd.append('file', files[0]);
      const r = await fetch(`/api/empresas/${empresaId}/documentos`, { method: 'POST', body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) { toast.error(d.error || 'No se pudo subir'); return; }
      setTitulo('');
      cargar();
    } finally {
      setSubiendo(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const eliminar = async (doc: EmpresaDocumento) => {
    const ok = await confirmar({
      titulo: `¿Eliminar "${doc.titulo}"?`, mensaje: 'Esta acción no se puede deshacer.',
      confirmarLabel: 'Eliminar', peligro: true,
    });
    if (!ok) return;
    await fetch(`/api/empresas/${empresaId}/documentos?documentoId=${doc.id}`, { method: 'DELETE' });
    cargar();
  };

  return (
    <div>
      <p className="text-[13px] font-semibold text-tinta mb-2 flex items-center gap-1.5"><Award size={13} stroke={1.75} /> {label}</p>
      {cargando ? (
        <p className="text-[12px] text-slate-400 mb-2">Cargando…</p>
      ) : (
        <div className="space-y-1.5 mb-2">
          {docs.map(doc => (
            <div key={doc.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-slate-50 rounded-lg">
              <span className="text-[12px] text-slate-700 truncate">{doc.titulo}</span>
              <div className="flex items-center gap-1 flex-shrink-0">
                {doc.url && <a href={doc.url} target="_blank" rel="noreferrer" title="Ver" className="p-1 text-slate-400 hover:text-marca"><Eye size={13} stroke={1.75} /></a>}
                <button onClick={() => eliminar(doc)} title="Eliminar" className="p-1 text-slate-400 hover:text-rose-600"><Trash2 size={13} stroke={1.75} /></button>
              </div>
            </div>
          ))}
          {docs.length === 0 && <p className="text-[11.5px] text-slate-400">Nada cargado todavía.</p>}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder={placeholder}
          className="flex-1 px-2.5 py-1.5 text-[12px] border border-slate-200 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-marca/60" />
        <input ref={fileRef} type="file" className="hidden" onChange={e => subir(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} disabled={subiendo}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 text-[11.5px] font-semibold rounded-lg disabled:opacity-50 transition-colors">
          {subiendo ? <Loader2 size={13} stroke={1.75} className="animate-spin" /> : <Upload size={13} stroke={1.75} />} Subir
        </button>
      </div>
    </div>
  );
}

function EmpresaModal({ inicial, onCerrar, onGuardada }: {
  inicial: Partial<Empresa>; onCerrar: () => void; onGuardada: () => void;
}) {
  const [f, setF] = useState<Partial<Empresa>>(inicial);
  const [guardando, setGuardando] = useState(false);
  const toast = useToast();
  const esEdicion = !!inicial.id;
  const set = (k: keyof Empresa) => (v: string) => setF(prev => ({ ...prev, [k]: v }));

  // Logo/firma/timbre se suben aparte (endpoint de archivos, no el PATCH de campos de texto) —
  // tras subir/quitar uno, recargamos la ficha para reflejar la URL nueva en el modal abierto.
  const recargarEmpresa = async () => {
    if (!inicial.id) return;
    const r = await fetch(`/api/empresas/${inicial.id}`);
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.empresa) setF(d.empresa);
  };

  const guardar = async () => {
    if (!String(f.razon_social || '').trim() || !String(f.rut || '').trim()) {
      toast.error('Razón social y RUT son obligatorios'); return;
    }
    setGuardando(true);
    try {
      const url = esEdicion ? `/api/empresas/${inicial.id}` : '/api/empresas';
      const res = await fetch(url, {
        method: esEdicion ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(f),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
      toast.success(esEdicion ? 'Empresa actualizada' : 'Empresa creada');
      onGuardada();
    } catch (e: any) {
      toast.error('No se pudo guardar', e?.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-flotante w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-linea dark:border-slate-800 flex-shrink-0">
          <p className="text-[15px] font-semibold text-tinta flex items-center gap-2">
            <Building2 size={16} stroke={1.75} className="text-slate-400" />
            {esEdicion ? 'Editar empresa' : 'Nueva empresa'}
          </p>
          <button onClick={onCerrar} aria-label="Cerrar" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"><X size={18} stroke={1.75} /></button>
        </div>

        <div className="overflow-y-auto p-5 space-y-5">
          {/* Datos generales */}
          <section>
            <p className="text-[13px] font-semibold text-tinta mb-2 flex items-center gap-1.5"><Building2 size={13} stroke={1.75} /> Datos de la empresa</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Campo label="Razón social" value={f.razon_social || ''} onChange={set('razon_social')} required />
              <Campo label="RUT" value={f.rut || ''} onChange={set('rut')} placeholder="76.902.659-2" required />
              <Campo label="Dirección" value={f.direccion || ''} onChange={set('direccion')} />
              <Campo label="Región" value={f.region || ''} onChange={set('region')} />
              <Campo label="Giro" value={f.giro || ''} onChange={set('giro')} />
              <Campo label="Tipo persona jurídica" value={f.tipo_persona_juridica || ''} onChange={set('tipo_persona_juridica')} />
              <div className="sm:col-span-2">
                <Campo label="Fecha / constitución de sociedad" value={f.fecha_sociedad || ''} onChange={set('fecha_sociedad')} placeholder="Reseña libre (opcional, uso interno)" />
              </div>
            </div>
          </section>

          {/* Escritura de constitución: campos separados porque los anexos de Mercado Público
              piden Fecha de la Escritura / Notaría / N° de Repertorio / Fojas cada uno en su
              propia casilla — un solo texto libre no se puede partir de forma confiable. */}
          <section>
            <p className="text-[13px] font-semibold text-tinta mb-2 flex items-center gap-1.5"><Building2 size={13} stroke={1.75} /> Escritura de constitución</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Campo label="Fecha de la escritura" value={f.fecha_escritura || ''} onChange={set('fecha_escritura')} placeholder="20 de agosto de 2018" />
              <Campo label="Notaría" value={f.notaria || ''} onChange={set('notaria')} placeholder="Segunda Notaría de La Serena" />
              <Campo label="Número de repertorio" value={f.numero_repertorio || ''} onChange={set('numero_repertorio')} />
              <Campo label="Fojas / Número / Año" value={f.fojas_numero_anio || ''} onChange={set('fojas_numero_anio')} placeholder="Fs. 123 N° 45 2018" />
            </div>
          </section>

          {/* Representante legal */}
          <section>
            <p className="text-[13px] font-semibold text-tinta mb-2 flex items-center gap-1.5"><User size={13} stroke={1.75} /> Representante legal</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Campo label="Nombre" value={f.representante_nombre || ''} onChange={set('representante_nombre')} />
              <Campo label="RUT" value={f.representante_rut || ''} onChange={set('representante_rut')} />
              <Campo label="Cargo" value={f.representante_cargo || ''} onChange={set('representante_cargo')} />
              {/* Profesion u oficio: es un dato DISTINTO del cargo y hay anexos que piden los dos
                  en el mismo bloque ("Cargo: Gerente General / Profesion: Ingeniero Constructor").
                  El motor de anexos ya lo usaba, pero no habia donde escribirlo. */}
              <Campo label="Profesion u oficio" value={f.representante_profesion || ''} onChange={set('representante_profesion')} />
            </div>
          </section>

          {/* Contactos */}
          <section>
            <p className="text-[13px] font-semibold text-tinta mb-2 flex items-center gap-1.5"><Mail size={13} stroke={1.75} /> Contactos</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Campo label="Email 1" value={f.email1 || ''} onChange={set('email1')} />
              <Campo label="Teléfono 1" value={f.telefono1 || ''} onChange={set('telefono1')} />
              <Campo label="Email 2" value={f.email2 || ''} onChange={set('email2')} />
              <Campo label="Teléfono 2" value={f.telefono2 || ''} onChange={set('telefono2')} />
            </div>
          </section>

          {/* Banco */}
          <section>
            <p className="text-[13px] font-semibold text-tinta mb-2 flex items-center gap-1.5"><Landmark size={13} stroke={1.75} /> Datos bancarios</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Campo label="Tipo de cuenta" value={f.banco_tipo_cuenta || ''} onChange={set('banco_tipo_cuenta')} placeholder="Cuenta corriente / vista" />
              <Campo label="N° de cuenta" value={f.banco_numero || ''} onChange={set('banco_numero')} />
              <Campo label="Banco" value={f.banco_nombre || ''} onChange={set('banco_nombre')} />
              <Campo label="Email de pagos" value={f.banco_email || ''} onChange={set('banco_email')} />
              {/* Titular: quién es el dueño de la cuenta — no siempre es la empresa misma (puede
                  estar a nombre del representante legal). Sin estos 2 campos, "Nombre del
                  Titular"/"Cédula de Identidad del Titular" (casillas reales en anexos de pago,
                  caso 1058086-43-LP26) quedaban pendientes SIEMPRE, sin dato de dónde sacarlas. */}
              <Campo label="Titular de la cuenta" value={f.banco_titular_nombre || ''} onChange={set('banco_titular_nombre')} placeholder="Puede ser distinto de la razón social" />
              <Campo label="RUT del titular" value={f.banco_titular_rut || ''} onChange={set('banco_titular_rut')} />
            </div>
          </section>

          {/* Identidad + certificados/experiencia: solo con la empresa ya creada (necesitan su id) */}
          {esEdicion && inicial.id && (
            <>
              <section>
                <p className="text-[13px] font-semibold text-tinta mb-2 flex items-center gap-1.5"><ShieldCheck size={13} stroke={1.75} /> Identidad (Auditor Técnico)</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <SubidaArchivoUnico empresaId={inicial.id} tipo="logo" label="Logo" urlActual={f.logo_url} nombreActual={f.logo_nombre} onCambio={recargarEmpresa} />
                  <SubidaArchivoUnico empresaId={inicial.id} tipo="timbre" label="Timbre digital" urlActual={f.timbre_url} nombreActual={f.timbre_nombre} onCambio={recargarEmpresa} />
                </div>
                {/* La firma ya NO es un slot unico como el logo/timbre: una empresa firma con
                    varias personas y cual va en cada anexo lo decide el documento. */}
                <div className="mt-2">
                  <SeccionFirmas empresaId={inicial.id} onCambio={recargarEmpresa} />
                </div>
              </section>

              <section>
                <SeccionDocumentosEmpresa empresaId={inicial.id} tipo="certificado" label="Certificados" placeholder="Título del certificado…" />
              </section>

              <section>
                <SeccionDocumentosEmpresa empresaId={inicial.id} tipo="experiencia" label="Experiencia acreditable" placeholder="Ej: OC N°123 - Municipalidad de..." />
              </section>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-linea dark:border-slate-800 flex-shrink-0">
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton variante="primario" onClick={guardar} disabled={guardando}
            icono={guardando ? <Loader2 size={16} stroke={1.75} className="animate-spin" /> : <Save size={16} stroke={1.75} />}>
            {guardando ? "Guardando…" : "Guardar cambios"}
          </Boton>
        </div>
      </div>
    </div>
  );
}

function EmpresaCard({ e, onEditar, onEliminar }: { e: Empresa; onEditar: () => void; onEliminar: () => void; }) {
  const filas: [React.ReactNode, string | null][] = [
    [<ShieldCheck key="g" size={16} stroke={1.75} />, e.giro || null],
    [<MapPin key="d" size={16} stroke={1.75} />, [e.direccion, e.region].filter(Boolean).join(" · ") || null],
    [<User key="r" size={16} stroke={1.75} />, e.representante_nombre ? `${e.representante_nombre}${e.representante_rut ? ` · ${e.representante_rut}` : ""}` : null],
    [<Mail key="m" size={16} stroke={1.75} />, e.email1 || null],
    [<Phone key="t" size={16} stroke={1.75} />, e.telefono1 || null],
    [<Landmark key="b" size={16} stroke={1.75} />, [e.banco_nombre, e.banco_tipo_cuenta, e.banco_numero].filter(Boolean).join(" · ") || null],
  ];
  return (
    <Tarjeta>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800">
            <Building2 size={18} stroke={1.75} />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold text-tinta dark:text-slate-50">{e.razon_social}</h3>
            <p className="font-mono text-xs text-tinta-2 dark:text-slate-400">{e.rut}</p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <Tooltip label="Editar">
            <button onClick={onEditar} aria-label="Editar empresa"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-marca focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:hover:bg-slate-800"><Pencil size={16} stroke={1.75} /></button>
          </Tooltip>
          <Tooltip label="Eliminar">
            <button onClick={onEliminar} aria-label="Eliminar empresa"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-urgente focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:hover:bg-red-950/40"><Trash2 size={16} stroke={1.75} /></button>
          </Tooltip>
        </div>
      </div>
      <ul className="mt-3 space-y-1.5 border-t border-linea/80 pt-3 text-[13px] text-tinta-2 dark:border-slate-800 dark:text-slate-300">
        {filas.filter(([, t]) => t).map(([ic, t], i) => (
          <li key={i} className="flex items-center gap-2"><span className="flex-shrink-0 text-slate-400">{ic}</span><span className="truncate">{t}</span></li>
        ))}
      </ul>
    </Tarjeta>
  );
}

export default function EmpresasPage() {
  const { usuario } = useSession();
  const isAdmin = !!usuario?.permisos?.config_empresa;
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<Partial<Empresa> | null>(null);
  const confirmar = useConfirm();
  const toast = useToast();

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch('/api/empresas');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo cargar');
      setEmpresas(data.empresas || []);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const eliminar = async (e: Empresa) => {
    const ok = await confirmar({
      titulo: '¿Eliminar empresa?',
      mensaje: `"${e.razon_social}" dejará de aparecer en el selector. Las licitaciones ya postuladas con ella conservan la referencia.`,
      confirmarLabel: 'Eliminar', peligro: true,
    });
    if (!ok) return;
    const prev = empresas;
    setEmpresas(list => list.filter(x => x.id !== e.id));
    try {
      const res = await fetch(`/api/empresas/${e.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo eliminar');
      toast.success('Empresa eliminada');
    } catch (err: any) {
      setEmpresas(prev);
      toast.error('No se pudo eliminar', err?.message);
    }
  };

  if (!isAdmin) {
    return (
      <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Empresas' }]}>
        <div className="p-8 text-center text-tinta-2">Esta sección es solo para administradores.</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Empresas' }]}>
      <div className="@container p-4 sm:p-6 lg:p-8">
        <Encabezado
          titulo="Empresas"
          descripcion={cargando ? "Cargando…" : `${empresas.length} empresa${empresas.length !== 1 ? "s" : ""} con la${empresas.length !== 1 ? "s" : ""} que se postula`}
          acciones={<Boton variante="primario" icono={<Plus size={16} stroke={1.75} />} onClick={() => setModal({ ...VACIA })}>Nueva empresa</Boton>}
        />

        {cargando ? (
          <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <Esqueleto key={i} className="h-36 rounded-xl" />)}
          </div>
        ) : error ? (
          <Banner variante="error">{error}</Banner>
        ) : empresas.length === 0 ? (
          <Vacio icono={<Inbox size={28} stroke={1.75} />} titulo="Aún no hay empresas"
            texto="Crea la primera para poder elegirla al marcar una licitación como postulada."
            accion={<Boton variante="primario" tamano="sm" icono={<Plus size={16} stroke={1.75} />} onClick={() => setModal({ ...VACIA })}>Nueva empresa</Boton>} />
        ) : (
          <Lista className="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3">
            {empresas.map(e => (
              <EmpresaCard key={e.id} e={e} onEditar={() => setModal(e)} onEliminar={() => eliminar(e)} />
            ))}
          </Lista>
        )}
      </div>

      {modal && (
        <EmpresaModal
          inicial={modal}
          onCerrar={() => setModal(null)}
          onGuardada={() => { setModal(null); cargar(); }}
        />
      )}
    </AppLayout>
  );
}
