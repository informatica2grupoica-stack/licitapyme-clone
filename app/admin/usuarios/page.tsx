'use client';

import { useState, useEffect } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import {
  Users, Plus, ShieldCheck, User, CheckCircle, XCircle,
  Loader2, Trash2, Edit3, X, AlertCircle, Mail, Lock,
  Briefcase, Eye, EyeOff, Calendar
} from 'lucide-react';
import { useSession } from '@/app/lib/session-context';

interface UsuarioAdmin {
  id: number;
  email: string;
  nombre: string | null;
  empresa: string | null;
  rol: 'admin' | 'usuario';
  activo: boolean;
  ultimo_login: string | null;
  created_at: string;
}

interface FormNuevo {
  email: string;
  password: string;
  nombre: string;
  empresa: string;
  rol: 'admin' | 'usuario';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900 text-lg">Nuevo usuario</h3>
          <button onClick={onCerrar} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={18} className="text-gray-500" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
              <AlertCircle size={15} /> {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
            <div className="relative">
              <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))}
                placeholder="Juan Pérez" className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Empresa</label>
            <div className="relative">
              <Briefcase size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={form.empresa} onChange={e => setForm(p => ({ ...p, empresa: e.target.value }))}
                placeholder="Mi Empresa SpA" className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                placeholder="usuario@empresa.cl" required className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña *</label>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type={mostrarPass ? 'text' : 'password'} value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                placeholder="Mín. 8 caracteres" required minLength={8}
                className="w-full pl-8 pr-9 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              <button type="button" onClick={() => setMostrarPass(!mostrarPass)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {mostrarPass ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rol</label>
            <select value={form.rol} onChange={e => setForm(p => ({ ...p, rol: e.target.value as any }))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
              <option value="usuario">Usuario</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onCerrar}
              className="flex-1 py-2 border border-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={cargando || !form.email || !form.password}
              className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-1.5">
              {cargando ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Crear usuario
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
      await fetch('/api/admin/usuarios', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: u.id, activo: !u.activo }),
      });
      await cargarUsuarios();
    } finally { setAccionando(null); }
  };

  const eliminar = async (u: UsuarioAdmin) => {
    if (!confirm(`¿Eliminar a ${u.nombre || u.email}? Esta acción no se puede deshacer.`)) return;
    setAccionando(u.id);
    try {
      await fetch(`/api/admin/usuarios?id=${u.id}`, { method: 'DELETE' });
      await cargarUsuarios();
    } finally { setAccionando(null); }
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
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Users size={24} className="text-blue-600" />
              Administración de Usuarios
            </h1>
            <p className="text-sm text-gray-500 mt-1">
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
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {cargando ? (
            <div className="flex items-center justify-center py-16 gap-2 text-gray-500">
              <Loader2 size={20} className="animate-spin text-blue-500" /> Cargando usuarios...
            </div>
          ) : usuarios.length === 0 ? (
            <div className="text-center py-16">
              <Users size={32} className="text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No hay usuarios registrados</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Usuario</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Empresa</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Rol</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Estado</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Último acceso</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Registro</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {usuarios.map(u => (
                    <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                            {(u.nombre || u.email)[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">{u.nombre || '—'}</p>
                            <p className="text-xs text-gray-400">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-600">{u.empresa || '—'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                          u.rol === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {u.rol === 'admin' ? <ShieldCheck size={10} /> : <User size={10} />}
                          {u.rol === 'admin' ? 'Admin' : 'Usuario'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                          u.activo ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                        }`}>
                          {u.activo ? <CheckCircle size={10} /> : <XCircle size={10} />}
                          {u.activo ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatFecha(u.ultimo_login)}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatFecha(u.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          {/* No se puede desactivar a sí mismo */}
                          {u.id !== usuario?.id && (
                            <button
                              onClick={() => toggleActivo(u)}
                              disabled={accionando === u.id}
                              title={u.activo ? 'Desactivar' : 'Activar'}
                              className={`p-1.5 rounded-lg transition-colors ${
                                u.activo ? 'text-orange-500 hover:bg-orange-50' : 'text-green-600 hover:bg-green-50'
                              }`}
                            >
                              {accionando === u.id ? <Loader2 size={14} className="animate-spin" /> :
                                u.activo ? <XCircle size={14} /> : <CheckCircle size={14} />}
                            </button>
                          )}
                          {u.id !== usuario?.id && (
                            <button
                              onClick={() => eliminar(u)}
                              disabled={accionando === u.id}
                              title="Eliminar"
                              className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                          {u.id === usuario?.id && (
                            <span className="text-xs text-gray-400 pr-1">(tú)</span>
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
    </AppLayout>
  );
}
