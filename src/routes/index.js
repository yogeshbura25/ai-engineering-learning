import express from "express";
const router = express.Router();
import { promptHandler } from "../controller/prompt.js";

router.get('/ask', promptHandler);

export default router;