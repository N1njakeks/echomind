import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);

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
  const { query, context_content } = body; 

  if (!query) return res.status(400).json({ message: "Keine Frage." });

  try {
    // 1. Kontext kürzen (Sicherheit gegen Abstürze bei riesigen PDFs)
    const contextText = context_content ? context_content.substring(0, 30000) : "";
    
    const systemPrompt = `
    Du bist ein Lern-Assistent.
    Antworte basierend auf diesen Notizen.
    Notizen: ${contextText}
    `;

    // 2. Modell: Wir nehmen 'gemini-pro' (Das funktioniert immer)
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    // 3. Quiz Erkennung
    const isQuiz = query.toLowerCase().includes('quiz');

    if (isQuiz) {
        const quizPrompt = `
        Basierend auf den Notizen, erstelle ein Multiple-Choice-Quiz.
        Antworte AUSSCHLIESSLICH mit gültigem JSON. Kein Markdown, kein Text davor/danach.
        Format: { "question": "Frage?", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "Erklärung" }
        
        Frage: ${query}
        `;
        
        const result = await model.generateContent(systemPrompt + "\n" + quizPrompt);
        let text = result.response.text();
        
        // Bereinigung: Markdown entfernen, falls Gemini es trotzdem sendet
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        try {
            const json = JSON.parse(text);
            return res.status(200).json({ quizJSON: json });
        } catch (e) {
            // Fallback: Wenn JSON kaputt ist, senden wir es als Text
            return res.status(200).json({ answer: text });
        }
    }

    // 4. Normaler Chat
    const chatPrompt = `${systemPrompt}\n\nUser: ${query}\nAI:`;
    const result = await model.generateContent(chatPrompt);
    const responseText = result.response.text();
    
    return res.status(200).json({ answer: responseText });

  } catch (error) {
    console.error("API ERROR:", error);
    return res.status(500).json({ message: "Backend Fehler", details: error.message });
  }
}
