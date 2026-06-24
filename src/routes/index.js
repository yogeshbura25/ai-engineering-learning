import express from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";

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

// Rate limiter: 5 requests per minute per IP for AI endpoints
const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests, please try again after a minute.",
  },
});

import { promptHandler } from "../controller/prompt.js";
import { documentUploadHandler, documentDeleteHandler } from "../controller/documentupload.js";
import { ragHandler } from "../controller/ragController.js";

router.post('/ask', aiRateLimiter, promptHandler);
router.post('/upload', upload.single('file'), documentUploadHandler);
router.post('/ask-rag', aiRateLimiter, ragHandler);
router.delete('/documents/:fileName', documentDeleteHandler);
export default router;