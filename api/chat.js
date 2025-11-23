export const config = {
    runtime: 'edge', // Schneller & stabiler
};

export default async function handler(req) {
    // 1. Sicherheits-Check
    if (req.method !== 'POST') return new Response("Method not allowed", { status: 405 });

    try {
        const { query, context_content } = await req.json();
        const apiKey = process.env.GEMINI_KEY;

        if (!apiKey) {
            return new Response(JSON.stringify({ message: "Server Error: API Key fehlt." }), { status: 500 });
        }

        // 2. Prompt bauen (Text + Frage)
        // Wir kürzen den Text auf 40.000 Zeichen, das schafft Flash locker.
        const contextText = context_content ? context_content.substring(0, 40000) : "";
        
        const systemPrompt = `
        Du bist ein hilfreicher Lern-Assistent.
        Antworte basierend auf diesen Notizen:
        ${contextText}
        `;

        const isQuiz = query.toLowerCase().includes('quiz');
        let fullPrompt = systemPrompt + "\n\nUser Frage: " + query;

        if (isQuiz) {
            fullPrompt += `\n\nAUFGABE: Erstelle ein Multiple-Choice-Quiz.
            Antworte NUR mit reinem JSON (ohne Markdown-Zeichen wie \`\`\`json).
            FORMAT: { "question": "...", "options": ["A) ..","B) ..","C) ..","D) .."], "correctIndex": 0, "explanation": "..." }`;
        }

        // 3. Der direkte Google-Aufruf (Bypass aller Bibliotheken)
        // Wir nutzen v1beta und gemini-1.5-flash. Das ist der aktuelle Standard.
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    role: "user",
                    parts: [{ text: fullPrompt }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    // Wir erzwingen JSON nur beim Quiz, sonst Text
                    responseMimeType: isQuiz ? "application/json" : "text/plain"
                }
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Google API Error: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        let text = data.candidates[0].content.parts[0].text;

        // 4. Antwort zurücksenden
        if (isQuiz) {
            // Putzen, falls doch Markdown dabei ist
            text = text.replace(/```json/g, '').replace(/```/g, '').trim();
            try {
                return new Response(JSON.stringify({ quizJSON: JSON.parse(text) }), { 
                    headers: { 'Content-Type': 'application/json' } 
                });
            } catch (e) {
                // Fallback falls JSON kaputt ist -> als Text senden
                return new Response(JSON.stringify({ answer: text }), { headers: { 'Content-Type': 'application/json' } });
            }
        }

        return new Response(JSON.stringify({ answer: text }), { 
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
