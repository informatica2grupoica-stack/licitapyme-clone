import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Paquetes server-only que no deben empacarse con Turbopack/Webpack
  serverExternalPackages: [
    'pdf-parse',
    'mupdf',
    'tesseract.js',
    'mammoth',
    'puppeteer-core',
    'puppeteer-extra',
    'puppeteer-extra-plugin-stealth',
    '@sparticuz/chromium',
  ],

  // Turbopack es el bundler por defecto en Next.js 16
  // Config vacía para indicar que lo usamos intencionalmente
  turbopack: {},

  // Con proxy.ts, Next copia en memoria el cuerpo de cada petición y por defecto lo recorta a 10 MB (el archivo llegaba cortado).
  // El tope real de un archivo es 20 MB (app/lib/subidas.ts); el resto es holgura para los demás campos del formulario.
  experimental: { proxyClientMaxBodySize: '25mb' },

  // Cabeceras de seguridad básicas (sin CSP: la app usa estilos/scripts en línea de Mantine).
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        // CSP parcial a propósito: sin script-src/style-src porque Next y Mantine usan código y estilos en línea. Estas directivas
        // no los tocan y cierran lo demás: plugins, <base> falso, formularios hacia otro sitio y que otro sitio nos enmarque.
        { key: 'Content-Security-Policy', value: "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'" },
        // Política con script-src en modo SOLO AVISO: no bloquea nada, pero el navegador anota en la consola cada violación («Content-Security-Policy-Report-Only»).
        // Se recorre la app con la consola abierta y, si no sale ninguna, se pasa a Content-Security-Policy. 'unsafe-inline' sigue porque Next
        // inyecta scripts en línea (sin nonce); lo que corta es cargar scripts desde OTRO sitio, que es lo que usaría un XSS para traer su código.
        { key: 'Content-Security-Policy-Report-Only', value: `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'"} blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'` },
      ],
    }];
  },
};

export default nextConfig;
