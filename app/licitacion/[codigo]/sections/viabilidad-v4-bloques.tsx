'use client';

// Cabecera, datos clave y "Cómo ganar" de la vista v4 (Tailwind, mismo lenguaje que StatCard/Badge de la app).
// Movimiento: entrada escalonada y números que cuentan (framer-motion + useContador); respeta "reducir movimiento".
// Solo presentación: los datos y las reglas siguen viniendo del informe.

import { useId, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { IconAlertTriangle as AlertTriangle, IconBan as Ban, IconCompass as Compass, IconChevronDown as ChevronDown, IconCheck as Check, IconClock as Clock, IconTrophy as Trophy, IconX as X, IconArrowRight as ArrowRight, IconBulb as Bulb, IconWallet as Wallet, IconGavel as Gavel, IconTrendingUp as TrendingUp, IconTrendingDown as TrendingDown, IconEqual as Equal, IconPackage as Package, IconClipboardCheck as ClipboardCheck, IconSearch as Search, IconShieldCheck as ShieldCheck, IconPencil as Pencil, IconQuote as Quote, IconScale as Scale, IconTarget as Target, IconListCheck as ListChecks, IconHelpCircle as HelpCircle } from '@tabler/icons-react';
import { useContador } from '@/app/lib/use-contador';
import { BotonBuscarEquipo, BotonProductoReferencia } from './viabilidad-ui-comun';
import { Cita, FraseCitada, _norm, EVIDENCIA_TEXTO, NIVEL_VISTA, PERIODO, cap, fmt, mayus, oracion, sinCA, valorMulta } from './viabilidad-v4-comun';

const ACCION: Record<string, { cls: string; icono: React.ReactNode }> = {
  SEGUIR:         { cls: 'text-emerald-800 bg-emerald-100 border-emerald-300', icono: <Check size={15} /> },
  CONSULTAR_CA:   { cls: 'text-yellow-800 bg-yellow-100 border-yellow-300',   icono: <HelpCircle size={15} /> },
  SOLTAR:         { cls: 'text-red-800 bg-red-100 border-red-300',            icono: <Ban size={15} /> },
  REVISAR_SALIDA: { cls: 'text-orange-800 bg-orange-100 border-orange-300',   icono: <Compass size={15} /> },
  CONFIRMAR_DATO: { cls: 'text-sky-800 bg-sky-100 border-sky-300',            icono: <HelpCircle size={15} /> },
};

type Variante = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
export const CLASE: Record<string, { label: string; variante: Variante; tip: string; ley?: boolean }> = {
  LEY_DEL_MINIMO: { label: 'Ley del mínimo', variante: 'success', ley: true, tip: 'Gana quien oferte el valor más bajo: cada unidad de mejora suma puntaje.' },
  LEY_DEL_MAXIMO: { label: 'Ley del máximo', variante: 'success', ley: true, tip: 'Gana quien oferte el valor más alto: cada unidad de mejora suma puntaje.' },
  POR_TRAMOS:     { label: 'Por tramos',     variante: 'default', tip: 'El puntaje va por rangos: basta con quedar en el mejor tramo.' },
  ACUMULATIVO:    { label: 'Acumulativo',    variante: 'primary', tip: 'Suma puntos por cada requisito que se cumple: cumple el máximo posible.' },
  BINARIO:        { label: 'Cumple o no',    variante: 'info',    tip: 'Se cumple o no se cumple: no hay puntaje intermedio.' },
};
// Colores de la jugada: el color va en el ícono y el rótulo; la tarjeta es neutra (skill licitank-ui).
const JUGADA: Record<string, { label: string; icono: React.ReactNode; color: string }> = {
  OPORTUNIDAD: { label: 'Oportunidad: aquí se gana',       icono: <TrendingUp size={16} />,   color: '#047857' },
  RESOLVER:    { label: 'Por resolver antes de ofertar',   icono: <HelpCircle size={16} />,   color: '#b45309' },
  EMPATE:      { label: 'Empate: todos parten igual',      icono: <Equal size={16} />,        color: '#64748b' },
  EN_CONTRA:   { label: 'En contra: nos juega en contra',  icono: <TrendingDown size={16} />, color: '#dc2626' },
};
// Serie de colores de los criterios: teal, pizarra, ámbar, cian, verde, naranja, rosa, piedra (sin morados).
const COLOR_CRITERIO = [
  { hex: '#0f766e', barra: 'bg-teal-700' },
  { hex: '#475569', barra: 'bg-slate-600' },
  { hex: '#d97706', barra: 'bg-amber-600' },
  { hex: '#0891b2', barra: 'bg-cyan-600' },
  { hex: '#16a34a', barra: 'bg-green-600' },
  { hex: '#ea580c', barra: 'bg-orange-600' },
  { hex: '#db2777', barra: 'bg-pink-600' },
  { hex: '#78716c', barra: 'bg-stone-500' },
];

// ─── Movimiento ────────────────────────────────────────────────────────────────────────────
function Aparece({ i = 0, children, alto }: { i?: number; children: React.ReactNode; alto?: boolean }) {
  const reducido = useReducedMotion();
  return (
    <motion.div className={alto ? 'h-full min-w-0' : undefined} initial={reducido ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(i, 10) * 0.04, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  );
}
function Pct({ valor }: { valor: number }) { return <>{Math.round(useContador(valor))}</>; }
function Contado({ valor }: { valor: number }) { return <>{fmt(Math.round(useContador(valor)))}</>; }

// "Texto (detalle largo): resto" → { corto: "Texto: resto", detalle } — soporta paréntesis anidados.
function partirAviso(a: string) {
  const i = a.indexOf('('), j = a.lastIndexOf(')');
  if (i <= 0 || j <= i) return { corto: a, detalle: '' };
  return { corto: (a.slice(0, i).trimEnd() + a.slice(j + 1)).replace(/\s+([:.,;])/g, '$1').trim(), detalle: a.slice(i + 1, j).trim() };
}
function Aviso({ texto }: { texto: string }) {
  const [abierto, setAbierto] = useState(false);
  const { corto, detalle } = partirAviso(sinCA(texto));
  return (
    <li className="text-[12.5px] text-amber-800 leading-snug">
      <AlertTriangle size={13} className="inline -mt-0.5 mr-1 text-amber-500" />{mayus(corto)}
      {detalle && <button type="button" onClick={() => setAbierto(v => !v)} className="ml-1.5 text-[12px] font-semibold text-marca hover:underline">{abierto ? 'Ocultar motivo' : 'Ver motivo'}</button>}
      {detalle && abierto && <span className="block mt-0.5 text-slate-600">{mayus(detalle)}</span>}
    </li>
  );
}

// ─── Cabecera: nivel + acción + porqué ─────────────────────────────────────────────────────
// Estilo bento (skill licitank-ui), igual que la viabilidad del Resumen del negocio: el color del
// nivel va en el texto y en un medidor de 7 tramos, nunca en un bloque sólido.
const ESCALA_NIVEL = ['EXCLUIDO', 'BAJO', 'MEDIO_BAJO', 'MEDIO', 'MEDIO_ALTO', 'ALTO', 'MUY_ALTO'];
const tonoNivel = (cls: string) => cls.includes('emerald') ? '#047857' : cls.includes('yellow') ? '#b45309'
  : cls.includes('orange') ? '#c2410c' : cls === 'bg-red-700' ? '#b91c1c' : cls.includes('red') ? '#dc2626' : '#64748b';
const CAJA_V4 = 'rounded-2xl border border-linea bg-white shadow-tarjeta dark:bg-slate-900 dark:border-slate-800';

export function CabeceraV4({ s, t, enRevision, esCA }: { s: any; t: any; enRevision: boolean; esCA: boolean }) {
  const [verDesglose, setVerDesglose] = useState(false);
  const reducido = useReducedMotion();
  const nv = NIVEL_VISTA[s.nivel] || NIVEL_VISTA.MEDIO;
  const ac = ACCION[s.accion_asistente] || ACCION.CONSULTAR_CA;
  const avisos: string[] = Array.isArray(s.avisos) ? s.avisos : [];
  const color = tonoNivel(nv.cls);
  const tramos = ESCALA_NIVEL.indexOf(s.nivel) + 1;
  return (
    <Aparece>
      <section className={`${CAJA_V4} p-5`}>
        <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
          <div className="min-w-[200px]">
            <p className="text-[13px] text-tinta-2 dark:text-slate-400">Nivel de atractivo</p>
            <p title={nv.tip} className="mt-1.5 text-[30px] font-semibold tracking-tight leading-none cursor-help" style={{ color }}>{mayus(nv.label.toLowerCase())}</p>
            <div className="mt-3 grid grid-cols-7 gap-1" aria-hidden>
              {ESCALA_NIVEL.map((_, k) => (
                <motion.span key={k} className={`h-1.5 rounded-full ${k < tramos ? '' : 'bg-slate-100 dark:bg-slate-800'}`} style={k < tramos ? { background: color } : undefined}
                  initial={reducido ? false : { opacity: 0, scaleX: 0.4 }} animate={{ opacity: 1, scaleX: 1 }}
                  transition={{ duration: 0.25, delay: 0.15 + k * 0.04, ease: [0.22, 1, 0.36, 1] }} />
              ))}
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] text-slate-400"><span>Excluido</span><span>Muy alto</span></div>
          </div>
          <div className="flex-1 min-w-[260px] space-y-2">
            <div className="flex items-center gap-x-4 gap-y-1 flex-wrap">
              <span className={`inline-flex items-center gap-1.5 text-[15px] font-semibold ${ac.cls.split(' ')[0]}`}>{ac.icono} {mayus(sinCA(s.accion_texto)) || '—'}</span>
              <span title={enRevision ? 'Una persona debe revisar el informe antes de decidir' : 'Análisis firme'}
                className="ml-auto inline-flex items-center gap-1.5 text-xs text-tinta-2 dark:text-slate-400 cursor-help">
                <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${enRevision ? 'bg-amber-500' : 'bg-emerald-500'}`} />{enRevision ? 'Revisión humana' : 'Definitivo'}
              </span>
            </div>
            {s.resumen_pantalla && <p className="text-sm font-medium text-tinta dark:text-slate-100 leading-snug">{String(s.resumen_pantalla).replace(/^[A-ZÁÉÍÓÚ ]+ · /, '').split(' · ').map(mayus).join(' · ')}</p>}
            {t.titular && <p className="text-[13px] text-tinta-2 dark:text-slate-400 leading-snug">{mayus(sinCA(t.titular))}</p>}
            {s.motivo_exclusion && (
              <div className="text-[13px] text-red-900 bg-red-50/80 rounded-xl px-3.5 py-2.5 dark:bg-red-950/40 dark:text-red-200">
                <p><span className="font-medium">Motivo:</span> {s.motivo_exclusion.texto}</p>
                <FraseCitada cita={s.motivo_exclusion.cita} />
                <Cita cita={s.motivo_exclusion.cita} />
              </div>
            )}
            {avisos.length > 0 && <ul className="space-y-1">{avisos.map((a, i) => <Aviso key={i} texto={a} />)}</ul>}
            {esCA && (s.pasos?.length ?? 0) > 0 && (
              <div>
                <button onClick={() => setVerDesglose(v => !v)} className="text-xs font-medium text-marca hover:text-marca-fuerte inline-flex items-center gap-1">
                  <ChevronDown size={13} className={`transition-transform ${verDesglose ? 'rotate-180' : ''}`} /> Desglose del nivel (solo admin)
                </button>
                {verDesglose && (
                  <div className="mt-1.5 bg-slate-50 rounded-xl p-3 space-y-0.5 dark:bg-slate-800/60">
                    {s.pasos.map((p: any, i: number) => <p key={i} className="text-xs text-tinta-2 dark:text-slate-400"><span className="font-medium text-tinta dark:text-slate-200">{p.regla}</span> · {p.efecto} · {p.dato}</p>)}
                    <p className="text-[11px] text-slate-400 pt-1">Reglas {s.version_reglas} · calculado {s.calculado_en ? new Date(s.calculado_en).toLocaleString('es-CL') : ''}{s.supuesto_no_claro ? ` · supuesto: ${s.supuesto_no_claro === 'GLOBAL' ? 'global' : 'por línea'}` : ''}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </Aparece>
  );
}

// ─── Datos clave: 4 bloques iguales (bento, skill licitank-ui) ─────────────────────────────
function TarjetaClave({ i, etiqueta, icono, color, alerta, titulo, valor, numero, formato, unidad, clave, texto, textoClase, pie, children }: {
  i: number; etiqueta: string; icono: React.ReactNode; color: string; alerta?: boolean; titulo?: string; valor: string;
  numero?: number; formato?: (n: number) => string; unidad?: string;
  clave?: React.ReactNode; texto?: string; textoClase?: string; pie?: React.ReactNode; children?: React.ReactNode;
}) {
  const animado = useContador(numero ?? 0);
  const visible = numero != null && formato ? formato(Math.round(animado)) : valor;
  const clsValor = valor.length > 13 ? 'text-[19px]' : valor.length > 10 ? 'text-[22px]' : 'text-[26px]';
  return (
    <Aparece i={i} alto>
      <div title={titulo} className={`relative min-w-0 rounded-2xl border h-full flex flex-col break-words bg-white shadow-tarjeta dark:bg-slate-900 ${alerta ? 'border-red-200 dark:border-red-900' : 'border-linea dark:border-slate-800'}`}>
        <div className="flex flex-col gap-2.5 p-5 flex-1">
          <p className="flex items-center gap-2 text-[13px] text-tinta-2 dark:text-slate-400">
            <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: color + '14', color }}>{icono}</span>{etiqueta}
          </p>
          <p className={`${clsValor} font-semibold tracking-tight leading-tight tabular-nums text-tinta dark:text-slate-50`}>{visible}{unidad ? <span className="text-xs font-medium text-tinta-2"> {unidad}</span> : null}</p>
          {clave && <div>{clave}</div>}
          {texto && <p className={`text-[12.5px] leading-snug ${textoClase || 'text-tinta-2 dark:text-slate-400'}`}>{texto}</p>}
          {children}
        </div>
        {pie && <div className={`px-5 py-3 border-t ${alerta ? 'border-red-100 dark:border-red-900' : 'border-linea/80 dark:border-slate-800'}`}>{pie}</div>}
      </div>
    </Aparece>
  );
}

// Dato corto con punto de color (reemplaza las pastillas de las tarjetas clave).
function Marca({ color, children }: { color: string; children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-tinta dark:text-slate-200"><span aria-hidden className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />{children}</span>;
}

// Tope por línea: con pocas líneas, a la vista; con muchas (2446-307-LE26 trae 44), plegado en una lista compacta.
function PresupuestoPorLinea({ lineas }: { lineas: any[] }) {
  const [abierto, setAbierto] = useState(false);
  const fila = (l: any) => <li key={l.linea} className="flex justify-between gap-2 text-[11.5px] tabular-nums"><span className="font-bold text-slate-800">{l.linea}</span><span className="text-slate-600">{fmt(l.monto_pesos)}</span></li>;
  if (lineas.length <= 6) return <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5">{lineas.map(fila)}</ul>;
  return (
    <div>
      <button type="button" onClick={() => setAbierto(v => !v)} className="text-[12px] font-semibold text-marca inline-flex items-center gap-1">
        <ChevronDown size={12} className={`transition-transform ${abierto ? 'rotate-180' : ''}`} /> Tope por línea ({lineas.length} líneas)
      </button>
      {abierto && <ul className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 max-h-48 overflow-y-auto pr-1">{lineas.map(fila)}</ul>}
    </div>
  );
}

export function TarjetasClaveV4({ informe, onVerPlazos }: { informe: any; onVerPlazos: () => void }) {
  const pres = informe.presupuesto || {};
  const adj = informe.adjudicacion || {};
  const pp = informe.plazos?.plazo_previo || null;
  const hitos: any[] = Array.isArray(informe.plazos?.hitos) ? informe.plazos.hitos : [];
  const atraso = informe.multas?.atraso || null;
  const porLinea: any[] = Array.isArray(pres.por_linea_interpretado) ? pres.por_linea_interpretado : [];
  const evidencia = (Array.isArray(adj.evidencias) ? adj.evidencias : []).filter((e: any) => e?.cuenta).find((e: any) => e?.cita?.frase) || null;
  const excluyente = pres.caracter === 'EXCLUYENTE';
  const dias = pp ? Number(pp.total_dias_corridos) : null;
  const sinPlazo = !!pp && dias === 0;
  const plazoNoExigido = hitos.length > 0 && hitos.every(h => String(h.estado || '').toUpperCase() === 'NO_EXISTE');
  const multaDia = atraso?.calculo?.pesos_dia_estimado;
  const hayMulta = atraso?.existe !== false && (multaDia != null || atraso?.valor);
  const prefijoPlazo = pp?.al_menos ? 'Al menos ' : '';
  const enlace = (txt: string) => <button type="button" onClick={onVerPlazos} className="text-[13px] font-medium text-marca hover:text-marca-fuerte">{txt} →</button>;
  return (
    <div className="grid grid-cols-1 @xl:grid-cols-2 @6xl:grid-cols-4 gap-3 items-stretch">
      <TarjetaClave i={0} etiqueta="Presupuesto" icono={<Wallet size={16} />} color={excluyente ? '#dc2626' : '#047857'} alerta={excluyente}
        valor={pres.bruto ? fmt(pres.bruto) : 'No publicado'} numero={pres.bruto ? Number(pres.bruto) : undefined} formato={fmt} unidad={pres.bruto && !pres.regimen_fora ? 'IVA incl.' : undefined}
        clave={excluyente
          ? <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-urgente"><Ban size={14} /> Excluyente</span>
          : <Marca color="#94a3b8">{mayus(cap(pres.caracter || 'NO_DECLARADO').toLowerCase())}</Marca>}
        texto={excluyente ? 'Si lo superas, tu oferta queda fuera de la licitación.' : pres.nota_art_32 ? mayus(pres.nota_art_32) : 'Las bases no declaran si superarlo deja fuera la oferta.'}
        textoClase={excluyente ? 'text-red-700 font-medium dark:text-red-300' : undefined}
        pie={pres.cita ? <Cita cita={pres.cita} compacta /> : undefined}>
        {porLinea.length >= 2 && <PresupuestoPorLinea lineas={porLinea} />}
      </TarjetaClave>
      <TarjetaClave i={1} etiqueta="Cómo se adjudica" icono={<Gavel size={16} />} color={adj.resultado === 'NO_CLARO' ? '#d97706' : '#0f766e'} alerta={false}
        valor={adj.resultado === 'POR_LINEAS' ? 'Por línea' : adj.resultado === 'GLOBAL' ? 'Global' : 'No está claro'}
        clave={adj.cotizar_100_texto ? <Marca color="#0f766e">{mayus(adj.cotizar_100_texto)}</Marca> : undefined}
        texto={evidencia ? `Las bases dicen que ${EVIDENCIA_TEXTO[evidencia.tipo] || cap(evidencia.tipo).toLowerCase()}.`
          : adj.resultado === 'GLOBAL' ? 'Todo se adjudica a un solo proveedor.'
          : adj.resultado === 'POR_LINEAS' ? 'Se puede ganar una o más líneas por separado.'
          : 'Confírmalo en las bases antes de decidir.'}
        pie={evidencia ? <Cita cita={evidencia.cita} compacta /> : undefined}>
        {adj.regla_aplicada === 'CONFIRMADA' && adj.motivo && <p className="text-[12.5px] text-tinta-2 dark:text-slate-400">{mayus(adj.motivo)}</p>}
      </TarjetaClave>
      <TarjetaClave i={2} etiqueta="Plazo previo" icono={<Clock size={16} />} color="#0891b2" titulo="Tiempo administrativo entre la adjudicación y el inicio del plazo de entrega"
        valor={!pp ? '—' : sinPlazo ? 'Sin plazo previo' : `${prefijoPlazo}${dias} días`}
        numero={pp && !sinPlazo ? dias! : undefined} formato={n => `${prefijoPlazo}${n} días`}
        clave={pp ? <Marca color={sinPlazo ? '#94a3b8' : '#0891b2'}>{sinPlazo ? (plazoNoExigido ? 'Las bases no lo exigen' : 'No indicado en las bases') : 'Días corridos'}</Marca> : undefined}
        texto="Desde que se adjudica hasta que parte el plazo de entrega."
        pie={enlace('Ver plazos')} />
      <TarjetaClave i={3} etiqueta="Multa por atraso" icono={<AlertTriangle size={16} />} color="#d97706"
        valor={atraso?.existe === false ? 'No hay' : multaDia != null ? `≈ ${fmt(multaDia)}` : atraso?.valor ? valorMulta(atraso) : '—'}
        numero={atraso?.existe !== false && multaDia != null ? Number(multaDia) : undefined} formato={n => `≈ ${fmt(n)}`}
        clave={hayMulta ? <Marca color="#d97706">Por {PERIODO[String(atraso?.periodo || '').toUpperCase()] || 'día'} de atraso</Marca> : undefined}
        texto={atraso?.existe === false ? 'Las bases no establecen multa por atraso.' : atraso?.calculo?.nota ? mayus(atraso.calculo.nota) : 'Se descuenta por cada día de atraso.'}
        pie={enlace('Ver detalle')} />
    </div>
  );
}

// ─── Cómo ganar ────────────────────────────────────────────────────────────────────────────
function Bloque({ i, icon, titulo, subtitulo, derecha, children }: { i: number; icon: React.ReactNode; titulo: string; subtitulo?: string; derecha?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Aparece i={i}>
      <section className={`${CAJA_V4} p-5`}>
        <div className="flex items-start gap-3 mb-4">
          <span className="flex-shrink-0 w-9 h-9 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center dark:bg-slate-800 dark:text-slate-400">{icon}</span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[16px] font-semibold tracking-tight text-tinta dark:text-slate-50 leading-tight">{titulo}</h3>
            {subtitulo && <p className="text-[13px] text-tinta-2 dark:text-slate-400 mt-0.5">{subtitulo}</p>}
          </div>
          {derecha}
        </div>
        {children}
      </section>
    </Aparece>
  );
}

// Marca de la ley de puntaje (ley del mínimo / del máximo): es la clave para ganar, va resaltada.
function MarcaLey({ clase }: { clase: { label: string; tip: string } }) {
  return (
    <span title={clase.tip} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-100 px-2 py-0.5 text-[13px] font-semibold text-emerald-900 cursor-help dark:bg-emerald-900/50 dark:text-emerald-200">
      <Trophy size={14} />{clase.label}
    </span>
  );
}

// Clase del criterio: la ley resaltada en verde; las demás (por tramos, cumple o no…) como marca gris.
function ClaseCriterio({ clase }: { clase: { label: string; tip: string; ley?: boolean } }) {
  if (clase.ley) return <MarcaLey clase={clase} />;
  return (
    <span title={clase.tip} className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[13px] font-medium text-tinta dark:bg-slate-800 dark:text-slate-200 cursor-help">{clase.label}</span>
  );
}

// «Gana quien oferte el valor más bajo: cada unidad…» → la frase antes de los dos puntos va en negrita.
function TipNegrita({ tip }: { tip: string }) {
  const i = tip.indexOf(':');
  if (i < 0) return <strong className="font-semibold text-tinta dark:text-slate-50">{tip}</strong>;
  return <><strong className="font-semibold text-tinta dark:text-slate-50">{tip.slice(0, i)}</strong>{tip.slice(i)}</>;
}

// Cómo se puntúa / cómo se gana: el dato más importante de un criterio, siempre visible y marcado.
function ComoPuntua({ cl }: { cl: { tip: string; ley?: boolean } }) {
  return (
    <div className={`rounded-lg px-3.5 py-2.5 ${cl.ley ? 'bg-emerald-100/70 dark:bg-emerald-900/30' : 'bg-marca-suave dark:bg-teal-950/30'}`}>
      <p className={`text-[13px] font-semibold ${cl.ley ? 'text-emerald-800 dark:text-emerald-300' : 'text-teal-800 dark:text-teal-300'}`}>{cl.ley ? 'Cómo se gana' : 'Cómo puntúa'}</p>
      <p className="mt-0.5 text-[14px] leading-snug text-tinta-2 dark:text-slate-300"><TipNegrita tip={cl.tip} /></p>
    </div>
  );
}

// Gráfico circular del peso del criterio: el arco se dibuja y el número sube al mismo tiempo.
function Anillo({ pond, hex }: { pond: number; hex: string }) {
  const reducido = useReducedMotion();
  const R = 30, C = 2 * Math.PI * R;
  const destino = C * (1 - Math.max(0, Math.min(100, pond)) / 100);
  return (
    <div className="relative flex-shrink-0 w-16 h-16">
      <svg viewBox="0 0 76 76" className="w-full h-full -rotate-90" aria-hidden>
        <circle cx="38" cy="38" r={R} fill="none" strokeWidth="8" className="stroke-slate-200 dark:stroke-slate-700" />
        <motion.circle cx="38" cy="38" r={R} fill="none" stroke={hex} strokeWidth="8" strokeLinecap="round" strokeDasharray={C}
          initial={{ strokeDashoffset: reducido ? destino : C }} animate={{ strokeDashoffset: destino }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
      </svg>
      <p className="absolute inset-0 flex items-center justify-center text-[15px] font-semibold tabular-nums text-tinta dark:text-slate-50"><Pct valor={pond} /><span className="text-[11px] font-medium text-tinta-2">%</span></p>
    </div>
  );
}

// Barra de reparto del puntaje: cada tramo es un botón (pasa el mouse = resalta, clic = ir al criterio).
function BarraDistribucion({ items, activo, onHover, onElegir }: {
  items: { nombre: string; pond: number; barra: string }[]; activo: number | null; onHover: (k: number | null) => void; onElegir: (k: number) => void;
}) {
  const reducido = useReducedMotion();
  return (
    <div className="flex h-4 rounded-full overflow-hidden bg-slate-100 gap-0.5 dark:bg-slate-800" onMouseLeave={() => onHover(null)}>
      {items.map((it, k) => (
        <motion.button key={k} type="button" aria-label={`${it.nombre}: ${it.pond} %. Ver el criterio`} title={`${it.nombre}: ${it.pond} %`}
          onMouseEnter={() => onHover(k)} onFocus={() => onHover(k)} onBlur={() => onHover(null)} onClick={() => onElegir(k)}
          className={`${it.barra} h-full cursor-pointer transition-opacity duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca focus-visible:ring-offset-1 ${activo !== null && activo !== k ? 'opacity-30' : ''}`}
          initial={reducido ? false : { width: 0 }} animate={{ width: `${Math.max(0, it.pond)}%` }}
          transition={{ duration: 0.7, delay: k * 0.05, ease: [0.22, 1, 0.36, 1] }} />
      ))}
    </div>
  );
}

const pondCrit = (c: any) => Number(c.ponderacion_efectiva) || Number(c.ponderacion_nominal) || Number(c.ponderacion) || Number(c.ponderacion_pct) || 0;
const claseCrit = (c: any) => CLASE[String(c?.clase || '').toUpperCase()];

// Criterios de evaluación: lo usan "Cómo ganar" (informe de viabilidad) y la pestaña Criterios, con los datos que tenga cada fuente.
// Interactivo: la barra, la leyenda y el aviso de «dónde se gana» llevan al criterio; cada criterio se abre y se cierra.
export function CriteriosEvaluacionV4({ criterios, crit = {}, i = 1 }: { criterios: object[]; crit?: any; i?: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const [fijado, setFijado] = useState<number | null>(null);
  const [cerrados, setCerrados] = useState<Set<number>>(new Set());
  const lista = criterios as any[];
  const ordenados = [...lista].sort((a, b) => pondCrit(b) - pondCrit(a));
  const kLey = ordenados.findIndex(c => claseCrit(c)?.ley);
  const critLey = kLey >= 0 ? ordenados[kLey] : null;
  const suma = Number(crit.suma_ponderaciones_real) || ordenados.reduce((a, c) => a + pondCrit(c), 0);
  const sumaValida = crit.suma_valida ?? Math.round(suma) === 100;
  const activo = hover ?? fijado;
  const todosAbiertos = cerrados.size === 0;
  const alternar = (k: number) => setCerrados(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const elegir = (k: number) => {
    setFijado(f => (f === k ? null : k));
    setCerrados(prev => { if (!prev.has(k)) return prev; const n = new Set(prev); n.delete(k); return n; });
    setTimeout(() => document.getElementById(`${uid}-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60);
  };
  if (ordenados.length === 0) return null;
  return (
    <Bloque i={i} icon={<Scale size={18} />} titulo="Criterios de evaluación" subtitulo="Así se reparte el puntaje: mientras más alto el porcentaje, más pesa en la decisión. Toca un criterio para verlo."
      derecha={(
        <div className="flex items-center gap-4 flex-shrink-0">
          <button type="button" onClick={() => setCerrados(todosAbiertos ? new Set(ordenados.map((_, k) => k)) : new Set())}
            className="text-[13px] font-medium text-marca hover:text-marca-fuerte whitespace-nowrap">{todosAbiertos ? 'Contraer todos' : 'Expandir todos'}</button>
          <span className={`text-[13px] font-medium tabular-nums whitespace-nowrap ${sumaValida ? 'text-exito' : 'text-alerta'}`}>Suma {Math.round(suma)} %{sumaValida ? ' ✓' : ' · revisar'}</span>
        </div>
      )}>
      <div className="space-y-4">
        <div>
          <BarraDistribucion items={ordenados.map((c, k) => ({ nombre: c.nombre, pond: pondCrit(c), barra: COLOR_CRITERIO[k % COLOR_CRITERIO.length].barra }))}
            activo={activo} onHover={setHover} onElegir={elegir} />
          <div className="flex flex-wrap gap-x-1 gap-y-1 mt-2.5 -ml-2" onMouseLeave={() => setHover(null)}>
            {ordenados.map((c, k) => (
              <button key={k} type="button" onMouseEnter={() => setHover(k)} onFocus={() => setHover(k)} onBlur={() => setHover(null)} onClick={() => elegir(k)}
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-tinta-2 transition-[background-color,opacity] duration-150 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 ${activo === k ? 'bg-slate-100 dark:bg-slate-800' : ''} ${activo !== null && activo !== k ? 'opacity-50' : ''}`}>
                <span aria-hidden className={`w-2 h-2 rounded-sm ${COLOR_CRITERIO[k % COLOR_CRITERIO.length].barra}`} />{oracion(c.nombre)} <span className="font-semibold tabular-nums text-tinta dark:text-slate-100">{pondCrit(c)} %</span>
              </button>
            ))}
          </div>
        </div>

        {critLey && (
          <button type="button" onClick={() => elegir(kLey)}
            className="group w-full text-left rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 flex items-start gap-3 transition-colors duration-150 hover:bg-emerald-50 hover:border-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-900">
            <span className="w-9 h-9 rounded-lg bg-white text-exito flex items-center justify-center flex-shrink-0 shadow-tarjeta dark:bg-slate-900"><Trophy size={18} /></span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 flex-wrap"><MarcaLey clase={claseCrit(critLey)} /><span className="text-[13px] text-emerald-800 dark:text-emerald-300">dónde se gana</span></span>
              <span className="mt-1 block text-[15px] font-semibold text-tinta dark:text-slate-50 leading-snug">«{oracion(critLey.nombre)}» · {pondCrit(critLey)} %</span>
              <span className="mt-0.5 block text-[14px] text-tinta-2 dark:text-slate-300 leading-snug"><TipNegrita tip={claseCrit(critLey).tip} /></span>
            </span>
            <span className="flex-shrink-0 self-center inline-flex items-center gap-1 text-[13px] font-medium text-marca">Ver criterio <ArrowRight size={14} className="transition-transform duration-150 group-hover:translate-x-0.5" /></span>
          </button>
        )}

        <div className="grid grid-cols-1 @4xl:grid-cols-2 gap-3 items-start">
          {ordenados.map((c, k) => {
            const cl = claseCrit(c);
            const col = COLOR_CRITERIO[k % COLOR_CRITERIO.length];
            const pond = pondCrit(c);
            const abierto = !cerrados.has(k);
            const detalle = c.forma_aplicacion || c.descripcion || c.fuente;
            return (
              <Aparece key={k} i={k + 2} alto>
                <div id={`${uid}-${k}`} onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)}
                  className={`rounded-xl border bg-white transition-[box-shadow,border-color] duration-150 hover:shadow-tarjeta-hover dark:bg-slate-900 ${cl?.ley ? 'border-emerald-300 dark:border-emerald-800' : 'border-linea dark:border-slate-800'} ${activo === k ? 'ring-2 ring-marca/40 shadow-tarjeta-hover' : 'shadow-tarjeta'}`}>
                  <button type="button" onClick={() => alternar(k)} aria-expanded={abierto}
                    className="w-full flex items-start gap-3 p-4 text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60">
                    <Anillo pond={pond} hex={col.hex} />
                    <span className="min-w-0 flex-1 pt-0.5">
                      <span className="block text-[15px] font-semibold text-tinta dark:text-slate-100 leading-snug">{oracion(c.nombre)}</span>
                      {cl && <span className="mt-1.5 inline-flex"><ClaseCriterio clase={cl} /></span>}
                    </span>
                    <ChevronDown size={18} className={`flex-shrink-0 mt-1 text-slate-400 transition-transform duration-200 ${abierto ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence initial={false}>
                    {abierto && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
                        <div className="px-4 pb-4 space-y-2.5">
                          {cl && <ComoPuntua cl={cl} />}
                          {c.tramo_max_puntaje?.borde_comodo && (
                            <div className="rounded-lg bg-amber-50 px-3.5 py-2.5 dark:bg-amber-950/30" title="Valor que da el máximo puntaje con menos riesgo">
                              <p className="text-[13px] font-semibold text-amber-800 dark:text-amber-300">Valor cómodo</p>
                              <p className="mt-0.5 text-[14px] font-medium text-tinta dark:text-slate-100 leading-snug">{c.tramo_max_puntaje.borde_comodo}</p>
                            </div>
                          )}
                          {detalle && <p className="text-[13px] text-tinta-2 dark:text-slate-400 leading-relaxed">{mayus(detalle)}</p>}
                          {c.puntaje_minimo?.valor && <p className="flex items-start gap-1.5 text-[13px] font-medium text-urgente"><AlertTriangle size={15} className="flex-shrink-0 mt-px" />Puntaje mínimo: {c.puntaje_minimo.valor} {c.puntaje_minimo.unidad || ''} — {c.puntaje_minimo.consecuencia}</p>}
                          {c.cita && <div className="pt-0.5"><Cita cita={c.cita} /></div>}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </Aparece>
            );
          })}
        </div>
        {crit.puntaje_minimo_total?.valor && <p className="flex items-start gap-1.5 text-[13px] font-medium text-urgente"><AlertTriangle size={15} className="flex-shrink-0 mt-px" /><span>Puntaje mínimo total: {crit.puntaje_minimo_total.valor} {crit.puntaje_minimo_total.unidad || ''} — {crit.puntaje_minimo_total.consecuencia} <Cita cita={crit.puntaje_minimo_total.cita} /></span></p>}
        {(crit.alertas?.length ?? 0) > 0 && <div className="text-[13px] text-amber-900 bg-amber-50 rounded-xl px-4 py-3 space-y-1 dark:bg-amber-950/30 dark:text-amber-200">{crit.alertas.map((a: string, i: number) => <p key={i} className="flex items-start gap-1.5"><AlertTriangle size={15} className="flex-shrink-0 mt-0.5 text-alerta" />{mayus(a)}</p>)}</div>}
      </div>
    </Bloque>
  );
}

// Bloque destacado (se gana en / dónde se decide): suave y con el ícono en un cuadro, sin fondo sólido.
function Destacado({ icono, etiqueta, texto }: { icono: React.ReactNode; etiqueta: string; texto: string }) {
  return (
    <div className="h-full rounded-2xl border border-teal-200 bg-marca-suave/70 p-5 flex items-start gap-3.5 shadow-tarjeta dark:bg-teal-950/30 dark:border-teal-900">
      <span className="w-10 h-10 rounded-xl bg-white text-marca flex items-center justify-center flex-shrink-0 shadow-tarjeta dark:bg-slate-900">{icono}</span>
      <div className="min-w-0">
        <p className="text-[13px] text-teal-800 dark:text-teal-300">{etiqueta}</p>
        <p className="mt-1 text-[17px] font-semibold tracking-tight text-tinta dark:text-slate-50 leading-snug">{texto}</p>
      </div>
    </div>
  );
}

export function GanarV4({ informe }: { informe: any }) {
  const [filtro, setFiltro] = useState<string | null>(null);
  const t = informe.tarjeta_decision || {};
  const crit = informe.criterios_evaluacion || {};
  const criterios: any[] = Array.isArray(crit.criterios) ? crit.criterios : [];
  const est = informe.estrategia || {};
  const dsd = est.donde_se_decide || {};
  const paraGanar: string[] = Array.isArray(t.para_ganar) ? t.para_ganar : [];
  const noFuera: string[] = Array.isArray(t.no_quedes_fuera) ? t.no_quedes_fuera : [];
  const jugadas: any[] = Array.isArray(est.jugadas) ? est.jugadas : [];
  const lectura = informe.atractivo?.lectura_comercial ? mayus(sinCA(informe.atractivo.lectura_comercial)) : '';
  const dosDestacados = !!(t.se_gana_en && dsd.orden_final);
  // Tipos de jugada presentes, para filtrar la estrategia (Oportunidad, Por resolver, Empate, En contra).
  const claveJugada = (j: any) => (JUGADA[String(j.etiqueta || '').toUpperCase()] ? String(j.etiqueta).toUpperCase() : 'EMPATE');
  const tipos = Object.keys(JUGADA).map(k => ({ k, n: jugadas.filter(j => claveJugada(j) === k).length })).filter(x => x.n > 0);
  const visibles = filtro ? jugadas.filter(j => claveJugada(j) === filtro) : jugadas;
  const pesoDe = (nombre: string) => {
    const c = criterios.find(x => _norm(String(x.nombre || '')) === _norm(String(nombre || '')));
    const p = c ? pondCrit(c) : 0;
    return p > 0 ? p : null;
  };
  return (
    <div className="space-y-3">
      {(t.se_gana_en || dsd.orden_final) && (
        <div className={`grid grid-cols-1 gap-3 items-stretch ${dosDestacados ? '@2xl:grid-cols-2' : ''}`}>
          {t.se_gana_en && <Aparece i={0} alto><Destacado icono={<Trophy size={20} />} etiqueta="Se gana en" texto={oracion(t.se_gana_en)} /></Aparece>}
          {dsd.orden_final && <Aparece i={1} alto><Destacado icono={<Compass size={20} />} etiqueta="Dónde se decide" texto={oracion(dsd.orden_final)} /></Aparece>}
        </div>
      )}

      {lectura && (
        <Aparece i={2}>
          <section className={`${CAJA_V4} p-5 flex items-start gap-3`}>
            <span className="w-9 h-9 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center flex-shrink-0 dark:bg-slate-800 dark:text-slate-400"><Scale size={18} /></span>
            <div className="min-w-0">
              <p className="text-[13px] text-tinta-2 dark:text-slate-400">Lectura comercial</p>
              <p className="mt-1 text-sm text-tinta dark:text-slate-200 leading-relaxed">{lectura}</p>
            </div>
          </section>
        </Aparece>
      )}

      {(paraGanar.length > 0 || noFuera.length > 0) && (
        <div className="grid grid-cols-1 @4xl:grid-cols-2 gap-3 items-stretch">
          {paraGanar.length > 0 && (
            <Aparece i={3} alto>
              <section className={`${CAJA_V4} p-5 h-full`}>
                <p className="flex items-center gap-2 text-[15px] font-semibold text-tinta dark:text-slate-100 mb-3">
                  <span className="w-7 h-7 rounded-lg bg-emerald-50 text-exito flex items-center justify-center dark:bg-emerald-950/40"><Check size={16} /></span>Para ganar
                </p>
                <ol className="space-y-2.5">{paraGanar.map((x, i) => (
                  <li key={i} className="flex items-start gap-3"><span className="flex-shrink-0 w-5 text-sm font-semibold tabular-nums text-exito">{i + 1}</span><span className="text-sm text-tinta dark:text-slate-200 leading-snug">{oracion(x)}</span></li>
                ))}</ol>
              </section>
            </Aparece>
          )}
          {noFuera.length > 0 && (
            <Aparece i={4} alto>
              <section className={`${CAJA_V4} p-5 h-full`}>
                <p className="flex items-center gap-2 text-[15px] font-semibold text-tinta dark:text-slate-100 mb-3">
                  <span className="w-7 h-7 rounded-lg bg-red-50 text-urgente flex items-center justify-center dark:bg-red-950/40"><Ban size={16} /></span>No quedes fuera
                </p>
                <ul className="space-y-2.5">{noFuera.map((x, i) => (
                  <li key={i} className="flex items-start gap-3"><span className="flex-shrink-0 w-5 pt-0.5 text-urgente"><X size={15} /></span><span className="text-sm text-tinta dark:text-slate-200 leading-snug">{oracion(x)}</span></li>
                ))}</ul>
              </section>
            </Aparece>
          )}
        </div>
      )}

      {t.antes_de_ir && (
        <Aparece i={5}>
          <div className="rounded-2xl bg-amber-50 px-5 py-4 flex items-start gap-3 dark:bg-amber-950/30">
            <Bulb size={18} className="text-alerta flex-shrink-0 mt-0.5" />
            <div><p className="text-xs text-amber-800 dark:text-amber-300">Antes de ir</p><p className="mt-0.5 text-sm text-amber-950 dark:text-amber-100 leading-snug">{oracion(t.antes_de_ir)}</p></div>
          </div>
        </Aparece>
      )}

      <CriteriosEvaluacionV4 criterios={criterios} crit={crit} i={6} />

      {jugadas.length > 0 && (
        <Bloque i={7} icon={<ListChecks size={18} />} titulo="Estrategia" subtitulo="Dónde se gana el puntaje y qué hacer en cada criterio."
          derecha={tipos.length > 1 ? (
            <div className="flex flex-wrap justify-end gap-1.5">
              <button type="button" onClick={() => setFiltro(null)}
                className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[13px] font-medium transition-colors duration-150 ${filtro === null ? 'bg-slate-100 border-slate-300 text-tinta dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100' : 'border-linea text-tinta-2 hover:border-slate-300 hover:text-tinta dark:border-slate-700 dark:text-slate-400'}`}>
                Todas <span className="tabular-nums text-tinta-3">{jugadas.length}</span>
              </button>
              {tipos.map(({ k, n }) => (
                <button key={k} type="button" onClick={() => setFiltro(filtro === k ? null : k)}
                  className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[13px] font-medium transition-colors duration-150 ${filtro === k ? 'bg-slate-100 border-slate-300 text-tinta dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100' : 'border-linea text-tinta-2 hover:border-slate-300 hover:text-tinta dark:border-slate-700 dark:text-slate-400'}`}>
                  <span aria-hidden className="w-1.5 h-1.5 rounded-full" style={{ background: JUGADA[k].color }} />{JUGADA[k].label.split(':')[0]} <span className="tabular-nums text-tinta-3">{n}</span>
                </button>
              ))}
            </div>
          ) : undefined}>
          <div className="grid grid-cols-1 @4xl:grid-cols-2 gap-3 items-stretch">
            {visibles.map((j, i) => {
              const jg = JUGADA[claveJugada(j)];
              const cl = CLASE[String(j.clase || '').toUpperCase()];
              const peso = pesoDe(j.criterio);
              return (
                <Aparece key={`${j.criterio}-${i}`} i={i + 1} alto>
                  <div className="h-full flex flex-col gap-3 rounded-xl border bg-white p-5 shadow-tarjeta transition-shadow duration-150 hover:shadow-tarjeta-hover dark:bg-slate-900" style={{ borderColor: jg.color + '55' }}>
                    <div className="flex items-start justify-between gap-3">
                      <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-semibold" style={{ background: jg.color + '14', color: jg.color }}>{jg.icono}{jg.label}</span>
                      {peso != null && (
                        <span className="flex-shrink-0 text-right leading-none">
                          <span className="block text-[24px] font-semibold tracking-tight tabular-nums text-tinta dark:text-slate-50">{peso} %</span>
                          <span className="text-[11px] text-slate-500">del puntaje</span>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap">
                      <p className="text-[17px] font-semibold tracking-tight text-tinta dark:text-slate-50 leading-snug">{oracion(j.criterio)}</p>
                      {cl && <ClaseCriterio clase={cl} />}
                      {j.exige_respaldo && <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-0.5 text-[13px] font-medium text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle size={13} />Exige stock o respaldo</span>}
                    </div>
                    {j.lectura && <p className="text-[14px] text-tinta-2 dark:text-slate-300 leading-relaxed">{oracion(j.lectura)}</p>}
                    {j.orden && (
                      <div className="rounded-xl bg-marca-suave border border-teal-200 px-4 py-3 flex items-start gap-3 dark:bg-teal-950/30 dark:border-teal-900">
                        <span className="w-7 h-7 rounded-lg bg-white text-marca flex items-center justify-center flex-shrink-0 shadow-tarjeta dark:bg-slate-900"><ArrowRight size={16} /></span>
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-teal-800 dark:text-teal-300">Qué hacer</p>
                          <p className="mt-0.5 text-[15px] font-medium text-tinta dark:text-slate-50 leading-snug">{oracion(j.orden)}</p>
                          {j.valor_a_ofertar ? <p className="mt-2"><span className="inline-flex rounded-md bg-white border border-teal-200 px-2 py-0.5 text-[13px] font-semibold text-marca dark:bg-slate-900 dark:border-teal-800">{j.valor_a_ofertar}</span></p> : null}
                        </div>
                      </div>
                    )}
                    {j.cita && <div className="mt-auto pt-0.5"><Cita cita={j.cita} /></div>}
                  </div>
                </Aparece>
              );
            })}
          </div>
        </Bloque>
      )}
    </div>
  );
}

// ─── Admisibilidad: lo que deja la oferta fuera ────────────────────────────────────────────
const TONO_ADM = { rojo: '#dc2626', ambar: '#d97706', verde: '#16a34a', gris: '#94a3b8' } as const;
type TonoAdm = keyof typeof TONO_ADM;

const FIRMA: Record<string, { titulo: string; accion: string; tono: TonoAdm; icono: React.ReactNode }> = {
  ESCANEADA_BASTA:            { titulo: 'Basta firma escaneada',      accion: 'Pega la imagen de la firma.',                   tono: 'verde', icono: <Check size={16} /> },
  MANO_Y_ESCANEO:             { titulo: 'Firma a mano y escanea',     accion: 'Imprime, firma a mano y escanea.',              tono: 'ambar', icono: <Pencil size={16} /> },
  ORIGINAL_NOTARIAL:          { titulo: 'Original o notarial',        accion: 'Requiere gestión presencial.',                  tono: 'rojo',  icono: <Ban size={16} /> },
  FIRMA_ELECTRONICA_AVANZADA: { titulo: 'Firma electrónica avanzada', accion: 'Requiere token de firma electrónica avanzada.', tono: 'rojo',  icono: <Ban size={16} /> },
};
const GARANTIAS: Array<[string, string]> = [['seriedad', 'Seriedad de la oferta'], ['fiel_cumplimiento', 'Fiel cumplimiento'], ['contrato', 'Contrato']];

const COND_TITULO: Record<string, string> = {
  PLAZO_PAGO: 'Plazo de pago', LUGAR_ENTREGA: 'Lugar de entrega', INSTALACION: 'Instalación / puesta en marcha',
  VIGENCIA_OFERTA: 'Vigencia de la oferta', UNION_SUBCONTRATACION: 'Consorcio / subcontratación',
};
const OTRA_TITULO: Record<string, string> = {
  REUNION_INFORMATIVA: 'Reunión informativa', DEMOSTRACION: 'Demostración', PRUEBA_FUNCIONAMIENTO: 'Prueba de funcionamiento',
  PRESENTACION: 'Presentación', INSPECCION_PROVEEDOR: 'Inspección al proveedor', OTRA: 'Exigencia presencial',
};

// Texto de «si no se cumple…»: en rojo, sin caja con borde.
function Consecuencia({ texto }: { texto: string }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-[13px] font-medium text-red-900 leading-snug dark:bg-red-950/30 dark:text-red-200">
      <AlertTriangle size={15} className="flex-shrink-0 mt-px text-urgente" />
      <span>Si no se cumple: {texto.charAt(0).toLowerCase() + texto.slice(1)}</span>
    </p>
  );
}

// Datos rotulados (rótulo arriba, valor abajo), sin cajas dentro de la tarjeta.
function DatosAdm({ filas, columnas = 2 }: { filas: Array<[string, string]>; columnas?: 2 | 3 }) {
  if (filas.length === 0) return null;
  return (
    <dl className={`grid grid-cols-1 gap-x-5 gap-y-2.5 ${columnas === 3 ? '@xl:grid-cols-3' : '@xl:grid-cols-2'}`}>
      {filas.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[11px] text-slate-500">{k}</dt>
          <dd className="text-[13.5px] font-medium text-tinta dark:text-slate-100 leading-snug">{mayus(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function FichaPresencial({ icono, titulo, estado, tono, datos, consecuencia, cita, delDetector }: {
  icono: React.ReactNode; titulo: string; estado: string; tono: TonoAdm;
  datos: Array<[string, any]>; consecuencia?: string; cita?: any; delDetector?: boolean;
}) {
  const color = TONO_ADM[tono];
  const filas = datos.filter(([, v]) => v && String(v).trim()).map(([k, v]) => [k, String(v)] as [string, string]);
  return (
    <div className="rounded-xl border bg-white p-5 h-full flex flex-col gap-3 shadow-tarjeta dark:bg-slate-900" style={{ borderColor: tono === 'gris' || tono === 'verde' ? undefined : color + '55' }}>
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: color + '18', color }}>{icono}</span>
        <div className="min-w-0">
          <p className="text-[13px] text-tinta-2 dark:text-slate-400">{titulo}</p>
          <p className="text-[16px] font-semibold tracking-tight leading-snug" style={{ color: tono === 'gris' ? undefined : color }}>
            <span className={tono === 'gris' ? 'text-tinta dark:text-slate-100' : ''}>{estado}</span>
          </p>
        </div>
      </div>
      <DatosAdm filas={filas} />
      {consecuencia && <Consecuencia texto={consecuencia} />}
      {delDetector && <p className="text-xs text-alerta">Detectado por búsqueda en el texto: confirma en el documento.</p>}
      {cita && <div className="mt-auto pt-0.5"><Cita cita={cita} /></div>}
    </div>
  );
}

/** Visita técnica, muestras y demás exigencias presenciales / condiciones comerciales de las bases. */
function PresencialesV4({ adm }: { adm: any }) {
  const v = adm.visita_tecnica || {};
  const m = adm.muestras || {};
  const otras: any[] = (Array.isArray(adm.otras_exigencias_presenciales) ? adm.otras_exigencias_presenciales : []).filter((o: any) => o && (o.que || o.tipo));
  const conds: any[] = (Array.isArray(adm.condiciones_comerciales) ? adm.condiciones_comerciales : []).filter((c: any) => c && c.que);
  const ev = String(v.estado || 'NO_INDICADO').toUpperCase();
  const em = String(m.estado || 'NO_INDICADO').toUpperCase();
  const alertas = (ev === 'OBLIGATORIA' ? 1 : 0) + (em === 'EXIGE' ? 1 : 0) + otras.filter(o => o.obligatoria !== false).length;
  return (
    <Bloque i={1} icon={<Compass size={18} />} titulo="Visita técnica y muestras" subtitulo="Exigencias que hay que cumplir en persona o con productos físicos, y condiciones comerciales de las bases."
      derecha={<span className={`text-[13px] font-medium tabular-nums whitespace-nowrap ${alertas ? 'text-urgente' : 'text-exito'}`}>{alertas ? `${alertas} ${alertas === 1 ? 'exigencia' : 'exigencias'}` : 'Sin exigencias'}</span>}>
      <div className="grid grid-cols-1 @4xl:grid-cols-2 gap-3 items-stretch">
        <FichaPresencial icono={<Compass size={18} />} titulo="Visita técnica"
          estado={ev === 'OBLIGATORIA' ? 'Visita obligatoria' : ev === 'VOLUNTARIA' ? 'Visita voluntaria' : ev === 'EXISTE' ? 'Hay visita (confirmar si es obligatoria)' : ev === 'NO_EXISTE' ? 'No hay visita' : 'No indicada en las bases'}
          tono={ev === 'OBLIGATORIA' ? 'rojo' : ev === 'VOLUNTARIA' || ev === 'EXISTE' ? 'ambar' : ev === 'NO_EXISTE' ? 'verde' : 'gris'}
          datos={[['Cuándo', v.fecha_hora], ['Dónde', v.lugar], ['Cómo se acredita', v.acreditacion], ['Inscripción previa', v.inscripcion_previa]]}
          consecuencia={ev === 'OBLIGATORIA' ? v.consecuencia : undefined} cita={v.cita} delDetector={v.origen === 'detector'} />
        <FichaPresencial icono={<Package size={18} />} titulo="Muestras"
          estado={em === 'EXIGE' ? 'Piden muestras' : em === 'NO_EXISTE' ? 'No piden muestras' : 'No indicadas en las bases'}
          tono={em === 'EXIGE' ? 'rojo' : em === 'NO_EXISTE' ? 'verde' : 'gris'}
          datos={[['Productos', m.que_productos], ['Cuántas', m.cuantas], ['Plazo', m.cuando], ['Dónde se entregan', m.donde], ['Devolución', m.devolucion]]}
          consecuencia={em === 'EXIGE' ? m.consecuencia : undefined} cita={m.cita} delDetector={m.origen === 'detector'} />
      </div>
      {otras.length > 0 && (
        <div className="grid grid-cols-1 @4xl:grid-cols-2 gap-3 items-stretch mt-3">
          {otras.map((o, k) => (
            <FichaPresencial key={k} icono={<Clock size={18} />} titulo={OTRA_TITULO[String(o.tipo || '').toUpperCase()] || 'Exigencia presencial'}
              estado={oracion(o.que || '')} tono={o.obligatoria === false ? 'ambar' : 'rojo'}
              datos={[['Cuándo', o.cuando], ['Carácter', o.obligatoria === false ? 'Voluntaria' : 'Obligatoria']]}
              consecuencia={o.obligatoria === false ? undefined : o.consecuencia} cita={o.cita} />
          ))}
        </div>
      )}
      {conds.length > 0 && (
        <div className="mt-4 pt-4 border-t border-linea/80 dark:border-slate-800">
          <p className="text-[15px] font-semibold text-tinta dark:text-slate-100 mb-2.5">Condiciones comerciales</p>
          <ul className="space-y-2">
            {conds.map((c, k) => (
              <li key={k} className="rounded-xl bg-slate-50/80 px-4 py-3 flex items-start gap-3 dark:bg-slate-800/40">
                <span className="w-7 h-7 rounded-lg bg-white text-marca flex items-center justify-center flex-shrink-0 shadow-tarjeta dark:bg-slate-900"><Wallet size={15} /></span>
                <div className="min-w-0 space-y-1.5">
                  <p className="text-[14px] text-tinta-2 dark:text-slate-300 leading-snug"><span className="font-semibold text-tinta dark:text-slate-100">{COND_TITULO[String(c.tipo || '').toUpperCase()] || 'Condición'}: </span>{mayus(c.que)}</p>
                  {c.cita && <Cita cita={c.cita} />}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Bloque>
  );
}

// Resumen de la pestaña: cinco datos para ver de un vistazo qué exige esta licitación. Cada uno lleva a su sección.
function ResumenAdm({ items }: { items: Array<{ rotulo: string; valor: string; tono: TonoAdm; destino: string }> }) {
  const ir = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <div className={`grid grid-cols-2 gap-3 ${items.length === 3 ? '@2xl:grid-cols-3' : items.length === 4 ? '@2xl:grid-cols-4' : '@2xl:grid-cols-3 @4xl:grid-cols-5'}`}>
      {items.map((it, k) => (
        <Aparece key={it.rotulo} i={k} alto>
          <button type="button" onClick={() => ir(it.destino)}
            className="group w-full h-full text-left rounded-2xl border border-linea bg-white px-4 py-3.5 shadow-tarjeta transition-[box-shadow,transform] duration-150 ease-lk hover:shadow-tarjeta-hover hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:bg-slate-900 dark:border-slate-800">
            <span className="block text-[13px] text-tinta-2 dark:text-slate-400">{it.rotulo}</span>
            <span className="mt-1.5 flex items-center gap-2 text-[15px] font-semibold leading-snug text-tinta dark:text-slate-50">
              <span aria-hidden className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: TONO_ADM[it.tono] }} />{it.valor}
            </span>
            <span className="mt-1.5 inline-flex items-center gap-1 text-xs text-marca opacity-70 group-hover:opacity-100">Ver detalle <ChevronDown size={12} /></span>
          </button>
        </Aparece>
      ))}
    </div>
  );
}

export function AdmisibilidadV4({ informe }: { informe: any }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [cerrados, setCerrados] = useState<Set<number>>(new Set());
  const adm = informe.requisitos_admisibilidad || {};
  const pres = informe.presupuesto || {};
  const requisitos: any[] = Array.isArray(adm.requisitos) ? adm.requisitos : [];
  const causales: any[] = Array.isArray(adm.posibles_causales_sin_analizar) ? adm.posibles_causales_sin_analizar : [];
  const garantias = adm.garantias || {};
  const firma = FIRMA[String(adm.firma?.estado || '').toUpperCase()];
  const nAdm = Number(adm.conteo ?? requisitos.length) || 0;
  const ev = String(adm.visita_tecnica?.estado || 'NO_INDICADO').toUpperCase();
  const em = String(adm.muestras?.estado || 'NO_INDICADO').toUpperCase();
  const nGar = GARANTIAS.filter(([k]) => String(garantias[k]?.estado || '').toUpperCase() === 'EXISTE').length;
  const todosAbiertos = cerrados.size === 0;
  const alternar = (k: number) => setCerrados(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <div className="space-y-3">
      <ResumenAdm items={[
        { rotulo: 'Requisitos que dejan fuera', valor: nAdm ? `${nAdm} ${nAdm === 1 ? 'requisito' : 'requisitos'}` : 'Ninguno', tono: nAdm ? 'rojo' : 'verde', destino: `${uid}-req` },
        { rotulo: 'Visita técnica', valor: ev === 'OBLIGATORIA' ? 'Obligatoria' : ev === 'VOLUNTARIA' ? 'Voluntaria' : ev === 'EXISTE' ? 'Hay (confirmar)' : ev === 'NO_EXISTE' ? 'No hay' : 'No indicada', tono: ev === 'OBLIGATORIA' ? 'rojo' : ev === 'VOLUNTARIA' || ev === 'EXISTE' ? 'ambar' : ev === 'NO_EXISTE' ? 'verde' : 'gris', destino: `${uid}-pres` },
        { rotulo: 'Muestras', valor: em === 'EXIGE' ? 'Las piden' : em === 'NO_EXISTE' ? 'No las piden' : 'No indicadas', tono: em === 'EXIGE' ? 'rojo' : em === 'NO_EXISTE' ? 'verde' : 'gris', destino: `${uid}-pres` },
        { rotulo: 'Garantías', valor: nGar ? `${nGar} ${nGar === 1 ? 'exigida' : 'exigidas'}` : 'Ninguna exigida', tono: nGar ? 'ambar' : 'verde', destino: `${uid}-gar` },
        { rotulo: 'Firma', valor: firma ? firma.titulo : 'No indicada', tono: firma ? firma.tono : 'gris', destino: `${uid}-gar` },
      ]} />

      <div id={`${uid}-req`} className="scroll-mt-4">
        <Bloque i={0} icon={<ShieldCheck size={18} />} titulo="Lo que deja la oferta fuera" subtitulo="Si no se cumple alguno de estos requisitos, la oferta queda eliminada. Toca uno para abrirlo o cerrarlo."
          derecha={(
            <div className="flex items-center gap-4 flex-shrink-0">
              {requisitos.length > 1 && (
                <button type="button" onClick={() => setCerrados(todosAbiertos ? new Set(requisitos.map((_, k) => k)) : new Set())}
                  className="text-[13px] font-medium text-marca hover:text-marca-fuerte whitespace-nowrap">{todosAbiertos ? 'Contraer todos' : 'Expandir todos'}</button>
              )}
              <span className={`text-[13px] font-medium tabular-nums whitespace-nowrap ${nAdm ? 'text-urgente' : 'text-exito'}`}>{nAdm ? `${nAdm} ${nAdm === 1 ? 'requisito' : 'requisitos'}` : 'Sin requisitos detectados'}</span>
            </div>
          )}>
          {requisitos.length === 0 ? (
            <div className="rounded-xl bg-emerald-50 px-4 py-3 flex items-center gap-2.5 text-[14px] text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"><Check size={18} className="flex-shrink-0 text-exito" />El análisis no encontró requisitos que dejen la oferta fuera.</div>
          ) : (
            <div className="grid grid-cols-1 @4xl:grid-cols-2 gap-3 items-start">
              {requisitos.map((r: any, k: number) => {
                const datos: Array<[string, string]> = ([['Cuánto', r.cuanto], ['Cuándo', r.cuando], ['Cómo', r.como]] as Array<[string, any]>).filter(([, v]) => v).map(([kk, v]) => [kk, String(v)]);
                const abierto = !cerrados.has(k);
                return (
                  <Aparece key={k} i={k + 1} alto>
                    <div className="rounded-xl border border-red-200 bg-white shadow-tarjeta transition-shadow duration-150 hover:shadow-tarjeta-hover dark:bg-slate-900 dark:border-red-900/60">
                      <button type="button" onClick={() => alternar(k)} aria-expanded={abierto}
                        className="w-full flex items-start gap-3 p-4 text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60">
                        <span className="w-9 h-9 rounded-xl bg-red-50 text-urgente flex items-center justify-center flex-shrink-0 dark:bg-red-950/40"><Ban size={18} /></span>
                        <span className="min-w-0 flex-1 pt-0.5">
                          <span className="block text-[12px] tabular-nums text-slate-500">Requisito {k + 1}</span>
                          <span className="block text-[15px] font-semibold text-tinta dark:text-slate-50 leading-snug">{oracion(r.que)}</span>
                        </span>
                        <ChevronDown size={18} className={`flex-shrink-0 mt-1 text-slate-400 transition-transform duration-200 ${abierto ? 'rotate-180' : ''}`} />
                      </button>
                      <AnimatePresence initial={false}>
                        {abierto && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
                            <div className="px-4 pb-4 space-y-3">
                              <DatosAdm filas={datos} columnas={3} />
                              {r.consecuencia && <Consecuencia texto={r.consecuencia} />}
                              {r.cita && <div><Cita cita={r.cita} /></div>}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </Aparece>
                );
              })}
            </div>
          )}
        </Bloque>
      </div>

      {causales.length > 0 && (
        <Bloque i={1} icon={<AlertTriangle size={18} />} titulo="Posibles causales sin analizar" subtitulo="Frases de las bases que dicen que la oferta puede quedar fuera y que el análisis no cubrió. Revísalas en el documento."
          derecha={<span className="text-[13px] font-medium tabular-nums text-alerta">{causales.length}</span>}>
          <div className="space-y-2">
            {causales.map((c: any, k: number) => (
              <Aparece key={k} i={k + 2}>
                <div className="rounded-xl bg-amber-50 px-4 py-3 flex items-start gap-3 dark:bg-amber-950/30">
                  <Quote size={16} className="text-alerta flex-shrink-0 mt-0.5" />
                  <div className="min-w-0 space-y-1.5"><p className="text-[13.5px] text-amber-950 dark:text-amber-100 leading-snug">{c.oracion}</p><Cita cita={c.cita} /></div>
                </div>
              </Aparece>
            ))}
          </div>
        </Bloque>
      )}

      <div id={`${uid}-pres`} className="scroll-mt-4"><PresencialesV4 adm={adm} /></div>

      <div id={`${uid}-gar`} className="scroll-mt-4">
        <Bloque i={2} icon={<Gavel size={18} />} titulo="Garantías, contrato y firma" subtitulo="Qué hay que presentar o firmar para poder ofertar.">
          <div className="grid grid-cols-1 @xl:grid-cols-2 @4xl:grid-cols-4 gap-3 items-stretch">
            {GARANTIAS.map(([k, label], n) => {
              const g = garantias[k] || {};
              const est = String(g.estado || 'NO_INDICADO').toUpperCase();
              const tono: TonoAdm = est === 'EXISTE' ? 'ambar' : est === 'NO_EXISTE' ? 'verde' : 'gris';
              return (
                <Aparece key={k} i={n + 3} alto>
                  <div className="rounded-xl bg-slate-50/80 p-4 h-full flex flex-col gap-2 dark:bg-slate-800/40">
                    <p className="text-[13px] text-tinta-2 dark:text-slate-400">{label}</p>
                    <p className="flex items-center gap-2 text-[15px] font-semibold text-tinta dark:text-slate-50"><span aria-hidden className="w-2 h-2 rounded-full" style={{ background: TONO_ADM[tono] }} />{est === 'EXISTE' ? 'Se exige' : est === 'NO_EXISTE' ? 'No se exige' : 'No indicado'}</p>
                    {g.monto && <p className="text-[20px] font-semibold tracking-tight text-tinta dark:text-slate-50 leading-tight tabular-nums">{g.monto}</p>}
                    {g.cita && <div className="mt-auto pt-1"><Cita cita={g.cita} /></div>}
                  </div>
                </Aparece>
              );
            })}
            {firma && (
              <Aparece i={6} alto>
                <div className="rounded-xl bg-slate-50/80 p-4 h-full flex flex-col gap-2 dark:bg-slate-800/40">
                  <p className="text-[13px] text-tinta-2 dark:text-slate-400">Firma</p>
                  <p className="flex items-center gap-2 text-[15px] font-semibold leading-snug" style={{ color: TONO_ADM[firma.tono] }}><span className="flex-shrink-0">{firma.icono}</span><span className="text-tinta dark:text-slate-50">{firma.titulo}</span></p>
                  <p className="text-[13px] text-tinta-2 dark:text-slate-400 leading-snug">{firma.accion}</p>
                  {adm.firma?.cita && <div className="mt-auto pt-1"><Cita cita={adm.firma.cita} /></div>}
                </div>
              </Aparece>
            )}
          </div>
          {pres.caracter !== 'EXCLUYENTE' && pres.nota_art_32 && <p className="text-[13px] text-tinta-2 dark:text-slate-400 mt-4 pt-4 border-t border-linea/80 dark:border-slate-800">{mayus(pres.nota_art_32)}</p>}
        </Bloque>
      </div>
    </div>
  );
}

// ─── Plazos y multa ────────────────────────────────────────────────────────────────────────
const HITO_LABEL: Record<string, string> = {
  GARANTIA_FIEL_CUMPLIMIENTO: 'Garantía de fiel cumplimiento',
  FIRMA_CONTRATO_PROVEEDOR: 'Firma del contrato (nosotros)',
  FIRMA_CONTRATO_ORGANISMO: 'Firma o tramitación del contrato (organismo)',
  EMISION_OC: 'Emisión de la orden de compra',
  ACEPTACION_OC: 'Aceptación de la orden de compra',
};

function Dato({ etiqueta, children, alerta }: { etiqueta: string; children: React.ReactNode; alerta?: boolean }) {
  return (
    <div className={`rounded-xl p-4 h-full flex flex-col gap-2 ${alerta ? 'bg-red-50 border border-red-200 dark:bg-red-950/30 dark:border-red-900' : 'bg-slate-50/80 dark:bg-slate-800/40'}`}>
      <p className="text-[13px] text-tinta-2 dark:text-slate-400">{etiqueta}</p>
      {children}
    </div>
  );
}

export function PlazosV4({ informe }: { informe: any }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const plz = informe.plazos || {};
  const pp = plz.plazo_previo || null;
  const atraso = informe.multas?.atraso || null;
  const hitos: any[] = Array.isArray(plz.hitos) ? plz.hitos : [];
  const reducido = useReducedMotion();
  const totalDias = pp ? Number(pp.total_dias_corridos) : null;
  const textoTotal = pp ? (totalDias === 0 ? 'Sin plazo previo' : `${pp.al_menos ? 'Al menos ' : ''}${totalDias} días corridos`) : null;
  const entrega = plz.plazo_entrega && (plz.plazo_entrega.min || plz.plazo_entrega.max) ? plz.plazo_entrega : null;
  const inicio = plz.inicio_plazo_entrega?.evento ? plz.inicio_plazo_entrega : null;
  const hayMulta = !!(atraso && atraso.existe !== false);
  const multaDia = atraso?.calculo?.pesos_dia_estimado;
  const topeTexto = atraso?.tope?.valor ? `${atraso.tope.valor} ${atraso.tope.unidad || ''}`.trim() : atraso?.calculo?.tope_estimado != null ? `≈ ${fmt(atraso.calculo.tope_estimado)}` : null;
  const textoEntrega = entrega ? `${[entrega.min && `Mín. ${entrega.min}`, entrega.max && `Máx. ${entrega.max}`].filter(Boolean).join(' · ')} ${entrega.unidad || ''}`.trim() : null;
  const resumen: Array<{ rotulo: string; valor: string; tono: TonoAdm; destino: string }> = [
    { rotulo: 'Plazo previo', valor: textoTotal || 'No indicado', tono: 'gris', destino: `${uid}-previo` },
    { rotulo: 'Plazo de entrega', valor: textoEntrega || 'No indicado', tono: entrega?.fuera_de_rango_inadmisible ? 'rojo' : 'gris', destino: `${uid}-entrega` },
    { rotulo: 'Multa por atraso', valor: !hayMulta ? 'No hay' : multaDia != null ? `≈ ${fmt(multaDia)} por día` : valorMulta(atraso), tono: hayMulta ? 'ambar' : 'verde', destino: `${uid}-multa` },
  ];
  if (hayMulta && topeTexto) resumen.push({ rotulo: 'Tope de la multa', valor: topeTexto, tono: 'gris', destino: `${uid}-multa` });
  return (
    <div className="space-y-3">
      <ResumenAdm items={resumen} />

      <div id={`${uid}-previo`} className="scroll-mt-4">
        <Bloque i={0} icon={<Clock size={18} />} titulo="Plazo previo" subtitulo="Tiempo administrativo entre la adjudicación y el inicio del plazo de entrega."
          derecha={textoTotal ? <span className="text-[13px] font-medium tabular-nums text-marca whitespace-nowrap">{textoTotal}</span> : undefined}>
          {/* Tabla del plazo previo (pedido del dueño: «dejalo tipo tablas»): un hito por fila, con su cita. */}
          <div className="overflow-x-auto rounded-xl border border-linea dark:border-slate-800">
            <table className="w-full min-w-[560px] text-[13.5px]">
              <thead>
                <tr className="bg-slate-50 text-left text-xs text-tinta-2 dark:bg-slate-800/60 dark:text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Hito</th>
                  <th className="px-4 py-2.5 font-medium">Se cuenta desde</th>
                  <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Plazo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linea/80 dark:divide-slate-800">
                {hitos.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-tinta-2 dark:text-slate-400">Las bases no indican hitos previos al plazo de entrega.</td></tr>}
                {hitos.map((h, k) => {
                  const est = String(h.estado || '').toUpperCase();
                  return (
                    <motion.tr key={k} className="align-top transition-colors duration-150 hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                      initial={reducido ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: 0.05 + k * 0.04, ease: [0.22, 1, 0.36, 1] }}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-tinta dark:text-slate-100 leading-snug">{HITO_LABEL[h.hito] || mayus(cap(h.hito).toLowerCase())}</p>
                        {h.cita && <div className="mt-1.5"><Cita cita={h.cita} /></div>}
                      </td>
                      <td className="px-4 py-3 text-tinta-2 dark:text-slate-400">{h.desde && est === 'EXISTE' ? mayus(h.desde) : <span className="text-slate-300">—</span>}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {est === 'EXISTE'
                          ? <span className="text-[15px] font-semibold tabular-nums text-tinta dark:text-slate-50">{h.plazo ?? '?'} <span className="text-[13px] font-medium text-tinta-2 dark:text-slate-400">{h.unidad_original || ''}</span></span>
                          : est === 'NO_EXISTE' ? <Marca color="#16a34a">No se exige</Marca>
                          : <Marca color="#94a3b8">No indicado en las bases</Marca>}
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
              {pp && (
                <tfoot>
                  <tr className="bg-marca-suave border-t border-teal-200 dark:bg-teal-950/30 dark:border-teal-900">
                    <td className="px-4 py-3.5 font-semibold text-tinta dark:text-slate-50">Total plazo previo</td>
                    <td className="px-4 py-3.5 text-[13px] text-tinta-2 dark:text-slate-300">{pp.fecha_base_origen ? <>Contado desde {pp.fecha_base_origen}{pp.fecha_base ? ` (${pp.fecha_base})` : ''}</> : null}</td>
                    <td className="px-4 py-3.5 text-right whitespace-nowrap text-[18px] font-semibold tracking-tight tabular-nums text-marca">{textoTotal}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {(pp?.avisos?.length ?? 0) > 0 && (
            <div className="mt-4 text-[13px] text-amber-900 bg-amber-50 rounded-xl px-4 py-3 space-y-1 dark:bg-amber-950/30 dark:text-amber-200">
              {pp.avisos.map((a: string, k: number) => <p key={k} className="flex items-start gap-1.5"><AlertTriangle size={15} className="flex-shrink-0 mt-0.5 text-alerta" />{mayus(a)}</p>)}
            </div>
          )}
          {plz.nota_aceptacion_oc && <p className="mt-3 text-[13px] text-tinta-2 bg-slate-50 rounded-xl px-4 py-3 dark:bg-slate-800/40 dark:text-slate-300">{mayus(plz.nota_aceptacion_oc)}</p>}
        </Bloque>
      </div>

      {(inicio || entrega) && (
        <div id={`${uid}-entrega`} className="scroll-mt-4">
          <Bloque i={1} icon={<TrendingUp size={18} />} titulo="Entrega" subtitulo="Cuándo parte el plazo de entrega y cuánto dura.">
            <div className="grid grid-cols-1 @2xl:grid-cols-2 gap-3 items-stretch">
              {inicio && (
                <Aparece i={2} alto>
                  <Dato etiqueta="Inicio del plazo de entrega">
                    <p className="text-[17px] font-semibold tracking-tight text-tinta dark:text-slate-50 leading-snug">{mayus(inicio.evento)}</p>
                    {inicio.desfase?.cantidad != null && <div><Marca color="#0f766e">+{inicio.desfase.cantidad} {inicio.desfase.unidad || ''}</Marca></div>}
                    {inicio.cita && <div className="mt-auto pt-1"><Cita cita={inicio.cita} /></div>}
                  </Dato>
                </Aparece>
              )}
              {entrega && (
                <Aparece i={3} alto>
                  <Dato etiqueta="Plazo de entrega" alerta={!!entrega.fuera_de_rango_inadmisible}>
                    <p className="text-[24px] font-semibold tracking-tight text-tinta dark:text-slate-50 leading-tight tabular-nums">{[entrega.min && `Mín. ${entrega.min}`, entrega.max && `Máx. ${entrega.max}`].filter(Boolean).join(' · ')} <span className="text-[14px] font-medium text-tinta-2 dark:text-slate-400">{entrega.unidad || ''}</span></p>
                    {entrega.fuera_de_rango_inadmisible && <Consecuencia texto="Fuera de este rango, la oferta es inadmisible." />}
                    {entrega.cita && <div className="mt-auto pt-1"><Cita cita={entrega.cita} /></div>}
                  </Dato>
                </Aparece>
              )}
            </div>
          </Bloque>
        </div>
      )}

      <div id={`${uid}-multa`} className="scroll-mt-4">
        <Bloque i={2} icon={<Gavel size={18} />} titulo="Multa por atraso" subtitulo="Lo que se descuenta si la entrega llega después del plazo.">
          {!hayMulta ? (
            <div className="rounded-xl bg-emerald-50 px-4 py-3 flex items-center gap-2.5 text-[14px] text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"><Check size={18} className="flex-shrink-0 text-exito" />Las bases no establecen multa por atraso.</div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 @xl:grid-cols-2 @4xl:grid-cols-3 gap-3 items-stretch">
                <Aparece i={3} alto>
                  <Dato etiqueta="Según las bases">
                    <p className="text-[26px] font-semibold tracking-tight text-tinta dark:text-slate-50 leading-tight tabular-nums">{valorMulta(atraso)}</p>
                    <p className="text-[13px] text-tinta-2 dark:text-slate-400 leading-snug">Por {PERIODO[String(atraso.periodo || '').toUpperCase()] || 'día'} de atraso{atraso.base_calculo ? `, sobre ${atraso.base_calculo}` : ''}.</p>
                  </Dato>
                </Aparece>
                {multaDia != null && (
                  <Aparece i={4} alto>
                    <Dato etiqueta="Estimado por día" alerta>
                      <p className="text-[26px] font-semibold tracking-tight text-urgente leading-tight tabular-nums">≈ <Contado valor={Number(multaDia)} /></p>
                      {atraso.calculo?.nota && <p className="text-[13px] text-tinta-2 dark:text-slate-400 leading-snug">{mayus(atraso.calculo.nota)}{atraso.calculo.valor_uf_utm ? ` · valor ${fmt(atraso.calculo.valor_uf_utm)} del ${atraso.calculo.fecha_valor}` : ''}</p>}
                    </Dato>
                  </Aparece>
                )}
                {(topeTexto || atraso.al_superar_tope) && (
                  <Aparece i={5} alto>
                    <Dato etiqueta="Tope de la multa">
                      <p className="text-[22px] font-semibold tracking-tight text-tinta dark:text-slate-50 leading-tight tabular-nums">{topeTexto || 'No indicado'}</p>
                      {atraso.al_superar_tope && <p className="text-[13px] text-tinta-2 dark:text-slate-400 leading-snug"><span className="font-medium text-tinta dark:text-slate-200">Al superarlo:</span> {atraso.al_superar_tope.charAt(0).toLowerCase() + atraso.al_superar_tope.slice(1)}</p>}
                    </Dato>
                  </Aparece>
                )}
              </div>
              {multaDia == null && atraso.calculo?.nota && <p className="flex items-start gap-1.5 text-[13px] text-amber-900 bg-amber-50 rounded-xl px-4 py-3 dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle size={15} className="flex-shrink-0 mt-0.5 text-alerta" />{mayus(atraso.calculo.nota)}</p>}
              {atraso.cita && <div><Cita cita={atraso.cita} /></div>}
            </div>
          )}
        </Bloque>
      </div>
    </div>
  );
}

// ─── Productos ─────────────────────────────────────────────────────────────────────────────
type FiltroProd = 'todos' | 'especificos' | 'libre' | 'alertas';

function FilaProducto({ p, abierta, onToggle, codigo, informe }: { p: any; abierta: boolean; onToggle: () => void; codigo: string; informe: any }) {
  const cs: string[] = Array.isArray(p.caracteristicas) ? p.caracteristicas : [];
  const noEnc: string[] = Array.isArray(p.caracteristicas_no_encontradas) ? p.caracteristicas_no_encontradas : [];
  const esEsp = String(p.clasificacion || '').toLowerCase().startsWith('espec');
  const hayDetalle = cs.length > 0 || noEnc.length > 0;
  return (
    <div className={`transition-colors duration-150 ${abierta ? 'bg-slate-50/70 dark:bg-slate-800/30' : ''}`}>
      <div role={hayDetalle ? 'button' : undefined} tabIndex={hayDetalle ? 0 : undefined} onClick={hayDetalle ? onToggle : undefined} aria-expanded={hayDetalle ? abierta : undefined}
        onKeyDown={hayDetalle ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } } : undefined}
        className={`grid grid-cols-[40px_1fr_auto] @2xl:grid-cols-[48px_1fr_120px_110px_24px] items-center gap-x-3 gap-y-1 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-marca/60 ${hayDetalle ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40' : ''}`}>
        <span className="text-[12px] font-medium tabular-nums text-slate-500">{p.linea}</span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-tinta dark:text-slate-50 leading-snug">{oracion(p.nombre)}{p.marca_modelo_referencia ? <span className="font-normal text-tinta-2 dark:text-slate-400"> · {p.marca_modelo_referencia}</span> : null}</p>
          <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap mt-1 empty:hidden">
            {p.libertad_de_oferta && <span title="Las bases no detallan características: se puede ofertar el que más nos convenga"><Marca color="#16a34a">Libertad de oferta</Marca></span>}
            {p.libertad_de_pricing && <span title="Las bases no publican el monto de esta línea"><Marca color="#94a3b8">Precio libre</Marca></span>}
            {p.cantidad_variable?.porcentaje && <span title="Las bases permiten variar la cantidad"><Marca color="#d97706">Cantidad ± {p.cantidad_variable.porcentaje}</Marca></span>}
            {noEnc.length > 0 && <Marca color="#d97706">{noEnc.length} por revisar</Marca>}
          </div>
        </div>
        <p className="text-right text-[15px] font-semibold text-tinta dark:text-slate-50 tabular-nums whitespace-nowrap">
          {p.cantidad != null ? <>{p.cantidad}<span className="text-[12px] font-medium text-tinta-2 dark:text-slate-400">{p.unidad_medida ? ` ${p.unidad_medida}` : ''}{p.unidad_inferida ? '*' : ''}</span></> : <span className="text-slate-300">—</span>}
        </p>
        <span className="hidden @2xl:block"><Marca color={esEsp ? '#0f766e' : '#94a3b8'}>{esEsp ? 'Específico' : 'Genérico'}</Marca></span>
        <span className="hidden @2xl:flex justify-end text-slate-400">{hayDetalle && <ChevronDown size={16} className={`transition-transform duration-200 ${abierta ? 'rotate-180' : ''}`} />}</span>
      </div>
      <AnimatePresence initial={false}>
        {abierta && hayDetalle && (
          <motion.div key="detalle" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
            <div className="px-4 pb-4 @2xl:pl-[76px] space-y-3">
              {cs.length > 0 && (
                <div>
                  <p className="text-[11px] text-slate-500 mb-1.5">Ficha técnica · <span className="tabular-nums">{cs.length}</span></p>
                  <ul className="grid grid-cols-1 @4xl:grid-cols-2 gap-x-6 gap-y-1">
                    {cs.map((c, k) => <li key={k} className="flex items-start gap-1.5 text-[13px] text-tinta-2 dark:text-slate-300 leading-snug"><Check size={14} className="text-marca flex-shrink-0 mt-0.5" />{mayus(c)}</li>)}
                  </ul>
                </div>
              )}
              {noEnc.length > 0 && (
                <div className="rounded-xl bg-amber-50 px-4 py-3 dark:bg-amber-950/30">
                  <p className="flex items-start gap-1.5 text-[13px] font-medium text-amber-900 dark:text-amber-200"><AlertTriangle size={15} className="flex-shrink-0 mt-px text-alerta" />{noEnc.length} {noEnc.length === 1 ? 'característica no encontrada' : 'características no encontradas'} en las bases: no pasan al auditor hasta revisarlas.</p>
                  <ul className="mt-1.5 ml-6 list-disc text-[12.5px] text-amber-900 space-y-0.5 dark:text-amber-200/90">{noEnc.map((c, k) => <li key={k}>{mayus(c)}</li>)}</ul>
                </div>
              )}
              {cs.length >= 3 && (
                <div className="flex flex-wrap items-center gap-2">
                  <BotonBuscarEquipo codigo={String(informe.meta?.id || codigo)} region={informe.meta?.region} producto={{ descripcion: p.nombre, caracteristicas: cs, cantidad: p.cantidad }} />
                  <BotonProductoReferencia codigo={String(informe.meta?.id || codigo)} producto={{ nombre: p.nombre, marca_modelo_referencia: p.marca_modelo_referencia, caracteristicas: cs }} />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Tarjeta resumen que filtra (Productos): número grande + punto de color; la activa queda marcada en teal.
function TarjetaFiltro({ i, rotulo, n, tono, activa, onClick }: { i: number; rotulo: string; n: number; tono: TonoAdm; activa: boolean; onClick: () => void }) {
  return (
    <Aparece i={i} alto>
      <button type="button" onClick={onClick} aria-pressed={activa}
        className={`group w-full h-full text-left rounded-2xl border bg-white px-4 py-3.5 shadow-tarjeta transition-[box-shadow,transform,border-color] duration-150 ease-lk hover:shadow-tarjeta-hover hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:bg-slate-900 ${activa ? 'border-marca ring-1 ring-marca dark:border-teal-600' : 'border-linea dark:border-slate-800'}`}>
        <span className="flex items-center gap-2 text-[13px] text-tinta-2 dark:text-slate-400"><span aria-hidden className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: TONO_ADM[tono] }} />{rotulo}</span>
        <span className="mt-1.5 block text-[28px] font-semibold tracking-tight leading-none tabular-nums text-tinta dark:text-slate-50"><Pct valor={n} /></span>
        <span className={`mt-2 block text-xs ${activa ? 'text-marca' : 'text-marca opacity-70 group-hover:opacity-100'}`}>{activa ? 'Filtrando · quitar filtro' : 'Filtrar'}</span>
      </button>
    </Aparece>
  );
}

// Selector de línea: segmento con borde; la activa en teal suave.
function ChipLinea({ activa, apagada, onClick, children }: { activa: boolean; apagada?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={activa}
      className={`text-[13px] px-3 py-1.5 rounded-lg border tabular-nums transition-colors duration-150 ${activa ? 'border-marca bg-marca-suave text-marca font-medium dark:bg-teal-950/40 dark:border-teal-700 dark:text-teal-300' : apagada ? 'border-linea bg-slate-50 text-slate-400 hover:border-slate-300 dark:bg-slate-800/40 dark:border-slate-800' : 'border-linea bg-white text-tinta-2 hover:border-slate-300 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300'}`}>
      {children}
    </button>
  );
}

export function ProductosV4({ informe, codigo }: { informe: any; codigo: string }) {
  const prod = informe.productos || {};
  const s = informe.score || {};
  const items: any[] = useMemo(() => (Array.isArray(prod.items) ? prod.items : []), [prod.items]);
  const lineasNivel: any[] = Array.isArray(s.lineas) ? s.lineas : [];
  const porLineaPres: any[] = Array.isArray(informe.presupuesto?.por_linea_interpretado) ? informe.presupuesto.por_linea_interpretado : [];
  const conteo = prod.conteo_cruzado;
  const requisitos: any[] = Array.isArray(prod.requisitos_generales) ? prod.requisitos_generales : [];
  // En una licitación GLOBAL (suma alzada) L1..Ln son solo el N° de cada producto en las bases: no se cotizan aparte.
  const esGlobal = String(informe.modalidad?.tipo || '').toLowerCase() === 'suma_alzada';
  const lineas = useMemo(() => [...new Set(items.map(it => String(it?.linea || 'L1')))].sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, ''))), [items]);
  const [lineaSel, setLineaSel] = useState('todas');
  const [filtro, setFiltro] = useState<FiltroProd>('todos');
  const [q, setQ] = useState('');
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set());

  const esEsp = (p: any) => String(p.clasificacion || '').toLowerCase().startsWith('espec');
  const conAlerta = (p: any) => Array.isArray(p.caracteristicas_no_encontradas) && p.caracteristicas_no_encontradas.length > 0;
  const tieneDetalle = (p: any) => (Array.isArray(p.caracteristicas) && p.caracteristicas.length > 0) || conAlerta(p);
  const porLinea = lineaSel === 'todas' || esGlobal ? items : items.filter(it => String(it?.linea) === lineaSel);
  const cuentas = { todos: porLinea.length, especificos: porLinea.filter(esEsp).length, libre: porLinea.filter(p => p.libertad_de_oferta).length, alertas: porLinea.filter(conAlerta).length };
  const nq = _norm(q.trim());
  const visibles = porLinea.filter(p => {
    if (filtro === 'especificos' && !esEsp(p)) return false;
    if (filtro === 'libre' && !p.libertad_de_oferta) return false;
    if (filtro === 'alertas' && !conAlerta(p)) return false;
    return !nq || _norm(`${p.nombre || ''} ${p.marca_modelo_referencia || ''} ${p.linea || ''}`).includes(nq);
  });
  const alternar = (i: number) => setAbiertos(prev => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const conDetalle = visibles.filter(tieneDetalle).map(p => items.indexOf(p));
  const todosAbiertos = conDetalle.length > 0 && conDetalle.every(i => abiertos.has(i));

  const tiles: Array<{ id: FiltroProd; rotulo: string; n: number; tono: TonoAdm }> = [
    { id: 'todos', rotulo: 'Productos a cotizar', n: cuentas.todos, tono: 'gris' },
    { id: 'especificos', rotulo: 'Específicos', n: cuentas.especificos, tono: 'gris' },
    { id: 'libre', rotulo: 'Libertad de oferta', n: cuentas.libre, tono: cuentas.libre ? 'verde' : 'gris' },
    { id: 'alertas', rotulo: 'Por revisar', n: cuentas.alertas, tono: cuentas.alertas ? 'ambar' : 'verde' },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 @2xl:grid-cols-4 gap-3">
        {tiles.map((tl, k) => (
          <TarjetaFiltro key={tl.id} i={k} rotulo={tl.rotulo} n={tl.n} tono={tl.tono} activa={filtro === tl.id && tl.id !== 'todos'} onClick={() => setFiltro(f => f === tl.id ? 'todos' : tl.id)} />
        ))}
      </div>

      <Bloque i={1} icon={<Package size={18} />} titulo="Productos a cotizar" subtitulo="Toca un producto para ver su ficha técnica."
        derecha={(
          <div className="flex items-center gap-4 flex-shrink-0">
            {conDetalle.length > 1 && (
              <button type="button" onClick={() => setAbiertos(todosAbiertos ? new Set() : new Set(conDetalle))}
                className="text-[13px] font-medium text-marca hover:text-marca-fuerte whitespace-nowrap">{todosAbiertos ? 'Contraer todos' : 'Expandir todos'}</button>
            )}
            {conteo && <span title="Productos encontrados de los que declaran las bases" className={`text-[13px] font-medium tabular-nums whitespace-nowrap ${conteo.cuadra === false ? 'text-alerta' : 'text-tinta-2 dark:text-slate-400'}`}>{conteo.final} de {conteo.declarado ?? conteo.final}</span>}
          </div>
        )}>
        <div className="space-y-3">
          {conteo && conteo.cuadra === false && <p className="flex items-start gap-1.5 text-[13px] text-amber-900 bg-amber-50 rounded-xl px-4 py-3 dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle size={15} className="flex-shrink-0 mt-0.5 text-alerta" />El conteo no cuadra: {conteo.detalle}</p>}

          {lineasNivel.length > 1 ? (
            <div className="flex flex-wrap gap-1.5">
              <ChipLinea activa={lineaSel === 'todas'} onClick={() => setLineaSel('todas')}>Todas</ChipLinea>
              {lineasNivel.map((l: any) => (
                <ChipLinea key={l.linea} activa={lineaSel === l.linea} apagada={!l.viable} onClick={() => setLineaSel(l.linea)}>
                  <span className="font-medium">{l.linea}</span> · {l.presupuesto_neto != null ? `${fmt(l.presupuesto_neto)} neto` : 'sin monto'} · {l.viable ? mayus((NIVEL_VISTA[l.nivel]?.label || l.nivel || '').toLowerCase()) : 'No viable'}
                </ChipLinea>
              ))}
            </div>
          ) : lineas.length > 1 && !esGlobal ? (
            <div className="flex flex-wrap gap-1.5">
              {['todas', ...lineas].map(l => {
                const mp = porLineaPres.find((x: any) => x.linea === l);
                return <ChipLinea key={l} activa={lineaSel === l} onClick={() => setLineaSel(l)}>{l === 'todas' ? 'Todas' : <><span className="font-medium">{l}</span>{mp ? ` · ${fmt(mp.monto_pesos)}` : ''}</>}</ChipLinea>;
              })}
            </div>
          ) : null}

          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar producto, marca o línea" aria-label="Buscar producto"
              className="w-full h-10 pl-9 pr-9 rounded-xl border border-linea bg-white text-[13.5px] text-tinta placeholder:text-slate-400 focus:outline-none focus:border-marca focus:ring-2 focus:ring-marca/15 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-100" />
            {q && <button type="button" onClick={() => setQ('')} aria-label="Borrar búsqueda" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={16} /></button>}
          </div>

          <div className="rounded-xl border border-linea overflow-hidden dark:border-slate-800">
            <div className="hidden @2xl:grid grid-cols-[48px_1fr_120px_110px_24px] gap-x-3 px-4 py-2.5 bg-slate-50 text-xs font-medium text-tinta-2 dark:bg-slate-800/60 dark:text-slate-400">
              <span>Línea</span><span>Producto</span><span className="text-right">Cantidad</span><span>Tipo</span><span />
            </div>
            <div className="divide-y divide-linea/80 dark:divide-slate-800">
              {visibles.length === 0 && <p className="px-4 py-8 text-center text-[13px] text-tinta-2 dark:text-slate-400">{items.length === 0 ? 'El análisis no encontró productos.' : 'Ningún producto coincide con la búsqueda o el filtro.'}</p>}
              {visibles.map(p => {
                const idx = items.indexOf(p);
                return <FilaProducto key={idx} p={p} abierta={abiertos.has(idx)} onToggle={() => alternar(idx)} codigo={codigo} informe={informe} />;
              })}
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="tabular-nums">{visibles.length === porLinea.length ? `${porLinea.length} ${porLinea.length === 1 ? 'producto' : 'productos'}` : `${visibles.length} de ${porLinea.length} productos`}</span>
            {items.some(p => p.unidad_inferida) && <span>* Unidad de medida no indicada en las bases</span>}
          </div>
        </div>
      </Bloque>

      {requisitos.length > 0 && (
        <Bloque i={2} icon={<ClipboardCheck size={18} />} titulo="Requisitos generales de los productos" subtitulo="Garantía, capacitación, manuales, certificados, mantenciones… Van al bloque técnico-administrativo del auditor."
          derecha={<span className="text-[13px] font-medium tabular-nums text-tinta-2 dark:text-slate-400">{requisitos.length}</span>}>
          <ul className="divide-y divide-linea/80 dark:divide-slate-800">
            {requisitos.map((r: any, i: number) => (
              <li key={i} className="py-3 first:pt-0 last:pb-0 flex items-start gap-2.5">
                <Check size={16} className="text-marca flex-shrink-0 mt-0.5" />
                <div className="min-w-0 space-y-1">
                  <p className="text-[13.5px] text-tinta-2 dark:text-slate-300 leading-snug">{r.producto ? <span className="font-semibold text-tinta dark:text-slate-100">{mayus(r.producto)}: </span> : null}{mayus(r.texto)}</p>
                  {r.cita && <Cita cita={r.cita} />}
                </div>
              </li>
            ))}
          </ul>
        </Bloque>
      )}
    </div>
  );
}

// ─── Preparación: lo que hay que tener listo para postular ─────────────────────────────────
function Vacio({ texto }: { texto: string }) {
  return <p className="rounded-xl bg-slate-50/80 px-4 py-4 text-center text-[13px] text-tinta-2 dark:bg-slate-800/40 dark:text-slate-400">{texto}</p>;
}

const nDocs = (n: number, uno: string, varios: string) => n ? `${n} ${n === 1 ? uno : varios}` : 'Ninguno';

export function PreparacionV4({ informe }: { informe: any }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const adm = informe.requisitos_admisibilidad || {};
  const acc = informe.acciones_y_advertencias || {};
  const documentos: any[] = Array.isArray(adm.documentos_solicitados) ? adm.documentos_solicitados : [];
  const anexosOrg = documentos.filter(d => d?.anexo_del_organismo);
  const docsEmpresa = documentos.filter(d => !d?.anexo_del_organismo);
  const aCrear: any[] = Array.isArray(adm.documentos_a_crear) ? adm.documentos_a_crear : [];
  const acciones: any[] = Array.isArray(acc.acciones) ? acc.acciones : [];
  const advertencias: any[] = Array.isArray(acc.advertencias) ? acc.advertencias : [];
  const resumen: Array<{ rotulo: string; valor: string; tono: TonoAdm; destino: string }> = [
    { rotulo: 'Documentos de empresa', valor: nDocs(docsEmpresa.length, 'documento', 'documentos'), tono: 'gris', destino: `${uid}-empresa` },
    { rotulo: 'Anexos del organismo', valor: nDocs(anexosOrg.length, 'anexo', 'anexos'), tono: 'gris', destino: `${uid}-anexos` },
    { rotulo: 'Documentos a crear', valor: nDocs(aCrear.length, 'documento', 'documentos'), tono: 'gris', destino: `${uid}-crear` },
    { rotulo: 'Advertencias', valor: advertencias.length ? `${advertencias.length} ${advertencias.length === 1 ? 'advertencia' : 'advertencias'}` : 'Ninguna', tono: advertencias.length ? 'ambar' : 'verde', destino: `${uid}-acciones` },
  ];
  return (
    <div className="space-y-3">
      <ResumenAdm items={resumen} />

      {(acciones.length > 0 || advertencias.length > 0) && (
        <div id={`${uid}-acciones`} className="scroll-mt-4">
          <Bloque i={1} icon={<Target size={18} />} titulo="Acciones y advertencias" subtitulo="Qué hacer para postular y qué cuidar en el camino.">
            <div className="grid grid-cols-1 @4xl:grid-cols-2 gap-3 items-start">
              {acciones.length > 0 && (
                <div className="rounded-xl bg-slate-50/80 p-4 dark:bg-slate-800/40">
                  <p className="flex items-center gap-2 text-[15px] font-semibold text-tinta dark:text-slate-50 mb-3"><Check size={17} className="text-exito" />Para postular <span className="text-[13px] font-medium tabular-nums text-tinta-2 dark:text-slate-400">{acciones.length}</span></p>
                  <ol className="space-y-3">{acciones.map((a, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-lg bg-white text-marca text-[12px] font-semibold tabular-nums flex items-center justify-center shadow-tarjeta dark:bg-slate-900">{i + 1}</span>
                      <div className="min-w-0 space-y-1">
                        <p className="text-[14px] font-medium text-tinta dark:text-slate-100 leading-snug pt-px">{oracion(a.orden)}</p>
                        {a.por_que && <p className="text-[13px] text-tinta-2 dark:text-slate-400 leading-snug">{oracion(a.por_que)}</p>}
                        {a.cita && <Cita cita={a.cita} />}
                      </div>
                    </li>
                  ))}</ol>
                </div>
              )}
              {advertencias.length > 0 && (
                <div className="rounded-xl bg-amber-50/70 p-4 dark:bg-amber-950/20">
                  <p className="flex items-center gap-2 text-[15px] font-semibold text-tinta dark:text-slate-50 mb-3"><AlertTriangle size={17} className="text-alerta" />Advertencias <span className="text-[13px] font-medium tabular-nums text-tinta-2 dark:text-slate-400">{advertencias.length}</span></p>
                  <ul className="space-y-3">{advertencias.map((a, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span aria-hidden className="flex-shrink-0 w-2 h-2 rounded-full mt-[7px]" style={{ background: TONO_ADM.ambar }} />
                      <div className="min-w-0 space-y-1">
                        <p className="text-[14px] font-medium text-tinta dark:text-slate-100 leading-snug">{oracion(a.riesgo)}</p>
                        {a.consecuencia && <p className="text-[13px] text-amber-900 dark:text-amber-200/90 leading-snug">{oracion(a.consecuencia)}</p>}
                        {a.cita && <Cita cita={a.cita} />}
                      </div>
                    </li>
                  ))}</ul>
                </div>
              )}
            </div>
          </Bloque>
        </div>
      )}

      <div id={`${uid}-empresa`} className="scroll-mt-4">
        <Bloque i={2} icon={<ClipboardCheck size={18} />} titulo="Documentos de empresa" subtitulo="Estatuto, vigencia, certificados y otros papeles que la empresa debe tener al día."
          derecha={docsEmpresa.length ? <span className="text-[13px] font-medium tabular-nums text-tinta-2 dark:text-slate-400">{docsEmpresa.length}</span> : undefined}>
          {docsEmpresa.length === 0 ? <Vacio texto="Las bases no piden documentos de empresa aparte de los anexos." /> : (
            <ul className="divide-y divide-linea/80 rounded-xl border border-linea overflow-hidden dark:border-slate-800 dark:divide-slate-800">
              {docsEmpresa.map((d, i) => (
                <li key={i} className="px-4 py-3 flex flex-col @xl:flex-row @xl:items-start gap-x-3 gap-y-1.5 transition-colors duration-150 hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <div className="min-w-0 flex-1 flex items-start gap-3">
                    <Check size={16} className="text-marca flex-shrink-0 mt-0.5" />
                    <div className="min-w-0 space-y-1">
                      <p className="text-[14px] font-medium text-tinta dark:text-slate-100 leading-snug">{oracion(d.nombre)}</p>
                      {d.cita && <Cita cita={d.cita} />}
                    </div>
                  </div>
                  {d.antiguedad_maxima && <span title="Antigüedad máxima del documento" className="flex-shrink-0 pl-7 @xl:pl-0"><Marca color="#d97706">Antigüedad máx. {d.antiguedad_maxima}</Marca></span>}
                </li>
              ))}
            </ul>
          )}
        </Bloque>
      </div>

      <div id={`${uid}-anexos`} className="scroll-mt-4">
        <Bloque i={3} icon={<Package size={18} />} titulo="Anexos del organismo" subtitulo="Formularios que publica el organismo y hay que completar y firmar."
          derecha={anexosOrg.length ? <span className="text-[13px] font-medium tabular-nums text-tinta-2 dark:text-slate-400">{anexosOrg.length}</span> : undefined}>
          {anexosOrg.length === 0 ? <Vacio texto="No se detectaron anexos del organismo." /> : (
            <ul className="divide-y divide-linea/80 rounded-xl border border-linea overflow-hidden dark:border-slate-800 dark:divide-slate-800">
              {anexosOrg.map((d, i) => (
                <li key={i} className="px-4 py-3 flex flex-col @xl:flex-row @xl:items-start gap-x-3 gap-y-1.5 transition-colors duration-150 hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <div className="min-w-0 flex-1 flex items-start gap-3">
                    <Pencil size={16} className="text-slate-400 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0 space-y-1">
                      <p className="text-[14px] font-medium text-tinta dark:text-slate-100 leading-snug">{oracion(d.nombre)}</p>
                      {d.cita && <Cita cita={d.cita} />}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 flex-wrap pl-7 @xl:pl-0 @xl:justify-end">
                    {d.copias && <span className="text-[12.5px] text-tinta-2 dark:text-slate-400">{mayus(String(d.copias))}</span>}
                    {d._agregado_por_cruce && <span title="Publicado por el organismo; el análisis no lo listó. Confirma en las bases si es obligatorio."><Marca color="#d97706">Por cruce</Marca></span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Bloque>
      </div>

      <div id={`${uid}-crear`} className="scroll-mt-4">
        <Bloque i={4} icon={<Pencil size={18} />} titulo="Documentos a crear" subtitulo="Documentos propios que hay que redactar para esta oferta."
          derecha={aCrear.length ? <span className="text-[13px] font-medium tabular-nums text-tinta-2 dark:text-slate-400">{aCrear.length}</span> : undefined}>
          {aCrear.length === 0 ? <Vacio texto="No hay documentos propios que crear." /> : (
            <div className="grid grid-cols-1 @4xl:grid-cols-2 gap-3 items-stretch">
              {aCrear.map((d, i) => (
                <Aparece key={i} i={i + 5} alto>
                  <div className="rounded-xl bg-slate-50/80 p-4 h-full flex flex-col gap-3 dark:bg-slate-800/40">
                    <div className="flex items-start gap-3">
                      <span className="w-8 h-8 rounded-lg bg-white text-slate-500 flex items-center justify-center flex-shrink-0 shadow-tarjeta dark:bg-slate-900 dark:text-slate-400"><Pencil size={15} /></span>
                      <p className="text-[15px] font-semibold text-tinta dark:text-slate-50 leading-snug pt-1">{oracion(d.que_crear)}</p>
                    </div>
                    {d.contenido_exigido && (
                      <div className="pt-3 border-t border-linea/80 dark:border-slate-700/60">
                        <p className="text-[11px] text-slate-500">Contenido exigido</p>
                        <p className="text-[13.5px] text-tinta-2 dark:text-slate-300 leading-snug mt-0.5">{mayus(d.contenido_exigido)}</p>
                      </div>
                    )}
                    {d.cita && <div className="mt-auto"><Cita cita={d.cita} /></div>}
                  </div>
                </Aparece>
              ))}
            </div>
          )}
        </Bloque>
      </div>
    </div>
  );
}
