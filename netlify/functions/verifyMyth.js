// --- Dependencias ---
// 'node-fetch' para realizar llamadas a la API de Gemini.
const fetch = require('node-fetch');
// 'firebase-admin' para conectar de forma segura con la base de datos Firestore.
const admin = require('firebase-admin');

// --- Constantes de Configuración ---
const USAGE_LIMIT = 3; // Límite de consultas por IP y por día.

// --- Inicialización de Firebase Admin ---
// Esta sección se ejecuta solo una vez cuando la función se "despierta".

// Necesitas configurar esta variable de entorno en tu plataforma de hosting (Netlify/Vercel).
// Es un JSON de credenciales de tu cuenta de servicio de Firebase, codificado en Base64.
const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

if (serviceAccountBase64 && admin.apps.length === 0) {
    try {
        const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('ascii');
        const serviceAccount = JSON.parse(serviceAccountJson);
        
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } catch (e) {
        console.error('Error al inicializar Firebase Admin:', e);
    }
}

const db = admin.firestore();

// --- Función Principal (Handler) ---
// Esta es la función que se ejecuta en cada llamada al endpoint.
exports.handler = async function(event, context) {
    // 1. Validar Petición
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ message: 'Method Not Allowed' }) };
    }

    // 2. Comprobar que Firebase está disponible
    if (!admin.apps.length) {
        console.error('Firebase Admin SDK no inicializado. Revisa las variables de entorno.');
        return { statusCode: 500, body: JSON.stringify({ message: 'Error de configuración del servidor.' }) };
    }

    // 3. Aplicar Límite de Uso (Rate Limiting)
    try {
        // Identificar al usuario por su dirección IP.
        const ip = event.headers['x-nf-client-connection-ip'] || 'unknown';
        const today = new Date().toISOString().slice(0, 10); // Formato: YYYY-MM-DD
        const docRef = db.collection('rateLimits').doc(`${ip}_${today}`);

        const doc = await docRef.get();

        if (doc.exists && doc.data().count >= USAGE_LIMIT) {
            return {
                statusCode: 429, // 429: Too Many Requests
                body: JSON.stringify({ message: `Has alcanzado el límite de ${USAGE_LIMIT} consultas diarias.` }),
            };
        }
        
        // Incrementar el contador en la base de datos.
        // 'set' con 'merge: true' crea el documento si no existe, o lo actualiza si ya existe.
        await docRef.set({
            count: admin.firestore.FieldValue.increment(1)
        }, { merge: true });

    } catch (error) {
        console.error('Error al aplicar el límite de uso con Firestore:', error);
        return { statusCode: 500, body: JSON.stringify({ message: 'Error al procesar la solicitud.' }) };
    }

    // 4. Procesar la Petición a la API de Gemini (si el límite no se ha superado)
    const apiKey = process.env.GEMINI_API_KEY;
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
    
    if (!apiKey) {
        return { statusCode: 500, body: JSON.stringify({ message: 'API key no está configurada en el servidor.' }) };
    }

    try {
        const { userQuery } = JSON.parse(event.body);
        if (!userQuery) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Falta el parámetro userQuery.' }) };
        }
        
        const systemPrompt = `Actúa como un experto en divulgación científica y fact-checking. Tu misión es analizar la afirmación del usuario y devolver SIEMPRE una respuesta en formato JSON. La respuesta DEBE seguir estrictamente este esquema: { "myth": "La afirmación original del usuario, reformulada si es necesario para mayor claridad.", "isTrue": boolean (true si la afirmación es mayormente verdadera, false si es mayormente falsa o engañosa), "explanation": "Una explicación concisa, clara y directa (2-4 frases) que justifique el veredicto, explicando el consenso científico actual.", "evidenceLevel": "String que debe ser 'Alta', 'Moderada' o 'Baja', indicando el grado de certeza y consenso científico sobre el tema." } Basa tus respuestas en la evidencia científica más robusta y actual disponible. Nunca te desvíes del formato JSON.`;
        
        const payload = {
            contents: [{ parts: [{ text: `Afirmación a verificar: "${userQuery}"` }] }],
            tools: [{ "google_search": {} }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: { responseMimeType: "application/json" }
        };

        const apiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!apiResponse.ok) {
            const errorText = await apiResponse.text();
            console.error('Error desde la API de Gemini:', errorText);
            return { statusCode: apiResponse.status, body: JSON.stringify({ message: `Error al contactar la API de IA. ${errorText}` }) };
        }

        const result = await apiResponse.json();
        const jsonText = result.candidates[0].content.parts[0].text;

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: jsonText
        };

    } catch (error) {
        console.error('Error en la función serverless:', error);
        return { statusCode: 500, body: JSON.stringify({ message: 'Ha ocurrido un error interno en el servidor.' }) };
    }
};

