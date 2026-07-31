'use client';
// app/components/OfertasCompetencia.tsx
// Frente F.2 — "Competencia": contra quién peleamos esta licitación y con qué presentaron.
//
// Vive como SECCIÓN de la ficha de licitación, no como una fila apretada en Postuladas: los
// anexos de la competencia se leen igual que los documentos propios (tarjeta por oferente,
// categorías desplegables, ojo para ver sin descargar), que es el gesto que ya existe en el
// sistema. Reusa DocumentViewerModal — el mismo visor de los documentos propios.
//
// Estructura, calcada de la del portal (Resumen de ofertas → Anexos por oferente):
//   Oferente (RUT · razón social · monto · estado)
//     └ Anexos económicos / técnicos / administrativos / declaración jurada / info proveedor
//         └ archivo.pdf  [ojo: ver]  [descargar]

import { useEffect, useState, useCallback } from 'react';
import {
  Users, Loader2, RefreshCw, FileText, Trophy, AlertTriangle, ChevronDown, ChevronRight,
  Eye, Download, Building2, Inbox,
} from 'lucide-react';
import { DocumentViewerModal, type VisorDoc } from '@/app/components/DocumentViewerModal';

interface DocumentoVista {
  id: number; nombre: string; descripcion: string | null; tipoMp: string | null;
  tamanoKb: number | null; url: string | null; error: string | null;
}
interface CategoriaVista { categoria: string; rotulo: string; documentos: DocumentoVista[] }
interface OferenteVista {
  proveedorRut: string; proveedorNombre: string; nombreOferta: string | null; estado: string | null;
  monto: number | null; moneda: string | null; esNuestra: boolean;
  lineas: { lineaNumero: number; lineaDescripcion: string | null; monto: number | null }[];
  categorias: CategoriaVista[]; totalDocumentos: number; documentosDescargados: number;
}
interface Vista {
  codigo: string; aperturada: boolean; leidaEn: string | null; diagnostico: string | null;
  oferentes: OferenteVista[]; competidores: number;
  nuestraPosicion: number | null; totalOferentesConMonto: number;
}

const fmt = (n: number | null, moneda: string | null) => {
  if (n == null) return '—';
  if (moneda && moneda !== 'CLP') return `${n.toLocaleString('es-CL')} ${moneda}`;
  return `$${n.toLocaleString('es-CL')}`;
};

const peso = (kb: number | null) =>
  kb == null ? '' : kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;

// "Aceptada" es lo normal; cualquier otra cosa (Inadmisible, Rechazada) cambia el peso de esa
// oferta como competencia y por eso se pinta distinto en vez de mostrarse como un texto más.
function EstadoChip({ estado }: { estado: string | null }) {
  if (!estado) return null;
  const ok = /acept/i.test(estado);
  return (
    <span className={`inline-flex items-center text-[10.5px] font-semibold rounded-full px-2 py-0.5 border ${
      ok ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-rose-700 bg-rose-50 border-rose-200'}`}>
      {estado}
    </span>
  );
}

export default function OfertasCompetencia({ codigo, isAdmin }: { codigo: string; isAdmin: boolean }) {
  const [vista, setVista] = useState<Vista | null>(null);
  const [cargando, setCargando] = useState(true);
  const [releyendo, setReleyendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [catAbierta, setCatAbierta] = useState<string | null>(null);
  const [visor, setVisor] = useState<VisorDoc | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/postuladas/ofertas?codigo=${encodeURIComponent(codigo)}`);
      const d = await r.json();
      if (!r.ok) { setError(d?.error || 'No se pudieron cargar las ofertas'); return; }
      setVista(d); setError(null);
      // Abre solo el primer competidor (no el nuestro): es lo que se viene a mirar.
      const primero = (d.oferentes || []).find((o: OferenteVista) => !o.esNuestra);
      if (primero) setAbierto(primero.proveedorRut);
    } catch {
      setError('No se pudieron cargar las ofertas');
    } finally {
      setCargando(false);
    }
  }, [codigo]);

  useEffect(() => { cargar(); }, [cargar]);

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

  if (cargando) {
    return (
      <p className="text-[12.5px] text-zinc-400 inline-flex items-center gap-1.5 py-6">
        <Loader2 size={13} className="animate-spin" /> Cargando ofertas de la apertura…
      </p>
    );
  }

  const oferentes = vista?.oferentes || [];

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-[15px] font-bold text-zinc-800 inline-flex items-center gap-2">
            <Users size={16} className="text-indigo-600" /> Competencia
          </h2>
          <p className="text-[12px] text-zinc-500 mt-0.5">
            Ofertas presentadas en la apertura de Mercado Público, con los anexos de cada oferente.
          </p>
        </div>
        {isAdmin && (
          <button onClick={releer} disabled={releyendo}
            title="Volver a leer la apertura en Mercado Público ahora"
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-indigo-600 border border-indigo-200 hover:bg-indigo-50 disabled:text-zinc-300 disabled:border-zinc-200 px-3 py-1.5 rounded-lg transition-colors flex-shrink-0">
            {releyendo ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {releyendo ? 'Leyendo…' : 'Releer apertura'}
          </button>
        )}
      </div>

      {!vista?.aperturada && (
        <div className="flex items-start gap-1.5 text-[12.5px] text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 mb-3">
          <AlertTriangle size={13} className="flex-shrink-0 mt-0.5 text-zinc-400" />
          <span>Esta licitación todavía no registra acto de apertura en Mercado Público. Hasta que ocurra, las ofertas de los demás no son públicas.</span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-1.5 text-[12.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
          <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}

      {vista?.nuestraPosicion != null && (
        <div className={`inline-flex items-center gap-1.5 text-[12.5px] font-semibold rounded-lg px-3 py-1.5 mb-3 border ${
          vista.nuestraPosicion === 1
            ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
            : 'text-zinc-700 bg-zinc-100 border-zinc-200'}`}>
          <Trophy size={13} />
          Nuestra oferta es la {vista.nuestraPosicion}ª más baja de {vista.totalOferentesConMonto}
          <span className="font-normal text-zinc-500">· {vista.competidores} competidor{vista.competidores === 1 ? '' : 'es'}</span>
        </div>
      )}

      {oferentes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 px-4 py-8 text-center">
          <Inbox size={20} className="mx-auto text-zinc-300 mb-2" />
          <p className="text-[13px] font-semibold text-zinc-600">
            {vista?.leidaEn ? 'La apertura se leyó y no publicó tabla de ofertas' : 'Todavía no se leen las ofertas de esta apertura'}
          </p>
          <p className="text-[12px] text-zinc-500 mt-0.5">
            {vista?.leidaEn
              ? 'Algunas aperturas no publican el resumen de ofertas.'
              : 'El proceso corre cada hora. También puedes forzarlo con "Releer apertura".'}
          </p>
          {isAdmin && vista?.diagnostico && (
            // El diagnóstico es para afinar el lector, no para que el usuario del negocio lo
            // interprete: por eso solo lo ve el admin.
            <p className="mt-2 text-[10.5px] text-zinc-400 font-mono break-all">{vista.diagnostico}</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {oferentes.map(o => {
            const exp = abierto === o.proveedorRut;
            return (
              <div key={o.proveedorRut}
                className={`rounded-xl border overflow-hidden ${o.esNuestra ? 'border-indigo-300 bg-indigo-50/40' : 'border-zinc-200 bg-white'}`}>
                <button onClick={() => setAbierto(exp ? null : o.proveedorRut)}
                  className="w-full flex items-center gap-3 px-3.5 py-3 text-left hover:bg-zinc-50/60 transition-colors">
                  {exp ? <ChevronDown size={15} className="text-zinc-400 flex-shrink-0" />
                       : <ChevronRight size={15} className="text-zinc-400 flex-shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className={`text-[13px] font-semibold truncate ${o.esNuestra ? 'text-indigo-900' : 'text-zinc-800'}`}>
                      {o.proveedorNombre}
                      {o.esNuestra && <span className="ml-1.5 text-[10.5px] font-bold text-indigo-500">NOSOTROS</span>}
                    </p>
                    <p className="text-[11px] text-zinc-400 inline-flex items-center gap-1.5">
                      <Building2 size={10} /> <span className="font-mono">{o.proveedorRut}</span>
                      {o.nombreOferta && <span className="truncate max-w-[280px]">· {o.nombreOferta}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <EstadoChip estado={o.estado} />
                    <span className="text-[11px] text-zinc-400">
                      {o.totalDocumentos > 0
                        ? `${o.documentosDescargados}/${o.totalDocumentos} docs`
                        : 'sin anexos'}
                    </span>
                    <span className="text-[13.5px] font-bold text-zinc-800 tabular-nums w-[110px] text-right">
                      {fmt(o.monto, o.moneda)}
                    </span>
                  </div>
                </button>

                {exp && (
                  <div className="px-3.5 pb-3 border-t border-zinc-100 pt-2.5">
                    {o.lineas.length > 0 && (
                      <div className="mb-2.5">
                        <p className="text-[10.5px] uppercase tracking-wide text-zinc-400 mb-1">Por línea</p>
                        {o.lineas.map(l => (
                          <p key={l.lineaNumero} className="text-[12px] text-zinc-600">
                            Línea {l.lineaNumero}: <b className="tabular-nums">{fmt(l.monto, o.moneda)}</b>
                          </p>
                        ))}
                      </div>
                    )}

                    {o.categorias.length === 0 ? (
                      <p className="text-[12px] text-zinc-400">Sin anexos publicados para este oferente.</p>
                    ) : o.categorias.map(c => {
                      const clave = `${o.proveedorRut}|${c.categoria}`;
                      const catExp = catAbierta === clave;
                      return (
                        <div key={c.categoria} className="border-t border-zinc-100 first:border-t-0">
                          <button onClick={() => setCatAbierta(catExp ? null : clave)}
                            className="w-full flex items-center gap-2 py-1.5 text-left">
                            {catExp ? <ChevronDown size={13} className="text-zinc-300" />
                                    : <ChevronRight size={13} className="text-zinc-300" />}
                            <span className="text-[12.5px] font-semibold text-zinc-700">{c.rotulo}</span>
                            <span className="text-[11px] text-zinc-400">{c.documentos.length}</span>
                          </button>
                          {catExp && (
                            <div className="pl-5 pb-2 space-y-1">
                              {c.documentos.map(d => (
                                <div key={d.id} className="flex items-center gap-2 text-[12px] text-zinc-700">
                                  <FileText size={12} className="text-zinc-300 flex-shrink-0" />
                                  <span className="truncate flex-1" title={d.descripcion || d.nombre}>{d.nombre}</span>
                                  {d.tamanoKb != null && <span className="text-[10.5px] text-zinc-400 flex-shrink-0">{peso(d.tamanoKb)}</span>}
                                  {d.url ? (
                                    <>
                                      <button onClick={() => setVisor({ nombre: d.nombre, url: d.url! })}
                                        title="Ver sin descargar"
                                        className="text-zinc-400 hover:text-indigo-600 p-1 rounded hover:bg-indigo-50 transition-colors flex-shrink-0">
                                        <Eye size={13} />
                                      </button>
                                      <a href={d.url} target="_blank" rel="noopener noreferrer" title="Descargar"
                                        className="text-zinc-400 hover:text-indigo-600 p-1 rounded hover:bg-indigo-50 transition-colors flex-shrink-0">
                                        <Download size={13} />
                                      </a>
                                    </>
                                  ) : (
                                    // Detectado pero sin copia propia: se dice por qué, en vez de
                                    // ocultarlo y que parezca que el oferente no lo presentó.
                                    <span className="text-[10.5px] text-amber-600 flex-shrink-0"
                                      title={d.error || 'Pendiente de descarga'}>
                                      {d.error ? 'no se pudo bajar' : 'pendiente'}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {isAdmin && vista?.diagnostico && oferentes.length > 0 && (
        <p className="mt-3 text-[10.5px] text-zinc-400 font-mono break-all">lector: {vista.diagnostico}</p>
      )}

      <DocumentViewerModal doc={visor} onClose={() => setVisor(null)} />
    </div>
  );
}
