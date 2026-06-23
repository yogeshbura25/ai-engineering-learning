# AI Engineering Learning Server

A Node.js Express server demonstrating a production-style **RAG (Retrieval-Augmented Generation)** pipeline using Google Gemini models, Pinecone Vector Database, and persistent conversational memory with PostgreSQL (Prisma ORM).

---

## Features

* **PDF Text Extraction** — Parses uploaded PDF documents with customized FAQ-aware chunking (keeps Q&A blocks together) and safety guards against infinite loops.
* **Vector Embeddings** — Generates 1024-dimensional embeddings using the `gemini-embedding-001` model.
* **Vector & Relational Storage** — Batches and upserts embeddings into Pinecone with source, category, and chunk metadata, while simultaneously storing chunks in PostgreSQL.
* **Namespaces** — Isolates vectors in Pinecone under separate namespaces based on document category (defaulting consistently to `"general"`).
* **Conversational Memory** — Stores message history in PostgreSQL under unique session IDs.
* **Query Rephrasing** — Translates follow-up questions (e.g. *"Can you explain the first step?"*) into standalone search queries using past chat history.
* **Multi-Query Retrieval** — Generates 3 alternative formulations of the user's question to query the database from multiple semantic perspectives in parallel, maximizing retrieval coverage.
* **Hybrid Search (Dense + Sparse)** — Runs parallel queries using semantic vector search (Pinecone) and keyword-based search (PostgreSQL) to retrieve relevant context.
* **Re-Ranking** — Combines Pinecone's vector similarity score (70% weight, falling back to 0.0 for keyword-only matches) with keyword overlap score (30% weight) to re-order results before building context.
* **Context Compression** — Employs Gemini 2.5 Flash as a document compressor to filter out irrelevant text/filler and keep only sentences and facts directly addressing the user's query, improving LLM response accuracy.
* **Context-Aware QA (RAG)** — Queries Pinecone and PostgreSQL for relevant context, compresses it, and uses `gemini-2.5-flash` to answer questions based on the refined facts and conversational history.
* **Source Citations** — Enforces visual inline source attributions (e.g. `[Document: Policy.pdf, Chunk: 3]`) inside the LLM answer, and returns a structured list of unique retrieved source files in the API JSON response payload.
* **RAGAS Evaluation (LLM-as-a-Judge)** — Grades RAG query responses in real-time along three key metrics: Faithfulness (groundedness), Answer Relevance, and Context Precision.
* **Security & Quality Guardrails** — Employs dual-stage guardrails:
  * **Input Check**: Screens user queries for prompt injections, safety violations, and out-of-scope requests before execution.
  * **Output Check**: Blocks hallucinated responses (if the evaluated Faithfulness score is below 70%) and returns a safe fallback message.

---

## RAG Pipeline Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                           /api/ask-rag                                      │
│                                                                             │
│  ┌────────────────┐   ┌──────────────┐   ┌──────────────────┐               │
│  │ Step 0         │   │ Step 1       │   │ Step 2           │               │
│  │ Input          │──▶│ Chat History │──▶│ Multi-Query      │──┐            │
│  │ Guardrails     │   │ + Rephrase   │   │ Generation       │  │            │
│  └────────────────┘   └──────────────┘   └──────────────────┘  │            │
│                                                                ▼            │
│  ┌──────────────┐   ┌──────────────────┐   ┌─────────────────────────────┐  │
│  │ Step 6       │   │ Step 5           │   │ Step 3                      │  │
│  │ Generate     │◀──│ Build LLM        │◀──│ Embed + Query Pinecone      │  │
│  │ Final Answer │   │ Prompt           │   │ (parallel expansion queries)│  │
│  │ (Gemini)     │   │                  │   │ + Merge & Deduplicate       │  │
│  └──────┬───────┘   └─────────────▲────┘   └─────────────┬───────────────┘  │
│         │                         │                      │                  │
│         │                         │                      ▼                  │
│         │                         │        ┌─────────────┴───────────────┐  │
│         │                         │        │ Step 3b                     │  │
│         │                         │        │ RE-RANKING                  │  │
│         │                         │        └─────────────┬───────────────┘  │
│         │                         │                      ▼                  │
│         │                         │        ┌─────────────────────────────┐  │
│         │                         │        │ Step 4                      │  │
│         │                         └────────│ Context Compression         │  │
│         │                                  │ (Gemini extraction)         │  │
│         │                                  └─────────────────────────────┘  │
│         ▼                                                                   │
│  ┌────────────────┐                                                         │
│  │ Step 7         │                                                         │
│  │ Output         │                                                         │
│  │ Guardrail      │                                                         │
│  └──────┬─────────┘                                                         │
│         │                                                                   │
│         ▼                                                                   │
│  ┌──────────────┐                                                           │
│  │ Step 8       │                                                           │
│  │ Save to      │                                                           │
│  │ PostgreSQL   │                                                           │
│  └──────────────┘                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Repository Structure

```text
├── server.js                     # Entrypoint: Initializes Express app and routes
├── .env                          # Configuration (API keys, index names, db url)
├── prisma/
│   └── schema.prisma             # Prisma database schema definition
└── src/
    ├── config/
    │   ├── geminiai.js           # Google Gen AI SDK initialization
    │   ├── pinecone.js           # Pinecone database client configuration
    │   └── prisma.js             # Prisma client instance configuration
    ├── controller/
    │   ├── documentupload.js     # Handles file upload requests
    │   ├── prompt.js             # Handles direct QA/prompt requests
    │   └── ragController.js      # Handles RAG QA with session history requests
    ├── routes/
    │   └── index.js              # API route definitions (/ask, /upload, /ask-rag)
    └── services/
        ├── chatHistoryService.js # Message log persistence using Prisma
        ├── documentService.js    # Extracts, chunks, embeds, and uploads PDFs to Pinecone
        ├── evaluationService.js  # RAGAS-style real-time evaluation metrics
        ├── guardrailService.js   # Input safety validation & output groundedness checks
        ├── llmService.js         # Direct LLM generation helper
        ├── ragService.js         # RAG pipeline orchestrator (guardrail → rephrase → multi-query → search → re-rank → compress → answer → guardrail)
        └── rerankingService.js   # Re-ranking: keyword overlap scoring + context builder
```

---

## Re-Ranking

The re-ranking service (`rerankingService.js`) improves retrieval quality by combining two signals:

| Signal | Weight | Description |
|--------|--------|-------------|
| **Vector Similarity** | 70% | Pinecone's cosine similarity score (semantic meaning) |
| **Keyword Overlap** | 30% | Fraction of query keywords found in the chunk text |

**Formula**: `rerankScore = (pineconeScore × 0.7) + (keywordScore × 0.3)`

This is a **read-only, in-memory** operation — nothing is written back to Pinecone or the database. It simply re-orders the results that Pinecone already returned before building the LLM context.

Exported functions:
- `rerankMatches(matches, searchQuery)` — Scores and re-sorts matches
- `buildContext(rerankedMatches, topK)` — Takes top K results, sorts by chunk order, joins text
- `logRerankResults(before, after)` — Console logging for debugging

---

## Database Configuration

Prisma manages the PostgreSQL connection using the `DATABASE_URL` variable in your `.env` file:

```env
DATABASE_URL="postgresql://username:password@localhost:5432/rag_memory"
```

To sync the schema with your local PostgreSQL database:

```bash
npx prisma db push
```

---

## Environment Variables

Create a `.env` file in the project root with:

```env
GEMINI_API_KEY=your_gemini_api_key
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX_NAME=your_index_name
DATABASE_URL=postgresql://username:password@localhost:5432/rag_memory
PORT=3000
```

---

## Getting Started

```bash
# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Push database schema
npx prisma db push

# Start development server
npm run dev
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
Queries the Pinecone category namespace for relevant context (with multi-query retrieval, re-ranking, and chat history rephrasing) and uses the retrieved context to answer the question using `gemini-2.5-flash`.

* **URL**: `/api/ask-rag`
* **Method**: `POST`
* **Content-Type**: `application/json`
* **Body Parameters**:
  * `question`: The question you want to ask.
  * `category` *(optional)*: The category namespace to search within (e.g. `"faq"`, `"billing"`). Defaults to `"general"`.
  * `sessionId` *(optional)*: The conversation session ID. If not provided, the server auto-generates a new session UUID and returns it in the response so you can reuse it for follow-up questions.
* **Response Output**:
  * `answer`: The context-aware answer string with inline source citations (e.g. `[Document: Policy.pdf, Chunk: 3]`).
  * `sources`: A deduplicated list of unique source documents retrieved for context (e.g., `[ { "source": "Policy.pdf", "category": "general" } ]`).
  * `sessionId`: The session ID associated with the conversation.
  * `evaluation`: Real-time RAGAS-style grading results of the answer:
    * `faithfulness` *(number)*: 0.0 to 1.0 (is the answer grounded in context).
    * `answerRelevance` *(number)*: 0.0 to 1.0 (does it directly answer the user question).
    * `contextPrecision` *(number)*: 0.0 to 1.0 (relevance of retrieved segments).
    * `details` *(object)*: Contains claim checks and text explanations.
  * `guardrailBlocked` *(boolean)*: Indicates if either the Input Guardrail (prompt safety check) or Output Guardrail (hallucination filter) triggered and blocked the query/response.

---

### 4. Delete a Document
Deletes document chunks from Pinecone (dynamically querying the database for all namespaces where the document was loaded, or using the optional category parameter), removes database records, and deletes the local file from the `uploads/` directory.

* **URL**: `/api/documents/:fileName`
* **Method**: `DELETE`
* **URL Parameters**:
  * `fileName`: The name of the file to delete (e.g. `"Company_Policy_QA_25.pdf"`)
* **Query Parameters**:
  * `category` *(optional)*: The category namespace (e.g. `"general"`, `"faq"`). If omitted, the API automatically determines the namespaces from the database.

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| **Node.js + Express** | Server framework |
| **Google Gemini** | LLM (gemini-2.5-flash) + Embeddings (gemini-embedding-001) |
| **Pinecone** | Vector database for semantic search |
| **PostgreSQL + Prisma** | Chat history persistence & document chunk storage for keyword lookup |
| **pdf-parse** | PDF text extraction |