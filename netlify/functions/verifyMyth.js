// Importa el paquete 'node-fetch' si estás en un entorno Node.js que no lo tiene globalmente.
// En Netlify Functions, 'fetch' suele estar disponible de forma global.
const fetch = require('node-fetch');

// Esta es la función principal que se ejecutará cuando se llame al endpoint.
exports.handler = async function(event, context) {
    // Solo permitir peticiones POST
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ message: 'Method Not Allowed' }),
        };
    }

    // Obtener la clave de API desde las variables de entorno del servidor.
    // ¡IMPORTANTE! Debes configurar esta variable en tu proveedor de hosting (Netlify, Vercel, etc.).
    const apiKey = process.env.GEMINI_API_KEY;
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    if (!apiKey) {
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'API key no está configurada en el servidor.' }),
        };
    }

    try {
        const { userQuery } = JSON.parse(event.body);
        if (!userQuery) {
             return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Falta el parámetro userQuery en la petición.' }),
            };
        }
        
        const systemPrompt = `
            Actúa como un experto en divulgación científica y fact-checking.
            Tu misión es analizar la afirmación del usuario y devolver SIEMPRE una respuesta en formato JSON.
            La respuesta DEBE seguir estrictamente este esquema:
            {
              "myth": "La afirmación original del usuario, reformulada si es necesario para mayor claridad.",
              "isTrue": boolean (true si la afirmación es mayormente verdadera, false si es mayormente falsa o engañosa),
              "explanation": "Una explicación concisa, clara y directa (2-4 frases) que justifique el veredicto, explicando el consenso científico actual.",
              "evidenceLevel": "String que debe ser 'Alta', 'Moderada' o 'Baja', indicando el grado de certeza y consenso científico sobre el tema."
            }
            Basa tus respuestas en la evidencia científica más robusta y actual disponible.
            Nunca te desvíes del formato JSON.
        `;
        
        const payload = {
            contents: [{ parts: [{ text: `Afirmación a verificar: "${userQuery}"` }] }],
            tools: [{ "google_search": {} }],
            systemInstruction: {
                parts: [{ text: systemPrompt }]
            },
            generationConfig: {
              responseMimeType: "application/json",
            }
        };

        const apiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!apiResponse.ok) {
            const errorText = await apiResponse.text();
            console.error('Error desde la API de Gemini:', errorText);
            return {
                statusCode: apiResponse.status,
                body: JSON.stringify({ message: `Error al contactar la API de IA. ${errorText}` }),
            };
        }

        const result = await apiResponse.json();
        
        // Extraer y devolver el contenido generado
        const jsonText = result.candidates[0].content.parts[0].text;

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: jsonText
        };

    } catch (error) {
        console.error('Error en la función serverless:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Ha ocurrido un error interno en el servidor.' }),
        };
    }
};
