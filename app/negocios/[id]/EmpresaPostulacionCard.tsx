'use client';

// Empresa con la que se postula: se elige UNA vez, en el Resumen (lo primero que se ve). Los anexos se llenan con sus datos.
// Los datos completos no ocupan lugar en la pantalla: se abren en un modal («Ver datos») y cada uno se copia con un clic.
import { useEffect, useState } from 'react';
import { Select } from '@/app/components/ui/Select';
import { Modal } from '@/app/components/ui/Modal';
import { useToast } from '@/app/components/ui/toast';
import { IconBuilding as Building2, IconCopy as Copy, IconLoader2 as Loader2 } from '@tabler/icons-react';

interface Empresa {
  id: number; razon_social: string; rut: string | null; direccion: string | null; region: string | null; giro: string | null; tipo_persona_juridica: string | null;
  representante_nombre: string | null; representante_rut: string | null; representante_cargo: string | null;
  email1: string | null; telefono1: string | null; banco_nombre: string | null; banco_tipo_cuenta: string | null; banco_numero: string | null;
}

export function EmpresaPostulacionCard({ negocioId, empresaId, onChange, bloqueado = false }: {
  negocioId: number; empresaId: number | null; onChange: (empresaId: number) => void; bloqueado?: boolean;
}) {
  const toast = useToast();
  const [lista, setLista] = useState<Array<{ id: number; razon_social: string }>>([]);
  const [empresa, setEmpresa] = useState<Empresa | null>(null);
  const [verDatos, setVerDatos] = useState(false);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { fetch('/api/empresas').then(r => r.json()).then(d => setLista(d.empresas || [])).catch(() => {}); }, []);
  useEffect(() => {
    if (!empresaId) { setEmpresa(null); return; }
    let vivo = true;
    fetch(`/api/empresas/${empresaId}`).then(r => r.json()).then(d => { if (vivo) setEmpresa(d.empresa || null); }).catch(() => {});
    return () => { vivo = false; };
  }, [empresaId]);

  const elegir = async (id: string) => {
    if (!id) return;
    setGuardando(true);
    try {
      const r = await fetch(`/api/negocios/${negocioId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ empresa_id: Number(id) }) });
      if (!r.ok) throw new Error();
      onChange(Number(id));
      toast.success('Empresa asignada', 'Los anexos se llenarán con sus datos.');
    } catch { toast.error('No se pudo guardar la empresa'); }
    finally { setGuardando(false); }
  };

  const copiar = (valor: string | null, etiqueta: string) => {
    if (!valor) return;
    navigator.clipboard.writeText(valor).then(() => toast.success(`${etiqueta} copiado`), () => toast.error('No se pudo copiar'));
  };

  const campos: Array<[string, string | null]> = empresa ? [
    ['Razón social', empresa.razon_social], ['RUT', empresa.rut], ['Tipo', empresa.tipo_persona_juridica], ['Giro', empresa.giro],
    ['Dirección', [empresa.direccion, empresa.region].filter(Boolean).join(', ') || null],
    ['Representante', empresa.representante_nombre], ['RUT del representante', empresa.representante_rut], ['Cargo', empresa.representante_cargo],
    ['Correo', empresa.email1], ['Teléfono', empresa.telefono1],
    ['Banco', [empresa.banco_nombre, empresa.banco_tipo_cuenta, empresa.banco_numero].filter(Boolean).join(' · ') || null],
  ] : [];

  return (
    <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 flex-wrap ${empresaId ? 'bg-white border-zinc-200' : 'bg-amber-50 border-amber-200'}`}>
      <Building2 size={16} className={empresaId ? 'text-zinc-400' : 'text-amber-600'} />
      <div className="min-w-0">
        <p className={`text-[12.5px] font-bold ${empresaId ? 'text-zinc-800' : 'text-amber-900'}`}>{empresaId ? 'Empresa con la que se postula' : '¿Con qué empresa se postula?'}</p>
        {!empresaId && <p className="text-[11.5px] text-amber-800">Elígela una vez: los anexos se llenan con sus datos.</p>}
      </div>
      <div className="w-full sm:w-72 sm:ml-2">
        <Select value={empresaId ? String(empresaId) : ''} onChange={elegir} placeholder="Elegir empresa…" disabled={bloqueado || guardando}
          options={lista.map(e => ({ value: String(e.id), label: e.razon_social }))} />
      </div>
      {guardando && <Loader2 size={14} className="animate-spin text-zinc-400" />}
      {empresaId && <button onClick={() => setVerDatos(true)} className="ml-auto text-[12px] font-semibold text-indigo-600 hover:text-indigo-700">Ver datos de la empresa</button>}

      <Modal open={verDatos} onClose={() => setVerDatos(false)} title={empresa?.razon_social || 'Datos de la empresa'} size="md"
        footer={<button onClick={() => setVerDatos(false)} className="px-4 py-2 text-[13px] font-semibold text-zinc-600 hover:text-zinc-900">Cerrar</button>}>
        {!empresa ? <p className="text-[13px] text-zinc-400">Cargando…</p> : (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {campos.filter(([, v]) => v).map(([label, valor]) => (
              <button key={label} onClick={() => copiar(valor, label)} title={`Copiar ${label.toLowerCase()}`}
                className="group flex items-center gap-2 text-left px-2.5 py-1.5 rounded-lg hover:bg-zinc-50">
                <div className="min-w-0 flex-1">
                  <p className="text-[9.5px] text-zinc-400 uppercase font-bold tracking-wide">{label}</p>
                  <p className="text-[12.5px] text-zinc-700 font-medium break-words">{valor}</p>
                </div>
                <Copy size={12} className="text-zinc-300 group-hover:text-zinc-500 shrink-0" />
              </button>
            ))}
          </div>
        )}
        <p className="mt-3 text-[11px] text-zinc-400">Para cambiar estos datos: sección Empresas del menú.</p>
      </Modal>
    </div>
  );
}
