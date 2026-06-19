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

  // Step 2: Query Decomposition (Sub-Query RAG)
  let subQueries = [searchQuery];
  try {
    const decompositionPrompt = `
You are an expert search assistant.
Decompose the following user question into 1 to 3 simpler, independent, standalone sub-questions that can be used for vector search.
If the question is already simple and cannot be decomposed, return it as the only element in the array.

Respond ONLY with a valid JSON array of strings. Do not include markdown code block formatting (like \`\`\`json) or any other text.

Question: "${searchQuery}"
`;

    const decompositionResponse = await geminiai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: decompositionPrompt,
    });

    const cleanText = decompositionResponse.text.trim().replace(/^```json\s*|```\s*$/gi, '');
    const parsed = JSON.parse(cleanText);
    if (Array.isArray(parsed) && parsed.length > 0) {
      subQueries = parsed;
      console.log(`[RAG Sub-Queries] Decomposed into:`, subQueries);
    }
  } catch (err) {
    console.error("Failed to decompose query, using fallback:", err.message);
  }

  // Step 3: Embed and Query Pinecone for each sub-query in parallel
  const allMatches = [];
  try {
    const queryPromises = subQueries.map(async (subQ) => {
      // 1. Generate embedding
      const embeddingResponse = await geminiai.models.embedContent({
        model: "gemini-embedding-001",
        contents: subQ,
        config: {
          outputDimensionality: 1024,
        },
      });

      const embedding =
        embeddingResponse.embedding?.values ||
        embeddingResponse.embeddings?.[0]?.values;

      if (!embedding) {
        throw new Error(`Failed to generate embedding for: ${subQ}`);
      }

      // 2. Query Pinecone
      const results = await pineconeIndex
        .namespace(category || "general")
        .query({
          vector: embedding,
          topK: 5,
          includeMetadata: true,
        });

      return results.matches || [];
    });

    const resultsArray = await Promise.all(queryPromises);

    // Merge and deduplicate matches
    const seenIds = new Set();
    for (const matches of resultsArray) {
      for (const match of matches) {
        if (!seenIds.has(match.id)) {
          seenIds.add(match.id);
          allMatches.push(match);
        }
      }
    }

    // Sort by relevance score descending
    allMatches.sort((a, b) => b.score - a.score);
  } catch (error) {
    console.error("Error during sub-query parallel search:", error);
    throw error;
  }

  // Step 4: Build Context (Sorted chronologically by chunkIndex for cohesion)
  const context = allMatches
    .slice(0, 7) // Take top 7 most relevant unique matches
    .sort((a, b) => a.metadata.chunkIndex - b.metadata.chunkIndex)
    .map((match) => match.metadata.text)
    .join("\n\n");

  // Step 5: Prompt LLM with Context and Chat History
  const historyText = history && history.length > 0
    ? history.map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`).join("\n")
    : "No previous chat history.";

  const prompt = `
<System Role>
You are an expert customer support AI assistant specializing in answering user queries based on provided documentation.
</System Role>

<Instructions>
1. Analyze the retrieved [Context] and the [Chat History] carefully.
2. Answer the [User Question] accurately, and explain it naturally.
3. Prioritize information matching the category of the question if applicable.
Use all relevant information from the provided context.
4. If multiple context sections answer different parts of the question,
5. combine them into a single complete response.
</Instructions>

<Guardrails>
1. Answer ONLY using the facts present in the provided [Context].
2. Do NOT extrapolate, speculate, or mention any information that is not explicitly stated in the [Context].
3. If the answer cannot be found or inferred from the provided [Context], respond exactly with: "I could not find the answer in the uploaded documents."
4. Avoid references to "according to the context" or "the provided documents". Answer directly and naturally.
</Guardrails>

<Output Formatting>
- Keep your response clear, concise, and structured.
- Use bullet points or numbered lists where appropriate for readability.
- Maintain a polite, professional, and helpful tone.
</Output Formatting>

<Context>
${context}
</Context>

<Chat History>
${historyText}
</Chat History>

<User Question>
${question}
</User Question>
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
