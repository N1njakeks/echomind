import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Nur POST erlaubt');

  const { full_text, user_id, topic, is_pdf, id, is_read, update_only } = req.body;

  try {
    // Fall A: Nur Status-Update (Gelesen/Ungelesen)
    if (update_only) {
        const { error } = await supabase
            .from('items')
            .update({ is_read })
            .eq('id', id)
            .eq('user_id', user_id);
        if (error) throw error;
        return res.status(200).json({ success: true });
    }

    // Fall B: Neues Item speichern (mit Vektor)
    // 1. Text in Vektor umwandeln
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: full_text.substring(0, 8000), // Limit für Embedding, falls Text riesig
    });

    const vector = embeddingResponse.data[0].embedding;

    // 2. In Supabase speichern
    const { error } = await supabase
      .from('items')
      .insert({
        id: Date.now(), // Simple ID generation
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
    return res.status(500).json({ error: error.message });
  }
}