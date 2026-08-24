'use client';

import { useState, useEffect } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import {
  Users, Plus, ShieldCheck, User, CheckCircle, XCircle,
  Loader2, Trash2, Edit3, X, AlertCircle, Mail, Lock,
  Briefcase, Eye, EyeOff, Calendar, Sparkles, GraduationCap,
} from 'lucide-react';
import { useSession } from '@/app/lib/session-context';
import { useConfirm } from '@/app/components/ui/confirm';
import { useToast } from '@/app/components/ui/toast';
import { Select } from '@/app/components/ui/Select';
import { Switch } from '@/app/components/ui/Switch';

interface Permisos {
  ver_otros_negocios?: boolean;
  acceso_radar?: boolean;
  comentar_viabilidad?: boolean;
  exportar?: boolean;
  alertas_anexos?: boolean;
  aprobar_comercial?: boolean;
  entrega_proyectos?: boolean;
  viabilidad_automatica?: boolean;
  repartir_puente?: boolean;
}

interface UsuarioAdmin {
  id: number;
  email: string;
  nombre: string | null;
  empresa: string | null;
  rol: 'admin' | 'usuario' | 'externo';
  permisos?: Permisos | string | null;
  modo_principiante?: boolean | number | null;
  activo: boolean;
  ultimo_login: string | null;
  created_at: string;
}

type CategoriaPermiso = 'acceso' | 'viabilidad' | 'comercial';

const CATEGORIAS_PERMISOS: { key: CategoriaPermiso; label: string; icon: React.ElementType }[] = [
  { key: 'acceso',     label: 'Acceso y visibilidad', icon: Eye },
  { key: 'viabilidad', label: 'Viabilidad y alertas',  icon: Sparkles },
  { key: 'comercial',  label: 'Flujo comercial',       icon: Briefcase },
];

const CATALOGO_PERMISOS: { key: keyof Permisos; label: string; desc: string; categoria: CategoriaPermiso }[] = [
  { key: 'ver_otros_negocios',  label: 'Ver licitaciones de otros perfiles', desc: 'Por defecto solo ve las suyas asignadas.', categoria: 'acceso' },
  { key: 'acceso_radar',        label: 'Acceso al radar',                     desc: 'El radar es solo de admin por defecto.', categoria: 'acceso' },
  { key: 'exportar',            label: 'Exportar a Excel',                    desc: 'Descargar listados en Excel.', categoria: 'acceso' },
  { key: 'comentar_viabilidad', label: 'Comentar / corregir viabilidad',      desc: 'Corregir y afinar el análisis de viabilidad.', categoria: 'viabilidad' },
  { key: 'viabilidad_automatica', label: 'Viabilidad automática al asignar', desc: 'Piloto: sus licitaciones asignadas y activas se analizan solas, sin esperar el botón "Analizar".', categoria: 'viabilidad' },
  { key: 'alertas_anexos',      label: 'Recibir alertas de etapa ANEXOS',     desc: 'Le llega campana y correo cuando un perfil mueve una licitación a la etapa ANEXOS.', categoria: 'viabilidad' },
  // Estos dos existían en el backend (api-auth.ts) pero faltaban acá, así que no se podían
  // otorgar desde el panel: el permiso existía y era inalcanzable.
  { key: 'aprobar_comercial',   label: 'Aprobar Información Comercial',       desc: 'Visar los puntos del checklist comercial (rol "asesor"). El admin ya lo tiene.', categoria: 'comercial' },
  { key: 'repartir_puente',     label: 'Puente del Radar (repartir trabajo)', desc: 'Puede empujar licitaciones del radar al puente y repartirlas entre varios perfiles.', categoria: 'comercial' },
  { key: 'entrega_proyectos',   label: 'Circuito de Entrega de Proyectos',    desc: 'Recibe el aviso cuando ganamos una licitación y debe acusar recibo del proyecto.', categoria: 'comercial' },
];

function parsePermisos(p: Permisos | string | null | undefined): Permisos {
  if (!p) return {};
  if (typeof p === 'string') { try { return JSON.parse(p) || {}; } catch { return {}; } }
  return p;
}

// ─── Modal para editar permisos de un usuario ──────────────────────────────
function ModalPermisos({ usuario, onGuardado, onCerrar }: {
  usuario: UsuarioAdmin; onGuardado: () => void; onCerrar: () => void;
}) {
  const [permisos, setPermisos] = useState<Permisos>(parsePermisos(usuario.permisos));
  const [modoPrincipiante, setModoPrincipiante] = useState(!!usuario.modo_principiante);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (k: keyof Permisos) => setPermisos(p => ({ ...p, [k]: !p[k] }));

  const guardar = async () => {
    setCargando(true); setError(null);
    try {
      const res = await fetch('/api/admin/usuarios', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: usuario.id, permisos, modoPrincipiante }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'No se pudo guardar (¿falta la migración 28?)'); return; }
      onGuardado();
    } catch { setError('Error de conexión'); }
    finally { setCargando(false); }
  };

  const iniciales = (usuario.nombre || usuario.email)[0].toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overlay-in">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col modal-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
              {iniciales}
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-gray-900 dark:text-zinc-100 text-base leading-tight">Permisos</h3>
              <p className="text-xs text-gray-400 dark:text-zinc-500 truncate">{usuario.nombre || usuario.email}</p>
            </div>
          </div>
          <button onClick={onCerrar} className="p-1.5 hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg transition-colors flex-shrink-0">
            <X size={18} className="text-gray-500 dark:text-zinc-400" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 overflow-y-auto">
          {error && (
            <div className="flex items-center gap-2 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-400 text-sm px-4 py-3 rounded-lg">
              <AlertCircle size={15} /> {error}
            </div>
          )}

          {usuario.rol === 'admin' ? (
            <p className="text-xs text-gray-500 dark:text-zinc-400">Los permisos granulares no aplican: un admin ya los tiene todos implícitos. Solo queda el modo de onboarding.</p>
          ) : (
            <>
              <p className="text-xs text-gray-500 dark:text-zinc-400">Marca lo que este usuario podrá hacer. Sin permisos, solo ve sus licitaciones asignadas.</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {CATEGORIAS_PERMISOS.map(cat => (
                  <div key={cat.key} className="rounded-xl border border-gray-100 dark:border-white/10 bg-gray-50/70 dark:bg-white/[0.03] p-3">
                    <div className="flex items-center gap-1.5 mb-1 text-[10.5px] font-bold uppercase tracking-wide text-gray-400 dark:text-zinc-500">
                      <cat.icon size={12} /> {cat.label}
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">
                      {CATALOGO_PERMISOS.filter(p => p.categoria === cat.key).map(p => (
                        <div key={p.key} className="flex items-start justify-between gap-2 py-2.5">
                          <span className="min-w-0">
                            <span className="block text-[12.5px] font-medium text-gray-800 dark:text-zinc-200 leading-snug">{p.label}</span>
                            <span className="block text-[11px] text-gray-400 dark:text-zinc-500 leading-snug mt-0.5">{p.desc}</span>
                          </span>
                          <Switch checked={!!permisos[p.key]} onChange={() => toggle(p.key)} label={p.label} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="rounded-xl border border-gray-100 dark:border-white/10 bg-gray-50/70 dark:bg-white/[0.03] p-3">
            <div className="flex items-center gap-1.5 mb-1 text-[10.5px] font-bold uppercase tracking-wide text-gray-400 dark:text-zinc-500">
              <GraduationCap size={12} /> Onboarding
            </div>
            <div className="flex items-start justify-between gap-3 py-1.5">
              <span className="min-w-0">
                <span className="block text-[12.5px] font-medium text-gray-800 dark:text-zinc-200">Modo principiante</span>
                <span className="block text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5 leading-snug">
                  Al abrir un análisis, ve primero solo la Tarjeta de Decisión (resumen); el detalle completo queda a un clic. El propio usuario puede salir de este modo desde ahí.
                </span>
              </span>
              <Switch checked={modoPrincipiante} onChange={() => setModoPrincipiante(v => !v)} label="Modo principiante" />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 dark:border-white/10 flex-shrink-0">
          <button onClick={onCerrar} className="flex-1 py-2 border border-gray-200 dark:border-white/15 text-gray-700 dark:text-zinc-300 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">Cancelar</button>
          <button onClick={guardar} disabled={cargando}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-zinc-700 text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors">
            {cargando ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Guardar permisos
          </button>
        </div>
      </div>
    </div>
  );
}

interface FormNuevo {
  email: string;
  password: string;
  nombre: string;
  empresa: string;
  rol: 'admin' | 'usuario' | 'externo';
}

// ─── Modal para crear usuario ──────────────────────────────────────────────
function ModalNuevoUsuario({
  onCreado,
  onCerrar,
}: {
  onCreado: () => void;
  onCerrar: () => void;
}) {
  const [form, setForm] = useState<FormNuevo>({ email: '', password: '', nombre: '', empresa: '', rol: 'usuario' });
  const [mostrarPass, setMostrarPass] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const res = await fetch('/api/admin/usuarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      onCreado();
    } catch { setError('Error de conexión'); }
    finally { setCargando(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overlay-in">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-md modal-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/10">
          <h3 className="font-bold text-gray-900 dark:text-zinc-100 text-lg">Nuevo usuario</h3>
          <button onClick={onCerrar} className="p-1.5 hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg transition-colors">
            <X size={18} className="text-gray-500 dark:text-zinc-400" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-400 text-sm px-4 py-3 rounded-lg">
              <AlertCircle size={15} /> {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">Nombre</label>
            <div className="relative">
              <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-zinc-500" />
              <input type="text" value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))}
                placeholder="Juan Pérez" className="w-full pl-8 pr-3 py-2 border border-gray-200 dark:border-white/15 dark:bg-zinc-800 dark:text-zinc-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">Empresa</label>
            <div className="relative">
              <Briefcase size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-zinc-500" />
              <input type="text" value={form.empresa} onChange={e => setForm(p => ({ ...p, empresa: e.target.value }))}
                placeholder="Mi Empresa SpA" className="w-full pl-8 pr-3 py-2 border border-gray-200 dark:border-white/15 dark:bg-zinc-800 dark:text-zinc-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">Email *</label>
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-zinc-500" />
              <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                placeholder="usuario@empresa.cl" required className="w-full pl-8 pr-3 py-2 border border-gray-200 dark:border-white/15 dark:bg-zinc-800 dark:text-zinc-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">Contraseña *</label>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-zinc-500" />
              <input type={mostrarPass ? 'text' : 'password'} value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                placeholder="Mín. 8 caracteres" required minLength={8}
                className="w-full pl-8 pr-9 py-2 border border-gray-200 dark:border-white/15 dark:bg-zinc-800 dark:text-zinc-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              <button type="button" onClick={() => setMostrarPass(!mostrarPass)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-300">
                {mostrarPass ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">Rol</label>
            <Select value={form.rol} onChange={v => setForm(p => ({ ...p, rol: v as any }))}
              options={[
                { value: 'usuario', label: 'Usuario' },
                { value: 'externo', label: 'Trabajador externo', description: 'Acceso restringido a lo asignado' },
                { value: 'admin', label: 'Administrador' },
              ]} />
            {form.rol === 'externo' && (
              <p className="mt-1 text-[11px] text-gray-500 dark:text-zinc-500">Solo ve las licitaciones que le asignes; sin logo, sin dashboard, sin buscador. Puede correr la viabilidad pero no re-analizar.</p>
            )}
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onCerrar}
              className="flex-1 py-2 border border-gray-200 dark:border-white/15 text-gray-700 dark:text-zinc-300 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={cargando || !form.email || !form.password}
              className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-zinc-700 text-white rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-1.5">
              {cargando ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Crear usuario
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Modal para editar usuario (datos + resetear contraseña) ────────────────
function ModalEditarUsuario({ usuario, onGuardado, onCerrar }: {
  usuario: UsuarioAdmin; onGuardado: () => void; onCerrar: () => void;
}) {
  const [form, setForm] = useState({
    nombre: usuario.nombre || '',
    empresa: usuario.empresa || '',
    email: usuario.email,
    rol: usuario.rol,
  });
  const [password, setPassword] = useState('');           // vacío = no cambiar la clave
  const [mostrarPass, setMostrarPass] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password && password.length < 8) { setError('La contraseña debe tener al menos 8 caracteres'); return; }
    setCargando(true);
    try {
      const body: any = { id: usuario.id, nombre: form.nombre, empresa: form.empresa, email: form.email, rol: form.rol };
      if (password) body.password = password;  // solo se envía si el admin escribió una clave
      const res = await fetch('/api/admin/usuarios', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'No se pudo guardar'); return; }
      onGuardado();
    } catch { setError('Error de conexión'); }
    finally { setCargando(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overlay-in">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-md modal-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/10">
          <h3 className="font-bold text-gray-900 dark:text-zinc-100 text-lg">Editar usuario</h3>
          <button onClick={onCerrar} className="p-1.5 hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg transition-colors">
            <X size={18} className="text-gray-500 dark:text-zinc-400" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-400 text-sm px-4 py-3 rounded-lg">
              <AlertCircle size={15} /> {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">Nombre</label>
            <div className="relative">
              <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-zinc-500" />
              <input type="text" value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))}
                placeholder="Juan Pérez" className="w-full pl-8 pr-3 py-2 border border-gray-200 dark:border-white/15 dark:bg-zinc-800 dark:text-zinc-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">Empresa</label>
            <div className="relative">
              <Briefcase size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-zinc-500" />
              <input type="text" value={form.empresa} onChange={e => setForm(p => ({ ...p, empresa: e.target.value }))}
                placeholder="Mi Empresa SpA" className="w-full pl-8 pr-3 py-2 border border-gray-200 dark:border-white/15 dark:bg-zinc-800 dark:text-zinc-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">Email *</label>
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-zinc-500" />
              <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                required className="w-full pl-8 pr-3 py-2 border border-gray-200 dark:border-white/15 dark:bg-zinc-800 dark:text-zinc-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">Rol</label>
            <Select value={form.rol} onChange={v => setForm(p => ({ ...p, rol: v as any }))}
              options={[
                { value: 'usuario', label: 'Usuario' },
                { value: 'externo', label: 'Trabajador externo', description: 'Acceso restringido a lo asignado' },
                { value: 'admin', label: 'Administrador' },
              ]} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">Nueva contraseña</label>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-zinc-500" />
              <input type={mostrarPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Dejar en blanco para no cambiarla" minLength={8}
                className="w-full pl-8 pr-9 py-2 border border-gray-200 dark:border-white/15 dark:bg-zinc-800 dark:text-zinc-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              <button type="button" onClick={() => setMostrarPass(!mostrarPass)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-300">
                {mostrarPass ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-gray-500 dark:text-zinc-500">Solo se cambia si escribes una clave nueva (mín. 8 caracteres).</p>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onCerrar}
              className="flex-1 py-2 border border-gray-200 dark:border-white/15 text-gray-700 dark:text-zinc-300 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">Cancelar</button>
            <button type="submit" disabled={cargando || !form.email}
              className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-zinc-700 text-white rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-1.5">
              {cargando ? <Loader2 size={14} className="animate-spin" /> : <Edit3 size={14} />} Guardar cambios
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Página principal ──────────────────────────────────────────────────────
export default function AdminUsuariosPage() {
  const { usuario } = useSession();
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[]>([]);
  const [cargando, setCargando] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [accionando, setAccionando] = useState<number | null>(null);
  const confirmar = useConfirm();
  const toast = useToast();
  const [permisosUser, setPermisosUser] = useState<UsuarioAdmin | null>(null);
  const [editUser, setEditUser] = useState<UsuarioAdmin | null>(null);

  const cargarUsuarios = async () => {
    setCargando(true);
    try {
      const res = await fetch('/api/admin/usuarios');
      const data = await res.json();
      if (data.success) setUsuarios(data.usuarios);
    } catch { }
    finally { setCargando(false); }
  };

  useEffect(() => { cargarUsuarios(); }, []);

  const toggleActivo = async (u: UsuarioAdmin) => {
    setAccionando(u.id);
    try {
      const res = await fetch('/api/admin/usuarios', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: u.id, activo: !u.activo }),
      });
      if (!res.ok) throw new Error();
      toast.success(u.activo ? 'Usuario desactivado' : 'Usuario activado');
      await cargarUsuarios();
    } catch { toast.error('No se pudo cambiar el estado del usuario'); }
    finally { setAccionando(null); }
  };

  const eliminar = async (u: UsuarioAdmin) => {
    const ok = await confirmar({
      titulo: `¿Eliminar a ${u.nombre || u.email}?`,
      mensaje: 'Esta acción no se puede deshacer.',
      confirmarLabel: 'Eliminar',
      peligro: true,
    });
    if (!ok) return;
    setAccionando(u.id);
    try {
      const res = await fetch(`/api/admin/usuarios?id=${u.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast.info('Usuario eliminado');
      await cargarUsuarios();
    } catch { toast.error('No se pudo eliminar el usuario'); }
    finally { setAccionando(null); }
  };

  const formatFecha = (f: string | null) => {
    if (!f) return 'Nunca';
    return new Date(f).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Usuarios' }]}>
      <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-zinc-100 flex items-center gap-2">
              <Users size={24} className="text-blue-600 dark:text-blue-400" />
              Administración de Usuarios
            </h1>
            <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">
              {usuarios.length} usuario{usuarios.length !== 1 ? 's' : ''} registrado{usuarios.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-sm transition-colors"
          >
            <Plus size={16} />
            Nuevo usuario
          </button>
        </div>

        {/* Tabla */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-white/10 shadow-sm overflow-hidden">
          {cargando ? (
            <div className="flex items-center justify-center py-16 gap-2 text-gray-500 dark:text-zinc-400">
              <Loader2 size={20} className="animate-spin text-blue-500" /> Cargando usuarios...
            </div>
          ) : usuarios.length === 0 ? (
            <div className="text-center py-16">
              <Users size={32} className="text-gray-300 dark:text-zinc-700 mx-auto mb-3" />
              <p className="text-gray-500 dark:text-zinc-400">No hay usuarios registrados</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 dark:bg-white/[0.03] border-b border-gray-100 dark:border-white/10">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase">Usuario</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase">Empresa</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase">Rol</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase">Estado</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase">Último acceso</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase">Registro</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-white/[0.06]">
                  {usuarios.map(u => (
                    <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                            {(u.nombre || u.email)[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">{u.nombre || '—'}</p>
                            <p className="text-xs text-gray-400 dark:text-zinc-500">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-600 dark:text-zinc-400">{u.empresa || '—'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                          u.rol === 'admin' ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' : u.rol === 'externo' ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400' : 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-zinc-400'
                        }`}>
                          {u.rol === 'admin' ? <ShieldCheck size={10} /> : <User size={10} />}
                          {u.rol === 'admin' ? 'Admin' : u.rol === 'externo' ? 'Externo' : 'Usuario'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                          u.activo ? 'bg-green-50 text-green-700 dark:bg-emerald-500/15 dark:text-emerald-400' : 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400'
                        }`}>
                          {u.activo ? <CheckCircle size={10} /> : <XCircle size={10} />}
                          {u.activo ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-zinc-400">{formatFecha(u.ultimo_login)}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-zinc-400">{formatFecha(u.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          {/* Editar datos / resetear contraseña */}
                          <button
                            onClick={() => setEditUser(u)}
                            title="Editar / resetear contraseña"
                            className="p-1.5 text-gray-500 hover:bg-gray-100 dark:text-zinc-400 dark:hover:bg-white/10 rounded-lg transition-colors"
                          >
                            <Edit3 size={14} />
                          </button>
                          {/* Editar permisos: para admin solo se ve el modo principiante (los
                              permisos granulares son moot, el admin ya los tiene todos implícitos) */}
                          <button
                            onClick={() => setPermisosUser(u)}
                            title={u.rol === 'admin' ? 'Modo principiante' : 'Editar permisos'}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10 rounded-lg transition-colors"
                          >
                            <ShieldCheck size={14} />
                          </button>
                          {/* No se puede desactivar a sí mismo */}
                          {u.id !== usuario?.id && (
                            <button
                              onClick={() => toggleActivo(u)}
                              disabled={accionando === u.id}
                              title={u.activo ? 'Desactivar' : 'Activar'}
                              className={`p-1.5 rounded-lg transition-colors ${
                                u.activo ? 'text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-500/10' : 'text-green-600 hover:bg-green-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10'
                              }`}
                            >
                              {accionando === u.id ? <Loader2 size={14} className="animate-spin" /> :
                                u.activo ? <XCircle size={14} /> : <CheckCircle size={14} />}
                            </button>
                          )}
                          {/* Eliminar usuario: admin-only ya (esta página entera lo es); confirmación
                              obligatoria ya vive en eliminar() de arriba. */}
                          {u.id !== usuario?.id && (
                            <button
                              onClick={() => eliminar(u)}
                              disabled={accionando === u.id}
                              title="Eliminar"
                              className="p-1.5 text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                          {u.id === usuario?.id && (
                            <span className="text-xs text-gray-400 dark:text-zinc-500 pr-1">(tú)</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showModal && (
        <ModalNuevoUsuario
          onCreado={() => { setShowModal(false); cargarUsuarios(); }}
          onCerrar={() => setShowModal(false)}
        />
      )}

      {permisosUser && (
        <ModalPermisos
          usuario={permisosUser}
          onGuardado={() => { setPermisosUser(null); cargarUsuarios(); }}
          onCerrar={() => setPermisosUser(null)}
        />
      )}

      {editUser && (
        <ModalEditarUsuario
          usuario={editUser}
          onGuardado={() => { setEditUser(null); cargarUsuarios(); toast.success('Usuario actualizado'); }}
          onCerrar={() => setEditUser(null)}
        />
      )}
    </AppLayout>
  );
}
