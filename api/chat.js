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
    const contextText = context_content ? context_content.substring(0, 30000) : "";
    
    const systemPrompt = `
    Du bist ein hilfreicher Lern-Assistent.
    Antworte basierend auf diesen Notizen.
    Notizen: ${contextText}
    `;

    // FIX: Mit dem neuen package.json funktioniert dieses Modell endlich!
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const isQuiz = query.toLowerCase().includes('quiz');

    if (isQuiz) {
        const quizPrompt = `
        Erstelle ein Multiple-Choice-Quiz.
        Antworte NUR mit JSON: { "question": "...", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "..." }
        Frage: ${query}
        `;
        
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: systemPrompt + "\n" + quizPrompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        });
        
        const text = result.response.text();
        return res.status(200).json({ quizJSON: JSON.parse(text) });
    }

    const result = await model.generateContent(systemPrompt + "\n\nUser: " + query);
    return res.status(200).json({ answer: result.response.text() });

  } catch (error) {
    console.error("API ERROR:", error);
    return res.status(500).json({ message: "Backend Fehler: " + error.message });
  }
}
