// app/lib/chat-ia.ts
// Motor de IA de TODOS los chatbots (burbuja, chat por menú, chat general, chat de documentos y por licitación).
//
// Decisión del dueño (2026-11-17): los chatbots corren en Kimi, en su versión más económica y estable (`kimi_rapido` = K2.6 sin razonar,
// ver PROVEEDORES_TEXTO en gemini.ts); el respaldo es GLM (glm-4.7 y el resto de la escalera GLM de la misma cuenta Z.AI). No pasa por
// DeepSeek ni Gemini. Kimi solo acepta una temperatura fija y no admite response_format: gemini.ts (cuerpoPara) ya lo resuelve.
// El gasto queda atribuido al módulo «consultas» (ia_uso), con el modelo que de verdad respondió.
import { crearChatIA as crearChatIABase } from './gemini';
import { conModuloIA } from '@/app/lib/ia-uso';

const crearChatIA = conModuloIA('consultas', crearChatIABase);

/** Modelo GLM de respaldo (el mismo que el chat ya usaba: glm-4.7 confunde menos datos que flashx). */
const GLM_RESPALDO = process.env.CHAT_MODELO_RESPALDO || 'glm-4.7';
/** Etiqueta del motor principal, para el historial cuando no se conoce el modelo exacto que respondió. */
export const MOTOR_CHAT = process.env.KIMI_MODELO_RAPIDO || 'kimi-k2.6';

/** Chat completion para un chatbot: Kimi económico primero; si falla (error, saldo, timeout), GLM. */
export async function crearChatIAChatbot(params: unknown, opts: { timeoutMs?: number } = {}): Promise<any> {
  try {
    return await crearChatIA(params, { proveedorPreferido: 'kimi_rapido', sinRespaldo: true, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) });
  } catch (e) {
    console.warn('[chat-ia] Kimi falló, respaldo GLM:', e instanceof Error ? e.message.slice(0, 120) : e);
    return crearChatIA(params, { modeloPreferido: GLM_RESPALDO, soloGlm: true, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) });
  }
}
