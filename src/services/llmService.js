import geminiai from "../config/geminiai.js";
export const askLLM = async (prompt) => {
  const response = await geminiai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      temperature: 0.2,
      maxOutputTokens: 100,
      topP: 0.9,
      topK: 50,
      systemInstruction: `
<System Role>
You are a general-purpose helpful AI assistant.
</System Role>

<Instructions>
Answer the user's question or prompt in a clear, concise, and accurate manner.
</Instructions>

<Guardrails>
1. If you do not know the answer or lack the information to answer, state exactly: "I don't know."
2. Keep the answer factually accurate and avoid speculation.
</Guardrails>

<Output Formatting>
- Keep answers concise and direct.
- Use simple structure and bullet points where helpful.
</Output Formatting>
      `,
    },
  });
  return response.text;
};
