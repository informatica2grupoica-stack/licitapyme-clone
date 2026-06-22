// app/api/licitacion-ia/test/route.ts
// Diagnóstico: verifica DeepSeek (análisis) y Gemini (OCR).
import { NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function probarDeepSeek(apiKey: string) {
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.deepseek.com',
    timeout: 30_000,
    maxRetries: 0,
  });
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

async function probarGeminiVision(apiKey: string) {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Di OK' }] }],
          generationConfig: { temperature: 0 },
        }),
        signal: AbortSignal.timeout(20_000),
      }
    );
    const body = await res.text();
    if (res.ok) {
      const json = JSON.parse(body);
      return { ok: true, respuesta: json.candidates?.[0]?.content?.parts?.[0]?.text?.slice(0, 50) };
    }
    let msg = `HTTP ${res.status}`;
    try { msg = JSON.parse(body)?.error?.message ?? msg; } catch {}
    return { ok: false, status: res.status, error: msg };
  } catch (err: any) {
    return { ok: false, status: 0, error: String(err?.message ?? err).slice(0, 200) };
  }
}

export async function GET() {
  const deepseekKey = process.env.DEEPSEEK_API_KEY ?? '';
  const geminiKey   = process.env.GEMINI_API_KEY   ?? '';

  const resultados: Record<string, any> = {
    deepseek_key: deepseekKey ? `${deepseekKey.slice(0,6)}...${deepseekKey.slice(-4)}` : '❌ NO CONFIGURADA',
    gemini_key:   geminiKey   ? `${geminiKey.slice(0,6)}...${geminiKey.slice(-4)}`     : '❌ NO CONFIGURADA',
  };

  // Test DeepSeek (análisis IA)
  if (deepseekKey) {
    resultados.deepseek_analisis = await probarDeepSeek(deepseekKey);
  } else {
    resultados.deepseek_analisis = { ok: false, error: 'DEEPSEEK_API_KEY no configurada' };
  }

  // Test Gemini (OCR de escaneados)
  if (geminiKey) {
    resultados.gemini_ocr = await probarGeminiVision(geminiKey);
  } else {
    resultados.gemini_ocr = { ok: false, error: 'GEMINI_API_KEY no configurada — los PDFs escaneados no podrán ser leídos' };
  }

  const todoOK = resultados.deepseek_analisis?.ok && resultados.gemini_ocr?.ok;

  return NextResponse.json({
    ok: todoOK,
    arquitectura: {
      analisis_texto: `DeepSeek deepseek-chat → ${resultados.deepseek_analisis?.ok ? '✓ OK' : '✗ ERROR'}`,
      ocr_escaneados: `Gemini 2.5 Flash Vision → ${resultados.gemini_ocr?.ok ? '✓ OK' : '✗ ERROR'}`,
    },
    ...resultados,
  });
}
