export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (req.method !== 'POST') return new Response("Method not allowed", { status: 405 });

    try {
        const { query, context_content } = await req.json();
        const apiKey = process.env.GEMINI_KEY;

        if (!apiKey) return new Response(JSON.stringify({ message: "API Key fehlt." }), { status: 500 });

        // 1. Kontext
        const contextText = context_content ? context_content.substring(0, 50000) : "";
        
        const systemPrompt = `
        Du bist ein hilfreicher Lern-Assistent.
        Antworte basierend auf diesen Notizen:
        ${contextText}
        `;

        const isQuiz = query.toLowerCase().includes('quiz');
        let fullPrompt = systemPrompt + "\n\nUser: " + query;

        if (isQuiz) {
            fullPrompt += `\n\nAUFGABE: Erstelle ein Multiple-Choice-Quiz.
            Antworte bitte mit einem JSON-ähnlichen Format:
            { "question": "...", "options": ["A) ..","B) ..","C) ..","D) .."], "correctIndex": 0, "explanation": "..." }`;
        }

        // 2. API Aufruf (Explizit gemini-2.5-flash)
        // Wir nutzen hier 'v1beta', da neue Modelle meist dort zuerst landen.
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: fullPrompt }] }]
            })
        });

        if (!response.ok) {
            // Falls 2.5 wirklich nicht geht, siehst du hier den Fehler von Google
            const errText = await response.text();
            throw new Error(`Google API Error (${response.status}): ${errText}`);
        }

        const data = await response.json();
        let text = data.candidates[0].content.parts[0].text;

        // 3. Quiz Verarbeitung (Versuch)
        if (isQuiz) {
            text = text.replace(/```json/g, '').replace(/```/g, '').trim();
            try {
                return new Response(JSON.stringify({ quizJSON: JSON.parse(text) }), { headers: { 'Content-Type': 'application/json' } });
            } catch (e) {
                // Fallback: Text senden, wenn JSON nicht klappt
                return new Response(JSON.stringify({ answer: text }), { headers: { 'Content-Type': 'application/json' } });
            }
        }

        return new Response(JSON.stringify({ answer: text }), { headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
        return new Response(JSON.stringify({ message: "Backend Error: " + error.message }), { status: 500 });
    }
}
