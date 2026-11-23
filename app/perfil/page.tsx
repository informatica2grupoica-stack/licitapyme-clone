'use client';

import { useEffect, useRef, useState } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { IconEye as Eye, IconEyeOff as EyeOff, IconLoader2 as Loader2, IconDeviceFloppy as Save, IconCamera as Camera, IconTrash as Trash } from '@tabler/icons-react';
import { Encabezado } from '@/app/components/ui/kit/Estructura';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Estado } from '@/app/components/ui/kit/Tarjeta';
import { Tooltip } from '@/app/components/ui/Tooltip';
import { Banner } from '@/app/components/ui/Banner';
import { formatearRut, formatearTelefono, normalizarRut, normalizarTelefono } from '@/app/lib/perfil-datos';

function AvatarPerfil({ nombre, email, size = 'lg', fotoUrl }: { nombre?: string; email?: string; size?: 'lg' | 'sm'; fotoUrl?: string | null }) {
  const text = nombre || email || '?';
  const iniciales = nombre
    ? nombre.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
    : (email || '?')[0].toUpperCase();
  const colores = ['bg-teal-600', 'bg-emerald-600', 'bg-amber-600', 'bg-rose-600', 'bg-cyan-600'];
  const idx = text.charCodeAt(0) % colores.length;
  const sz = size === 'lg' ? 'w-16 h-16 text-xl' : 'w-10 h-10 text-sm';
  if (fotoUrl) return <img src={fotoUrl} alt={text} className={`${sz} rounded-2xl object-cover flex-shrink-0`} />;
  return (
    <div className={`${sz} rounded-2xl ${colores[idx]} flex items-center justify-center text-white font-semibold flex-shrink-0`}>
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

const INPUT = 'h-9 w-full rounded-lg border border-linea bg-white px-3 text-sm text-tinta placeholder:text-tinta-3 outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

function Campo({ rotulo, opcional, children }: { rotulo: string; opcional?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-medium text-tinta dark:text-slate-200">
        {rotulo}{opcional && <span className="font-normal text-tinta-2 dark:text-slate-400"> (opcional)</span>}
      </span>
      {children}
    </label>
  );
}

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

  const SUPERFICIE = 'rounded-xl border border-linea bg-white shadow-tarjeta dark:bg-slate-900 dark:border-slate-800';
  const tituloSeccion = 'mb-3 text-[15px] font-semibold text-tinta dark:text-slate-100';

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Mi perfil' }]}>
      <div className="@container mx-auto max-w-2xl p-4 sm:p-6 lg:p-8">
        <Encabezado titulo="Mi perfil" descripcion="Tus datos de contacto, tu foto y tu contraseña." />

        <div className="space-y-4">
          {/* Identidad */}
          <section className={`${SUPERFICIE} flex flex-wrap items-center gap-4 p-5`}>
            <div className="relative flex-shrink-0">
              <AvatarPerfil nombre={usuario.nombre ?? undefined} email={usuario.email} size="lg" fotoUrl={fotoUrl} />
              <Tooltip label="Cambiar foto">
                <button type="button" onClick={() => inputFoto.current?.click()} disabled={subiendoFoto} aria-label="Cambiar foto"
                  className="absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full border border-linea bg-white text-slate-500 shadow-tarjeta hover:text-marca focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900">
                  {subiendoFoto ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} stroke={1.75} />}
                </button>
              </Tooltip>
              <input ref={inputFoto} type="file" accept="image/*" className="hidden" onChange={e => cambiarFoto(e.target.files?.[0])} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-semibold tracking-tight text-tinta dark:text-slate-50">{usuario.nombre || 'Sin nombre'}</p>
              <p className="truncate text-sm text-tinta-2 dark:text-slate-400">{usuario.email}</p>
              {(form.cargo || form.area || usuario.empresa) && (
                <p className="mt-0.5 truncate text-sm text-tinta-2 dark:text-slate-400">
                  {[[form.cargo, form.area].filter(Boolean).join(' · '), usuario.empresa].filter(Boolean).join(' — ')}
                </p>
              )}
              <div className="mt-2 flex items-center gap-4 text-xs text-tinta dark:text-slate-200">
                <Estado color={usuario.rol === 'admin' ? '#d97706' : '#0d9488'}>{usuario.rol === 'admin' ? 'Administrador' : 'Usuario'}</Estado>
                {fotoUrl && (
                  <button type="button" onClick={quitarFoto} disabled={subiendoFoto}
                    className="inline-flex items-center gap-1 text-tinta-2 hover:text-urgente focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:text-slate-400">
                    <Trash size={14} stroke={1.75} /> Quitar foto
                  </button>
                )}
              </div>
            </div>
          </section>

          <form onSubmit={handleGuardar} className={`${SUPERFICIE} space-y-6 p-5`}>
            {mensaje && <Banner variante={mensaje.tipo === 'ok' ? 'success' : 'error'}>{mensaje.texto}</Banner>}

            {/* Datos personales */}
            <div>
              <h2 className={tituloSeccion}>Datos personales</h2>
              <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
                <Campo rotulo="Nombre completo">
                  <input type="text" value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))}
                    placeholder="Tu nombre" autoComplete="name" className={INPUT} />
                </Campo>
                <Campo rotulo="Empresa" opcional>
                  <input type="text" value={form.empresa} onChange={e => setForm(p => ({ ...p, empresa: e.target.value }))}
                    placeholder="Nombre de tu empresa" autoComplete="organization" className={INPUT} />
                </Campo>
              </div>
            </div>

            {/* Contacto y cargo */}
            <div className="border-t border-linea pt-5 dark:border-slate-800">
              <h2 className={tituloSeccion}>Contacto y cargo</h2>
              <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
                <Campo rotulo="Teléfono / celular">
                  <input type="tel" value={form.telefono} onChange={e => setForm(p => ({ ...p, telefono: e.target.value }))}
                    placeholder="+56 9 1234 5678" autoComplete="tel" className={INPUT} />
                </Campo>
                <Campo rotulo="RUT" opcional>
                  <input type="text" value={form.rut} onChange={e => setForm(p => ({ ...p, rut: e.target.value }))}
                    placeholder="12.345.678-5" autoComplete="off" className={INPUT} />
                </Campo>
                <Campo rotulo="Cargo" opcional>
                  <input type="text" value={form.cargo} onChange={e => setForm(p => ({ ...p, cargo: e.target.value }))}
                    placeholder="Ej: Ejecutivo comercial" autoComplete="organization-title" maxLength={100} className={INPUT} />
                </Campo>
                <Campo rotulo="Área" opcional>
                  <input type="text" value={form.area} onChange={e => setForm(p => ({ ...p, area: e.target.value }))}
                    placeholder="Ej: Compras, Licitaciones" autoComplete="off" maxLength={100} className={INPUT} />
                </Campo>
              </div>
            </div>

            {/* Contraseña */}
            <div className="border-t border-linea pt-5 dark:border-slate-800">
              <h2 className={tituloSeccion}>
                Cambiar contraseña <span className="text-[13px] font-normal text-tinta-2 dark:text-slate-400">(opcional)</span>
              </h2>
              <div className="space-y-3">
                <Campo rotulo="Contraseña actual">
                  <div className="relative">
                    <input type={mostrarPass ? 'text' : 'password'} value={form.passwordActual}
                      onChange={e => setForm(p => ({ ...p, passwordActual: e.target.value }))}
                      autoComplete="current-password" className={`${INPUT} pr-10`} />
                    <button type="button" onClick={() => setMostrarPass(!mostrarPass)}
                      aria-label={mostrarPass ? 'Ocultar contraseñas' : 'Mostrar contraseñas'}
                      className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:text-tinta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60">
                      {mostrarPass ? <EyeOff size={16} stroke={1.75} /> : <Eye size={16} stroke={1.75} />}
                    </button>
                  </div>
                </Campo>
                <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
                  <Campo rotulo="Nueva contraseña">
                    <input type={mostrarPass ? 'text' : 'password'} value={form.passwordNuevo}
                      onChange={e => setForm(p => ({ ...p, passwordNuevo: e.target.value }))}
                      placeholder="Mínimo 8 caracteres" autoComplete="new-password" className={INPUT} />
                  </Campo>
                  <Campo rotulo="Confirmar nueva contraseña">
                    <input type={mostrarPass ? 'text' : 'password'} value={form.confirmar}
                      onChange={e => setForm(p => ({ ...p, confirmar: e.target.value }))}
                      autoComplete="new-password" className={INPUT} />
                  </Campo>
                </div>
              </div>
            </div>

            <div className="flex justify-end border-t border-linea pt-5 dark:border-slate-800">
              <Boton type="submit" variante="primario" disabled={cargando}
                icono={cargando ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} stroke={1.75} />}>
                {cargando ? 'Guardando…' : 'Guardar cambios'}
              </Boton>
            </div>
          </form>
        </div>
      </div>
    </AppLayout>
  );
}
