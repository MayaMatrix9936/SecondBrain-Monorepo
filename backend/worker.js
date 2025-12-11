/**
 * Ingestion Worker v3
 * - Consumes jobs from BullMQ 'ingest' queue
 * - Handles upload_file / inline_text / ingest_url
 * - Uses BLIP (HuggingFace Inference API) for image captions
 * - Uses Chroma for vector storage
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const pdfParse = require('pdf-parse');
const axios = require('axios');
const FormData = require('form-data');
const { v4: uuidv4 } = require('uuid');
const cheerio = require('cheerio');

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const HF_API_TOKEN = process.env.HF_API_TOKEN;
const HF_BLIP_MODEL = process.env.HF_BLIP_MODEL || "Salesforce/blip-image-captioning-large";
const CHROMA_URL = process.env.CHROMA_URL || "http://localhost:8000";

if (!OPENAI_KEY) { console.error('set OPENAI_API_KEY'); process.exit(1); }
if (!HF_API_TOKEN) { console.error('set HF_API_TOKEN for BLIP captioning'); }

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
// Parse Redis URL to extract connection details
const redisUrl = new URL(REDIS_URL);
const connection = new IORedis({
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port) || 6379,
  password: redisUrl.password || undefined,
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
});

function safeJSON(str) {
  const match = str.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); }
  catch { return null; }
}

function readStorage(){ const p = path.join(__dirname,'storage.json'); if(!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify({ docs:[], chunks:[], graph:{nodes:[], edges:[]} }, null, 2)); return JSON.parse(fs.readFileSync(p,'utf8')); }
function writeStorage(obj){ fs.writeFileSync(path.join(__dirname,'storage.json'), JSON.stringify(obj, null, 2)); }

async function embedText(text){
  const resp = await axios.post('https://api.openai.com/v1/embeddings', { model: 'text-embedding-3-small'    , input:text }, { headers:{ Authorization:`Bearer ${OPENAI_KEY}` } });
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
  const imageData = fs.readFileSync(localPath);
  
  // Try different endpoint formats
  const endpoints = [
    `https://router.huggingface.co/models/${HF_BLIP_MODEL}`,
    `https://api-inference.huggingface.co/models/${HF_BLIP_MODEL}`
  ];
  
  let resp;
  let lastError;
  
  for (const endpoint of endpoints) {
    try {
      resp = await axios.post(endpoint, imageData, {
        headers: {
          "Authorization": `Bearer ${HF_API_TOKEN}`,
          "Content-Type": "application/octet-stream"
        },
        timeout: 30000,
        validateStatus: function (status) {
          return status < 600;
        }
      });
      
      if (resp.status === 200 || resp.status === 201) {
        break;
      } else if (resp.status === 503) {
        break;
      } else {
        lastError = new Error(`Status ${resp.status}`);
        continue;
      }
    } catch (error) {
      lastError = error;
      continue;
    }
  }
  
  if (!resp || (resp.status !== 200 && resp.status !== 201 && resp.status !== 503)) {
    throw lastError || new Error('All HuggingFace endpoints failed');
  }
    
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
  await axios.post(`${CHROMA_URL}/upsert`, { collection, items });
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
        response_format: { type: "json_object" }   // ← this forces clean JSON
      },
      { headers: { Authorization: `Bearer ${OPENAI_KEY}` } }
    );

    return resp.data.choices[0].message.parsed_json || {
      people: [],
      orgs: [],
      projects: [],
      tags: []
    };

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

const worker = new Worker('ingest', async job => {
  const d = job.data;
  console.log('Worker job', d);
  const storage = readStorage();
  const doc = storage.docs.find(x=>x.docId===d.docId);
  const now = new Date().toISOString();
  try{
    if(d.jobType==='upload_file'){
      const { localPath, sourceType } = d;
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
        if(d.filename && !doc.filename) doc.filename = d.filename;
        if(d.filename && !doc.title) doc.title = d.filename;
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
    } else {
      console.warn('unknown job', d);
    }
  }catch(e){
    console.error('worker error', e.response?.data || e.message);
    throw e;
  }
  
},{ connection  });

worker.on('failed', (job, err) => console.error('job failed', job.id, err));
console.log('Worker v3 started, listening to Redis');
