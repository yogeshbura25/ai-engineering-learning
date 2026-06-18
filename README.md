# AI Engineering Learning Server

A simple Node.js Express server demonstrating RAG (Retrieval-Augmented Generation) using Google Gemini models, Pinecone Vector Database, and persistent conversational memory using PostgreSQL with Prisma ORM.

## Features

* **PDF Text Extraction**: Parses uploaded PDF documents (including customized parsing for FAQ lists to keep question-answer blocks together).
* **Vector Embeddings**: Generates 1024-dimensional embeddings for text chunks using the `gemini-embedding-001` model.
* **Vector Storage**: Batches and upserts embeddings into Pinecone with source, category, and chunk metadata.
* **Namespaces**: Isolates vectors in Pinecone under separate namespaces based on document category.
* **Conversational Memory**: Stores message history in a PostgreSQL database under unique session IDs.
* **Query Rephrasing**: Translates follow-up questions (e.g. *"Can you explain the first step?"*) into standalone search queries using past chat history.
* **Context-Aware QA (RAG)**: Queries Pinecone for relevant context and uses `gemini-2.5-flash` to answer questions based on the retrieved document context and conversational history.

---

## Repository Structure

```text
├── server.js                 # Entrypoint: Initializes Express app and routes
├── .env                      # Configuration (API keys, index names, db url)
├── prisma/
│   └── schema.prisma         # Prisma database schema definition
└── src/
    ├── config/
    │   ├── geminiai.js       # Google Gen AI SDK initialization
    │   ├── pinecone.js       # Pinecone database client configuration
    │   └── prisma.js         # Prisma client instance configuration
    ├── controller/
    │   ├── documentupload.js # Handles file upload requests
    │   ├── prompt.js         # Handles QA/prompt requests
    │   └── ragController.js  # Handles RAG QA with session history requests
    ├── routes/
    │   └── index.js          # API route definitions (/ask, /upload, /ask-rag)
    └── services/
        ├── chatHistoryService.js # Message log persistency queries using Prisma
        ├── documentService.js# Extracts, chunks, embeds, and uploads PDFs to Pinecone
        ├── llmService.js     # Direct LLM generation helper
        └── ragService.js     # Pinecone query + LLM RAG + Memory rephrase answering pipeline
```

---

## Database Configuration

Prisma manages connection setup using the `DATABASE_URL` variable in your `.env` file:

```env
DATABASE_URL="postgresql://username:password@localhost:5432/rag_memory"
```

To sync the schema definitions with your local PostgreSQL database, run:

```bash
npx prisma db push
```

---

## API Endpoints

### 1. Upload a Document
Uploads a PDF file, parses it, extracts text, chunks it, generates vector embeddings, and stores it in Pinecone under the specified category namespace.

* **URL**: `/api/upload`
* **Method**: `POST`
* **Content-Type**: `multipart/form-data`
* **Body Parameters**:
  * `file`: The PDF file (binary)
  * `category`: The category label/namespace (e.g. `"faq"`, `"billing"`)

---

### 2. Ask a Direct LLM Question
Sends the prompt directly to the Gemini LLM model (`gemini-2.5-flash`) without context retrieval.

* **URL**: `/api/ask`
* **Method**: `POST`
* **Content-Type**: `application/json`
* **Body Parameters**:
  * `prompt`: The question or prompt you want to ask.

---

### 3. Ask a Question with RAG and Memory
Queries the Pinecone category namespace for relevant context (using rephrased queries from chat history) and uses the retrieved context and message history to answer the question using `gemini-2.5-flash`.

* **URL**: `/api/ask-rag`
* **Method**: `POST`
* **Content-Type**: `application/json`
* **Body Parameters**:
  * `question`: The question you want to ask.
  * `category` *(optional)*: The category namespace to search within (e.g. `"faq"`, `"billing"`). Defaults to `"general"`.
  * `sessionId` *(optional)*: The conversation session ID. If not provided, the server auto-generates a new session UUID and returns it in the response so you can reuse it for follow-up questions.