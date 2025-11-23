// api/chat.js
export const config = {
    runtime: 'edge', // Schneller & kein Node.js Müll
};

export default async function handler(req) {
    if (req.method !== 'POST') return new Response("Method not allowed", { status: 405 });

    try {
        const { query, context_content } = await req.json();
        const apiKey = process.env.GEMINI_KEY;

        if (!apiKey) return new Response(JSON.stringify({ message: "API Key fehlt in Vercel." }), { status: 500 });

        // 1. Prompt bauen
        const contextText = context_content ? context_content.substring(0, 40000) : "";
        
        const systemPrompt = `
        Du bist ein hilfreicher Lern-Assistent.
        Antworte basierend auf diesen Notizen des Nutzers.
        
        NOTIZEN:
        ${contextText}
        `;

        const isQuiz = query.toLowerCase().includes('quiz');

        let fullPrompt = systemPrompt + "\n\nUser: " + query;

        if (isQuiz) {
            fullPrompt += `\n\nAUFGABE: Erstelle ein Multiple-Choice-Quiz.
            Antworte NUR mit reinem JSON in diesem Format:
            { "question": "...", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "..." }`;
        }

        // 2. DIREKTER HTTP REQUEST (Keine Library!)
        // Wir nutzen v1beta, da ist gemini-1.5-flash zu 100% verfügbar.
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    role: "user",
                    parts: [{ text: fullPrompt }]
                }],
                generationConfig: {
                    // JSON Mode erzwingen bei Quiz
                    responseMimeType: isQuiz ? "application/json" : "text/plain"
                }
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Google API Error: ${response.status} ${errText}`);
        }

        const data = await response.json();
        const text = data.candidates[0].content.parts[0].text;

        // 3. Antwort zurücksenden
        if (isQuiz) {
            return new Response(JSON.stringify({ quizJSON: JSON.parse(text) }), { 
                headers: { 'Content-Type': 'application/json' } 
            });
        }

        return new Response(JSON.stringify({ answer: text }), { 
            headers: { 'Content-Type': 'application/json' } 
        });

    } catch (error) {
        console.error("CHAT ERROR:", error);
        return new Response(JSON.stringify({ message: "Fehler: " + error.message }), { status: 500 });
    }
}
