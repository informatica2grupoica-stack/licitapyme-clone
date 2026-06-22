'use client';

// app/components/Resaltar.tsx
// Resalta dentro de un texto las palabras que coinciden con las palabras clave
// del usuario, usando EXACTAMENTE la misma lógica del matcher (acento/plural/
// prefijo) — así lo que se ve resaltado es lo que el radar consideró coincidente.

import { tokenizar, normalizar, tokenCalzaPalabra } from '@/app/lib/text-match';

interface ResaltarProps {
  texto?: string | null;
  keywords: string[];
  /** Clases del <mark>. Por defecto, resaltado azul suave. */
  className?: string;
}

const MARK_DEFAULT = 'bg-blue-100 text-blue-900 rounded-[3px] px-0.5 font-semibold';

export function Resaltar({ texto, keywords, className }: ResaltarProps) {
  if (!texto) return null;

  // Tokens de TODAS las keywords (sin stopwords ni muy cortas), deduplicados.
  const tokens = Array.from(new Set(keywords.flatMap(k => tokenizar(k))));
  if (tokens.length === 0) return <>{texto}</>;

  const cls = className || MARK_DEFAULT;

  // Separa en palabras (\p{L}\p{N}) vs el resto, conservando todo. Con el grupo
  // de captura, las palabras quedan en los índices impares.
  const partes = texto.split(/([\p{L}\p{N}]+)/u);

  return (
    <>
      {partes.map((seg, i) => {
        if (i % 2 === 1) {
          const n = normalizar(seg);
          if (n && tokens.some(t => tokenCalzaPalabra(t, n))) {
            return <mark key={i} className={cls}>{seg}</mark>;
          }
        }
        return seg;
      })}
    </>
  );
}
