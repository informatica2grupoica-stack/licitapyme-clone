'use client';

// Sección "Empresas" (solo admin): ficha de cada empresa con la que se postula.
// Crear / editar / eliminar. Los datos se usan al marcar una licitación como Postulada
// (selector de empresa) y se muestran/filtran en el apartado Postuladas.

import { useState, useEffect, useCallback, useRef } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useConfirm } from '@/app/components/ui/confirm';
import { useToast } from '@/app/components/ui/toast';
import {
  Building2, Plus, Pencil, Trash2, Loader2, X, Save, Inbox,
  User, Landmark, Mail, Phone, MapPin, ShieldCheck, Upload, Eye, Award,
} from 'lucide-react';

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
      <span className="text-[11px] font-semibold text-slate-600">
        {label}{required && <span className="text-red-500"> *</span>}
      </span>
      <input
        value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-indigo-400"
      />
    </label>
  );
}

// Logo / firma / timbre: un archivo cada uno, se reemplaza al subir uno nuevo.
function SubidaArchivoUnico({ empresaId, tipo, label, urlActual, nombreActual, onCambio }: {
  empresaId: number; tipo: 'logo' | 'firma' | 'timbre'; label: string;
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
        <p className="text-[11px] font-semibold text-slate-600">{label}</p>
        <p className="text-[11.5px] text-slate-500 truncate">{nombreActual || 'Sin archivo'}</p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {urlActual && (
          <a href={urlActual} target="_blank" rel="noreferrer" title="Ver" className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"><Eye size={14} /></a>
        )}
        <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={e => subir(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} disabled={subiendo} title="Subir"
          className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors disabled:opacity-50">
          {subiendo ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
        </button>
        {urlActual && (
          <button onClick={eliminar} title="Quitar" className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"><Trash2 size={14} /></button>
        )}
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
      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><Award size={13} /> {label}</p>
      {cargando ? (
        <p className="text-[12px] text-slate-400 mb-2">Cargando…</p>
      ) : (
        <div className="space-y-1.5 mb-2">
          {docs.map(doc => (
            <div key={doc.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-slate-50 rounded-lg">
              <span className="text-[12px] text-slate-700 truncate">{doc.titulo}</span>
              <div className="flex items-center gap-1 flex-shrink-0">
                {doc.url && <a href={doc.url} target="_blank" rel="noreferrer" title="Ver" className="p-1 text-slate-400 hover:text-indigo-600"><Eye size={13} /></a>}
                <button onClick={() => eliminar(doc)} title="Eliminar" className="p-1 text-slate-400 hover:text-rose-600"><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
          {docs.length === 0 && <p className="text-[11.5px] text-slate-400">Nada cargado todavía.</p>}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder={placeholder}
          className="flex-1 px-2.5 py-1.5 text-[12px] border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" />
        <input ref={fileRef} type="file" className="hidden" onChange={e => subir(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} disabled={subiendo}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 text-[11.5px] font-semibold rounded-lg disabled:opacity-50 transition-colors">
          {subiendo ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Subir
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
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" onClick={onCerrar}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50 flex-shrink-0">
          <p className="text-[14px] font-bold text-slate-800 flex items-center gap-2">
            <Building2 size={16} className="text-indigo-600" />
            {esEdicion ? 'Editar empresa' : 'Nueva empresa'}
          </p>
          <button onClick={onCerrar} className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-400 transition-colors"><X size={18} /></button>
        </div>

        <div className="overflow-y-auto p-5 space-y-5">
          {/* Datos generales */}
          <section>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><Building2 size={13} /> Datos de la empresa</p>
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
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><Building2 size={13} /> Escritura de constitución</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Campo label="Fecha de la escritura" value={f.fecha_escritura || ''} onChange={set('fecha_escritura')} placeholder="20 de agosto de 2018" />
              <Campo label="Notaría" value={f.notaria || ''} onChange={set('notaria')} placeholder="Segunda Notaría de La Serena" />
              <Campo label="Número de repertorio" value={f.numero_repertorio || ''} onChange={set('numero_repertorio')} />
              <Campo label="Fojas / Número / Año" value={f.fojas_numero_anio || ''} onChange={set('fojas_numero_anio')} placeholder="Fs. 123 N° 45 2018" />
            </div>
          </section>

          {/* Representante legal */}
          <section>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><User size={13} /> Representante legal</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Campo label="Nombre" value={f.representante_nombre || ''} onChange={set('representante_nombre')} />
              <Campo label="RUT" value={f.representante_rut || ''} onChange={set('representante_rut')} />
              <Campo label="Cargo" value={f.representante_cargo || ''} onChange={set('representante_cargo')} />
            </div>
          </section>

          {/* Contactos */}
          <section>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><Mail size={13} /> Contactos</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Campo label="Email 1" value={f.email1 || ''} onChange={set('email1')} />
              <Campo label="Teléfono 1" value={f.telefono1 || ''} onChange={set('telefono1')} />
              <Campo label="Email 2" value={f.email2 || ''} onChange={set('email2')} />
              <Campo label="Teléfono 2" value={f.telefono2 || ''} onChange={set('telefono2')} />
            </div>
          </section>

          {/* Banco */}
          <section>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><Landmark size={13} /> Datos bancarios</p>
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
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><ShieldCheck size={13} /> Identidad (Auditor Técnico)</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <SubidaArchivoUnico empresaId={inicial.id} tipo="logo" label="Logo" urlActual={f.logo_url} nombreActual={f.logo_nombre} onCambio={recargarEmpresa} />
                  <SubidaArchivoUnico empresaId={inicial.id} tipo="firma" label="Firma escaneada" urlActual={f.firma_url} nombreActual={f.firma_nombre} onCambio={recargarEmpresa} />
                  <SubidaArchivoUnico empresaId={inicial.id} tipo="timbre" label="Timbre digital" urlActual={f.timbre_url} nombreActual={f.timbre_nombre} onCambio={recargarEmpresa} />
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

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex-shrink-0">
          <button onClick={onCerrar}
            className="px-3.5 py-2 text-[13px] font-semibold text-slate-600 hover:bg-slate-200/60 rounded-lg transition-colors">
            Cancelar
          </button>
          <button onClick={guardar} disabled={guardando}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-[13px] font-semibold rounded-lg transition-colors">
            {guardando ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

function EmpresaCard({ e, onEditar, onEliminar }: { e: Empresa; onEditar: () => void; onEliminar: () => void; }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 hover:shadow-md transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
              <Building2 size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="text-[14px] font-bold text-slate-800 truncate">{e.razon_social}</h3>
              <p className="text-[11.5px] font-mono text-slate-500">{e.rut}</p>
            </div>
          </div>
        </div>
        <div className="flex-shrink-0 flex items-center gap-1">
          <button onClick={onEditar} title="Editar"
            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"><Pencil size={14} /></button>
          <button onClick={onEliminar} title="Eliminar"
            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"><Trash2 size={14} /></button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-1.5 text-[12px] text-slate-600">
        {e.giro && <p className="flex items-center gap-1.5"><ShieldCheck size={12} className="text-slate-400 flex-shrink-0" /><span className="truncate">{e.giro}</span></p>}
        {(e.direccion || e.region) && <p className="flex items-center gap-1.5"><MapPin size={12} className="text-slate-400 flex-shrink-0" /><span className="truncate">{[e.direccion, e.region].filter(Boolean).join(' · ')}</span></p>}
        {e.representante_nombre && <p className="flex items-center gap-1.5"><User size={12} className="text-slate-400 flex-shrink-0" /><span className="truncate">{e.representante_nombre}{e.representante_rut ? ` · ${e.representante_rut}` : ''}</span></p>}
        {e.email1 && <p className="flex items-center gap-1.5"><Mail size={12} className="text-slate-400 flex-shrink-0" /><span className="truncate">{e.email1}</span></p>}
        {e.telefono1 && <p className="flex items-center gap-1.5"><Phone size={12} className="text-slate-400 flex-shrink-0" /><span className="truncate">{e.telefono1}</span></p>}
        {(e.banco_nombre || e.banco_numero) && <p className="flex items-center gap-1.5"><Landmark size={12} className="text-slate-400 flex-shrink-0" /><span className="truncate">{[e.banco_nombre, e.banco_tipo_cuenta, e.banco_numero].filter(Boolean).join(' · ')}</span></p>}
      </div>
    </div>
  );
}

export default function EmpresasPage() {
  const { usuario } = useSession();
  const isAdmin = usuario?.rol === 'admin';
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
        <div className="p-8 text-center text-slate-500">Esta sección es solo para administradores.</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Empresas' }]}>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Building2 size={24} className="text-indigo-600" /> Empresas
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {cargando ? 'Cargando…' : `${empresas.length} empresa${empresas.length !== 1 ? 's' : ''} con la${empresas.length !== 1 ? 's' : ''} que se postula`}
            </p>
          </div>
          <button onClick={() => setModal({ ...VACIA })}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-lg transition-colors self-start">
            <Plus size={16} /> Nueva empresa
          </button>
        </div>

        {cargando ? (
          <div className="flex items-center gap-2 text-slate-500 text-sm py-20 justify-center"><Loader2 size={16} className="animate-spin" /> Cargando…</div>
        ) : error ? (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>
        ) : empresas.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-xl border border-slate-100">
            <Inbox size={36} className="text-gray-300 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-gray-700 mb-2">Aún no hay empresas</h3>
            <p className="text-sm text-gray-400">Crea la primera con el botón <b>Nueva empresa</b>.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {empresas.map(e => (
              <EmpresaCard key={e.id} e={e} onEditar={() => setModal(e)} onEliminar={() => eliminar(e)} />
            ))}
          </div>
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
