import { askRAG } from "../services/ragService.js";

export const ragHandler = async (req, res) => {
  try {
    const { question, category } = req.body;
    if (!question) {
      return res.status(400).json({ error: "Question is required" });
    }
    const result = await askRAG(question, category);
    res.json(result);
    // console.log("RAG response:", result);
  } catch (error) {
    console.error("Error in RAG handler:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
