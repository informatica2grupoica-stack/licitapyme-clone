import type { Metadata } from 'next';
import { Roboto, Geist_Mono } from 'next/font/google';
import './globals.css';
import { SessionProvider } from '@/app/lib/session-context';
import { ToastProvider }   from '@/app/components/ui/toast';
import { ConfirmProvider } from '@/app/components/ui/confirm';
import { ThemeProvider }   from '@/app/lib/theme-context';
import { CosteoFlotanteProvider } from '@/app/components/CosteoFlotanteContext';
import { CosteoFlotanteHost }     from '@/app/components/CosteoFlotanteHost';
import { ReportarErrorBoton }     from '@/app/components/ReportarErrorBoton';

// Aplica la clase `dark` a <html> ANTES del primer paint, leyendo directo de localStorage.
// Sin esto, ThemeProvider la aplicaría recién en un efecto de React y se vería un flash
// claro→oscuro en cada carga cuando el usuario tiene el tema oscuro elegido.
const SCRIPT_TEMA_INICIAL = `
try {
  var t = localStorage.getItem('tema-color');
  if (t === 'oscuro') document.documentElement.classList.add('dark');
} catch (e) {}
`;

const roboto = Roboto({ variable: '--font-roboto', subsets: ['latin'], weight: ['400', '500', '700'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'LICITANK — Portal de Compras Públicas Chile',
  description:
    'Plataforma profesional para buscar, analizar y gestionar licitaciones de Mercado Público (ChileCompra). Accede en tiempo real a oportunidades de compras públicas.',
  keywords: 'licitaciones, mercado público, chilecompra, licitaciones chile, compras públicas',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${roboto.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA_INICIAL }} />
      </head>
      <body className="min-h-full flex flex-col bg-[#f5f5f7] text-zinc-900 dark:bg-[#0b0d12] dark:text-slate-100 transition-colors">
        <ThemeProvider>
          <SessionProvider>
            <ToastProvider>
              <ConfirmProvider>
                <CosteoFlotanteProvider>
                  {children}
                  <CosteoFlotanteHost />
                  <ReportarErrorBoton />
                </CosteoFlotanteProvider>
              </ConfirmProvider>
            </ToastProvider>
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
