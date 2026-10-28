'use client';

// Piezas de estructura de pantalla (skill licitank-ui): encabezado, sección, carga y vacío.

/** Título de la pantalla con descripción corta y acciones a la derecha. */
export function Encabezado({ titulo, descripcion, acciones }: {
  titulo: string; descripcion?: string; acciones?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-5">
      <div className="min-w-0">
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-tinta dark:text-slate-50">{titulo}</h1>
        {descripcion && <p className="mt-1 text-sm text-tinta-2 dark:text-slate-400 max-w-2xl">{descripcion}</p>}
      </div>
      {acciones && <div className="flex items-center gap-2">{acciones}</div>}
    </header>
  );
}

/** Bloque con título en minúscula normal (nunca MAYÚSCULAS con tracking). */
export function Seccion({ titulo, accion, children }: { titulo: string; accion?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-8 first:mt-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-tinta dark:text-slate-100">{titulo}</h2>
        {accion}
      </div>
      {children}
    </section>
  );
}

/** Carga: bloques con brillo que se desplaza, con la forma de lo que viene. Sin giradores. */
export function Esqueleto({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden className={`rounded-md bg-[linear-gradient(90deg,#f1f5f9_0%,#e2e8f0_50%,#f1f5f9_100%)]
      dark:bg-[linear-gradient(90deg,#1e293b_0%,#273449_50%,#1e293b_100%)]
      bg-[length:200%_100%] animate-[shimmer_1.4s_ease-in-out_infinite] motion-reduce:animate-none ${className}`} />
  );
}

export function TarjetaCargando() {
  return (
    <div className="rounded-xl border border-linea bg-white px-4 py-3.5 shadow-tarjeta dark:bg-slate-900 dark:border-slate-800">
      <Esqueleto className="h-4 w-3/4" />
      <Esqueleto className="mt-2 h-3 w-1/2" />
      <div className="mt-4 pt-3 border-t border-linea/80 dark:border-slate-800 grid grid-cols-2 gap-3">
        <Esqueleto className="h-8" /><Esqueleto className="h-8" />
      </div>
    </div>
  );
}

/** Estado vacío: dice qué pasa y qué hacer, con una acción. */
export function Vacio({ icono, titulo, texto, accion }: {
  icono?: React.ReactNode; titulo: string; texto?: string; accion?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center rounded-xl border border-dashed border-slate-300 px-6 py-10 dark:border-slate-700">
      {icono && <div className="mb-3 text-tinta-3">{icono}</div>}
      <p className="text-sm font-medium text-tinta dark:text-slate-100">{titulo}</p>
      {texto && <p className="mt-1 text-[13px] text-tinta-2 dark:text-slate-400 max-w-sm">{texto}</p>}
      {accion && <div className="mt-4">{accion}</div>}
    </div>
  );
}
