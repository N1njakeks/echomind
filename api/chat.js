import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// --- INITIALISIERUNG ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);

// Hilfsfunktion zum robusten Parsen des Requests
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
    
    const body = await parseBody(req);
    const { query, user_id, context_item_id } = body; 

    // --- SICHERHEITS-PRÜFUNGEN (Behebt 401/400 Fehler) ---
    if (!user_id) return res.status(401).json({ message: "Fehler: User-Authentifizierung fehlt." });
    if (!query) return res.status(400).json({ message: "Fehler: Abfrage (Query) ist leer." });
    // --- ENDE SICHERHEITS-PRÜFUNGEN ---

    try {
        let contextText = "";
        
        // 1. Suche mit Gemini Embeddings (Wenn KEIN Kontext-Item ausgewählt ist)
        if (!context_item_id) {
            const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
            const result = await embeddingModel.embedContent(query);
            const queryVector = result.embedding.values;

            // Supabase RPC Aufruf (Vektor-Suche)
            const { data: foundItems } = await supabase.rpc('match_items', {
                query_embedding: queryVector,
                match_threshold: 0.4,
                match_count: 3
            });

            if (foundItems && foundItems.length > 0) {
                // Kontexte aus den gefundenen Dokumenten zusammenfügen
                contextText = foundItems.map(item => `Quelle: ${item.topic}\n${item.full_text}`).join("\n\n---\n\n");
            }
        } 
        // 2. Suche in einem spezifischen Dokument (Wenn Kontext-Item ausgewählt ist)
        else {
            const { data } = await supabase.from('items').select('full_text').eq('id', context_item_id).single();
            if(data) contextText = data.full_text;
        }

        // 3. Den Prompt für Gemini erstellen
        const systemPrompt = `Du bist ein hilfreicher Lernassistent. Antworte basierend auf den bereitgestellten Notizen. Wenn du die Antwort in den Notizen nicht findest, sag freundlich, dass diese Information nicht verfügbar ist. NOTIZEN: ${contextText.substring(0, 30000)}`;

        const chatModel = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash", // Korrigierter Modellname
            systemInstruction: systemPrompt
        });

        const isQuiz = query.toLowerCase().includes('quiz');

        // 4. KI-Antwort generieren
        if (isQuiz) {
            // Quiz-Logik (speziell für JSON-Output)
            const quizPrompt = `Erstelle ein Quiz basierend auf dem Kontext als reines JSON Format: { "question": "...", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "..." }`;
            
            const quizResult = await chatModel.generateContent({
                contents: quizPrompt,
                config: { responseMimeType: "application/json" }
            });
            
            const quizText = quizResult.response.text();
            const jsonMatch = quizText.match(/\{[\s\S]*\}/);
            
            // Wenn JSON gefunden, senden wir es zurück
            if(jsonMatch) return res.status(200).json({ quizJSON: JSON.parse(jsonMatch[0]) });
            else return res.status(200).json({ message: "Quiz konnte nicht als sauberes JSON generiert werden.", details: quizText });
        }
        
        // Normale Chat-Antwort
        const result = await chatModel.generateContent(query);
        return res.status(200).json({ answer: result.response.text() });

    } catch (error) {
        // Dieser Block fängt den 500er Fehler ab
        console.error("CRITICAL CHAT API CRASH:", error.message);
        return res.status(500).json({ message: "Server-Fehler: Es ist ein Fehler im Code aufgetreten.", details: error.message });
    }
}