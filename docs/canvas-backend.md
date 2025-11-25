# Canvas — Backend Node.js + Express (La Lanterna / Comodissimo)
Stato, regole e roadmap del backend ordini + prenotazioni + NFC + stampa.

---

## 🧱 Stack & setup

- **Runtime**: Node.js 22.x
- **Framework**: Express
- **Database**: MySQL / MariaDB (mysql2)
- **Migrazioni**: file SQL numerati `001_*.sql`, `002_*.sql`, ecc.
- **Socket**: Socket.IO server (singleton)
- **Logging**: winston + daily rotate, log con emoji dove utile
- **Stampa**: ESC/POS via TCP 9100 (Sunmi/Epson), senza simbolo `€` per ora
- **CORS**: configurato via `.env` (es. `CORS_ORIGIN=http://localhost:8100`)

---

## 📂 Struttura directory (semplificata)

- `server/src/server.js` — bootstrap principale Express + Socket.IO
- `server/src/env.js` — gestione variabili ambiente
- `server/src/logger.js` — logger configurato
- `server/src/db/`
  - `index.js` — pool MySQL (multipleStatements: true)
  - `migrator.js` — applicazione migrations
  - `migrations/001_schema.sql` — ordini base
  - `migrations/002_seed.sql` — prodotti seed
  - `migrations/003_reservations.sql` — tavoli/prenotazioni
  - `migrations/004_add_is_active_to_products.sql` — colonna is_active
  - `migrations/005_rooms.sql`, `006_tables_room_fk.sql` — rooms + FK tables
- `server/src/api/`
  - `orders.js` — gestione ordini
  - `reservations.js` — prenotazioni
  - `tables.js` — tavoli
  - `nfc-session.js` — sessioni NFC
  - (future) `printer.js` — salute e comandi stampante
- `server/src/sockets/`
  - `index.js` — init singleton Socket.IO
  - `orders.js` — canale ordini
  - `reservations.js` — canale prenotazioni
  - `nfc-session.js` — canale NFC (separato o integrato)

---

## 🧾 Modello dati principale

### Tabella `products`
- Prodotti con `is_active` (per nascondere senza cancellare)
- Usata da FE (PWA clienti / Admin) per mostrare menu

### Tabelle `orders` e `order_items`
- `orders`:
  - id, customer_name, phone, email
  - people, scheduled_at
  - status: `pending | preparing | ready | completed | cancelled`
  - total (ricalcolato lato server)
  - channel: `admin | kiosk | pwa | phone` ecc.
  - table_id (FK tables)
  - meta tavolo/sala: join con `tables` e `rooms`
  - created_at, updated_at
- `order_items`:
  - order_id (FK)
  - name
  - qty (può essere **negativo** per correzioni)
  - price_unit
  - total_line (qty * price_unit)
  - meta JSON per ingredienti/base/extra

### Tabelle `rooms`, `tables`
- `rooms`: sale (interno, esterno, ecc.)
- `tables`:
  - id, room_id (FK rooms)
  - table_number
  - seats
  - status: `free | occupied | cleaning | blocked`

### Tabelle `reservations`
- Gestione prenotazioni con:
  - cliente, contatti
  - data/ora inizio + end_at (calcolato)
  - numero persone
  - stato: `pending | confirmed | cancelled | no-show | completed`
  - eventuale table_id assegnato

### NFC / Sessioni (design)
- Tabella dedicata o colonna su ordine/tavolo per session_id (per ora best effort)
- Endpoint per legare session_id ↔ tavolo ↔ ordine

---

## ✔️ Endpoints chiave

### `/api/orders`

- `GET /api/orders`
  - Filtri:
    - `hours`, `from`, `to`, `status`, `q`, `table_id`
  - Se `table_id` presente → restituisce ordini “full” con righe e meta tavolo/sala
- `GET /api/orders/:id`
  - Dettaglio ordine completo
  - Include:
    - ordine
    - items
    - meta tavolo (room/table)
    - meta prenotazione se presente
- `GET /api/orders/:id/batches`
  - Storico mandate T1/T2/T3 (order_batches + snapshot righe)
- `GET /api/orders/active-by-session`
  - Restituisce ordine attivo per `session_id` NFC (best effort + backfill)
- `POST /api/orders`
  - Crea ordine
  - Ricalcola sempre `total` lato server
  - Valorizza `table_id` se fornito
  - Se presente `session_id` → lega alla sessione NFC
- `POST /api/orders/:id/items`
  - Aggiunge righe ad ordine esistente
  - Supporta qty negative per **correzioni**
  - Ricalcola total ordine dopo insert
- `PUT /api/orders/:id/status`
  - Aggiorna stato ordine (es. `pending → preparing → ready → completed`)
  - Triggera evento Socket.IO `order-updated`

---

### `/api/reservations`

- `GET /api/reservations`
  - Filtri: `from`, `to`, `status`, ecc.
- `GET /api/reservations/:id`
  - Dettaglio prenotazione (cliente, orario, persone, note, tavolo)
- `POST /api/reservations`
  - Crea prenotazione (admin o canale esterno)
  - Calcola `end_at` (es. durata default 90min)
  - (Roadmap) controlli overlap
- `PUT /api/reservations/:id/status`
  - Cambia stato (pending/confirmed/cancelled/no-show/completed)
- `PUT /api/reservations/:id/table`
  - Assegna/aggiorna tavolo
- (Futuro) `GET /api/reservations/availability`
  - Calcola disponibilità tavoli per intervallo orario

---

### `/api/tables`

- `GET /api/tables`
  - Lista tavoli con room_name, table_number, status
  - (Opzione) include conteggio ordini attivi
- `POST /api/tables/:id/clear`
  - Pulisce tavolo:
    - marca tavolo come `free`
    - chiude eventuale ordine attivo (o lo marca `completed` se già pagato)
    - chiude sessione NFC collegata (se esiste)

---

### `/api/nfc-session`

- `POST /api/nfc-session`
  - Crea/aggiorna sessione per un tag NFC
- `GET /api/nfc-session/:id/active-order`
  - Restituisce ordine attivo per quella sessione
- `PUT /api/nfc-session/:id/close`
  - Chiude esplicitamente la sessione (usata quando tavolo viene pulito)

---

### `/api/printer` (roadmap)

- `GET /api/printer/health`
  - Verifica raggiungibilità stampante (TCP 9100)
- `POST /api/printer/print-order`
  - Stampa comanda cucina
- `POST /api/printer/print-receipt`
  - Stampa preconto (NO `€` per ora per compatibilità codepage)
- `POST /api/printer/print-placeholders`
  - Stampa segnaposto/tavolo

---

## ✔️ Stato attuale (BE) — cosa consideriamo già fatto

- ✅ Pool MySQL con `multipleStatements: true`
- ✅ Migrazioni 001–006 applicate (orders, reservations, rooms/tables + FKs, products.is_active)
- ✅ `/api/orders` stabilizzato:
  - Fix CONCAT con `CHAR(63)` nei LIKE per evitare conflitti con `?`
  - Ritorno `{ ...order, items }` corretto in GET by id
- ✅ `/api/reservations` base funzionante
- ✅ `/api/health/time` (o similare) per diagnostica fusi orari (da verificare naming finale)
- ✅ Socket.IO:
  - Singleton con log connessione/disconnessione
  - Canali base per orders (e predisposizione per reservations)
- ✅ Integrazione con PWA admin:
  - tables-list + order-builder agganciati alle API

---

## 🔥 To-Do prioritari (BE)

1. **Overlap prenotazioni**
   - Su `POST /api/reservations`:
     - Calcolare `end_at` lato server
     - Rifiutare prenotazioni che si sovrappongono sullo stesso tavolo
   - Opzionale: endpoint `/api/reservations/availability`

2. **Chiusura tavolo+sessione robusta**
   - Garantire che `tables/:id/clear`:
     - chiuda sessione NFC collegata (`nfc-session/:id/close`)
     - aggiorni correttamente stato ordine (se ancora attivo)

3. **Socket reservations**
   - Implementare canale Socket.IO `reservations`:
     - Eventi `reservation-created` e `reservation-updated`
     - Esportare helper per emitirli da `api/reservations.js`

4. **Endpoint /api/printer/health**
   - Ping TCP verso stampante
   - Gestire timeout/ECONNREFUSED con errori puliti (502, messaggi chiari)
   - Log con emoji (es. `🖨️`)

5. **TimeZone policy**
   - DB e API in UTC
   - FE converte in Europe/Rome
   - `/api/health/time` mostra:
     - ora server
     - ora DB
     - time_zone impostata

---

## ⭐️ Backlog BE

- Audit `print_jobs` in DB (storico stampe, retry, stato)
- Endpoint reporting base (incassi, numero coperti, ecc.)
- Integrazione futura con gateway fiscale / RT (AdE)
- Endpoint helper per Twilio WhatsApp (callback/status log)

---

## 📝 Note operative per ChatGPT (in VS Code)

- Prima di cambiare endpoint:
  - Rileggere questo file `docs/canvas-backend.md`
- Quando si chiede una patch:
  - Specificare chiaramente il file:
    - es. `src/api/orders.js`, `src/api/reservations.js`, `src/sockets/index.js`
  - Mantenere:
    - Stile log (emoji)
    - Struttura commenti esistenti
    - Migrazioni numerate incrementalmente (`007_*.sql`, `008_*.sql`, ecc.)
