import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
// Estilos de Mantine DESPUÉS de Tailwind: al ir sin capa, ganan sobre el preflight de
// Tailwind (que va en @layer base) y los componentes de Mantine se ven correctos.
import '@mantine/core/styles.css';
import '@mantine/charts/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/dates/styles.css';
import { ColorSchemeScript, MantineProvider, mantineHtmlProps } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { theme } from '@/app/lib/mantine-theme';
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
      {...mantineHtmlProps}
    >
      <head>
        <ColorSchemeScript defaultColorScheme="light" />
      </head>
      <body className="min-h-full flex flex-col bg-[#f5f5f7] text-zinc-900">
        <MantineProvider theme={theme} defaultColorScheme="light">
          <Notifications position="top-right" zIndex={2000} />
          <SessionProvider>
            <ToastProvider>
              {children}
            </ToastProvider>
          </SessionProvider>
        </MantineProvider>
      </body>
    </html>
  );
}
