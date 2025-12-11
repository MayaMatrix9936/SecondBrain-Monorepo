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
    // Add proper headers to avoid being blocked
    const r = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 10000, // 10 second timeout
      maxRedirects: 5,
      validateStatus: function (status) {
        return status >= 200 && status < 400; // Accept 2xx and 3xx
      }
    });
    const $ = cheerio.load(r.data);
    
    // Check for common authentication/login page indicators
    const bodyText = $('body').text().toLowerCase();
    const hasLoginIndicators = /sign in|log in|login|authentication required|please log in|access denied|unauthorized/i.test(bodyText) ||
                                $('input[type="password"]').length > 0 ||
                                $('form[action*="login"], form[action*="signin"], form[action*="auth"]').length > 0;
    
    // Check if we got mostly scripts/tracking code (like Google Tag Manager)
    const scriptCount = $('script').length;
    const hasMinimalContent = bodyText.trim().length < 200;
    const isMostlyScripts = scriptCount > 5 && hasMinimalContent;
    
    // Check for dashboard URLs that likely require auth
    const isDashboardUrl = /dashboard|admin|console|portal/i.test(url);
    
    if(hasLoginIndicators || (isDashboardUrl && isMostlyScripts)) {
      throw new Error('URL requires authentication. Dashboard and admin pages typically require login to access content.');
    }
    
    let text='';
    // Extract text from various elements
    $('p, article, main, .content, .post, .article, section').each((i,el)=> {
      const txt = $(el).text().trim();
      if(txt.length > 20) text += txt + '\n\n';
    });
    // Fallback: extract all text if no paragraphs found
    if(!text.trim()) {
      // Remove script and style elements
      $('script, style, nav, header, footer, iframe').remove();
      text = $('body').text().replace(/\s+/g, ' ').trim();
    }
    
    // Check if extracted text is mostly tracking/script content
    if(text.toLowerCase().includes('googletagmanager') && text.length < 500) {
      throw new Error('URL appears to be a login page or requires authentication. Only tracking scripts were found.');
    }
    
    const title = $('head title').text() || $('h1').first().text() || url;
    // Clean up text
    text = text.replace(/\s+/g, ' ').trim();
    
    if(!text || text.length < 10) {
      throw new Error('No meaningful content extracted from URL');
    }
    
    return { title: title.trim() || url, text };
  }catch(e){
    console.error('scrape err', e.message || e);
    // Return a more informative error message instead of empty text
    const errorMsg = `Failed to scrape URL: ${e.message || 'Unknown error'}. The URL may require authentication, JavaScript rendering, or may be inaccessible.`;
    return { title: url, text: errorMsg };
  }
}

async function blipCaptionImage(localPath){
  if(!HF_API_TOKEN) {
    console.warn('HF_API_TOKEN not set, cannot generate image captions');
    return null; // Return null instead of error message to avoid storing error text
  }
  const endpoint = `https://api-inference.huggingface.co/models/${HF_BLIP_MODEL}`;
  const imageData = fs.readFileSync(localPath);
  try{
    const resp = await axios.post(endpoint, imageData, {
      headers: {
        "Authorization": `Bearer ${HF_API_TOKEN}`,
        "Content-Type": "application/octet-stream"
      },
      timeout: 30000 // 30 second timeout for model inference
    });
    
    // Handle different response formats
    if (Array.isArray(resp.data) && resp.data.length > 0) {
      if (resp.data[0].generated_text) {
        return resp.data[0].generated_text;
      }
      // Sometimes the response is nested differently
      if (resp.data[0].label || resp.data[0].text) {
        return resp.data[0].label || resp.data[0].text;
      }
    }
    
    // Handle single object response
    if (resp.data.generated_text) {
      return resp.data.generated_text;
    }
    
    // If model is loading, wait and retry
    if (resp.data.error && resp.data.error.includes('loading')) {
      console.log('Model is loading, waiting 10 seconds...');
      await new Promise(resolve => setTimeout(resolve, 10000));
      // Retry once
      const retryResp = await axios.post(endpoint, imageData, {
        headers: {
          "Authorization": `Bearer ${HF_API_TOKEN}`,
          "Content-Type": "application/octet-stream"
        },
        timeout: 30000
      });
      if (Array.isArray(retryResp.data) && retryResp.data.length > 0 && retryResp.data[0].generated_text) {
        return retryResp.data[0].generated_text;
      }
    }
    
    console.warn('Unexpected response format from BLIP API:', resp.data);
    return null; // Return null instead of error message
  }catch(e){
    console.error('BLIP caption error', e.response?.data || e.message);
    // Return null instead of error message to avoid storing error text as content
    return null;
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
        if(caption) {
          text = caption;
        } else {
          // If captioning failed, don't create chunks with error messages
          // The document will exist but won't have searchable content
          text = '';
        }
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
        // Mark document with processing status if image captioning failed
        if(sourceType === 'image' && !caption && chromaItems.length === 0) {
          doc.processingError = 'Image captioning failed or not available';
        }
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
      // Check if scraping failed - if text starts with "Failed to scrape", don't create chunks
      let textToChunk = scraped.text || '';
      if(textToChunk.startsWith('Failed to scrape')) {
        // Don't create chunks with error messages - just mark as processed
        textToChunk = '';
      }
      const chunks = textToChunk ? chunkText(textToChunk, 400) : [];
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
        // Mark document with processing status if scraping failed
        if(!textToChunk && scraped.text && scraped.text.startsWith('Failed to scrape')) {
          doc3.processingError = 'URL content extraction failed';
        }
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
      
      // Filter out error chunks - don't include chunks with error messages
      const chunkText = chunk.text || '';
      if(chunkText.includes('Failed to scrape') || 
         chunkText.includes('caption error') || 
         chunkText.includes('automatic captioning is not available') ||
         chunkText.includes('cannot be described automatically')) {
        continue; // Skip error chunks
      }
      
      if(fromDate || toDate){
        const created = new Date(chunk.createdAt || Date.now());
        if(fromDate && created < fromDate) continue;
        if(toDate && created > toDate) continue;
      }
      const kw = keywordScore(query, chunkText);
      const ageHours = (now - new Date(chunk.createdAt || now).getTime()) / (1000*60*60);
      const recencyBoost = Math.max(0, 1 - Math.min(ageHours/24/30, 1));
      const baseScore = 1 - (r.distance || 0);
      const combined = baseScore*0.85 + kw*0.15 + recencyBoost*0.1;
      scored.push({ chunkId: cid, docId: chunk.docId, text: chunkText, score: combined });
    }
    scored.sort((a,b)=>b.score-a.score);
    const top = scored.slice(0,k);
    const ctx = top.map((t,i)=>`Source ${i+1} (doc:${t.docId}, score:${t.score.toFixed(3)}):\n${t.text}`).join('\n---\n');
    
    // Improved prompt that handles edge cases better
    let prompt = `You are a helpful assistant. Use the context below to answer the question. `;
    if(ctx.trim().length === 0 || top.length === 0) {
      // Check for documents with processing errors that match the query
      const failedImages = storage.docs.filter(d => d.sourceType === 'image' && d.processingError);
      const failedUrls = storage.docs.filter(d => d.sourceType === 'url' && d.processingError);
      
      // Check if user is asking about a specific document type (image or URL)
      const isImageQuery = /image|picture|photo|what.*image|describe.*image/i.test(query);
      const isUrlQuery = /url|link|website|web page|what.*url|what.*link|summarize.*url/i.test(query);
      
      if(isImageQuery && failedImages.length > 0) {
        const imageNames = failedImages.map(d => d.filename || d.title).join(', ');
        prompt += `\n\nNote: The user is asking about an image. I found ${failedImages.length} image document(s) in the system (${imageNames}), but automatic captioning failed for them. This means the images were uploaded but their content could not be automatically described. Please inform the user that the image(s) were uploaded but captioning is not available. To enable image captioning, they need to configure a HuggingFace API token (HF_API_TOKEN) in the backend environment variables. Without this token, images cannot be processed.`;
      } else if(isUrlQuery && failedUrls.length > 0) {
        const urlList = failedUrls.map(d => d.originalUri || d.title).join(', ');
        prompt += `\n\nNote: The user is asking about a URL. I found ${failedUrls.length} URL document(s) in the system (${urlList}), but content extraction failed for them. This typically happens when URLs require authentication (like dashboard pages), use heavy JavaScript rendering, or have access restrictions. Please inform the user that the URL(s) were uploaded but their content could not be extracted. Suggest they either: 1) Provide the content directly as text, 2) Check if the URL requires login/authentication, or 3) Try a different publicly accessible URL.`;
      } else if(isImageQuery) {
        prompt += `\n\nNote: The user is asking about an image, but no image documents were found in the uploaded documents. Please inform them that no images have been uploaded yet, or suggest they upload an image.`;
      } else if(isUrlQuery) {
        prompt += `\n\nNote: The user is asking about a URL, but no URL documents were found in the uploaded documents. Please inform them that no URLs have been uploaded yet, or suggest they upload a URL.`;
      } else {
        prompt += `\n\nNote: No relevant context was found in the uploaded documents. Please inform the user that you don't have information about this topic in the uploaded documents, and suggest they upload relevant documents or try a different question.`;
      }
    } else {
      prompt += `\n\nContext:\n${ctx}\n\nQuestion: ${query}\n\nAnswer the question based on the context provided.`;
    }
    
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
