'use client';
// «Contenido de las bases» tal como lo publica Mercado Público: secciones que la API no entrega
// (3 plazos, 4 antecedentes, 5 requisitos, 6 criterios, 8 garantías, 9 cláusulas). Texto oficial, sin IA.
import { useEffect, useState } from 'react';
import type { FichaMP } from '@/app/lib/ficha-mp';

const SIN_DATO = /^no hay informaci[oó]n/i;

function Lista({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="space-y-1.5 mt-1">
      {items.map((t, i) => (
        <li key={i} className="text-[12.5px] text-zinc-700 leading-relaxed pl-3 relative before:content-['•'] before:absolute before:left-0 before:text-zinc-300">{t}</li>
      ))}
    </ul>
  );
}

function Sub({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      <p className="text-[11.5px] font-semibold text-zinc-500 uppercase tracking-wide">{titulo}</p>
      {children}
    </div>
  );
}

function Bloque({ id, n, titulo, children, plegable }: { id: string; n: number; titulo: string; children: React.ReactNode; plegable?: boolean }) {
  const cabecera = <>{n}. {titulo}</>;
  return (
    <section id={id} className="bg-white border border-zinc-200/60 rounded-xl p-5 scroll-mt-4">
      {plegable ? (
        <details>
          <summary className="cursor-pointer text-[12px] font-bold text-zinc-400 uppercase tracking-wider">{cabecera}</summary>
          <div className="mt-3">{children}</div>
        </details>
      ) : (
        <>
          <h3 className="text-[12px] font-bold text-zinc-400 uppercase tracking-wider mb-3">{cabecera}</h3>
          {children}
        </>
      )}
    </section>
  );
}

export function FichaMPBases({ codigo }: { codigo: string }) {
  const [ficha, setFicha] = useState<FichaMP | null>(null);
  const [estado, setEstado] = useState<'cargando' | 'ok' | 'error'>('cargando');

  useEffect(() => {
    let vivo = true;
    setEstado('cargando');
    fetch(`/api/ficha-mp/${encodeURIComponent(codigo)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(j => { if (vivo) { setFicha(j.ficha); setEstado('ok'); } })
      .catch(() => { if (vivo) setEstado('error'); });
    return () => { vivo = false; };
  }, [codigo]);

  if (estado === 'cargando') return <div className="text-[12px] text-zinc-400 px-1">Leyendo las bases publicadas en Mercado Público…</div>;
  if (estado === 'error' || !ficha) return null; // si MP no responde, el resto del Resumen sigue igual

  const { antecedentes: ant, requisitosAdjudicado: req } = ficha;
  const conDato = (a: string[]) => a.filter(x => !SIN_DATO.test(x));
  const hayAnt = ant.administrativos.length + ant.tecnicos.length + ant.economicos.length > 0;
  const hayReq = req.personaNatural.length + req.personaJuridica.length + req.documentosNatural.length + req.documentosJuridica.length > 0;

  const secciones = [
    ficha.etapasPlazos.length > 0 && { id: 'fmp-3', n: 3, t: 'Etapas y plazos' },
    hayAnt && { id: 'fmp-4', n: 4, t: 'Antecedentes para incluir en la oferta' },
    hayReq && { id: 'fmp-5', n: 5, t: 'Requisitos para contratar al proveedor adjudicado' },
    ficha.criterios.length > 0 && { id: 'fmp-6', n: 6, t: 'Criterios de evaluación' },
    ficha.garantias && { id: 'fmp-8', n: 8, t: 'Garantías requeridas' },
    ficha.requerimientos.length > 0 && { id: 'fmp-9', n: 9, t: 'Requerimientos técnicos y otras cláusulas' },
  ].filter(Boolean) as { id: string; n: number; t: string }[];

  if (!secciones.length) return null;
  const sumaPond = ficha.criterios.reduce((s, c) => s + (parseFloat(c.ponderacion) || 0), 0);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-zinc-200/60 rounded-xl p-5">
        <h3 className="text-[12px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Contenido de las bases</h3>
        <p className="text-[11px] text-zinc-400 mb-3">Texto oficial de la ficha de Mercado Público.</p>
        <ol className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
          {secciones.map(s => (
            <li key={s.id}><a href={`#${s.id}`} className="text-[13px] text-indigo-600 hover:underline">{s.n}. {s.t}</a></li>
          ))}
        </ol>
      </div>

      {ficha.etapasPlazos.length > 0 && (
        <Bloque id="fmp-3" n={3} titulo="Etapas y plazos">
          {ficha.etapasPlazos.map(p => (
            <div key={p.etiqueta} className="flex justify-between gap-3 py-2 border-b border-zinc-50 last:border-0">
              <span className="text-[12px] text-zinc-400">{p.etiqueta}</span>
              <span className={`text-[12.5px] text-right ${SIN_DATO.test(p.valor) ? 'text-zinc-300' : 'font-semibold text-zinc-700'}`}>{p.valor}</span>
            </div>
          ))}
        </Bloque>
      )}

      {hayAnt && (
        <Bloque id="fmp-4" n={4} titulo="Antecedentes para incluir en la oferta">
          {ant.administrativos.length > 0 && <Sub titulo="Documentos administrativos"><Lista items={ant.administrativos} /></Sub>}
          {ant.tecnicos.length > 0 && <Sub titulo="Documentos técnicos"><Lista items={ant.tecnicos} /></Sub>}
          {ant.economicos.length > 0 && <Sub titulo="Documentos económicos"><Lista items={ant.economicos} /></Sub>}
        </Bloque>
      )}

      {hayReq && (
        <Bloque id="fmp-5" n={5} titulo="Requisitos para contratar al proveedor adjudicado" plegable>
          {conDato(req.personaNatural).length > 0 && <Sub titulo="Persona natural — inhabilidades"><Lista items={req.personaNatural} /></Sub>}
          {req.documentosNatural.length > 0 && <Sub titulo="Persona natural — documentos"><Lista items={req.documentosNatural} /></Sub>}
          {conDato(req.personaJuridica).length > 0 && <Sub titulo="Persona jurídica — inhabilidades"><Lista items={req.personaJuridica} /></Sub>}
          {req.documentosJuridica.length > 0 && <Sub titulo="Persona jurídica — documentos"><Lista items={req.documentosJuridica} /></Sub>}
        </Bloque>
      )}

      {ficha.criterios.length > 0 && (
        <Bloque id="fmp-6" n={6} titulo="Criterios de evaluación">
          <div className="space-y-3">
            {ficha.criterios.map(c => (
              <div key={c.numero + c.nombre} className="border border-zinc-100 rounded-lg p-3">
                <div className="flex justify-between gap-3">
                  <span className="text-[13px] font-semibold text-zinc-800">{c.numero} {c.nombre}</span>
                  <span className="text-[13px] font-bold text-indigo-600 flex-shrink-0">{c.ponderacion}</span>
                </div>
                {c.observaciones && <p className="text-[12px] text-zinc-500 leading-relaxed mt-1.5 whitespace-pre-line">{c.observaciones}</p>}
              </div>
            ))}
          </div>
          <p className={`text-[11px] mt-2 ${Math.round(sumaPond) === 100 ? 'text-zinc-400' : 'text-amber-600'}`}>
            Suma de ponderaciones: {Math.round(sumaPond)}%{Math.round(sumaPond) === 100 ? '' : ' — no cuadra con 100%, revisar las bases'}
          </p>
        </Bloque>
      )}

      {ficha.garantias && (
        <Bloque id="fmp-8" n={8} titulo="Garantías requeridas">
          <p className={`text-[12.5px] ${SIN_DATO.test(ficha.garantias) ? 'text-zinc-400' : 'text-zinc-700'}`}>{ficha.garantias}</p>
        </Bloque>
      )}

      {ficha.requerimientos.length > 0 && (
        <Bloque id="fmp-9" n={9} titulo="Requerimientos técnicos y otras cláusulas" plegable>
          <div className="space-y-3">
            {ficha.requerimientos.map(r => (
              <div key={r.titulo}>
                <p className="text-[12.5px] font-semibold text-zinc-700">{r.titulo}</p>
                <p className="text-[12px] text-zinc-500 leading-relaxed whitespace-pre-line">{r.descripcion}</p>
              </div>
            ))}
          </div>
        </Bloque>
      )}
    </div>
  );
}
