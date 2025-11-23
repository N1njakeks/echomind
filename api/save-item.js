import { createClient } from '@supabase/supabase-js';

// Wir brauchen hier KEIN Google/OpenAI mehr, nur Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Hilfsfunktion zum Parsen des Body (wichtig für Vercel)
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
  const { full_text, user_id, topic, is_pdf, id, is_read, update_only } = body;

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

    // Fall B: Neues PDF speichern
    if (!user_id || !full_text) {
       return res.status(400).json({ message: "Fehler: User ID oder Text fehlt." });
    }

    // WICHTIG: Wir speichern NUR die Daten, KEIN embedding!
    const { error } = await supabase
      .from('items')
      .insert({
        id: Date.now(),
        user_id: user_id,
        topic: topic || "Unbenannt",
        full_text: full_text,
        is_pdf: is_pdf || false,
        is_read: false,
        timestamp: Date.now()
        // HIER FEHLT JETZT ABSICHTLICH 'embedding'
      });

    if (error) throw error;

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error("SAVE ERROR:", error.message);
    return res.status(500).json({ message: "Fehler beim Speichern.", details: error.message });
  }
}
