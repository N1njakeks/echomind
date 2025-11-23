import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialisiere Gemini mit dem Key aus Vercel
const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);

// Hilfsfunktion: Body Parsing (Wichtig für Vercel!)
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
  // 1. Nur POST erlauben
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 2. Daten auspacken
    const body = await parseBody(req);
    const { query, context_content } = body; // Wir erwarten 'context_content' vom Frontend

    if (!query) {
        return res.status(400).json({ message: "Keine Frage empfangen." });
    }

    // 3. Prompt bauen (Simpel: Text + Frage)
    // Wir kürzen den Kontext sicherheitshalber auf 30.000 Zeichen, damit Gemini nicht explodiert
    const safeContext = context_content ? context_content.substring(0, 30000) : "";
    
    const systemPrompt = `
    Du bist ein hilfreicher Lern-Assistent.
    Beantworte die Frage des Nutzers basierend auf den folgenden Notizen.
    Wenn die Notizen leer sind, nutze dein Allgemeinwissen.
    
    NOTIZEN:
    ${safeContext}
    `;

    // 4. Modell initialisieren (WICHTIG: Hier war vorhin der Fehler!)
    // Wir nutzen 'gemini-1.5-flash', das ist stabil und schnell.
    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        systemInstruction: systemPrompt
    });

    // 5. Prüfen: Ist es ein Quiz?
    const isQuiz = query.toLowerCase().includes('quiz');

    if (isQuiz) {
        const quizPrompt = `Erstelle ein Quiz basierend auf dem Kontext als reines JSON: { "question": "...", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "..." }`;
        
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: quizPrompt }] }],
            generationConfig: { responseMimeType: "application/json" } // Erzwingt JSON
        });
        
        const responseText = result.response.text();
        return res.status(200).json({ quizJSON: JSON.parse(responseText) });
    }

    // 6. Normaler Chat
    const result = await model.generateContent(query);
    const responseText = result.response.text();
    
    return res.status(200).json({ answer: responseText });

  } catch (error) {
    console.error("BACKEND ERROR:", error);
    // Wir schicken den echten Fehler zurück, damit du ihn im Browser siehst (F12 -> Netzwerk)
    return res.status(500).json({ message: "Server Error", details: error.message });
  }
}
