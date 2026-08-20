// Animación del Puente del Radar: las licitaciones cruzan desde la orilla del radar hasta la
// de los perfiles del equipo. Mismo lenguaje visual que DocScanLoader/DocSplitLoader (figura
// dibujada + título + subtítulo); los estilos viven en globals.css (.puente*).
//
// Se usa mientras corren las operaciones que no son instantáneas y el usuario no tiene forma
// de saber cuánto tardan: empujar un lote al puente (hidrata cada código desde la BD) y
// confirmar el reparto (crea un negocio por licitación).
//
// Uso: <PuenteLoader titulo="Mandando al puente…" subtitulo="24 licitaciones" />
export function PuenteLoader({
  titulo,
  subtitulo,
  total,
}: {
  titulo?: string;
  subtitulo?: string;
  /** Si viene, se dibuja el contador grande sobre el puente (da sensación de avance real). */
  total?: number;
}) {
  return (
    <div className="flex flex-col items-center" role="status" aria-label={titulo || 'Procesando'}>
      <div className="puente" aria-hidden="true">
        <svg className="puente-svg" viewBox="0 0 160 96" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Orilla de origen: el radar */}
          <rect x="0" y="48" width="26" height="30" rx="6" fill="#e2e8f0" />
          <rect x="6" y="42" width="14" height="8" rx="3" fill="#cbd5e1" />

          {/* Orilla de destino: el equipo. Late cuando llega cada licitación. */}
          <g className="puente-destino">
            <rect x="134" y="48" width="26" height="30" rx="6" fill="#c7d2fe" />
            <circle cx="141" cy="40" r="4.5" fill="#6366f1" />
            <circle cx="152" cy="40" r="4.5" fill="#818cf8" />
          </g>

          {/* Torres */}
          <rect x="46" y="12" width="4" height="42" rx="2" fill="#94a3b8" />
          <rect x="110" y="12" width="4" height="42" rx="2" fill="#94a3b8" />

          {/* Cable principal (la curva colgante entre torres y orillas) */}
          <path d="M16 24 C 32 18, 42 14, 48 14 C 74 14, 86 32, 112 14 C 118 14, 128 18, 144 24"
            stroke="#a5b4fc" strokeWidth="2" strokeLinecap="round" />

          {/* Tirantes verticales, animados suave */}
          <g className="puente-cable" stroke="#c7d2fe" strokeWidth="1.4" strokeLinecap="round">
            <line x1="60" y1="17" x2="60" y2="52" />
            <line x1="72" y1="20" x2="72" y2="52" />
            <line x1="88" y1="21" x2="88" y2="52" />
            <line x1="100" y1="18" x2="100" y2="52" />
          </g>

          {/* Tablero por donde cruzan */}
          <rect x="14" y="52" width="132" height="6" rx="3" fill="#cbd5e1" />
          <rect x="14" y="52" width="132" height="2" rx="1" fill="#e2e8f0" />
        </svg>

        {/* Las licitaciones cruzando, escalonadas */}
        <span className="puente-carta" />
        <span className="puente-carta puente-carta-2" />
        <span className="puente-carta puente-carta-3" />
      </div>

      {total != null && (
        <p className="text-[22px] font-bold text-indigo-600 tabular-nums leading-none mt-1">{total}</p>
      )}
      {titulo && <p className="text-[14px] font-semibold text-slate-700 mt-2">{titulo}</p>}
      {subtitulo && <p className="text-[12px] text-slate-400 mt-1 text-center max-w-xs">{subtitulo}</p>}
    </div>
  );
}
