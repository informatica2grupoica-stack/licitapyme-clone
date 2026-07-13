// Logo oficial LICITANK — rombo redondeado teal con diamante blanco y base con degradado.
// Reconstruido como SVG (vectorial, escala sin pérdida). Si algún día quieres el PNG exacto,
// déjalo en /public y cámbialo aquí.

export function LicitankIcon({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="LICITANK">
      <defs>
        <linearGradient id="lk-body" x1="20" y1="18" x2="80" y2="82" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4BE3C0" />
          <stop offset="100%" stopColor="#2FC7A6" />
        </linearGradient>
        {/* Degradado de la "base" (mitad inferior) — un poco más oscuro, da profundidad. */}
        <linearGradient id="lk-base" x1="50" y1="50" x2="50" y2="92" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1FA98C" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#1FA98C" stopOpacity="0" />
        </linearGradient>
        {/* Recorte al rombo redondeado, para contener la base. */}
        <clipPath id="lk-clip">
          <rect x="18" y="18" width="64" height="64" rx="20" transform="rotate(45 50 50)" />
        </clipPath>
      </defs>

      {/* Cuerpo: rombo (cuadrado redondeado rotado 45°). */}
      <rect x="18" y="18" width="64" height="64" rx="20" transform="rotate(45 50 50)" fill="url(#lk-body)" />

      {/* Base inferior con degradado (semicírculo dentro del rombo). */}
      <g clipPath="url(#lk-clip)">
        <circle cx="50" cy="60" r="26" fill="url(#lk-base)" />
      </g>

      {/* Diamante blanco central. */}
      <rect x="36" y="30" width="28" height="28" rx="3" transform="rotate(45 50 44)" fill="#ffffff" />
    </svg>
  );
}

// Marca completa: icono + palabra "LICITANK". Útil para login/navbar.
export function LicitankLogo({ size = 36, dark = false }: { size?: number; dark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LicitankIcon size={size} />
      <span className={`font-black tracking-tight ${dark ? 'text-white' : 'text-slate-800'}`} style={{ fontSize: size * 0.5 }}>
        LICITANK
      </span>
    </span>
  );
}
