'use client';

import { useState } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { User, Mail, Briefcase, Lock, Eye, EyeOff, Loader2, CheckCircle, AlertCircle, Save } from 'lucide-react';

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

  const iniciales = usuario.nombre
    ? usuario.nombre.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
    : usuario.email[0].toUpperCase();

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Mi perfil' }]}>
      <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
          <User size={24} className="text-blue-600" />
          Mi perfil
        </h1>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Avatar y email (no editable) */}
          <div className="bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-5 flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xl font-bold flex-shrink-0">
              {iniciales}
            </div>
            <div>
              <p className="text-white font-semibold text-lg">{usuario.nombre || 'Sin nombre'}</p>
              <p className="text-slate-400 text-sm flex items-center gap-1.5 mt-0.5">
                <Mail size={12} /> {usuario.email}
              </p>
            </div>
          </div>

          <form onSubmit={handleGuardar} className="p-6 space-y-5">
            {mensaje && (
              <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${
                mensaje.tipo === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'
              }`}>
                {mensaje.tipo === 'ok' ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
                {mensaje.texto}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Nombre completo</label>
              <div className="relative">
                <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))}
                  placeholder="Tu nombre"
                  className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Empresa</label>
              <div className="relative">
                <Briefcase size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" value={form.empresa} onChange={e => setForm(p => ({ ...p, empresa: e.target.value }))}
                  placeholder="Nombre de tu empresa"
                  className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
            </div>

            <div className="border-t border-gray-100 pt-5">
              <p className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-1.5">
                <Lock size={14} className="text-gray-400" />
                Cambiar contraseña <span className="text-xs font-normal text-gray-400">(opcional)</span>
              </p>
              <div className="space-y-3">
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type={mostrarPass ? 'text' : 'password'} value={form.passwordActual}
                    onChange={e => setForm(p => ({ ...p, passwordActual: e.target.value }))}
                    placeholder="Contraseña actual"
                    className="w-full pl-9 pr-9 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  <button type="button" onClick={() => setMostrarPass(!mostrarPass)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {mostrarPass ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <input type={mostrarPass ? 'text' : 'password'} value={form.passwordNuevo}
                  onChange={e => setForm(p => ({ ...p, passwordNuevo: e.target.value }))}
                  placeholder="Nueva contraseña (mín. 8 caracteres)"
                  className="w-full px-3.5 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                <input type={mostrarPass ? 'text' : 'password'} value={form.confirmar}
                  onChange={e => setForm(p => ({ ...p, confirmar: e.target.value }))}
                  placeholder="Confirmar nueva contraseña"
                  className="w-full px-3.5 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
            </div>

            <button type="submit" disabled={cargando}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold rounded-lg text-sm transition-colors">
              {cargando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              Guardar cambios
            </button>
          </form>
        </div>
      </div>
    </AppLayout>
  );
}
