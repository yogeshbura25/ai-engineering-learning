# AI Engineering Learning Server

A simple Node.js Express server demonstrating RAG (Retrieval-Augmented Generation) using Google Gemini models and Pinecone Vector Database.

## Features

* **PDF Text Extraction**: Parses uploaded PDF documents (including customized parsing for FAQ lists to keep question-answer blocks together).
* **Vector Embeddings**: Generates 1024-dimensional embeddings for text chunks using the `gemini-embedding-001` model.
* **Vector Storage**: Batches and upserts embeddings into Pinecone with source, category, and chunk metadata.
* **Metadata Filtering**: Allows filtering search results by category.
* **Context-Aware QA (RAG)**: Queries Pinecone for relevant information and uses `gemini-2.5-flash` to answer questions strictly based on the uploaded context.

---

## Repository Structure

```text
├── server.js                 # Entrypoint: Initializes Express app and routes
├── .env                      # Configuration (API keys, index names)
└── src/
    ├── config/
    │   ├── geminiai.js       # Google Gen AI SDK initialization
    │   └── pinecone.js       # Pinecone database client configuration
    ├── controller/
    │   ├── documentupload.js # Handles file upload requests
    │   └── prompt.js         # Handles QA/prompt requests
    ├── routes/
    │   └── index.js          # API route definitions (/ask and /upload)
    └── services/
        ├── documentService.js# Extracts, chunks, embeds, and uploads PDFs to Pinecone
        ├── llmService.js     # direct LLM generation helper
        └── ragService.js     # Pinecone query + LLM RAG answering pipeline
```

---

## API Endpoints

### 1. Upload a Document
Uploads a PDF file, parses it, extracts text, chunks it, generates vector embeddings, and stores it in Pinecone.

* **URL**: `/api/upload`
* **Method**: `POST`
* **Content-Type**: `multipart/form-data`
* **Body Parameters**:
  * `file`: The PDF file (binary)
  * `category`: The category label (e.g. `"FAQ"`, `"Billing"`)

---

### 2. Ask a Direct LLM Question
Sends the prompt directly to the Gemini LLM model (`gemini-2.5-flash`) without context retrieval.

* **URL**: `/api/ask`
* **Method**: `POST`
* **Content-Type**: `application/json`
* **Body Parameters**:
  * `prompt`: The question or prompt you want to ask.

---

### 3. Ask a Question with RAG
Queries the Pinecone knowledge base for relevant context and uses the retrieved context to answer the question using `gemini-2.5-flash`.

* **URL**: `/api/ask-rag`
* **Method**: `POST`
* **Content-Type**: `application/json`
* **Body Parameters**:
  * `question`: The question you want to ask.
  * `category` *(optional)*: The category to filter by (or namespace if enabled).