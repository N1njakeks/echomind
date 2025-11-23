import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Nur POST erlaubt');

  const { query, user_id, context_item_id } = req.body;

  try {
    let contextText = "";

    // Szenario A: User chattet mit EINER konkreten PDF
    if (context_item_id) {
        const { data } = await supabase
            .from('items')
            .select('full_text')
            .eq('id', context_item_id)
            .single();
        if (data) contextText = data.full_text;
    } 
    // Szenario B: User stellt eine allgemeine Frage (Wir suchen in ALLEN PDFs)
    else {
        // 1. Frage in Vektor umwandeln
        const embeddingResponse = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: query,
        });
        const queryVector = embeddingResponse.data[0].embedding;

        // 2. Supabase Suche (match_items Funktion)
        const { data: foundItems, error } = await supabase.rpc('match_items', {
            query_embedding: queryVector,
            match_threshold: 0.4, // Etwas toleranter
            match_count: 3
        });

        if (foundItems && foundItems.length > 0) {
            contextText = foundItems.map(item => `Quelle: ${item.topic}\n${item.full_text}`).join("\n\n---\n\n");
        }
    }

    // Kontext kürzen, damit es nicht zu teuer wird (ca. 15.000 Zeichen)
    const limitedContext = contextText.substring(0, 15000);

    const systemPrompt = `
    Du bist ein hilfreicher Lernassistent.
    Beantworte die Frage des Nutzers basierend auf den folgenden Notizen/Quellen.
    Wenn die Antwort im Text steht, zitiere die Seitenzahl (Format: [[Page X]]).
    
    Wenn der Nutzer ein "Quiz" will, antworte NUR mit einem JSON im Format:
    { "question": "...", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "..." }

    NOTIZEN:
    ${limitedContext}
    `;

    // Ist es ein Quiz? (Wir prüfen simple Keywords)
    const isQuiz = query.toLowerCase().includes('quiz') || query.toLowerCase().includes('test');

    const chatResponse = await openai.chat.completions.create({
        model: "gpt-4-turbo", // Oder gpt-3.5-turbo für billiger
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: query }
        ],
        response_format: isQuiz ? { type: "json_object" } : { type: "text" }
    });

    const reply = chatResponse.choices[0].message.content;

    if (isQuiz) {
        return res.status(200).json({ quizJSON: JSON.parse(reply) });
    } else {
        return res.status(200).json({ answer: reply });
    }

  } catch (error) {
    console.error("Chat Error:", error);
    return res.status(500).json({ error: error.message });
  }
}