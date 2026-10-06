'use client';

// Gasto de IA por perfil (admin). Quién consume más IA, en qué módulo (viabilidad, consultas/chat,
// auditor, anexos, compras…), con qué modelo y en qué licitaciones. Lee /api/admin/gasto-ia, que sale
// de la tabla ia_uso (migration-139): una fila por llamada al modelo de texto, con el costo en USD
// calculado con las mismas tarifas de la consola del servidor (gemini.ts → tarifaModelo).
// Las llamadas hechas SIN petición de un usuario (cron, scheduler, "al asignar") van a "Automático".
// Solo admin (proxy.ts bloquea /admin/*).
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { StatCard } from '@/app/components/ui/StatCard';
import { ChartCard } from '@/app/components/ui/ChartCard';
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import {
  IconCoin as Coin, IconBolt as Bolt, IconUsers as Users, IconCpu as Cpu, IconLoader2 as Loader2, IconRefresh as Refresh,
  IconChevronDown as ChevronDown, IconAlertTriangle as Alerta, IconRobot as Robot, IconReceipt2 as Receipt, IconDatabaseOff as SinTabla,
} from '@tabler/icons-react';
import { colorUsuario, inicialesUsuario } from '@/app/lib/user-color';

interface ModuloGasto { modulo: string; llamadas: number; costo: number }
interface Perfil { usuario_id: number | null; nombre: string; email: string | null; empresa: string | null; rol: string | null; llamadas: number; costo: number; tokens_in: number; tokens_out: number; ultima: string | null; modulos: ModuloGasto[] }
interface Datos {
  rango: { desde: string; hasta: string };
  totales: { llamadas: number; costo: number; tokens_in: number; tokens_out: number; usuarios: number; llamadas_respaldo: number; licitaciones: number };
  por_usuario: Perfil[];
  por_modulo: { modulo: string; nombre: string; llamadas: number; costo: number; tokens_in: number; tokens_out: number }[];
  por_modelo: { modelo: string; proveedor: string; llamadas: number; costo: number; tokens_in: number; tokens_out: number; llamadas_respaldo: number }[];
  por_dia: { dia: string; llamadas: number; costo: number }[];
  por_licitacion: { codigo: string; llamadas: number; costo: number; tokens: number }[];
  recientes: { id: number; fecha: string; nombre: string; modulo: string; codigo: string | null; modelo: string; respaldo: boolean; tokens_in: number; tokens_out: number; costo: number; ms: number }[];
}

// Un color fijo por módulo (los mismos en la barra apilada de cada perfil, el donut y los chips).
const COLOR_MODULO: Record<string, string> = {
  viabilidad: '#4f46e5', consultas: '#0891b2', auditor: '#7c3aed', anexos: '#d97706',
  compras: '#059669', costeo: '#e11d48', prefiltro: '#2563eb', otros: '#94a3b8',
};
const NOMBRE_MODULO: Record<string, string> = {
  viabilidad: 'Viabilidad', consultas: 'Consultas / chat', auditor: 'Auditor', anexos: 'Anexos',
  compras: 'Compras', costeo: 'Costeo y precios', prefiltro: 'Prefiltro', otros: 'Otros',
};
const colMod = (m: string) => COLOR_MODULO[m] || COLOR_MODULO.otros;

const usd = (n: number) => `US$ ${n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(3)}`;
const nf = (n: number) => new Intl.NumberFormat('es-CL').format(Math.round(n));
const tok = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)} k` : String(Math.round(n));
const fechaHora = (s: string) => new Date(s).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
const diaCorto = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;

const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
const restarDias = (iso: string, d: number) => { const x = new Date(`${iso}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - d); return x.toISOString().slice(0, 10); };

const PRESETS = [
  { key: '7', label: '7 días', dias: 6 }, { key: '30', label: '30 días', dias: 29 },
  { key: '90', label: '90 días', dias: 89 }, { key: 'mes', label: 'Este mes', dias: -1 },
] as const;

export default function GastoIAPage() {
  const [desde, setDesde] = useState(() => restarDias(hoyISO(), 29));
  const [hasta, setHasta] = useState(hoyISO);
  const [preset, setPreset] = useState<string>('30');
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [faltaMigracion, setFaltaMigracion] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [moduloSel, setModuloSel] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/gasto-ia?desde=${desde}&hasta=${hasta}`);
      const d = await r.json();
      if (d.falta_migracion) { setFaltaMigracion(true); setDatos(null); setError(null); }
      else if (!r.ok || !d.success) throw new Error(d.error || `Error ${r.status}`);
      else { setFaltaMigracion(false); setError(null); setDatos(d); }
    } catch (e) { setError(String((e as Error).message || e)); } finally { setCargando(false); }
  }, [desde, hasta]);
  useEffect(() => { cargar(); }, [cargar]);

  const elegirPreset = (p: typeof PRESETS[number]) => {
    const h = hoyISO(); setCargando(true); setPreset(p.key); setHasta(h);
    setDesde(p.dias < 0 ? `${h.slice(0, 7)}-01` : restarDias(h, p.dias));
  };

  const perfiles = useMemo(() => {
    if (!datos) return [];
    // con un módulo elegido el ranking se recalcula solo con ese módulo
    return datos.por_usuario
      .map(p => moduloSel ? { ...p, costo: p.modulos.find(m => m.modulo === moduloSel)?.costo ?? 0, llamadas: p.modulos.find(m => m.modulo === moduloSel)?.llamadas ?? 0 } : p)
      .filter(p => p.costo > 0 || p.llamadas > 0)
      .sort((a, b) => b.costo - a.costo);
  }, [datos, moduloSel]);
  const maxCosto = perfiles[0]?.costo || 1;
  const totalVista = perfiles.reduce((a, p) => a + p.costo, 0) || 1;
  const t = datos?.totales;

  return (
    <AppLayout breadcrumb={[{ label: 'Admin', href: '/admin/usuarios' }, { label: 'Gasto de IA' }]}>
      <div className="p-4 sm:p-6 lg:p-8 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Coin size={26} className="text-indigo-600" /> Gasto de IA por perfil
            </h1>
            <p className="text-sm text-slate-500 mt-0.5 max-w-2xl">
              Cuánto consume cada perfil de los modelos de IA (viabilidad, consultas a los documentos, auditor, anexos, compras…). Costo estimado en dólares con las tarifas de cada modelo.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {PRESETS.map(p => (
              <button key={p.key} onClick={() => elegirPreset(p)}
                className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold transition-colors ${preset === p.key
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 dark:bg-white/[0.04] dark:text-slate-300 dark:border-white/10'}`}>
                {p.label}
              </button>
            ))}
            <input type="date" value={desde} max={hasta} onChange={e => { setDesde(e.target.value); setPreset('x'); }}
              className="px-2 py-1.5 rounded-lg text-[12.5px] border border-slate-200 bg-white dark:bg-white/[0.04] dark:border-white/10 dark:text-slate-200" />
            <span className="text-slate-400 text-xs">a</span>
            <input type="date" value={hasta} min={desde} onChange={e => { setHasta(e.target.value); setPreset('x'); }}
              className="px-2 py-1.5 rounded-lg text-[12.5px] border border-slate-200 bg-white dark:bg-white/[0.04] dark:border-white/10 dark:text-slate-200" />
            <button onClick={() => { setCargando(true); cargar(); }} title="Actualizar" className="p-2 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:bg-white/[0.04] dark:border-white/10">
              <Refresh size={15} className={cargando ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {faltaMigracion && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/30 p-4 flex gap-3 text-[13px] text-amber-900 dark:text-amber-200">
            <SinTabla size={20} className="shrink-0 mt-0.5" />
            <div>Falta crear la tabla donde se guarda el gasto. Corre una vez <code className="font-mono bg-white/70 dark:bg-black/30 px-1.5 py-0.5 rounded">node scripts/aplicar-migration-139.mjs</code> y recarga.</div>
          </div>
        )}
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] text-red-700 flex gap-2"><Alerta size={16} className="mt-0.5" />{error}</div>}

        {cargando && !datos ? (
          <div className="flex justify-center py-20"><Loader2 className="animate-spin text-slate-400" /></div>
        ) : datos && t && (
          <>
            {t.llamadas === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 dark:border-white/15 bg-white dark:bg-white/[0.03] py-14 text-center text-slate-500 text-sm">
                <Robot size={34} className="mx-auto mb-2 text-slate-300" />
                Todavía no hay consumo registrado en este rango.<br />
                <span className="text-slate-400">El gasto se empieza a guardar desde que se aplicó el registro: cada análisis o consulta nueva aparecerá aquí.</span>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                  <StatCard icon={<Coin size={22} />} label="Gasto total" value={usd(t.costo)} color="indigo"
                    sub={`${datos.rango.desde.slice(5)} → ${datos.rango.hasta.slice(5)}`}
                    spec={{ mide: 'Cuánto costaron en total las llamadas a los modelos de IA en el rango elegido.', calculo: 'Suma, por cada llamada exitosa, tokens de entrada × tarifa de entrada + tokens de salida × tarifa de salida del modelo que respondió (las mismas tarifas que imprime la consola del servidor).', fuente: 'ia_uso.costo_usd', nota: 'Es una estimación con tarifas públicas, no la factura del proveedor. No incluye el OCR de documentos escaneados.' }} />
                  <StatCard icon={<Bolt size={22} />} label="Llamadas a la IA" value={t.llamadas} color="violet"
                    sub={`${t.llamadas_respaldo} con modelo de respaldo`} />
                  <StatCard icon={<Cpu size={22} />} label="Tokens procesados" value={tok(t.tokens_in + t.tokens_out)} color="teal"
                    sub={`${tok(t.tokens_in)} entrada · ${tok(t.tokens_out)} salida`} />
                  <StatCard icon={<Receipt size={22} />} label="Costo por llamada" value={usd(t.costo / Math.max(1, t.llamadas))} color="amber"
                    sub={`${t.licitaciones} licitaciones tocadas`} />
                  <StatCard icon={<Users size={22} />} label="Perfiles que gastaron" value={t.usuarios} color="emerald"
                    sub={datos.por_usuario.some(p => p.usuario_id == null) ? 'más procesos automáticos' : 'sin procesos automáticos'} />
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-[1.35fr_1fr] gap-4 items-start">
                  {/* RANKING DE PERFILES */}
                  <div className="bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.07] rounded-2xl p-4 sm:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                      <h3 className="text-[13.5px] font-bold text-slate-800 dark:text-slate-100">Quién gasta más</h3>
                      <div className="flex flex-wrap gap-1">
                        <button onClick={() => setModuloSel(null)} className={`px-2 py-1 rounded-md text-[11px] font-semibold ${!moduloSel ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300'}`}>Todos</button>
                        {datos.por_modulo.map(m => (
                          <button key={m.modulo} onClick={() => setModuloSel(moduloSel === m.modulo ? null : m.modulo)}
                            className="px-2 py-1 rounded-md text-[11px] font-semibold border transition-colors"
                            style={moduloSel === m.modulo ? { background: colMod(m.modulo), color: '#fff', borderColor: colMod(m.modulo) } : { color: colMod(m.modulo), borderColor: `${colMod(m.modulo)}55` }}>
                            {NOMBRE_MODULO[m.modulo] || m.nombre}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                      {perfiles.map((p, i) => {
                        const key = String(p.usuario_id ?? 'sistema');
                        const color = p.usuario_id == null ? '#64748b' : colorUsuario(p.usuario_id);
                        const abre = abierto === key;
                        const tot = p.modulos.reduce((a, m) => a + m.costo, 0) || 1;
                        return (
                          <div key={key} className="py-2.5">
                            <button onClick={() => setAbierto(abre ? null : key)} className="w-full text-left">
                              <div className="flex items-center gap-3">
                                <span className="w-5 text-[11px] font-bold text-slate-400 text-right">{i + 1}</span>
                                <span className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0" style={{ background: color }}>
                                  {p.usuario_id == null ? <Robot size={16} /> : inicialesUsuario(p.nombre, p.email)}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-baseline justify-between gap-2">
                                    <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 truncate">
                                      {p.nombre}
                                      {p.rol === 'admin' && <span className="ml-1.5 text-[10px] font-bold uppercase text-indigo-600">admin</span>}
                                    </p>
                                    <p className="text-[13px] font-bold text-slate-900 dark:text-slate-50 tabular-nums">{usd(p.costo)}</p>
                                  </div>
                                  <div className="mt-1 h-2 rounded-full bg-slate-100 dark:bg-white/[0.06] overflow-hidden flex" style={{ width: `${Math.max(4, (p.costo / maxCosto) * 100)}%` }}>
                                    {p.modulos.map(m => <div key={m.modulo} title={`${NOMBRE_MODULO[m.modulo] || m.modulo}: ${usd(m.costo)}`} style={{ width: `${(m.costo / tot) * 100}%`, background: colMod(m.modulo) }} />)}
                                  </div>
                                  <p className="text-[11px] text-slate-400 mt-1">
                                    {((p.costo / totalVista) * 100).toFixed(0)}% del gasto · {nf(p.llamadas)} llamadas{p.empresa ? ` · ${p.empresa}` : ''}
                                  </p>
                                </div>
                                <ChevronDown size={15} className={`text-slate-400 transition-transform ${abre ? 'rotate-180' : ''}`} />
                              </div>
                            </button>
                            {abre && (
                              <div className="ml-16 mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                                {p.modulos.map(m => (
                                  <div key={m.modulo} className="flex items-center gap-2 text-[12px]">
                                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: colMod(m.modulo) }} />
                                    <span className="text-slate-600 dark:text-slate-300">{NOMBRE_MODULO[m.modulo] || m.modulo}</span>
                                    <span className="ml-auto tabular-nums font-semibold text-slate-800 dark:text-slate-100">{usd(m.costo)}</span>
                                    <span className="text-slate-400 w-16 text-right">{nf(m.llamadas)} ll.</span>
                                  </div>
                                ))}
                                <p className="sm:col-span-2 text-[11px] text-slate-400 mt-1">
                                  {tok(p.tokens_in + p.tokens_out)} tokens{p.ultima ? ` · última llamada ${fechaHora(p.ultima)}` : ''}
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {perfiles.length === 0 && <p className="py-8 text-center text-sm text-slate-400">Nadie gastó en este módulo en el rango.</p>}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <ChartCard title="Por módulo" sub="en qué se va la plata">
                      <div className="flex items-center gap-3">
                        <div className="w-[150px] h-[150px] shrink-0">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie data={datos.por_modulo} dataKey="costo" nameKey="nombre" innerRadius={42} outerRadius={70} paddingAngle={2} stroke="none">
                                {datos.por_modulo.map(m => <Cell key={m.modulo} fill={colMod(m.modulo)} />)}
                              </Pie>
                              <Tooltip formatter={(v) => usd(Number(v))} />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="flex-1 space-y-1.5 min-w-0">
                          {datos.por_modulo.map(m => (
                            <div key={m.modulo} className="flex items-center gap-2 text-[12px]">
                              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: colMod(m.modulo) }} />
                              <span className="truncate text-slate-600">{NOMBRE_MODULO[m.modulo] || m.nombre}</span>
                              <span className="ml-auto tabular-nums font-semibold text-slate-800">{usd(m.costo)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </ChartCard>
                    <ChartCard title="Por modelo" sub="quién responde de verdad (respaldos incluidos)">
                      <div className="space-y-2">
                        {datos.por_modelo.map(m => (
                          <div key={m.modelo} className="text-[12px]">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-mono text-slate-700 truncate">{m.modelo}</span>
                              <span className="tabular-nums font-semibold text-slate-800">{usd(m.costo)}</span>
                            </div>
                            <p className="text-[11px] text-slate-400">{nf(m.llamadas)} llamadas · {tok(m.tokens_in + m.tokens_out)} tokens{m.llamadas_respaldo ? ` · ${m.llamadas_respaldo} como respaldo` : ''}</p>
                          </div>
                        ))}
                      </div>
                    </ChartCard>
                  </div>
                </div>

                <ChartCard title="Gasto por día" sub="USD estimados">
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={datos.por_dia.map(d => ({ ...d, etiqueta: diaCorto(d.dia) }))} margin={{ left: 0, right: 8, top: 6 }}>
                        <defs><linearGradient id="gGasto" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4f46e5" stopOpacity={0.35} /><stop offset="100%" stopColor="#4f46e5" stopOpacity={0} /></linearGradient></defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="etiqueta" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => `$${Number(v).toFixed(v >= 1 ? 0 : 2)}`} />
                        <Tooltip formatter={(v, n) => n === 'costo' ? [usd(Number(v)), 'Gasto'] : [v, 'Llamadas']} labelFormatter={(l) => `Día ${l}`} />
                        <Area type="monotone" dataKey="costo" stroke="#4f46e5" strokeWidth={2} fill="url(#gGasto)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </ChartCard>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
                  <ChartCard title="Licitaciones que más IA consumieron" sub="viabilidad y demás análisis atados a una licitación">
                    {datos.por_licitacion.length === 0 ? <p className="text-sm text-slate-400 py-4">Sin licitaciones en el rango.</p> : (
                      <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={datos.por_licitacion} layout="vertical" margin={{ left: 8, right: 16 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                            <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${Number(v).toFixed(2)}`} />
                            <YAxis type="category" dataKey="codigo" width={120} tick={{ fontSize: 11, fill: '#475569' }} tickLine={false} axisLine={false} />
                            <Tooltip formatter={(v) => usd(Number(v))} />
                            <Bar dataKey="costo" fill="#7c3aed" radius={[0, 6, 6, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </ChartCard>

                  <ChartCard title="Últimas llamadas" sub="las 40 más recientes del rango">
                    <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                      <table className="w-full text-[11.5px]">
                        <thead className="sticky top-0 bg-white"><tr className="text-left text-slate-400">
                          <th className="py-1 pr-2 font-semibold">Cuándo</th><th className="pr-2 font-semibold">Quién</th><th className="pr-2 font-semibold">Módulo</th>
                          <th className="pr-2 font-semibold">Licitación</th><th className="pr-2 font-semibold text-right">Tokens</th><th className="font-semibold text-right">Costo</th>
                        </tr></thead>
                        <tbody className="divide-y divide-slate-100">
                          {datos.recientes.map(r => (
                            <tr key={r.id} title={`${r.modelo}${r.respaldo ? ' (respaldo)' : ''} · ${(r.ms / 1000).toFixed(1)}s`}>
                              <td className="py-1 pr-2 text-slate-500 whitespace-nowrap">{fechaHora(r.fecha)}</td>
                              <td className="pr-2 text-slate-700 max-w-[110px] truncate">{r.nombre}</td>
                              <td className="pr-2"><span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: colMod(r.modulo) }} />{NOMBRE_MODULO[r.modulo] || r.modulo}</span></td>
                              <td className="pr-2">{r.codigo ? <Link href={`/licitacion/${encodeURIComponent(r.codigo)}`} className="text-indigo-600 hover:underline">{r.codigo}</Link> : <span className="text-slate-300">—</span>}</td>
                              <td className="pr-2 text-right tabular-nums text-slate-500">{tok(r.tokens_in + r.tokens_out)}</td>
                              <td className="text-right tabular-nums font-semibold text-slate-800">{usd(r.costo)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </ChartCard>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
