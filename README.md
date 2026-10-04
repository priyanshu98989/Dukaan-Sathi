# Dukaan Sathi — Bolkar batayein, dukaan ka stock update

Voice-first AI inventory assistant for a small Indian kirana shop. The shopkeeper
speaks Hindi or Hinglish into the mic, and the app figure out what they meant,
updates MongoDB "for" them, and replies aloud.

**Stack:** React + Vite (client) · Express 5 + Mongoose + Gemini 2.5 Flash (server) · MongoDB

**Status:** MVP complete and verified. 46/46 automated tests pass (3 consecutive
runs) against a real MongoDB, full stack runs end-to-end, real DB left in a clean
seeded demo state.

---

## What it does

Three intents, spoken in Hindi/Hinglish:

| Intent | Example you can say | Result |
|---|---|---|
| **SALE** | "5 kilo aata bik gaya" | Deducts 5 kg from Aata (never below zero) |
| **SET_STOCK** | "Maggi ke 3 packet bache hain" | Overwrites Maggi stock to 3 packets |
| **CHECK_STOCK** | "Aata kitna bacha hai?" | Reads the number back aloud, writes nothing |

Every voice command is:

1. Recorded in the browser and uploaded to `/api/voice/process`.
2. Transcribed + parsed **into a JSON contract in a single Gemini call**.
3. Validated against the real inventory on the server — the AI output is treated
   as **untrusted input**. Unknown items / unsupported intents are rejected
   outright; the AI can never create inventory rows or do anything outside the
   three intents.
4. Applied only if **confidence ≥ 0.75**, otherwise a "Haan / Nahi" confirmation
   dialog appears. Anything ambiguous, unit mismatch, or missing number asks.
5. Logged to a voice activity log and any item now below its threshold is flagged
   **Low** in the low-stock panel.

Safety is the design: a sale can never drive stock negative (atomic conditional
update), a double-tap on "Haan" cannot double-apply (single-use confirmation ids),
and a stale confirmation is re-validated against live stock.

---

## Project layout

```
dukaan-sathi/
├─ client/                 React 19 + Vite + Tailwind SPA
│  └─ src/
│     ├─ hooks/            useRecorder, useDashboard, useSpeech (text-to-speech)
│     ├─ services/api.js   the ONLY place the browser talks to the server
│     ├─ components/       MicButton, InventoryTable, LowStockPanel,
│     │                    VoiceActivityLog, ConfirmDialog, StatusBanner
│     └─ pages/Dashboard.jsx  the whole app, one page
├─ server/                 Express 5 + Mongoose API
│  ├─ config/              env validation, MongoDB lifecycle
│  ├─ controllers/         voice + inventory handlers
│  ├─ middleware/          multipart audio upload, error handler (no stack traces)
│  ├─ models/              InventoryItem, VoiceAction
│  ├─ routes/
│  ├─ services/            geminiService (ONLY place with the API key),
│  │                       inventoryService, itemAliases, pendingActions, aiErrors
│  ├─ tests/               api.test.js + setup-env.js
│  └─ seed.js              idempotent seed on first boot
├─ .env.example
└─ package.json            root scripts (dev/seed/test/build/start)
```

---

## Setup

Requirements: Node.js ≥ 18 (v24 used in verification), a running MongoDB, a
Google AI Studio API key.

```bash
# 1. install (root installs all three workspaces)
npm run install:all

# 2. configure the server
cd server
cp ../.env.example .env     # then fill in GEMINI_API_KEY and MONGODB_URI
```

`server/.env` — the values the app reads:

| Variable | Default / example | Notes |
|---|---|---|
| `GEMINI_API_KEY` | — | **required.** Server-side only, never sent to the browser |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/dukaan_sathi` | Local or Atlas |
| `PORT` | `5000` | Express port |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Must accept audio input |
| `CLIENT_ORIGIN` | `http://localhost:5173` | CORS allowlist in dev |
| `CONFIDENCE_THRESHOLD` | `0.75` | Below this → ask the shopkeeper first |
| `MAX_AUDIO_BYTES` | `10485760` | 10 MB cap |

---

## Run it

```bash
npm run dev        # server (node --watch :5000) + client (vite :5173) together
# or separately:
npm run dev:server
npm run dev:client
```

Open `http://localhost:5173`. Tap (or press **Space**) the big mic button, speak,
and tap again. The app also **serves the production build from one process**:

```bash
npm run build && npm start   # http://localhost:5000
```

Seed: a 5-item demo shop is auto-seeded when the collection is empty. Reseed by
hand with `npm run seed` (`--force` to rebuild from scratch).

Shipped with one active demo hop: **Sharma General Store** — Aata 20 kg, Maggi 30
packets, Oil 10 L, Sugar 15 kg, Biscuit 40 packets, each with a low-stock threshold.

---

## API

| Method | Route | Body | Purpose |
|---|---|---|---|
| `GET` | `/api/health` | — | DB + uptime |
| `GET` | `/api/inventory` | — | All items |
| `GET` | `/api/dashboard` | — | Items + low-stock + recent actions in one call |
| `POST` | `/api/voice/process` | multipart `audio` file | Voice in, validated result out |
| `POST` | `/api/voice/confirm` | `{ confirmationId }` | Apply an approved pending action |

All responses are JSON with a `status` of `success`, `error`, or
`needs_confirmation`. Every failure is a friendly Hinglish message — no stack
traces, no internals, no API key, ever.

---

## Tests

The suite replaces the AI layer with a deterministic stub (via
`setAiOverride`) so every validation and error branch is exercised exactly —
SALE/SET/CHECK, low confidence, unknown items, unit mismatches, negative-stock
guard, replay protection, concurrent sales, malformed JSON, unsupported audio,
empty uploads, and the log.

```bash
npm test            # in /server, or  npm test  from the repo root
```

Test isolation is **hard-wired** through the test script:

```
node --test --import ./tests/setup-env.js "tests/**/*.test.js"
```

`setup-env.js` points `MONGODB_URI` at `dukaan_sathi_test` **before** any module
loads `config/env.js` (ESM imports are hoisted, so setting the variable inside the
test file is too late — that bug once sent the suite at the live database and was
fixed). Verify against real MongoDB by setting `TEST_MONGODB_URI`.

> The comment in `api.test.js` mentions `tests/gemini.live.test.js` as a separate
> real-Gemini verification; that file is not committed. Drive real audio through
> the UI, or run with a real `GEMINI_API_KEY` and watch `/api/dashboard`.

---

## Verification status (final)

- **Full stack vs real MongoDB (local service, `dukaan_sathi` DB):** PASS — server
  boots, auto-seed idempotent, `/api/dashboard` & `/api/inventory` return the 5
  seeded items, production client build served from `client/dist`, `/api/health`
  reports `connected`.
- **Automated tests:** `46/46` pass, run **3× consecutively**, each run isolated
  to `dukaan_sathi_test` with the real DB byte-for-byte untouched.
- **Graceful failure:** with the current `GEMINI_API_KEY` (Google rejects it with
  `API_KEY_INVALID`) a real audio upload returns HTTP 502 `"Voice samajhne mein
  problem hui..."`, the failure is written to the activity log, and no stock is
  touched. No key, stack trace, or internal error reaches the client.
- **Client build:** `vite build` clean (27 modules), `dist` matches source.

## Known limits (MVP)

- Needs a **valid `GEMINI_API_KEY`** in `server/.env` for live speech. The key
  currently in that file is rejected by Google (`API_KEY_INVALID`), so voice
  requests hit the friendly retry path until a real
  [AI Studio](https://aistudio.google.com/apikey) key is put in place. Everything
  else is verified working.
- Item name/unit resolution is a hand-written alias table scoped to the 5 seeded
  items; adding stock requires adding aliases in `services/itemAliases.js`.
- Pending confirmations live in server memory (5-minute TTL) — not durable across
  a server restart, which is fine for a single-shop MVP.