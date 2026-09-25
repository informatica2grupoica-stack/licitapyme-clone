'use client';

// AUDITOR DE COMPRAS (spec §8) — bandeja de cotizaciones (cualquier formato, sin límite de
// proveedores), cuadro comparativo con huecos visibles, espacio de negociación detectado y los
// 4 escenarios de compra (el de "Más rápido" como principal). Es un SUGERIDOR: nunca excluye un
// proveedor por incumplimiento técnico, solo lo clasifica.
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Select } from '@/app/components/ui/Select';
import { Banner } from '@/app/components/ui/Banner';
import { parsearMontoCL } from '@/app/lib/numeros';
import { useCompras } from '@/app/compras/[negocioId]/ComprasContext';
import { AuditoriaCotizacionPanel, type AuditoriaUI } from './AuditoriaCotizacionPanel';
import { CotizacionesMasivas } from './CotizacionesMasivas';
import { CombinacionesCompra, type DatosCombinaciones } from './CombinacionesCompra';
import { IconGavel as Gavel, IconLoader2 as Loader2, IconPlus as Plus, IconX as X, IconSparkles as Sparkles, IconTrendingDown as TrendingDown, IconTruck as Truck, IconBolt as Zap, IconScale as Scale, IconCurrencyDollar as DollarSign, IconCircleCheck as CheckCircle2, IconPaperclip as Paperclip, IconListCheck as ListChecks, IconDeviceFloppy as Save, IconAlertTriangle as AlertTriangle, IconLink as Link2, IconShieldCheck as ShieldCheck, IconPencil as Pencil, IconTrash as Trash2, IconRobot as Bot, IconEye as Eye } from '@tabler/icons-react';

type Origen = 'pdf' | 'imagen' | 'whatsapp' | 'texto' | 'correo' | 'llamada';
type Cumple = 'CUMPLE' | 'MEJORA' | 'INFERIOR_NEGOCIABLE' | 'INFERIOR_INSALVABLE' | 'NO_ES_EL_PRODUCTO';
type TipoEscenario = 'MAS_RAPIDO' | 'MINIMO_PRECIO' | 'MINIMOS_VIAJES' | 'EQUILIBRADO';

interface Cotizacion {
  id: number; proveedorNombre: string; proveedorRut: string | null; proveedorNuevo: boolean | null;
  origen: Origen; descripcionLibre: string | null; precioUnitario: number | null; precioTotal: number | null;
  precioUnitarioBruto: number | null; descuentoPct: number | null;
  moneda: string; tipoCambioUsado: number | null; precioUnitarioClp: number | null;
  plazoEntregaTexto: string | null; incluyeFlete: boolean | null; fleteMonto: number | null; homologadaAt: string | null; archivoUrl: string | null;
  items: Array<{ productoId: number; precioUnitario: number | null; cumple: Cumple; detalleDesviacion: string | null }>;
}
interface FilaCuadro { productoId: number; descripcion: string; cotizacionesPorProveedor: Array<{ proveedor: string; precioUnitario: number | null; cumple: Cumple | null }>; cubierto: boolean; puntosCriticos: string | null }
interface Producto { id: number; descripcion: string; subestado: string; cantidad?: number | null }
interface ProveedorSugerido {
  proveedorId: number | null; obumaProveedorId: string; nombreEmpresa: string; rut: string | null;
  productos: Array<{ nombre: string; veces: number; ultimaFecha: string | null }>;
}
interface SugerenciaProducto { productoId: number; descripcion: string; sugerencias: ProveedorSugerido[] }
interface Negociacion { productoId: number; descripcion: string; minimo: number; maximo: number; diferencia: number; proveedorMasCaro: string }
interface AlertaAgente { campo: string; mensaje: string; gravedad: 'info' | 'aviso' | 'critico'; documento: string | null; citaTextual: string | null; citaVerificada: boolean }
interface SugerenciaAgente { campo: string; valor: string; razon: string; documento: string | null; citaTextual: string | null; citaVerificada: boolean }
interface FuenteDocumento { nombre: string; url: string | null }
interface DetalleProductoEscenario { productoId: number; descripcion: string; proveedor: string | null; precioUnitario: number | null; cantidad: number | null; subtotal: number | null; plazoEntregaDias: number | null; incluyeFlete: boolean | null; fleteMonto: number | null }
interface Escenario {
  tipo: TipoEscenario; costoTotal: number; diasEstimados: number | null; viajesEstimados: number; esPrincipal: boolean;
  detalle: { porProducto: DetalleProductoEscenario[]; proveedoresInvolucrados: string[] };
  fleteSinConfirmar: boolean;
}

const ORIGEN_LABEL: Record<Origen, string> = { pdf: 'PDF', imagen: 'Imagen', whatsapp: 'WhatsApp', texto: 'Texto', correo: 'Correo', llamada: 'Llamada' };
// Monedas que el backend sabe convertir a CLP (ver app/lib/tipo-cambio.ts) — agregar acá una moneda
// nueva sin fuente de tipo de cambio la dejaría "seleccionable pero sin convertir" en silencio.
const MONEDAS_SOPORTADAS = ['CLP', 'USD', 'EUR'];
const CUMPLE_STYLE: Record<Cumple, string> = {
  CUMPLE: 'text-emerald-700 bg-emerald-50 border-emerald-200', MEJORA: 'text-teal-700 bg-teal-50 border-teal-200',
  INFERIOR_NEGOCIABLE: 'text-amber-700 bg-amber-50 border-amber-200', INFERIOR_INSALVABLE: 'text-rose-700 bg-rose-50 border-rose-200',
  NO_ES_EL_PRODUCTO: 'text-zinc-400 bg-zinc-50 border-zinc-200',
};
const CUMPLE_LABEL: Record<Cumple, string> = {
  CUMPLE: 'Cumple', MEJORA: 'Mejora', INFERIOR_NEGOCIABLE: 'Inferior (negociable)', INFERIOR_INSALVABLE: 'Inferior (insalvable)', NO_ES_EL_PRODUCTO: 'No es el producto',
};
const ESCENARIO_META: Record<TipoEscenario, { label: string; icon: React.ReactNode }> = {
  MAS_RAPIDO: { label: 'Más rápido', icon: <Zap size={14} /> }, MINIMO_PRECIO: { label: 'Mínimo precio', icon: <DollarSign size={14} /> },
  MINIMOS_VIAJES: { label: 'Mínimos viajes', icon: <Truck size={14} /> }, EQUILIBRADO: { label: 'Equilibrado', icon: <Scale size={14} /> },
};
const fmtCLP = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

export function AuditorComprasCard({ negocioId, puedeOperar }: { negocioId: number; puedeOperar: boolean }) {
  const toast = useToast();
  const { recargar: recargarCompartido } = useCompras();
  const [cotizaciones, setCotizaciones] = useState<Cotizacion[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cuadro, setCuadro] = useState<FilaCuadro[]>([]);
  const [negociacion, setNegociacion] = useState<Negociacion[]>([]);
  const [escenarios, setEscenarios] = useState<Escenario[]>([]);
  const [elegidoTipo, setElegidoTipo] = useState<TipoEscenario | null>(null);
  // El costo GUARDADO cuando se eligió — no el recalculado ahora. Si una cotización nueva cambia lo
  // que cuesta ese mismo tipo de escenario, comparar solo por `tipo` mostraba "Elegido" sobre un
  // número que nadie confirmó (bug real, 11-sep-2026: "Mínimo precio" pasó de $34.662.844 a
  // $20.529.164 al agregar una cotización de Tecnomaq, y el badge se quedó pegado al tipo).
  const [elegidoCostoGuardado, setElegidoCostoGuardado] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [homologando, setHomologando] = useState<number | null>(null);
  const [eligiendo, setEligiendo] = useState<TipoEscenario | null>(null);
  const [formAbierto, setFormAbierto] = useState(false);
  const [masivaAbierta, setMasivaAbierta] = useState(false);
  const [guardandoForm, setGuardandoForm] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  // Pedido explícito del usuario (11-sep-2026): la extracción del documento (spec §8.2) ya existía,
  // pero corría en silencio recién al Guardar — nadie veía qué se leyó hasta que la cotización ya
  // estaba creada. Ahora se lee apenas se elige el archivo y autocompleta lo que esté vacío, para
  // revisar/corregir ANTES de confirmar (mismo criterio que el preview de costo en Aprobaciones).
  const [archivoExtraido, setArchivoExtraido] = useState<
    { estado: 'idle' } | { estado: 'leyendo' } | { estado: 'error' } |
    { estado: 'listo'; url: string; nombre: string; textoCompleto: string | null; huboDatos: boolean; notasAdicionales: string[] }
  >({ estado: 'idle' });
  const [form, setForm] = useState({
    proveedorNombre: '', proveedorRut: '', origen: 'texto' as Origen, descripcionLibre: '',
    precioUnitario: '', descuentoPct: '', moneda: 'CLP', plazoEntregaTexto: '', incluyeFlete: '' as '' | 'true' | 'false', fleteMonto: '', vigenciaAt: '',
  });
  // Pedido explícito del usuario (11-sep-2026): esta pantalla es para REGISTRAR cotizaciones, no
  // para administrar el catálogo de proveedores (eso vive en /compras/proveedores, aparte). Se
  // tipea nombre + RUT y el backend (obtenerOCrearProveedor) reconoce/reusa el proveedor que ya
  // exista por RUT — sin un selector de catálogo acá adentro.
  //
  // Ampliado (14-sep-2026, pedido explícito): "todo lo que ingresemos debe estar validado" — no
  // alcanza con avisar el HISTORIAL de compras (eso solo dice algo si Obuma YA lo tiene); hace
  // falta decir explícito si el RUT existe o no en Obuma, ANTES de guardar. `validacion` viene de
  // validarProveedorObuma (compras-proveedores.ts): en_catalogo / en_obuma_no_catalogo /
  // no_existe_en_obuma. `historico` (opcional, solo si ya está en Obuma) agrega la última compra.
  const [historicoProveedor, setHistoricoProveedor] = useState<
    { estado: 'idle' } | { estado: 'cargando' } |
    {
      estado: 'listo';
      validacion: 'en_catalogo' | 'en_obuma_no_catalogo' | 'no_existe_en_obuma';
      nombreEmpresa: string | null;
      historico: { razonSocial: string; ultimaOcFolio: string | null; ultimaOcFecha: string | null } | null;
    }
  >({ estado: 'idle' });
  // Multi-ítem al crear (§8.7): opcional — si el comprador ya sabe a qué producto(s) corresponde
  // esta cotización, lo marca acá de una vez en vez de crearla y abrir "Asignar productos" después.
  const [itemsCreacion, setItemsCreacion] = useState<Record<number, { activo: boolean; precioUnitario: string; cumple: Cumple }>>({});
  // Pedido explícito del usuario (14-sep-2026): "cuando ingrese una cotización... que me diga el
  // sistema ojo le hemos comprado clavos a este proveedor... según los ítems que tengamos que
  // cotizar". Se calcula UNA vez al cargar la pantalla (consulta 100% local, ya no pega contra
  // Obuma en vivo — ver sugerirProveedoresPorDescripcion en compras-proveedores.ts) y se muestra
  // como aviso, sin que nadie tenga que ir a buscarlo a mano.
  const [sugerenciasHistorial, setSugerenciasHistorial] = useState<SugerenciaProducto[]>([]);
  // Editar/eliminar una cotización ya registrada (pedido explícito, 14-sep-2026: "tampoco se pueden
  // eliminar ni editar las cotizaciones y eso es básico"). Editar reusa el MISMO formulario de
  // "Registrar cotización" precargado — sin volver a subir el archivo, solo los campos de texto —
  // y guarda con PATCH en vez de POST. Eliminar pide confirmación inline (acción irreversible).
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [confirmandoEliminarId, setConfirmandoEliminarId] = useState<number | null>(null);
  const [eliminando, setEliminando] = useState<number | null>(null);

  // Agente de documentos (pedido explícito, 14-sep-2026: "la IA lea los documentos... y nos vaya
  // guiando... poniendo lo que tenemos que llenar") — cruza el borrador contra bases/anexos/acta
  // ANTES de guardar. Nace del bug real del negocio 1054 (toggle de flete al revés de lo que decía
  // la propia justificación): un aviso acá lo habría pescado antes de aprobar sobre el dato malo.
  const [revisionAgente, setRevisionAgente] = useState<
    { estado: 'idle' } | { estado: 'revisando' } | { estado: 'error'; mensaje: string } |
    { estado: 'listo'; encontroDocumentos: boolean; documentosLeidos: string[]; fuentes: FuenteDocumento[]; resumen: string; alertas: AlertaAgente[]; sugerencias: SugerenciaAgente[] }
  >({ estado: 'idle' });
  // Contador visible del tope diario (pedido explícito, 14-sep-2026) — se carga junto con el resto
  // de la pantalla, sin gastar una revisión real (endpoint GET aparte, solo lee el conteo).
  const [usoAgente, setUsoAgente] = useState<{ llamadas: number; tope: number; agotado: boolean } | null>(null);
  // Dictámenes del auditor (compras-auditoria-cotizacion.ts), uno por cotización × producto.
  const [auditorias, setAuditorias] = useState<AuditoriaUI[]>([]);
  // Todas las combinaciones posibles de compra (una cotización por producto) — ver CombinacionesCompra.tsx.
  const [combinaciones, setCombinaciones] = useState<DatosCombinaciones | null>(null);
  const [combinacionElegida, setCombinacionElegida] = useState<string | null>(null);
  const [eligiendoComb, setEligiendoComb] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [rCot, rEsc, rProd, rSug, rUso] = await Promise.all([
        fetch(`/api/compras/${negocioId}/cotizaciones`), fetch(`/api/compras/${negocioId}/escenarios`), fetch(`/api/compras/${negocioId}/productos`),
        fetch(`/api/compras/${negocioId}/sugerencias-historial`), fetch(`/api/compras/${negocioId}/agente-documentos`),
      ]);
      const [dCot, dEsc, dProd, dSug, dUso] = await Promise.all([rCot.json(), rEsc.json(), rProd.json(), rSug.json(), rUso.json()]);
      if (dCot.success) { setCotizaciones(dCot.cotizaciones || []); setAuditorias(dCot.auditorias || []); }
      if (dEsc.success) {
        setCuadro(dEsc.cuadro || []); setNegociacion(dEsc.negociacion || []); setEscenarios(dEsc.escenarios || []);
        setElegidoTipo(dEsc.elegidoTipo || null); setElegidoCostoGuardado(dEsc.elegidoCostoGuardado ?? null);
        setCombinaciones(dEsc.combinaciones || null); setCombinacionElegida(dEsc.combinacionElegidaClave ?? null);
      }
      if (dProd.success) setProductos((dProd.productos || []).filter((p: any) => p.subestado !== 'RENUNCIADO'));
      if (dSug.success) setSugerenciasHistorial(dSug.productos || []);
      if (dUso.success) setUsoAgente(dUso.usoHoy);
    } catch (e: any) {
      toast.error('No se pudo cargar el Auditor de Compras', e.message);
    } finally {
      setLoading(false);
    }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);

  // El auditor corre en segundo plano apenas se asigna/edita una cotización y tarda unos segundos:
  // mientras haya productos asignados sin dictamen, se consulta solo la lista de cotizaciones (liviano)
  // cada 8 s, hasta 2 minutos, para que el veredicto aparezca sin recargar la página.
  const faltanAuditorias = cotizaciones.some(c => c.items.some(it => !auditorias.find(a => a.cotizacionId === c.id && a.productoId === it.productoId)));
  useEffect(() => {
    if (!faltanAuditorias) return;
    let intentos = 0;
    const t = setInterval(async () => {
      if (++intentos > 15) { clearInterval(t); return; }
      try {
        const d = await (await fetch(`/api/compras/${negocioId}/cotizaciones`)).json();
        if (d.success) { setCotizaciones(d.cotizaciones || []); setAuditorias(d.auditorias || []); }
      } catch { /* siguiente vuelta */ }
    }, 8000);
    return () => clearInterval(t);
  }, [faltanAuditorias, negocioId]);

  // Se dispara al salir del campo RUT (no en cada tecla) Y apenas el documento lo autocompleta solo
  // (ver leerArchivo más abajo — antes esto SOLO corría con onBlur, así que un RUT que llegaba del
  // PDF nunca se validaba porque nadie tocaba el campo a mano; bug real reportado en vivo el
  // 14-sep-2026 con la cotización de Trotec Chile). Recibe el RUT explícito en vez de leerlo de
  // `form` porque justo después de `setForm` en leerArchivo el estado todavía no se actualizó.
  const validarProveedor = async (rutParam?: string) => {
    const rut = (rutParam ?? form.proveedorRut).trim();
    if (!rut) { setHistoricoProveedor({ estado: 'idle' }); return; }
    setHistoricoProveedor({ estado: 'cargando' });
    try {
      const [rVal, rHist] = await Promise.all([
        fetch(`/api/compras/proveedores?validarRut=${encodeURIComponent(rut)}`),
        fetch(`/api/compras/proveedores?historicoRut=${encodeURIComponent(rut)}`),
      ]);
      const [dVal, dHist] = await Promise.all([rVal.json(), rHist.json()]);
      if (!dVal.success) throw new Error(dVal.error || 'No se pudo validar');
      setHistoricoProveedor({
        estado: 'listo', validacion: dVal.validacion.estado, nombreEmpresa: dVal.validacion.nombreEmpresa,
        historico: dHist.success && dHist.historico ? {
          razonSocial: dHist.historico.razonSocial, ultimaOcFolio: dHist.historico.ultimaOcFolio, ultimaOcFecha: dHist.historico.ultimaOcFecha,
        } : null,
      });
    } catch {
      setHistoricoProveedor({ estado: 'idle' });
    }
  };

  // Se dispara apenas se elige el archivo — sube el documento y lo lee de una vez, para que el
  // formulario se autocomplete y la persona corrija ANTES de guardar (nunca pisa lo ya tipeado).
  const leerArchivo = async (file: File) => {
    setArchivoExtraido({ estado: 'leyendo' });
    try {
      const fd = new FormData();
      fd.set('file', file);
      const res = await fetch(`/api/compras/${negocioId}/cotizaciones/extraer`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo leer el documento');
      const ex = data.extraido;
      if (ex) {
        const rutParaValidar = form.proveedorRut.trim() || ex.proveedorRut || null;
        setForm(f => ({
          ...f,
          proveedorNombre: f.proveedorNombre.trim() || ex.proveedorNombre || f.proveedorNombre,
          proveedorRut: f.proveedorRut.trim() || ex.proveedorRut || f.proveedorRut,
          precioUnitario: f.precioUnitario.trim() || (ex.precioUnitario != null ? String(ex.precioUnitario) : f.precioUnitario),
          descuentoPct: f.descuentoPct.trim() || (ex.descuentoPct != null ? String(ex.descuentoPct) : f.descuentoPct),
          fleteMonto: f.fleteMonto.trim() || (ex.fleteMonto != null ? String(ex.fleteMonto) : f.fleteMonto),
          // Cualquier moneda que el backend sepa convertir (ver MONEDAS_SOPORTADAS) — antes solo
          // reconocía "USD" acá mismo, así que una cotización en euros (caso real, 15-sep-2026:
          // proveedor italiano Eter srl) quedaba tipeada como CLP aunque el documento SÍ decía "€".
          moneda: f.moneda === 'CLP' && ex.moneda && MONEDAS_SOPORTADAS.includes(String(ex.moneda).toUpperCase() as any)
            ? String(ex.moneda).toUpperCase() : f.moneda,
          plazoEntregaTexto: f.plazoEntregaTexto.trim() || ex.plazoEntregaTexto || f.plazoEntregaTexto,
        }));
        // BUG REAL (14-sep-2026, reportado en vivo con la cotización de Trotec Chile): la
        // validación contra Obuma solo corría en el onBlur del campo RUT — un RUT que llega SOLO
        // del documento (nadie toca el campo a mano) nunca se validaba, y la persona guardaba sin
        // saber si el proveedor existía en Obuma o se iba a crear uno nuevo.
        if (rutParaValidar) validarProveedor(rutParaValidar);
      }
      const huboDatos = !!(ex && (ex.proveedorNombre || ex.proveedorRut || ex.precioUnitario != null || ex.plazoEntregaTexto));
      // Pedido explícito del usuario (15-sep-2026): "si yo subo la cotización tiene que poder
      // decirme algo... sobre todo si esa cotización tiene información más allá de los precios del
      // producto, algunos traen más cosas, pero solo algunos" — garantía, condiciones de pago,
      // vigencia, etc. Antes se extraían y se tiraban (ver notasAdicionales en compras-cotizacion-ocr.ts).
      const notasAdicionales: string[] = Array.isArray(ex?.notasAdicionales) ? ex.notasAdicionales : [];
      setArchivoExtraido({ estado: 'listo', url: data.archivoUrl, nombre: data.archivoNombre, textoCompleto: ex?.textoCompleto || null, huboDatos, notasAdicionales });
      if (huboDatos) toast.success('Datos leídos del documento', 'Revisa y corrige lo que haga falta antes de guardar.');
      else toast.error('No se pudo leer el documento con certeza', 'Completa los datos a mano — el archivo igual queda adjunto.');
      if (notasAdicionales.length > 0) toast.success('El documento trae más información', notasAdicionales.join(' · '));
    } catch (e: any) {
      setArchivoExtraido({ estado: 'error' });
      toast.error('No se pudo leer el documento', e.message);
    }
  };

  // Revisa el borrador contra los documentos del proyecto (bases, anexos propios, acta) — llamado
  // manual (botón), no automático: cada llamada lee/audita con Gemini y tiene costo, así que se
  // dispara cuando la persona lo pide, no en cada tecla.
  const revisarConAgente = async () => {
    setRevisionAgente({ estado: 'revisando' });
    try {
      // Pedido explícito del usuario (15-sep-2026: "no tengo dónde poner los días de entrega ni la
      // cantidad de productos... lo podemos sacar del costeo") — BUG REAL: al EDITAR una cotización
      // ya existente, `itemsCreacion` (el checkbox "¿a qué producto corresponde?") nunca se llena —
      // ese bloque solo se muestra al CREAR una cotización nueva — así que `productoElegido` daba
      // siempre `undefined` y la cantidad nunca se mandaba al agente. En modo edición, se saca del
      // propio `items` de la cotización (ya asignada a un producto) en vez del checkbox efímero.
      const cotizacionEnEdicion = editandoId != null ? cotizaciones.find(c => c.id === editandoId) : null;
      const productoIdEnEdicion = cotizacionEnEdicion?.items[0]?.productoId;
      const productoElegido = editandoId != null
        ? productos.find(p => p.id === productoIdEnEdicion)
        : productos.find(p => itemsCreacion[p.id]?.activo);
      const res = await fetch(`/api/compras/${negocioId}/agente-documentos`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productoDescripcion: productoElegido?.descripcion ?? null,
          descripcionLibre: form.descripcionLibre.trim() || null,
          cantidad: productoElegido?.cantidad ?? null,
          proveedorNombre: form.proveedorNombre.trim(),
          precioUnitario: parsearMontoCL(form.precioUnitario),
          descuentoPct: parsearMontoCL(form.descuentoPct),
          incluyeFlete: form.incluyeFlete ? form.incluyeFlete === 'true' : null,
          fleteMonto: parsearMontoCL(form.fleteMonto),
          plazoEntregaTexto: form.plazoEntregaTexto.trim() || null,
        }),
      });
      const data = await res.json();
      if (data.usoHoy) setUsoAgente(data.usoHoy);
      if (!res.ok || !data.success) throw new Error(data.error || 'El agente no pudo revisar el borrador.');
      setRevisionAgente({
        estado: 'listo', encontroDocumentos: data.encontroDocumentos, documentosLeidos: data.documentosLeidos || [],
        fuentes: data.fuentes || [],
        resumen: data.resumen || '', alertas: data.alertas || [], sugerencias: data.sugerencias || [],
      });
    } catch (e: any) {
      setRevisionAgente({ estado: 'error', mensaje: e.message });
    }
  };

  // Aplica una sugerencia del agente directo al campo correspondiente del formulario — la persona
  // sigue teniendo la última palabra (puede corregir después de aplicarla, o ignorarla).
  // Pedido explícito del usuario (15-sep-2026: "no me deja poner los días de entrega"): el botón
  // SÍ aplicaba el valor (verificado antes), pero no daba ninguna señal de que había pasado algo —
  // el campo que cambia (ej. "Plazo de entrega") suele estar arriba, fuera de la vista de la
  // sugerencia, así que sin un aviso la persona no tiene cómo saber que funcionó y asume que está
  // roto. Ahora confirma con un toast, mencionando el campo por su nombre legible.
  const CAMPO_LABEL: Record<string, string> = {
    proveedorNombre: 'Proveedor', precioUnitario: 'Precio unitario', descuentoPct: 'Descuento %',
    incluyeFlete: '¿Quién despacha?', fleteMonto: 'Monto de flete', plazoEntregaTexto: 'Plazo de entrega',
  };
  const aplicarSugerenciaAgente = (s: SugerenciaAgente) => {
    setForm(f => {
      switch (s.campo) {
        case 'proveedorNombre': return { ...f, proveedorNombre: s.valor };
        case 'precioUnitario': return { ...f, precioUnitario: s.valor };
        case 'descuentoPct': return { ...f, descuentoPct: s.valor };
        case 'incluyeFlete': return { ...f, incluyeFlete: s.valor === 'true' ? 'true' : s.valor === 'false' ? 'false' : f.incluyeFlete };
        case 'fleteMonto': return { ...f, fleteMonto: s.valor };
        case 'plazoEntregaTexto': return { ...f, plazoEntregaTexto: s.valor };
        default: return f;
      }
    });
    toast.success(`Campo actualizado: ${CAMPO_LABEL[s.campo] || s.campo}`, `Ahora dice "${s.valor}" — revisa arriba en el formulario y guarda cuando esté listo.`);
  };

  // Editar (pedido explícito, 14-sep-2026) — PATCH sobre la cotización existente, solo los campos
  // de cabecera (proveedor, precio, descuento, plazo, flete, vigencia, notas). No toca el archivo
  // ni los ítems ya asignados (eso sigue siendo "Asignar productos", aparte).
  const guardarEdicion = async () => {
    if (!form.proveedorNombre.trim() || editandoId == null) return;
    setGuardandoForm(true);
    try {
      const precioUnitarioBrutoForm = parsearMontoCL(form.precioUnitario);
      const descuentoPctForm = parsearMontoCL(form.descuentoPct);
      const res = await fetch(`/api/compras/${negocioId}/cotizaciones/${editandoId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proveedorNombre: form.proveedorNombre.trim(), proveedorRut: form.proveedorRut.trim() || null,
          descripcionLibre: form.descripcionLibre.trim() || null,
          precioUnitario: precioUnitarioBrutoForm, descuentoPct: descuentoPctForm,
          moneda: form.moneda,
          plazoEntregaTexto: form.plazoEntregaTexto.trim() || null,
          incluyeFlete: form.incluyeFlete ? form.incluyeFlete === 'true' : null,
          fleteMonto: parsearMontoCL(form.fleteMonto),
          vigenciaAt: form.vigenciaAt || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo editar');
      toast.success('Cotización actualizada', 'Si esto cambia lo que ya estaba aprobado, los hitos de aprobación vuelven a pendiente.');
      cancelarFormulario();
      await cargar();
      recargarCompartido();
    } catch (e: any) {
      toast.error('No se pudo editar la cotización', e.message);
    } finally {
      setGuardandoForm(false);
    }
  };

  const cancelarFormulario = () => {
    setForm({ proveedorNombre: '', proveedorRut: '', origen: 'texto', descripcionLibre: '', precioUnitario: '', descuentoPct: '', moneda: 'CLP', plazoEntregaTexto: '', incluyeFlete: '', fleteMonto: '', vigenciaAt: '' });
    setHistoricoProveedor({ estado: 'idle' });
    setArchivo(null);
    setArchivoExtraido({ estado: 'idle' });
    setItemsCreacion({});
    setEditandoId(null);
    setFormAbierto(false);
    // Reset de la revisión del agente (bug encontrado, 14-sep-2026): si no se limpia acá, las
    // alertas/sugerencias de la cotización anterior quedaban pegadas al abrir/editar otra distinta
    // — con el riesgo de que alguien apretara "Usar" sobre una sugerencia que no correspondía.
    setRevisionAgente({ estado: 'idle' });
  };

  const iniciarEdicion = (c: Cotizacion) => {
    setForm({
      proveedorNombre: c.proveedorNombre, proveedorRut: c.proveedorRut || '',
      origen: c.origen, descripcionLibre: c.descripcionLibre || '',
      precioUnitario: c.precioUnitarioBruto != null ? String(c.precioUnitarioBruto) : (c.precioUnitario != null ? String(c.precioUnitario) : ''),
      descuentoPct: c.descuentoPct != null ? String(c.descuentoPct) : '',
      moneda: c.moneda, plazoEntregaTexto: c.plazoEntregaTexto || '',
      incluyeFlete: c.incluyeFlete == null ? '' : (c.incluyeFlete ? 'true' : 'false'),
      fleteMonto: c.fleteMonto != null ? String(c.fleteMonto) : '',
      vigenciaAt: '',
    });
    setEditandoId(c.id);
    setFormAbierto(true);
    setHistoricoProveedor({ estado: 'idle' });
    setRevisionAgente({ estado: 'idle' });
  };

  const eliminarCotizacion = async (id: number) => {
    setEliminando(id);
    try {
      const res = await fetch(`/api/compras/${negocioId}/cotizaciones/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo eliminar');
      toast.success('Cotización eliminada');
      setConfirmandoEliminarId(null);
      await cargar();
      recargarCompartido();
    } catch (e: any) {
      toast.error('No se pudo eliminar la cotización', e.message);
    } finally {
      setEliminando(null);
    }
  };

  const crearCotizacion = async () => {
    if (!form.proveedorNombre.trim() && !archivo) return;
    setGuardandoForm(true);
    try {
      // Descuento (pedido explícito, 14-sep-2026: cotización de Trotec con 4% de descuento que el
      // sistema no capturaba en ningún lado). El precio del producto (arriba) manda el BRUTO — el
      // backend calcula el neto solo (registrarCotizacion). Acá, además, si dejaste el precio de UN
      // ítem en blanco (checklist de abajo), se le pone el NETO ya calculado por defecto — sin esto
      // el descuento quedaba solo en la cabecera de la cotización y nunca llegaba al cuadro
      // comparativo/escenarios, que leen el precio de cada ítem, no el de la cabecera.
      const precioUnitarioBrutoForm = parsearMontoCL(form.precioUnitario);
      const descuentoPctForm = parsearMontoCL(form.descuentoPct);
      const precioUnitarioNetoForm = (precioUnitarioBrutoForm != null && descuentoPctForm != null && descuentoPctForm > 0 && descuentoPctForm < 100)
        ? Math.round(precioUnitarioBrutoForm * (1 - descuentoPctForm / 100))
        : precioUnitarioBrutoForm;
      const items = Object.entries(itemsCreacion).filter(([, v]) => v.activo)
        .map(([productoId, v]) => ({
          productoId: Number(productoId),
          precioUnitario: v.precioUnitario.trim() ? parsearMontoCL(v.precioUnitario) : precioUnitarioNetoForm,
          cumple: v.cumple,
        }));
      // §8.3: "todos los formatos posibles". Tres caminos:
      //  1. Archivo YA leído (leerArchivo ya lo subió y extrajo) — va por JSON reusando esa URL, sin
      //     volver a subir el mismo documento ni pagar el OCR dos veces.
      //  2. Archivo elegido pero la lectura falló o no alcanzó a correr — respaldo: multipart, como
      //     antes (el backend sube y extrae de nuevo).
      //  3. Sin archivo (texto pegado, correo copiado, llamada telefónica) — JSON directo.
      let res: Response;
      if (archivoExtraido.estado === 'listo') {
        res = await fetch(`/api/compras/${negocioId}/cotizaciones`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            proveedorNombre: form.proveedorNombre.trim(), proveedorRut: form.proveedorRut.trim() || null,
            origen: form.origen,
            descripcionLibre: form.descripcionLibre.trim() || archivoExtraido.textoCompleto || null,
            precioUnitario: precioUnitarioBrutoForm, descuentoPct: descuentoPctForm,
            moneda: form.moneda,
            plazoEntregaTexto: form.plazoEntregaTexto.trim() || null,
            incluyeFlete: form.incluyeFlete ? form.incluyeFlete === 'true' : null,
            fleteMonto: parsearMontoCL(form.fleteMonto),
            vigenciaAt: form.vigenciaAt || null,
            archivoUrl: archivoExtraido.url, archivoNombre: archivoExtraido.nombre,
            items: items.length > 0 ? items : undefined,
          }),
        });
      } else if (archivo) {
        const fd = new FormData();
        fd.set('file', archivo);
        fd.set('proveedorNombre', form.proveedorNombre.trim());
        if (form.proveedorRut.trim()) fd.set('proveedorRut', form.proveedorRut.trim());
        fd.set('origen', form.origen);
        if (form.descripcionLibre.trim()) fd.set('descripcionLibre', form.descripcionLibre.trim());
        if (form.precioUnitario) fd.set('precioUnitario', form.precioUnitario);
        if (form.descuentoPct) fd.set('descuentoPct', form.descuentoPct);
        if (form.moneda !== 'CLP') fd.set('moneda', form.moneda);
        if (form.plazoEntregaTexto.trim()) fd.set('plazoEntregaTexto', form.plazoEntregaTexto.trim());
        if (form.incluyeFlete) fd.set('incluyeFlete', form.incluyeFlete);
        if (form.fleteMonto) fd.set('fleteMonto', form.fleteMonto);
        if (items.length > 0) fd.set('items', JSON.stringify(items));
        res = await fetch(`/api/compras/${negocioId}/cotizaciones`, { method: 'POST', body: fd });
      } else {
        res = await fetch(`/api/compras/${negocioId}/cotizaciones`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            proveedorNombre: form.proveedorNombre.trim(), proveedorRut: form.proveedorRut.trim() || null,
            origen: form.origen, descripcionLibre: form.descripcionLibre.trim() || null,
            precioUnitario: precioUnitarioBrutoForm, descuentoPct: descuentoPctForm,
            moneda: form.moneda,
            plazoEntregaTexto: form.plazoEntregaTexto.trim() || null,
            incluyeFlete: form.incluyeFlete ? form.incluyeFlete === 'true' : null,
            fleteMonto: parsearMontoCL(form.fleteMonto),
            vigenciaAt: form.vigenciaAt || null,
            items: items.length > 0 ? items : undefined,
          }),
        });
      }
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo registrar');
      toast.success('Cotización registrada');
      cancelarFormulario();
      await cargar();
      recargarCompartido(); // mueve el badge de "Costeo y Auditoría" en el stepper
    } catch (e: any) {
      toast.error('No se pudo registrar la cotización', e.message);
    } finally {
      setGuardandoForm(false);
    }
  };

  const homologar = async (id: number) => {
    setHomologando(id);
    try {
      const res = await fetch(`/api/compras/${negocioId}/cotizaciones/${id}/homologar`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo homologar');
      toast.success('Cotización homologada', `${data.items} producto(s) mapeado(s).`);
      await cargar();
      recargarCompartido();
    } catch (e: any) {
      toast.error('No se pudo homologar', e.message);
    } finally {
      setHomologando(null);
    }
  };

  // Asignación MANUAL de productos a una cotización (§8.7) — corrige o reemplaza lo que decidió la
  // IA, o evita depender de ella cuando el comprador ya sabe con certeza a qué productos corresponde.
  const [asignandoId, setAsignandoId] = useState<number | null>(null);
  const [borradorAsignacion, setBorradorAsignacion] = useState<Record<number, { activo: boolean; precioUnitario: string; cumple: Cumple }>>({});
  const [guardandoAsignacion, setGuardandoAsignacion] = useState(false);

  const abrirAsignacion = (c: Cotizacion) => {
    setAsignandoId(c.id);
    const draft: typeof borradorAsignacion = {};
    for (const p of productos) {
      const existente = c.items.find(it => it.productoId === p.id);
      draft[p.id] = { activo: !!existente, precioUnitario: existente?.precioUnitario != null ? String(existente.precioUnitario) : (c.precioUnitario != null ? String(c.precioUnitario) : ''), cumple: existente?.cumple || 'CUMPLE' };
    }
    setBorradorAsignacion(draft);
  };

  const guardarAsignacion = async (cotizacionId: number) => {
    setGuardandoAsignacion(true);
    try {
      const items = Object.entries(borradorAsignacion).filter(([, v]) => v.activo)
        .map(([productoId, v]) => ({ productoId: Number(productoId), precioUnitario: parsearMontoCL(v.precioUnitario), cumple: v.cumple }));
      const res = await fetch(`/api/compras/${negocioId}/cotizaciones/${cotizacionId}/items`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
      toast.success('Asignación guardada');
      setAsignandoId(null);
      await cargar();
      recargarCompartido();
    } catch (e: any) {
      toast.error('No se pudo guardar la asignación', e.message);
    } finally {
      setGuardandoAsignacion(false);
    }
  };

  // Antes `window.prompt` para la justificación (spec §8.10.4) — mismo criterio que el resto de la
  // sesión: un campo real en pantalla, no un diálogo nativo sin estilo y fácil de cancelar sin querer.
  const [confirmandoTipo, setConfirmandoTipo] = useState<TipoEscenario | null>(null);
  const [justificacionEscenario, setJustificacionEscenario] = useState('');

  const elegir = async (tipo: TipoEscenario, justificacion: string | null) => {
    setEligiendo(tipo);
    try {
      const res = await fetch(`/api/compras/${negocioId}/escenarios`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo, justificacion }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo elegir');
      toast.success('Escenario elegido', 'Queda registrado para la aprobación de compra.');
      setConfirmandoTipo(null); setJustificacionEscenario('');
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo elegir el escenario', e.message);
    } finally {
      setEligiendo(null);
    }
  };

  const elegirCombinacion = async (clave: string, justificacion: string | null) => {
    setEligiendoComb(clave);
    try {
      const res = await fetch(`/api/compras/${negocioId}/escenarios`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: 'COMBINACION', clave, justificacion }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo elegir');
      toast.success('Combinación elegida', 'Queda registrada para la aprobación de compra.');
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo elegir la combinación', e.message);
    } finally {
      setEligiendoComb(null);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>;

  return (
    <div className="space-y-3">
      {/* Aviso proactivo (pedido explícito, 14-sep-2026): "ojo, le hemos comprado esto antes" —
          cruza los productos de ESTE negocio contra el historial real de compras, 100% local (ya
          no pega contra Obuma en vivo). Se ve apenas se carga la pantalla, sin que nadie lo pida. */}
      {sugerenciasHistorial.length > 0 && (
        <Banner variante="info">
          <span className="font-semibold flex items-center gap-1"><Sparkles size={13} /> Ojo — ya le hemos comprado antes algo parecido a lo que hay que cotizar:</span>
          <ul className="mt-1.5 space-y-1.5">
            {sugerenciasHistorial.map(s => (
              <li key={s.productoId} className="text-[12px]">
                <span className="font-semibold">{s.descripcion}</span>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {s.sugerencias.slice(0, 3).map(prov => (
                    <span key={prov.obumaProveedorId} className="text-[10.5px] font-semibold text-teal-700 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded-full">
                      {prov.nombreEmpresa} · {prov.productos.reduce((n, p) => n + p.veces, 0)}× "{prov.productos[0]?.nombre}"
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Banner>
      )}

      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-zinc-50 border-b border-zinc-100">
          <p className="text-[12.5px] font-bold text-zinc-700 flex items-center gap-1.5"><Gavel size={14} /> Auditor de Compras — cotizaciones</p>
          {puedeOperar && (
            <div className="flex items-center gap-4">
              <button onClick={() => setMasivaAbierta(v => !v)} className="flex items-center gap-1 text-[11.5px] font-semibold text-indigo-700 hover:text-indigo-800">
                <Paperclip size={13} /> Cargar varias
              </button>
              <button onClick={() => (formAbierto ? cancelarFormulario() : setFormAbierto(true))} className="flex items-center gap-1 text-[11.5px] font-semibold text-teal-700 hover:text-teal-800">
                <Plus size={13} /> Registrar cotización
              </button>
            </div>
          )}
        </div>

        {masivaAbierta && puedeOperar && (
          <CotizacionesMasivas negocioId={negocioId} productos={productos}
            onTerminado={async () => { await cargar(); recargarCompartido(); }} onCerrar={() => setMasivaAbierta(false)} />
        )}

        {formAbierto && (
          <div className="border-b border-zinc-100 px-4 py-3 space-y-2 bg-zinc-50/60">
            {editandoId != null && (() => {
              // Pedido explícito del usuario (15-sep-2026: "no tengo dónde poner... la cantidad de
              // productos... lo podemos sacar del costeo") — la cantidad NO es un dato de la
              // cotización, es del producto ya asignado (ver "Asignar productos", aparte). Antes
              // esto solo decía "no se toca acá" sin mostrar qué hay — ahora muestra el producto y
              // la cantidad real (de Costeo), para que quede a la vista sin tener que adivinar.
              const cot = cotizaciones.find(c => c.id === editandoId);
              const asignados = (cot?.items || []).map(it => productos.find(p => p.id === it.productoId)).filter((p): p is Producto => !!p);
              return (
                <p className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-1">
                  Editando cotización — el archivo no se toca acá.{' '}
                  {asignados.length > 0
                    ? <>Producto/cantidad asignados: {asignados.map(p => `${p.descripcion} (${p.cantidad ?? '?'} un.)`).join(', ')} — para cambiarlo, usa <span className="underline">Asignar productos</span>.</>
                    : <>Todavía no está asignada a ningún producto — usa <span className="underline">Asignar productos</span> para vincularla (ahí se define la cantidad).</>}
                </p>
              );
            })()}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <input value={form.proveedorNombre} onChange={e => setForm(f => ({ ...f, proveedorNombre: e.target.value }))}
                placeholder="Proveedor (nombre)" className="text-[12px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <input value={form.proveedorRut} onChange={e => setForm(f => ({ ...f, proveedorRut: e.target.value }))} onBlur={() => validarProveedor()}
                placeholder="RUT (opcional)" className="text-[12px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <Select value={form.origen} onChange={v => setForm(f => ({ ...f, origen: v as Origen }))}
                options={(Object.keys(ORIGEN_LABEL) as Origen[]).map(o => ({ value: o, label: ORIGEN_LABEL[o] }))} minWidth={120} />
            </div>
            {/* Validación del proveedor contra Obuma (pedido explícito, 14-sep-2026: "todo lo que
                ingresemos debe estar validado") — corre al salir del campo RUT Y apenas el
                documento lo autocompleta solo (ver leerArchivo). Tres estados posibles. */}
            {historicoProveedor.estado === 'cargando' && (
              <p className="text-[10.5px] text-zinc-400 flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Validando el RUT contra Obuma…</p>
            )}
            {historicoProveedor.estado === 'listo' && historicoProveedor.validacion === 'en_catalogo' && (
              <p className="text-[10.5px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1 flex items-center gap-1">
                <ShieldCheck size={11} /> Proveedor validado — reconocido en Obuma como <b>{historicoProveedor.nombreEmpresa}</b>.
                {historicoProveedor.historico && ` Ya le compramos antes${historicoProveedor.historico.ultimaOcFolio ? ` — última OC ${historicoProveedor.historico.ultimaOcFolio}` : ''}${historicoProveedor.historico.ultimaOcFecha ? ` (${historicoProveedor.historico.ultimaOcFecha})` : ''}.`}
              </p>
            )}
            {historicoProveedor.estado === 'listo' && historicoProveedor.validacion === 'en_obuma_no_catalogo' && (
              <p className="text-[10.5px] text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-1 flex items-center gap-1">
                <Link2 size={11} /> Existe en Obuma como <b>{historicoProveedor.nombreEmpresa}</b> pero todavía no está en nuestro catálogo — se enlaza solo al guardar.
              </p>
            )}
            {historicoProveedor.estado === 'listo' && historicoProveedor.validacion === 'no_existe_en_obuma' && (
              <p className="text-[10.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 flex items-center gap-1">
                <AlertTriangle size={11} /> Este RUT NO existe en Obuma — al guardar se crea un proveedor nuevo solo en Licitank (no en Obuma).
              </p>
            )}
            <textarea rows={2} value={form.descripcionLibre} onChange={e => setForm(f => ({ ...f, descripcionLibre: e.target.value }))}
              placeholder="Qué cotizó (productos, condiciones)…" className="w-full text-[12px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <input inputMode="numeric" value={form.precioUnitario} onChange={e => setForm(f => ({ ...f, precioUnitario: e.target.value }))}
                placeholder="Precio unitario" className="text-[12px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              {/* Descuento (pedido explícito, 14-sep-2026: cotización de Trotec con 4% de descuento
                  que antes no había dónde tipear — se perdía y el precio quedaba con el bruto). */}
              <input inputMode="numeric" value={form.descuentoPct} onChange={e => setForm(f => ({ ...f, descuentoPct: e.target.value }))}
                placeholder="Descuento % (opcional)" className="text-[12px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <Select value={form.moneda} onChange={v => setForm(f => ({ ...f, moneda: v }))} minWidth={90}
                options={MONEDAS_SOPORTADAS.map(m => ({ value: m, label: m }))} />
              <input value={form.plazoEntregaTexto} onChange={e => setForm(f => ({ ...f, plazoEntregaTexto: e.target.value }))}
                placeholder="Plazo de entrega" className="text-[12px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
            </div>
            {form.precioUnitario.trim() && form.descuentoPct.trim() && parsearMontoCL(form.descuentoPct) != null && (parsearMontoCL(form.descuentoPct) as number) > 0 && (
              <p className="text-[10.5px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">
                Bruto {fmtCLP(parsearMontoCL(form.precioUnitario))} − {form.descuentoPct}% de descuento = <b>neto {fmtCLP(Math.round((parsearMontoCL(form.precioUnitario) || 0) * (1 - (parsearMontoCL(form.descuentoPct) || 0) / 100)))}</b> por unidad — este es el precio que entra al cuadro comparativo y los escenarios.
              </p>
            )}
            {form.moneda !== 'CLP' && (
              <p className="text-[10.5px] text-amber-600">Se convierte a CLP con el tipo de cambio del día (fuente: mindicador.cl) al guardar — la ficha del cuadro comparativo usa el valor convertido.</p>
            )}
            {/* Despacho/flete — REDISEÑADO (pedido explícito, 15-sep-2026: "en ningún lado me
                pusiste para poner retiramos nosotros entonces no pagamos flete queda en cero").
                El selector viejo de 2 opciones ("Incluye flete" / "No incluye flete") obligaba a
                entender una convención implícita — un caso real terminó con el toggle marcado al
                revés de lo que la propia persona describía en la justificación. Ahora son 3
                opciones que describen la situación física tal cual, sin jerga: quién despacha, y
                si el retiro propio tiene costo o no. Por debajo se sigue guardando lo mismo
                (incluyeFlete + fleteMonto), nada cambia en la base de datos ni en los escenarios. */}
            <div className="grid grid-cols-2 gap-2 items-center">
              <Select
                value={form.incluyeFlete === 'true' ? 'proveedor' : form.incluyeFlete === 'false' ? (form.fleteMonto.trim() === '0' ? 'retiro_gratis' : 'retiro_costo') : ''}
                onChange={v => setForm(f => {
                  if (v === 'proveedor') return { ...f, incluyeFlete: 'true', fleteMonto: '' };
                  if (v === 'retiro_gratis') return { ...f, incluyeFlete: 'false', fleteMonto: '0' };
                  return { ...f, incluyeFlete: 'false', fleteMonto: f.fleteMonto.trim() === '0' ? '' : f.fleteMonto };
                })}
                placeholder="¿Quién despacha?" minWidth={220}
                options={[
                  { value: 'proveedor', label: 'El proveedor lo entrega (incluido en su precio)' },
                  { value: 'retiro_gratis', label: 'Lo retiramos nosotros, sin costo' },
                  { value: 'retiro_costo', label: 'Lo retiramos nosotros, el proveedor cobra flete aparte' },
                ]} />
              <label className="text-[11px] font-semibold text-zinc-500">
                Vigente hasta (opcional, spec §8.12)
                <input type="date" value={form.vigenciaAt} onChange={e => setForm(f => ({ ...f, vigenciaAt: e.target.value }))}
                  className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              </label>
            </div>
            {form.incluyeFlete === 'false' && form.fleteMonto.trim() !== '0' && (
              <input inputMode="numeric" value={form.fleteMonto} onChange={e => setForm(f => ({ ...f, fleteMonto: e.target.value }))}
                placeholder="Monto del flete que cobra el proveedor por el retiro"
                className="w-full text-[12px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
            )}
            {form.incluyeFlete === 'false' && form.fleteMonto.trim() === '' && (
              <p className="text-[10.5px] text-amber-600">Si todavía no sabés cuánto cobra, dejalo vacío — el escenario va a avisar "flete sin confirmar" en vez de inventar un número (spec §8.10.2).</p>
            )}
            {/* Agente de documentos (pedido explícito, 14-sep-2026) — lee bases/anexos/acta del
                proyecto y cruza contra lo que se está tipeando ANTES de guardar. Manual (no se
                dispara solo): cada revisión tiene costo real de IA. */}
            <div className="border-t border-zinc-200 pt-2 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={revisarConAgente}
                  disabled={revisionAgente.estado === 'revisando' || !form.proveedorNombre.trim() || !!usoAgente?.agotado}
                  className="flex items-center gap-1.5 text-[11.5px] font-semibold text-indigo-700 hover:text-indigo-800 disabled:opacity-50">
                  {revisionAgente.estado === 'revisando' ? <Loader2 size={13} className="animate-spin" /> : <Bot size={13} />}
                  Revisar con IA contra los documentos del proyecto
                </button>
                {/* Contador de tope diario (pedido explícito, 14-sep-2026) — cada revisión gasta
                    créditos reales de Gemini, así que se ve cuánto queda antes de apretar. */}
                {usoAgente && (
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${usoAgente.agotado ? 'text-rose-700 bg-rose-50' : 'text-zinc-400 bg-zinc-100'}`}>
                    {usoAgente.llamadas}/{usoAgente.tope} hoy
                  </span>
                )}
              </div>
              {usoAgente?.agotado && (
                <p className="text-[10.5px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">
                  Se alcanzó el tope de revisiones con IA de hoy — vuelve a intentar mañana.
                </p>
              )}
              {revisionAgente.estado === 'error' && (
                <p className="text-[10.5px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">{revisionAgente.mensaje}</p>
              )}
              {revisionAgente.estado === 'listo' && !revisionAgente.encontroDocumentos && (
                <p className="text-[10.5px] text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-lg px-2 py-1.5">{revisionAgente.resumen}</p>
              )}
              {revisionAgente.estado === 'listo' && revisionAgente.encontroDocumentos && (() => {
                // Cita + link "ver documento" (pedido explícito, 15-sep-2026: "ponele un ojo...
                // para ver los documentos y citas... de dónde sacó esa información"). La URL sale
                // de `fuentes` (mismo nombre de archivo que citó el agente); `citaVerificada` la
                // calculó el backend con un match de texto literal, no otro modelo "opinando".
                const fuentes = revisionAgente.fuentes;
                const urlDeFuente = (nombre: string | null) => nombre ? fuentes.find(f => f.nombre === nombre)?.url ?? null : null;
                const Cita = ({ documento, citaTextual, citaVerificada }: { documento: string | null; citaTextual: string | null; citaVerificada: boolean }) => {
                  if (!documento && !citaTextual) return null;
                  const url = urlDeFuente(documento);
                  return (
                    <div className="mt-1 flex items-start gap-1 text-[9.5px] text-zinc-500">
                      {citaTextual && <span className="italic">"{citaTextual}"</span>}
                      {documento && (
                        <span className={`flex-shrink-0 font-semibold ${citaVerificada ? 'text-emerald-600' : 'text-amber-600'}`}>
                          — {documento}{citaVerificada ? ' ✓' : ' (cita sin verificar)'}
                        </span>
                      )}
                      {url && (
                        <a href={url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 text-indigo-600 hover:text-indigo-700" title="Ver documento">
                          <Eye size={11} />
                        </a>
                      )}
                    </div>
                  );
                };
                return (
                  <div className="border border-indigo-200 bg-indigo-50/50 rounded-lg p-2.5 space-y-2">
                    <p className="text-[10.5px] text-indigo-800">{revisionAgente.resumen}</p>
                    {revisionAgente.alertas.map((a, i) => (
                      <div key={i} className={`text-[10.5px] rounded-lg px-2 py-1 border ${
                        a.gravedad === 'critico' ? 'text-rose-700 bg-rose-50 border-rose-200' :
                        a.gravedad === 'aviso' ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-zinc-600 bg-white border-zinc-200'}`}>
                        <p className="flex items-start gap-1"><AlertTriangle size={11} className="flex-shrink-0 mt-0.5" /> {a.mensaje}</p>
                        <Cita documento={a.documento} citaTextual={a.citaTextual} citaVerificada={a.citaVerificada} />
                      </div>
                    ))}
                    {revisionAgente.sugerencias.map((s, i) => (
                      <div key={i} className="text-[10.5px] bg-white border border-indigo-200 rounded-lg px-2 py-1">
                        <div className="flex items-center gap-2">
                          <span className="text-zinc-600 flex-1">{s.razon} → <b>{s.valor}</b></span>
                          <button onClick={() => aplicarSugerenciaAgente(s)} className="flex-shrink-0 font-semibold text-indigo-700 hover:text-indigo-800">Usar</button>
                        </div>
                        <Cita documento={s.documento} citaTextual={s.citaTextual} citaVerificada={s.citaVerificada} />
                      </div>
                    ))}
                    {revisionAgente.documentosLeidos.length > 0 && (
                      <p className="text-[9.5px] text-zinc-400 flex items-center gap-1 flex-wrap">
                        Fuentes leídas:
                        {fuentes.map((f, i) => (
                          <span key={i} className="inline-flex items-center gap-0.5">
                            {f.nombre}
                            {f.url && (
                              <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:text-indigo-700" title="Ver documento"><Eye size={10} /></a>
                            )}
                            {i < fuentes.length - 1 && ','}
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
            {editandoId == null && productos.length > 0 && (
              <div className="border border-zinc-200 rounded-lg p-2.5 space-y-1.5 bg-white">
                <p className="text-[11px] font-semibold text-zinc-500">
                  ¿A qué producto(s) corresponde? (opcional, spec §8.7) — si lo sabés con certeza marcalo acá, así no hace falta "Asignar productos" después. Si no marcás nada, el agente de IA la homologa sola apenas guardes.
                </p>
                {productos.map(p => {
                  const draft = itemsCreacion[p.id] || { activo: false, precioUnitario: '', cumple: 'CUMPLE' as Cumple };
                  return (
                    <div key={p.id} className="flex items-center gap-2">
                      <input type="checkbox" checked={draft.activo} className="accent-teal-600"
                        onChange={e => setItemsCreacion(b => ({ ...b, [p.id]: { ...draft, activo: e.target.checked } }))} />
                      <span className="text-[11.5px] text-zinc-700 flex-1 min-w-0 truncate">{p.descripcion}</span>
                      {draft.activo && (
                        <>
                          <input inputMode="numeric" value={draft.precioUnitario} placeholder={`Precio unitario${form.moneda !== 'CLP' ? ` (${form.moneda})` : ''}`}
                            onChange={e => setItemsCreacion(b => ({ ...b, [p.id]: { ...draft, precioUnitario: e.target.value } }))}
                            className="w-32 text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-teal-500" />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {editandoId == null && (
              <label className="block text-[11px] font-semibold text-zinc-500">
                Archivo (PDF, imagen, captura de WhatsApp — opcional, spec §8.3)
                <input type="file" accept=".pdf,image/*" onChange={e => {
                  const f = e.target.files?.[0] || null;
                  setArchivo(f); setArchivoExtraido({ estado: 'idle' });
                  if (f) leerArchivo(f);
                }} className="mt-0.5 w-full text-[11.5px] text-zinc-600 file:mr-2 file:text-[11px] file:font-semibold file:text-teal-700 file:bg-teal-50 file:border-0 file:rounded-lg file:px-2 file:py-1" />
                {archivo && <span className="text-[10.5px] text-zinc-400">{archivo.name}</span>}
              </label>
            )}
            {archivoExtraido.estado === 'leyendo' && (
              <p className="text-[10.5px] text-indigo-600 flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Leyendo el documento — completando lo que falte…</p>
            )}
            {archivoExtraido.estado === 'listo' && archivoExtraido.huboDatos && (
              <p className="text-[10.5px] text-indigo-600 bg-indigo-50/60 border border-indigo-100 rounded-lg px-2 py-1 flex items-center gap-1">
                <CheckCircle2 size={11} /> Datos leídos del documento y completados arriba — revísalos antes de guardar.
              </p>
            )}
            {archivoExtraido.estado === 'listo' && !archivoExtraido.huboDatos && (
              <p className="text-[10.5px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 flex items-center justify-between gap-2 flex-wrap">
                <span>No se pudo leer con certeza — completa los datos a mano, el archivo queda igual adjunto a la cotización.</span>
                {archivo && (
                  <button onClick={() => leerArchivo(archivo)} className="flex-shrink-0 font-semibold underline hover:text-amber-800">Reintentar lectura</button>
                )}
              </p>
            )}
            {/* Información extra del documento más allá de precio/plazo (pedido explícito,
                15-sep-2026) — garantía, condiciones de pago, vigencia, etc. Persistente (no solo el
                toast, que desaparece) para que quede a la vista mientras se llena el resto. */}
            {archivoExtraido.estado === 'listo' && archivoExtraido.notasAdicionales.length > 0 && (
              <div className="text-[10.5px] text-indigo-700 bg-indigo-50/60 border border-indigo-100 rounded-lg px-2 py-1.5">
                <p className="font-semibold mb-0.5">El documento también menciona:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {archivoExtraido.notasAdicionales.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              </div>
            )}
            {archivoExtraido.estado === 'error' && (
              <p className="text-[10.5px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 flex items-center justify-between gap-2 flex-wrap">
                <span>No se pudo leer el documento ahora — se sube igual al guardar e intenta leerse de nuevo.</span>
                {archivo && (
                  <button onClick={() => leerArchivo(archivo)} className="flex-shrink-0 font-semibold underline hover:text-amber-800">Reintentar lectura</button>
                )}
              </p>
            )}
            <p className="text-[10.5px] text-zinc-400">
              El proveedor que escribas acá se reconoce (por RUT) o se crea solo en el catálogo — para completarle correo, teléfono, categoría o cuenta bancaria, entra a <a href="/compras/proveedores" target="_blank" rel="noopener noreferrer" className="text-teal-600 hover:text-teal-700 font-semibold">Proveedores</a>.
            </p>
            <div className="flex items-center gap-2">
              <button onClick={editandoId != null ? guardarEdicion : crearCotizacion} disabled={(!form.proveedorNombre.trim() && !archivo) || guardandoForm}
                className="text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-3 py-1.5 rounded-lg">
                {guardandoForm ? <Loader2 size={13} className="animate-spin" /> : editandoId != null ? 'Guardar cambios' : 'Guardar'}
              </button>
              <button onClick={cancelarFormulario} className="text-zinc-400 hover:text-zinc-600"><X size={16} /></button>
            </div>
          </div>
        )}

        {cotizaciones.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-zinc-400">Sin cotizaciones todavía. Óptimo: tres por producto (spec §8.11).</p>
        ) : (
          <div className="divide-y divide-zinc-100">
            {cotizaciones.map(c => (
              <div key={c.id} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold text-zinc-800">
                      {c.proveedorNombre}
                      {c.proveedorNuevo != null && (
                        <span className="ml-1.5 text-[10px] font-bold text-zinc-400">{c.proveedorNuevo ? '(nuevo)' : '(antiguo)'}</span>
                      )}
                    </p>
                    <p className="text-[11px] text-zinc-400">
                      {ORIGEN_LABEL[c.origen]}
                      {c.precioUnitario != null && (
                        c.moneda !== 'CLP'
                          ? ` · ${c.moneda} ${c.precioUnitario.toLocaleString('es-CL')}${c.precioUnitarioClp != null ? ` (${fmtCLP(c.precioUnitarioClp)} al día del registro, $${c.tipoCambioUsado})` : ' — sin convertir, no entra al comparativo'}`
                          : ` · ${fmtCLP(c.precioUnitario)}`
                      )}
                      {/* Desglose de descuento (pedido explícito, 14-sep-2026) — si esta cotización
                          se cargó con descuento, se ve de dónde salió el neto. */}
                      {c.descuentoPct != null && c.precioUnitarioBruto != null && (
                        <span className="text-emerald-600"> (bruto {fmtCLP(c.precioUnitarioBruto)} − {c.descuentoPct}%)</span>
                      )}
                      {c.plazoEntregaTexto && ` · ${c.plazoEntregaTexto}`}
                      {c.archivoUrl && (
                        <a href={c.archivoUrl} target="_blank" rel="noopener noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-teal-600 hover:text-teal-700 font-semibold">
                          <Paperclip size={10} /> Ver archivo
                        </a>
                      )}
                    </p>
                    {c.items.length > 0 ? (
                      <div className="space-y-1.5 mt-1.5">
                        {c.items.map(it => (
                          <AuditoriaCotizacionPanel key={it.productoId}
                            negocioId={negocioId} cotizacionId={c.id} productoId={it.productoId}
                            productoNombre={`${productos.find(p => p.id === it.productoId)?.descripcion || `#${it.productoId}`}${it.precioUnitario != null ? ` · ${fmtCLP(it.precioUnitario)}` : ''}`}
                            auditoria={auditorias.find(a => a.cotizacionId === c.id && a.productoId === it.productoId)}
                            puedeOperar={puedeOperar} onCambio={async () => { await cargar(); recargarCompartido(); }} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10.5px] text-amber-600 mt-0.5">Todavía no está asignada a ningún producto — no aparece en el cuadro comparativo.</p>
                    )}
                  </div>
                  {puedeOperar && (
                    <div className="flex-shrink-0 flex items-center gap-2">
                      <button onClick={() => (asignandoId === c.id ? setAsignandoId(null) : abrirAsignacion(c))}
                        className="flex items-center gap-1 text-[11px] font-semibold text-zinc-600 hover:text-zinc-800">
                        <ListChecks size={12} /> {asignandoId === c.id ? 'Cerrar' : 'Asignar productos'}
                      </button>
                      <button onClick={() => homologar(c.id)} disabled={homologando === c.id}
                        className="flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 disabled:opacity-50">
                        {homologando === c.id ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                        {c.homologadaAt ? 'Re-homologar' : 'Homologar con IA'}
                      </button>
                      {/* Editar/eliminar (pedido explícito, 14-sep-2026: "tampoco se pueden eliminar
                          ni editar las cotizaciones y eso es básico"). */}
                      <button onClick={() => iniciarEdicion(c)}
                        className="flex items-center gap-1 text-[11px] font-semibold text-zinc-600 hover:text-zinc-800">
                        <Pencil size={12} /> Editar
                      </button>
                      {confirmandoEliminarId === c.id ? (
                        <span className="flex items-center gap-1.5 text-[11px]">
                          <span className="text-rose-700 font-semibold">¿Eliminar?</span>
                          <button onClick={() => eliminarCotizacion(c.id)} disabled={eliminando === c.id}
                            className="font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 px-2 py-0.5 rounded">
                            {eliminando === c.id ? <Loader2 size={11} className="animate-spin" /> : 'Sí'}
                          </button>
                          <button onClick={() => setConfirmandoEliminarId(null)} className="text-zinc-400 hover:text-zinc-600">No</button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmandoEliminarId(c.id)}
                          className="flex items-center gap-1 text-[11px] font-semibold text-rose-600 hover:text-rose-700">
                          <Trash2 size={12} /> Eliminar
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* §8.7: una cotización puede cubrir varios productos — acá se elige a mano cuáles,
                    con su propio precio y cumplimiento por producto, sin depender de que la IA
                    adivine bien desde el texto libre. Precarga lo que ya haya (de la IA o de una
                    edición anterior) y GUARDAR reemplaza esa asignación completa. */}
                {asignandoId === c.id && (
                  <div className="mt-2 border border-zinc-200 rounded-lg p-2.5 space-y-1.5 bg-zinc-50/60">
                    {productos.map(p => {
                      const draft = borradorAsignacion[p.id] || { activo: false, precioUnitario: '', cumple: 'CUMPLE' as Cumple };
                      return (
                        <div key={p.id} className="flex items-center gap-2">
                          <input type="checkbox" checked={draft.activo} className="accent-teal-600"
                            onChange={e => setBorradorAsignacion(b => ({ ...b, [p.id]: { ...draft, activo: e.target.checked } }))} />
                          <span className="text-[11.5px] text-zinc-700 flex-1 min-w-0 truncate">{p.descripcion}</span>
                          {draft.activo && (
                            <>
                              <input inputMode="numeric" value={draft.precioUnitario} placeholder="Precio unitario"
                                onChange={e => setBorradorAsignacion(b => ({ ...b, [p.id]: { ...draft, precioUnitario: e.target.value } }))}
                                className="w-28 text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-teal-500" />
                            </>
                          )}
                        </div>
                      );
                    })}
                    <div className="flex items-center gap-2 pt-1">
                      <button onClick={() => guardarAsignacion(c.id)} disabled={guardandoAsignacion}
                        className="flex items-center gap-1 text-[11.5px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">
                        {guardandoAsignacion ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Guardar asignación
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {negociacion.length > 0 && (
        <Banner variante="info">
          <span className="font-semibold flex items-center gap-1"><TrendingDown size={13} /> Espacio de negociación detectado:</span>
          <ul className="mt-1 space-y-0.5">
            {negociacion.map(n => (
              <li key={n.productoId} className="text-[12px]">
                <span className="font-semibold">{n.descripcion}</span>: {fmtCLP(n.minimo)} a {fmtCLP(n.maximo)} — negociar con {n.proveedorMasCaro} (diferencia {fmtCLP(n.diferencia)}).
              </li>
            ))}
          </ul>
        </Banner>
      )}

      {cuadro.length > 0 && (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <p className="px-4 py-2.5 text-[11px] font-bold text-zinc-500 uppercase bg-zinc-50 border-b border-zinc-100">Cuadro comparativo</p>
          <div className="divide-y divide-zinc-100">
            {cuadro.map(f => (
              <div key={f.productoId} className="px-4 py-2.5">
                <p className="text-[12px] font-semibold text-zinc-800">{f.descripcion}</p>
                {!f.cubierto ? (
                  <p className="text-[11px] text-amber-600 mt-0.5">Sin ninguna cotización todavía — hueco visible.</p>
                ) : (
                  <div className="flex flex-wrap gap-2 mt-1">
                    {f.cotizacionesPorProveedor.map((p, i) => (
                      <span key={i} className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full border ${p.cumple ? CUMPLE_STYLE[p.cumple] : 'text-zinc-400 bg-zinc-50 border-zinc-200'}`}>
                        {p.proveedor}: {fmtCLP(p.precioUnitario)}
                      </span>
                    ))}
                  </div>
                )}
                {f.puntosCriticos && (
                  <p className="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-1 mt-1.5 flex items-start gap-1">
                    <Sparkles size={11} className="mt-0.5 flex-shrink-0" /> {f.puntosCriticos}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}


      {combinaciones && (combinaciones.combinaciones.length > 0 || combinaciones.productosSinOferta.length > 0) && (
        <CombinacionesCompra datos={combinaciones} elegidaClave={combinacionElegida} elegidoTipo={elegidoTipo} elegidoCostoGuardado={elegidoCostoGuardado}
          puedeOperar={puedeOperar} eligiendo={eligiendoComb} onElegir={(clave, justificacion) => elegirCombinacion(clave, justificacion)} />
      )}
    </div>
  );
}
