/**
 * SecondBrain backend v3
 * - Express API
 * - Uses Chroma via chroma_service for semantic search
 * - Enqueues ingestion jobs to BullMQ
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const bodyParser = require('body-parser');
const axios = require('axios');
const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const chrono = require('chrono-node');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) { console.error('Please set OPENAI_API_KEY'); process.exit(1); }
const CHROMA_URL = process.env.CHROMA_URL || 'http://localhost:8000';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
});
const ingestQueue = new Queue('ingest', { connection });

const app = express();
const cors = require("cors");

app.use(cors({
  origin: "http://localhost:5173",
  methods: ["GET", "POST", "DELETE"],
  allowedHeaders: ["Content-Type", "x-user-id"]
}));

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(bodyParser.json());
const upload = multer({ dest: path.join(__dirname, 'uploads') });

const STORAGE_FILE = path.join(__dirname, 'storage.json');
if (!fs.existsSync(STORAGE_FILE)) fs.writeFileSync(STORAGE_FILE, JSON.stringify({ docs: [], chunks: [], graph: {nodes:[], edges:[]}, conversations: [] }, null, 2));
function readStorage() { return JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8')); }
function writeStorage(obj) { fs.writeFileSync(STORAGE_FILE, JSON.stringify(obj, null, 2)); }

async function embedQuery(text){
  const resp = await axios.post('https://api.openai.com/v1/embeddings', { model: 'text-embedding-3-small', input:text }, { headers:{ Authorization:`Bearer ${OPENAI_KEY}` } });
  return resp.data.data[0].embedding;
}
async function openaiChat(prompt){
  const resp = await axios.post('https://api.openai.com/v1/chat/completions', { model:'gpt-4o-mini', messages:[{ role:'user', content: prompt }], temperature:0.2 }, { headers:{ Authorization:`Bearer ${OPENAI_KEY}` } });
  return resp.data.choices[0].message.content;
}
async function chromaQuery(collection, queryEmbedding, n){
  const resp = await axios.post(`${CHROMA_URL}/query`, { collection, query_embedding: queryEmbedding, n_results: n });
  return resp.data.results || [];
}

function keywordScore(q, t){
  if(!q||!t) return 0;
  const a = q.toLowerCase(), b = t.toLowerCase();
  let s = 0; let idx = b.indexOf(a);
  while(idx !== -1){ s++; idx = b.indexOf(a, idx+1); }
  return s;
}

app.get('/', (req,res)=> res.send('SecondBrain backend v3'));
app.get('/health', (req,res)=> res.json({ ok:true }));

app.post('/upload', upload.single('file'), async (req,res)=>{
  try{
    const userId = req.headers['x-user-id'] || 'demo-user';
    const docId = uuidv4(); const now = new Date().toISOString();
    let meta = { docId, userId, uploadedAt: now, processedAt: null, title: req.body.title || null, sourceType: null, originalUri: null, tags: [] };
    const storage = readStorage();
    if(req.file){
      const fname = req.file.originalname; const localPath = req.file.path;
      let sourceType='file';
      if(fname.toLowerCase().endsWith('.pdf')) sourceType='pdf';
      else if(fname.match(/\.(mp3|m4a|wav|mp4)$/)) sourceType='audio';
      else if(fname.match(/\.(png|jpe?g|webp)$/)) sourceType='image';
      meta.sourceType=sourceType; meta.originalUri=localPath; meta.filename=fname;
      if(!meta.title) meta.title = fname;
      storage.docs.push(meta); writeStorage(storage);
      await ingestQueue.add('upload_file', { jobType:'upload_file', docId, userId, localPath, filename: fname, sourceType });
      return res.json({ ok:true, docId });
    } else if(req.body.text){
      meta.sourceType='text'; meta.originalUri='inline';
      if(!meta.title) meta.title = 'Text Document';
      storage.docs.push(meta); writeStorage(storage);
      await ingestQueue.add('inline_text', { jobType:'inline_text', docId, userId, text: req.body.text });
      return res.json({ ok:true, docId });
    } else if(req.body.url){
      meta.sourceType='url'; meta.originalUri = req.body.url;
      if(!meta.title) meta.title = req.body.url;
      storage.docs.push(meta); writeStorage(storage);
      await ingestQueue.add('ingest_url', { jobType:'ingest_url', docId, userId, url: req.body.url });
      return res.json({ ok:true, docId });
    } else {
      return res.status(400).json({ error:'no file/text/url' });
    }
  } catch(e){ console.error('upload err', e); res.status(500).json({ error:'upload failed' }); }
});

app.post('/query', async (req,res)=>{
  try{
    const { userId='demo-user', query, k=6, from, to } = req.body;
    if(!query) return res.status(400).json({ error:'no query' });
    const storage = readStorage();

    let fromDate = from ? new Date(from) : null;
    let toDate = to ? new Date(to) : null;
    if(!fromDate || !toDate){
      const parsed = chrono.parse(query);
      if(parsed.length>0){
        if(parsed[0].start) fromDate = parsed[0].start.date();
        if(parsed[0].end) toDate = parsed[0].end.date();
      }
    }

    const qEmb = await embedQuery(query);
    const chromaResults = await chromaQuery(userId, qEmb, Math.max(k*3, 15));
    const now = Date.now();
    let scored = [];
    for(const r of chromaResults){
      const cid = r.id;
      const chunk = storage.chunks.find(c=>c.chunkId===cid);
      if(!chunk) continue;
      if(fromDate || toDate){
        const created = new Date(chunk.createdAt || Date.now());
        if(fromDate && created < fromDate) continue;
        if(toDate && created > toDate) continue;
      }
      const kw = keywordScore(query, chunk.text || '');
      const ageHours = (now - new Date(chunk.createdAt || now).getTime()) / (1000*60*60);
      const recencyBoost = Math.max(0, 1 - Math.min(ageHours/24/30, 1));
      const baseScore = 1 - (r.distance || 0);
      const combined = baseScore*0.85 + kw*0.15 + recencyBoost*0.1;
      scored.push({ chunkId: cid, docId: chunk.docId, text: chunk.text, score: combined });
    }
    scored.sort((a,b)=>b.score-a.score);
    const top = scored.slice(0,k);
    const ctx = top.map((t,i)=>`Source ${i+1} (doc:${t.docId}, score:${t.score.toFixed(3)}):\n${t.text}`).join('\n---\n');
    const prompt = `You are an assistant. Use only the context below to answer the question.\n\n${ctx}\n\nQuestion: ${query}`;
    const answer = await openaiChat(prompt);
    res.json({ answer, sources: top.map(t=>({docId:t.docId, chunkId:t.chunkId, score:t.score})) });
  }catch(e){ console.error('query err', e.response?.data || e.message); res.status(500).json({ error:'query failed' }); }
});

app.get('/docs', (req, res) => {
  const stored = readStorage().docs || [];
  const docs = stored.map(d => ({
    ...d,
    indexedAt: d.processedAt   // FRONTEND COMPAT FIX
  }));
  res.json(docs);
});

async function chromaDelete(collection, ids){
  try {
    const resp = await axios.post(`${CHROMA_URL}/delete`, { collection, ids });
    return resp.data;
  } catch(e) {
    console.error('Chroma delete error:', e);
    return { ok: false, error: e.message };
  }
}

app.delete('/docs/:docId', async (req, res) => {
  try {
    const { docId } = req.params;
    const userId = req.headers['x-user-id'] || 'demo-user';
    const storage = readStorage();
    
    // Find the document
    const docIndex = storage.docs.findIndex(d => d.docId === docId);
    if (docIndex === -1) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    const doc = storage.docs[docIndex];
    
    // Find all chunks associated with this document
    const chunksToDelete = storage.chunks.filter(c => c.docId === docId);
    const chunkIds = chunksToDelete.map(c => c.chunkId);
    
    // Delete from Chroma if there are chunks
    if (chunkIds.length > 0) {
      await chromaDelete(userId, chunkIds);
    }
    
    // Delete uploaded file if it exists
    if (doc.originalUri && doc.originalUri.startsWith('/') && fs.existsSync(doc.originalUri)) {
      try {
        fs.unlinkSync(doc.originalUri);
      } catch(e) {
        console.warn('Could not delete file:', doc.originalUri, e.message);
      }
    }
    
    // Remove document from storage
    storage.docs.splice(docIndex, 1);
    
    // Remove chunks from storage
    storage.chunks = storage.chunks.filter(c => c.docId !== docId);
    
    // Remove graph nodes and edges related to this document
    const docNodeId = docId;
    storage.graph.nodes = storage.graph.nodes.filter(n => n.id !== docNodeId);
    storage.graph.edges = storage.graph.edges.filter(e => e.from !== docNodeId && e.to !== docNodeId);
    
    writeStorage(storage);
    
    res.json({ ok: true, deleted: { docId, chunks: chunkIds.length } });
  } catch(e) {
    console.error('Delete error:', e);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// Chat history endpoints
app.get('/conversations', (req, res) => {
  const userId = req.headers['x-user-id'] || 'demo-user';
  const storage = readStorage();
  const conversations = (storage.conversations || []).filter(c => c.userId === userId);
  // Sort by most recent first
  conversations.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  res.json(conversations);
});

app.get('/conversations/:conversationId', (req, res) => {
  const userId = req.headers['x-user-id'] || 'demo-user';
  const { conversationId } = req.params;
  const storage = readStorage();
  const conversation = (storage.conversations || []).find(c => c.conversationId === conversationId && c.userId === userId);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  res.json(conversation);
});

app.post('/conversations', (req, res) => {
  const userId = req.headers['x-user-id'] || 'demo-user';
  const { conversationId, title, messages } = req.body;
  const storage = readStorage();
  if (!storage.conversations) storage.conversations = [];
  
  const now = new Date().toISOString();
  const existingIndex = storage.conversations.findIndex(c => c.conversationId === conversationId);
  
  if (existingIndex >= 0) {
    // Update existing conversation
    storage.conversations[existingIndex].messages = messages;
    storage.conversations[existingIndex].updatedAt = now;
    if (title) storage.conversations[existingIndex].title = title;
  } else {
    // Create new conversation
    const firstUserMessage = messages.find(m => m.role === 'user');
    const conversationTitle = title || (firstUserMessage ? firstUserMessage.content.substring(0, 50) : 'New Conversation');
    storage.conversations.push({
      conversationId,
      userId,
      title: conversationTitle,
      messages,
      createdAt: now,
      updatedAt: now
    });
  }
  
  writeStorage(storage);
  res.json({ ok: true, conversationId });
});

app.delete('/conversations/:conversationId', (req, res) => {
  const userId = req.headers['x-user-id'] || 'demo-user';
  const { conversationId } = req.params;
  const storage = readStorage();
  if (!storage.conversations) storage.conversations = [];
  
  const index = storage.conversations.findIndex(c => c.conversationId === conversationId && c.userId === userId);
  if (index === -1) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  
  storage.conversations.splice(index, 1);
  writeStorage(storage);
  res.json({ ok: true });
});


const port = process.env.PORT || 4000;
app.listen(port, ()=> console.log('Server v3 listening on', port));
