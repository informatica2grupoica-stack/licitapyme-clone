'use client';
// app/components/OfertasCompetencia.tsx
// Frente F.2 — bloque "Contra quién competimos" dentro del detalle de una postulada.
//
// Se pinta SOLO si la licitación ya está aperturada: antes de la apertura no existe el dato y
// mostrar una caja vacía "0 competidores" haría creer que no se presentó nadie.
//
// Carga perezosa: pide los datos al abrirse el acordeón, no al montar la lista — si no, entrar
// a Postuladas con 40 filas dispararía 40 consultas de golpe.

import { useEffect, useState, useCallback } from 'react';
import { Users, Loader2, RefreshCw, FileText, Trophy, AlertTriangle } from 'lucide-react';

interface OfertaDoc { id: number; nombre: string; url: string | null }
interface Oferta {
  proveedorRut: string; proveedorNombre: string;
  lineaNumero: number; lineaDescripcion: string | null;
  monto: number | null; moneda: string | null;
  esNuestra: boolean; documentos: OfertaDoc[];
}
interface Vista {
  codigo: string; aperturada: boolean; leidaEn: string | null; diagnostico: string | null;
  ofertas: Oferta[]; nuestraPosicion: number | null; competidores: number;
}

const fmt = (n: number | null, moneda: string | null) => {
  if (n == null) return '—';
  if (moneda && moneda !== 'CLP') return `${n.toLocaleString('es-CL')} ${moneda}`;
  return `$${n.toLocaleString('es-CL')}`;
};

export default function OfertasCompetencia({ codigo, aperturada, isAdmin }: {
  codigo: string; aperturada: boolean; isAdmin: boolean;
}) {
  const [vista, setVista] = useState<Vista | null>(null);
  const [cargando, setCargando] = useState(true);
  const [releyendo, setReleyendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/postuladas/ofertas?codigo=${encodeURIComponent(codigo)}`);
      const d = await r.json();
      if (!r.ok) { setError(d?.error || 'No se pudieron cargar las ofertas'); return; }
      setVista(d); setError(null);
    } catch {
      setError('No se pudieron cargar las ofertas');
    } finally {
      setCargando(false);
    }
  }, [codigo]);

  useEffect(() => { if (aperturada) cargar(); else setCargando(false); }, [aperturada, cargar]);

  const releer = async () => {
    setReleyendo(true); setError(null);
    try {
      const r = await fetch('/api/postuladas/ofertas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo }),
      });
      const d = await r.json();
      // El 502 (portal caído / sin IP chilena) trae un mensaje explicativo: se muestra tal cual
      // en vez de un "error" genérico que no dice qué hacer.
      if (!r.ok) { setError(d?.error || 'No se pudo leer la apertura'); return; }
      if (d.vista) setVista(d.vista);
    } catch {
      setError('No se pudo leer la apertura');
    } finally {
      setReleyendo(false);
    }
  };

  if (!aperturada) return null;

  const ofertas = vista?.ofertas || [];
  const conMontos = ofertas.some(o => o.monto != null);

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[11px] font-semibold text-slate-500 inline-flex items-center gap-1.5">
          <Users size={12} /> Competencia en la apertura
          {vista && vista.competidores > 0 && (
            <span className="text-slate-400 font-normal">· {vista.competidores} competidor{vista.competidores === 1 ? '' : 'es'}</span>
          )}
        </p>
        {isAdmin && (
          <button onClick={releer} disabled={releyendo}
            title="Volver a leer la apertura en Mercado Público ahora"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50 disabled:text-slate-300 px-2 py-1 rounded-lg transition-colors">
            {releyendo ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Releer
          </button>
        )}
      </div>

      {cargando ? (
        <p className="text-[11.5px] text-slate-400 inline-flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Cargando ofertas…</p>
      ) : error ? (
        <div className="flex items-start gap-1.5 text-[11.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      ) : ofertas.length === 0 ? (
        <div className="text-[11.5px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
          {vista?.leidaEn
            ? 'La apertura se leyó y no publicó una tabla de ofertas visible.'
            : 'Todavía no se leen las ofertas de esta apertura (el proceso corre cada hora).'}
          {isAdmin && vista?.diagnostico && (
            // El diagnóstico solo se muestra al admin: es información para afinar el lector,
            // no algo que el usuario del negocio deba interpretar.
            <span className="block mt-1 text-[10.5px] text-slate-400 font-mono">{vista.diagnostico}</span>
          )}
        </div>
      ) : (
        <>
          {vista?.nuestraPosicion != null && conMontos && (
            <p className={`inline-flex items-center gap-1 text-[11.5px] font-semibold rounded-full px-2 py-0.5 mb-2 border ${
              vista.nuestraPosicion === 1
                ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                : 'text-slate-700 bg-slate-100 border-slate-200'}`}>
              <Trophy size={11} /> Nuestra oferta es la {vista.nuestraPosicion}ª más baja de {ofertas.filter(o => o.lineaNumero === 0 && o.monto != null).length}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-[11.5px]">
              <thead>
                <tr className="text-slate-400 text-left">
                  <th className="font-medium py-1 pr-2">Proveedor</th>
                  <th className="font-medium py-1 pr-2 w-[110px]">RUT</th>
                  {ofertas.some(o => o.lineaNumero > 0) && <th className="font-medium py-1 pr-2 w-[60px]">Línea</th>}
                  <th className="font-medium py-1 pr-2 text-right w-[120px]">Oferta</th>
                  <th className="font-medium py-1 w-[80px]">Docs</th>
                </tr>
              </thead>
              <tbody>
                {ofertas.map((o, i) => (
                  <tr key={`${o.proveedorRut}-${o.lineaNumero}-${i}`}
                    className={`border-t border-slate-100 ${o.esNuestra ? 'bg-indigo-50/60 font-semibold text-indigo-900' : 'text-slate-700'}`}>
                    <td className="py-1.5 pr-2 truncate max-w-[240px]" title={o.proveedorNombre}>
                      {o.proveedorNombre}{o.esNuestra && <span className="ml-1 text-[10px] text-indigo-500">(nosotros)</span>}
                    </td>
                    <td className="py-1.5 pr-2 text-slate-500 font-mono text-[10.5px]">{o.proveedorRut}</td>
                    {ofertas.some(x => x.lineaNumero > 0) && <td className="py-1.5 pr-2">{o.lineaNumero || '—'}</td>}
                    <td className="py-1.5 pr-2 text-right tabular-nums">{fmt(o.monto, o.moneda)}</td>
                    <td className="py-1.5">
                      {o.documentos.length === 0 ? <span className="text-slate-300">—</span> : (
                        <span className="inline-flex items-center gap-1 flex-wrap">
                          {o.documentos.map(d => d.url ? (
                            <a key={d.id} href={d.url} target="_blank" rel="noopener noreferrer" title={d.nombre}
                              className="inline-flex items-center text-slate-400 hover:text-indigo-600">
                              <FileText size={12} />
                            </a>
                          ) : (
                            // Detectado pero aún sin copia propia: se marca en gris para que se
                            // note que existe, en vez de esconderlo hasta que baje el binario.
                            <span key={d.id} title={`${d.nombre} (aún sin descargar)`} className="text-slate-200">
                              <FileText size={12} />
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!conMontos && (
            <p className="text-[10.5px] text-slate-400 mt-1">
              La apertura publicó los participantes pero no los montos (apertura técnica). Los precios aparecen al abrirse la oferta económica.
            </p>
          )}
        </>
      )}
    </div>
  );
}
