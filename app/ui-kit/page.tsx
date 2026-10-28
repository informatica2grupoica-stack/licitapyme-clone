'use client';

// Página de referencia del sistema de diseño (skill licitank-ui). Cada componente de
// app/components/ui/kit/ se ve aquí en vivo. Los datos son de EJEMPLO, solo para mostrar forma.
import { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { IconPlus, IconDownload, IconFileSearch, IconRefresh } from '@tabler/icons-react';
import { AppLayout } from '@/app/components/AppLayout';
import { ESTADOS_PIPELINE } from '@/app/lib/pipeline';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Tarjeta, Datos, Dato, Estado } from '@/app/components/ui/kit/Tarjeta';
import { Lista } from '@/app/components/ui/kit/Aparecer';
import { Indicador } from '@/app/components/ui/kit/Indicador';
import { Pestanas } from '@/app/components/ui/kit/Pestanas';
import { Encabezado, Seccion, TarjetaCargando, Vacio } from '@/app/components/ui/kit/Estructura';

const FUENTES = {
  roboto: { etiqueta: 'Roboto (actual)', css: 'var(--font-roboto)' },
  inter: { etiqueta: 'Inter Tight', css: 'var(--font-inter-tight)' },
  manrope: { etiqueta: 'Manrope', css: 'var(--font-manrope)' },
} as const;
type Fuente = keyof typeof FUENTES;

// Propuesta: solo cambian las tres etapas en azul/morado/índigo. El resto se mantiene.
const ETAPA_PROPUESTA: Record<string, string> = {
  ASIGNADO: '#475569', EN_PROCESO: '#0E7490', POSIBLE_ADJ: '#4D7C0F',
};

const TOKENS = [
  ['marca', '#0f766e', 'Botones, enlaces, vista activa'],
  ['tinta', '#0f172a', 'Texto principal'],
  ['tinta-2', '#475569', 'Texto secundario'],
  ['linea', '#e2e8f0', 'Bordes y separadores'],
  ['exito', '#15803d', 'Postulada, ganada'],
  ['alerta', '#b45309', 'Cierra en 2–3 días'],
  ['urgente', '#dc2626', 'Cierra hoy o mañana'],
] as const;

const clp = (n: number) => '$' + new Intl.NumberFormat('es-CL').format(n);
const color = (id: string) => ETAPA_PROPUESTA[id] ?? ESTADOS_PIPELINE.find(e => e.id === id)?.color ?? '#64748b';

const EJEMPLOS = [
  { id: 1, codigo: '1234-56-LE26', nombre: 'ADQUISICIÓN DE MOBILIARIO ESCOLAR', organismo: 'Municipalidad de ejemplo',
    etapa: 'EN_PROCESO', etiquetaEtapa: 'En proceso', cierre: 'Hoy 15:00', urgencia: 'text-urgente', monto: 18500000, grupo: 'activas' },
  { id: 2, codigo: '2345-12-LP26', nombre: 'SUMINISTRO DE EQUIPOS COMPUTACIONALES', organismo: 'Servicio de Salud de ejemplo',
    etapa: 'ASIGNADO', etiquetaEtapa: 'Asignado', cierre: 'Jueves 30', urgencia: 'text-alerta', monto: 42300000, grupo: 'activas' },
  { id: 3, codigo: '3456-78-LE26', nombre: 'HORNOS INDUSTRIALES PARA CASINO', organismo: 'Liceo de ejemplo',
    etapa: 'POSTULADA', etiquetaEtapa: 'Postulada', cierre: 'Cerrada', urgencia: 'text-tinta-3', monto: 9800000, grupo: 'postuladas' },
  { id: 4, codigo: '4567-90-LP26', nombre: 'ARTÍCULOS DE ASEO Y LIMPIEZA', organismo: 'Hospital de ejemplo',
    etapa: 'POSIBLE_ADJ', etiquetaEtapa: 'Posible adjudicación', cierre: 'Cerrada', urgencia: 'text-tinta-3', monto: 6150000, grupo: 'postuladas' },
];

export default function UiKitPage() {
  const [fuente, setFuente] = useState<Fuente>('inter');
  const [filtro, setFiltro] = useState<'todas' | 'activas' | 'postuladas'>('todas');
  const [cargando, setCargando] = useState(false);
  useEffect(() => {
    if (!cargando) return;
    const t = setTimeout(() => setCargando(false), 1600);
    return () => clearTimeout(t);
  }, [cargando]);

  const visibles = EJEMPLOS.filter(e => filtro === 'todas' || e.grupo === filtro);

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Sistema de diseño' }]}>
      <div style={{ fontFamily: FUENTES[fuente].css }} className="max-w-6xl mx-auto px-4 sm:px-6 py-6 text-tinta dark:text-slate-100">
        <Encabezado
          titulo="Sistema de diseño"
          descripcion="Componentes y reglas que usan todas las pantallas. Los datos de esta página son de ejemplo."
          acciones={<>
            <Boton icono={<IconDownload size={16} />}>Exportar</Boton>
            <Boton variante="primario" icono={<IconPlus size={16} />}>Agregar licitación</Boton>
          </>}
        />

        <Seccion titulo="Tipografía" accion={
          <Pestanas id="fuente" valor={fuente} onCambio={setFuente}
            opciones={(Object.keys(FUENTES) as Fuente[]).map(k => ({ valor: k, etiqueta: FUENTES[k].etiqueta }))} />
        }>
          <div className="rounded-xl border border-linea bg-white p-5 shadow-tarjeta dark:bg-slate-900 dark:border-slate-800 space-y-3">
            <div className="text-[22px] font-semibold tracking-tight">Título de pantalla · Negocios en curso</div>
            <div className="text-[15px] font-semibold">Título de sección · Cierran esta semana</div>
            <p className="text-sm text-tinta-2 dark:text-slate-400 max-w-2xl">
              Texto de lectura. La licitación pide entregar en 30 días corridos desde la orden de compra,
              con garantía mínima de 12 meses y despacho incluido a la comuna.
            </p>
            <div className="flex flex-wrap items-baseline gap-6">
              <span className="text-[26px] font-semibold tracking-tight tabular-nums">$ 42.300.000</span>
              <span className="font-mono text-[13px] text-tinta-2">2345-12-LP26</span>
              <span className="text-[11px] text-tinta-2/80">Rótulo de dato</span>
            </div>
          </div>
        </Seccion>

        <Seccion titulo="Indicadores">
          <Lista className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Indicador rotulo="Licitaciones activas" valor={37} variacion={12} detalle="vs. septiembre" serie={[22, 25, 24, 29, 31, 33, 37]} />
            <Indicador rotulo="Postuladas este mes" valor={14} variacion={-6.5} detalle="vs. septiembre" serie={[18, 16, 17, 15, 15, 14]} />
            <Indicador rotulo="Monto ganado" valor={128450000} formato={clp} detalle="en 9 adjudicaciones" serie={[40, 52, 61, 70, 96, 128]} />
            <Indicador rotulo="Efectividad" valor={57} formato={n => `${n}%`} variacion={3} detalle="ganadas / postuladas" />
          </Lista>
        </Seccion>

        <Seccion titulo="Tarjetas" accion={
          <div className="flex items-center gap-2">
            <Pestanas id="filtro" valor={filtro} onCambio={setFiltro} opciones={[
              { valor: 'todas', etiqueta: 'Todas', contador: EJEMPLOS.length },
              { valor: 'activas', etiqueta: 'Activas', contador: EJEMPLOS.filter(e => e.grupo === 'activas').length },
              { valor: 'postuladas', etiqueta: 'Postuladas', contador: EJEMPLOS.filter(e => e.grupo === 'postuladas').length },
            ]} />
            <Boton variante="fantasma" tamano="sm" icono={<IconRefresh size={15} />} onClick={() => setCargando(true)}>Simular carga</Boton>
          </div>
        }>
          {cargando ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[0, 1, 2].map(i => <TarjetaCargando key={i} />)}
            </div>
          ) : (
            <Lista className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <AnimatePresence initial={false}>
                {visibles.map(e => (
                    <Tarjeta key={e.id} layout tinte={color(e.etapa)} onClick={() => {}}>
                      <div className="flex items-start justify-between gap-3">
                        <span className="font-mono text-xs text-tinta-2 dark:text-slate-400">{e.codigo}</span>
                        <span className={`text-xs font-medium tabular-nums ${e.urgencia}`}>{e.cierre}</span>
                      </div>
                      <h3 className="mt-1.5 text-sm font-medium leading-snug line-clamp-2">{e.nombre}</h3>
                      <p className="mt-0.5 text-xs text-tinta-2 dark:text-slate-400 truncate">{e.organismo}</p>
                      <Datos>
                        <Dato rotulo="Etapa"><Estado color={color(e.etapa)}>{e.etiquetaEtapa}</Estado></Dato>
                        <Dato rotulo="Monto estimado">{clp(e.monto)}</Dato>
                      </Datos>
                    </Tarjeta>
                ))}
              </AnimatePresence>
            </Lista>
          )}
        </Seccion>

        <Seccion titulo="Botones">
          <div className="flex flex-wrap items-center gap-2">
            <Boton variante="primario">Guardar cambios</Boton>
            <Boton>Cancelar</Boton>
            <Boton variante="fantasma">Ver detalle</Boton>
            <Boton variante="peligro">Descartar</Boton>
            <Boton variante="primario" disabled>Deshabilitado</Boton>
            <Boton tamano="sm" icono={<IconDownload size={15} />}>Pequeño</Boton>
          </div>
        </Seccion>

        <Seccion titulo="Colores">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-linea bg-white p-4 shadow-tarjeta dark:bg-slate-900 dark:border-slate-800">
              <div className="text-[13px] font-medium mb-3">Colores del sistema</div>
              <ul className="space-y-2">
                {TOKENS.map(([nombre, hex, uso]) => (
                  <li key={nombre} className="flex items-center gap-3 text-[13px]">
                    <span className="w-7 h-7 rounded-md border border-black/5" style={{ background: hex }} />
                    <span className="font-mono text-xs w-16">{nombre}</span>
                    <span className="text-tinta-2 dark:text-slate-400">{uso}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-linea bg-white p-4 shadow-tarjeta dark:bg-slate-900 dark:border-slate-800">
              <div className="text-[13px] font-medium mb-1">Etapas: actual → propuesta</div>
              <p className="text-xs text-tinta-2 dark:text-slate-400 mb-3">Solo cambian las tres que hoy son azul, morado e índigo. No aplicado todavía.</p>
              <ul className="space-y-1.5">
                {ESTADOS_PIPELINE.map(e => (
                  <li key={e.id} className="flex items-center gap-3 text-[13px]">
                    <span className="w-4 h-4 rounded" style={{ background: e.color }} />
                    <span className="text-tinta-3">→</span>
                    <span className="w-4 h-4 rounded" style={{ background: ETAPA_PROPUESTA[e.id] ?? e.color }} />
                    <span className={ETAPA_PROPUESTA[e.id] ? 'font-medium' : 'text-tinta-2 dark:text-slate-400'}>{e.label.charAt(0) + e.label.slice(1).toLowerCase()}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Seccion>

        <Seccion titulo="Estado vacío">
          <Vacio icono={<IconFileSearch size={28} stroke={1.5} />} titulo="No hay licitaciones con estos filtros"
            texto="Prueba quitando la región o ampliando el rango de fechas de cierre."
            accion={<Boton tamano="sm">Limpiar filtros</Boton>} />
        </Seccion>
      </div>
    </AppLayout>
  );
}
