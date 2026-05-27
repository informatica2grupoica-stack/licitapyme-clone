import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { SessionProvider } from '@/app/lib/session-context';
import { ToastProvider }   from '@/app/components/ui/toast';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'ICA Licitaciones — Portal de Compras Públicas Chile',
  description:
    'Plataforma profesional para buscar, analizar y gestionar licitaciones de Mercado Público (ChileCompra). Accede en tiempo real a oportunidades de compras públicas.',
  keywords: 'licitaciones, mercado público, chilecompra, licitaciones chile, compras públicas',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#f5f5f7] text-zinc-900">
        <SessionProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
