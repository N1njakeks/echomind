import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });

export default async function handler(req, res) {
  const { text, user_id } = req.body;
  
  // 1. Vektor holen
  const embedding = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });

  // 2. Speichern
  const { error } = await supabase.from('items').insert({
    user_id: user_id,
    full_text: text,
    embedding: embedding.data[0].embedding
  });

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ success: true });
}