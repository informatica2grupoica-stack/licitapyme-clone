'use client';

import { useEffect, useRef, useState } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { IconUser as User, IconMail as Mail, IconBriefcase as Briefcase, IconLock as Lock, IconEye as Eye, IconEyeOff as EyeOff, IconLoader2 as Loader2, IconCircleCheck as CheckCircle, IconAlertCircle as AlertCircle, IconDeviceFloppy as Save, IconShield as Shield, IconBuilding as Building2, IconPhone as Phone, IconId as IdCard, IconBadge as Badge, IconCamera as Camera, IconTrash as Trash } from '@tabler/icons-react';
import { formatearRut, formatearTelefono, normalizarRut, normalizarTelefono } from '@/app/lib/perfil-datos';

function AvatarPerfil({ nombre, email, size = 'lg', fotoUrl }: { nombre?: string; email?: string; size?: 'lg' | 'sm'; fotoUrl?: string | null }) {
  const text = nombre || email || '?';
  const iniciales = nombre
    ? nombre.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
    : (email || '?')[0].toUpperCase();
  const colores = ['from-indigo-500 to-violet-600', 'from-emerald-500 to-teal-600', 'from-amber-500 to-orange-600',
    'from-rose-500 to-pink-600', 'from-cyan-500 to-blue-600'];
  const idx = text.charCodeAt(0) % colores.length;
  const sz = size === 'lg' ? 'w-16 h-16 text-xl' : 'w-10 h-10 text-sm';
  if (fotoUrl) return <img src={fotoUrl} alt={text} className={`${sz} rounded-2xl object-cover flex-shrink-0`} />;
  return (
    <div className={`${sz} rounded-2xl bg-gradient-to-br ${colores[idx]} flex items-center justify-center text-white font-bold flex-shrink-0`}>
      {iniciales}
    </div>
  );
}

// Recorta al centro y reduce a 256×256 JPEG en el navegador: la foto viaja liviana (~20-40 KB).
async function reducirFoto(archivo: File): Promise<string> {
  const bmp = await createImageBitmap(archivo);
  const lado = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  canvas.getContext('2d')!.drawImage(bmp, (bmp.width - lado) / 2, (bmp.height - lado) / 2, lado, lado, 0, 0, 256, 256);
  return canvas.toDataURL('image/jpeg', 0.85);
}

const INPUT = 'w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-[13px] focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none bg-slate-50';

export default function PerfilPage() {
  const { usuario, recargarSesion } = useSession();
  const toast = useToast();
  const [form, setForm] = useState({
    nombre: usuario?.nombre || '',
    empresa: usuario?.empresa || '',
    telefono: '',
    rut: '',
    cargo: '',
    area: '',
    passwordActual: '',
    passwordNuevo: '',
    confirmar: '',
  });
  const [mostrarPass, setMostrarPass] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const inputFoto = useRef<HTMLInputElement>(null);

  // Datos de contacto y foto: no viajan en la sesión, se leen del perfil.
  useEffect(() => {
    if (!usuario) return;
    fetch('/api/auth/perfil').then(r => r.ok ? r.json() : null).then(d => {
      if (!d?.perfil) return;
      const p = d.perfil;
      setForm(f => ({ ...f, telefono: formatearTelefono(p.telefono), rut: formatearRut(p.rut), cargo: p.cargo || '', area: p.area || '' }));
      if (p.tiene_foto) setFotoUrl(`/api/perfil/foto?id=${usuario.id}&t=${Date.now()}`);
    }).catch(() => {});
  }, [usuario?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const cambiarFoto = async (archivo: File | undefined) => {
    if (!archivo) return;
    if (!archivo.type.startsWith('image/')) { toast.error('Elige un archivo de imagen'); return; }
    setSubiendoFoto(true);
    try {
      const dataUrl = await reducirFoto(archivo);
      const res = await fetch('/api/perfil/foto', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl }) });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'No se pudo subir la foto'); return; }
      setFotoUrl(dataUrl);
      toast.success('Foto actualizada');
      await recargarSesion();
    } catch { toast.error('No se pudo procesar la imagen'); }
    finally { setSubiendoFoto(false); if (inputFoto.current) inputFoto.current.value = ''; }
  };

  const quitarFoto = async () => {
    setSubiendoFoto(true);
    try {
      const res = await fetch('/api/perfil/foto', { method: 'DELETE' });
      if (res.ok) { setFotoUrl(null); await recargarSesion(); }
    } finally { setSubiendoFoto(false); }
  };

  const handleGuardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensaje(null);
    if (!form.telefono.trim()) {
      setMensaje({ tipo: 'error', texto: 'El teléfono es obligatorio' });
      return;
    }
    if (!normalizarTelefono(form.telefono)) {
      setMensaje({ tipo: 'error', texto: 'Teléfono inválido: usa un número chileno de 9 dígitos (ej: +56 9 1234 5678)' });
      return;
    }
    if (form.rut.trim() && !normalizarRut(form.rut)) {
      setMensaje({ tipo: 'error', texto: 'RUT inválido: revisa el número y el dígito verificador' });
      return;
    }
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
          telefono: form.telefono,
          rut: form.rut,
          cargo: form.cargo,
          area: form.area,
          ...(form.passwordNuevo ? { passwordActual: form.passwordActual, passwordNuevo: form.passwordNuevo } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMensaje({ tipo: 'error', texto: data.error });
      } else {
        toast.success('Perfil actualizado correctamente');
        setForm(p => ({
          ...p,
          telefono: formatearTelefono(normalizarTelefono(p.telefono)),
          rut: p.rut.trim() ? formatearRut(normalizarRut(p.rut)) : '',
          passwordActual: '', passwordNuevo: '', confirmar: '',
        }));
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
            <p className="text-xs text-slate-500">Tus datos de contacto, tu foto y tu contraseña</p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Card de identidad */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-[#1e1b4b] via-[#312e81] to-[#1e3a8a] px-6 py-6 flex items-center gap-4">
              <div className="relative flex-shrink-0">
                <AvatarPerfil nombre={usuario.nombre ?? undefined} email={usuario.email} size="lg" fotoUrl={fotoUrl} />
                <button type="button" onClick={() => inputFoto.current?.click()} disabled={subiendoFoto}
                  title="Cambiar foto"
                  className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full bg-white text-indigo-600 shadow flex items-center justify-center hover:bg-indigo-50 disabled:opacity-60">
                  {subiendoFoto ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
                </button>
                <input ref={inputFoto} type="file" accept="image/*" className="hidden" onChange={e => cambiarFoto(e.target.files?.[0])} />
              </div>
              <div>
                <p className="text-white font-bold text-[17px]">{usuario.nombre || 'Sin nombre'}</p>
                <p className="text-indigo-300 text-[12px] flex items-center gap-1.5 mt-0.5">
                  <Mail size={11} /> {usuario.email}
                </p>
                {(form.cargo || form.area) && (
                  <p className="text-indigo-200 text-[12px] flex items-center gap-1.5 mt-0.5">
                    <Badge size={11} /> {[form.cargo, form.area].filter(Boolean).join(' · ')}
                  </p>
                )}
                {usuario.empresa && (
                  <p className="text-indigo-300 text-[12px] flex items-center gap-1.5 mt-0.5">
                    <Building2 size={11} /> {usuario.empresa}
                  </p>
                )}
                <div className="flex items-center gap-3 mt-2">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    usuario.rol === 'admin'
                      ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                      : 'bg-indigo-400/20 text-indigo-300 border border-indigo-400/30'
                  }`}>
                    <Shield size={9} /> {usuario.rol === 'admin' ? 'Administrador' : 'Usuario'}
                  </span>
                  {fotoUrl && (
                    <button type="button" onClick={quitarFoto} disabled={subiendoFoto}
                      className="text-[10px] text-indigo-300/80 hover:text-white flex items-center gap-1">
                      <Trash size={10} /> Quitar foto
                    </button>
                  )}
                </div>
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
                        placeholder="Tu nombre" className={INPUT} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-slate-600 mb-1.5">Empresa</label>
                    <div className="relative">
                      <Briefcase size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input type="text" value={form.empresa} onChange={e => setForm(p => ({ ...p, empresa: e.target.value }))}
                        placeholder="Nombre de tu empresa" className={INPUT} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Contacto y cargo */}
              <div className="border-t border-slate-100 pt-5">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Contacto y cargo</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[12px] font-semibold text-slate-600 mb-1.5">Teléfono / celular <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <Phone size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input type="tel" value={form.telefono} onChange={e => setForm(p => ({ ...p, telefono: e.target.value }))}
                        placeholder="+56 9 1234 5678" className={INPUT} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-slate-600 mb-1.5">RUT <span className="text-slate-400 font-normal">(opcional)</span></label>
                    <div className="relative">
                      <IdCard size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input type="text" value={form.rut} onChange={e => setForm(p => ({ ...p, rut: e.target.value }))}
                        placeholder="12.345.678-5" className={INPUT} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-slate-600 mb-1.5">Cargo</label>
                    <div className="relative">
                      <Badge size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input type="text" value={form.cargo} onChange={e => setForm(p => ({ ...p, cargo: e.target.value }))}
                        placeholder="Ej: Ejecutivo comercial" maxLength={100} className={INPUT} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-slate-600 mb-1.5">Área</label>
                    <div className="relative">
                      <Building2 size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input type="text" value={form.area} onChange={e => setForm(p => ({ ...p, area: e.target.value }))}
                        placeholder="Ej: Compras, Licitaciones" maxLength={100} className={INPUT} />
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
