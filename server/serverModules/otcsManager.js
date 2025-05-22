// otcsManager.js
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();
const qs = require('qs');



const OTCS_BASE = process.env.OTCS_BASE;
const OTCS_USER = process.env.OTCS_USER;
const OTCS_PASS = process.env.OTCS_PASS;


let ticket = '';
let expiresAt = 0;

async function ensureTicket() {
  if (ticket && Date.now() < expiresAt - 30_000) return ticket;

  const rsp = await axios.post(
    `${OTCS_BASE}/v1/auth`,
    { username: OTCS_USER, password: OTCS_PASS },
    { headers: { 'Content-Type': 'application/json' } }
  );

  ticket = rsp.data.ticket || rsp.data.otdsToken;
  const ttl = rsp.data.validFor || 1800;
  expiresAt = Date.now() + ttl * 1000;
  return ticket;
}

async function downloadNode(nodeId, version = 1) {
  const tck = await ensureTicket();
  const url = `${OTCS_BASE}/v1/nodes/${nodeId}/versions/${version}/content`;

  const rsp = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: { OTCSTicket: tck }
  });

  return rsp.data; // Buffer com o PDF
}

async function uploadToFolder(folderId, buffer, fileName) {
  const tck = await ensureTicket();

  // 1. Verifica se já existe um documento com mesmo nome na pasta
  const searchUrl = `${OTCS_BASE}/v1/nodes/${folderId}/nodes?where_name=${encodeURIComponent(fileName)}`;
  const existing = await axios.get(searchUrl, {
    headers: { OTCSTicket: tck }
  });

  const existingDoc = existing.data?.data?.find(n => n.name === fileName && n.type === 144);

  const fd = new FormData();
  fd.append('file', buffer, {
    filename: fileName,
    contentType: 'application/pdf'
  });

  if (existingDoc) {
    // 2. Adiciona como nova versão
    const versionUrl = `${OTCS_BASE}/v1/nodes/${existingDoc.id}/versions`;
    const rsp = await axios.post(versionUrl, fd, {
      headers: {
        ...fd.getHeaders(),
        OTCSTicket: tck
      }
    });
    return rsp.data;
  } else {
    // 3. Cria novo documento
    fd.append('parent_id', folderId);
    fd.append('type', '144');
    fd.append('name', fileName);
    fd.append('resource', JSON.stringify({ name: fileName }));

    const rsp = await axios.post(`${OTCS_BASE}/v1/nodes`, fd, {
      headers: {
        ...fd.getHeaders(),
        OTCSTicket: tck
      }
    });
    return rsp.data;
  }
}

async function sendOnWorkflow({
  workflowId,
  subworkflowId,
  taskId = 2,
  disposition = '',
  comment = ''
}) {
  const tck = await ensureTicket();
  const url = `${OTCS_BASE}/v2/processes/${workflowId}/subprocesses/${subworkflowId}/tasks/${taskId}`;

  // Só um parâmetro: action OU custom_action (disposition)
  let dataObj;
  if (disposition) {
    dataObj = {
      custom_action: disposition,
      ...(comment && { comment })
    };
  } else {
    dataObj = {
      action: 'sendon',
      ...(comment && { comment })
    };
  }
  const data = qs.stringify(dataObj);

  const rsp = await axios.put(url, data, {
    headers: {
      'OTCSTicket': tck,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
  return rsp.data;
}



module.exports = { downloadNode, uploadToFolder, sendOnWorkflow };
