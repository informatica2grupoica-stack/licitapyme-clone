// worker/index.js
const { Redis } = require('@upstash/redis');
const puppeteer = require('puppeteer-core');
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteerExtra.use(StealthPlugin());
const axios = require('axios');
const cheerio = require('cheerio');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Rutas comunes de Chrome en Windows / Linux / Mac
const CHROME_PATHS = [
  process.env.CHROME_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function findChrome() {
  for (const p of CHROME_PATHS) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

// Configuración desde variables de entorno
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const CHROME_DEBUG_URL = process.env.CHROME_DEBUG_URL || 'http://localhost:9222';
const BROWSERLESS_URL  = process.env.BROWSERLESS_URL;

// ─── Obtener browser ────────────────────────────────────────────────────────
// Prioridad:
//  1. Chrome del usuario con remote debugging (GRATIS, pasa reCAPTCHA Enterprise)
//  2. Browserless.io (cloud browser de pago)
//  3. Chrome local lanzado por Puppeteer (puede ser bloqueado por WAF)
async function obtenerBrowser() {
  // 1. Remote debugging — conectarse al Chrome real del usuario
  try {
    const res = await axios.get(`${CHROME_DEBUG_URL}/json/version`, { timeout: 2000 });
    const wsUrl = (res.data.webSocketDebuggerUrl || '').replace('localhost', '127.0.0.1');
    if (wsUrl) {
      const browser = await puppeteer.connect({ browserWSEndpoint: wsUrl });
      console.log(`🔗 Conectado a Chrome real del usuario (${CHROME_DEBUG_URL})`);
      return { browser, owned: false };
    }
  } catch {}

  // 2. Browserless.io
  if (BROWSERLESS_URL) {
    const browser = await puppeteerExtra.connect({ browserWSEndpoint: BROWSERLESS_URL });
    console.log('🌐 Conectado a Browserless.io');
    return { browser, owned: true };
  }

  // 3. Chrome local lanzado (fallback — puede ser bloqueado por WAF de Mercado Público)
  const chromePath = findChrome();
  if (!chromePath) throw new Error(
    'No se encontró Chrome. Lanza Chrome con:\n  chrome.exe --remote-debugging-port=9222'
  );
  console.log(`🖥️  Lanzando Chrome local: ${chromePath}`);
  console.warn('⚠️  Chrome local puede ser bloqueado por el WAF de Mercado Público.');
  console.warn('    Para mejor resultado: cierra Chrome y lánzalo con --remote-debugging-port=9222');
  const browser = await puppeteerExtra.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled', '--window-size=1920,1080',
    ],
  });
  return { browser, owned: true };
}

// ─── Descarga via browser ────────────────────────────────────────────────────
async function descargarConBrowser(documentoUrl, documentoNombre, tmpDir) {
  const { browser, owned } = await obtenerBrowser();
  let page = null;

  try {
    page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Configurar descarga en tmpDir ANTES de navegar
    const client = await page.createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: tmpDir });

    // 1. Navegar a ViewAttachment — el JS de reCAPTCHA Enterprise se ejecuta automáticamente
    console.log(`🌐 Navegando: ${documentoUrl.slice(0, 80)}...`);
    await page.goto(documentoUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // 2. Esperar a que el reCAPTCHA se complete y redirija a ViewAttachmentLC (hasta 30s)
    console.log('⏳ Esperando reCAPTCHA y redirección a ViewAttachmentLC...');
    try {
      await page.waitForFunction(
        () => window.location.href.includes('ViewAttachmentLC') || window.location.href.includes('403'),
        { timeout: 30000 }
      );
    } catch {
      // Timeout — tomar screenshot de debug
      const ss = path.join(tmpDir, 'debug_browser.png');
      await page.screenshot({ path: ss, fullPage: true });
      console.error(`📸 Screenshot: ${ss}`);
      throw new Error('Timeout esperando redirección de reCAPTCHA');
    }

    const currentUrl = page.url();
    console.log(`📍 URL actual: ${currentUrl.slice(0, 100)}`);

    if (currentUrl.includes('403')) {
      throw new Error('reCAPTCHA score insuficiente — redirigido a 403. Abre mercadopublico.cl en el Chrome de debugging primero.');
    }

    if (!currentUrl.includes('ViewAttachmentLC')) {
      throw new Error(`URL inesperada tras reCAPTCHA: ${currentUrl}`);
    }

    // 3. Estamos en ViewAttachmentLC — parsear lista de documentos
    await page.waitForSelector('table, body', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 1500));

    const lcContent = await page.content();
    fs.writeFileSync(path.join(tmpDir, 'debug_mp_lc.html'), lcContent, 'utf-8');

    const $lc = cheerio.load(lcContent);
    const EXTS = ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.zip', '.rar', '.dwg'];

    // Buscar botón de descarga por nombre de documento
    let downloadClicked = false;

    if (documentoNombre && documentoNombre !== 'Documento adjunto') {
      const rows = await page.$$('table tr');
      for (const row of rows) {
        const rowText = await row.evaluate(el => el.textContent || '');
        if (rowText.includes(documentoNombre)) {
          const btn = await row.$('input[type="image"], a[href], input[type="submit"], button');
          if (btn) {
            await btn.click();
            downloadClicked = true;
            console.log(`📄 Clic en fila: ${documentoNombre}`);
            break;
          }
        }
      }
    }

    // Fallback: primer link/botón de descarga en la página
    if (!downloadClicked) {
      const selectors = [
        'input[type="image"]',
        ...EXTS.map(e => `a[href*="${e}"]`),
        'a[href*="Download"]',
        'input[type="submit"]',
      ];
      for (const sel of selectors) {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click();
          downloadClicked = true;
          console.log(`📄 Descarga vía selector: ${sel}`);
          break;
        }
      }
    }

    if (!downloadClicked) {
      const ss = path.join(tmpDir, 'debug_lc_page.png');
      await page.screenshot({ path: ss, fullPage: true });
      console.error(`📸 Screenshot ViewAttachmentLC: ${ss}`);
      throw new Error('No se encontró botón de descarga en ViewAttachmentLC');
    }

    // 4. Esperar a que el archivo aparezca en tmpDir
    console.log('⏳ Esperando descarga del archivo...');
    const DOWNLOAD_EXTS = ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.zip', '.rar', '.dwg'];
    let downloadedFile = null;
    for (let i = 0; i < 30 && !downloadedFile; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const files = fs.readdirSync(tmpDir).filter(f =>
        !f.endsWith('.crdownload') && !f.endsWith('.tmp') && !f.startsWith('debug_')
      );
      downloadedFile = files.find(f => DOWNLOAD_EXTS.some(e => f.toLowerCase().endsWith(e)));
    }

    if (!downloadedFile) throw new Error('Archivo no descargado en 30 segundos');

    const filePath = path.join(tmpDir, downloadedFile);
    console.log(`✅ Archivo descargado: ${downloadedFile}`);
    return filePath;

  } finally {
    if (page) { try { await page.close(); } catch {} }
    if (browser && owned) { try { await browser.close(); } catch {} }
  }
}

// ─── Job processing ──────────────────────────────────────────────────────────
async function procesarJob(jobId) {
  const jobData = await redis.get(`job:${jobId}`);
  if (!jobData) return;

  const job = typeof jobData === 'string' ? JSON.parse(jobData) : jobData;
  console.log(`\n📥 Job: ${job.documentoNombre} | ${job.licitacionCodigo}`);

  await redis.set(`job:${jobId}`, { ...job, status: 'processing' });

  const tmpDir = os.tmpdir();
  let filePath = null;

  try {
    filePath = await descargarConBrowser(job.documentoUrl, job.documentoNombre, tmpDir);

    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();

    const contentTypeMap = {
      '.pdf': 'application/pdf',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.doc': 'application/msword',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.xls': 'application/vnd.ms-excel',
      '.zip': 'application/zip',
      '.rar': 'application/x-rar-compressed',
    };
    const contentType = contentTypeMap[ext] || 'application/octet-stream';

    // Subir a R2
    const safeNombre = job.documentoNombre.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${job.licitacionCodigo}/${Date.now()}_${safeNombre}${ext}`;
    await r2Client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }));

    const publicUrl = `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev/${key}`;

    // Guardar en BD
    await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/documentos/guardar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        licitacionCodigo: job.licitacionCodigo,
        documentoNombre: job.documentoNombre,
        url: publicUrl,
        size: buffer.length,
      }),
    });

    await redis.set(`job:${jobId}`, { ...job, status: 'completed', resultUrl: publicUrl });
    console.log(`✅ Completado: ${publicUrl}`);

  } catch (error) {
    console.error(`❌ Error en job ${jobId}:`, error.message);
    await redis.set(`job:${jobId}`, { ...job, status: 'failed', error: error.message });
  } finally {
    if (filePath) { try { fs.unlinkSync(filePath); } catch {} }
  }
}

// ─── Main loop ───────────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 Worker iniciado...');
  console.log(`   Chrome debug URL: ${CHROME_DEBUG_URL}`);
  console.log(`   Browserless: ${BROWSERLESS_URL ? 'configurado' : 'no configurado'}`);
  console.log('');
  console.log('💡 Para mejor rendimiento, lanza Chrome con:');
  console.log('   "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222');
  console.log('   Luego visita mercadopublico.cl en ese Chrome y deja la ventana abierta.');
  console.log('');

  while (true) {
    try {
      const jobId = await redis.lpop('queue:downloads');
      if (jobId) {
        await procesarJob(typeof jobId === 'string' ? jobId : String(jobId));
      }
      await new Promise(r => setTimeout(r, 1000));
    } catch (error) {
      console.error('Worker loop error:', error.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

main();
