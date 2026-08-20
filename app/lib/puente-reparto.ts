// app/lib/puente-reparto.ts
// MOTOR DE REPARTO DEL PUENTE — 100% puro y determinista (no toca BD, no hace red).
//
// POR QUÉ separado: la vista previa ("simular") y la ejecución ("repartir") DEBEN dar
// exactamente el mismo resultado, o el asesor confirma una cosa y ocurre otra. La única
// forma de garantizarlo es que ambas llamen a esta misma función con la misma entrada.
// Por eso el barajado no usa Math.random(): usa un PRNG con SEMILLA que viaja en la config.
// Simular devuelve la semilla; repartir la reenvía → mismo reparto, bit a bit.
//
// La primitiva que sostiene todas las estrategias es el NIVELADOR: cada licitación se le
// entrega al perfil con menor carga efectiva (= carga vigente que ya tenía + lo que lleva
// recibido en esta tanda). Con carga inicial 0 para todos, nivelar == repartir parejo
// (30 licitaciones / 3 perfiles = 10, 10, 10). Con la carga real de cada uno, nivelar ==
// emparejar de verdad (el que venía cargado recibe menos). Una sola primitiva, dos
// estrategias, cero código duplicado.

export type Estrategia =
  | 'equitativa'   // parejo: 30 entre 3 → 10/10/10 (ignora lo que ya tenían)
  | 'carga'        // nivelar la carga REAL vigente: el que tiene menos, recibe más
  | 'categoria'    // por línea de negocio (ferretería → Juan, aseo → Ana)
  | 'monto'        // por tramo de presupuesto
  | 'region'       // por región
  | 'viabilidad'   // por semáforo de la viabilidad IA
  | 'manual';      // uno por uno (lo que el asesor movió en la vista previa)

/** Licitación esperando dueño en el puente (datos congelados al entrar). */
export interface LicitacionPuente {
  id: number;
  licitacion_codigo: string;
  licitacion_nombre: string | null;
  licitacion_organismo: string | null;
  licitacion_monto: number | null;
  licitacion_cierre: string | null;
  licitacion_estado: string | null;
  licitacion_tipo: string | null;
  licitacion_region: string | null;
  categoria_nombre: string | null;
  viabilidad_semaforo: string | null;
}

/** Perfil candidato a recibir, con su carga VIGENTE actual (la que ya calcula /api/negocios). */
export interface PerfilDestino {
  id: number;
  nombre: string | null;
  email: string;
  cargaActual: number;
}

/** Regla "valor → perfil" para categoría / región / viabilidad. */
export interface ReglaValor { valor: string; usuarioId: number }

/** Tramo de monto (CLP). `desde` inclusivo, `hasta` exclusivo; null = sin tope por ese lado. */
export interface TramoMonto { desde: number | null; hasta: number | null; usuarioId: number }

export interface ConfigReparto {
  estrategia: Estrategia;
  /** Ids de los perfiles elegidos como destino. El orden desempata (determinismo). */
  perfiles: number[];
  reglas?: ReglaValor[];
  tramos?: TramoMonto[];
  /** Qué hacer con lo que ninguna regla alcanzó. Por defecto: repartir parejo. */
  fallback?: 'equitativa' | 'carga' | 'ninguno';
  /** Semilla del barajado. Simular la genera, repartir la reenvía. */
  semilla?: number;
  /** Estrategia 'manual': el reparto explícito hecho a mano en la vista previa. */
  manual?: { codigo: string; usuarioId: number }[];
}

export interface Adjudicacion {
  codigo: string;
  /** null = nadie se la llevó (sin perfiles, o regla sin match y fallback 'ninguno'). */
  usuarioId: number | null;
  /** Por qué le tocó a ese perfil — se muestra en la tarjeta de la vista previa. */
  motivo: string;
}

export interface ResumenPerfil {
  usuarioId: number;
  nombre: string | null;
  email: string;
  cargaAntes: number;
  asignadas: number;
  cargaDespues: number;
}

export interface ResultadoReparto {
  asignaciones: Adjudicacion[];
  /** Códigos que quedan en el puente porque nadie los tomó. */
  sinAsignar: string[];
  /** Resumen por perfil: cuántas le tocan y cómo queda su carga después. */
  porPerfil: ResumenPerfil[];
  semilla: number;
}

// ── PRNG con semilla (mulberry32) ───────────────────────────────────────────────
// Determinista y suficiente para barajar: no es criptografía, es "que salga igual dos veces".
function prng(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates con semilla — el "random" del reparto equitativo, reproducible. */
function barajar<T>(items: T[], rnd: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Normaliza para comparar categorías/regiones: sin tildes, sin mayúsculas, sin espacios de más. */
export function norm(s: string | null | undefined): string {
  return (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
}

/** Etiqueta legible del tramo, para el motivo y para la UI. */
export function etiquetaTramo(t: { desde: number | null; hasta: number | null }): string {
  const f = (n: number) => new Intl.NumberFormat('es-CL', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  if (t.desde == null && t.hasta == null) return 'cualquier monto';
  if (t.desde == null) return `hasta $${f(t.hasta!)}`;
  if (t.hasta == null) return `sobre $${f(t.desde)}`;
  return `$${f(t.desde)} – $${f(t.hasta)}`;
}

/**
 * REPARTE. Devuelve una adjudicación por licitación (usuarioId null = queda en el puente).
 * No muta las entradas. Mismo input + misma semilla ⇒ mismo output.
 */
export function repartir(
  licitaciones: LicitacionPuente[],
  perfilesDisponibles: PerfilDestino[],
  cfg: ConfigReparto,
): ResultadoReparto {
  const semilla = cfg.semilla ?? 1;
  const rnd = prng(semilla);

  // Solo los perfiles ELEGIDOS, en el orden en que el asesor los eligió (desempate estable).
  const porId = new Map(perfilesDisponibles.map(p => [p.id, p]));
  const destinos: PerfilDestino[] = cfg.perfiles
    .map(id => porId.get(id))
    .filter((p): p is PerfilDestino => !!p);

  if (destinos.length === 0) {
    return {
      asignaciones: licitaciones.map(l => ({ codigo: l.licitacion_codigo, usuarioId: null, motivo: 'sin perfiles de destino' })),
      sinAsignar: licitaciones.map(l => l.licitacion_codigo),
      porPerfil: [],
      semilla,
    };
  }

  // Carga efectiva de partida. 'carga' arranca de la carga vigente real; el resto arranca
  // de cero, que es lo que hace que "equitativa" salga exactamente pareja.
  const usaCargaReal = cfg.estrategia === 'carga' || cfg.fallback === 'carga';
  const contador = new Map<number, number>(destinos.map(p => [p.id, usaCargaReal ? p.cargaActual : 0]));
  const recibidas = new Map<number, number>(destinos.map(p => [p.id, 0]));

  /** Nivelador: entrega al perfil con menor carga efectiva; empate → el primero elegido. */
  const siguienteNivelado = (): PerfilDestino => {
    let mejor = destinos[0];
    let mejorN = contador.get(mejor.id)!;
    for (const p of destinos) {
      const n = contador.get(p.id)!;
      if (n < mejorN) { mejor = p; mejorN = n; }
    }
    return mejor;
  };

  const anotar = (usuarioId: number) => {
    contador.set(usuarioId, (contador.get(usuarioId) || 0) + 1);
    recibidas.set(usuarioId, (recibidas.get(usuarioId) || 0) + 1);
  };

  const asignaciones: Adjudicacion[] = [];
  const pendientes: LicitacionPuente[] = [];

  // ── 1) Reparto manual: gana sobre cualquier regla ──────────────────────────────
  if (cfg.estrategia === 'manual') {
    const mapa = new Map((cfg.manual || []).map(m => [m.codigo, m.usuarioId]));
    for (const l of licitaciones) {
      const uid = mapa.get(l.licitacion_codigo);
      if (uid != null && porId.has(uid)) {
        anotar(uid);
        asignaciones.push({ codigo: l.licitacion_codigo, usuarioId: uid, motivo: 'asignada a mano' });
      } else {
        asignaciones.push({ codigo: l.licitacion_codigo, usuarioId: null, motivo: 'sin perfil asignado a mano' });
      }
    }
    return armar(asignaciones, destinos, recibidas, semilla);
  }

  // ── 2) Estrategias por REGLA: lo que calza se asigna; lo demás cae al fallback ──
  const reglaPara = (l: LicitacionPuente): { usuarioId: number; motivo: string } | null => {
    const valido = (uid: number | undefined | null) => (uid != null && porId.has(uid) ? uid : null);

    if (cfg.estrategia === 'categoria' || cfg.estrategia === 'region' || cfg.estrategia === 'viabilidad') {
      const campo = cfg.estrategia === 'categoria' ? l.categoria_nombre
                  : cfg.estrategia === 'region'    ? l.licitacion_region
                  :                                  l.viabilidad_semaforo;
      const clave = norm(campo);
      if (!clave) return null;
      const r = (cfg.reglas || []).find(x => norm(x.valor) === clave);
      const uid = valido(r?.usuarioId);
      if (uid == null) return null;
      const etiqueta = cfg.estrategia === 'categoria' ? 'categoría' : cfg.estrategia === 'region' ? 'región' : 'viabilidad';
      return { usuarioId: uid, motivo: `${etiqueta}: ${campo}` };
    }

    if (cfg.estrategia === 'monto') {
      const m = l.licitacion_monto;
      if (m == null) return null;
      const t = (cfg.tramos || []).find(x =>
        (x.desde == null || m >= x.desde) && (x.hasta == null || m < x.hasta));
      const uid = valido(t?.usuarioId);
      if (uid == null) return null;
      return { usuarioId: uid, motivo: `monto ${etiquetaTramo(t!)}` };
    }

    return null; // equitativa / carga: sin regla, todo va al nivelador
  };

  const porRegla = cfg.estrategia === 'categoria' || cfg.estrategia === 'region'
                || cfg.estrategia === 'viabilidad' || cfg.estrategia === 'monto';

  if (porRegla) {
    // Orden estable por código: el reparto por regla no depende del azar.
    for (const l of [...licitaciones].sort((a, b) => a.licitacion_codigo.localeCompare(b.licitacion_codigo))) {
      const r = reglaPara(l);
      if (r) { anotar(r.usuarioId); asignaciones.push({ codigo: l.licitacion_codigo, usuarioId: r.usuarioId, motivo: r.motivo }); }
      else pendientes.push(l);
    }
  } else {
    pendientes.push(...licitaciones);
  }

  // ── 3) Fallback / nivelador ────────────────────────────────────────────────────
  const fallback = cfg.fallback ?? (cfg.estrategia === 'carga' ? 'carga' : 'equitativa');
  if (fallback === 'ninguno') {
    for (const l of pendientes) {
      asignaciones.push({ codigo: l.licitacion_codigo, usuarioId: null, motivo: 'ninguna regla la alcanzó' });
    }
  } else {
    // Se barajan ANTES de nivelar: así el reparto parejo es además aleatorio (cuál le toca
    // a quién no depende del orden de llegada al puente), pero reproducible por la semilla.
    const motivo = fallback === 'carga'
      ? 'nivelando carga de trabajo'
      : porRegla ? 'sin regla → reparto parejo' : 'reparto parejo';
    for (const l of barajar(pendientes, rnd)) {
      const p = siguienteNivelado();
      anotar(p.id);
      asignaciones.push({ codigo: l.licitacion_codigo, usuarioId: p.id, motivo });
    }
  }

  return armar(asignaciones, destinos, recibidas, semilla);
}

function armar(
  asignaciones: Adjudicacion[], destinos: PerfilDestino[],
  recibidas: Map<number, number>, semilla: number,
): ResultadoReparto {
  return {
    asignaciones,
    sinAsignar: asignaciones.filter(a => a.usuarioId == null).map(a => a.codigo),
    porPerfil: destinos.map(p => ({
      usuarioId: p.id, nombre: p.nombre, email: p.email,
      cargaAntes: p.cargaActual,
      asignadas: recibidas.get(p.id) || 0,
      cargaDespues: p.cargaActual + (recibidas.get(p.id) || 0),
    })),
    semilla,
  };
}

/** Etiqueta corta de cada estrategia (UI + bitácora). */
export const NOMBRE_ESTRATEGIA: Record<Estrategia, string> = {
  equitativa: 'Reparto equitativo',
  carga:      'Nivelar carga de trabajo',
  categoria:  'Por categoría',
  monto:      'Por rango de monto',
  region:     'Por región',
  viabilidad: 'Por viabilidad',
  manual:     'Manual',
};
