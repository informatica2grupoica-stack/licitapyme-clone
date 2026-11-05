'use client';

// «Enviar al proveedor» (pedido del dueño, 05-nov-2026): manda la OC en PDF por correo para que el proveedor emita la factura, sin salir
// de Licitank. Sirve para las OC de Obuma (folio) y las propias de Comercial MP (ocPropiaId). El correo va con el nombre de quien envía
// y el proveedor le responde a esa persona (queda en copia). Muestra a quién y cuándo se envió antes.
import { useEffect, useState } from 'react';
import { IconSend as Send, IconLoader2 as Loader2 } from '@tabler/icons-react';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Modal } from '@/app/components/ui/Modal';
import { useToast } from '@/app/components/ui/toast';

interface Envio { fecha: string; por: string | null; para: string[]; cc: string[] }
interface Borrador {
  folio: string; proveedor: string; para: string; cc: string; asunto: string; mensaje: string;
  remitente: { nombre: string | null; email: string | null }; envios: Envio[];
}

const campo = 'mt-0.5 w-full text-[13px] font-normal text-zinc-900 dark:text-slate-100 bg-white dark:bg-slate-900 border border-zinc-200 dark:border-slate-700 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-teal-500';
const rotulo = 'block text-[11.5px] font-medium text-zinc-600 dark:text-slate-400';
const cuando = (iso: string) => new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function EnviarOcModal({ negocioId, folio, ocPropiaId, onCerrar, onEnviada }: {
  negocioId: number; folio?: string; ocPropiaId?: number; onCerrar: () => void; onEnviada?: () => void;
}) {
  const toast = useToast();
  const [b, setB] = useState<Borrador | null>(null);
  const [para, setPara] = useState(''); const [cc, setCc] = useState('');
  const [asunto, setAsunto] = useState(''); const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const url = `/api/compras/${negocioId}/oc-envio`;

  useEffect(() => {
    let vivo = true;
    const q = ocPropiaId ? `ocPropia=${ocPropiaId}` : `folio=${encodeURIComponent(folio || '')}`;
    fetch(`${url}?${q}`).then(async r => {
      const d = await r.json().catch(() => ({}));
      if (!vivo) return;
      if (!r.ok) { setError(d.error || 'No se pudo preparar el correo.'); return; }
      setB(d); setPara(d.para); setCc(d.cc); setAsunto(d.asunto); setMensaje(d.mensaje);
    }).catch(() => vivo && setError('No se pudo preparar el correo.'));
    return () => { vivo = false; };
  }, [url, folio, ocPropiaId]);

  const enviar = async () => {
    setEnviando(true); setError(null);
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folio, ocPropiaId, para, cc, asunto, mensaje }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) throw new Error(d.error || 'No se pudo enviar la orden de compra.');
      toast.success(`Orden de compra ${b?.folio ?? ''} enviada a ${para}`);
      onEnviada?.(); onCerrar();
    } catch (e: any) { setError(e.message); } finally { setEnviando(false); }
  };

  return (
    <Modal open onClose={onCerrar} size="md" title={`Enviar la orden de compra ${b?.folio ?? folio ?? ''} al proveedor`}
      subtitle={b ? `${b.proveedor} · va el PDF adjunto para que emita la factura` : undefined}
      footer={<>
        {error && <span className="mr-auto text-xs text-red-600">{error}</span>}
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="primario" icono={enviando ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          disabled={!b || !para.trim() || !asunto.trim() || !mensaje.trim() || enviando} onClick={enviar} data-testid="oc-enviar-confirmar">
          {enviando ? 'Enviando…' : 'Enviar'}
        </Boton>
      </>}>
      {!b && !error && <p className="flex items-center gap-2 text-[13px] text-tinta-3"><Loader2 size={15} className="animate-spin" /> Preparando el correo…</p>}
      {b && (
        <div className="space-y-3">
          {b.envios.length > 0 && (
            <div className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2">
              Ya se envió {b.envios.length === 1 ? 'una vez' : `${b.envios.length} veces`}:
              <ul className="mt-1 space-y-0.5">
                {b.envios.slice(0, 3).map((e, i) => <li key={i}>{cuando(e.fecha)} · {e.por ?? '—'} → {e.para.join(', ')}</li>)}
              </ul>
            </div>
          )}
          <label className={rotulo}>Para (correo del proveedor)
            <input value={para} onChange={e => setPara(e.target.value)} className={campo} placeholder="facturacion@proveedor.cl" autoFocus={!b.para} />
            {!b.para && <span className="mt-1 block text-[11.5px] text-amber-700 dark:text-amber-400">La ficha del proveedor no tiene correo: escríbelo. Al enviar queda guardado en su ficha y la próxima vez se propone solo.</span>}
          </label>
          <label className={rotulo}>Con copia <span className="font-normal text-zinc-400">(separa varios con coma)</span>
            <input value={cc} onChange={e => setCc(e.target.value)} className={campo} />
          </label>
          <label className={rotulo}>Asunto
            <input value={asunto} onChange={e => setAsunto(e.target.value)} className={campo} />
          </label>
          <label className={rotulo}>Mensaje
            <textarea value={mensaje} onChange={e => setMensaje(e.target.value)} rows={10} className={campo} />
          </label>
          <p className="text-[11.5px] text-tinta-3">
            Sale a nombre de <b className="font-semibold">{b.remitente.nombre || 'tu perfil'}</b> desde el correo de la plataforma
            {b.remitente.email ? <>; si el proveedor responde, la respuesta te llega a <b className="font-semibold">{b.remitente.email}</b></> : null}.
          </p>
        </div>
      )}
    </Modal>
  );
}
