# Dukaan Sathi — Bolkar batayein, dukaan ka stock update

Voice-first AI inventory assistant for a small Indian kirana shop. The shopkeeper
speaks Hindi or Hinglish into the mic, and the app figure out what they meant,
updates MongoDB "for" them, and replies aloud.

**Stack:** React + Vite (client) · Express 5 + Mongoose + Gemini Flash-Lite (server) · MongoDB

**Status:** MVP complete and verified. 65/65 automated tests pass against a real
MongoDB, the full stack runs end-to-end, and live speech was verified through a
real microphone with a real Gemini key. The DB is left in a clean seeded demo
state.

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
│     │                    VoiceActivityLog, ConfirmDialog, StatusBanner,
│     │                    ApiKeyGate
│     └─ pages/Dashboard.jsx  the whole app, one page
├─ server/                 Express 5 + Mongoose API
│  ├─ config/              env validation, MongoDB lifecycle
│  ├─ controllers/         voice + inventory handlers
│  ├─ middleware/          helmet headers, API-key auth, rate limits,
│  │                       multipart audio upload, error handler (no stack traces)
│  ├─ models/              InventoryItem, VoiceAction
│  ├─ routes/
│  ├─ services/            geminiService (ONLY place with the API key),
│  │                       inventoryService, itemAliases, pendingActions, aiErrors
│  ├─ tests/               api.test.js, security.test.js + setup-env.js
│  ├─ mic-probe.mjs        sends a real audio file through the real AI layer
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
cp ../.env.example .env
# then fill in GEMINI_API_KEY, MONGODB_URI and API_KEY
```

`server/.env` — the values the app reads:

| Variable | Default / example | Notes |
|---|---|---|
| `GEMINI_API_KEY` | — | **required.** Server-side only, never sent to the browser |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/dukaan_sathi` | Local, Atlas, or anything with a real host |
| `MONGODB_HOST` | — | Alternative to `MONGODB_URI`: host only, URI assembled from it. Wins nothing — `MONGODB_URI` takes precedence |
| `MONGODB_PORT` | `27017` | Only read when `MONGODB_HOST` is set |
| `MONGODB_DB` | `dukaan_sathi` | Only read when `MONGODB_HOST` is set |
| `PORT` | `5000` | Express port |
| `API_KEY` | — | **required.** Shop key gating every `/api` route except health |
| `API_KEY_ALLOW_ANONYMOUS` | `false` | Escape hatch to run with no key. Local use only |
| `RATE_LIMIT_VOICE_MAX` | `20` | Voice commands per window — each one costs a Gemini call |
| `RATE_LIMIT_READ_MAX` | `120` | Reads per window — MongoDB only, so deliberately looser |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Length of both budgets |
| `GEMINI_MODEL` | `gemini-flash-lite-latest` | Must accept audio input |
| `CLIENT_ORIGIN` | `http://localhost:5173` | CORS allowlist in dev (comma-separated) |
| `CONFIDENCE_THRESHOLD` | `0.75` | Below this → ask the shopkeeper first |
| `MAX_AUDIO_BYTES` | `10485760` | 10 MB cap |

Generate the shop key with:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

The server **refuses to boot** if `GEMINI_API_KEY`, `MONGODB_URI` or `API_KEY` is
missing or still set to a `your_...` placeholder, so a half-finished `.env` fails
loudly instead of at the first voice command.

---

## Security model

The shop key is a single shared secret, not per-user identity: no passwords, no
sessions. Anyone holding the key has full access to this API. It buys three
concrete things for a single-shop LAN deployment:

1. **Anonymous callers get nothing.** Every route except `/api/health` requires
   the key as `X-API-Key` (or `Authorization: Bearer <key>`). Comparison is
   constant-time, so a wrong key cannot be discovered byte by byte.
2. **Other websites cannot borrow the shopkeeper's browser.** A custom auth
   header forces a CORS preflight, and the allowlist decides who may talk to the
   API.
3. **A runaway client cannot burn the shop's money.** `/api/voice/process` gets a
   tight per-minute budget because each request is one billable Gemini call;
   reads get a looser one. Auth runs *before* the limiter, so an anonymous flood
   is rejected without even consuming a legitimate shop's budget.

The key is **never compiled into the client bundle** — the shopkeeper types it in
once and the browser keeps it in `sessionStorage`. Anything in the JavaScript is
readable by anyone who opens devtools, so a key baked into the bundle would be a
public key. Helmet sets a strict CSP (`script-src 'self'`, `frame-ancestors
'none'`, `object-src 'none'`), which is a real allowlist here because the app has
no CDN and no third-party origin.

---

## Run it

```bash
npm run dev        # server (node --watch :5000) + client (vite :5173) together
# or separately:
npm run dev:server
npm run dev:client
```

Open `http://localhost:5173` and paste the shop key from `server/.env` when
prompted — it is held in `sessionStorage` for the tab, so a reload keeps it but
closing the tab forgets it. Then tap (or press **Space**) the big mic button,
speak, and tap again. The app also **serves the production build from one
process**:

```bash
npm run build && npm start   # http://localhost:5000
```

Seed: a 5-item demo shop is auto-seeded when the collection is empty. Reseed by
hand with `npm run seed` (`--force` to rebuild from scratch).

Shipped with one active demo hop: **Sharma General Store** — Aata 20 kg, Maggi 30
packets, Oil 10 L, Sugar 15 kg, Biscuit 40 packets, each with a low-stock threshold.

---

## Deploy

Everything runs on **Render**: the API, the built client, and MongoDB. No MongoDB
Atlas, no second account. HTTPS is not optional here — `getUserMedia` refuses to
run outside a secure context, so plain-HTTP hosting takes the microphone away.

`render.yaml` at the repo root is a Render Blueprint, so both services are
declared in version control:

| Service | Type | Plan | What it is |
|---|---|---|---|
| `dukaan-sathi` | `web` | `free` | Express API + the built React SPA, one origin |
| `dukaan-sathi-mongo` | `pserv` (private) | `0.5c-512mb` | MongoDB 8, no public IP |

The database is a **private** service: no `onrender.com` subdomain, no public IP.
The only way to reach it is over Render's private network from the web service,
which requires the same workspace and the same region. That is the whole reason
Atlas is not needed — there is no IP allowlist to widen to `0.0.0.0/0`, and no
database password that can leak.

### Steps

1. Push the repo to GitHub. `server/.env` is gitignored, so neither the Gemini key
   nor the shop key is ever pushed.
2. On Render: **New → Blueprint**, then connect
   `https://github.com/priyanshu98989/Dukaan-Sathi`. Render reads `render.yaml`
   and creates both services.
3. Fill in the two values Render prompts for:
   - **`GEMINI_API_KEY`** — from <https://aistudio.google.com/apikey>
   - **`CLIENT_ORIGIN`** — the URL Render assigns, e.g.
     `https://dukaan-sathi.onrender.com`. Optional: the SPA is served by this same
     process, so same-origin requests are not subject to CORS and leaving it blank
     still works.
4. `API_KEY` is generated by Render. **Read it off the dashboard** — the
   shopkeeper types it into the app on first load, and it is the only credential
   the browser ever holds.
5. Open the URL, paste the shop key, allow the microphone.

There is no `MONGODB_URI` to paste. Render injects the database's internal
hostname — which carries a suffix you cannot predict — and `config/env.js`
assembles the connection string from it. `MONGODB_URI` still works exactly as
before if you would rather set it yourself, and wins if both are present.

### The one thing that costs money

Persistent disks are a paid-plan feature, and private services have no free tier,
so `dukaan-sathi-mongo` is `0.5c-512mb` (~$7/mo, 1 GB disk). This is not an
upsell: without a disk, `/data/db` is ephemeral and **every restart and every
redeploy wipes the inventory**, resetting the shop to the 5-item seed. The web
service stays on the free plan, which is genuinely free — a free web service may
*send* private network traffic to a paid service, so it reaches the database fine.

### What changes in production

- The free web plan sleeps after ~15 idle minutes, so the first voice command
  after a gap waits out a cold start. `plan: starter` removes it.
- `NODE_ENV=production` turns on HSTS (`max-age=31536000`). Harmless here, since
  Render serves HTTPS.
- MongoDB runs without auth, matching Render's own MongoDB template. That is safe
  only because the service is unreachable from outside Render. Anything else in
  the same workspace and region can read the shop's stock — do not put another
  tenant's service in this workspace.
- Render's private network is a workspace-level trust model: any service in this
  workspace and region can reach the database. There is no per-service
  authorization.
- Rate-limit counters and pending confirmations are per-instance and in memory,
  so both reset on redeploy. Fine for one instance; a second would need a shared
  store and sticky sessions.
- Disk snapshots are not a backup strategy — Render's own docs warn that restoring
  one can corrupt a MongoDB data directory. Use `mongodump` for real backups.

---

## API

| Method | Route | Body | Purpose |
|---|---|---|---|
| `GET` | `/api/health` | — | DB + uptime. **No key needed** |
| `GET` | `/api/inventory` | — | All items |
| `GET` | `/api/dashboard` | — | Items + low-stock + recent actions in one call |
| `POST` | `/api/voice/process` | multipart `audio` file | Voice in, validated result out |
| `POST` | `/api/voice/confirm` | `{ confirmationId }` | Apply an approved pending action |

Every route except `/api/health` requires the shop key:

```bash
curl -H "X-API-Key: $API_KEY" http://localhost:5000/api/dashboard
```

All responses are JSON with a `status` of `success`, `error`, or
`needs_confirmation`. Every failure is a friendly Hinglish message — no stack
traces, no internals, no API key, ever. A missing or wrong key returns `401`
with `{"code":"UNAUTHORIZED"}`; exceeding a budget returns `429` with
`{"code":"RATE_LIMITED","retryAfterSeconds":60}`, and both carry the standard
`RateLimit-*` response headers.

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

**65/65 pass.** Test isolation is **hard-wired** through the test script:

```
node --test --import ./tests/setup-env.js "tests/**/*.test.js"
```

`setup-env.js` points `MONGODB_URI` at `dukaan_sathi_test` **before** any module
loads `config/env.js` (ESM imports are hoisted, so setting the variable inside the
test file is too late — that bug once sent the suite at the live database and was
fixed). Verify against real MongoDB by setting `TEST_MONGODB_URI`.

`tests/security.test.js` covers the key check (missing, wrong, right, the
anonymous escape hatch), the security headers on success/error/404 responses, and
all three rate-limit guarantees: the voice budget is spent only on voice, an
anonymous flood never reaches the model, and a legitimate caller is still served.

### Testing the real AI layer

The suite stubs Gemini out, so it proves the validation logic but not the key, the
model or the audio decode. `mic-probe.mjs` covers that gap — it runs the server's
real `transcribeAndExtract()` against an audio file, exercising the same key,
model and output-schema check a browser recording goes through:

```bash
cd server
node mic-probe.mjs path/to/clip.wav audio/wav
```

It prints the model, a masked key, then the parsed JSON contract. Exit code 0
means the whole AI path is alive.

---

## Verification status (final)

- **Gemini key:** **VALID.** The key in `server/.env` completes a live
  `generateContent` call (HTTP 200) against `gemini-flash-lite-latest`.
- **Live microphone → Gemini → parsed intent:** **PASS.** A 6-second WAV recorded
  from the machine's default input device was pushed through the real
  `transcribeAndExtract()`. Spoken *"aata kitna bacha hai"* came back as
  `intent: CHECK_STOCK, item: aata, quantity: null, unit: kg, confidence: 0.98` —
  transcript, intent, item and unit all correct, confidence above the 0.75
  threshold.
- **Live end-to-end over HTTP:** three real audio uploads to
  `POST /api/voice/process` returned `200` and logged
  `applied CHECK_STOCK for Aata` / `for Maggi`. Real Gemini calls, real DB.
- **Automated tests:** `65/65` pass, isolated to `dukaan_sathi_test` with the real
  DB untouched.
- **Auth:** `/api/health` and the SPA shell are open; `/api/inventory` and
  `/api/dashboard` return `401` with no key and with a wrong key, `200` with the
  right one via either `X-API-Key` or `Authorization: Bearer`.
- **Rate limits:** with the voice budget set to 3, requests 1–3 returned `200` and
  4–5 returned `429`. With the read budget at 5, the 6th read returned `429`.
  Anonymous voice floods returned `401`, never `429`, so they cannot exhaust a
  legitimate shop's budget or reach Gemini.
- **Security headers:** CSP, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options:
  nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy` and HSTS
  (production only) all present on success, error and 404 responses.
- **No secret in the bundle:** `client/dist` scanned for the Gemini key, the shop
  key and the string `GEMINI_API_KEY` — zero hits. `vite build` clean
  (27 modules).
- **Graceful failure:** a rejected key returns HTTP 502 with a friendly Hinglish
  message, the failure is written to the activity log, and no stock is touched.
  No key, stack trace, or internal error reaches the client.

## Known limits (MVP)

- The shop key is a single shared secret with no per-user identity and no
  revocation short of restarting the server. Fine for one shop on a LAN; not how
  you would run a multi-tenant service.
- Rate-limit counters live in process memory, so they reset on restart and are
  per-instance. Correct for a single-process deployment; use a shared store if you
  ever run several.
- Item name/unit resolution is a hand-written alias table scoped to the 5 seeded
  items; adding stock requires adding aliases in `services/itemAliases.js`.
- Pending confirmations live in server memory (5-minute TTL) — not durable across
  a server restart, which is fine for a single-shop MVP.
- HSTS is off in development so the app loads over plain HTTP on a shop LAN. Turn
  it on once it is behind real HTTPS.
- **Chrome records `audio/webm`, which the AI layer cannot read.** `useRecorder`
  negotiates a preference list (`audio/ogg;codecs=opus` → `audio/mp4` →
  `audio/wav` → `audio/webm` as a last resort), but desktop Chrome usually
  supports only the last one, so voice commands come back as
  `Is browser ka audio format support nahi hai`. Firefox records ogg/opus and
  works as-is. The fix is to transcode on the way in — decode the webm clip with
  `AudioContext.decodeAudioData` in the browser and re-encode as 16 kHz mono WAV
  before upload — which needs no new dependency on either side. Until that lands,
  use Firefox, or record a `.wav` and push it through `mic-probe.mjs`.