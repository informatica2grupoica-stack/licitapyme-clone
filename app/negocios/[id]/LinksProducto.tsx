'use client';

// Links del costeo de un producto, mostrados igual en Productos, Cotizaciones y Fichas: el producto va acumulando
// información de una etapa a la siguiente (link → cotización → ficha) sin perder lo anterior.
import { esLinkDeProducto } from '@/app/lib/costeo-comparativo';

export type LinksCosteo = Record<number, { nombre: string; links: string[]; filaId?: string }>;

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

export function LinksProducto({ links }: { links: string[] | undefined }) {
  if (!links) return null;
  return (
    <span className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[11.5px] font-normal">
      {links.length === 0
        ? <span className="text-zinc-400">Sin link en el costeo</span>
        : links.map((u, i) => esLinkDeProducto(u)
          // «dominio.cl/p/1» pegado sin protocolo se abre con https://; un comentario («llamé al proveedor») ya no es enlace (abría una ruta de la app).
          ? <a key={u} href={/^https?:\/\//i.test(u.trim()) ? u.trim() : `https://${u.trim()}`} target="_blank" rel="noopener noreferrer" title={u} className="text-teal-700 hover:text-teal-900 underline underline-offset-2 truncate max-w-[260px]">Link {i + 1} · {host(u)}</a>
          : <span key={u} title={u} className="text-zinc-500 truncate max-w-[260px]">Nota {i + 1}: {u}</span>)}
    </span>
  );
}
