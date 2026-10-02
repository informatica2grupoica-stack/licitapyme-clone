import Link from 'next/link';

// 404 de la app: en español y con salida (antes salía la genérica de Next, en inglés y sin navegación).
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <p className="text-[13px] font-bold uppercase tracking-widest text-zinc-400">Error 404</p>
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-slate-100">No encontramos esta página</h1>
      <p className="max-w-sm text-[14px] text-zinc-500 dark:text-slate-400">
        El enlace puede estar mal escrito o la página ya no existe.
      </p>
      <Link
        href="/dashboard"
        className="mt-3 rounded-xl bg-zinc-900 px-5 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-zinc-700"
      >
        Ir al inicio
      </Link>
    </main>
  );
}
