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
      systemInstruction: `You are a helpful assistant.
      answer the question in a concise and clear manner. If you don't know the answer, say "I don't know".`,
    },
  });
  return response.text;
};
