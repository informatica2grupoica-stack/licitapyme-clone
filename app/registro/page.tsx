'use client';

// Solicitud de alta de una empresa (pública, sin sesión). No crea ninguna cuenta: deja una solicitud que un integrante de LICITANK revisa y aprueba.
import { useState } from 'react';
import Link from 'next/link';
import { IconBuilding as Building2, IconLoader2 as Loader2, IconAlertCircle as AlertCircle, IconArrowLeft as ArrowLeft, IconCircleCheck as CheckCircle, IconSend as Send } from '@tabler/icons-react';

const campo = 'w-full px-3.5 py-2.5 border border-slate-200 bg-white rounded-xl text-[13px] focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all shadow-sm';
const etiqueta = 'block text-[12px] font-semibold text-slate-600 mb-1.5';

export default function RegistroPage() {
  const [f, setF] = useState({ razonSocial: '', rut: '', contactoNombre: '', contactoEmail: '', contactoTelefono: '', mensaje: '', web: '' });
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF(p => ({ ...p, [k]: e.target.value }));

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setCargando(true);
    try {
      const res = await fetch('/api/registro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'No se pudo enviar la solicitud'); return; }
      setMensaje(data.mensaje || 'Recibimos tu solicitud.');
    } catch {
      setError('Error de conexión. Intenta nuevamente.');
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-teal-600 rounded-2xl shadow-lg mb-3">
            <Building2 size={22} className="text-white" />
          </div>
          <h1 className="text-xl font-semibold text-slate-900">LICITANK</h1>
        </div>

        {mensaje ? (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-green-50 rounded-full mb-4">
              <CheckCircle size={24} className="text-green-600" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900 mb-2">Solicitud enviada</h2>
            <p className="text-[13px] text-slate-500 leading-relaxed">{mensaje}</p>
            <Link href="/login" className="inline-flex items-center gap-1.5 mt-6 text-[13px] text-teal-600 hover:text-teal-800 font-semibold">
              <ArrowLeft size={14} /> Ir al inicio de sesión
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h2 className="text-2xl font-semibold text-slate-900 mb-1">Solicita tu acceso</h2>
              <p className="text-[13px] text-slate-500">Cuéntanos de tu empresa. Revisamos cada solicitud y te contactamos para activar tu cuenta.</p>
            </div>

            {error && (
              <div role="alert" className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-[13px] px-4 py-3 rounded-xl mb-5">
                <AlertCircle size={15} className="flex-shrink-0" /> {error}
              </div>
            )}

            <form onSubmit={enviar} className="space-y-4">
              <div>
                <label htmlFor="reg-razon" className={etiqueta}>Razón social o nombre de la empresa</label>
                <input id="reg-razon" value={f.razonSocial} onChange={set('razonSocial')} required maxLength={200} autoComplete="organization" className={campo} />
              </div>
              <div>
                <label htmlFor="reg-rut" className={etiqueta}>RUT de la empresa</label>
                <input id="reg-rut" value={f.rut} onChange={set('rut')} required maxLength={20} placeholder="76.123.456-7" className={campo} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="reg-nombre" className={etiqueta}>Persona de contacto</label>
                  <input id="reg-nombre" value={f.contactoNombre} onChange={set('contactoNombre')} required maxLength={150} autoComplete="name" className={campo} />
                </div>
                <div>
                  <label htmlFor="reg-tel" className={etiqueta}>Teléfono <span className="font-normal text-slate-400">(opcional)</span></label>
                  <input id="reg-tel" value={f.contactoTelefono} onChange={set('contactoTelefono')} maxLength={40} autoComplete="tel" className={campo} />
                </div>
              </div>
              <div>
                <label htmlFor="reg-email" className={etiqueta}>Correo de contacto</label>
                <input id="reg-email" type="email" value={f.contactoEmail} onChange={set('contactoEmail')} required maxLength={190} autoComplete="email" className={campo} />
              </div>
              <div>
                <label htmlFor="reg-msg" className={etiqueta}>¿Qué vendes o a qué licitaciones postulas? <span className="font-normal text-slate-400">(opcional)</span></label>
                <textarea id="reg-msg" value={f.mensaje} onChange={set('mensaje')} maxLength={500} rows={3} className={campo} />
                <p className="mt-1 text-[11px] text-slate-500">Si todavía no le vendes al Estado, con esto preparamos tu plataforma.</p>
              </div>
              {/* Campo trampa: invisible para personas; los robots lo llenan y la solicitud se descarta. */}
              <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                <label htmlFor="reg-web">No llenar</label>
                <input id="reg-web" tabIndex={-1} autoComplete="off" value={f.web} onChange={set('web')} />
              </div>

              <button type="submit" disabled={cargando}
                className="w-full flex items-center justify-center gap-2 py-3 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors">
                {cargando ? <><Loader2 size={15} className="animate-spin" />Enviando...</> : <><Send size={15} />Enviar solicitud</>}
              </button>
              <p className="text-[11px] leading-relaxed text-slate-400">
                Usamos estos datos solo para contactarte y activar tu cuenta. Más información en nuestra{' '}
                <Link href="/privacidad" className="underline hover:text-slate-600">política de privacidad</Link>.
              </p>
            </form>

            <p className="text-center mt-6">
              <Link href="/login" className="inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-700 font-medium">
                <ArrowLeft size={14} /> Ya tengo cuenta
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
