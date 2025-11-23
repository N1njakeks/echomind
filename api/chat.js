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
    // 1. Kontext
    const contextText = context_content ? context_content.substring(0, 50000) : "";
    
    const systemPrompt = `
    Du bist ein hilfreicher Lern-Assistent.
    Antworte basierend auf diesen Notizen.
    Notizen: ${contextText}
    `;

    // 2. Modell: Wir nutzen jetzt 1.5-flash (funktioniert mit dem package.json Update!)
    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        systemInstruction: systemPrompt
    });

    // 3. Quiz Logik
    const isQuiz = query.toLowerCase().includes('quiz');

    if (isQuiz) {
        const quizPrompt = `
        Erstelle ein Multiple-Choice-Quiz.
        Antworte NUR mit diesem JSON Format:
        { "question": "Frage?", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "Erklärung" }
        `;
        
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: quizPrompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        });
        
        const text = result.response.text();
        return res.status(200).json({ quizJSON: JSON.parse(text) });
    }

    // 4. Normaler Chat
    const result = await model.generateContent(query);
    return res.status(200).json({ answer: result.response.text() });

  } catch (error) {
    console.error("API ERROR:", error);
    return res.status(500).json({ message: "Fehler: " + error.message });
  }
}
