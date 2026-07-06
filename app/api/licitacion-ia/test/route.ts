// app/api/licitacion-ia/test/route.ts
// Diagnóstico: verifica Z.AI (GLM texto = análisis/viabilidad) y GLM-OCR (lectura de
// documentos), más DeepSeek como respaldo. Gemini está RETIRADO (sin key = no se usa).
import { NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GLM_MODEL = process.env.GLM_TEXT_MODEL || 'glm-4.6';

// Prueba el modelo de TEXTO de Z.AI (el que hace viabilidad/clasificación/chat).
async function probarGlmTexto(apiKey: string) {
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.z.ai/api/paas/v4',
    timeout: 30_000,
    maxRetries: 0,
  });
  try {
    const r = await client.chat.completions.create({
      model: GLM_MODEL,
      messages: [{ role: 'user', content: 'Responde solo: {"ok":true}' }],
      temperature: 0,
      stream: false,
      // GLM: sin thinking para respuesta inmediata (igual que en producción).
      thinking: { type: 'disabled' },
    } as any);
    return { ok: true, modelo: GLM_MODEL, respuesta: r.choices[0]?.message?.content?.slice(0, 80) };
  } catch (err: any) {
    return { ok: false, modelo: GLM_MODEL, error: String(err?.message ?? err).slice(0, 200), status: err?.status ?? 0 };
  }
}

// Prueba que el endpoint de GLM-OCR responda con la key (una llamada inválida a propósito:
// si contesta un error de VALIDACIÓN es que la key sirve; 401 = key mala; 1113 = sin saldo).
async function probarGlmOcr(apiKey: string) {
  try {
    const res = await fetch('https://api.z.ai/api/paas/v4/layout_parsing', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'glm-ocr', file: 'https://example.com/__ping__.pdf' }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.text();
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: `Key rechazada (${res.status}): ${body.slice(0, 150)}` };
    }
    if (/1113|insufficient balance|recharge/i.test(body)) {
      return { ok: false, error: 'Z.AI SIN SALDO (code 1113) — recargar en https://z.ai' };
    }
    // Cualquier otra respuesta (incluido error por URL inválida) prueba que key+endpoint funcionan.
    return { ok: true, nota: `endpoint activo (HTTP ${res.status})` };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err).slice(0, 200) };
  }
}

// DeepSeek: RESPALDO automático del texto si GLM falla.
async function probarDeepSeek(apiKey: string) {
  const client = new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com', timeout: 30_000, maxRetries: 0 });
  try {
    const r = await client.chat.completions.create({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'Responde solo: {"ok":true}' }],
      temperature: 0,
      stream: false,
    });
    return { ok: true, respuesta: r.choices[0]?.message?.content?.slice(0, 80) };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err).slice(0, 200), status: err?.status ?? 0 };
  }
}

export async function GET() {
  const zaiKey      = process.env.ZAI_API_KEY      ?? '';
  const deepseekKey = process.env.DEEPSEEK_API_KEY ?? '';
  const geminiOn    = process.env.GEMINI_HABILITADO === '1' && Boolean(process.env.GEMINI_API_KEY);

  const resultados: Record<string, any> = {
    zai_key:      zaiKey      ? `${zaiKey.slice(0, 6)}...${zaiKey.slice(-4)}`           : '❌ NO CONFIGURADA',
    deepseek_key: deepseekKey ? `${deepseekKey.slice(0, 6)}...${deepseekKey.slice(-4)}` : '❌ NO CONFIGURADA (sin respaldo)',
    gemini:       geminiOn    ? '⚠️ REACTIVADO (GEMINI_HABILITADO=1 + key)'              : '✓ retirado (no se usa ni como respaldo)',
  };

  if (zaiKey) {
    const [texto, ocr] = await Promise.all([probarGlmTexto(zaiKey), probarGlmOcr(zaiKey)]);
    resultados.glm_texto = texto;
    resultados.glm_ocr = ocr;
  } else {
    resultados.glm_texto = { ok: false, error: 'ZAI_API_KEY no configurada' };
    resultados.glm_ocr   = { ok: false, error: 'ZAI_API_KEY no configurada — los PDFs escaneados no podrán ser leídos' };
  }

  resultados.deepseek_respaldo = deepseekKey
    ? await probarDeepSeek(deepseekKey)
    : { ok: false, error: 'DEEPSEEK_API_KEY no configurada' };

  const todoOK = resultados.glm_texto?.ok && resultados.glm_ocr?.ok;

  return NextResponse.json({
    ok: todoOK,
    arquitectura: {
      analisis_texto: `Z.AI ${GLM_MODEL} (viabilidad/clasificación/chat) → ${resultados.glm_texto?.ok ? '✓ OK' : '✗ ERROR'}`,
      ocr_documentos: `Z.AI glm-ocr (lectura de documentos) → ${resultados.glm_ocr?.ok ? '✓ OK' : '✗ ERROR'}`,
      respaldo_texto: `DeepSeek deepseek-chat → ${resultados.deepseek_respaldo?.ok ? '✓ OK' : '✗ ERROR'}`,
      ultimo_respaldo_ocr: 'Tesseract local (siempre disponible)',
    },
    ...resultados,
  });
}
