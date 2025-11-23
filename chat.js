// api/chat.js
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Clients initialisieren (Muss am Anfang der Datei passieren)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Nur POST erlaubt');

  // NEU: Hinzufügen der user_id und Loggen des gesamten Körpers
  const { query, user_id, context_item_id } = req.body; 
  console.log("CHAT DEBUG:", { userId: user_id, query: query, context: context_item_id }); 
  
  if (!user_id) {
     return res.status(401).json({ message: "Fehler: UserID fehlt. Bitte neu einloggen." });
  }

  try {
    let contextText = "";

    // 1. Suche mit Gemini Embeddings (Wenn kein Kontext-Item ausgewählt ist)
    if (!context_item_id) {
        // [Hier war der Fehler im Code, weil user_id im Log nicht zugeordnet wurde]

        // --- RAG-Suche ---
        const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
        const result = await embeddingModel.embedContent(query);
        const queryVector = result.embedding.values;

        // Ruft die SQL-Funktion auf, die nach der UserID filtert
        const { data: foundItems } = await supabase.rpc('match_items', {
            query_embedding: queryVector,
            match_threshold: 0.4,
            match_count: 3
        });

        if (foundItems && foundItems.length > 0) {
            contextText = foundItems.map(item => `Quelle: ${item.topic}\n${item.full_text}`).join("\n\n---\n\n");
        }
    } else {
        // Logik für ein einzelnes Item (keine Vektor-Suche nötig, direkter Abruf)
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

    if (isQuiz) {
        // Quiz-Logik
        const quizPrompt = `Erstelle ein Quiz basierend auf dem Kontext als reines JSON Format: { "question": "...", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "..." }`;
        const quizResult = await chatModel.generateContent(quizPrompt);
        const quizText = quizResult.response.text();
        const jsonMatch = quizText.match(/\{[\s\S]*\}/);
        if(jsonMatch) return res.status(200).json({ quizJSON: JSON.parse(jsonMatch[0]) });
        else throw new Error("AI did not return valid JSON for quiz.");
    }
    
    // Normale Chat-Antwort
    const result = await chatModel.generateContent(query);
    const text = result.response.text();

    return res.status(200).json({ answer: text });

  } catch (error) {
    // Wenn es hier crasht, liegt es meist an der SQL-Funktion oder am Key
    console.error("CRITICAL CHAT API CRASH:", error);
    // Gib den genauen Fehler an den Browser zurück, damit wir ihn sehen
    return res.status(500).json({ message: "Server-Fehler. Prüfe Vercel Logs.", details: error.message });
  }
}