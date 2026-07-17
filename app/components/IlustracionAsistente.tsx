// Ilustración vectorial propia (estilo flat, colores de marca): una asistente
// trabajando en su notebook con la plataforma abierta, burbujas de chat y una
// tarjeta de resultado flotando. Se usa en la landing y en el login.
// SVG dibujado a mano — escala sin pérdida y respeta prefers-reduced-motion.

export function IlustracionAsistente({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 500 350" fill="none" xmlns="http://www.w3.org/2000/svg"
      className={className} role="img" aria-label="Asistente trabajando en un notebook con LICITANK">
      <style>{`
        .lkia-f1{ animation:lkia-bob 5s ease-in-out infinite; }
        .lkia-f2{ animation:lkia-bob 6.2s ease-in-out infinite .9s; }
        @keyframes lkia-bob{ 0%,100%{ transform:translateY(0); } 50%{ transform:translateY(-8px); } }
        @media (prefers-reduced-motion: reduce){ .lkia-f1,.lkia-f2{ animation:none; } }
      `}</style>

      {/* Fondo suave */}
      <circle cx="252" cy="180" r="148" fill="#2FC7A6" opacity="0.08" />
      <circle cx="398" cy="98" r="38" fill="#2FC7A6" opacity="0.07" />
      <ellipse cx="250" cy="334" rx="175" ry="8" fill="#18181b" opacity="0.05" />

      {/* Escritorio */}
      <rect x="92" y="238" width="318" height="9" rx="4.5" fill="#e4e4e7" />
      <rect x="112" y="247" width="8" height="84" rx="3" fill="#d4d4d8" />
      <rect x="382" y="247" width="8" height="84" rx="3" fill="#d4d4d8" />

      {/* Silla */}
      <rect x="104" y="196" width="8" height="78" rx="4" fill="#d4d4d8" />
      <rect x="108" y="266" width="60" height="9" rx="4.5" fill="#d4d4d8" />
      <rect x="118" y="275" width="7" height="56" rx="3" fill="#d4d4d8" />
      <rect x="152" y="275" width="7" height="56" rx="3" fill="#d4d4d8" />

      {/* Persona (asistente con moño, polera teal) */}
      {/* piernas */}
      <rect x="132" y="256" width="50" height="13" rx="6.5" fill="#3f3f46" />
      <rect x="168" y="260" width="12" height="54" rx="6" fill="#3f3f46" />
      <rect x="164" y="308" width="28" height="10" rx="5" fill="#18181b" />
      {/* torso */}
      <path d="M133 262 L137 210 Q138 200 148 200 L168 200 Q178 200 179 210 L183 262 Z" fill="#2FC7A6" />
      {/* cuello + cabeza */}
      <rect x="152" y="188" width="12" height="14" rx="5" fill="#eab690" />
      <circle cx="158" cy="174" r="16" fill="#27272a" />
      <circle cx="172" cy="161" r="6" fill="#27272a" />
      <circle cx="159" cy="179" r="13" fill="#eab690" />
      {/* brazo hacia el teclado */}
      <path d="M174 214 C196 224 216 230 234 233" stroke="#1fae90" strokeWidth="10" strokeLinecap="round" />
      <circle cx="236" cy="233" r="5.5" fill="#eab690" />

      {/* Notebook con la plataforma abierta */}
      <rect x="224" y="166" width="104" height="70" rx="6" fill="#18181b" />
      <rect x="230" y="172" width="92" height="58" rx="3" fill="#fafafa" />
      {/* mini interfaz: barra de marca, líneas y curva del radar */}
      <rect x="236" y="178" width="30" height="5" rx="2.5" fill="#2FC7A6" />
      <rect x="236" y="188" width="60" height="4" rx="2" fill="#e4e4e7" />
      <rect x="236" y="196" width="46" height="4" rx="2" fill="#e4e4e7" />
      <polyline points="236,222 250,213 262,217 276,205 291,210 306,199" stroke="#2FC7A6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="306" cy="199" r="3" fill="#0e8f72" />
      {/* base del notebook */}
      <path d="M216 236 H336 L330 244 H222 Z" fill="#52525b" />

      {/* Taza */}
      <rect x="186" y="224" width="15" height="14" rx="2.5" fill="#ffffff" stroke="#d4d4d8" strokeWidth="1.5" />
      <path d="M201 227 q7 2 0 8" stroke="#d4d4d8" strokeWidth="1.5" fill="none" />

      {/* Planta */}
      <path d="M366 238 H398 L394 264 H370 Z" fill="#d4d4d8" />
      <path d="M382 238 C382 216 374 206 364 200" stroke="#0e8f72" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M382 238 C385 212 393 204 404 200" stroke="#0e8f72" strokeWidth="3" strokeLinecap="round" fill="none" />
      <ellipse cx="362" cy="197" rx="8" ry="12" transform="rotate(-28 362 197)" fill="#2FC7A6" />
      <ellipse cx="406" cy="197" rx="8" ry="12" transform="rotate(24 406 197)" fill="#2FC7A6" />
      <ellipse cx="383" cy="188" rx="7" ry="12" fill="#1fae90" />

      {/* Burbuja de chat flotante (el asistente "escribiendo") */}
      <g className="lkia-f1">
        <rect x="298" y="92" width="88" height="36" rx="11" fill="#ffffff" stroke="#e4e4e7" strokeWidth="1.5" />
        <path d="M312 128 l-6 11 15 -5 Z" fill="#ffffff" stroke="#e4e4e7" strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx="322" cy="110" r="4.5" fill="#2FC7A6" />
        <circle cx="341" cy="110" r="4.5" fill="#0e8f72" />
        <circle cx="360" cy="110" r="4.5" fill="#2FC7A6" />
      </g>

      {/* Tarjeta de resultado flotante */}
      <g className="lkia-f2">
        <rect x="104" y="92" width="102" height="44" rx="11" fill="#ffffff" stroke="#e4e4e7" strokeWidth="1.5" />
        <circle cx="122" cy="114" r="9" fill="#2FC7A6" opacity="0.18" />
        <path d="M118 114 l3 3 6 -6" stroke="#0e8f72" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <rect x="138" y="104" width="54" height="5" rx="2.5" fill="#e4e4e7" />
        <rect x="138" y="114" width="38" height="5" rx="2.5" fill="#e4e4e7" />
        <rect x="138" y="124" width="54" height="4" rx="2" fill="#f4f4f5" />
        <rect x="138" y="124" width="36" height="4" rx="2" fill="#2FC7A6" />
      </g>
    </svg>
  );
}
