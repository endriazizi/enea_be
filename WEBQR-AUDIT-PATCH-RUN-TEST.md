# WhatsApp WebQR — AUDIT + PATCH MINIME + RUN+TEST

## (1) AUDIT

1. **Mount router /api/whatsapp-webqr:**  
   `be/src/server.js` (righe ~97-99):  
   `if (ensureExists('api/whatsapp-webqr', ...)) app.use('/api/whatsapp-webqr', require('./api/whatsapp-webqr'));`  
   Il router è montato **prima** di Gift Vouchers e Health.

2. **File esistenti WebQR:**  
   - **api:** `be/src/api/whatsapp-webqr.js` — stub con GET /status, /qr, POST /send (enabled() da env, nessun provider).  
   - **service/provider/socket:** Non esistevano; ora aggiunti:  
     - `be/src/services/provider.baileys.js` — Baileys, auth dir, QR dataUrl, stati, retry.  
     - `be/src/services/whatsapp-webqr.service.js` — singleton, start/getStatus/getQr/send.  
     - `be/src/sockets/whatsapp-webqr.js` — mount(io) che avvia il service con io per emit.

3. **Inizializzazione socket:**  
   `be/src/sockets/index.js`:  
   - `init(ioInstance)` riceve l’istanza Socket.IO dal server.  
   - Monta canali: `orders`, `nfc.session`, e (dopo patch) `whatsapp-webqr`.  
   - `module.exports.io = getIo` espone il singleton per i router/service.  
   Il server in `server.js` crea `io` e chiama `require('./sockets/index')(io)`; non c’è room "admins", si usa broadcast `io.emit` per gli eventi WebQR.

---

## (2) PATCH MINIME

### A) Dipendenze
- **package.json:** aggiunta `"@whiskeysockets/baileys": "^6.7.9"`.  
- `qrcode` era già presente.

### B) provider.baileys.js (nuovo)
- Sessione in `WHATSAPP_WEBQR_AUTH_DIR` (default `./data/wa-webqr`).  
- Stati: `disconnected` | `qr` | `connecting` | `ready` | `error`.  
- QR: da evento Baileys → `QRCode.toDataURL(qr)` → `lastQrDataUrl` + callback `onQr`.  
- Callback: `onStatus`, `onQr`, `onError`.  
- Retry: 5s, 15s, 60s (max), senza loop aggressivo.  
- Log: prefisso `[WEBQR]` + emoji (📲 init, 🧾 qr, ✅ ready, ⚠️ warn, ❌ error, 🔁 retry).

### C) whatsapp-webqr.service.js (nuovo)
- `start(io)` solo se `WHATSAPP_WEBQR_ENABLED=1`; registra callbacks provider → `io.emit('whatsapp-webqr:status'|':qr'|':error')`.  
- `getStatus()` → `{ status, enabled, updatedAt, lastError }`.  
- `getQr()` → dataUrl se status=qr.  
- `send({ to, text })` solo se ready.

### D) Socket
- **sockets/whatsapp-webqr.js:** `mount(io)` → `webqrService.start(io)`.  
- **sockets/index.js:** dopo nfc.session, `require('./whatsapp-webqr').mount(ioInstance)`.

### E) REST (api/whatsapp-webqr.js riscritto)
- `requireAuth` su GET /status, GET /qr, POST /send.  
- GET /status: risposta da `webqrService.getStatus()`.  
- GET /qr: 503 se disabled; altrimenti `{ ok, qr, status }`.  
- POST /send: body `{ to, text }`; rate limit in-memory (20 req/min); 503 se disabled o non ready; 429 se rate limit.

### F) Bootstrap
- Nessun hook aggiuntivo in server.js: l’avvio WebQR avviene quando viene eseguito `sockets/index.js` init(io), che monta whatsapp-webqr e chiama `webqrService.start(io)`.

---

## (3) RUN+TEST

### Comandi
```bash
cd be
npm install
export WHATSAPP_WEBQR_ENABLED=1
# opzionale: export WHATSAPP_WEBQR_AUTH_DIR=/path/to/auth
npm run dev
# oppure: node src/server.js
```

### Env
- `WHATSAPP_WEBQR_ENABLED=1` — abilita WebQR e avvio Baileys.  
- `WHATSAPP_WEBQR_AUTH_DIR` — (opzionale) directory auth, default `./data/wa-webqr`.  
- Per REST: `Authorization: Bearer <JWT_ADMIN>` (stesso JWT degli altri endpoint protetti).

### Test

1. **GET /status (enabled=1)**  
   `curl -s -H "Authorization: Bearer <JWT_ADMIN>" http://localhost:3000/api/whatsapp-webqr/status`  
   - Atteso: `connecting` o `qr` o `ready`; `enabled: true`; eventuale `lastError`.

2. **GET /qr**  
   `curl -s -H "Authorization: Bearer <JWT_ADMIN>" http://localhost:3000/api/whatsapp-webqr/qr`  
   - Se status=qr: JSON con `qr` (data URL PNG).  
   - Se disabled: 503.

3. **Socket realtime**  
   - FE (o client Socket.IO) connesso al default namespace:  
   - Eventi: `whatsapp-webqr:status`, `whatsapp-webqr:qr`, `whatsapp-webqr:error`.  
   - Dopo avvio, con status=qr si riceve `whatsapp-webqr:qr` con payload `{ qr: "data:image/png;base64,..." }`.

4. **Dopo scan QR**  
   - GET /status → `status: "ready"`.  
   - GET /qr → `qr: null` (o comunque status non più qr).

5. **POST /send**  
   `curl -s -X POST -H "Authorization: Bearer <JWT_ADMIN>" -H "Content-Type: application/json" -d '{"to":"393331234567","text":"Test WebQR"}' http://localhost:3000/api/whatsapp-webqr/send`  
   - Con status=ready: 200, messaggio inviato.  
   - Se non ready: 503.  
   - Oltre 20 req/min: 429.

6. **enabled=0**  
   - `WHATSAPP_WEBQR_ENABLED=0` (o non impostato):  
   - GET /status → `status: "disabled", enabled: false`.  
   - GET /qr e POST /send → 503.
