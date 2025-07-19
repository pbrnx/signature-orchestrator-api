  console.log('js ok!')
// Elementos de controle
  const logList     = document.getElementById('log-list');
  const pauseBtn    = document.getElementById('pauseBtn');
  const searchInput = document.getElementById('searchInput');
  const levelFilter = document.getElementById('levelFilter');
  const clearBtn    = document.getElementById('clearBtn');
  const scrollBtn   = document.getElementById('scrollBtn');

  // Estado global
  let paused          = false;
  let autoScroll      = true;
  let logs            = [];
  let currentGroupEl  = null;
  let lastLevel       = 'INFO';
  let lastTs          = '';

  // Fonte de eventos SSE
  const evtSource = new EventSource('/logs/stream');

  // Regex para extrair timestamp mesmo dentro de colchetes
  const tsRe = /\[?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3})(?:Z| UTC)?[^\]]*\]?/;


  // Parseia cada linha de log
  function parseLogLine(line) {
    // 1) Linhas “filha” (começam com →) herdam nível e ts da última raiz
    if (/^\s*→/.test(line)) {
      return {
        timestamp: lastTs,
        level:     lastLevel,
        message:   line.trim(),
        raw:       line,
        isChild:   true
      };
    }

    // 2) Linhas raiz: extrai timestamp + nivel/mensagem
    const tsMatch = line.match(tsRe);
    const ts      = tsMatch ? tsMatch[1] : '';
    let   level, msg;

    // tenta formato “piped” ([ts] | LEVEL | mensagem)
    const piped  = /^\[?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]?\s*\|\s*(\w+)\s*\|\s*(.+)$/;
    const spaced = /^\[?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]?\s+(\w+)\s+(.+)$/;
    let m = line.match(piped) || line.match(spaced);

    if (m) {
      level = m[1].toUpperCase();
      msg   = m[2];
    } else {
      // detecta “WARN: …” ou “ERROR: …”
      const colon = line.match(/\b(INFO|WARN|ERROR|EVENT)\s*:\s*(.+)$/i);
      if (colon) {
        level = colon[1].toUpperCase();
        msg   = colon[2];
      } else {
        level = 'INFO';
        msg   = line;
      }
    }

    lastLevel = level;
    lastTs    = ts;

    return {
      timestamp: ts,
      level:     level,
      message:   msg.trim(),
      raw:       line,
      isChild:   false
    };
  }

  // Decide se exibe no filtro atual
  function shouldDisplay(obj) {
    const search = searchInput.value.toLowerCase();
    const lvl    = levelFilter.value;
    return (!lvl || obj.level === lvl) &&
           (!search || obj.raw.toLowerCase().includes(search));
  }

  // Highlight na busca
  function highlightSearch(msg) {
    const q = searchInput.value.trim();
    if (!q) return msg;
    return msg.replace(new RegExp(q, "gi"),
      m => `<mark style="background:#2bf9d9;color:#1b1b28">${m}</mark>`);
  }

  // Desce o container se estiver em auto-scroll
  function scrollIfNeeded() {
    if (autoScroll) logList.scrollTop = logList.scrollHeight;
  }

  // Renderiza todo o histórico (ao filtrar ou limpar)
  function renderLogs() {
    logList.innerHTML   = '';
    currentGroupEl      = null;
    logs.forEach(obj => {
      if (shouldDisplay(obj)) appendLogLine(obj, false);
    });
    scrollIfNeeded();
  }

  // Adiciona uma linha (ou agrupa dentro do mesmo bloco)
  function appendLogLine(obj, scroll = true) {
    const { timestamp, level, message, isChild } = obj;

    // cria novo bloco se for raiz ou se não houver grupo ativo
    if (!isChild || !currentGroupEl || !currentGroupEl.isConnected) {
      currentGroupEl = document.createElement('div');
      currentGroupEl.className = 'log-group';
      logList.appendChild(currentGroupEl);
    }

    const div = document.createElement('div');
    div.className = `log-line ${level}`;
    div.innerHTML = `
      <span class="timestamp">${timestamp}</span>
      ${!isChild ? `<span class="level">${level}</span>` : ''}
      <span class="message">${highlightSearch(message)}</span>`;

    currentGroupEl.appendChild(div);

    if (scroll && autoScroll) scrollIfNeeded();
  }

  // Handlers SSE
  evtSource.onmessage = e => {
    if (paused) return;
    const obj = parseLogLine(e.data);
    logs.push(obj);
    if (shouldDisplay(obj)) appendLogLine(obj);
  };
  evtSource.onerror = () => {
    const errObj = {
      timestamp: new Date().toISOString(),
      level:     "ERROR",
      message:   "Conexão com o servidor perdida.",
      raw:       "Conexão perdida",
      isChild:   false
    };
    logs.push(errObj);
    appendLogLine(errObj);
    evtSource.close();
  };

  // Botões de controle
  pauseBtn.onclick = () => {
    paused = !paused;
    pauseBtn.classList.toggle('active', paused);
    pauseBtn.textContent = paused ? "Continuar" : "Pausar";
  };
  scrollBtn.onclick = () => {
    autoScroll = !autoScroll;
    scrollBtn.classList.toggle('active', autoScroll);
  };
  clearBtn.onclick = () => {
    logs = [];
    lastTs    = '';
    lastLevel = 'INFO';
    renderLogs();
  };

  // Filtragem em tempo real
  [searchInput, levelFilter].forEach(el =>
    el.addEventListener('input', renderLogs)
  );

