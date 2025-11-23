// api/chat.js

// Wir nutzen kein Google-Paket, sondern den eingebauten 'fetch'
// Das funktioniert immer, egal was in package.json steht.

export const config = {
    runtime: 'edge', // Macht den Chatbot schneller (optional)
};

export default async function handler(req) {
    // 1. Setup für Edge Runtime (schnellerer Vercel Modus)
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }

    try {
        const body = await req.json();
        const { query, context_content } = body;
        const apiKey = process.env.GEMINI_KEY;

        if (!apiKey) {
            return new Response(JSON.stringify({ error: "Server Error: API Key fehlt." }), { status: 500 });
        }

        // 2. Prompt bauen
        const contextText = context_content ? context_content.substring(0, 30000) : "";
        const isQuiz = query.toLowerCase().includes('quiz');
        
        let systemInstruction = `
        Du bist ein hilfreicher Lern-Assistent.
        Antworte basierend auf diesen Notizen.
        Notizen: ${contextText}
        `;

        if (isQuiz) {
            systemInstruction += `
            AUFGABE: Erstelle ein Multiple-Choice-Quiz basierend auf dem Text.
            FORMAT: Antworte AUSSCHLIESSLICH mit reinem JSON (kein Markdown).
            JSON STRUKTUR: { "question": "...", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "..." }
            `;
        }

        // 3. Der direkte Aufruf an Google (Bypass der Library)
        // Wir nutzen das Modell 'gemini-1.5-flash' über die REST API
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    role: "user",
                    parts: [{ text: systemInstruction + "\n\nUser Frage: " + query }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    // Erzwingt JSON Modus wenn Quiz (verhindert Fehler)
                    responseMimeType: isQuiz ? "application/json" : "text/plain"
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Gemini API Error: ${response.status} - ${errorData}`);
        }

        // 4. Antwort verarbeiten
        const data = await response.json();
        const text = data.candidates[0].content.parts[0].text;

        if (isQuiz) {
            // Da wir JSON erzwungen haben, können wir es direkt parsen
            return new Response(JSON.stringify({ quizJSON: JSON.parse(text) }), { 
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response(JSON.stringify({ answer: text }), { 
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error("CHAT ERROR:", error);
        return new Response(JSON.stringify({ message: "Fehler", details: error.message }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
