'use client';

import { useEffect } from 'react';

// Antes, si algo fallaba al renderizar Compras, la pantalla quedaba en blanco sin explicación.
// Ahora se ve el error real (para poder reportarlo) y se puede reintentar sin recargar todo.
export default function ComprasError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error('[Compras] error de render:', error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <p className="text-[13px] font-bold uppercase tracking-widest text-zinc-400">Algo falló en Compras</p>
      <h1 className="text-xl font-bold text-zinc-900 dark:text-slate-100">Esta pantalla no pudo mostrarse</h1>
      <p className="text-[14px] text-zinc-500 dark:text-slate-400">
        Tus datos no se perdieron. Reintenta; si vuelve a pasar, avísanos con el detalle de abajo.
      </p>
      <pre className="max-h-40 w-full overflow-auto rounded-xl bg-zinc-100 p-3 text-left text-[12px] text-zinc-700 dark:bg-slate-800 dark:text-slate-300">
        {error.message}{error.digest ? `\n(digest: ${error.digest})` : ''}
      </pre>
      <button
        onClick={() => unstable_retry()}
        className="mt-2 rounded-xl bg-zinc-900 px-5 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-zinc-700"
      >
        Reintentar
      </button>
    </div>
  );
}
