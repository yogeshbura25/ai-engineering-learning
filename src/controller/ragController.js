// import { askRAG } from "../services/ragService.js";

// export const ragHandler = async (req, res) => {
//   try {
//     const { question, category, sessionId } = req.body;
//     if (!question) {
//       return res.status(400).json({ error: "Question is required" });
//     }
//     const result = await askRAG(question, category, sessionId);
//     res.json(result);
//     // console.log("RAG response:", result);
//   } catch (error) {
//     console.error("Error in RAG handler:", error);
//     res.status(500).json({ error: "Internal server error" });
//   }
// };


import { askRAG } from "../services/ragService.js";
import crypto from "crypto"; // Built-in Node.js module

export const ragHandler = async (req, res) => {
  try {
    const { question, category } = req.body;

    // Auto-generate a session ID if the client didn't send one
    const sessionId = req.body.sessionId || crypto.randomUUID();

    if (!question) {
      return res.status(400).json({ error: "Question is required" });
    }

    const result = await askRAG(question, category, sessionId);

    // Return the result AND the sessionId to the client
    res.json({
      ...result,
      sessionId
    });

  } catch (error) {
    console.error("Error in RAG handler:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

