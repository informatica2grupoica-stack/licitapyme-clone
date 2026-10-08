'use client';

// TUTORIAL de cada paso de Compras: "¿cómo se hace?". Texto fijo y en lenguaje simple, escrito según lo que
// realmente hace cada pantalla (botones y nombres reales). Se puede ocultar y el sistema recuerda la elección
// por paso en este navegador (si el almacenamiento no está disponible, simplemente queda visible).
import { useEffect, useState } from 'react';
import { IconBulb as Bulb, IconChevronDown as ChevronDown } from '@tabler/icons-react';

export type FaseTutorial = 'tareas' | 'costeo' | 'aprobacion' | 'compra' | 'entrega' | 'obuma' | 'documentos' | 'actividad';

interface Tutorial { objetivo: string; quien: string; pasos: Array<{ titulo: string; detalle: string }>; ojo?: string }

export const TUTORIALES: Record<FaseTutorial, Tutorial> = {
  tareas: {
    objetivo: 'Dejar el proyecto bien armado en los primeros días: contactar al cliente, validar lo que se ofertó y fijar los plazos.',
    quien: 'Encargado de Compras (el jefe de ventas supervisa).',
    pasos: [
      { titulo: 'Lee el resumen ejecutivo', detalle: 'Está más arriba: precio ganado, plazo de entrega, si piden boleta de garantía o contrato, y los contactos del cliente.' },
      { titulo: 'Haz el contacto inicial con el cliente', detalle: 'Idealmente el día 1: acusa recibo de la orden de compra, preséntate como responsable de la entrega y resuelve dudas. Así, si después hay un problema, ya existe una relación para negociar.' },
      { titulo: 'Valida que el producto sea real y sea el correcto', detalle: 'Confirma que la ficha corresponde a un producto que existe y que lo que se va a comprar es lo que se ofertó.' },
      { titulo: 'Valida la cotización de respaldo', detalle: 'Llama al vendedor: ¿existe el producto?, ¿hay stock?, ¿cumple?, ¿en cuánto tiempo llega?, ¿el precio sigue vigente? Si hay un hallazgo, se abre una incidencia.' },
      { titulo: 'Registra cada tarea', detalle: 'Abre la tarea y pulsa «Registrar lo que se hizo»: con quién hablaste, qué se acordó. Queda guardado con tu nombre y la hora.' },
      { titulo: 'Confirma el plazo de entrega', detalle: 'La franja de arriba lo muestra: cuando la OC está aceptada, el sistema calcula desde cuándo corre y cuándo vence. Pulsa la franja y «Confirmar reloj» (o «Ajustar» si algo no calza).' },
    ],
    ojo: 'Cualquier problema que aparezca (sin stock, plazo imposible, una alternativa más barata) se anota en «Incidencias» (botón rojo de la franja de arriba, o en «Entrega y cierre»). Las incidencias NO detienen el reloj de entrega. Si el proyecto necesita una tarea que no está en la lista, usa «Agregar tarea propia».',
  },
  costeo: {
    objetivo: 'Conseguir cotizaciones reales, ver si su precio conviene frente a lo costeado, y elegir cómo comprar.',
    quien: 'Encargado de Compras.',
    pasos: [
      { titulo: 'Mira los productos (sección 1)', detalle: 'Cada producto ganado debe terminar con una cotización. Una línea que se llevó otro proveedor aparece bloqueada y no se compra. Si cambió el costeo, pulsa «Sincronizar con costeo».' },
      { titulo: 'Carga cotizaciones (sección 2)', detalle: '«Cargar varias» sube de una vez PDFs o fotos de varios proveedores. «Registrar cotización» sirve para lo informal: llamada, WhatsApp o texto pegado (anota proveedor, RUT, precio, plazo y si incluye flete). Lo ideal son 3 por producto.' },
      { titulo: 'Asocia cada cotización a sus productos', detalle: 'Si quedó sin asignar, usa «Asignar productos» o «Homologar con IA» para que el sistema relacione lo que dice el proveedor con lo que se compra.' },
      { titulo: 'Suma lo que la cotización trae aparte', detalle: 'Muchas cotizaciones traen el producto solo y el resto por separado (el quemador del horno, las bandejas del carro). En cada producto pulsa «Agregar adicionales», escribe qué es, la cantidad y el precio neto: se suma al precio que se compara. Así la comparación es contra lo que de verdad hay que comprar para entregar el producto.' },
      { titulo: 'Lee la comparación de precio', detalle: 'Cada producto cotizado muestra «Lo costeado» contra «Esta cotización» y si es más barata, igual o más cara, con el monto y el porcentaje. Si es más cara, negocia o pide otra cotización. «Ver otros controles» muestra plazo, vigencia y RUT.' },
      { titulo: 'Compara y elige un escenario', detalle: 'Abajo ves «Comparación por producto» y los escenarios de compra: Más rápido, Mínimo precio, Mínimos viajes y Equilibrado. Elige uno. Si te apartas del sugerido, escribe por qué.' },
      { titulo: 'Fichas técnicas (sección 3)', detalle: 'La revisión técnica es aparte y con otro documento: la ficha técnica del producto, no la cotización. Aún no está disponible.' },
      { titulo: 'Verifica el costo de cada línea (sección 4)', detalle: 'Pulsa «Auditar todas las líneas». Comprueba que cada costo del costeo tenga respaldo, sea el mismo producto, la misma unidad y el IVA correcto. Cada bloqueo dice qué hacer para salir de él.' },
    ],
    ojo: 'Una cotización más cara que lo costeado no se descarta sola: sirve para negociar. Si el margen del proyecto baja del 20 %, el sistema avisa y pedirá un motivo en la aprobación.',
  },
  aprobacion: {
    objetivo: 'Que el jefe de ventas autorice la compra y el margen antes de gastar dinero, y crear el código (SKU) de lo que se va a comprar.',
    quien: 'Encargado propone; el jefe de ventas aprueba.',
    pasos: [
      { titulo: 'Hito 1 · Aprobación de compra', detalle: 'El encargado revisa el escenario elegido en «Costeo y auditoría» y pulsa «Proponer para aprobación».' },
      { titulo: 'El jefe de ventas decide', detalle: 'Puede Aprobar, Aprobar con modificación o Rechazar con un comentario.' },
      { titulo: 'Hito 2 · Aprobación de margen', detalle: 'Es independiente del anterior. El margen mínimo es 20 % (precio de venta neto contra costo neto). Si queda bajo eso, hay que escribir el motivo antes de proponer.' },
      { titulo: 'Crea el SKU', detalle: 'Con el Hito 1 aprobado se habilita «Crear SKU». Revisa el nombre, el código y el costo neto que se enviarán a Obuma y confirma.' },
    ],
    ojo: 'El SKU se nombra por lo que realmente se compra (marca y modelo), nunca por lo que pidió el cliente. Y cualquier cambio posterior a una aprobación la invalida y hay que pedirla de nuevo.',
  },
  compra: {
    objetivo: 'Ejecutar lo administrativo después de aprobar y registrar lo que realmente cuesta el proyecto.',
    quien: 'Administración y Encargado de Compras. Aquí solo se registra: las órdenes de compra, pagos y facturas se emiten en Obuma.',
    pasos: [
      { titulo: 'Con las dos aprobaciones listas, emite la compra', detalle: 'En «Pasos administrativos (OBUMA)» revisa lo que se enviará a Obuma (proveedor, centro de costo, mercadería, flete, neto total) y confirma. Si el proveedor no existe, créalo ahí mismo.' },
      { titulo: 'Marca cada hito con su respaldo', detalle: 'Orden de compra emitida, pago registrado, anticipo pagado, factura de compra, carpeta de proyecto y provisión de fondos. Cada uno pide una nota de respaldo (el archivo es opcional). Si alguno no corresponde, márcalo «No aplica» explicando por qué.' },
      { titulo: 'Si el producto viene del extranjero', detalle: 'En «Importación y costo aterrizado» anota los datos del embarque. El sistema calcula el costo final puesto en bodega, que es el que cuenta para el margen.' },
      { titulo: 'Anota el costo real', detalle: 'En «Costo real del proyecto» deja lo que de verdad se pagó por cada producto, y los gastos extra en «Gastos extra» (fletes, puesta en marcha, etc.).' },
    ],
    ojo: 'Política de pago: a un proveedor nuevo se le exige la factura antes de pagar; a uno antiguo se le puede provisionar el pago. No se emite dinero real en Obuma sin los dos hitos aprobados.',
  },
  obuma: {
    objetivo: 'Crear en Obuma, en orden y desde un solo lugar, lo que hace falta para comprar: el proveedor, el SKU de cada producto y las órdenes de compra.',
    quien: 'Encargado de Compras y Administración. Todo lo que se crea acá se escribe de verdad en Obuma, y solo cuando tú lo confirmas.',
    pasos: [
      { titulo: 'Mira «Listo para comprar en Obuma»', detalle: 'Te dice qué falta: aprobaciones, proveedores que no existen en Obuma, productos sin SKU y órdenes sin emitir.' },
      { titulo: '1 · Proveedor', detalle: 'Busca por nombre o RUT. Si no existe, «Crear proveedor en Obuma» (solo RUT y razón social son obligatorios). También sirve para una compra directa.' },
      { titulo: '2 · SKU', detalle: 'Con la compra aprobada, crea el SKU de cada producto. Si el producto ya existe en Obuma, se enlaza en vez de duplicarlo.' },
      { titulo: '3 · Orden de compra', detalle: 'Una por proveedor, de la compra elegida. Confirma forma de pago, flete y marca la casilla antes de crearla: se emite de verdad.' },
    ],
    ojo: 'La orden de compra exige las dos aprobaciones (compra y margen). Si algo está bloqueado, el aviso de arriba dice cuál.',
  },
  entrega: {
    objetivo: 'Entregar dentro del plazo, dejar el acta firmada y cerrar el proyecto.',
    quien: 'Encargado de Compras (la verificación en bodega la hace él mismo mientras no haya bodeguero).',
    pasos: [
      { titulo: 'Vigila el plazo', detalle: 'En «Plazo, prórrogas y multas». Si no vas a llegar: habla con el cliente y pide una prórroga SIN multa (la autoriza el jefe de ventas). Entregar con multa solo con una decisión expresa, nunca por atraso o silencio.' },
      { titulo: 'Prepara la entrega', detalle: 'Rotula los productos, embálalos y numéralos. La nota de venta y la guía de despacho se emiten en Obuma.' },
      { titulo: 'Verifica en bodega', detalle: 'Que el producto sea el correcto y esté en buenas condiciones, antes de cargarlo.' },
      { titulo: 'Entrega y acta', detalle: 'En «Entrega al cliente y acta» registra si es entrega total o parcial y los puntos de entrega. Pulsa «Generar acta», apruébala, imprímela y que el cliente firme el acta y la guía.' },
      { titulo: 'Captura el contacto de pagos', detalle: 'Mientras aún hay contacto con el cliente: nombre, correo y teléfono de quien paga (no es la contraparte técnica) y los datos de transferencia.' },
      { titulo: 'Cierra', detalle: 'Postventa (garantías, capacitación) y «Costo real y cierre» con el resultado final.' },
    ],
    ojo: 'Si el proyecto definitivamente no se puede entregar, se registra en «Si el proyecto no se puede entregar»: el encargado declara los motivos y el jefe de ventas dictamina la causa real.',
  },
  documentos: {
    objetivo: 'Tener a mano las bases y el acta de la licitación para validar lo que se pidió y lo que se adjudicó.',
    quien: 'Cualquiera con acceso al negocio.',
    pasos: [
      { titulo: 'Consulta las bases y el acta', detalle: 'Se abren sin salir de la pantalla.' },
      { titulo: 'Revisa la auditoría del agente', detalle: 'Es una revisión automática de este negocio: sirve de apoyo, la decisión sigue siendo tuya.' },
    ],
  },
  actividad: {
    objetivo: 'Ver qué se hizo, quién y cuándo, desde que se ganó el proyecto.',
    quien: 'Solo lectura.',
    pasos: [
      { titulo: 'Recorre la línea de tiempo', detalle: 'Cada acción queda registrada, también lo que no se hizo a tiempo.' },
      { titulo: 'Úsala como evidencia', detalle: 'Si el proyecto fracasa, esta historia es la que se usa para determinar la causa real.' },
    ],
  },
};

const LS = (fase: string) => `compras-tutorial-oculto-${fase}`;

export function TutorialPaso({ fase }: { fase: FaseTutorial }) {
  const t = TUTORIALES[fase];
  const [abierto, setAbierto] = useState(true);
  useEffect(() => { try { setAbierto(localStorage.getItem(LS(fase)) !== '1'); } catch { setAbierto(true); } }, [fase]);
  const alternar = () => {
    const nuevo = !abierto; setAbierto(nuevo);
    try { if (nuevo) localStorage.removeItem(LS(fase)); else localStorage.setItem(LS(fase), '1'); } catch { /* sin almacenamiento: no pasa nada */ }
  };
  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/60 overflow-hidden">
      <button type="button" onClick={alternar} aria-expanded={abierto}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-sky-50">
        <span className="w-8 h-8 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center flex-shrink-0"><Bulb size={17} /></span>
        <span className="flex-1 min-w-0">
          <span className="block text-[14px] font-bold text-sky-900">¿Cómo se hace este paso?</span>
          {!abierto && <span className="block text-[12.5px] text-sky-800/70 truncate">{t.objetivo}</span>}
        </span>
        <span className="text-[12px] font-semibold text-sky-700 flex-shrink-0">{abierto ? 'Ocultar' : 'Ver tutorial'}</span>
        <ChevronDown size={16} className={`text-sky-500 flex-shrink-0 transition-transform ${abierto ? 'rotate-180' : ''}`} />
      </button>
      {abierto && (
        <div className="px-4 pb-4 space-y-3 border-t border-sky-100">
          <p className="text-[13.5px] text-sky-950 pt-3"><b>Para qué sirve:</b> {t.objetivo}</p>
          <p className="text-[12.5px] text-sky-900/80"><b>Quién lo hace:</b> {t.quien}</p>
          <ol className="space-y-2.5">
            {t.pasos.map((p, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-sky-600 text-white text-[12px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                <span className="text-[13.5px] text-zinc-700 leading-snug"><b className="text-zinc-900">{p.titulo}.</b> {p.detalle}</span>
              </li>
            ))}
          </ol>
          {t.ojo && <p className="text-[13px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"><b>Ojo:</b> {t.ojo}</p>}
        </div>
      )}
    </div>
  );
}
