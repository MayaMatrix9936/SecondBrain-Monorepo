# SecondBrain Architecture Diagrams

This file contains all the diagrams from the video walkthrough guide for easy copying.

---

## Diagram 1: High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  React Frontend (Port 5173)                               │   │
│  │  - Chat Interface                                         │   │
│  │  - Document Upload                                        │   │
│  │  - Document Management                                    │   │
│  │  - Dark Mode Support                                      │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP/REST
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      APPLICATION LAYER                          │
│  ┌──────────────────────┐         ┌──────────────────────┐     │
│  │  Backend API         │         │  Worker Service      │     │
│  │  (Port 4000)         │◄───────►│  (Background Jobs)   │     │
│  │  - Express.js         │  Redis  │  - BullMQ Consumer   │     │
│  │  - REST Endpoints     │  Queue │  - Embedding Gen     │     │
│  │  - Query Processing   │         │  - Chunk Processing  │     │
│  └──────────────────────┘         └──────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        DATA LAYER                               │
│  ┌──────────────────────┐         ┌──────────────────────┐   │
│  │  Chroma Vector Store  │         │  Redis Cache          │   │
│  │  (Port 8000)          │         │  (Port 6379)          │   │
│  │  - FastAPI Service    │         │  - Job Queue          │   │
│  │  - DuckDB + Parquet   │         │  - Caching            │   │
│  │  - Per-User Collections│         │  - Session State      │   │
│  └──────────────────────┘         └──────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Metadata Store (storage.json)                          │ │
│  │  - Document Metadata                                     │ │
│  │  - Chunk References                                       │ │
│  │  - Knowledge Graph                                       │ │
│  └──────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ API Calls
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      EXTERNAL SERVICES                           │
│  ┌──────────────────────┐         ┌──────────────────────┐   │
│  │  OpenAI API          │         │  HuggingFace API     │   │
│  │  - Embeddings        │         │  - BLIP Image        │   │
│  │  - Chat Completions  │         │    Captioning        │   │
│  │  - Whisper (Audio)   │         │                      │   │
│  └──────────────────────┘         └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Diagram 2: Ingestion Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                    INGESTION PIPELINE                           │
│                                                                 │
│  User Upload                                                    │
│      │                                                          │
│      ▼                                                          │
│  ┌─────────────┐                                               │
│  │  Backend API │                                               │
│  │  - Store     │                                               │
│  │    metadata  │                                               │
│  │  - Enqueue   │                                               │
│  │    job       │                                               │
│  └──────┬───────┘                                               │
│         │                                                        │
│         │ BullMQ Job                                            │
│         ▼                                                        │
│  ┌─────────────┐                                               │
│  │   Worker    │                                               │
│  │   Service   │                                               │
│  └──────┬───────┘                                               │
│         │                                                        │
│         ├──► PDF → pdf-parse → Text                             │
│         │                                                        │
│         ├──► Audio → Whisper API → Transcript                   │
│         │                                                        │
│         ├──► Image → BLIP API → Caption                         │
│         │                                                        │
│         ├──► URL → Cheerio → Scraped Text                       │
│         │                                                        │
│         └──► Text → Direct                                      │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────┐                                               │
│  │   Chunking  │                                               │
│  │  (~400 words│                                               │
│  │   15% overlap)│                                             │
│  └──────┬───────┘                                               │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────┐                                               │
│  │  Embedding  │                                               │
│  │  Generation │                                               │
│  │  (OpenAI)   │                                               │
│  └──────┬───────┘                                               │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────┐                                               │
│  │   Chroma    │                                               │
│  │   Storage   │                                               │
│  └─────────────┘                                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Diagram 3: Chunking Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                    CHUNKING STRATEGY                            │
│                                                                 │
│  Original Text:                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  [Paragraph 1] [Paragraph 2] [Paragraph 3] [Paragraph 4]│ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                 │
│  Chunked (400 words, 15% overlap):                             │
│  ┌──────────────────┐                                          │
│  │  Chunk 1         │  (words 1-400)                          │
│  │  [Para 1-2]      │                                          │
│  └──────────────────┘                                          │
│         │ 15% overlap                                           │
│         ▼                                                       │
│  ┌──────────────────┐                                          │
│  │  Chunk 2         │  (words 340-740)                         │
│  │  [Para 2-3]      │                                          │
│  └──────────────────┘                                          │
│         │ 15% overlap                                           │
│         ▼                                                       │
│  ┌──────────────────┐                                          │
│  │  Chunk 3         │  (words 680-1080)                        │
│  │  [Para 3-4]      │                                          │
│  └──────────────────┘                                          │
│                                                                 │
│  Each chunk → Embedding (1536 dimensions) → Chroma Vector Store│
└─────────────────────────────────────────────────────────────────┘
```

---

## Diagram 4: Query Processing Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    QUERY PROCESSING FLOW                        │
│                                                                 │
│  User Query: "What did I learn last week?"                     │
│      │                                                          │
│      ▼                                                          │
│  ┌─────────────────┐                                           │
│  │  Parse Query    │                                           │
│  │  - Extract time │                                           │
│  │  - Keywords     │                                           │
│  └──────┬──────────┘                                           │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────┐                                           │
│  │  Generate Query │                                           │
│  │  Embedding      │                                           │
│  │  (OpenAI)       │                                           │
│  └──────┬──────────┘                                           │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────┐                                           │
│  │  Vector Search  │                                           │
│  │  (Chroma)       │                                           │
│  │  - Top 15       │                                           │
│  │    candidates   │                                           │
│  └──────┬──────────┘                                           │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────┐                                           │
│  │  Temporal       │                                           │
│  │  Filtering      │                                           │
│  │  (chrono-node)  │                                           │
│  └──────┬──────────┘                                           │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────┐                                           │
│  │  Hybrid Scoring │                                           │
│  │  - 85% Semantic │                                           │
│  │  - 15% Keyword  │                                           │
│  │  - 10% Recency  │                                           │
│  └──────┬──────────┘                                           │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────┐                                           │
│  │  Top-K Chunks   │                                           │
│  │  (k=5)          │                                           │
│  └──────┬──────────┘                                           │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────┐                                           │
│  │  LLM Generation │                                           │
│  │  (GPT-4o-mini)  │                                           │
│  │  - Context      │                                           │
│  │  - Answer       │                                           │
│  └──────┬──────────┘                                           │
│         │                                                       │
│         ▼                                                       │
│  Return Answer + Sources                                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Diagram 5: Hybrid Scoring Formula

```
┌─────────────────────────────────────────────────────────────────┐
│                    HYBRID SCORING FORMULA                       │
│                                                                 │
│  Final Score = 0.85 × Semantic + 0.15 × Keyword + 0.10 × Recency│
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │  Semantic Score  │  │  Keyword Score   │  │ Recency Boost│ │
│  │  (85% weight)    │  │  (15% weight)    │  │ (10% weight) │ │
│  │                  │  │                  │  │              │ │
│  │  Cosine          │  │  Substring       │  │ Exponential  │ │
│  │  Similarity      │  │  Frequency       │  │ Decay        │ │
│  │  from Chroma     │  │  Matching        │  │ Function     │ │
│  │                  │  │                  │  │              │ │
│  │  Range: 0.0-1.0  │  │  Normalized      │  │ Favors last  │ │
│  │                  │  │                  │  │ 30 days     │ │
│  └──────────────────┘  └──────────────────┘  └──────────────┘ │
│         │                       │                    │          │
│         └───────────────────────┴────────────────────┘          │
│                            │                                    │
│                            ▼                                    │
│                    ┌──────────────┐                            │
│                    │ Final Score  │                            │
│                    │ (Sorted)     │                            │
│                    └──────────────┘                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Diagram 6: Data Storage Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    DATA STORAGE ARCHITECTURE                    │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Chroma Vector Store (Per-User Collections)                │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │ │
│  │  │ User 1       │  │ User 2       │  │ User 3       │  │ │
│  │  │ Collection   │  │ Collection   │  │ Collection   │  │ │
│  │  │              │  │              │  │              │  │ │
│  │  │ Vectors:     │  │ Vectors:     │  │ Vectors:     │  │ │
│  │  │ - Embeddings │  │ - Embeddings │  │ - Embeddings │  │ │
│  │  │ - Metadata   │  │ - Metadata   │  │ - Metadata   │  │ │
│  │  │ - Documents   │  │ - Documents   │  │ - Documents   │  │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  │ │
│  │                                                           │ │
│  │  Storage: DuckDB (metadata) + Parquet (vectors)          │ │
│  │  Index: HNSW (Hierarchical Navigable Small World)        │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Metadata Store (storage.json)                           │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │ │
│  │  │ docs[]       │  │ chunks[]     │  │ graph{}      │  │ │
│  │  │ - docId      │  │ - chunkId    │  │ - nodes[]    │  │ │
│  │  │ - userId     │  │ - docId      │  │ - edges[]    │  │ │
│  │  │ - filename   │  │ - text       │  │              │  │ │
│  │  │ - sourceType │  │ - createdAt  │  │              │  │ │
│  │  │ - uploadedAt │  │              │  │              │  │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  │ │
│  │                                                           │ │
│  │  Production: Would migrate to PostgreSQL + pgvector      │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Redis (Job Queue + Cache)                                │ │
│  │  ┌──────────────┐  ┌──────────────┐                     │ │
│  │  │ BullMQ Queue │  │ Cache Layer  │                     │ │
│  │  │ - upload_file│  │ - Frequent  │                     │ │
│  │  │ - inline_text│  │   queries   │                     │ │
│  │  │ - ingest_url │  │ - Session   │                     │ │
│  │  └──────────────┘  └──────────────┘                     │ │
│  └──────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Diagram 7: Chroma vs Pinecone Comparison

```
┌─────────────────────────────────────────────────────────────────┐
│              CHROMA vs PINECONE COMPARISON                      │
│                                                                 │
│  ┌──────────────────────┐  ┌──────────────────────┐          │
│  │  CHROMA (Chosen)      │  │  PINECONE            │          │
│  ├──────────────────────┤  ├──────────────────────┤          │
│  │ ✅ Open Source        │  │ ✅ Managed Service   │          │
│  │ ✅ Self-hostable      │  │ ✅ Auto-scaling      │          │
│  │ ✅ No vendor lock-in  │  │ ✅ Production-ready  │          │
│  │ ✅ No per-query cost  │  │ ✅ Monitoring        │          │
│  │ ✅ Local-first        │  │ ✅ Optimization     │          │
│  │                      │  │                      │          │
│  │ ❌ Less managed       │  │ ❌ Vendor lock-in    │          │
│  │ ❌ Smaller community  │  │ ❌ Higher cost       │          │
│  │ ❌ More setup         │  │ ❌ Less control      │          │
│  └──────────────────────┘  └──────────────────────┘          │
│                                                                 │
│  Trade-off: Flexibility & Cost Control vs Managed Convenience  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Diagram 8: JSON File vs Database Comparison

```
┌─────────────────────────────────────────────────────────────────┐
│          JSON FILE vs DATABASE COMPARISON                       │
│                                                                 │
│  ┌──────────────────────┐  ┌──────────────────────┐          │
│  │  storage.json        │  │  PostgreSQL          │          │
│  │  (Current)           │  │  (Production)        │          │
│  ├──────────────────────┤  ├──────────────────────┤          │
│  │ ✅ No setup needed   │  │ ✅ ACID transactions │          │
│  │ ✅ Easy to debug     │  │ ✅ Concurrent safe   │          │
│  │ ✅ Simple prototype  │  │ ✅ Scalable          │          │
│  │ ✅ Human readable    │  │ ✅ Better performance│          │
│  │                      │  │ ✅ Backup/recovery  │          │
│  │ ❌ Not concurrent    │  │                      │          │
│  │ ❌ Limited scale     │  │ ❌ More complex      │          │
│  │ ❌ No transactions   │  │ ❌ Requires setup    │          │
│  │ ❌ Data loss risk    │  │                      │          │
│  └──────────────────────┘  └──────────────────────┘          │
│                                                                 │
│  Migration Path: Clear mapping to database tables              │
└─────────────────────────────────────────────────────────────────┘
```

---

## How to Use These Diagrams

1. **Copy Individual Diagrams**: Each diagram is in its own section with clear labels
2. **Use in Presentations**: Copy and paste into slides or documents
3. **Draw on Whiteboard**: Use as reference when drawing during video
4. **Include in Documentation**: Add to your system design document

All diagrams are in ASCII format and will display correctly in any text editor or markdown viewer.

