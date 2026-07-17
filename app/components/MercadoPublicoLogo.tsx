// Marca de ATRIBUCIÓN de la fuente de datos (Mercado Público / ChileCompra).
// NO reproduce el emblema oficial: es un wordmark propio con un glifo genérico
// (edificio institucional + estrella), usado solo para indicar el origen de los
// datos en la landing. Monocromable con `tone` para fondos claros u oscuros.

export function MercadoPublicoMark({ size = 34, tone = 'dark' }: { size?: number; tone?: 'dark' | 'light' }) {
  const fg = tone === 'light' ? '#ffffff' : '#0f172a';
  const sub = tone === 'light' ? 'rgba(255,255,255,0.62)' : '#64748b';
  return (
    <span className="inline-flex items-center gap-2.5" aria-label="Datos de Mercado Público — ChileCompra">
      <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id="mp-g" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#2563eb" />
            <stop offset="100%" stopColor="#0ea5e9" />
          </linearGradient>
        </defs>
        <rect x="6" y="6" width="88" height="88" rx="22" fill="url(#mp-g)" />
        {/* Frontón institucional (columnas) */}
        <path d="M50 24 L74 38 H26 Z" fill="#fff" />
        <rect x="30" y="42" width="6" height="26" rx="1.5" fill="#fff" />
        <rect x="42" y="42" width="6" height="26" rx="1.5" fill="#fff" />
        <rect x="52" y="42" width="6" height="26" rx="1.5" fill="#fff" />
        <rect x="64" y="42" width="6" height="26" rx="1.5" fill="#fff" />
        <rect x="26" y="71" width="48" height="6" rx="2" fill="#fff" />
        {/* Estrella (referencia a Chile) */}
        <path d="M50 12.5l1.6 3.5 3.8.4-2.8 2.6.8 3.7L50 20.9l-3.4 1.8.8-3.7-2.8-2.6 3.8-.4z" fill="#fde047" />
      </svg>
      <span className="leading-none">
        <span className="block font-bold tracking-tight" style={{ fontSize: size * 0.42, color: fg }}>Mercado Público</span>
        <span className="block font-medium tracking-wide uppercase" style={{ fontSize: size * 0.235, color: sub, letterSpacing: '0.08em' }}>ChileCompra</span>
      </span>
    </span>
  );
}
