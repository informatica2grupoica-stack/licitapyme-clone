'use client';

// Botón «Datos de la empresa»: abre una ventana con la ficha completa de la empresa con la que se postula (la misma que usan los anexos),
// para revisar qué dato falta o está mal cuando un anexo sale incompleto. Cada dato se copia con un clic.
import { useState } from 'react';
import { Modal } from '@/app/components/ui/Modal';
import { useToast } from '@/app/components/ui/toast';
import { IconBuilding as Building, IconCopy as Copy, IconLoader2 as Loader2 } from '@tabler/icons-react';

type Campo = [clave: string, etiqueta: string];
const SECCIONES: Array<{ titulo: string; campos: Campo[] }> = [
  { titulo: 'Empresa', campos: [['razon_social', 'Razón social'], ['rut', 'RUT'], ['direccion', 'Dirección'], ['region', 'Región'], ['giro', 'Giro'], ['tipo_persona_juridica', 'Tipo de persona jurídica']] },
  { titulo: 'Constitución', campos: [['fecha_sociedad', 'Fecha de la sociedad'], ['fecha_escritura', 'Fecha de escritura'], ['notaria', 'Notaría'], ['numero_repertorio', 'N° de repertorio'], ['fojas_numero_anio', 'Fojas, número y año']] },
  { titulo: 'Representante legal', campos: [['representante_nombre', 'Nombre'], ['representante_rut', 'RUT'], ['representante_cargo', 'Cargo']] },
  { titulo: 'Contacto', campos: [['email1', 'Correo 1'], ['telefono1', 'Teléfono 1'], ['email2', 'Correo 2'], ['telefono2', 'Teléfono 2']] },
  { titulo: 'Datos bancarios', campos: [['banco_nombre', 'Banco'], ['banco_tipo_cuenta', 'Tipo de cuenta'], ['banco_numero', 'N° de cuenta'], ['banco_titular_nombre', 'Titular'], ['banco_titular_rut', 'RUT del titular'], ['banco_email', 'Correo para pagos']] },
];

export function DatosEmpresaBoton({ empresaId, className }: { empresaId: number | null | undefined; className?: string }) {
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [empresa, setEmpresa] = useState<Record<string, any> | null>(null);

  const abrir = async () => {
    setAbierto(true);
    setCargando(true);
    try {
      const r = await fetch(`/api/empresas/${empresaId}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.empresa) throw new Error(d.error || 'No se pudo leer la empresa');
      setEmpresa(d.empresa);
    } catch (e: any) {
      toast.error('No se pudieron cargar los datos de la empresa', e.message);
      setAbierto(false);
    } finally { setCargando(false); }
  };

  const copiar = async (texto: string, que: string) => {
    try { await navigator.clipboard.writeText(texto); toast.success(`${que} copiado`); }
    catch { toast.error('No se pudo copiar'); }
  };
  const valor = (k: string) => { const v = empresa?.[k]; return v == null || String(v).trim() === '' ? null : String(v).trim(); };
  const todo = () => SECCIONES.map(s => `${s.titulo.toUpperCase()}\n` + s.campos.map(([k, et]) => `${et}: ${valor(k) ?? '—'}`).join('\n')).join('\n\n');
  const faltan = SECCIONES.flatMap(s => s.campos).filter(([k]) => !valor(k)).length;

  return (
    <>
      <button type="button" onClick={abrir} disabled={!empresaId}
        title={empresaId ? 'Ver la ficha completa de la empresa con la que se postula' : 'Elige primero la empresa (en Documentos)'}
        className={className || 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-[12px] font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed'}>
        <Building size={14} /> Datos de la empresa
      </button>
      <Modal open={abierto} onClose={() => setAbierto(false)} size="lg" title={empresa?.razon_social || 'Datos de la empresa'}
        subtitle="Es la ficha que usan los anexos para rellenarse. Si falta algo, pídele al administrador que lo complete en Empresas."
        footer={<div className="flex items-center justify-between w-full">
          <span className="text-[11.5px] text-zinc-500">{empresa ? (faltan ? `${faltan} dato(s) sin completar` : 'Ficha completa') : ''}</span>
          <button type="button" disabled={!empresa} onClick={() => copiar(todo(), 'Todos los datos')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-[12px] font-semibold hover:bg-indigo-700 disabled:opacity-50"><Copy size={13} /> Copiar todo</button>
        </div>}>
        {cargando || !empresa ? (
          <div className="py-10 flex justify-center text-zinc-400"><Loader2 size={18} className="animate-spin" /></div>
        ) : (
          <div className="space-y-5">
            {SECCIONES.map(s => (
              <section key={s.titulo}>
                <h4 className="text-[11px] font-bold uppercase tracking-wide text-zinc-400 mb-1.5">{s.titulo}</h4>
                <dl className="divide-y divide-zinc-100 rounded-xl border border-zinc-200">
                  {s.campos.map(([k, et]) => { const v = valor(k); return (
                    <div key={k} className="flex items-start gap-3 px-3 py-2 text-[12.5px]">
                      <dt className="w-44 flex-shrink-0 text-zinc-500">{et}</dt>
                      <dd className={`flex-1 min-w-0 break-words ${v ? 'text-zinc-900 font-medium' : 'text-amber-600'}`}>{v ?? 'sin dato'}</dd>
                      {v && <button type="button" onClick={() => copiar(v, et)} title="Copiar" className="p-1 text-zinc-300 hover:text-indigo-600 rounded"><Copy size={13} /></button>}
                    </div>); })}
                </dl>
              </section>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
