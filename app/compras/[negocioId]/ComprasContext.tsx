'use client';

// CONTEXTO COMPARTIDO del negocio en Compras (11-sep-2026) — antes todo esto vivía adentro de
// ComprasSection.tsx y se recalculaba cada vez que se cambiaba de "pestaña" (estado local). Ahora
// cada submódulo (Tareas, Costeo, Auditoría, etc.) es una PÁGINA/URL propia — pedido explícito del
// usuario, "probemos la url propia" — así que la data compartida (asignación, tareas, resumen,
// permisos) vive en un Context que arma `layout.tsx` UNA vez y todas las páginas hijas consumen,
// en vez de que cada una vuelva a pedir lo mismo.
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useSession } from '@/app/lib/session-context';

export interface ResumenCompras {
  licitacionNombre: string | null; organismo: string | null;
  responsableNombre: string | null;
  montoNuestro: number | null; montoOfertado: number | null;
  presupuestoProyecto: number | null; fechaCierreLicitacion: string | null;
  plazoEntregaOfertado: string | null; hitoInicioPlazo: string | null;
  requiereBoletaFielCumplimiento: boolean; requiereFirmaContrato: boolean; plazoAceptacionOC: string;
  existeCosteo: boolean; montoCosteado: number | null; margenPrevisto: number | null;
  contactosCliente: {
    organismo: string | null; unidad: string | null; direccion: string | null; comuna: string | null;
    usuarioNombre: string | null; usuarioCargo: string | null;
    usuarioTelefono?: string | null; usuarioEmail?: string | null;
    responsableContratoNombre?: string | null; responsableContratoEmail?: string | null; responsableContratoFono?: string | null;
    responsablePagoNombre?: string | null; responsablePagoEmail?: string | null;
  } | null;
  faltantes: string[];
}

export interface OrdenCompra {
  numero: string | null; emitidaAt: string | null; aceptadaAt: string | null;
  monto: number | null; totalNeto: number | null; difiere: boolean; observacion: string | null;
  registradaPorNombre: string | null; actualizadaAt: string | null;
  origen: 'mp' | 'manual' | null; codigoMp: string | null; estadoMp: string | null; vinculadaAt: string | null;
}
export interface OrdenCompraMp { codigo: string; estado: string | null; url: string | null; pdfUrl: string | null }

export interface Asignacion {
  negocioId: number; licitacionCodigo: string; ganadoAt: string; vencimientoAsignacionAt: string;
  urgente: boolean; asignadoA: number | null; asignadoNombre: string | null; asignadoAt: string | null; asignadoPor: number | null;
  resumen: ResumenCompras | null;
  ordenCompra: OrdenCompra;
}

export interface CampoRegistro { clave: string; etiqueta: string; tipo: 'texto' | 'parrafo' | 'si_no'; placeholder?: string }

export interface Tarea {
  id: number; catalogoClave: string | null; categoria: string; titulo: string; descripcion: string | null;
  estado: 'PENDIENTE' | 'EN_CURSO' | 'HECHA'; responsableId: number | null; responsableNombre: string | null;
  plazoAt: string | null; creadoAt: string; primerContactoAt: string | null;
  cerradoAt: string | null; cerradoPorNombre: string | null; notaCierre: string | null;
  esManual: boolean; vencida: boolean;
  campos: CampoRegistro[]; registro: Record<string, string> | null; registroAt: string | null; hallazgo: boolean;
}

export interface Candidato { id: number; nombre: string | null; carga: number }

export interface ResumenFases {
  tareas: { vencidas: number };
  costeo: { productosSinCotizacion: number };
  aprobacion: { compuertasPendientes: number };
  compra: { hitosAdminPendientes: number | null };
  entrega: { incidenciasAbiertas: number; relojVencido: boolean };
}

export const fmtCLP = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
export const fmtFecha = (s: string | null) => {
  if (!s) return '—';
  try { return new Date(s.replace(' ', 'T')).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return s; }
};

interface ComprasContextValue {
  negocioId: number;
  loading: boolean; error: string | null;
  asignacion: Asignacion | null;
  tareas: Tarea[];
  candidatos: Candidato[];
  resumenFases: ResumenFases | null;
  licitacionNombre: string | null;
  licitacionOrganismo: string | null;
  ocMp: OrdenCompraMp | null;
  recargar: () => Promise<void>;
  puedeOperar: boolean;
  esJefeDeVentas: boolean;
  esAdministracion: boolean;
  esBodega: boolean;
  esAdmin: boolean;
}

const Ctx = createContext<ComprasContextValue | null>(null);

export function ComprasProvider({ negocioId, children }: { negocioId: number; children: React.ReactNode }) {
  const { usuario } = useSession();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [asignacion, setAsignacion] = useState<Asignacion | null>(null);
  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [resumenFases, setResumenFases] = useState<ResumenFases | null>(null);
  const [licitacionNombre, setLicitacionNombre] = useState<string | null>(null);
  const [licitacionOrganismo, setLicitacionOrganismo] = useState<string | null>(null);
  const [ocMp, setOcMp] = useState<OrdenCompraMp | null>(null);

  const recargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/compras/${negocioId}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar Compras');
      setAsignacion(data.asignacion);
      setTareas(data.tareas || []);
      setCandidatos(data.candidatos || []);
      setResumenFases(data.resumenFases || null);
      setLicitacionNombre(data.licitacionNombre);
      setLicitacionOrganismo(data.licitacionOrganismo);
      setOcMp(data.ordenCompraMp || null);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [negocioId]);

  useEffect(() => { recargar(); }, [recargar]);

  // "Ser admin" ya no alcanza solo (pedido explícito, 10-sep-2026) — mismo criterio que el backend
  // (app/api/compras/[negocioId]/route.ts): `compras_todo` es el único permiso que reemplaza ese
  // bypass, ninguno de los demás se auto-otorga por ser admin.
  const esJefeDeVentas = !!usuario?.permisos?.compras_todo || !!usuario?.permisos?.aprobar_comercial;
  const puedeOperar = !!usuario?.permisos?.compras_todo || !!usuario?.permisos?.compras || !!usuario?.permisos?.aprobar_comercial || asignacion?.asignadoA === usuario?.id;
  const esAdministracion = !!usuario?.permisos?.compras_administracion;
  const esBodega = !!usuario?.permisos?.compras_bodega;
  // Pedido explícito del usuario, 15-sep-2026: cambiar un encargado que YA tiene otro asignado es
  // solo de admin (mismo corte que el backend en /api/compras/[negocioId]/asignar/route.ts) —
  // esJefeDeVentas de arriba sigue habilitando la asignación INICIAL.
  const esAdmin = usuario?.rol === 'admin';

  return (
    <Ctx.Provider value={{
      negocioId, loading, error, asignacion, tareas, candidatos, resumenFases,
      licitacionNombre, licitacionOrganismo, ocMp, recargar,
      puedeOperar, esJefeDeVentas, esAdministracion, esBodega, esAdmin,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCompras(): ComprasContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCompras() debe usarse dentro de <ComprasProvider>');
  return ctx;
}
