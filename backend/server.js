/**
 * SecondBrain backend v3
 * - Express API
 * - Uses Chroma via chroma_service for semantic search
 * - Processes ingestion jobs directly (no Redis needed)
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const bodyParser = require('body-parser');
const axios = require('axios');
const FormData = require('form-data');
const pdfParse = require('pdf-parse');
const cheerio = require('cheerio');
const chrono = require('chrono-node');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) { console.error('Please set OPENAI_API_KEY'); process.exit(1); }
const CHROMA_URL = process.env.CHROMA_URL || 'http://localhost:8000';
const HF_API_TOKEN = process.env.HF_API_TOKEN;
const HF_BLIP_MODEL = process.env.HF_BLIP_MODEL || "Salesforce/blip-image-captioning-large";

const app = express();
const cors = require("cors");

app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  methods: ["GET", "POST", "DELETE"],
  allowedHeaders: ["Content-Type", "x-user-id"],
  credentials: true
}));

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(bodyParser.json());
// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
const upload = multer({ dest: uploadsDir });

const STORAGE_FILE = path.join(__dirname, 'storage.json');
if (!fs.existsSync(STORAGE_FILE)) fs.writeFileSync(STORAGE_FILE, JSON.stringify({ docs: [], chunks: [], graph: {nodes:[], edges:[]}, conversations: [] }, null, 2));
function readStorage() { return JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8')); }
function writeStorage(obj) { fs.writeFileSync(STORAGE_FILE, JSON.stringify(obj, null, 2)); }

// Worker functions (moved from worker.js)
function safeJSON(str) {
  const match = str.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); }
  catch { return null; }
}

async function embedText(text){
  const resp = await axios.post('https://api.openai.com/v1/embeddings', { model: 'text-embedding-3-small', input:text }, { headers:{ Authorization:`Bearer ${OPENAI_KEY}` } });
  return resp.data.data[0].embedding;
}

async function transcribeAudio(localPath){
  const fm = new FormData();
  fm.append('file', fs.createReadStream(localPath));
  fm.append('model','whisper-1');
  const resp = await axios.post('https://api.openai.com/v1/audio/transcriptions', fm, { headers:{ Authorization:`Bearer ${OPENAI_KEY}`, ...fm.getHeaders() }, maxContentLength:Infinity, maxBodyLength:Infinity });
  return resp.data.text;
}

async function scrapeUrl(url){
  try{
    const r = await axios.get(url);
    const $ = cheerio.load(r.data);
    let text='';
    $('p').each((i,el)=> text += $(el).text() + '\n\n');
    if(!text.trim()) text = r.data.replace(/<[^>]*>/g,' ');
    const title = $('head title').text()||url;
    return { title, text };
  }catch(e){
    console.error('scrape err', e);
    return { title:url, text:'' };
  }
}

async function blipCaptionImage(localPath){
  if(!HF_API_TOKEN) return 'Image (no BLIP token)';
  const endpoint = `https://api-inference.huggingface.co/models/${HF_BLIP_MODEL}`;
  const imageData = fs.readFileSync(localPath);
  try{
    const resp = await axios.post(endpoint, imageData, {
      headers: {
        "Authorization": `Bearer ${HF_API_TOKEN}`,
        "Content-Type": "application/octet-stream"
      }
    });
    if (Array.isArray(resp.data) && resp.data.length > 0 && resp.data[0].generated_text) {
      return resp.data[0].generated_text;
    }
    return 'Image (no caption)';
  }catch(e){
    console.error('BLIP caption error', e.response?.data || e.message);
    return 'Image (caption error)';
  }
}

async function chromaUpsert(collection, items){
  try {
    if (!CHROMA_URL || CHROMA_URL === 'http://localhost:8000') {
      console.warn('CHROMA_URL not set, skipping ChromaDB upsert');
      return;
    }
    await axios.post(`${CHROMA_URL}/upsert`, { collection, items });
  } catch (e) {
    console.error('ChromaDB upsert error:', e.message);
    // Don't throw - allow upload to succeed even if ChromaDB fails
  }
}

async function chromaDelete(collection, ids){
  try {
    if (!CHROMA_URL || CHROMA_URL === 'http://localhost:8000') {
      console.warn('CHROMA_URL not set, skipping ChromaDB delete');
      return { ok: false };
    }
    const resp = await axios.post(`${CHROMA_URL}/delete`, { collection, ids });
    return resp.data;
  } catch (e) {
    console.error('ChromaDB delete error:', e.message);
    return { ok: false, error: e.message };
  }
}

function chunkText(text, approxWords=400){
  const words = text.split(/\s+/);
  const chunks=[];
  for(let i=0;i<words.length;){
    const slice = words.slice(i, i+approxWords);
    chunks.push(slice.join(' '));
    i += approxWords - Math.floor(approxWords*0.15);
  }
  return chunks.filter(c=>c.trim().length>20);
}

async function extractEntities(text) {
  const prompt = `Extract named entities (people, organizations, projects, tags) ONLY.
Return STRICT JSON with NO explanation, NO markdown, NO extra text.

Format:
{"people":[],"orgs":[],"projects":[],"tags":[]}

Text:
${text}`;

  try {
    const resp = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        response_format: { type: "json_object" }
      },
      { headers: { Authorization: `Bearer ${OPENAI_KEY}` } }
    );
    const content = resp.data.choices[0].message.content;
    return safeJSON(content) || { people: [], orgs: [], projects: [], tags: [] };
  } catch (e) {
    console.error("entity extraction failed", e.message);
    return { people: [], orgs: [], projects: [], tags: [] };
  }
}

function graphAddNode(storage, type, id, label){
  const exists = storage.graph.nodes.find(n=>n.id===id);
  if(!exists) storage.graph.nodes.push({ id, type, label });
}
function graphAddEdge(storage, fromId, toId, rel){
  storage.graph.edges.push({ from: fromId, to: toId, rel });
}

// Process job asynchronously (no queue needed)
async function processJob(jobData) {
  const d = jobData;
  console.log('Processing job', d.jobType);
  const storage = readStorage();
  const doc = storage.docs.find(x=>x.docId===d.docId);
  const now = new Date().toISOString();
  try{
    if(d.jobType==='upload_file'){
      const { localPath, filename, sourceType } = d;
      let text = '';
      let caption = null;
      if(sourceType==='pdf'){
        const buf = fs.readFileSync(localPath);
        const p = await pdfParse(buf);
        text = p.text||'';
      } else if(sourceType==='audio'){
        text = await transcribeAudio(localPath);
      } else if(sourceType==='image'){
        caption = await blipCaptionImage(localPath);
        text = caption;
      } else {
        try{ text = fs.readFileSync(localPath,'utf8'); }catch(e){ text=''; }
      }
      const chunks = chunkText(text, 400);
      const chromaItems = [];
      for(const ch of chunks){
        const emb = await embedText(ch);
        const chunkId = uuidv4();
        storage.chunks.push({ chunkId, docId: d.docId, userId: d.userId, text: ch, createdAt: now, sourceType });
        chromaItems.push({ id: chunkId, embedding: emb, metadata: { docId: d.docId, userId: d.userId, sourceType }, document: ch });
      }
      if(caption && !chunks.length){
        const emb = await embedText(caption);
        const chunkId = uuidv4();
        storage.chunks.push({ chunkId, docId: d.docId, userId: d.userId, text: caption, createdAt: now, sourceType: 'image_caption' });
        chromaItems.push({ id: chunkId, embedding: emb, metadata: { docId:d.docId, userId:d.userId, sourceType:'image_caption' }, document: caption });
      }
      if (chromaItems.length) await chromaUpsert(d.userId, chromaItems);

      const entText = (text || '') + (caption ? ('\nCaption:'+caption) : '');
      if(entText.trim().length>50){
        const ents = await extractEntities(entText);
        const docNodeId = d.docId;
        graphAddNode(storage, 'document', docNodeId, doc ? (doc.title||docNodeId):docNodeId);
        for(const p of ents.people||[]){ const id = `person:${p}`; graphAddNode(storage,'person',id,p); graphAddEdge(storage,docNodeId,id,'mentions_person'); }
        for(const o of ents.orgs||[]){ const id = `org:${o}`; graphAddNode(storage,'org',id,o); graphAddEdge(storage,docNodeId,id,'mentions_org'); }
        for(const pr of ents.projects||[]){ const id = `project:${pr}`; graphAddNode(storage,'project',id,pr); graphAddEdge(storage,docNodeId,id,'mentions_project'); }
        for(const t of ents.tags||[]){ const id = `tag:${t}`; graphAddNode(storage,'tag',id,t); graphAddEdge(storage,docNodeId,id,'has_tag'); }
      }

      if(doc) {
        doc.processedAt = now;
        if(filename) doc.filename = filename;
        if(filename && !doc.title) doc.title = filename;
      }
      writeStorage(storage);
      return { ok:true, created: chromaItems.length };
    } else if(d.jobType==='inline_text'){
      const text = d.text||'';
      const chunks = chunkText(text, 400);
      const chromaItems=[];
      for(const ch of chunks){
        const emb = await embedText(ch);
        const chunkId = uuidv4();
        storage.chunks.push({ chunkId, docId:d.docId, userId:d.userId, text: ch, createdAt: now, sourceType:'text' });
        chromaItems.push({ id: chunkId, embedding: emb, metadata:{ docId:d.docId, userId:d.userId, sourceType:'text' }, document: ch });
      }
      if(chromaItems.length) await chromaUpsert(d.userId, chromaItems);
      const doc2 = storage.docs.find(x=>x.docId===d.docId); if(doc2) doc2.processedAt = now;
      writeStorage(storage);
      return { ok:true };
    } else if(d.jobType==='ingest_url'){
      const scraped = await scrapeUrl(d.url);
      const chunks = chunkText(scraped.text||'', 400);
      const chromaItems=[];
      for(const ch of chunks){
        const emb = await embedText(ch);
        const chunkId = uuidv4();
        storage.chunks.push({ chunkId, docId:d.docId, userId:d.userId, text: ch, createdAt: now, sourceType:'url', sourceUrl:d.url });
        chromaItems.push({ id: chunkId, embedding: emb, metadata:{ docId:d.docId, userId:d.userId, sourceType:'url', url:d.url }, document: ch });
      }
      if(chromaItems.length) await chromaUpsert(d.userId, chromaItems);
      const doc3 = storage.docs.find(x=>x.docId===d.docId); 
      if(doc3){ 
        doc3.processedAt = now; 
        doc3.title = scraped.title||doc3.title||d.url;
        if(!doc3.filename && scraped.title) doc3.filename = scraped.title;
      }
      writeStorage(storage);
      return { ok:true, created: chromaItems.length };
    }
  }catch(e){
    console.error('job processing error', e.response?.data || e.message);
    throw e;
  }
}

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
    console.log('Upload request received', { hasFile: !!req.file, hasText: !!req.body.text, hasUrl: !!req.body.url });
    const userId = req.headers['x-user-id'] || 'demo-user';
    const docId = uuidv4(); const now = new Date().toISOString();
    let meta = { docId, userId, uploadedAt: now, processedAt: null, title: req.body.title || null, sourceType: null, originalUri: null, tags: [] };
    const storage = readStorage();
    if(req.file){
      console.log('Processing file upload:', req.file.originalname);
      const fname = req.file.originalname; const localPath = req.file.path;
      let sourceType='file';
      if(fname.toLowerCase().endsWith('.pdf')) sourceType='pdf';
      else if(fname.match(/\.(mp3|m4a|wav|mp4)$/)) sourceType='audio';
      else if(fname.match(/\.(png|jpe?g|webp)$/)) sourceType='image';
      meta.sourceType=sourceType; meta.originalUri=localPath;
      storage.docs.push(meta); writeStorage(storage);
      // Process job asynchronously (no Redis needed)
      processJob({ jobType:'upload_file', docId, userId, localPath, filename: fname, sourceType }).catch(err => console.error('Job processing error:', err));
      return res.json({ ok:true, docId });
    } else if(req.body.text){
      meta.sourceType='text'; meta.originalUri='inline';
      storage.docs.push(meta); writeStorage(storage);
      // Process job asynchronously (no Redis needed)
      processJob({ jobType:'inline_text', docId, userId, text: req.body.text }).catch(err => console.error('Job processing error:', err));
      return res.json({ ok:true, docId });
    } else if(req.body.url){
      meta.sourceType='url'; meta.originalUri = req.body.url;
      storage.docs.push(meta); writeStorage(storage);
      // Process job asynchronously (no Redis needed)
      processJob({ jobType:'ingest_url', docId, userId, url: req.body.url }).catch(err => console.error('Job processing error:', err));
      return res.json({ ok:true, docId });
    } else {
      return res.status(400).json({ error:'no file/text/url' });
    }
  } catch(e){ 
    console.error('upload err', e); 
    console.error('upload error details:', e.message, e.stack);
    res.status(500).json({ error:'upload failed', details: e.message }); 
  }
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
    res.status(500).json({ error: 'Delete failed', details: e.message });
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
