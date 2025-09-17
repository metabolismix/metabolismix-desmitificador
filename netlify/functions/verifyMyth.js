// Esta es tu función serverless, que actúa como un backend seguro.
// Ya no necesitamos 'require('node-fetch')' porque usamos la versión nativa.

exports.handler = async function (event) {
  // 1. Medida de seguridad: Solo permitir peticiones POST.
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // 2. Extraer la pregunta del usuario del cuerpo de la petición.
    const { userQuery } = JSON.parse(event.body);

    if (!userQuery) {
      return { statusCode: 400, body: JSON.stringify({ error: 'userQuery is required' }) };
    }

    // 3. Coger tu clave API secreta de las variables de entorno.
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
        throw new Error("La clave API de Gemini no está configurada en el servidor.");
    }
    
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;

    // 4. Mismos 'prompts' y 'schema' que tenías en el frontend.
    const systemPrompt = `Eres un verificador de datos de élite con acceso a la información científica más reciente hasta la fecha. Tu misión es responder como si acabaras de realizar una búsqueda exhaustiva en tiempo real de metaanálisis, revisiones sistemáticas y ensayos clínicos de alta calidad. Sintetiza el consenso científico actual sobre la afirmación proporcionada. Ignora información obsoleta. La rigurosidad y actualidad son críticas. Tu respuesta debe seguir estrictamente el formato JSON especificado.
1.  **Analiza la afirmación:** Evalúa si el mito es verdadero o falso.
2.  **Proporciona una explicación:** Resume la evidencia clave en 2-3 frases cortas. Utiliza un lenguaje claro y accesible para el público general.
3.  **Clasifica la evidencia:** Determina el nivel de evidencia científica que respalda tu conclusión ('Alta', 'Moderada', 'Baja').
    * **Alta:** Respaldado por múltiples estudios de alta calidad (metaanálisis, revisiones sistemáticas, ensayos controlados aleatorizados grandes).
    * **Moderada:** Respaldado por algunos ensayos controlados o estudios observacionales consistentes.
    * **Baja:** Basado en estudios pequeños, contradictorios, anecdóticos o en mecanismos teóricos.`;
    
    const responseSchema = {
        type: "OBJECT",
        properties: {
            "myth": { "type": "STRING", "description": "La afirmación o mito original, reformulada de manera clara." },
            "isTrue": { "type": "BOOLEAN", "description": "True si la afirmación es verdadera, False si es falsa." },
            "explanation": { "type": "STRING", "description": "Explicación breve y clara de la evidencia." },
            "evidenceLevel": { "type": "STRING", "enum": ["Alta", "Moderada", "Baja"], "description": "Nivel de la evidencia científica." }
        },
        required: ["myth", "isTrue", "explanation", "evidenceLevel"]
    };

    const payload = {
      contents: [{ parts: [{ text: userQuery }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      },
    };

    // 5. Llamar a la API de Google desde el backend.
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Google API Error:', errorBody);
      return { statusCode: response.status, body: JSON.stringify({ error: `Google API Error: ${errorBody}` }) };
    }

    const result = await response.json();

    // 6. Devolver la respuesta de Google directamente al frontend.
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };

  } catch (error) {
    console.error('Serverless function error:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

