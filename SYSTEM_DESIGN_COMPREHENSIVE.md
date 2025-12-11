# SecondBrain: Comprehensive System Design Document

**Version:** 2.0  
**Date:** December 2025  
**Last Updated:** December 2025  
**Author:** SecondBrain Development Team

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Overview](#2-system-overview)
3. [Architecture](#3-architecture)
4. [Component Design](#4-component-design)
5. [Data Flow & Processing](#5-data-flow--processing)
6. [Data Storage & Indexing](#6-data-storage--indexing)
7. [Query Processing & Retrieval](#7-query-processing--retrieval)
8. [Multi-Modal Ingestion Pipeline](#8-multi-modal-ingestion-pipeline)
9. [Frontend Architecture](#9-frontend-architecture)
10. [API Design](#10-api-design)
11. [Scalability & Performance](#11-scalability--performance)
12. [Security & Privacy](#12-security--privacy)
13. [Deployment Architecture](#13-deployment-architecture)
14. [Technology Stack](#14-technology-stack)
15. [Tradeoffs & Design Decisions](#15-tradeoffs--design-decisions)
16. [Future Enhancements](#16-future-enhancements)

---

## 1. Executive Summary

SecondBrain is a multi-modal personal knowledge management system that enables users to ingest, index, and query various types of content (documents, audio, images, URLs, and text) using natural language. The system leverages AI-powered semantic search, vector embeddings, and large language models to provide intelligent answers based on user's personal knowledge base.

### Key Features
- **Multi-Modal Ingestion**: Support for PDFs, audio files (MP3, M4A, WAV, MP4), images (PNG, JPG, WEBP), web URLs, and plain text
- **Semantic Search**: Vector-based retrieval using OpenAI embeddings (text-embedding-3-small)
- **Temporal Queries**: Natural language time-based filtering (e.g., "last week", "last month", "last Tuesday")
- **Hybrid Retrieval**: Combines semantic similarity (85%), keyword matching (15%), and recency scoring (10%)
- **Real-time Chat Interface**: Interactive Q&A with token-by-token streaming responses via Server-Sent Events (SSE)
- **Advanced Chat Features**: Stop streaming, regenerate responses, message timestamps, source citations with clickable links
- **User Isolation**: Per-user data separation for privacy and scalability
- **Async Processing**: Background job processing for efficient ingestion
- **Error Handling**: Graceful error handling with informative user feedback for failed processing

---

## 2. System Overview

### 2.1 High-Level Architecture

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
│  │  OpenAI API          │         │  HuggingFace API      │   │
│  │  - Embeddings         │         │  - BLIP Image         │   │
│  │  - Chat Completions   │         │    Captioning        │   │
│  │  - Whisper (Audio)    │         │                      │   │
│  └──────────────────────┘         └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 System Components

1. **Frontend Service**: React-based web application
2. **Backend API**: Express.js REST API server
3. **Worker Service**: Background job processor for ingestion
4. **Chroma Service**: Vector database microservice
5. **Redis**: Message queue and caching layer
6. **External APIs**: OpenAI and HuggingFace services

---

## 3. Architecture

### 3.1 Microservices Architecture

The system follows a microservices architecture with the following services:

```
┌─────────────┐
│  Frontend   │ React + Vite
└──────┬──────┘
       │ HTTP
       ▼
┌─────────────┐
│  Backend    │ Express.js API
└──────┬──────┘
       │
       ├──► Redis (Job Queue)
       │
       ├──► Chroma (Vector DB)
       │
       └──► Worker (Background Processing)
```

### 3.2 Service Communication

- **Frontend ↔ Backend**: REST API over HTTP
- **Backend ↔ Worker**: Redis/BullMQ message queue
- **Backend ↔ Chroma**: HTTP REST API
- **Worker ↔ External APIs**: HTTP requests (OpenAI, HuggingFace)

### 3.3 Data Flow Architecture

```
User Upload
    │
    ▼
┌─────────────────┐
│  Frontend       │
└────────┬────────┘
         │ POST /upload
         ▼
┌─────────────────┐
│  Backend API    │
│  - Store metadata│
│  - Enqueue job  │
└────────┬────────┘
         │ BullMQ Job
         ▼
┌─────────────────┐
│  Worker         │
│  - Process file │
│  - Generate     │
│    embeddings   │
└────────┬────────┘
         │
         ├──► OpenAI (Embeddings)
         ├──► Chroma (Store vectors)
         └──► storage.json (Metadata)
```

---

## 4. Component Design

### 4.1 Backend API (Express.js)

**Responsibilities:**
- Handle HTTP requests from frontend
- Manage document uploads
- Process query requests
- Manage conversations/chat history
- Coordinate with worker and Chroma services

**Key Endpoints:**
- `POST /upload` - Upload files, text, or URLs
- `POST /query` - Query the knowledge base
- `GET /docs` - List all documents
- `DELETE /docs/:docId` - Delete a document
- `GET /conversations` - List conversations
- `POST /conversations` - Create conversation
- `GET /conversations/:id` - Get conversation
- `DELETE /conversations/:id` - Delete conversation
- `GET /health` - Health check

**Technology:**
- Express.js framework
- Multer for file uploads
- BullMQ for job queuing
- Axios for HTTP requests
- chrono-node for temporal parsing

### 4.2 Worker Service

**Responsibilities:**
- Process ingestion jobs from Redis queue
- Transform multi-modal content to text
- Generate text embeddings
- Chunk text documents
- Upsert vectors to Chroma
- Extract entities for knowledge graph

**Job Types:**
1. `upload_file` - Process uploaded files (PDF, audio, images)
2. `inline_text` - Process plain text input
3. `ingest_url` - Scrape and process web URLs

**Processing Pipeline:**
```
Job Received
    │
    ▼
┌─────────────────┐
│  Read/Download  │
│  Content        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Transform to  │
│  Text          │
│  - PDF → Text  │
│  - Audio →     │
│    Transcript  │
│  - Image →     │
│    Caption     │
│  - URL →       │
│    Scraped     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Chunk Text     │
│  (~400 words,   │
│   15% overlap) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Generate       │
│  Embeddings     │
│  (OpenAI API)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Upsert to      │
│  Chroma         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Update        │
│  Metadata      │
│  (storage.json)│
└─────────────────┘
```

### 4.3 Chroma Service (Python FastAPI)

**Responsibilities:**
- Manage vector collections per user
- Store and retrieve embeddings
- Perform similarity searches
- Handle vector operations

**Endpoints:**
- `POST /upsert` - Store vectors
- `POST /query` - Search similar vectors
- `DELETE /delete` - Remove vectors

**Storage:**
- DuckDB for metadata
- Parquet files for vector storage
- Per-user collections for isolation

### 4.4 Frontend (React + Vite)

**Components:**
- `App.jsx` - Main application container
- `Chat.jsx` - Chat interface with history
- `Uploader.jsx` - File/text/URL upload
- `DocumentList.jsx` - Document management
- `DeleteConfirmModal.jsx` - Confirmation dialogs
- `Toast.jsx` - Notification system
- `ThemeContext.jsx` - Dark mode support

**Features:**
- Real-time chat interface
- Document upload (drag & drop)
- Document listing and deletion
- Chat history management
- Dark mode toggle
- Toast notifications
- Responsive design

---

## 5. Data Flow & Processing

### 5.1 Upload Flow

```
┌──────────┐
│  User   │
└────┬────┘
     │ 1. Upload File/Text/URL
     ▼
┌─────────────────┐
│   Frontend      │
│   - Validate    │
│   - Show UI     │
└────┬────────────┘
     │ 2. POST /upload
     ▼
┌─────────────────┐
│   Backend API   │
│   - Save file   │
│   - Create doc  │
│     metadata    │
│   - Enqueue job │
└────┬────────────┘
     │ 3. Return docId
     ▼
┌─────────────────┐
│   Frontend      │
│   - Show success│
│   - Update UI   │
└─────────────────┘
     │
     │ (Async)
     ▼
┌─────────────────┐
│   Worker        │
│   - Process job │
│   - Generate    │
│     embeddings  │
│   - Store in    │
│     Chroma      │
└─────────────────┘
```

### 5.2 Query Flow

```
┌──────────┐
│  User    │
│  Query   │
└────┬─────┘
     │ 1. POST /query
     ▼
┌─────────────────┐
│   Backend API   │
│   - Parse query │
│   - Extract     │
│     temporal    │
│     filters     │
└────┬────────────┘
     │ 2. Generate query embedding
     ▼
┌─────────────────┐
│   OpenAI API    │
│   Embeddings    │
└────┬────────────┘
     │ 3. Query vectors
     ▼
┌─────────────────┐
│   Chroma        │
│   - Similarity  │
│     search      │
│   - Return top  │
│     candidates  │
└────┬────────────┘
     │ 4. Hybrid scoring
     ▼
┌─────────────────┐
│   Backend API   │
│   - Filter by   │
│     time        │
│   - Keyword     │
│     score       │
│   - Recency     │
│     boost       │
│   - Combine     │
│     scores      │
└────┬────────────┘
     │ 5. Top-k chunks
     ▼
┌─────────────────┐
│   OpenAI API    │
│   Chat          │
│   Completion    │
└────┬────────────┘
     │ 6. Return answer
     ▼
┌─────────────────┐
│   Frontend      │
│   - Display     │
│     response    │
│   - Show        │
│     sources     │
└─────────────────┘
```

---

## 6. Data Storage & Indexing

### 6.1 Vector Storage (Chroma)

**Structure:**
- **Collection**: One per user (`userId`)
- **Vector ID**: Unique chunk identifier (UUID)
- **Vector**: 1536-dimensional embedding (text-embedding-3-small)
- **Document**: Original chunk text
- **Metadata**: 
  ```json
  {
    "docId": "uuid",
    "userId": "user-id",
    "sourceType": "pdf|audio|image|text|url",
    "url": "optional-url",
    "filename": "optional-filename"
  }
  ```

**Indexing:**
- HNSW (Hierarchical Navigable Small World) index for fast similarity search
- DuckDB for metadata management
- Parquet files for persistent storage

### 6.2 Metadata Store (storage.json)

**Structure:**
```json
{
  "docs": [
    {
      "docId": "uuid",
      "userId": "user-id",
      "uploadedAt": "ISO-8601",
      "processedAt": "ISO-8601",
      "title": "Document Title",
      "filename": "original-filename.pdf",
      "sourceType": "pdf",
      "originalUri": "file-path-or-url",
      "tags": []
    }
  ],
  "chunks": [
    {
      "chunkId": "uuid",
      "docId": "uuid",
      "userId": "user-id",
      "text": "chunk text content",
      "createdAt": "ISO-8601"
    }
  ],
  "graph": {
    "nodes": [
      {"id": "entity-id", "label": "Entity Name", "type": "PERSON|ORG|LOC"}
    ],
    "edges": [
      {"from": "entity-id-1", "to": "entity-id-2", "relation": "works_at"}
    ]
  },
  "conversations": [
    {
      "conversationId": "uuid",
      "userId": "user-id",
      "title": "Conversation Title",
      "createdAt": "ISO-8601",
      "updatedAt": "ISO-8601",
      "messages": [
        {"role": "user", "content": "..."},
        {"role": "assistant", "content": "..."}
      ]
    }
  ]
}
```

**Production Migration:**
- Replace with PostgreSQL + pgvector
- Or MongoDB with vector search
- Add proper indexing and transactions

### 6.3 Chunking Strategy

**Parameters:**
- **Chunk Size**: ~400 words
- **Overlap**: 15% (60 words)
- **Method**: Sentence-aware splitting

**Rationale:**
- Balances context preservation with retrieval precision
- Overlap ensures continuity across chunk boundaries
- Sentence-aware prevents mid-sentence splits

---

## 7. Query Processing & Retrieval

### 7.1 Hybrid Retrieval Algorithm

**Score Calculation:**
```
final_score = 0.85 * semantic_score 
            + 0.15 * keyword_score 
            + 0.10 * recency_boost
```

**Components:**

1. **Semantic Score** (85% weight)
   - Cosine similarity from Chroma
   - Range: 0.0 to 1.0

2. **Keyword Score** (15% weight)
   - Substring frequency matching
   - Normalized by query length

3. **Recency Boost** (10% weight)
   - Exponential decay: `exp(-days_old / 30)`
   - Favors documents from last 30 days

### 7.2 Temporal Query Processing

**Natural Language Parsing:**
- Uses `chrono-node` library
- Examples:
  - "last Tuesday" → date range
  - "last week" → 7-day window
  - "last month" → 30-day window
  - "in 2024" → year range

**Filtering:**
- Temporal filters applied before scoring
- Reduces candidate set for efficiency
- Preserves accuracy for time-sensitive queries

### 7.3 RAG (Retrieval-Augmented Generation)

**Context Building:**
1. Retrieve top-k chunks (default: 6, retrieves 3x for scoring)
2. Apply hybrid scoring (semantic + keyword + recency)
3. Filter out error chunks and apply temporal filters
4. Deduplicate sources by document (keep highest scoring reference per document)
5. Combine into context window
6. Add system prompt with instructions
7. Send to LLM (gpt-4o-mini) with streaming support
8. Return answer with source citations (including document metadata)

**Streaming Implementation:**
- Uses Server-Sent Events (SSE) for real-time token delivery
- Backend streams OpenAI response token-by-token via `openaiChatStream()` generator
- Frontend receives chunks via `ReadableStream` API
- Updates UI progressively as tokens arrive (word-by-word display)
- Supports cancellation via `AbortController` (stop button)
- Message types: `sources` (sent first), `chunk` (streamed), `done` (completion), `error` (errors)

**Source Citations:**
- Includes document metadata (filename, originalUri, sourceType)
- Deduplicated by document ID (each document appears once, highest score kept)
- Clickable links for URLs (open in new tab)
- Visual badges with document names
- Source count display

**Prompt Template:**
```
You are a helpful assistant. Answer the user's question based ONLY on the provided context.

Context:
Source 1 (doc:{docId}, score:{score}):
[Chunk 1]
---
Source 2 (doc:{docId}, score:{score}):
[Chunk 2]
...

Question: {user_query}

Answer:
```

---

## 8. Multi-Modal Ingestion Pipeline

### 8.1 Supported Modalities

#### PDF Documents
- **Parser**: `pdf-parse` library
- **Output**: Plain text extraction
- **Limitations**: No images, tables, or complex layouts

#### Audio Files
- **Formats**: MP3, M4A, WAV, MP4
- **Service**: OpenAI Whisper API
- **Endpoint**: `/v1/audio/transcriptions`
- **Output**: Transcript text

#### Images
- **Formats**: PNG, JPG, JPEG, WEBP
- **Service**: HuggingFace BLIP model
- **Model**: `Salesforce/blip-image-captioning-large`
- **Output**: Descriptive caption text

#### Web URLs
- **Parser**: `cheerio` (server-side HTML parsing)
- **Extraction**: Text from multiple elements (`<p>`, `<h1-h6>`, `<article>`, etc.)
- **Features**: 
  - Authentication detection (identifies login-required pages)
  - YouTube URL detection and metadata creation
  - Proper headers to avoid blocking
  - Metadata chunk creation for failed URLs (ensures searchability)
- **Output**: Scraped article text or metadata for searchable URLs

#### Plain Text
- **Processing**: Direct ingestion
- **Output**: Text as-is

### 8.2 Processing Pipeline

```
Input (File/Text/URL)
    │
    ▼
┌─────────────────┐
│  Detect Type    │
│  (MIME/extension)│
└────────┬────────┘
         │
         ├──► PDF → pdf-parse → Text
         │
         ├──► Audio → Whisper API → Transcript
         │    (with filename handling, error recovery)
         │
         ├──► Image → OpenAI Vision API → Caption
         │    (with base64 encoding, detailed descriptions)
         │
         ├──► URL → Cheerio → Scraped Text
         │    (with auth detection, metadata fallback)
         │
         └──► Text → Direct
         │
         ▼
┌─────────────────┐
│  Chunk Text     │
│  (400 words,    │
│   15% overlap)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Generate       │
│  Embeddings     │
│  (OpenAI)       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Store in       │
│  Chroma         │
└─────────────────┘
```

---

## 9. Frontend Architecture

### 9.1 Component Hierarchy

```
App
├── ThemeProvider
│   └── ToastProvider
│       └── AppContent
│           ├── Header (with dark mode toggle)
│           ├── Tab Navigation
│           ├── Chat Tab
│           │   └── Chat Component
│           │       ├── Conversation Sidebar
│           │       ├── Message List
│           │       └── Input Form
│           ├── Upload Tab
│           │   └── Uploader Component
│           └── Documents Tab
│               └── DocumentList Component
└── ToastContainer
```

### 9.2 State Management

- **React Hooks**: `useState`, `useEffect`
- **Context API**: Theme and Toast contexts
- **Local Storage**: Theme preference, conversation history

### 9.3 Key Features

1. **Chat Interface**
   - Real-time streaming responses (token-by-token via SSE)
   - Stop/Cancel streaming button during generation
   - Regenerate response button (hover on last AI message)
   - Message timestamps with relative time display ("Just now", "5m ago", "2h ago")
   - Copy message button (hover to reveal)
   - Source citations with clickable document links
   - Auto-scroll during streaming
   - Input disabled during response generation (prevents multiple submissions)
   - Conversation history with search
   - New conversation creation

2. **Dark Mode**
   - System preference detection
   - Manual toggle
   - Persistent storage

3. **Chat History**
   - Conversation list
   - Search functionality
   - Delete conversations

4. **Document Management**
   - List all documents
   - Search documents
   - Delete documents
   - Show processing status

5. **Upload Interface**
   - Drag & drop support
   - Multiple input types
   - Progress feedback

---

## 10. API Design

### 10.1 REST Endpoints

#### Upload Endpoint
```
POST /upload
Content-Type: multipart/form-data

Body:
- file: File (optional)
- text: String (optional)
- url: String (optional)
- title: String (optional)

Response:
{
  "ok": true,
  "docId": "uuid"
}
```

#### Query Endpoint
```
POST /query
Content-Type: application/json

Body:
{
  "query": "What did I learn last week?",
  "userId": "demo-user" (optional, default: "demo-user"),
  "k": 6 (optional, default: 6),
  "from": "ISO-8601 date" (optional),
  "to": "ISO-8601 date" (optional),
  "stream": true (optional, enables streaming)
}

Response (Non-streaming):
{
  "answer": "Based on your documents...",
  "sources": [
    {
      "docId": "uuid",
      "chunkId": "uuid",
      "score": 0.95,
      "filename": "document.pdf",
      "originalUri": "/app/uploads/file.pdf",
      "sourceType": "pdf"
    }
  ]
}

Response (Streaming):
Content-Type: text/event-stream

data: {"type": "sources", "data": [{"docId": "...", "filename": "...", ...}]}
data: {"type": "chunk", "data": "token"}
data: {"type": "chunk", "data": " token"}
...
data: {"type": "done", "data": "Full response text"}
```

#### Document Management
```
GET /docs
Response: Array of document objects

DELETE /docs/:docId
Response: { "ok": true }
```

#### Conversation Management
```
GET /conversations
Response: Array of conversation objects

POST /conversations
Body: { "title": "New Chat" }
Response: Conversation object

GET /conversations/:id
Response: Conversation object with messages

DELETE /conversations/:id
Response: { "ok": true }
```

### 10.2 Error Handling

**Standard Error Response:**
```json
{
  "error": "Error message",
  "code": "ERROR_CODE" (optional)
}
```

**HTTP Status Codes:**
- `200` - Success
- `400` - Bad Request
- `404` - Not Found
- `500` - Internal Server Error

---

## 11. Scalability & Performance

### 11.1 Horizontal Scaling

**Backend API:**
- Stateless design enables multiple instances
- Load balancer required for distribution
- Shared Redis for session state

**Worker Service:**
- Multiple workers can consume from same queue
- BullMQ handles job distribution
- Auto-scaling based on queue depth

**Chroma Service:**
- Per-user collections enable sharding
- Can deploy multiple instances
- Load balancer for distribution

### 11.2 Performance Optimizations

1. **Caching**
   - Redis for frequently accessed data
   - Embedding cache for repeated queries
   - Frontend caching for static assets

2. **Async Processing**
   - Non-blocking ingestion via job queue
   - Immediate response to uploads
   - Background processing

3. **Vector Search**
   - HNSW index for fast similarity search
   - Approximate nearest neighbor (ANN)
   - Configurable search parameters

4. **Chunking Strategy**
   - Optimal chunk size for retrieval
   - Overlap for context preservation
   - Sentence-aware splitting

### 11.3 Capacity Planning

**Estimated Capacity (per instance):**
- **Documents**: 10,000+ per user
- **Chunks**: 100,000+ per user
- **Queries**: 100+ per second
- **Storage**: ~1GB per 10,000 documents

**Scaling Triggers:**
- Queue depth > 1000 jobs
- Response time > 2 seconds
- CPU usage > 70%
- Memory usage > 80%

---

## 12. Security & Privacy

### 12.1 Data Isolation

- **Per-User Collections**: Chroma collections scoped by userId
- **Metadata Filtering**: All queries filtered by userId
- **No Cross-User Access**: Strict isolation enforced

### 12.2 Authentication & Authorization

**Current Implementation:**
- Header-based user identification (`x-user-id`)
- No authentication (prototype)

**Production Requirements:**
- JWT-based authentication
- OAuth2 integration
- Role-based access control (RBAC)
- API key management

### 12.3 Data Protection

**At Rest:**
- Encryption for sensitive data
- Secure key management
- Database encryption

**In Transit:**
- HTTPS/TLS for all communications
- Secure WebSocket for streaming
- API authentication tokens

### 12.4 Privacy Considerations

1. **Data Minimization**: Only store necessary data
2. **User Control**: Delete functionality for all data
3. **Audit Logging**: Track data access
4. **Compliance**: GDPR, CCPA considerations

---

## 13. Deployment Architecture

### 13.1 Docker Compose Setup

**Services:**
```yaml
services:
  redis:      # Message queue & cache
  chroma:     # Vector database
  backend:    # API server
  worker:     # Background processor
  frontend:   # Web application
```

**Volumes:**
- `chroma_data`: Persistent vector storage
- `backend_data`: Application data
- `uploads`: User-uploaded files

### 13.2 Production Deployment

**Recommended Architecture:**
```
┌─────────────────────────────────────────┐
│         Load Balancer (NGINX)           │
└──────────────┬──────────────────────────┘
               │
       ┌───────┴───────┐
       │               │
┌──────▼──────┐  ┌─────▼──────┐
│  Frontend   │  │  Backend   │
│  (CDN)      │  │  (K8s)     │
└─────────────┘  └─────┬──────┘
                       │
        ┌──────────────┼──────────────┐
        │              │               │
┌───────▼────┐  ┌──────▼─────┐  ┌─────▼─────┐
│   Redis    │  │   Chroma   │  │  Workers  │
│  Cluster   │  │  Cluster   │  │  (K8s)    │
└────────────┘  └────────────┘  └───────────┘
```

**Infrastructure:**
- Kubernetes for orchestration
- Managed databases (Redis, PostgreSQL)
- CDN for frontend assets
- Monitoring and logging (Prometheus, Grafana)

---

## 14. Technology Stack

### 14.1 Backend

- **Runtime**: Node.js 20+
- **Framework**: Express.js
- **Queue**: BullMQ
- **Cache**: Redis
- **File Upload**: Multer
- **HTTP Client**: Axios
- **Date Parsing**: chrono-node
- **UUID**: uuid

### 14.2 Frontend

- **Framework**: React 18+
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **HTTP Client**: Axios
- **State Management**: React Context API

### 14.3 Vector Database

- **Service**: ChromaDB
- **API**: FastAPI (Python)
- **Storage**: DuckDB + Parquet
- **Index**: HNSW

### 14.4 External Services

- **Embeddings**: OpenAI text-embedding-3-small
- **Chat**: OpenAI gpt-4o-mini
- **Audio**: OpenAI Whisper
- **Images**: HuggingFace BLIP

---

## 15. Tradeoffs & Design Decisions

### 15.1 Vector Database: Chroma vs Pinecone

**Chroma (Chosen)**
- ✅ Self-hostable
- ✅ Open source
- ✅ Good for prototyping
- ✅ Local-first capability
- ❌ Less managed scaling
- ❌ Smaller community

**Pinecone (Alternative)**
- ✅ Managed service
- ✅ Production-ready scaling
- ✅ Better performance at scale
- ❌ Vendor lock-in
- ❌ Higher cost

**Decision**: Chroma chosen for flexibility and self-hosting capability.

### 15.2 Metadata Storage: JSON vs Database

**JSON File (Current)**
- ✅ Simple implementation
- ✅ Easy to understand
- ✅ No database setup
- ❌ Not concurrent-safe
- ❌ Limited scalability
- ❌ No transactions

**Database (Production)**
- ✅ ACID transactions
- ✅ Concurrent access
- ✅ Better performance
- ✅ Scalability
- ❌ More complexity
- ❌ Additional infrastructure

**Decision**: JSON for prototype, database for production.

### 15.3 Embedding Model: OpenAI vs Local

**OpenAI (Chosen)**
- ✅ High quality embeddings
- ✅ Easy integration
- ✅ Proven performance
- ❌ External dependency
- ❌ API costs
- ❌ Privacy concerns

**Local Models (Alternative)**
- ✅ Privacy
- ✅ No API costs
- ✅ Offline capability
- ❌ Lower quality
- ❌ More infrastructure
- ❌ Maintenance overhead

**Decision**: OpenAI for quality and simplicity, with path to local models.

### 15.4 Chunking Strategy

**Fixed Size (Chosen)**
- ✅ Simple implementation
- ✅ Predictable behavior
- ✅ Easy to tune
- ❌ May split sentences
- ❌ Not context-aware

**Semantic Chunking (Alternative)**
- ✅ Better context preservation
- ✅ More intelligent splits
- ❌ More complex
- ❌ Slower processing

**Decision**: Fixed size with sentence-aware splitting for balance.

---

## 16. Future Enhancements

### 16.1 Short-Term (3-6 months)

1. **Authentication System**
   - JWT-based auth
   - User registration/login
   - Password reset

2. **Enhanced Search**
   - Faceted search
   - Advanced filters
   - Saved searches

3. **UI Improvements**
   - Source highlighting
   - Document preview
   - Export functionality

4. **Performance**
   - Response caching
   - Query optimization
   - Batch processing

### 16.2 Medium-Term (6-12 months)

1. **Advanced Features**
   - Multi-language support
   - Document versioning
   - Collaborative features
   - Real-time sync

2. **Analytics**
   - Usage analytics
   - Query insights
   - Document statistics

3. **Integration**
   - API for third-party apps
   - Webhooks
   - Import from other services

### 16.3 Long-Term (12+ months)

1. **AI Enhancements**
   - Fine-tuned models
   - Custom embeddings
   - Advanced RAG techniques

2. **Scalability**
   - Multi-region deployment
   - Edge computing
   - Advanced caching

3. **Enterprise Features**
   - Team workspaces
   - Advanced permissions
   - Audit logging
   - Compliance tools

---

## Appendix A: System Diagrams

### A.1 Complete System Architecture

```
                    ┌─────────────────────┐
                    │   Internet Users    │
                    └──────────┬──────────┘
                               │ HTTPS
                               ▼
                    ┌─────────────────────┐
                    │   Load Balancer     │
                    │      (NGINX)        │
                    └──────────┬──────────┘
                               │
                ┌──────────────┴──────────────┐
                │                             │
        ┌───────▼────────┐          ┌────────▼───────┐
        │   Frontend     │          │    Backend      │
        │   (React)      │          │   (Express)     │
        │   Port 5173    │          │   Port 4000     │
        └───────────────┘          └────────┬────────┘
                                             │
                    ┌────────────────────────┼────────────────────────┐
                    │                        │                        │
        ┌───────────▼────────┐   ┌──────────▼────────┐   ┌──────────▼────────┐
        │      Redis         │   │     Chroma        │   │     Worker        │
        │   (Port 6379)     │   │   (Port 8000)      │   │  (Background)     │
        │   - Job Queue     │   │   - Vector DB     │   │  - Processing     │
        │   - Cache         │   │   - Collections   │   │  - Embeddings     │
        └───────────────────┘   └───────────────────┘   └───────────────────┘
                                             │
                                             │
                    ┌────────────────────────┼────────────────────────┐
                    │                        │                        │
        ┌───────────▼────────┐   ┌──────────▼────────┐   ┌──────────▼────────┐
        │    OpenAI API      │   │  HuggingFace API  │   │   File Storage    │
        │  - Embeddings      │   │  - BLIP Caption   │   │   - Uploads        │
        │  - Chat            │   │                   │   │   - Metadata      │
        │  - Whisper         │   │                   │   │                   │
        └────────────────────┘   └───────────────────┘   └───────────────────┘
```

### A.2 Data Flow Diagram

```
┌────────────┐
│   User    │
└─────┬──────┘
      │ 1. Upload
      ▼
┌────────────┐     2. POST /upload      ┌────────────┐
│  Frontend  │─────────────────────────►│  Backend   │
│            │                           │            │
│            │◄──────────────────────────│            │
│            │     3. {docId}           │            │
└────────────┘                           └─────┬──────┘
                                               │ 4. Enqueue
                                               ▼
                                        ┌────────────┐
                                        │   Redis    │
                                        │   Queue    │
                                        └─────┬──────┘
                                              │ 5. Job
                                              ▼
                                        ┌────────────┐
                                        │   Worker   │
                                        │            │
                                        │ 6. Process │
                                        │ 7. Embed   │
                                        └─────┬──────┘
                                              │ 8. Store
                                              ▼
                                        ┌────────────┐
                                        │   Chroma   │
                                        │   Vector   │
                                        │    Store   │
                                        └────────────┘
```

### A.3 Query Processing Flow

```
┌────────────┐
│   Query    │
└─────┬──────┘
      │
      ▼
┌─────────────────┐
│  Parse Query    │
│  - Extract time │
│  - Keywords     │
└─────┬───────────┘
      │
      ▼
┌─────────────────┐
│  Generate       │
│  Embedding      │
│  (OpenAI)       │
└─────┬───────────┘
      │
      ▼
┌─────────────────┐
│  Vector Search  │
│  (Chroma)       │
│  - Top 3k       │
└─────┬───────────┘
      │
      ▼
┌─────────────────┐
│  Hybrid Scoring │
│  - Semantic     │
│  - Keyword      │
│  - Recency      │
└─────┬───────────┘
      │
      ▼
┌─────────────────┐
│  Top-K Chunks   │
│  (k=5)          │
└─────┬───────────┘
      │
      ▼
┌─────────────────┐
│  LLM Generation │
│  (OpenAI)       │
│  - Context      │
│  - Answer       │
└─────┬───────────┘
      │
      ▼
┌─────────────────┐
│  Return Answer  │
│  + Sources      │
└─────────────────┘
```

---

## Appendix B: API Reference

### B.1 Complete Endpoint List

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/health` | Health check | No |
| POST | `/upload` | Upload file/text/URL | Yes |
| POST | `/query` | Query knowledge base | Yes |
| GET | `/docs` | List documents | Yes |
| DELETE | `/docs/:docId` | Delete document | Yes |
| GET | `/conversations` | List conversations | Yes |
| POST | `/conversations` | Create conversation | Yes |
| GET | `/conversations/:id` | Get conversation | Yes |
| DELETE | `/conversations/:id` | Delete conversation | Yes |

### B.2 Request/Response Examples

See detailed examples in API documentation.

---

## Conclusion

This system design document provides a comprehensive overview of the SecondBrain architecture, covering all aspects from high-level design to implementation details. The system is designed to be scalable, maintainable, and extensible, with clear paths for production deployment and future enhancements.

For questions or clarifications, please refer to the codebase or contact the development team.

---

**Document Version:** 2.0  
**Last Updated:** December 2025  
**Status:** Final

---

## Recent Updates (Version 2.0)

### Streaming Responses Implementation
- **Token-by-token streaming** via Server-Sent Events (SSE)
- Real-time UI updates as tokens arrive from OpenAI
- **Stop/Cancel functionality** during generation using AbortController
- Progressive message display for better user experience
- Frontend uses `ReadableStream` API for parsing SSE events

### Enhanced Source Citations
- **Document metadata** included in sources (filename, originalUri, sourceType)
- **Deduplication** by document ID (each document appears once, highest score kept)
- **Clickable links** for URLs (open in new tab)
- **Visual badges** with document names instead of just counts
- Sources sent first in streaming, then content chunks

### Improved Multi-Modal Processing

#### Audio Processing
- OpenAI Whisper API with explicit filename handling
- File buffer-based transmission with proper content-type headers
- 5-minute timeout for long audio files
- Comprehensive error handling and logging

#### Image Processing
- **OpenAI Vision API** (replaced HuggingFace BLIP due to API deprecation)
- Base64 encoding for image transmission
- Detailed image descriptions (text, objects, people, settings, colors, activities)
- 60-second timeout for Vision API calls
- Graceful fallback handling

#### URL Processing
- Enhanced scraping with authentication detection
- YouTube URL detection and metadata creation
- Metadata chunk creation for failed URLs (ensures searchability)
- Better error messages for user feedback

### Chat Interface Features
- **Regenerate response** button (hover on last AI message)
- **Message timestamps** with relative time display ("Just now", "5m ago", "2h ago")
- **Auto-scroll improvements** during streaming
- **Input disabled** during response generation (prevents multiple submissions)
- **Copy message** functionality
- Better error handling and user feedback

### Error Handling Improvements
- Graceful handling of failed processing (images, URLs, audio)
- Informative error messages for users
- Processing error tracking in document metadata
- Filtering of error chunks from search results
- Specific AI responses for failed processing scenarios

