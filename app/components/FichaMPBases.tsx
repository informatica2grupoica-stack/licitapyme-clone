'use client';
// «Contenido de las bases» tal como lo publica Mercado Público: secciones que la API no entrega
// (4 antecedentes, 5 requisitos, 8 garantías, 9 cláusulas). Texto oficial, sin IA. Una sola tarjeta
// con pestañas (skill licitank-ui). Los plazos (3) y los criterios (6) NO van aquí: tienen sus
// propias pestañas Fechas y Criterios en el Resumen (decisión del dueño, 28-oct-2026, para no repetir).
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { IconFileDescription as FileDescription } from '@tabler/icons-react';
import type { FichaMP } from '@/app/lib/ficha-mp';
import { Pestanas } from '@/app/components/ui/kit/Pestanas';
import { Esqueleto } from '@/app/components/ui/kit/Estructura';
import { EASE_LK } from '@/app/components/ui/kit/movimiento';

const SIN_DATO = /^no hay informaci[oó]n/i;
const CAJA = 'bg-white border border-linea rounded-2xl shadow-tarjeta dark:bg-slate-900 dark:border-slate-800';

type Pestana = 'antecedentes' | 'requisitos' | 'garantias' | 'clausulas';

function Lista({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="space-y-1.5">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2 text-[13px] text-tinta-2 dark:text-slate-300 leading-relaxed">
          <span aria-hidden className="w-1 h-1 rounded-full bg-slate-400 mt-[9px] flex-shrink-0" />{t}
        </li>
      ))}
    </ul>
  );
}

function Grupo({ titulo, cantidad, children }: { titulo: string; cantidad?: number; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-50/80 p-4 dark:bg-slate-800/40">
      <p className="flex items-center justify-between gap-2 text-[13px] font-semibold text-tinta dark:text-slate-100 mb-2.5">
        {titulo}{cantidad !== undefined && <span className="text-xs font-semibold tabular-nums text-tinta-3">{cantidad}</span>}
      </p>
      {children}
    </div>
  );
}

export function FichaMPBases({ codigo }: { codigo: string }) {
  const [ficha, setFicha] = useState<FichaMP | null>(null);
  const [estado, setEstado] = useState<'cargando' | 'ok' | 'error'>('cargando');
  const [pestana, setPestana] = useState<Pestana | null>(null);

  useEffect(() => {
    let vivo = true;
    setEstado('cargando');
    fetch(`/api/ficha-mp/${encodeURIComponent(codigo)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(j => { if (vivo) { setFicha(j.ficha); setEstado('ok'); } })
      .catch(() => { if (vivo) setEstado('error'); });
    return () => { vivo = false; };
  }, [codigo]);

  if (estado === 'cargando') {
    return (
      <div className={`${CAJA} p-5 space-y-3`} aria-label="Leyendo las bases publicadas en Mercado Público">
        <Esqueleto className="h-5 w-48" /><Esqueleto className="h-8 w-full max-w-lg" /><Esqueleto className="h-16 w-full" />
      </div>
    );
  }
  if (estado === 'error' || !ficha) return null; // si MP no responde, el resto del Resumen sigue igual

  const { antecedentes: ant, requisitosAdjudicado: req } = ficha;
  const conDato = (a: string[]) => a.filter(x => !SIN_DATO.test(x));
  const nAnt = ant.administrativos.length + ant.tecnicos.length + ant.economicos.length;
  const hayReq = req.personaNatural.length + req.personaJuridica.length + req.documentosNatural.length + req.documentosJuridica.length > 0;

  const opciones = ([
    nAnt > 0 && { valor: 'antecedentes', etiqueta: 'Antecedentes', contador: nAnt },
    hayReq && { valor: 'requisitos', etiqueta: 'Requisitos' },
    ficha.garantias && { valor: 'garantias', etiqueta: 'Garantías' },
    ficha.requerimientos.length > 0 && { valor: 'clausulas', etiqueta: 'Cláusulas', contador: ficha.requerimientos.length },
  ].filter(Boolean)) as { valor: Pestana; etiqueta: string; contador?: number }[];

  if (!opciones.length) return null;
  const activa = pestana && opciones.some(o => o.valor === pestana) ? pestana : opciones[0].valor;

  return (
    <section className={`${CAJA} p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center dark:bg-slate-800 dark:text-slate-400"><FileDescription size={16} /></span>
          <div>
            <h3 className="text-[15px] font-semibold text-tinta dark:text-slate-100 leading-tight">Bases de la licitación</h3>
            <p className="text-xs text-tinta-2 dark:text-slate-400">Texto oficial de la ficha de Mercado Público</p>
          </div>
        </div>
        <div className="max-w-full overflow-x-auto">
          <Pestanas id="bases-mp" valor={activa} onCambio={setPestana} opciones={opciones} />
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={activa} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18, ease: EASE_LK }}>
          {activa === 'antecedentes' && (
            <div className="grid md:grid-cols-3 gap-3">
              {ant.administrativos.length > 0 && <Grupo titulo="Administrativos" cantidad={ant.administrativos.length}><Lista items={ant.administrativos} /></Grupo>}
              {ant.tecnicos.length > 0 && <Grupo titulo="Técnicos" cantidad={ant.tecnicos.length}><Lista items={ant.tecnicos} /></Grupo>}
              {ant.economicos.length > 0 && <Grupo titulo="Económicos" cantidad={ant.economicos.length}><Lista items={ant.economicos} /></Grupo>}
            </div>
          )}

          {activa === 'requisitos' && (
            <div className="grid md:grid-cols-2 gap-3">
              {(conDato(req.personaNatural).length > 0 || req.documentosNatural.length > 0) && (
                <Grupo titulo="Persona natural">
                  {conDato(req.personaNatural).length > 0 && <><p className="text-[11px] text-slate-500 mb-1">Inhabilidades</p><Lista items={req.personaNatural} /></>}
                  {req.documentosNatural.length > 0 && <><p className="text-[11px] text-slate-500 mt-3 mb-1">Documentos</p><Lista items={req.documentosNatural} /></>}
                </Grupo>
              )}
              {(conDato(req.personaJuridica).length > 0 || req.documentosJuridica.length > 0) && (
                <Grupo titulo="Persona jurídica">
                  {conDato(req.personaJuridica).length > 0 && <><p className="text-[11px] text-slate-500 mb-1">Inhabilidades</p><Lista items={req.personaJuridica} /></>}
                  {req.documentosJuridica.length > 0 && <><p className="text-[11px] text-slate-500 mt-3 mb-1">Documentos</p><Lista items={req.documentosJuridica} /></>}
                </Grupo>
              )}
            </div>
          )}

          {activa === 'garantias' && (
            <p className={`text-[13px] leading-relaxed whitespace-pre-line max-w-prose ${SIN_DATO.test(ficha.garantias) ? 'text-slate-400' : 'text-tinta-2 dark:text-slate-300'}`}>{ficha.garantias}</p>
          )}

          {activa === 'clausulas' && (
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-4">
              {ficha.requerimientos.map(r => (
                <div key={r.titulo} className="min-w-0">
                  <p className="text-[13px] font-semibold text-tinta dark:text-slate-100">{r.titulo}</p>
                  <p className="mt-0.5 text-xs text-tinta-2 dark:text-slate-400 leading-relaxed whitespace-pre-line">{r.descripcion}</p>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}
