# AUDIT — Prenotazioni, Email, WhatsApp/Twilio

**Data**: 2026-02-07  
**Scope**: Backend Node/Express + MySQL, PWA Ionic/Angular

---

## 1) Rotte e servizi prenotazioni

| File | Ruolo |
|------|-------|
| `src/api/reservations.js` | Router REST: GET/POST/PUT/DELETE, PUT `/:id/status`, checkin/checkout, print |
| `src/services/reservations.service.js` | CRUD DB: create, update, remove, getById, list |
| `src/services/reservations-status.service.js` | State machine: updateStatus(action) → accepted/rejected/cancelled/… |

**Rotte chiave**:
- `PUT /api/reservations/:id/status` — Cambio stato (action: accept, reject, cancel, …)
- `DELETE /api/reservations/:id` — Hard delete (nessuna email)

---

## 2) WhatsApp "PRENOTAZIONE RICEVUTA"

| Dove | File | Funzione/Rotta |
|------|------|----------------|
| **Composizione testo** | `src/utils/whatsapp-templates.js` | `buildReservationReceivedMessage()` |
| **Invio** | `src/api/whatsapp-templates.js` | `POST /send/reservation-received` |
| **Canali** | WebQR (`whatsapp-webqr.service`) oppure Twilio (`whatsapp.service.sendText`) |

**Quando parte**: Su creazione prenotazione (status pending) — FE chiama POST dopo create.

**Codice prenotazione**: `R-{DDMM}-{HHMM}-{ultime4}` da `start_at` + `phone`; fallback `R-${id}`.

---

## 3) Email esistente

| Evento | Esiste? | File | Funzione |
|--------|---------|------|----------|
| **Status change generico** | ✅ Sì | `mailer.service.js` | `sendStatusChangeEmail()` |
| **Prenotazione rifiutata** | ✅ Sì | `mailer.service.js` | `sendReservationRejectionEmail()` |
| **Prenotazione CONFERMATA (accepted)** | ❌ No | — | — |

**Dove viene inviata**:
- `src/api/reservations.js` PUT `/:id/status`: chiama `sendStatusChangeEmail` per **qualunque** cambio stato (se `notify` o `env.RESV.notifyAlways`).
- **Non** esiste una email dedicata "PRENOTAZIONE CONFERMATA" inviata **solo** su `accepted`.

**Provider**: `mailer.service.js` usa `nodemailer`, env: `MAIL.enabled`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`.

---

## 4) Flag disabilitazione notifiche

| Flag | Esiste? | Nome | Dove letto |
|------|---------|------|------------|
| **Twilio/WhatsApp** | ✅ Parziale | `TWILIO_ENABLED` | `env.js` → `twilio.service.js` |
| **DISABLE_TWILIO** | ❌ No | — | — |
| **DISABLE_EMAIL** | ❌ No | — | — |
| **MAIL** | ✅ Sì | `MAIL_ENABLED` | `mailer.service.js` (disabilita tutto) |

**Twilio**: `TWILIO_ENABLED=0` disabilita; `twilio.service.isTwilioEnabled()` è il gate. **Non** esiste `DISABLE_TWILIO=1` come alias.

---

## 5) File coinvolti nell’implementazione

```
enea_be/
├── src/
│   ├── env.js                    # + DISABLE_TWILIO, DISABLE_EMAIL
│   ├── api/
│   │   └── reservations.js       # Email solo su accepted + guard DISABLE_EMAIL
│   ├── services/
│   │   ├── mailer.service.js     # + sendReservationConfirmedEmail()
│   │   └── twilio.service.js    # + check DISABLE_TWILIO (via env)
│   └── ...
├── .env.example                  # + DISABLE_TWILIO, DISABLE_EMAIL, SMTP_*
└── AUDIT_RESERVATIONS_NOTIFICATIONS.md
```

---

## 6) Riepilogo

- **Email "PRENOTAZIONE CONFERMATA"**: non implementata; va aggiunta **solo** su transizione a `accepted`.
- **Flag Twilio**: esiste `TWILIO_ENABLED`; va aggiunto `DISABLE_TWILIO=1` come override.
- **Flag Email**: va aggiunto `DISABLE_EMAIL=1` per disabilitare invio email su accepted.
- **Delete**: già senza email (nessuna chiamata mail in `svc.remove`).

---

## 7) Checklist test manuale

| Scenario | Atteso |
|----------|--------|
| create pending | NO email |
| update → accepted (con email cliente) | ✅ Email inviata |
| update → accepted (senza email cliente) | ⚠️ Log "ℹ️ 📧 Email mancante: skip" |
| update → rejected | NO email |
| delete | NO email |
| DISABLE_TWILIO=1 | Nessun WhatsApp/Twilio |
| DISABLE_EMAIL=1 | Nessuna email confermata |

---

## 8) Esempio email (template "Prenotazione confermata")

- **name**: Endri
- **date**: 07/02/2026
- **time**: 19:30
- **people**: 8
- **bookingCode**: R-123 (o R-{DDMM}-{HHMM}-{ultime4} se disponibili)

---

## 9) Tree file coinvolti (prima/dopo)

```
enea_be/
├── src/
│   ├── env.js                         # + DISABLE_TWILIO, DISABLE_EMAIL
│   ├── api/
│   │   ├── reservations.js            # Email solo su accepted + guard DISABLE_EMAIL
│   │   └── notifications.js          # WA webhook: sendReservationConfirmedEmail
│   ├── services/
│   │   ├── mailer.service.js          # + sendReservationConfirmedEmail()
│   │   └── twilio.service.js          # + check DISABLE_TWILIO
│   └── ...
├── .env.example                       # + DISABLE_TWILIO, DISABLE_EMAIL, SMTP_*
└── AUDIT_RESERVATIONS_NOTIFICATIONS.md
```

---

## 10) Git commands suggeriti

```bash
git checkout -b feat/reservations-email-accepted
git add .
git commit -m "feat(reservations): send confirmation email on accepted + env disable notifications"
```
