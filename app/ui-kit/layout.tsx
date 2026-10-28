// Tipografías candidatas, cargadas solo en /ui-kit para compararlas en vivo antes de
// cambiar la del sistema (hoy Roboto, en app/layout.tsx).
import { Inter_Tight, Manrope } from 'next/font/google';

const interTight = Inter_Tight({ variable: '--font-inter-tight', subsets: ['latin'], weight: ['400', '500', '600', '700'] });
const manrope = Manrope({ variable: '--font-manrope', subsets: ['latin'], weight: ['400', '500', '600', '700'] });

export default function UiKitLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${interTight.variable} ${manrope.variable} contents`}>{children}</div>;
}
