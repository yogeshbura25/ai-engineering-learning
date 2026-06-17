import express from "express";
import multer from "multer";
const router = express.Router();
const upload = multer({ dest: "uploads/",
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
 });

import { promptHandler } from "../controller/prompt.js";
import { documentUploadHandler } from "../controller/documentupload.js";
import { ragHandler } from "../controller/ragController.js";

router.post('/ask', promptHandler);
router.post('/upload', upload.single('file'), documentUploadHandler);
router.post('/ask-rag', ragHandler);
export default router;