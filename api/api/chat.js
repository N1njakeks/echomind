// api/chat.js
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);

// --- Hilfsfunktion zum robusten Parsen des Bodies ---
async function parseBody(req) {
    if (req.body) return req.body;
    try {
        const chunks = [];
        for await (const chunk of req) {
            chunks.push(chunk);
        }
        const bodyStr = Buffer.concat(chunks).toString();
        return JSON.parse(bodyStr || '{}');
    } catch (e) {
        return {};
    }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Nur POST erlaubt');
    
    // Daten robust parsen und entpacken
    const body = await parseBody(req);
    const { query, user_id, context_item_id } = body; 

    console.log("CHAT DEBUG - USER ID:", user_id); 
    console.log("CHAT DEBUG - QUERY:", query); 
    
    // WICHTIGE PRÜFUNG: Wenn user_id oder query fehlt, crasht der Code
    if (!user_id) {
       return res.status(401).json({ message: "Fehler: User-Authentifizierung fehlt." });
    }
    if (!query) {
       return res.status(400).json({ message: "Fehler: Die Abfrage (Query) ist leer." });
    }

    try {
        let contextText = "";
        
        // 1. Suche mit Gemini Embeddings (Wenn kein Kontext-Item ausgewählt ist)
        if (!context_item_id) {
            // --- RAG Vektor-Suche ---
            const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
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
        } else {
            // Logik für ein einzelnes Item (direkter Abruf)
            const { data } = await supabase.from('items').select('full_text').eq('id', context_item_id).single();
            if(data) contextText = data.full_text;
        }

        // 2. Chatten mit Gemini Flash
        const chatModel = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            systemInstruction: `Du bist ein Lern-Assistent. Antworte basierend auf den Notizen. Wenn du keine Antwort findest, antworte nicht.
            NOTIZEN: ${contextText.substring(0, 30000)}`
        });

        const isQuiz = query.toLowerCase().includes('quiz');
        
        // ... (Restliche Chat-Logik, die ich dir vorher gegeben hatte)

        const result = await chatModel.generateContent(query);
        const text = result.response.text();

        if (isQuiz) {
            // Versuche, Quiz-JSON zu finden (für den Chatbot)
            const quizPrompt = `Erstelle ein Quiz basierend auf dem Kontext als reines JSON Format: { "question": "...", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "..." }`;
            const quizResult = await chatModel.generateContent(quizPrompt);
            const quizText = quizResult.response.text();
            const jsonMatch = quizText.match(/\{[\s\S]*\}/);
            if(jsonMatch) return res.status(200).json({ quizJSON: JSON.parse(jsonMatch[0]) });
            else return res.status(200).json({ answer: "Quiz-Antwort konnte nicht als sauberes JSON generiert werden." });
        }

        return res.status(200).json({ answer: text });

    } catch (error) {
        // Logge den exakten Fehler, falls er durch die Datenbank kommt
        console.error("CRITICAL CHAT API CRASH (Final Catch):", error.message);
        // Gib den Fehlercode an den Browser zurück, damit wir ihn sehen
        return res.status(500).json({ message: "Server-Fehler. Siehe Vercel Logs für Details.", details: error.message });
    }
}