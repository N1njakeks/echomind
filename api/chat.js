import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);

// Hilfsfunktion zum Parsen
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

    if (!user_id) return res.status(401).json({ message: "Fehler: Authentifizierung fehlt." });
    if (!query) return res.status(400).json({ message: "Fehler: Abfrage (Query) ist leer." });

    try {
        let contextText = "";

        // --- NEUE LOGIK: HOLT DEN GESAMTEN TEXT ---
        if (context_item_id) {
            const { data } = await supabase.from('items').select('full_text').eq('id', context_item_id).single();
            if(data) contextText = data.full_text;
        }

        // 2. Chatten mit Gemini Flash
        // ÄNDERUNG: Modell auf gemini-1.5-flash gesetzt (sicherer)
        const systemPrompt = `
        Du bist ein hilfreicher Lernassistent. 
        Antworte basierend auf den Notizen. Wenn die Notizen leer sind, verwende dein allgemeines Wissen.
        NOTIZEN: ${contextText.substring(0, 30000)}`; 
        
        const chatModel = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash", 
            systemInstruction: systemPrompt
        });

        const isQuiz = query.toLowerCase().includes('quiz');

        // 3. Quiz-Logik
        if (isQuiz) {
            const quizPrompt = `Erstelle ein Quiz basierend auf dem Kontext als reines JSON Format: { "question": "...", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "..." }`;
            
            // Wir zwingen Gemini zu JSON Output
            const quizResult = await chatModel.generateContent({
                contents: [{ role: "user", parts: [{ text: quizPrompt }] }],
                generationConfig: { responseMimeType: "application/json" }
            });
            
            const quizText = quizResult.response.text();
            
            // Bereinigung: Entferne Markdown, falls vorhanden
            const cleanJson = quizText.replace(/```json/g, '').replace(/```/g, '').trim();
            
            try {
                const quizObj = JSON.parse(cleanJson);
                return res.status(200).json({ quizJSON: quizObj });
            } catch (e) {
                console.error("JSON Parse Error:", e);
                // Fallback: Sende Text, wenn JSON kaputt ist
                return res.status(200).json({ answer: "Das Quiz konnte nicht formatiert werden. Hier ist der Rohdaten-Entwurf:\n\n" + quizText });
            }
        }
        
        // 4. Normale Antwort
        const result = await chatModel.generateContent(query);
        return res.status(200).json({ answer: result.response.text() });

    } catch (error) {
        console.error("CRITICAL CHAT API CRASH:", error.message);
        return res.status(500).json({ message: "Server-Fehler: Es ist ein Fehler im Code aufgetreten.", details: error.message });
    }
}
