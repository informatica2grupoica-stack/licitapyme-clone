'use client';
// app/components/DocumentosCompetencia.tsx
// Pestaña "Documentos de Competencia" (Negocios · Resultado, junto a "Competencia"): los documentos
// de cada oferente tal cual los ordena el Cuadro de ofertas de Mercado Público.
// Arriba: desplegable de selección múltiple con los oferentes de la licitación (incluida nuestra
// empresa, marcada "Nosotros"). Abajo, a todo el ancho: cada oferente seleccionado en modo cuadro,
// una columna por tipo de anexo (administrativos · técnicos · económicos). Un oferente puede no
// haber cargado alguno: el cuadro lo dice, no se oculta.
// Son archivos que el cron ya bajó a nuestro almacenamiento; acá solo se ven (ojo), no se descargan
// a la máquina del usuario. La sub-pestaña "Analizar con IA" es solo la vista: la petición al
// modelo se conecta cuando esté definido el prompt. Nuestra oferta no entra al análisis.
// Lee lo mismo que la pestaña Competencia (/api/postuladas/ofertas).

import { useEffect, useState } from 'react';
import { IconLoader2 as Loader2, IconFileText as FileText, IconEye as Eye, IconAlertTriangle as AlertTriangle, IconFolders as Folders, IconSparkles as Sparkles, IconUsers as Users } from '@tabler/icons-react';
import { DocumentViewerModal, type VisorDoc } from '@/app/components/DocumentViewerModal';
import { SeccionTabs } from '@/app/components/MenuNegocioLateral';
import { MultiSelect } from '@/app/components/ui/MultiSelect';

interface DocumentoVista { id: number; nombre: string; descripcion: string | null; tamanoKb: number | null; url: string | null; error: string | null }
interface CategoriaVista { categoria: string; rotulo: string; documentos: DocumentoVista[] }
interface OferenteVista {
  proveedorRut: string; proveedorNombre: string; nombreOferta: string | null; estado: string | null;
  monto: number | null; moneda: string | null; esNuestra: boolean; categorias: CategoriaVista[];
  totalDocumentos: number; documentosDescargados: number;
}

const COLUMNAS_ARCHIVOS: { clave: string; rotulo: string }[] = [
  { clave: 'ADMINISTRATIVOS', rotulo: 'Anexos administrativos' },
  { clave: 'TECNICOS',        rotulo: 'Anexos técnicos' },
  { clave: 'ECONOMICOS',      rotulo: 'Anexos económicos' },
];

const fmtMonto = (n: number | null, moneda: string | null) =>
  n == null ? '—' : moneda && moneda !== 'CLP' ? `${n.toLocaleString('es-CL')} ${moneda}` : `$${n.toLocaleString('es-CL')}`;
const peso = (kb: number | null) => kb == null ? '' : kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;

export default function DocumentosCompetencia({ codigo }: { codigo: string }) {
  const [oferentes, setOferentes] = useState<OferenteVista[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visor, setVisor] = useState<VisorDoc | null>(null);
  const [vista, setVista] = useState<'documentos' | 'ia'>('documentos');
  const [seleccion, setSeleccion] = useState<string[]>([]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await fetch(`/api/postuladas/ofertas?codigo=${encodeURIComponent(codigo)}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error || 'No se pudieron cargar los oferentes');
        if (!vivo) return;
        const lista: OferenteVista[] = d.oferentes || [];
        setOferentes(lista);
        setSeleccion(lista.map(o => o.proveedorRut));   // de entrada se ven todos
      } catch (e) {
        if (vivo) setError(String((e as Error).message || e));
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => { vivo = false; };
  }, [codigo]);

  if (cargando) {
    return <p className="text-[12.5px] text-zinc-400 inline-flex items-center gap-1.5 py-6"><Loader2 size={13} className="animate-spin" /> Cargando documentos de la competencia…</p>;
  }

  // En el orden de la lista (nuestra oferta primero), no en el orden en que se marcaron.
  const elegidos = oferentes.filter(o => seleccion.includes(o.proveedorRut));

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-bold text-zinc-800 inline-flex items-center gap-2">
            <Folders size={16} className="text-indigo-600" /> Documentos de Competencia
          </h2>
          <p className="text-[12px] text-zinc-500 mt-0.5">
            Lo que presentó cada oferente en el Cuadro de ofertas de Mercado Público, ordenado por oferente.
          </p>
        </div>
        {oferentes.length > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-zinc-500">{elegidos.length} de {oferentes.length} oferente(s)</span>
            <MultiSelect
              label="Oferentes"
              icon={<Users size={14} />}
              minWidth={340}
              align="right"
              seleccionarTodos
              options={oferentes.map(o => ({
                value: o.proveedorRut,
                label: `${o.proveedorNombre}${o.esNuestra ? ' (Nosotros)' : ''} · ${o.proveedorRut}`,
              }))}
              selected={seleccion}
              onChange={setSeleccion}
            />
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-1.5 text-[12.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
          <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}

      {oferentes.length === 0 && !error && (
        <p className="text-[12.5px] text-zinc-500 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 px-4 py-8 text-center">
          Todavía no hay ofertas leídas para esta licitación.
        </p>
      )}

      {oferentes.length > 0 && (
        <>
          <SeccionTabs
            items={[
              { key: 'documentos', label: 'Documentos' },
              { key: 'ia', label: 'Analizar con IA', count: elegidos.filter(o => !o.esNuestra).length },
            ]}
            activo={vista}
            onSelect={k => setVista(k as 'documentos' | 'ia')}
          />

          {vista === 'documentos' && (
            elegidos.length === 0 ? (
              <p className="text-[12.5px] text-zinc-500 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 px-4 py-8 text-center">
                Selecciona uno o más oferentes en el desplegable para ver sus documentos.
              </p>
            ) : (
              <div className="space-y-4">
                {elegidos.map(o => <CuadroOferente key={o.proveedorRut} o={o} onVer={setVisor} />)}
              </div>
            )
          )}
          {vista === 'ia' && <AnalisisIA elegidos={elegidos.filter(o => !o.esNuestra)} />}
        </>
      )}

      <DocumentViewerModal doc={visor} onClose={() => setVisor(null)} />
    </div>
  );
}

// Un oferente en modo cuadro: una columna por tipo de anexo.
function CuadroOferente({ o, onVer }: { o: OferenteVista; onVer: (d: VisorDoc) => void }) {
  return (
    <section className={`rounded-xl border overflow-hidden ${o.esNuestra ? 'border-indigo-300 bg-indigo-50/40' : 'border-zinc-200 bg-white'}`}>
      <header className="flex items-center gap-3 px-3.5 py-3 border-b border-zinc-100">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-zinc-800 truncate">
            {o.proveedorNombre}
            {o.esNuestra && <span className="ml-1.5 text-[10.5px] font-bold text-indigo-500">NOSOTROS</span>}
          </p>
          <p className="text-[11px] text-zinc-400 truncate"><span className="font-mono">{o.proveedorRut}</span>{o.nombreOferta ? ` · ${o.nombreOferta}` : ''}</p>
        </div>
        {o.estado && <span className="text-[10.5px] font-semibold rounded-full px-2 py-0.5 border text-emerald-700 bg-emerald-50 border-emerald-200">{o.estado}</span>}
        <span className="text-[13.5px] font-bold tabular-nums text-zinc-800">{fmtMonto(o.monto, o.moneda)}</span>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 p-3.5">
        {COLUMNAS_ARCHIVOS.map(col => {
          const docs = o.categorias.find(c => c.categoria === col.clave)?.documentos || [];
          return (
            <div key={col.clave} className="rounded-lg border border-zinc-200 bg-white min-w-0">
              <p className="px-3 py-2 border-b border-zinc-100 bg-zinc-50 text-[12px] font-semibold text-zinc-600 rounded-t-lg">
                {col.rotulo} <span className="font-normal text-zinc-400">{docs.length || ''}</span>
              </p>
              <div className="p-2 space-y-1">
                {docs.length === 0 ? <p className="text-[12px] text-zinc-400 px-1 py-1">No cargó documentos</p> : docs.map(d => (
                  <div key={d.id} className="flex items-center gap-2 text-[12px] text-zinc-700 px-1">
                    <FileText size={12} className="text-zinc-300 flex-shrink-0" />
                    <span className="truncate flex-1" title={d.descripcion || d.nombre}>{d.nombre}</span>
                    {d.tamanoKb != null && <span className="text-[10.5px] text-zinc-400 flex-shrink-0">{peso(d.tamanoKb)}</span>}
                    {d.url ? (
                      <button onClick={() => onVer({ nombre: d.nombre, url: d.url! })} title="Ver sin descargar" aria-label={`Ver ${d.nombre}`}
                        className="text-zinc-400 hover:text-indigo-600 p-1 rounded hover:bg-indigo-50 flex-shrink-0"><Eye size={13} /></button>
                    ) : (
                      <span className="text-[10.5px] text-amber-600 flex-shrink-0" title={d.error || 'Pendiente de descarga'}>{d.error ? 'no se pudo bajar' : 'pendiente'}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Vista de "Analizar con IA". Solo la interfaz: el prompt y la petición al modelo se conectan después.
function AnalisisIA({ elegidos }: { elegidos: OferenteVista[] }) {
  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-zinc-200 bg-white p-3.5">
        <p className="text-[12.5px] font-semibold text-zinc-700 mb-2">Oferentes a analizar</p>
        {elegidos.length === 0 ? (
          <p className="text-[12px] text-zinc-400">Selecciona uno o más oferentes de la competencia en el desplegable de Oferentes.</p>
        ) : (
          <ul className="space-y-1">
            {elegidos.map(o => (
              <li key={o.proveedorRut} className="flex items-center gap-2 text-[12px] text-zinc-700">
                <span className="truncate flex-1">{o.proveedorNombre} <span className="font-mono text-zinc-400">{o.proveedorRut}</span></span>
                <span className="text-[11px] text-zinc-400 flex-shrink-0">{o.documentosDescargados}/{o.totalDocumentos} documentos disponibles</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex justify-end">
          <button disabled title="Disponible cuando se defina el prompt de análisis"
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white bg-indigo-600 px-3 py-1.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed">
            <Sparkles size={13} /> Analizar con IA
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 px-4 py-8 text-center">
        <p className="text-[12.5px] text-zinc-500">El resultado del análisis aparecerá aquí.</p>
        <p className="text-[11.5px] text-zinc-400 mt-1">Pendiente: definir el prompt de análisis.</p>
      </section>
    </div>
  );
}
