import {uploadDocument}  from "../services/documentService.js";

export const documentUploadHandler = async (req, res) => {
//   console.log("req.body:", req.body);
//   console.log("req.file:", req.file);
  const file = req.file;
  const category = req.body.category || "uncategorized";
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
