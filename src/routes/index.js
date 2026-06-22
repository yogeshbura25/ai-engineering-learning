import express from "express";
import multer from "multer";
const router = express.Router();
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});
const upload = multer({ storage });

import { promptHandler } from "../controller/prompt.js";
import { documentUploadHandler, documentDeleteHandler } from "../controller/documentupload.js";
import { ragHandler } from "../controller/ragController.js";

router.post('/ask', promptHandler);
router.post('/upload', upload.single('file'), documentUploadHandler);
router.post('/ask-rag', ragHandler);
router.delete('/documents/:fileName', documentDeleteHandler);
export default router;