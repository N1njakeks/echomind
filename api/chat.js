import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Nur POST erlaubt');

  const { query, context_item_id } = req.body;

  try {
    let contextText = "";

    // 1. Suche mit Gemini Embeddings
    if (!context_item_id) {
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
        // ... (Logik für einzelnes Item bleibt gleich, holt Text aus DB)
        const { data } = await supabase.from('items').select('full_text').eq('id', context_item_id).single();
        if(data) contextText = data.full_text;
    }

    // 2. Chatten mit Gemini Flash (schnell & gut)
    const chatModel = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        systemInstruction: `Du bist ein Lern-Assistent. Antworte basierend auf diesen Notizen:\n\n${contextText.substring(0, 30000)}`
    });

    const result = await chatModel.generateContent(query);
    const response = result.response;
    const text = response.text();

    // Quiz-Logik (einfach gelöst)
    if (query.toLowerCase().includes('quiz')) {
        // Gemini ist gut in JSON, wenn man es nett bittet
        const quizPrompt = `Erstelle ein Quiz basierend auf dem Kontext als reines JSON Format: { "question": "...", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "..." }`;
        const quizResult = await chatModel.generateContent(quizPrompt);
        const quizText = quizResult.response.text();
        // Versuche JSON zu finden (Gemini packt es oft in ```json ... ```)
        const jsonMatch = quizText.match(/\{[\s\S]*\}/);
        if(jsonMatch) return res.status(200).json({ quizJSON: JSON.parse(jsonMatch[0]) });
    }

    return res.status(200).json({ answer: text });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}