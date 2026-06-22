import { uploadDocument, deleteDocument } from "../services/documentService.js";

export const documentUploadHandler = async (req, res) => {
    //   console.log("req.body:", req.body);
    //   console.log("req.file:", req.file);
    const file = req.file;
    const category = req.body.category || "general";
    if (!file) {
        return res.status(400).send('No file uploaded.');
    }
    try {
        const result = await uploadDocument(file.path, file.originalname, category);
        res.send(result);
    } catch (error) {
        console.error('Error occurred while uploading document:', error);
        res.status(500).send('An error occurred while processing your request.');
    }
}

export const documentDeleteHandler = async (req, res) => {
    const { fileName } = req.params;
    const category = req.query.category || req.body.category;

    if (!fileName) {
        return res.status(400).json({ error: "fileName parameter is required." });
    }

    try {
        const result = await deleteDocument(fileName, category);
        res.json(result);
    } catch (error) {
        console.error('Error occurred while deleting document:', error);
        res.status(500).send('An error occurred while processing your request.');
    }
};
