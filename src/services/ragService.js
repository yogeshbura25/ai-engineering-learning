import geminiai from "../config/geminiai.js";
import { pineconeIndex } from "../config/pinecone.js";
import { getChatHistory, saveMessage } from "./chatHistoryService.js";

export const askRAG = async (question, category, sessionId) => {
  let searchQuery = question;
  let history = [];

  // Step 1: Retrieve Chat History & Rephrase Query if needed
  if (sessionId) {
    try {
      history = await getChatHistory(sessionId);
      if (history && history.length > 0) {
        const historyText = history
          .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
          .join("\n");

        const rephrasePrompt = `
Given the following chat history and a follow-up question, rephrase the follow-up question into a standalone question that can be searched in a database.
Do not answer the question, just return the rephrased question.

Chat History:
${historyText}

Follow-up Question: ${question}

Standalone Question:`;

        const rephraseResponse = await geminiai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: rephrasePrompt,
        });

        searchQuery = rephraseResponse.text.trim();
        // console.log(`[RAG Memory] Rephrased "${question}" -> "${searchQuery}"`);
      }
    } catch (err) {
      console.error("Error retrieval/rephrasing with chat history:", err);
    }
  }

  // Step 2: Generate query embedding
  const embeddingResponse = await geminiai.models.embedContent({
    model: "gemini-embedding-001",
    contents: searchQuery,
    config: {
      outputDimensionality: 1024,
    },
  });

  const queryEmbedding =
    embeddingResponse.embedding?.values ||
    embeddingResponse.embeddings?.[0]?.values;

  if (!queryEmbedding) {
    throw new Error("Failed to generate query embedding");
  }

  // Step 3: Search Pinecone
  const searchResults = await pineconeIndex
    .namespace(category || "general")
    .query({
      vector: queryEmbedding,
      topK: 5,
      includeMetadata: true,
    });
//   console.log("Pinecone search results matches:", JSON.stringify(searchResults.matches, null, 2));

  // Step 4: Build Context
  const context = searchResults.matches
    .map((match) => match.metadata.text)
    .join("\n\n");

  // Step 5: Prompt LLM with Context and Chat History
  const historyText = history && history.length > 0
    ? history.map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`).join("\n")
    : "No previous chat history.";

  const prompt = `
You are a helpful assistant.

Use the provided context to answer the question.

If the context contains relevant information,
rephrase and explain it naturally.

Only say "I could not find the answer in the uploaded documents"
if no relevant information exists.

Context:
${context}

Chat History:
${historyText}

User's Question:
${question}
`;

  // Step 6: Generate Final Answer
  const llmResponse = await geminiai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
  });

  const answer = llmResponse.text;

  // Step 7: Save interaction to PostgreSQL
  if (sessionId) {
    try {
      await saveMessage(sessionId, 'user', question);
      await saveMessage(sessionId, 'model', answer);
    } catch (err) {
      console.error("Failed to save conversation message log:", err);
    }
  }

  return {
    answer,
  };
}
