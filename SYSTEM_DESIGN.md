# SecondBrain — System Design (Summary)

> NOTE: This is a concise summary. For a full assignment submission, expand each section with more detail and diagrams.

## 1. Overview

SecondBrain is a multi-modal personal knowledge store and AI assistant that can ingest documents, audio, images, URLs, and text, index them, and answer questions using natural language.

High-level components:

- **Ingestion API (Node.js + Express)**
- **Async Ingestion Worker (BullMQ + Redis)**
- **Vector Store (Chroma via Python FastAPI)**
- **LLM Services (OpenAI: embeddings, chat, Whisper)**
- **Image Captioning (HuggingFace BLIP inference API)**
- **Frontend (React + Vite)**

User data is stored per-user (collection scoped by userId) to support isolation and scaling.

## 2. Multi-Modal Ingestion Pipeline

Supported modalities:

- **Audio**: uploaded files (mp3/m4a/wav/mp4) are transcribed using OpenAI Whisper (`/v1/audio/transcriptions`).
- **Documents**: PDFs are parsed with `pdf-parse`. Plain text is stored directly.
- **Web Content**: pages are fetched server-side and parsed with cheerio; text is extracted from `<p>` tags.
- **Plain Text**: directly ingested.
- **Images**: files (png/jpg/webp) are captioned using HuggingFace BLIP (`Salesforce/blip-image-captioning-large`), via HF Inference API.

Flow:

1. Client calls `POST /upload` with file, text, or URL.
2. Backend stores doc metadata in `storage.json` and enqueues a job to Redis via BullMQ (queue `ingest`).
3. Worker consumes jobs:
   - Downloads or reads file.
   - Transforms modality → text (PDF → text, audio → transcript, image → caption, URL → scraped text).
   - Chunks text into overlapping segments (~400 words with 15% overlap).
   - For each chunk:
     - Generates embedding via OpenAI embeddings API.
     - Upserts embedding + metadata + document text into Chroma.
     - Stores chunk metadata in `storage.json`.
   - Extracts entities from combined text using LLM and writes a simple graph structure (`graph.nodes`, `graph.edges`) to `storage.json`.

## 3. Data Indexing & Storage

- **Vector Store**: Chroma (duckdb+parquet) via microservice.
  - Collection per `userId`.
  - Each vector has:
    - `id` = chunkId (UUID)
    - `document` = chunk text
    - `metadata` = `{ docId, userId, sourceType, url? }`
- **Metadata Store (Prototype)**: `storage.json` on disk, representing:
  - `docs`: document-level metadata (docId, userId, sourceType, uploadedAt, processedAt, originalUri, title).
  - `chunks`: chunk-level text, timestamps, references to docId & userId.
  - `graph`: small knowledge graph of entities and relations.

In a production version, `storage.json` would be replaced by a SQL/NoSQL database (e.g., Postgres + pgvector or MongoDB).

## 4. Retrieval & Querying Strategy

Steps for `/query`:

1. Extract query string and optional filters (time, tags, sourceType).
2. Use chrono-node to infer temporal constraints (e.g. “last Tuesday”, “last month”) → UTC `fromDate`, `toDate`.
3. Generate query embedding via OpenAI embeddings API.
4. Query Chroma for top-N candidates in the user’s collection (e.g., 3x the requested k).
5. Join candidates with local metadata (`storage.json`) to:
   - Filter by time window.
   - Filter by sourceType and other metadata.
   - Compute keyword score (simple substring frequency).
   - Compute recency boost (favor recent chunks).
6. Sort chunks by a hybrid score:
   - `score = 0.85 * semantic + 0.15 * keyword + 0.1 * recencyBoost`
7. (Optional) Re-ranking with LLM (not implemented in this final code for simplicity, but sketched in earlier versions).
8. Build a context window of top-k chunks and send to LLM (`gpt-4o-mini`) with an instruction to answer only using the context.
9. Return answer + list of sources (docIds + chunkIds).

For streaming, `/stream-query` (not included in tests for simplicity) can stream intermediate chunks and final answers via SSE.

## 5. Temporal Query Support

- Every chunk has `createdAt` and `doc.uploadedAt` timestamps (ISO).
- `chrono-node` is used in `/query` to interpret phrases like “last Tuesday”, “last week”, “last month” by returning a date range.
- The backend filters candidate chunks to this date window **before** scoring.
- Recency boosting favors documents from the last ~30 days to answer “recent work” questions.

## 6. Scalability and Privacy

- **Scalability**:
  - Each user’s data is stored in a separate Chroma collection, which can be sharded or moved to a cluster.
  - The ingestion worker is horizontally scalable: multiple workers can consume from the BullMQ queue.
  - LLM calls are stateless and can be scaled by adding more backend instances behind a load balancer.
- **Privacy**:
  - User separation via collection per user ID.
  - In a real system, we would:
    - Store data in a dedicated private database (Postgres/NoSQL).
    - Encrypt data at rest.
    - Support a local-first mode by running all services on-device or in a private LAN, and optionally using a local embedding model and speech model.

## 7. Frontend

- Simple React + Vite app:
  - Upload panel: file input + text input + URL input.
  - Chat panel: displays messages, queries the backend `/query` endpoint.
  - Could easily be extended to show retrieval sources, timelines, and document browsers.

## 8. Tradeoffs

- **Chroma vs Pinecone**:
  - Chroma is easier to self-host, good for local-first and prototyping.
  - Pinecone offers managed scaling and production reliability.
- **JSON metadata vs DB**:
  - JSON file is simple for a take-home, but not suitable for large-scale or concurrent writes.
  - For production, use Postgres or another durable store.
- **OpenAI APIs vs local models**:
  - OpenAI: high quality, easy integration, but external dependency and cost.
  - Local models: better privacy and latency control, but more engineering and ops overhead.

This design balances implementation complexity with clarity for a 48-hour-style take-home while demonstrating a path to production hardening.
