import geminiai from "../config/geminiai.js";

/**
 * Evaluate the faithfulness of the answer based on the retrieved context.
 * Faithfulness measures if the answer is grounded ONLY in the context.
 */
async function evaluateFaithfulness(question, context, answer) {
  try {
    const prompt = `
You are an expert RAG pipeline evaluator. Your task is to evaluate the FAITHFULNESS (groundedness) of a generated answer compared to the provided context.
An answer is faithful if all claims/statements in the answer can be directly inferred from the context.

Retrieved Context:
${context}

Generated Answer:
${answer}

Follow these steps:
1. Identify all distinct factual statements/claims made in the Generated Answer.
2. For each statement, verify if it is supported by the Retrieved Context.
3. Compute the faithfulness score as: (Number of supported statements) / (Total statements). The score must be between 0.0 (completely ungrounded/hallucinated) and 1.0 (fully grounded).

Respond ONLY with a valid JSON object matching the following structure. Do not include markdown code block formatting or any other text.
{
  "statements": [
    {
      "claim": "The claim text",
      "supported": true,
      "explanation": "Why it is or isn't supported"
    }
  ],
  "score": 0.85
}
`;

    const response = await geminiai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" }
    });

    const parsed = JSON.parse(response.text.trim());
    return {
      score: parsed.score ?? 0.0,
      details: parsed.statements ?? []
    };
  } catch (error) {
    console.error("Faithfulness evaluation failed:", error.message);
    return { score: 0.0, details: [] };
  }
}

/**
 * Evaluate the relevance of the generated answer to the user's question.
 */
async function evaluateAnswerRelevance(question, answer) {
  try {
    const prompt = `
You are an expert RAG pipeline evaluator. Your task is to evaluate the RELEVANCE of a generated answer to the user's question.
Answer relevance measures if the answer directly addresses the question and does not contain redundant or off-topic information.

User Question:
${question}

Generated Answer:
${answer}

Rate the relevance on a scale from 0.0 (completely irrelevant) to 1.0 (highly relevant, directly answers the question without fluff).

Respond ONLY with a valid JSON object matching the following structure. Do not include markdown code block formatting or any other text.
{
  "score": 0.95,
  "explanation": "Brief explanation of the rating"
}
`;

    const response = await geminiai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" }
    });

    const parsed = JSON.parse(response.text.trim());
    return {
      score: parsed.score ?? 0.0,
      explanation: parsed.explanation ?? ""
    };
  } catch (error) {
    console.error("Answer relevance evaluation failed:", error.message);
    return { score: 0.0, explanation: "" };
  }
}

/**
 * Evaluate the precision/relevance of the retrieved context compared to the question.
 * Measures if the retrieved chunks actually contain relevant information (signal vs noise).
 */
async function evaluateContextPrecision(question, context) {
  try {
    const prompt = `
You are an expert RAG pipeline evaluator. Your task is to evaluate the CONTEXT PRECISION of the retrieved documents for a given user question.
Context precision measures what fraction of the retrieved context is actually relevant and useful to answer the question.

User Question:
${question}

Retrieved Context:
${context}

Rate the context precision on a scale from 0.0 (completely irrelevant noise) to 1.0 (highly precise context where all sections are relevant).

Respond ONLY with a valid JSON object matching the following structure. Do not include markdown code block formatting or any other text.
{
  "score": 0.8,
  "explanation": "Brief explanation of the rating"
}
`;

    const response = await geminiai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" }
    });

    const parsed = JSON.parse(response.text.trim());
    return {
      score: parsed.score ?? 0.0,
      explanation: parsed.explanation ?? ""
    };
  } catch (error) {
    console.error("Context precision evaluation failed:", error.message);
    return { score: 0.0, explanation: "" };
  }
}

/**
 * Perform RAGAS-style evaluation on a single query and response
 */
export async function evaluateRAG(question, context, answer) {
  try {
    console.log("Starting RAGAS-style evaluation...");
    const [faithfulness, answerRelevance, contextPrecision] = await Promise.all([
      evaluateFaithfulness(question, context, answer),
      evaluateAnswerRelevance(question, answer),
      evaluateContextPrecision(question, context)
    ]);

    return {
      faithfulness: faithfulness.score,
      answerRelevance: answerRelevance.score,
      contextPrecision: contextPrecision.score,
      details: {
        faithfulnessStatements: faithfulness.details || [],
        answerRelevanceExplanation: answerRelevance.explanation || "",
        contextPrecisionExplanation: contextPrecision.explanation || ""
      }
    };
  } catch (err) {
    console.error("Error during RAG evaluation:", err);
    return {
      error: err.message,
      faithfulness: 0.0,
      answerRelevance: 0.0,
      contextPrecision: 0.0
    };
  }
}
