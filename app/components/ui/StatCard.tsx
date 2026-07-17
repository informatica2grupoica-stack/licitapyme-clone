'use client';

// Tarjeta KPI ÚNICA de la app — todos los dashboards (dashboard, análisis, postuladas,
// adjudicadas, analítica) usan ESTA, para que se sientan una sola aplicación.
// Valor numérico → contador animado (respeta prefers-reduced-motion vía useContador).
//
// Uso:
//   <StatCard icon={<Trophy size={22} />} label="Ganadas" value={12} color="#059669"
//     sub="57% de efectividad" href="/adjudicadas" />
//   <StatCard label="Monto ganado" value={409010203} formato={fmtCLP} color="teal" />
import Link from 'next/link';
import { useContador } from '@/app/lib/use-contador';

// Paleta con nombre (compat con los dashboards que usaban color="indigo" etc.).
const PALETA: Record<string, string> = {
  indigo: '#4f46e5', violet: '#7c3aed', teal: '#0d9488', emerald: '#059669',
  orange: '#ea580c', amber: '#d97706', rose: '#e11d48', red: '#dc2626',
  sky: '#0284c7', blue: '#2563eb', slate: '#475569', cyan: '#0891b2',
};
const hexDe = (c?: string) => !c ? PALETA.indigo : (c.startsWith('#') ? c : (PALETA[c] || PALETA.indigo));

function Valor({ value, formato }: { value: string | number; formato?: (n: number) => string }) {
  const esNumero = typeof value === 'number' && Number.isFinite(value);
  const animado = useContador(esNumero ? (value as number) : 0);
  if (!esNumero) return <>{value}</>;
  const n = Math.round(animado);
  return <>{formato ? formato(n) : new Intl.NumberFormat('es-CL').format(n)}</>;
}

// Texto FINAL del valor (post-formato): de él depende el tamaño adaptativo.
function textoFinal(value: string | number, formato?: (n: number) => string): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return formato ? formato(value) : new Intl.NumberFormat('es-CL').format(value);
  }
  return String(value);
}

export function StatCard({ icon, label, value, sub, color, href, hint, formato }: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  color?: string;            // hex ('#059669') o nombre de la paleta ('teal')
  href?: string;             // opcional: la tarjeta entera navega
  hint?: string;             // tooltip nativo
  formato?: (n: number) => string; // formateador para valores numéricos (p.ej. CLP)
}) {
  const hex = hexDe(color);
  // Tamaño ADAPTATIVO por largo del valor final: un monto de 14 chars ("$9.233.366.323")
  // a 26px desborda la tarjeta; achicar es mejor que truncar (patrón de AnaliticaGestion).
  const largo = textoFinal(value, formato).length;
  const clsValor = largo > 12 ? 'text-[17px]' : largo > 9 ? 'text-[21px]' : 'text-[24px] sm:text-[26px]';
  const cuerpo = (
    <div title={hint}
      className={`bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 transition-all duration-200 h-full
        ${href ? 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer' : 'hover:shadow-md'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide mb-1 truncate">{label}</p>
          <p className={`${clsValor} font-black leading-none tabular-nums text-slate-900 break-words`}>
            <Valor value={value} formato={formato} />
          </p>
          {sub && <p className="text-xs text-slate-400 mt-1 truncate">{sub}</p>}
        </div>
        <div className="w-[42px] h-[42px] rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: hex + '18', color: hex }}>{icon}</div>
      </div>
    </div>
  );
  return href ? <Link href={href} className="block h-full">{cuerpo}</Link> : cuerpo;
}
