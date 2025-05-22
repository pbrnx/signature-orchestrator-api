//backend.js
//imports
const express  = require('express');
const axios    = require('axios');
const cors     = require('cors');
const FormData = require('form-data');
const fs       = require('fs');
const path     = require('path');
require('dotenv').config();

const logger = require('../serverModules/logger');
const { setToken, ensureToken } = require('./tokenManager');
const { downloadNode, uploadToFolder, sendOnWorkflow } = require('./otcsManager');

const app  = express();
const PORT = process.env.PORT || 3000;

/* === Diretórios === */
if (process.env.NODE_ENV === "production" && !fs.existsSync('/tmp')) {
  fs.mkdirSync('/tmp', { recursive: true });
}

const INP_ROOT = process.env.NODE_ENV === "production"
  ? "/tmp/inprocess"
  : path.join(__dirname, '../inprocess');
if (!fs.existsSync(INP_ROOT)) fs.mkdirSync(INP_ROOT, { recursive: true });

const MAP_FILE = process.env.NODE_ENV === "production"
  ? "/tmp/agreements.json"
  : path.join(__dirname, 'agreements.json');
let MAP = fs.existsSync(MAP_FILE) ? JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')) : {};
function saveMap() { fs.writeFileSync(MAP_FILE, JSON.stringify(MAP, null, 2)); }





/* === Adobe Sign Credentials=== */
const CLIENT_ID     = 'ats-98cfb649-57b1-4cc7-be71-7123447bca2f';
const CLIENT_SECRET = "KP9D_zhP64MmuMRsHKh9FfWFw3lzF46-";
const NGROK_HOST = 'https://adobe-api-deploy.onrender.com';
const REDIRECT_URI  = `${NGROK_HOST}/admin/callback`;
const API_BASE      = 'https://api.na4.adobesign.com';
const AUTH_BASE     = 'https://secure.na4.adobesign.com';



//admin route (scopes)
app.get('/admin/login', (_, res) => {
  const SCOPES = [
    'agreement_send:account',
    'agreement_write:account',
    'agreement_read:account',   
    'account_read:account',
    'account_write:account',
    'user_login:account'
  ];


const url = `${AUTH_BASE}/public/oauth/v2?` +
              `redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
              `&response_type=code` +
              `&client_id=${CLIENT_ID}` +
              `&scope=${encodeURIComponent(SCOPES.join(' '))}`;
  res.send(`<a href="${url}">Logar como admin</a>`);
});

//callback autenticado - atualiza o tokens.json
app.get('/admin/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const r = await axios.post(`${API_BASE}/oauth/v2/token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    setToken(r.data.access_token, r.data.expires_in, r.data.refresh_token);
    logger.info('Token salvo com sucesso');
    res.send('<h1>Token salvo</h1>');
  } catch (e) {
    const msg = e.response?.data?.error_description || e.message;
    logger.error(`OAUTH CALLBACK ERROR: ${msg}`);
    res.status(500).send(`<pre>${msg}</pre>`);
  }
});

app.get('/health', (_, res) => res.status(200).json({ status: 'ok' }));


/* === Middlewares globais === */
app.use(cors());
app.use(express.json({ limit:'10mb' }));
app.use(express.urlencoded({ extended:true }));
let lastRouteGroup = null;

app.use((req, _, next) => {
  const currentGroup = `${req.method} ${req.path}`;

  // Se mudou de grupo de rota, insere quebra visual real no console
  if (lastRouteGroup && lastRouteGroup !== currentGroup) console.log('');
  lastRouteGroup = currentGroup;

  logger.info(`${req.method} ${req.originalUrl}`);

  if (req.method === 'GET' && req.path === '/start') {
    const { userEmail1, userEmail2, nodeId, attachId, docName } = req.query;
    const emails = [userEmail1, userEmail2].filter(Boolean).join(', ');

    logger.info(
      `Signature request initiated\n` +
      `  → Document: ${decodeURIComponent(docName || '?')}\n` +
      `  → Node ID: ${nodeId}\n` +
      `  → Target Folder ID: ${attachId}\n` +
      `  → Recipients: ${emails}`
    );
  }
  next();
});



/* === /start === */
app.get('/start', async (req, res) => {
  const { userEmail1, userEmail2, nodeId, attachId, workflowId, subworkflowId, taskId } = req.query;
  const emails = [userEmail1, userEmail2]
    .filter(Boolean).flatMap(e => e.split(/[;,]+/)).map(e => e.trim()).filter(e => e.includes('@'));
  if (!emails.length || !nodeId) return res.status(400).json({ error: 'Node ID and Email are mandatory.' });
  if (!attachId || isNaN(+attachId)) return res.status(400).json({ error: 'attachId is mandatory.' });

  let token;
  try {
    token = await ensureToken();
  } catch {
    return res.status(401).json({ error: 'LOGIN_REQUIRED' });
  }

  try {
    // 1. Baixa PDF original
    const original = await downloadNode(nodeId);
    const docName = req.query.docName?.trim();
    const fileName = docName;
    const filePath = path.join(INP_ROOT, fileName);
    fs.writeFileSync(filePath, original);

    // 2. Upload p/ transient
    const fd = new FormData();
    fd.append('File', fs.createReadStream(filePath), { filename: fileName, contentType: 'application/pdf' });
    const up = await axios.post(`${API_BASE}/api/rest/v6/transientDocuments`, fd,
      { headers: { Authorization: `Bearer ${token}`, ...fd.getHeaders() } });

    // 3. Cria agreement
    const ag = await axios.post(`${API_BASE}/api/rest/v6/agreements`, {
      name: `Documento ${fileName}`,
      fileInfos: [{ transientDocumentId: up.data.transientDocumentId }],
      participantSetsInfo: emails.map(email => ({ role: 'SIGNER', order: 1, memberInfos: [{ email }] })),
      signatureType: 'ESIGN', state: 'IN_PROCESS'
    }, { headers: { Authorization: `Bearer ${token}` } });

    MAP[ag.data.id] = {
      nodeId: String(nodeId),
      attachId: String(attachId),
      fileName,
      workflowId: String(workflowId || ''),
      subworkflowId: String(subworkflowId || workflowId || ''),
      sendonDone: false // ← para evitar duplicidade na task 3
    };

    saveMap();

    logger.info(`Signature requested: ${ag.data.id}`);

    // *** EXECUTA SENDON EM BACKGROUND (NÃO ESPERA) ***
    if (workflowId) {
      sendOnWorkflow({
        workflowId,
        subworkflowId: subworkflowId || workflowId,
        taskId: taskId || 2,
        comment: 'Documento enviado para assinatura – etapa automatizada'
      }).then(() => {
        logger.info(`SendOn automático realizado para workflow ${workflowId}`);
      }).catch(e => {
  logger.error(`Falha no SendOn automático: ${e.message} | OTCS: ${JSON.stringify(e.response?.data)}`);
});
    }

    // *** SÓ UMA RESPOSTA PARA O FRONT ***
    res.json({ message: `Signature requested. ID: ${ag.data.id}` });

  } catch (e) {
    const raw = e.response?.data;
    const errorMsg = Buffer.isBuffer(raw) ? raw.toString() : JSON.stringify(raw || e.message);
    logger.error(`[START ERROR] ${errorMsg}`);
    res.status(500).json({ error: raw || e.message });
  }
});

async function triggerDisposition(agreementId, disposition){
  const info = MAP[agreementId];
  if(!info || !info.workflowId) {
    logger.warn(`No workflowId stored for ${agreementId}; disposition skipped`);
    return;
  }

  try{
    await sendOnWorkflow({
      workflowId: info.workflowId,
      subworkflowId: info.subworkflowId || info.workflowId,
      taskId: 3,
      disposition,
      comment: `Documento ${disposition.toLowerCase()} via webhook`
    });
    info.sendonDone = true;
    saveMap();
    logger.info(`SendOn task 3 (${disposition}) done for workflow ${info.workflowId}`);
  }catch(e){
    logger.error(`SendOn task 3 failed: ${e.message}`);
  }
}


/// --- HANDSHAKE HEAD ---
app.head('/webhook', (req, res) => {
  res.setHeader('X-AdobeSign-ClientId', CLIENT_ID);
  res.setHeader('Content-Type', 'application/json');
  res.status(200).end();          // sem body
});

// --- HANDSHAKE GET ---
app.get('/webhook', (req, res) => {
  const cid = req.headers['x-adobesign-clientid'] || CLIENT_ID;

  if (req.query.challenge) {
    res.setHeader('X-AdobeSign-ClientId', cid);
    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send(`${req.query.challenge}`);
  }

  res.setHeader('X-AdobeSign-ClientId', cid);
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({ status: 'pong' });
});


// --- HANDSHAKE POST + LÓGICA DO SEU WEBHOOK ---
app.post('/webhook', express.json({limit:'10mb'}), async (req, res) => {
  const cid = req.headers['x-adobesign-clientid'] ||
  req.headers['x-adobesign-client-id'] ||
  CLIENT_ID;
 res.setHeader('X-AdobeSign-ClientId', cid);

  // Parse seguro do corpo
  let payload = {};
  try {
    payload = typeof req.body === 'object' ? req.body : JSON.parse(req.body.toString());
  } catch (err) {
    logger.error(`Webhook parse error: ${err.message}`);
    return res.status(400).send('Invalid webhook payload');

  }
  //Logging webhook
  const short = JSON.stringify(payload).slice(0, 4000); // 4 KB cap
 logger.info(`Webhook raw (trunc): ${short}${payload.length > 4000 ? '…' : ''}`);

  
  // --- Seu código de eventos do webhook aqui ---
  const agreementId = payload.event?.agreementId || payload.agreement?.id || payload.agreementId;
  const evt = payload.event?.eventType || payload.event || payload.type || 'UNKNOWN_EVENT';
  const participant = payload.event?.participantUserEmail || payload.participantUserEmail || 'unknown';
  const timestamp = payload.event?.eventDate || new Date().toISOString();

  logger.info(
    `Webhook received\n` +
    `  → Event: ${evt}\n` +
    `  → Agreement ID: ${agreementId}\n` +
    `  → Participant: ${participant}\n` +
    `  → Date: ${timestamp}`
  );

  //if (!agreementId || !MAP[agreementId]) return res.status(200).send('OK');
  
  const info = MAP[agreementId];

  const PDF_EVENTS = [
    'DOCUMENT_SIGNED', 'PARTICIPANT_COMPLETED', 'PARTICIPANT_SIGNED',
    'AGREEMENT_COMPLETED', 'AGREEMENT_SIGNED', 'AGREEMENT_ACTION_COMPLETED',
    'AGREEMENT_WORKFLOW_COMPLETED', 'AGREEMENT_REJECTED'
  ];
  const FINAL_OK_EVENTS = [
    'AGREEMENT_COMPLETED',
    'AGREEMENT_SIGNED',
    'AGREEMENT_WORKFLOW_COMPLETED'
  ];

  if (PDF_EVENTS.includes(evt)) {
    try {
      await overwritePdf(agreementId);
      if (!info.sendonDone) {
        if (evt === 'AGREEMENT_REJECTED') {
          await triggerDisposition(agreementId, 'Rechazado');
        } else if (FINAL_OK_EVENTS.includes(evt)) {
          await triggerDisposition(agreementId, 'Firmado');
        }
      }
    } catch (err) {
      logger.error(`Erro durante PDF+SendOn: ${err.message}`);
    }
    return res.status(200).send('OK');
  }

  res.status(200).send('OK');
});



const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);

async function overwritePdf(agreementId, tries = 0) {
  const info = MAP[agreementId];
  if (!info) return;

  const token = await ensureToken();
  const { nodeId, attachId, fileName } = info;
  const name = fileName?.trim() || `node_${nodeId}.pdf`;
  const filePath = path.join(INP_ROOT, name);

  try {
    const rsp = await axios.get(
      `${API_BASE}/api/rest/v6/agreements/${agreementId}/combinedDocument`,
      {
        responseType: 'stream',
        headers: { Authorization: `Bearer ${token}` },
        maxContentLength: 20 * 1024 * 1024 // 20 MB limit
      }
    );

    await streamPipeline(rsp.data, fs.createWriteStream(filePath));
    logger.info(`PDF Overwritten: ${filePath}`);

    const fileBuffer = fs.readFileSync(filePath); // optional: avoid if `uploadToFolder` supports streams
    await uploadToFolder(attachId, fileBuffer, name);
    logger.info(`Sent to folder ${attachId} on Content Server`);
  } catch (e) {
    if (e.response?.status === 403 && tries < 50) {
      setTimeout(() => overwritePdf(agreementId, tries + 1), 3000);
    } else {
      logger.error(`Upload failed: ${e.message}`);
    }
  }
}

if (process.env.NODE_ENV === 'production') {
  setInterval(() => {
    axios.get(`${NGROK_HOST}/health`)
      .then(() => logger.info('[KEEPALIVE] Ping interno OK'))
      .catch(err => logger.warn(`[KEEPALIVE] Falha no ping interno: ${err.message}`));
  }, 1000 * 60 * 10); 
}


app.use((_,res) => res.status(404).json({error:'Endpoint not found'}));

app.listen(PORT, () => {
  logger.info(
    `Server started successfully\n` +
    `  → Local:  http://localhost:${PORT}\n` +
    `  → Ngrok:  ${NGROK_HOST}\n\n`
  );
});