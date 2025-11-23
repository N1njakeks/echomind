// api/chat.js
export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (req.method !== 'POST') return new Response("Method not allowed", { status: 405 });

    try {
        const { query, context_content } = await req.json();
        const apiKey = process.env.GEMINI_KEY;

        if (!apiKey) return new Response(JSON.stringify({ message: "API Key fehlt." }), { status: 500 });

        const contextText = context_content ? context_content.substring(0, 30000) : "";
        const isQuiz = query.toLowerCase().includes('quiz');

        let promptText = `Du bist ein Lern-Assistent. Antworte basierend auf diesen Notizen:\n${contextText}\n\nUser: ${query}`;

        if (isQuiz) {
            promptText += `\n\nAUFGABE: Erstelle ein Multiple-Choice-Quiz. Antworte NUR mit JSON: { "question": "...", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "..." }`;
        }

        // FIX: Wir nutzen 'gemini-pro' (Das existiert garantiert in v1beta)
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }]
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Google API Error: ${response.status} ${errText}`);
        }

        const data = await response.json();
        let text = data.candidates[0].content.parts[0].text;

        if (isQuiz) {
            text = text.replace(/```json/g, '').replace(/```/g, '').trim();
            try {
                return new Response(JSON.stringify({ quizJSON: JSON.parse(text) }), { headers: { 'Content-Type': 'application/json' } });
            } catch (e) {
                return new Response(JSON.stringify({ answer: text }), { headers: { 'Content-Type': 'application/json' } });
            }
        }

        return new Response(JSON.stringify({ answer: text }), { headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
        return new Response(JSON.stringify({ message: "Fehler: " + error.message }), { status: 500 });
    }
}
