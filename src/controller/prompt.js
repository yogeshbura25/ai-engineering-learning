import { askLLM } from "../services/llmService.js";

export const promptHandler = async (req, res) => {
    const prompt = req.body.prompt || req.query.prompt;
    if (!prompt) {
        return res.status(400).send('Prompt is required.');
    }
    try {
        const response = await askLLM(prompt);
        res.send(response);
    } catch (error) {
        console.error('Error occurred while asking LLM:', error);
        res.status(500).send('An error occurred while processing your request.');
    }
}