# SecondBrain — Full Monorepo (Final)

This repository contains a complete prototype for a multi-modal "Second Brain" AI companion.

It includes:

- **Backend (Node.js + Express)**
  - Multi-modal ingestion: PDFs, audio (Whisper), images (BLIP captioning via Hugging Face), text, URLs.
  - Async pipeline using Redis + BullMQ worker.
  - Chroma vector store (Python FastAPI microservice).
  - Temporal querying (chrono-node).
  - Hybrid retrieval (semantic via Chroma + keyword + recency).
  - Graph-based entity relationships (simple NER via LLM).
  - Streaming SSE endpoint for chat.

- **Worker**
  - Handles ingestion jobs (upload_file, inline_text, ingest_url).
  - Chunks text, creates embeddings, upserts into Chroma.
  - Extracts entities into a simple graph in storage.json.
  - Generates captions for images using BLIP model on Hugging Face Inference API.

- **Chroma Service (Python FastAPI)**
  - Simple REST wrapper around ChromaDB.
  - Exposes `/upsert` and `/query` endpoints.
  - Uses DuckDB+Parquet for persistence.

- **Frontend (React + Vite)**
  - Minimal chat UI with streaming responses.
  - Supports uploads of files, text, URLs.
  - Lists messages and retrieved context snippets.

- **DevOps**
  - Dockerfiles for backend, frontend, and chroma_service.
  - `docker-compose.yml` to run Redis, Chroma, backend, worker, and frontend.
  - GitHub Actions CI workflow for backend tests.

- **Testing**
  - Jest + Supertest tests for backend endpoints.

- **Documentation**
  - `SYSTEM_DESIGN.md` summarizing system design (you can expand for submission).

## Quickstart (with Docker)

1. Create `.env` for backend:

   ```bash
   cd backend
   cp .env.example .env
   # Fill in:
   # OPENAI_API_KEY=sk-...
   # HF_API_TOKEN=hf_...
   ```

2. From the repo root, run:

   ```bash
   docker compose up --build
   ```

3. Services:

   - Frontend: http://localhost:5173
   - Backend: http://localhost:4000
   - Chroma service: http://localhost:8000
   - Redis: localhost:6379

## Without Docker (dev mode)

- Start Redis and Chroma separately, then:

  ```bash
  # backend
  cd backend
  npm install
  node worker.js &
  node server.js

  # frontend
  cd ../frontend
  npm install
  npm run dev
  ```

## Tests

```bash
cd backend
npm test
```

See `SYSTEM_DESIGN.md` for design details.
