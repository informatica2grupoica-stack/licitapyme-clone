export async function analyzeWithLLM(text: string, tables: any[]) {
  const prompt = `
    Eres un asistente experto en análisis de bases de licitaciones públicas de Chile.
    Analiza el siguiente texto extraído de un PDF de licitación (puede incluir tablas extraídas).
    Extrae y devuelve únicamente un objeto JSON con esta estructura exacta:
    {
      "criteriosEvaluacion": [
        { "nombre": "Propuesta técnica", "ponderacion": 40, "subcriterios": [...] }
      ],
      "plazos": [ { "etapa": "Cierre ofertas", "plazoDias": 30 } ],
      "requisitos": [ "Registro en mercadopublico.cl", ... ],
      "formulaPuntajeFinal": "0.4 * PT + 0.35 * EX + 0.2 * PE + 0.03 * PF + 0.02 * PI",
      "garantias": [ { "tipo": "Fiel cumplimiento", "porcentaje": 5 } ],
      "multas": [ { "concepto": "Atraso en hitos", "valor": "2 UTM/día" } ]
    }
    Texto del PDF:
    ${text.slice(0, 15000)} // Limita tokens
    ${tables.length ? `Tablas extraídas: ${JSON.stringify(tables)}` : ''}
  `;
  
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    })
  });
  
  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}