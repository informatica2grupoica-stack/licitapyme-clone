// ICA Logo — red de nodos interconectados (inspirado en logo oficial ICA)
export function IcaLogoIcon({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Fondo círculo oscuro */}
      <circle cx="16" cy="16" r="15" fill="#0d1117" />

      {/* Líneas de conexión */}
      <line x1="16" y1="16" x2="9"  y2="10" stroke="#22d3ee" strokeWidth="0.9" strokeOpacity="0.6" />
      <line x1="16" y1="16" x2="23" y2="10" stroke="#22d3ee" strokeWidth="0.9" strokeOpacity="0.6" />
      <line x1="16" y1="16" x2="24" y2="18" stroke="#38bdf8" strokeWidth="0.9" strokeOpacity="0.5" />
      <line x1="16" y1="16" x2="19" y2="24" stroke="#22d3ee" strokeWidth="0.9" strokeOpacity="0.6" />
      <line x1="16" y1="16" x2="10" y2="23" stroke="#38bdf8" strokeWidth="0.9" strokeOpacity="0.5" />
      <line x1="16" y1="16" x2="8"  y2="18" stroke="#22d3ee" strokeWidth="0.9" strokeOpacity="0.6" />
      {/* Conexiones entre nodos periféricos */}
      <line x1="9"  y1="10" x2="23" y2="10" stroke="#22d3ee" strokeWidth="0.7" strokeOpacity="0.3" />
      <line x1="23" y1="10" x2="24" y2="18" stroke="#38bdf8" strokeWidth="0.7" strokeOpacity="0.3" />
      <line x1="8"  y1="18" x2="10" y2="23" stroke="#22d3ee" strokeWidth="0.7" strokeOpacity="0.3" />

      {/* Nodos periféricos */}
      <circle cx="9"  cy="10" r="2"   fill="#22d3ee" fillOpacity="0.85" />
      <circle cx="23" cy="10" r="2"   fill="#22d3ee" fillOpacity="0.85" />
      <circle cx="24" cy="18" r="1.7" fill="#38bdf8" fillOpacity="0.7"  />
      <circle cx="19" cy="24" r="1.7" fill="#22d3ee" fillOpacity="0.75" />
      <circle cx="10" cy="23" r="1.7" fill="#38bdf8" fillOpacity="0.7"  />
      <circle cx="8"  cy="18" r="2"   fill="#22d3ee" fillOpacity="0.85" />

      {/* Nodo central — más brillante */}
      <circle cx="16" cy="16" r="3.2" fill="white" fillOpacity="0.95" />
      <circle cx="16" cy="16" r="1.8" fill="#38bdf8" />
    </svg>
  );
}
