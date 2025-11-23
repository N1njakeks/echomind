import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
// ACHTUNG: Wir nutzen hier eine neue Variable für den Key!
const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Nur POST erlaubt');

  const { full_text, user_id, topic, is_pdf, id, is_read, update_only } = req.body;

  try {
    // Update Logik (bleibt gleich)
    if (update_only) {
        const { error } = await supabase.from('items').update({ is_read }).eq('id', id).eq('user_id', user_id);
        if (error) throw error;
        return res.status(200).json({ success: true });
    }

    // --- GEMINI TEIL ---
    // Wir nutzen das 'text-embedding-004' Modell von Google
    const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
    
    const result = await model.embedContent(full_text.substring(0, 9000)); // Gemini schafft viel Text!
    const vector = result.embedding.values; // Das ist der Vektor für Supabase

    // Speichern
    const { error } = await supabase
      .from('items')
      .insert({
        id: Date.now(),
        user_id: user_id,
        topic: topic || "Unbenannt",
        full_text: full_text,
        is_pdf: is_pdf || false,
        is_read: false,
        timestamp: Date.now(),
        embedding: vector
      });

    if (error) throw error;

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error("Gemini Error:", error);
    return res.status(500).json({ error: error.message });
  }
}