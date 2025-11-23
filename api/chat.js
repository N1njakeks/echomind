// api/chat.js - Stabil & Quiz-Ready
export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (req.method !== 'POST') return new Response("Method not allowed", { status: 405 });

    try {
        const { query, context_content } = await req.json();
        const apiKey = process.env.GEMINI_KEY;

        // 1. Prompt bauen
        const contextText = context_content ? context_content.substring(0, 40000) : "";
        const isQuiz = query.toLowerCase().includes('quiz');

        let systemPart = `Du bist ein Lern-Assistent. Antworte basierend auf diesen Notizen:\n${contextText}`;
        let userPart = query;

        // 2. Quiz-Spezialbehandlung
        if (isQuiz) {
            systemPart += `\n\nAUFGABE: Erstelle ein Multiple-Choice-Quiz.
            WICHTIG: Antworte AUSSCHLIESSLICH mit reinem JSON. Kein Markdown, kein 'Hier ist das Quiz'.
            JSON STRUKTUR: { "question": "Frage...", "options": ["A) ..","B) ..","C) ..","D) .."], "correctIndex": 0, "explanation": "..." }`;
        }

        // 3. Direkter Google-Aufruf (Umgeht alle Library-Version-Probleme)
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: systemPart + "\n\nUser: " + userPart }] }],
                generationConfig: {
                    // Zwingt Gemini zu JSON, wenn Quiz (verhindert Abstürze)
                    responseMimeType: isQuiz ? "application/json" : "text/plain"
                }
            })
        });

        const data = await response.json();
        
        // Fehler von Google abfangen
        if (data.error) throw new Error(data.error.message);

        const text = data.candidates[0].content.parts[0].text;

        // 4. Antwort senden
        if (isQuiz) {
            return new Response(JSON.stringify({ quizJSON: JSON.parse(text) }), { headers: { 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({ answer: text }), { headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
        return new Response(JSON.stringify({ message: "Backend Error", details: error.message }), { status: 500 });
    }
}
