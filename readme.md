
# 🔐 Integração Adobe Sign + OpenText xECM

Automatização do processo de assinatura digital via Adobe Sign, com integração customizada ao OpenText Content Server (OTCS).

## 📌 Objetivo

Este projeto permite o envio de documentos do OTCS para assinatura eletrônica via Adobe Sign, recebimento automático do documento assinado e upload final para a pasta apropriada no Content Server, tudo via API — sem intervenção manual.

---

## 🧱 Arquitetura

- **Frontend (HTML + JS)**  
  Página embutida no OTCS via WebReport, usada como trigger de execução.
  
- **Backend (Node.js + Express)**  
  Servidor que realiza:
  - Autenticação OAuth2 com Adobe Sign (via refresh token)
  - Download de documentos via API do OTCS (autenticado via OTDS)
  - Envio para assinatura
  - Monitoramento assíncrono via Webhook
  - Upload automático do PDF assinado para o OTCS

---

## ⚙️ Funcionalidades

- 🔁 Integração contínua com Adobe Sign via refresh token
- 📥 Download seguro do PDF original via API do OTCS
- ✍️ Envio para múltiplos signatários (via Adobe Sign)
- 📡 Webhook para monitorar status da assinatura
- 📤 Upload automático do PDF assinado para pasta de destino no OTCS
- 🧾 Log detalhado (audit.log, error.log, payloads de webhook)
- 🧼 Purge de arquivos temporários (opcional)

---

## 🚀 Como rodar

### 1. Clone o projeto

```
git clone https://github.com/Activos-Digitales-xECM-LATAM/adobe-api.git
cd nome-do-projeto
```

### 2. Instale as dependências

```
npm install
```

### 3. Configure o `.env`

Crie um arquivo `.env` na raiz com as seguintes variáveis:

```
# Adobe Sign
CLIENT_ID=seu_client_id
CLIENT_SECRET=seu_client_secret
NGROK_HOST=https://seu-endpoint.ngrok.app (opcional, pode usar qualquer tunel http ou fazer port-forward e expor seu IP)

# OpenText
OTCS_BASE=https://seu-content-server/api/v1
OTCS_USER=usuario.otds
OTCS_PASS=senha.otds
```

### 4. Rode o servidor

```
node backend.js
```

---

## 🔁 Webhook

- **Endpoint:** `/webhook`
- **Verbo:** `POST`
- **Content-Type:** `application/json`

Usado para:

- Monitorar eventos de assinatura (ex: `AGREEMENT_COMPLETED`)
- Baixar PDF assinado
- Subir o novo documento para o OTCS

---

## 📁 Estrutura de Pastas

```
/
├── .env                  # Variáveis de ambiente
├── .gitignore
├── package.json
├── package-lock.json
├── readme.md
├── tokens.json           # Tokens salvos (evitar commitar)
│
├── node_modules/
│
└── server/
    ├── http/
    │   ├── ngrok.exe
    │   └── runngrok.bat
    │
    ├── inProcess/
    │   └── Documento.pdf (aqui ficam os temporários)
    │
    ├── logs/
    │   ├── audit.log
    │   ├── error.log
    │   └── webhook_raw.log
    │
    └── serverModules/
        ├── agreements.json
        ├── backend.js
        ├── logger.js
        ├── otcsManager.js
        └── tokenManager.js
```


## 🧠 Insights Técnicos

- Utiliza o Adobe Sign OAuth 2.0 com refresh token para evitar reautenticações frequentes.
- Substitui a abordagem de URL pública por autenticação OTDS para ambientes restritos (ex: on-premise).
- Armazena os arquivos apenas temporariamente e pode implementar cleanup semanal.
- Toda lógica de mapeamento e rastreio é gerenciada por `agreements.json`.

---

## 🛡️ Segurança

- Nenhum token sensível fica exposto no frontend.
- Senhas e chaves são lidas via `.env`.
- Webhook ignora eventos irrelevantes e só processa os acordos mapeados.

---

## 🧪 Testes

- Compatível com documentos protegidos
- Suporta múltiplos signatários

---

## 🧙‍♂️ Desenvolvedor

Pedro Barone

---

## 📄 Licença

Esse projeto pode ser reutilizado internamente por funcionários da Stratesys. 
