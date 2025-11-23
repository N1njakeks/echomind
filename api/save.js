import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai'; // WICHTIG: Google SDK

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY); // WICHTIG: Gemini Key nutzen!

// Hilfsfunktion zum robusten Parsen des Requests
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
    const { full_text, user_id, topic, is_pdf } = body;

    if (!user_id || !full_text) {
       return res.status(400).json({ message: "User ID oder Text fehlt im Body." });
    }

    try {
        // --- 1. Vektor holen mit GEMINI ---
        const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
        
        // Generiere den Vektor (768 Dimensionen)
        const result = await embeddingModel.embedContent(full_text.substring(0, 9000)); 
        const vector = result.embedding.values;

        // 2. Speichern in Supabase
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
            embedding: vector // Speichert den 768er Vektor
          });

        if (error) throw error;
        return res.status(200).json({ success: true });

    } catch (error) {
        console.error("CRITICAL SAVE API CRASH:", error.message);
        return res.status(500).json({ message: "Fehler beim Speichern des Vektors.", details: error.message });
    }
}
