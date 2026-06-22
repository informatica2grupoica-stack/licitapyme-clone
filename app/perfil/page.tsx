'use client';

import { useState } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import {
  User, Mail, Briefcase, Lock, Eye, EyeOff, Loader2,
  CheckCircle, AlertCircle, Save, Shield, Building2,
} from 'lucide-react';

function AvatarPerfil({ nombre, email, size = 'lg' }: { nombre?: string; email?: string; size?: 'lg' | 'sm' }) {
  const text = nombre || email || '?';
  const iniciales = nombre
    ? nombre.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
    : (email || '?')[0].toUpperCase();
  const colores = ['from-indigo-500 to-violet-600', 'from-emerald-500 to-teal-600', 'from-amber-500 to-orange-600',
    'from-rose-500 to-pink-600', 'from-cyan-500 to-blue-600'];
  const idx = text.charCodeAt(0) % colores.length;
  const sz = size === 'lg' ? 'w-16 h-16 text-xl' : 'w-10 h-10 text-sm';
  return (
    <div className={`${sz} rounded-2xl bg-gradient-to-br ${colores[idx]} flex items-center justify-center text-white font-bold flex-shrink-0`}>
      {iniciales}
    </div>
  );
}

export default function PerfilPage() {
  const { usuario, recargarSesion } = useSession();
  const [form, setForm] = useState({
    nombre: usuario?.nombre || '',
    empresa: usuario?.empresa || '',
    passwordActual: '',
    passwordNuevo: '',
    confirmar: '',
  });
  const [mostrarPass, setMostrarPass] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  const handleGuardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensaje(null);
    if (form.passwordNuevo && form.passwordNuevo.length < 8) {
      setMensaje({ tipo: 'error', texto: 'La nueva contraseña debe tener al menos 8 caracteres' });
      return;
    }
    if (form.passwordNuevo && form.passwordNuevo !== form.confirmar) {
      setMensaje({ tipo: 'error', texto: 'Las contraseñas no coinciden' });
      return;
    }
    setCargando(true);
    try {
      const res = await fetch('/api/auth/perfil', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: form.nombre,
          empresa: form.empresa,
          ...(form.passwordNuevo ? { passwordActual: form.passwordActual, passwordNuevo: form.passwordNuevo } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMensaje({ tipo: 'error', texto: data.error });
      } else {
        setMensaje({ tipo: 'ok', texto: 'Perfil actualizado correctamente' });
        setForm(p => ({ ...p, passwordActual: '', passwordNuevo: '', confirmar: '' }));
        await recargarSesion();
      }
    } catch {
      setMensaje({ tipo: 'error', texto: 'Error de conexión' });
    } finally {
      setCargando(false);
    }
  };

  if (!usuario) return null;

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Mi perfil' }]}>
      <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto">

        {/* Header de página */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
            <User size={20} />
          </div>
          <div>
            <h1 className="text-[15px] font-bold text-slate-900">Mi perfil</h1>
            <p className="text-xs text-slate-500">Gestiona tu información personal y contraseña</p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Card de identidad */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-[#1e1b4b] via-[#312e81] to-[#1e3a8a] px-6 py-6 flex items-center gap-4">
              <AvatarPerfil nombre={usuario.nombre ?? undefined} email={usuario.email} size="lg" />
              <div>
                <p className="text-white font-bold text-[17px]">{usuario.nombre || 'Sin nombre'}</p>
                <p className="text-indigo-300 text-[12px] flex items-center gap-1.5 mt-0.5">
                  <Mail size={11} /> {usuario.email}
                </p>
                {usuario.empresa && (
                  <p className="text-indigo-300 text-[12px] flex items-center gap-1.5 mt-0.5">
                    <Building2 size={11} /> {usuario.empresa}
                  </p>
                )}
                <span className={`inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  usuario.rol === 'admin'
                    ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                    : 'bg-indigo-400/20 text-indigo-300 border border-indigo-400/30'
                }`}>
                  <Shield size={9} /> {usuario.rol === 'admin' ? 'Administrador' : 'Usuario'}
                </span>
              </div>
            </div>

            <form onSubmit={handleGuardar} className="p-6 space-y-5">
              {mensaje && (
                <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-[13px] ${
                  mensaje.tipo === 'ok'
                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                    : 'bg-red-50 border border-red-200 text-red-700'
                }`}>
                  {mensaje.tipo === 'ok' ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
                  {mensaje.texto}
                </div>
              )}

              {/* Datos personales */}
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Datos personales</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-[12px] font-semibold text-slate-600 mb-1.5">Nombre completo</label>
                    <div className="relative">
                      <User size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input type="text" value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))}
                        placeholder="Tu nombre"
                        className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-[13px] focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none bg-slate-50" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-slate-600 mb-1.5">Empresa</label>
                    <div className="relative">
                      <Briefcase size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input type="text" value={form.empresa} onChange={e => setForm(p => ({ ...p, empresa: e.target.value }))}
                        placeholder="Nombre de tu empresa"
                        className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-[13px] focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none bg-slate-50" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Contraseña */}
              <div className="border-t border-slate-100 pt-5">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Lock size={11} /> Cambiar contraseña
                  <span className="text-slate-300 font-normal normal-case">(opcional)</span>
                </p>
                <div className="space-y-3">
                  <div className="relative">
                    <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type={mostrarPass ? 'text' : 'password'} value={form.passwordActual}
                      onChange={e => setForm(p => ({ ...p, passwordActual: e.target.value }))}
                      placeholder="Contraseña actual"
                      className="w-full pl-10 pr-10 py-2.5 border border-slate-200 rounded-xl text-[13px] focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none bg-slate-50" />
                    <button type="button" onClick={() => setMostrarPass(!mostrarPass)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      {mostrarPass ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                  <input type={mostrarPass ? 'text' : 'password'} value={form.passwordNuevo}
                    onChange={e => setForm(p => ({ ...p, passwordNuevo: e.target.value }))}
                    placeholder="Nueva contraseña (mín. 8 caracteres)"
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-[13px] focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none bg-slate-50" />
                  <input type={mostrarPass ? 'text' : 'password'} value={form.confirmar}
                    onChange={e => setForm(p => ({ ...p, confirmar: e.target.value }))}
                    placeholder="Confirmar nueva contraseña"
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-[13px] focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none bg-slate-50" />
                </div>
              </div>

              <button type="submit" disabled={cargando}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold rounded-xl text-[14px] transition-colors shadow-sm">
                {cargando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                Guardar cambios
              </button>
            </form>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
