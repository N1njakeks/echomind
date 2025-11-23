import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Stelle sicher, dass diese Variablen in deinem Environment gesetzt sind
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);

export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (req.method !== 'POST') return new Response('Nur POST erlaubt', { status: 405 });

    try {
        const body = await req.json();
        const { query, user_id, context_item_id } = body; 

        if (!user_id || !query) {
            return new Response(JSON.stringify({ message: "Fehler: User ID oder Abfrage fehlt." }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        let contextText = "";
        
        // --- 1. RAG Logik (Vektor Store) ---
        if (!context_item_id) {
            // Vektor-Suche über alle Dokumente
            const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
            const result = await embeddingModel.embedContent(query);
            const queryVector = result.embedding.values;

            const { data: foundItems } = await supabase.rpc('match_items', {
                query_embedding: queryVector,
                match_threshold: 0.1, 
                match_count: 3
            });

            if (foundItems && foundItems.length > 0) {
                contextText = foundItems.map(item => `Quelle: ${item.topic}\n${item.full_text}`).join("\n\n---\n\n");
            }
        } else {
            // Einzel-Dokument Abruf (Chat-Kontext)
            const { data } = await supabase.from('items').select('full_text').eq('id', context_item_id).single();
            if(data) contextText = data.full_text;
        }

        // --- 2. Gemini Chat Setup ---
        const systemPrompt = `
        Du bist ein hilfreicher Lern-Assistent. 
        Deine Priorität ist es, die Frage des Nutzers mithilfe der folgenden Notizen zu beantworten.
        Wenn die Notizen irrelevant oder leer sind, beantworte die Frage mit deinem allgemeinen Wissen. 
        NOTIZEN: ${contextText.substring(0, 30000)}`;

        const chatModel = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash", 
            systemInstruction: systemPrompt
        });

        const isQuiz = query.toLowerCase().includes('quiz');

        // --- 3. Quiz / Chat Logik (Der Zustand vor der Reparatur) ---
        if (isQuiz) {
            // Wir fragen nach JSON, erzwingen es aber NICHT mit responseMimeType!
            const quizPrompt = `Erstelle ein Multiple-Choice-Quiz basierend auf dem Kontext als JSON Format: { "question": "...", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "..." }`;
            
            const quizResult = await chatModel.generateContent({
                contents: [{ role: "user", parts: [{ text: quizPrompt }] }]
                // HIER FEHLT DIE ZEILE: generationConfig: { responseMimeType: "application/json" }
            });
            
            const quizText = quizResult.response.text; 
            
            try {
                // Versuche, das zurückgegebene (manchmal unsaubere) JSON zu parsen
                let cleanedText = quizText.replace(/^```json\n?|```$/g, '').trim(); 
                return new Response(JSON.stringify({ quizJSON: JSON.parse(cleanedText) }), { headers: { 'Content-Type': 'application/json' } });
            } catch (e) {
                 // Wenn das Parsen fehlschlägt, senden wir es als normalen Text, was das Frontend als Fehler anzeigen wird
                 return new Response(JSON.stringify({ answer: quizText }), { headers: { 'Content-Type': 'application/json' } });
            }
        }
        
        // 4. Normale Chat-Antwort
        const result = await chatModel.generateContent(query);
        return new Response(JSON.stringify({ answer: result.response.text() }), { headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
        console.error("CRITICAL CHAT API CRASH:", error.message);
        return new Response(JSON.stringify({ message: "Server-Fehler", details: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
