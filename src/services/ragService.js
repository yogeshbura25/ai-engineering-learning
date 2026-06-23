import geminiai from "../config/geminiai.js";
import { pineconeIndex } from "../config/pinecone.js";
import prisma from "../config/prisma.js";
import { getChatHistory, saveMessage } from "./chatHistoryService.js";
import { rerankMatches, buildContext, logRerankResults } from "./rerankingService.js";
import { evaluateRAG } from "./evaluationService.js";
import { validateInputGuardrail, validateOutputGuardrail } from "./guardrailService.js";

export const askRAG = async (question, category, sessionId) => {
  // Step 0: Input Guardrail Check (PII, Prompt Injection, Scope)
  const inputCheck = await validateInputGuardrail(question);
  if (!inputCheck.safe) {
    console.warn(`[RAG Input Guardrail Blocked] Question: "${question}". Reason: ${inputCheck.reason}`);
    return {
      answer: "I am sorry, but your query could not be processed as it violates safety or scope guidelines.",
      sources: [],
      evaluation: {
        faithfulness: 0.0,
        answerRelevance: 0.0,
        contextPrecision: 0.0
      },
      guardrailBlocked: true
    };
  }

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

  // Step 2: Multi-Query Generation (Retrieval Query Expansion)
  let subQueries = [searchQuery];
  try {
    const multiQueryPrompt = `
You are an expert search assistant. Your task is to generate 3 different versions/formulations of the given user question to retrieve relevant documents from a vector database.
By generating multiple perspectives on the question, your goal is to help the user overcome some of the limitations of distance-based similarity search.
If the question is extremely simple, you should still provide alternative formulations (e.g., using synonyms or rephrasing).

Respond ONLY with a valid JSON array of strings containing the original question plus the 3 variations (total 4 items). Do not include markdown code block formatting (like \`\`\`json) or any other text.

Question: "${searchQuery}"
`;

    const multiQueryResponse = await geminiai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: multiQueryPrompt,
    });

    const cleanText = multiQueryResponse.text.trim().replace(/^```json\s*|```\s*$/gi, '');
    const parsed = JSON.parse(cleanText);
    if (Array.isArray(parsed) && parsed.length > 0) {
      subQueries = parsed;
      console.log(`[RAG Multi-Query] Generated queries for retrieval:`, subQueries);
    }
  } catch (err) {
    console.error("Failed to generate multi-query variations, using fallback:", err.message);
  }

  // Step 3: Embed and Query Pinecone (semantic) + Query Postgres (keyword) for each sub-query in parallel
  const allMatches = [];
  let context = '';
  let rerankedMatches = [];
  try {
    const queryPromises = subQueries.map(async (subQ) => {
      // 1. Semantic Search: Embed and Query Pinecone
      const vectorSearchPromise = (async () => {
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

        const results = await pineconeIndex
          .namespace(category || "general")
          .query({
            vector: embedding,
            topK: 5,
            includeMetadata: true,
          });

        return results.matches || [];
      })();

      // 2. Keyword Search: Query PostgreSQL
      const keywordSearchPromise = (async () => {
        const MIN_WORD_LENGTH = 3;
        const queryWords = subQ
          .toLowerCase()
          .split(/\s+/)
          .filter(word => word.length >= MIN_WORD_LENGTH);

        if (queryWords.length === 0) {
          return [];
        }

        return await prisma.documentChunk.findMany({
          where: {
            category: category || "general",
            OR: queryWords.map(word => ({
              text: {
                contains: word,
                mode: 'insensitive',
              },
            })),
          },
          take: 5,
        });
      })();

      const [vectorMatches, keywordMatches] = await Promise.all([
        vectorSearchPromise,
        keywordSearchPromise,
      ]);

      return { vectorMatches, keywordMatches };
    });

    const resultsArray = await Promise.all(queryPromises);

    // Merge and deduplicate matches
    const seenIds = new Set();
    
    // First add all vector matches (maintaining their high-fidelity vector similarity scores)
    for (const res of resultsArray) {
      for (const match of res.vectorMatches) {
        if (!seenIds.has(match.id)) {
          seenIds.add(match.id);
          allMatches.push(match);
        }
      }
    }

    // Then add keyword matches that were NOT retrieved by vector search, with score = 0.0
    for (const res of resultsArray) {
      for (const chunk of res.keywordMatches) {
        if (!seenIds.has(chunk.id)) {
          seenIds.add(chunk.id);
          allMatches.push({
            id: chunk.id,
            score: 0.0, // base vector similarity score
            metadata: {
              source: chunk.source,
              category: chunk.category,
              chunkIndex: chunk.chunkIndex,
              text: chunk.text,
            },
          });
        }
      }
    }

    // Step 3b: Re-rank matches using keyword overlap
    rerankedMatches = rerankMatches(allMatches, searchQuery);
    logRerankResults(allMatches, rerankedMatches);

    // Step 4: Build Context (Sorted chronologically by chunkIndex for cohesion)
    const rawContext = buildContext(rerankedMatches, 7);

    // Step 4b: Compress Context using LLM extraction
    context = await compressContext(rawContext, searchQuery);
  } catch (error) {
    console.error("Error during sub-query parallel search or context compression:", error);
    throw error;
  }

  // Step 5: Prompt LLM with Context and Chat History
  const historyText = history && history.length > 0
    ? history.map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`).join("\n")
    : "No previous chat history.";

  const prompt = `
<System Role>
You are an expert customer support AI assistant specializing in answering user queries based on provided documentation.
</System Role>

<Instructions>
1. Analyze the retrieved [Context] (which contains source labels like [Document: filename, Chunk: index]) and the [Chat History] carefully.
2. Answer the [User Question] accurately, and explain it naturally.
3. For every claim, fact, or answer segment you construct, you MUST cite the source inline at the end of the sentence or clause using the format [Document: filename, Chunk: index] (e.g. "... RAG improves retrieval quality [Document: Company_Policy.pdf, Chunk: 3].").
4. If multiple context segments apply to a claim, cite them all (e.g., "... [Document: Policy.pdf, Chunk: 1] [Document: Benefits.pdf, Chunk: 0]").
5. Do not invent citations. Only use the sources explicitly provided in the [Context].
6. Prioritize information matching the category of the question if applicable.
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

  // Compile unique sources from the retrieved matches
  const uniqueSources = [];
  const seenSources = new Set();
  rerankedMatches.slice(0, 7).forEach((m) => {
    const src = m.metadata?.source;
    if (src && !seenSources.has(src)) {
      seenSources.add(src);
      uniqueSources.push({
        source: src,
        category: m.metadata?.category ?? 'general',
      });
    }
  });

  // Step 7: Perform RAGAS-style evaluation
  const evaluation = await evaluateRAG(question, context, answer);

  // Step 8: Output Guardrail Check (Hallucination Protection)
  const outputCheck = validateOutputGuardrail(evaluation.faithfulness, answer);
  const finalAnswer = outputCheck.answer;

  // Step 9: Save interaction to PostgreSQL
  if (sessionId) {
    try {
      await saveMessage(sessionId, 'user', question);
      await saveMessage(sessionId, 'model', finalAnswer);
    } catch (err) {
      console.error("Failed to save conversation message log:", err);
    }
  }

  return {
    answer: finalAnswer,
    sources: uniqueSources,
    evaluation,
    guardrailBlocked: !outputCheck.safe
  };

}

/**
 * Compress the retrieved context by extracting only the sentences and facts
 * directly relevant to the user query using Gemini.
 *
 * @param {string} rawContext  - The full concatenated context text
 * @param {string} searchQuery - The user's search query
 * @returns {Promise<string>} The compressed context text
 */
async function compressContext(rawContext, searchQuery) {
  if (!rawContext || !rawContext.trim()) {
    return "";
  }

  try {
    const compressionPrompt = `
You are a context compression assistant. 
Given the following retrieved [Documents] and the user [Question], extract ONLY the specific sentences, sentences parts, figures, or key facts that are directly relevant to answering the question.

Guidelines:
1. Keep the exact factual information intact.
2. Discard all filler text, formatting boilerplate, headers, and irrelevant background details.
3. Keep the source labels [Document: filename, Chunk: index] for the extracted facts so the user knows where they came from. Ensure the source label prefix is placed right before the facts extracted from that document.
4. Do NOT answer the question. Only return the compressed relevant context facts with their source labels.
5. If nothing in the documents is relevant to the question, respond with: "No relevant facts found."

[Documents]:
${rawContext}

[Question]:
${searchQuery}

Compressed Context:`;

    const response = await geminiai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: compressionPrompt,
      config: {
        temperature: 0.0,
      }
    });

    const compressed = response.text.trim();
    console.log(`[RAG Context Compression] Compressed context length from ${rawContext.length} to ${compressed.length} characters.`);
    return compressed;
  } catch (error) {
    console.error("Context compression failed, falling back to raw context:", error.message);
    return rawContext;
  }
}
