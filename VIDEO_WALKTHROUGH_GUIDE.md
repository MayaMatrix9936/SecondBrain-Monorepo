# Video Walkthrough Guide

## Overview
Create a 5-10 minute video demonstrating the SecondBrain application and explaining key architectural decisions and trade-offs.

---

## Video Structure (Suggested Timeline)

### 1. Introduction (30 seconds)
- **What to say:**
  - "Hi, I'm [Your Name], and this is SecondBrain - a multi-modal personal knowledge management system"
  - "I'll demonstrate the application and walk through key architectural decisions"

### 2. Application Demo (3-4 minutes)

#### A. Upload Different Content Types
**Show:**
1. **Upload a PDF document**
   - Drag and drop or select a PDF file
   - Show the upload success message
   - Explain: "The system accepts PDFs, which are processed asynchronously"

2. **Upload an image**
   - Upload a PNG/JPG image
   - Explain: "Images are captioned using HuggingFace BLIP model"
   - Show processing status

3. **Upload text directly**
   - Paste some text
   - Show it being ingested

4. **Upload a URL**
   - Enter a web URL
   - Explain: "The system scrapes and indexes web content"

#### B. Query the Knowledge Base
**Show:**
1. **Basic query**
   - Ask: "What did I learn about [topic from uploaded content]?"
   - Show the AI response with sources

2. **Temporal query**
   - Ask: "What did I upload last week?"
   - Explain: "The system uses chrono-node to parse natural language time expressions"

3. **Complex query**
   - Ask a multi-part question
   - Show how it retrieves relevant chunks

#### C. Document Management
**Show:**
1. **View documents list**
   - Show all uploaded documents
   - Show document types, processing status

2. **Search documents**
   - Use the search functionality
   - Filter by type

3. **Delete a document**
   - Show the delete confirmation modal
   - Explain: "Deletion removes from both vector store and metadata"

#### D. Chat History
**Show:**
1. **View conversation history**
   - Show the sidebar with past conversations
   - Load a previous conversation

2. **Start new conversation**
   - Create a new chat
   - Show conversation persistence

#### E. Dark Mode
**Show:**
- Toggle dark/light mode
- Explain: "Theme preference is saved in localStorage"

### 3. Architecture Walkthrough (4-5 minutes)

#### A. High-Level Architecture
**What to show/draw:**
```
Frontend (React) → Backend API (Express) → Worker (Background Jobs)
                                              ↓
                                    Redis Queue (BullMQ)
                                              ↓
                                    Chroma Vector Store
                                              ↓
                                    External APIs (OpenAI, HF)
```

**What to say:**
- "The system uses a microservices architecture"
- "Frontend communicates with Backend via REST API"
- "Heavy processing happens asynchronously via worker jobs"
- "Vector storage is handled by a separate Chroma service"

#### B. Multi-Modal Ingestion Pipeline
**What to explain:**
1. **Upload Flow:**
   - "When a file is uploaded, the backend stores metadata and enqueues a job"
   - "The worker processes jobs asynchronously"
   - "Different content types are transformed to text: PDFs parsed, audio transcribed, images captioned"

2. **Chunking Strategy:**
   - "Text is chunked into ~400 word segments with 15% overlap"
   - "This balances context preservation with retrieval precision"

3. **Embedding Generation:**
   - "Each chunk is converted to a 1536-dimensional vector using OpenAI's text-embedding-3-small"
   - "Vectors are stored in Chroma with metadata"

#### C. Query Processing
**What to explain:**
1. **Hybrid Retrieval:**
   - "Queries use a hybrid scoring system"
   - "85% semantic similarity, 15% keyword matching, 10% recency boost"
   - "This combines the best of vector search and traditional search"

2. **Temporal Filtering:**
   - "chrono-node parses natural language time expressions"
   - "Filters are applied before scoring for efficiency"

3. **RAG (Retrieval-Augmented Generation):**
   - "Top-k chunks are sent to GPT-4o-mini as context"
   - "The LLM generates answers based only on retrieved context"

#### D. Data Storage
**What to explain:**
1. **Vector Store (Chroma):**
   - "Per-user collections for data isolation"
   - "HNSW index for fast similarity search"
   - "DuckDB + Parquet for persistence"

2. **Metadata Store:**
   - "Currently using storage.json (prototype)"
   - "In production, would use PostgreSQL or MongoDB"
   - "Stores document metadata, chunks, and knowledge graph"

### 4. Key Architectural Decisions & Trade-offs (2-3 minutes)

#### Decision 1: Chroma vs Pinecone
**What to say:**
- **Chosen: Chroma**
  - ✅ Self-hostable, open source
  - ✅ Good for prototyping and local-first
  - ✅ No vendor lock-in
  - ❌ Less managed scaling than Pinecone
  - ❌ Smaller community

- **Trade-off:** Chose flexibility and self-hosting over managed service convenience

#### Decision 2: JSON File vs Database
**What to say:**
- **Current: storage.json**
  - ✅ Simple, no database setup needed
  - ✅ Easy to understand for prototype
  - ❌ Not concurrent-safe
  - ❌ Limited scalability

- **Production Path:** Would migrate to PostgreSQL + pgvector
- **Trade-off:** Simplicity for prototype vs production-ready infrastructure

#### Decision 3: OpenAI APIs vs Local Models
**What to say:**
- **Chosen: OpenAI APIs**
  - ✅ High quality embeddings and chat
  - ✅ Easy integration
  - ✅ Proven performance
  - ❌ External dependency
  - ❌ API costs
  - ❌ Privacy concerns

- **Trade-off:** Quality and ease of use vs privacy and cost control
- **Future:** Could migrate to local models (e.g., sentence-transformers, Ollama)

#### Decision 4: Fixed Chunking vs Semantic Chunking
**What to say:**
- **Chosen: Fixed size with sentence-aware splitting**
  - ✅ Simple implementation
  - ✅ Predictable behavior
  - ✅ Easy to tune
  - ❌ May split sentences
  - ❌ Not context-aware

- **Trade-off:** Simplicity and predictability vs more intelligent chunking

#### Decision 5: Async Processing
**What to say:**
- **Chosen: BullMQ + Redis queue**
  - ✅ Non-blocking uploads
  - ✅ Scalable worker pool
  - ✅ Job retry and failure handling
  - ✅ Can scale workers horizontally

- **Trade-off:** Added complexity vs better user experience

### 5. Scalability & Future Enhancements (1 minute)
**What to say:**
- "The system is designed for horizontal scaling"
- "Multiple workers can process jobs in parallel"
- "Per-user collections enable sharding"
- "Future: Authentication, advanced search, multi-language support"

### 6. Conclusion (30 seconds)
**What to say:**
- "This architecture balances simplicity with scalability"
- "The system demonstrates modern RAG techniques"
- "Thank you for watching!"

---

## Technical Setup for Recording

### Screen Recording Tools:
- **Windows**: OBS Studio, Windows Game Bar (Win+G), or PowerPoint Screen Recording
- **Mac**: QuickTime Player, ScreenFlow
- **Online**: Loom, Screencast-O-Matic

### Tips:
1. **Prepare beforehand:**
   - Have sample files ready (PDF, image, text)
   - Test all features before recording
   - Clear browser cache for clean demo

2. **Recording settings:**
   - Record at 1080p minimum
   - Use good microphone/headset
   - Record in quiet environment
   - Show cursor movements clearly

3. **Post-production:**
   - Add captions/subtitles if possible
   - Trim unnecessary pauses
   - Add title slide with project name
   - Add transitions between sections

---

## Key Points to Emphasize

1. **Multi-modal support** - Show different content types
2. **Async processing** - Explain why jobs are queued
3. **Hybrid retrieval** - Explain the scoring algorithm
4. **User isolation** - Explain per-user collections
5. **Trade-offs** - Be honest about limitations and why choices were made
6. **Production readiness** - Acknowledge what would need to change

---

## Sample Script Outline

### Opening (30s)
"Hi, I'm [Name]. Today I'll demonstrate SecondBrain, a multi-modal knowledge management system I built. I'll show you how it works and explain the key architectural decisions I made."

### Demo (3-4 min)
[Walk through application features as outlined above]

### Architecture (4-5 min)
"Now let me explain the architecture. The system uses a microservices approach with..."

[Explain components and data flow]

### Trade-offs (2-3 min)
"I made several important architectural decisions. Let me walk through the key trade-offs..."

[Explain decisions as outlined]

### Closing (30s)
"In summary, this architecture balances simplicity with scalability, and demonstrates modern RAG techniques. The system is ready for production with some enhancements like proper authentication and database migration. Thanks for watching!"

---

## Checklist Before Recording

- [ ] Application is running and tested
- [ ] Sample files prepared (PDF, image, text, URL)
- [ ] Browser bookmarks cleared for clean demo
- [ ] Screen recording software ready
- [ ] Microphone tested
- [ ] Script reviewed
- [ ] Architecture diagrams prepared (if drawing on screen)
- [ ] Code editor ready (if showing code)

---

## Estimated Timing

- Introduction: 30 seconds
- Application Demo: 3-4 minutes
- Architecture Explanation: 4-5 minutes
- Trade-offs Discussion: 2-3 minutes
- **Total: 10-12 minutes** (can trim to 8-10 minutes)

---

Good luck with your video! Remember to be clear, confident, and explain your reasoning behind each decision.

