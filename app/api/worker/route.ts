// src/app/api/worker/descargar-documento/route.ts
import { NextRequest, NextResponse } from 'next/server';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import axios from 'axios';
import os from 'os';
import path from 'path';
import { subirDocumentoR2 } from '@/app/lib/r2';
import pool from '@/app/lib/db';

const CAPSOLVER_API_KEY = process.env.CAPSOLVER_API_KEY!;

// Resolver captcha con CapSolver
async function resolverCaptcha(websiteUrl: string, siteKey: string, pageAction: string = 'submit'): Promise<string> {
  console.log(`🔐 Resolviendo captcha con CapSolver para ${websiteUrl}`);
  
  const createTask = await axios.post('https://api.capsolver.com/createTask', {
    clientKey: CAPSOLVER_API_KEY,
    task: {
      type: 'ReCaptchaV2TaskProxyLess',
      websiteURL: websiteUrl,
      websiteKey: siteKey,
      pageAction: pageAction,
    }
  });

  if (createTask.data.errorId) {
    throw new Error(`Error CapSolver: ${createTask.data.errorDescription}`);
  }

  const taskId = createTask.data.taskId;

  // Polling para resultado
  for (let i = 0; i < 30; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const getResult = await axios.post('https://api.capsolver.com/getTaskResult', {
      clientKey: CAPSOLVER_API_KEY,
      taskId: taskId
    });
    
    if (getResult.data.status === 'ready') {
      return getResult.data.solution.gRecaptchaResponse;
    }
    
    if (getResult.data.errorId) {
      throw new Error(`Error: ${getResult.data.errorDescription}`);
    }
  }
  
  throw new Error('Timeout resolviendo captcha');
}

export async function POST(request: NextRequest) {
  let browser: any = null;
  
  try {
    const { licitacionCodigo, documentoUrl, documentoNombre } = await request.json();

    if (!licitacionCodigo || !documentoUrl) {
      return NextResponse.json({ error: 'Faltan parámetros' }, { status: 400 });
    }

    console.log(`📄 Descargando: ${documentoNombre} [${licitacionCodigo}]`);

    // 1. Configurar Chromium para Vercel
    const isDev = process.env.NODE_ENV === 'development';

    let executablePath: string | undefined;
    let args: string[] = chromium.args;

    if (isDev) {
      executablePath = process.env.CHROME_EXECUTABLE_PATH;
    } else {
      executablePath = await chromium.executablePath();
    }

    browser = await puppeteer.launch({
      args,
      executablePath,
      headless: true,
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // 3. Navegar a la página
    await page.goto(documentoUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));

    // 4. Detectar captcha (varias formas)
    let siteKey: string | null = null;
    
    // Forma 1: .g-recaptcha
    siteKey = await page.evaluate(() => {
      const element = document.querySelector('.g-recaptcha');
      return element?.getAttribute('data-sitekey') || null;
    });
    
    // Forma 2: recaptcha visible
    if (!siteKey) {
      siteKey = await page.evaluate(() => {
        const element = document.querySelector('[data-sitekey]');
        return element?.getAttribute('data-sitekey') || null;
      });
    }

    if (siteKey) {
      console.log('🔐 Captcha detectado, resolviendo...');
      const token = await resolverCaptcha(documentoUrl, siteKey);
      
      await page.evaluate((tokenValue: string) => {
        const textarea = document.getElementById('g-recaptcha-response');
        if (textarea) {
          (textarea as HTMLTextAreaElement).innerHTML = tokenValue;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
        
        // También intentar con cualquier textarea de recaptcha
        const anyRecaptcha = document.querySelector('textarea[name="g-recaptcha-response"]');
        if (anyRecaptcha) {
          (anyRecaptcha as HTMLTextAreaElement).value = tokenValue;
          anyRecaptcha.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, token);
      
      await new Promise(r => setTimeout(r, 2000));
    } else {
      console.log('📄 No se detectó captcha en esta página');
    }

    // 5. Buscar y hacer clic en el botón de descarga (múltiples opciones)
    let downloadButton = null;
    
    // Opción 1: Botón de imagen ver.gif
    downloadButton = await page.$('input[type="image"][src*="ver.gif"]');
    
    // Opción 2: Botón de imagen ver.png
    if (!downloadButton) {
      downloadButton = await page.$('input[type="image"][src*="ver.png"]');
    }
    
    // Opción 3: Enlace con Download
    if (!downloadButton) {
      downloadButton = await page.$('a[href*="Download"]');
    }
    
    // Opción 4: Botón submit de descarga
    if (!downloadButton) {
      downloadButton = await page.$('input[type="submit"][value*="Descargar"]');
    }
    
    // Opción 5: Esperar y buscar cualquier botón de descarga
    if (!downloadButton) {
      downloadButton = await page.waitForSelector('input[type="image"][src*="ver"], a[href*="download"]', { timeout: 5000 }).catch(() => null);
    }
    
    if (!downloadButton) {
      throw new Error('No se encontró el botón de descarga en la página');
    }

    console.log('🔘 Botón de descarga encontrado, haciendo clic...');

    const tmpDir = os.tmpdir();
    const client = await page.createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: tmpDir,
    });

    await downloadButton.click();
    console.log('⏳ Esperando descarga (hasta 30 segundos)...');
    await new Promise(r => setTimeout(r, 15000));

    // 6. Leer archivo descargado
    const fs = require('fs');

    let pdfFile: string | undefined;
    for (let intentos = 0; intentos < 15 && !pdfFile; intentos++) {
      await new Promise(r => setTimeout(r, 1000));
      const files = fs.readdirSync(tmpDir) as string[];
      pdfFile = files.find(f => f.endsWith('.pdf') || f.endsWith('.docx') || f.endsWith('.zip') || f.endsWith('.rar'));
    }

    if (!pdfFile) {
      throw new Error('No se encontró el archivo descargado después de 15 segundos');
    }

    const filePath = path.join(tmpDir, pdfFile);
    const fileBuffer = fs.readFileSync(filePath);
    console.log(`📁 Archivo descargado: ${pdfFile} (${fileBuffer.length} bytes)`);
    
    // 7. Subir a Cloudflare R2
    const extension = pdfFile.split('.').pop()?.toLowerCase() || 'pdf';
    let contentType = 'application/octet-stream';
    
    if (extension === 'pdf') contentType = 'application/pdf';
    else if (extension === 'docx') contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    else if (extension === 'zip') contentType = 'application/zip';
    else if (extension === 'rar') contentType = 'application/x-rar-compressed';
    
    const publicUrl = await subirDocumentoR2(
      licitacionCodigo,
      documentoNombre || pdfFile,
      fileBuffer,
      contentType
    );

    console.log(`✅ Subido a R2: ${publicUrl}`);

    // 8. Guardar referencia en BD
    await pool.query(
      `INSERT INTO documentos_cache (licitacion_codigo, documento_nombre, documento_url_local, size_bytes) 
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE documento_url_local = VALUES(documento_url_local), size_bytes = VALUES(size_bytes)`,
      [licitacionCodigo, documentoNombre || pdfFile, publicUrl, fileBuffer.length]
    );

    try {
      fs.unlinkSync(filePath);
    } catch (unlinkError) {
      console.warn('No se pudo eliminar archivo temporal:', unlinkError);
    }
    
    await browser.close();

    return NextResponse.json({
      success: true,
      url: publicUrl,
      nombre: documentoNombre || pdfFile,
      size: fileBuffer.length
    });

  } catch (error) {
    console.error('❌ Error en worker:', error);
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.warn('Error cerrando navegador:', closeError);
      }
    }
    return NextResponse.json({ 
      error: 'Error al descargar el documento',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}