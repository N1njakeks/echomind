import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);

// Fügt robustes Body-Parsing hinzu (für den Fall, dass Vercel es nicht schafft)
async function parseBody(req) {
    if (req.body) return req.body;
    try {
        const chunks = [];
        for await (const chunk of req) { chunks.push(chunk); }
        const bodyStr = Buffer.concat(chunks).toString();
        return JSON.parse(bodyStr || '{}');
    } catch (e) { return {}; }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Nur POST erlaubt');
    
    // Daten robust parsen
    const body = await parseBody(req);
    const { query, user_id, context_item_id } = body; 

    // --- HARTE SICHERHEITSCHECKS (DAS PROBLEM!) ---
    if (!user_id || user_id === 'undefined') {
       return res.status(401).json({ message: "Fehler: Authentifizierung (UserID) fehlt im Request Body." });
    }
    if (!query) {
       return res.status(400).json({ message: "Fehler: Die Abfrage (Query) ist leer." });
    }

    try {
        let contextText = "";
        
        // 1. Suche mit Gemini Embeddings (RAG-Logik)
        if (!context_item_id) {
            const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
            
            // HIER KNALLTE ES: Wenn query undefined war, stürzte es hier ab.
            const result = await embeddingModel.embedContent(query);
            const queryVector = result.embedding.values;

            const { data: foundItems } = await supabase.rpc('match_items', {
                query_embedding: queryVector,
                match_threshold: 0.4,
                match_count: 3
            });

            if (foundItems && foundItems.length > 0) {
                contextText = foundItems.map(item => `Quelle: ${item.topic}\n${item.full_text}`).join("\n\n---\n\n");
            }
        } 
        // ... (Restliche Logik für Chat & Quiz bleibt gleich) ...

        const chatModel = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            systemInstruction: `Du bist ein Lern-Assistent. Antworte basierend auf den Notizen. Wenn du keine Antwort findest, antworte nicht. NOTIZEN: ${contextText.substring(0, 30000)}`
        });

        const isQuiz = query.toLowerCase().includes('quiz');

        if (isQuiz) {
            const quizPrompt = `Erstelle ein Quiz basierend auf dem Kontext als reines JSON Format: { "question": "...", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "..." }`;
            const quizResult = await chatModel.generateContent({contents: quizPrompt, config: {responseMimeType: "application/json"}});
            const quizText = quizResult.response.text();
            const jsonMatch = quizText.match(/\{[\s\S]*\}/);
            if(jsonMatch) return res.status(200).json({ quizJSON: JSON.parse(jsonMatch[0]) });
            else return res.status(200).json({ message: "Quiz konnte nicht generiert werden.", details: "Invalid JSON." });
        }
        
        const result = await chatModel.generateContent(query);
        return res.status(200).json({ answer: result.response.text() });

    } catch (error) {
        // Wir senden den Fehlertext jetzt explizit an den Browser zurück
        console.error("CRITICAL CHAT API CRASH:", error.message);
        return res.status(500).json({ message: "Server-Fehler: Es ist ein Fehler im Code aufgetreten.", details: error.message });
    }
}
