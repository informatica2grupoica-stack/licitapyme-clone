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
        // CSP en BLOQUEO (02-nov-2026), a pulir con lo que salga en la consola del navegador. 'unsafe-inline' sigue porque Next inyecta scripts en línea
        // (sin nonce); lo que corta es cargar scripts desde OTRO sitio, que es lo que usaría un XSS para traer su código. Sin default-src/img-src/
        // connect-src/frame-src a propósito: la app carga imágenes, PDF y visores de R2, Mercado Público y Microsoft; eso se afina con la consola abierta.
        // Si algo legítimo queda bloqueado, la consola dice «Refused to load the script … Content-Security-Policy»: agregar ese origen a script-src.
        { key: 'Content-Security-Policy', value: `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'"} blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'` },
      ],
    }];
  },
};

export default nextConfig;
