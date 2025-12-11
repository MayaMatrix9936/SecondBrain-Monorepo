# SecondBrain - Multi-Modal Knowledge Management System

A comprehensive AI-powered personal knowledge management system that enables users to ingest, index, and query various types of content (documents, audio, images, URLs, and text) using natural language.

## 🚀 Features

- **Multi-Modal Ingestion**: Support for PDFs, audio files (MP3, M4A, WAV), images (PNG, JPG, WEBP), web URLs, and plain text
- **Semantic Search**: Vector-based retrieval using OpenAI embeddings for intelligent document search
- **Temporal Queries**: Natural language time-based filtering (e.g., "last week", "last month")
- **Hybrid Retrieval**: Combines semantic similarity, keyword matching, and recency scoring
- **Real-time Chat Interface**: Interactive Q&A with streaming responses
- **Chat History**: Save and manage conversation history
- **Document Management**: Upload, view, search, and delete documents
- **Dark Mode**: Beautiful dark/light theme support
- **User Isolation**: Per-user data separation for privacy and scalability
- **Async Processing**: Background job queue for efficient ingestion

## 📋 Prerequisites

- Docker and Docker Compose
- Node.js 18+ (for local development)
- Python 3.8+ (for Chroma service)
- OpenAI API Key
- HuggingFace API Token (for image captioning)

## 🛠️ Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/MayaMatrix9936/SecondBrain-Monorepo.git
cd SecondBrain-Monorepo
```

### 2. Configure Environment Variables

Create a `.env` file in the `backend` directory:

```bash
cd backend
cp .env.example .env  # If .env.example exists
```

Add your API keys:

```env
OPENAI_API_KEY=sk-your-openai-api-key
HF_API_TOKEN=your-huggingface-token
```

### 3. Start with Docker Compose

From the repository root:

```bash
docker compose up --build
```

This will start all services:
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:4000
- **Chroma Service**: http://localhost:8000
- **Redis**: localhost:6379

### 4. Access the Application

Open your browser and navigate to: **http://localhost:5173**

## 📁 Project Structure

```
SecondBrain-Monorepo/
├── backend/              # Node.js Express API
│   ├── server.js        # Main API server
│   ├── worker.js        # Background job processor
│   ├── package.json
│   └── uploads/         # Uploaded files storage
├── frontend/            # React + Vite application
│   ├── src/
│   │   ├── components/  # React components
│   │   ├── contexts/    # React contexts (Theme, Toast)
│   │   └── App.jsx      # Main app component
│   └── package.json
├── chroma_service/      # Python FastAPI vector DB service
│   ├── app.py           # Chroma API wrapper
│   └── requirements.txt
├── docker-compose.yml   # Docker orchestration
└── README.md           # This file
```

## 🏗️ Architecture

### Components

1. **Frontend (React + Vite)**
   - Modern React application with Tailwind CSS
   - Dark mode support
   - Real-time chat interface
   - Document management UI

2. **Backend API (Express.js)**
   - RESTful API endpoints
   - File upload handling
   - Query processing with hybrid retrieval
   - Conversation management

3. **Worker Service**
   - Processes ingestion jobs asynchronously
   - Multi-modal content transformation
   - Embedding generation
   - Vector storage

4. **Chroma Service (Python FastAPI)**
   - Vector database microservice
   - Per-user collections
   - Similarity search

5. **Redis**
   - Job queue (BullMQ)
   - Caching layer

### Data Flow

```
User Upload → Backend API → Redis Queue → Worker
                                         ↓
                                    Process & Embed
                                         ↓
                                    Chroma Vector Store
                                         ↓
User Query → Backend API → Chroma Search → Hybrid Scoring → LLM → Response
```

## 🔌 API Endpoints

### Upload
- `POST /upload` - Upload files, text, or URLs

### Query
- `POST /query` - Query the knowledge base

### Documents
- `GET /docs` - List all documents
- `DELETE /docs/:docId` - Delete a document

### Conversations
- `GET /conversations` - List conversations
- `POST /conversations` - Create conversation
- `GET /conversations/:id` - Get conversation
- `DELETE /conversations/:id` - Delete conversation

### Health
- `GET /health` - Health check

## 🧪 Development

### Without Docker

1. **Start Redis and Chroma**:
   ```bash
   # Redis
   redis-server

   # Chroma (in chroma_service directory)
   pip install -r requirements.txt
   uvicorn app:app --host 0.0.0.0 --port 8000
   ```

2. **Start Backend**:
   ```bash
   cd backend
   npm install
   node worker.js &  # Background worker
   node server.js    # API server
   ```

3. **Start Frontend**:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

## 📚 Documentation

- **System Design**: See [SYSTEM_DESIGN_COMPREHENSIVE.md](./SYSTEM_DESIGN_COMPREHENSIVE.md) for detailed architecture documentation

## 🔒 Security & Privacy

- User data is isolated per user ID
- All API communications should use HTTPS in production
- Sensitive files (storage.json, uploads) are excluded from Git
- API keys should never be committed to the repository

## 🚀 Deployment

### Production Considerations

1. **Environment Variables**: Use secure secret management
2. **Database**: Replace `storage.json` with PostgreSQL or MongoDB
3. **HTTPS**: Use reverse proxy (NGINX) with SSL certificates
4. **Authentication**: Implement JWT-based authentication
5. **Scaling**: Use Kubernetes or Docker Swarm for orchestration
6. **Monitoring**: Add logging and monitoring (Prometheus, Grafana)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is private and proprietary.

## 👥 Authors

- MayaMatrix9936

## 🙏 Acknowledgments

- OpenAI for embeddings and chat APIs
- HuggingFace for BLIP image captioning
- ChromaDB for vector storage
- React and Vite communities

## 📞 Support

For issues and questions, please open an issue on GitHub.

---

**Version:** 1.0  
**Last Updated:** December 2025

