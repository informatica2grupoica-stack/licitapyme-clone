// Marco común de las páginas públicas legales (/privacidad, /terminos). Sin sesión, sin AppLayout. Server component.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { LicitankIcon } from '@/app/components/LicitankLogo';

export function PaginaLegal({ titulo, vigencia, children }: { titulo: string; vigencia: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-tinta dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-linea dark:border-slate-800">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Link href="/bienvenida" className="flex items-center gap-2.5 text-sm font-semibold">
            <LicitankIcon size={22} /> LICITANK
          </Link>
          <Link href="/login" className="text-sm text-marca hover:underline">Ingresar</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
        <p className="mt-1 text-sm text-tinta-3">Vigente desde {vigencia}</p>
        <div className="mt-8 space-y-8 text-[15px] leading-7 text-tinta-2 dark:text-slate-300">{children}</div>
      </main>
      <footer className="border-t border-linea dark:border-slate-800">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-5 gap-y-2 px-5 py-5 text-[12.5px] text-tinta-3">
          <Link href="/privacidad" className="hover:underline">Privacidad</Link>
          <Link href="/terminos" className="hover:underline">Términos</Link>
          <span>© {new Date().getFullYear()} LICITANK</span>
        </div>
      </footer>
    </div>
  );
}

export function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-tinta dark:text-slate-100">{titulo}</h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}

export function Lista({ items }: { items: ReactNode[] }) {
  return <ul className="list-disc space-y-1.5 pl-5">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;
}
