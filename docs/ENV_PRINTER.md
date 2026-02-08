# Variabili ambiente stampante termica

Percorso file e utilizzo delle variabili per la stampa ESC/POS (TCP 9100).

---

## Variabili principali

| Variabile | Default | Descrizione | File utilizzati |
|-----------|---------|--------------|------------------|
| `PRINTER_ENABLED` | `true` | Abilita/disabilita stampa (API + CLI) | `print-settings.service.js`, `print-order.js`, `print.js`, `thermal-printer.service.js`, `src/cli/print/index.js` |
| `PRINTER_IP` | `127.0.0.1` | Indirizzo IP stampante | `print-settings.service.js`, `print-order.js`, `print.js`, `thermal-printer.service.js`, `src/cli/print/index.js` |
| `PRINTER_HOST` | (alias) | Alias di PRINTER_IP (CLI compat) | `print-settings.service.js` (fallback), `print.js`, `src/cli/print/index.js` |
| `PRINTER_PORT` | `9100` | Porta TCP (raw ESC/POS) | `print-settings.service.js`, `print-order.js`, `print.js`, `thermal-printer.service.js`, `src/cli/print/index.js` |
| `PRINTER_COLS` | 48 (80mm) / 42 (58mm) | Colonne testo (da PRINTER_WIDTH_MM se non impostato) | `thermal-printer.service.js`, `src/cli/print/index.js` |
| `PRINTER_WIDTH_MM` | `80` | Larghezza rullo mm (80 o 58) | `thermal-printer.service.js`, `src/cli/print/index.js` |
| `PRINTER_CHUNK_SIZE` | `2048` | Dimensione chunk invio TCP (CLI) | `src/cli/print/index.js` |
| `PRINTER_THROTTLE_MS` | `10` | Pausa tra chunk (0/10/20) per stabilità | `src/cli/print/index.js` |
| `PRINTER_CODEPAGE` | `cp858` | Codepage (cp858, cp850, cp437) — evita € | `thermal-printer.service.js`, `src/cli/print/index.js` |
| `PRINTER_CUT` | `true` | Taglio automatico dopo stampa | `print-order.js`, `print.js`, `thermal-printer.service.js` |

---

## Coda stampa (API runtime)

| Variabile | Default | Descrizione | File utilizzati |
|-----------|---------|--------------|------------------|
| `PRINT_QUEUE_ENABLED` | `true` | Abilita coda `print_jobs` | `print-jobs.service.js`, `server.js` |
| `PRINT_QUEUE_INTERVAL_MS` | `1500` | Intervallo polling coda | `print-jobs.service.js` |

---

## CLI kitchen layout (solo `npm run print:kitchen`)

| Variabile | Default | Descrizione | File utilizzati |
|-----------|---------|-------------|------------------|
| `KITCHEN_SHOW_PHONE` | `true` | Mostra telefono nel slip cucina | `src/cli/print/index.js` |
| `KITCHEN_SHOW_NOTES` | `true` | Mostra note varianti | `src/cli/print/index.js` |
| `KITCHEN_SHOW_TABLE` | `true` | Mostra sala/tavolo | `src/cli/print/index.js` |

---

## Categorie ordini (layout comanda)

| Variabile | Default | Descrizione | File utilizzati |
|-----------|---------|-------------|------------------|
| `PIZZERIA_CATEGORIES` | PIZZE,PIZZE ROSSE,PIZZE BIANCHE | Categorie pizzeria | `print-order.js` |
| `KITCHEN_CATEGORIES` | ANTIPASTI,FRITTI,BEVANDE | Categorie cucina | `print-order.js` |

---

## Percorso file di utilizzo

- **API ordini (conto/comanda):** `src/api/orders.js` → `print-order.js`, `print-settings.service.js`
- **Stampa conto:** `src/utils/print-order.js`, `src/utils/print.js`
- **Coda stampa:** `src/services/print-jobs.service.js`
- **Prenotazioni (daily/placecards):** `src/services/thermal-printer.service.js`
- **CLI test:** `src/cli/print/index.js`
- **Config stampa DB→ENV:** `src/services/print-settings.service.js`

---

## Regole priorità

- **API:** DB `print_settings` vince su ENV (coerenza con FE Admin)
- **CLI:** usa sempre ENV (non accede al DB)
- **Fallback:** se caricamento DB fallisce, `print-settings.service` usa ENV
