/**
 * Ingestion Worker v3
 * - Consumes jobs from BullMQ 'ingest' queue
 * - Handles upload_file / inline_text / ingest_url
 * - Uses OpenAI Vision API for image captions
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
const CHROMA_URL = process.env.CHROMA_URL || "http://localhost:8000";

if (!OPENAI_KEY) { console.error('set OPENAI_API_KEY'); process.exit(1); }

// Image captioning uses OpenAI Vision API (gpt-4o-mini)
console.log('✓ Image captioning enabled using OpenAI Vision API');

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

async function transcribeAudio(localPath, filename = null){
  try {
    console.log('Starting audio transcription for:', localPath);
    console.log('Provided filename:', filename);
    
    // Check if file exists
    if (!fs.existsSync(localPath)) {
      throw new Error(`Audio file not found: ${localPath}`);
    }
    
    const fileStats = fs.statSync(localPath);
    console.log('Audio file size:', fileStats.size, 'bytes');
    
    // Determine filename - prioritize provided filename, fallback to extracting from path
    let finalFilename;
    let fileExtension;
    
    if (filename) {
      // Use the provided filename (should include extension)
      finalFilename = filename;
      fileExtension = path.extname(filename).toLowerCase();
      console.log('Using provided filename:', finalFilename, 'with extension:', fileExtension);
    } else {
      // Fallback: try to extract from localPath
      fileExtension = path.extname(localPath).toLowerCase();
      if (!fileExtension) {
        // If no extension in path, default to .mp3
        fileExtension = '.mp3';
        console.warn('No file extension found, defaulting to .mp3');
      }
      finalFilename = `audio${fileExtension}`;
      console.log('Using generated filename:', finalFilename);
    }
    
    // Ensure filename has proper extension for OpenAI
    if (!fileExtension || fileExtension === '.') {
      fileExtension = '.mp3';
      if (!finalFilename.endsWith('.mp3')) {
        finalFilename = finalFilename + '.mp3';
      }
    }
    
    console.log('Final filename for transcription:', finalFilename);
    console.log('File extension:', fileExtension);
    
    // Read file as buffer and append with explicit filename
    // OpenAI Whisper API requires the filename to determine the format
    const fileBuffer = fs.readFileSync(localPath);
    const fm = new FormData();
    
    // Remove leading dot from extension for content-type (e.g., .mp3 -> mp3)
    const contentTypeExt = fileExtension.substring(1) || 'mp3';
    fm.append('file', fileBuffer, {
      filename: finalFilename,
      contentType: `audio/${contentTypeExt}`
    });
    fm.append('model', 'whisper-1');
    
    console.log('Sending audio to OpenAI Whisper API...');
    const resp = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions', 
      fm, 
      { 
        headers: { 
          Authorization: `Bearer ${OPENAI_KEY}`, 
          ...fm.getHeaders() 
        }, 
        maxContentLength: Infinity, 
        maxBodyLength: Infinity,
        timeout: 300000 // 5 minute timeout for long audio files
      }
    );
    
    const transcribedText = resp.data.text;
    console.log('Audio transcription successful, length:', transcribedText.length, 'characters');
    return transcribedText;
  } catch (e) {
    const errorMsg = e.response?.data?.error?.message || e.message;
    console.error('Audio transcription error:', e.response?.data || e.message);
    console.error('Error details:', e.response?.status, e.response?.statusText);
    
    // Provide more helpful error message
    if (e.response?.status === 400 && errorMsg?.includes('Unrecognized file format')) {
      throw new Error(`Audio file format not supported. The file may be corrupted or in an unsupported format. Supported formats: flac, m4a, mp3, mp4, mpeg, mpga, oga, ogg, wav, webm. Original error: ${errorMsg}`);
    }
    
    throw e; // Re-throw so caller can handle it
  }
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

async function captionImage(localPath){
  // Use OpenAI Vision API for image captioning
  try {
    console.log('Attempting image captioning with OpenAI Vision API');
    const imageData = fs.readFileSync(localPath);
    const imageBase64 = imageData.toString('base64');
    
    // Determine image MIME type from file extension
    const ext = path.extname(localPath).toLowerCase();
    let mimeType = 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    else if (ext === '.webp') mimeType = 'image/webp';
    
    const resp = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Describe this image in detail. Provide a clear, comprehensive description of what you see, including any text, objects, people, settings, colors, and activities.'
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${imageBase64}`
                }
              }
            ]
          }
        ],
        max_tokens: 300,
        temperature: 0.3
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );
    
    const caption = resp.data.choices[0].message.content;
    console.log('Image caption generated:', caption.substring(0, 100) + '...');
    return caption;
  } catch (e) {
    console.error('OpenAI Vision API error:', e.response?.data || e.message);
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
      const { localPath, filename, sourceType } = d;
      let text = '';
      let caption = null;
      if(sourceType==='pdf'){
        const buf = fs.readFileSync(localPath);
        const p = await pdfParse(buf);
        text = p.text||'';
      } else if(sourceType==='audio'){
        try {
          text = await transcribeAudio(localPath, filename);
          if (!text || text.trim().length === 0) {
            console.warn('Audio transcription returned empty text');
            text = '';
          }
        } catch (e) {
          console.error('Audio transcription failed:', e.message);
          // Don't create chunks with error messages, but mark document with error
          text = '';
          if (doc) {
            doc.processingError = `Audio transcription failed: ${e.message}`;
          }
        }
      } else if(sourceType==='image'){
        caption = await captionImage(localPath);
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
      // Check if it's a YouTube URL - these need special handling
      const isYouTube = /youtube\.com|youtu\.be/i.test(d.url);
      
      let textToChunk = '';
      let scraped = { title: d.url, text: '' };
      
      if(isYouTube) {
        // YouTube URLs can't be scraped - create a searchable chunk with URL info
        console.log('YouTube URL detected - creating metadata chunk');
        textToChunk = `YouTube URL: ${d.url}\n\nNote: YouTube videos cannot be automatically scraped. The video content requires manual description or the video URL needs to be accessed directly.`;
        scraped.title = `YouTube Video: ${d.url}`;
      } else {
        scraped = await scrapeUrl(d.url);
        textToChunk = scraped.text || '';
        
        // If scraping failed, still create a minimal searchable chunk
        if(textToChunk.startsWith('Failed to scrape') || !textToChunk) {
          console.log('URL scraping failed - creating metadata chunk');
          textToChunk = `URL: ${d.url}\n\nNote: Content extraction from this URL failed. The URL may require authentication, use heavy JavaScript rendering, or have access restrictions.`;
        }
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
        // Mark document with processing status if scraping failed (but we still created chunks)
        if(isYouTube || (scraped.text && scraped.text.startsWith('Failed to scrape'))) {
          doc3.processingError = isYouTube ? 'YouTube URL - content cannot be automatically extracted' : 'URL content extraction failed';
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
