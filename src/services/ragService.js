import geminiai from "../config/geminiai.js";
import { pineconeIndex } from "../config/pinecone.js";

export const askRAG = async (question, category) => {

  // Step 1: Generate query embedding

  const embeddingResponse =
    await geminiai.models.embedContent({
      model: "gemini-embedding-001",
      contents: question,
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

  // Step 2: Search Pinecone

  const searchResults =
    await pineconeIndex
      //   .namespace(category)
      .query({
        vector: queryEmbedding,
        topK: 5,
        includeMetadata: true,
        // You can remove the metadata filter since they are partitioned by namespace!
        filter: {

          category: { $in: category ? [category] : [] },
        },
      });

  // console.log("Pinecone search results:", searchResults);

  // Step 3: Build Context

  const context = searchResults.matches
    .map((match) => match.metadata.text)
    .join("\n\n");

  // Step 4: Prompt LLM

  const prompt = `
You are a helpful AI assistant.


Elaborate your answer based on the context, but do not include information that is not present in the context.
If the answer is not available in the context,

If the user provided a category, prioritize information from that category in the context. If the answer is not available in the context,

respond with:
"I could not find the answer in the uploaded documents."

Context:
${context}

Question:
${question}
`;

  // Step 5: Generate Final Answer

  const llmResponse =
    await geminiai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

  return {
    answer: llmResponse.text,
    // sources: searchResults.matches.map(
    //   (match) => ({
    //     source: match.metadata.source,
    //     category: match.metadata.category,
    //     score: match.score,
    //   })
    // ),
  };
}
