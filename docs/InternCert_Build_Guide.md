# InternCert — Secure Build Guide (Foundation → Release)

Stack: React/Vite (frontend) · Node/Express (API) · MongoDB (Mongoose) · Redis (sessions, rate limits, BullMQ queue) · Razorpay (payments) · Resend (email) · Cloudinary or S3 (signed asset storage).

---

## Step 0 — Repo & tooling setup

```bash
mkdir intern-cert && cd intern-cert
git init
mkdir -p server/{controllers,models,routes,middleware,services,workers,utils,config}
mkdir -p frontend/src/{pages,components,lib,hooks}
npm init -y -w server -w frontend   # or two separate package.json if not using workspaces
```

- [ ] `.gitignore`: `node_modules`, `.env`, `dist`, `build`
- [ ] `.env.example` at repo root listing every required var with placeholder values (never real secrets)
- [ ] Install core server deps: `express mongoose ioredis bullmq cookie-parser helmet cors zod pino razorpay resend`
- [ ] Install dev deps: `nodemon eslint prettier husky jest supertest`
- [ ] Install frontend deps: `react react-router-dom axios` (or fetch), `vite`
- [ ] Set up ESLint + Prettier configs shared across `server/` and `frontend/`
- [ ] `husky` pre-commit: lint + `npm test`
- [ ] GitHub Actions (or equivalent) CI workflow: lint → typecheck → unit tests → `npm audit --production` → build. This runs on every PR from commit 1, not bolted on later.

---

## Step 1 — Environment schema (build this before any route)

`server/config/env.js`

```js
import { z } from 'zod'
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().default(4000),
  MONGO_URI: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  COOKIE_SECRET: z.string().min(32),
  FRONTEND_URL: z.string().url(),
  RAZORPAY_KEY_ID: z.string().min(1),
  RAZORPAY_KEY_SECRET: z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  CLOUD_STORAGE_KEY: z.string().min(1),
})
export const env = schema.parse(process.env) // throws & exits on missing/invalid
```

- [ ] Import `env` at the very top of `server/index.js` — nothing else executes if this throws.
- [ ] In production, all payment/email/storage vars are required (no "missing → mock" branches anywhere downstream).

---

## Step 2 — App skeleton & baseline middleware

`server/index.js`

- [ ] `import { env } from "./config/env.js"` (first line)
- [ ] `helmet()`, `cors({ origin: env.FRONTEND_URL, credentials: true })`
- [ ] `cookie-parser(env.COOKIE_SECRET)`, `express.json({ limit: "100kb" })`
- [ ] `pino-http` request logger with request-id
- [ ] Mount routers (added incrementally in later steps)
- [ ] Global error handler last: logs `err.stack` server-side, returns generic `{error: "internal_error", requestId}` to client — never `err.message`
- [ ] `app.set("trust proxy", <explicit config per environment>)` — not a bare `1`

`server/config/db.js` — Mongoose connect with retry/backoff, TLS enabled.
`server/config/redis.js` — `ioredis` client, used later by rate limiter and BullMQ.

- [ ] **Gate**: server boots, connects to Mongo + Redis, refuses to boot with bad/missing env.

---

## Step 3 — Auth & sessions (build before any other feature)

Models: `server/models/User.js`

```js
{ email, password_hash, role: ["student","admin"], session_version: Number (default 0) }
```

Routes: `server/routes/auth.js` → `authController.js`

- [ ] `POST /auth/register` — hash password (`argon2` or `bcrypt`), create user
- [ ] `POST /auth/login` — verify password, issue session: sign JWT containing `{sub, role, session_version}`, set as **HttpOnly, Secure, SameSite=Lax (or None+CSRF if cross-site), short-lived cookie**. No token returned in JSON body.
- [ ] `POST /auth/logout` — clear cookie
- [ ] `GET /auth/me` — returns current user from `req.user` (set by auth middleware)
- [ ] `POST /auth/forgot-password` — generate `crypto.randomBytes(32)` token, store only its `sha256` hash + expiry on user, email the raw token via Resend. Always return same generic response whether or not the email exists.
- [ ] `POST /auth/reset-password` — hash incoming token, compare, check expiry, set new password, **increment `session_version`** (invalidates all existing sessions)

Middleware: `server/middleware/auth.js`

- [ ] Verify cookie JWT signature + expiry
- [ ] Load user, compare `token.session_version === user.session_version`; reject if mismatched
- [ ] `requireRole("admin")` variant for admin routes, shorter TTL cookie for admin login

CSRF: `server/middleware/csrf.js`

- [ ] Double-submit cookie token issued on login, required header on every state-changing request; validated before controller runs

Rate limiting: `server/middleware/rateLimiter.js`

- [ ] Redis-backed (`rate-limit-redis` + `express-rate-limit`), separate limiter instances per route group: `login`, `reset`, `verify`, `contact`, `admin`

Frontend:

- [ ] `frontend/src/lib/api.ts` — fetch wrapper with `credentials:"include"`, reads CSRF token from a readable cookie/meta tag and attaches header
- [ ] `/login`, `/register`, `/forgot-password`, `/reset-password/:token` pages
- [ ] Auth context/hook (`useAuth`) backed by `GET /auth/me`

**Gate (release-gate tests SEC-09, SEC-10):**

- [ ] Cross-site state-changing request without CSRF token → rejected
- [ ] Reuse of pre-reset session cookie after password reset → rejected

---

## Step 4 — Domain models & invariants (schema before controllers)

`server/models/Internship.js` — includes `taskSchema[]` with `deadline_days`
`server/models/Enrollment.js`

```js
{ user_id, internship_id, status: ["active","expired","closed"], current_task, end_date }
```

- [ ] Unique partial index: `{ user_id: 1, internship_id: 1 }` filtered to `status:"active"`

`server/models/TaskSubmission.js`

```js
{ enrollment_id, task_number, status: ["pending","approved","rejected"], content, reviewed_by }
```

`server/models/Payment.js`

```js
{ user_id, razorpay_order_id, razorpay_payment_id, amount, currency,
  status: ["created","paid","failed","refunded","partially_refunded"], internship_id }
```

- [ ] Unique index on `razorpay_order_id`

`server/models/Certificate.js`

```js
{
  ;(enrollment_id(unique),
    verification_code(opaque, unique),
    pdf_url,
    issued_at)
}
```

`server/models/AuditLog.js`

```js
{
  ;(actor_id,
    action,
    target_type,
    target_id,
    before,
    after,
    ip,
    request_id,
    reason,
    created_at)
}
```

(append-only — no update/delete routes ever defined for this model)

- [ ] Write a Mongoose migration/init script that creates all indexes explicitly (`ensureIndexes` at boot in non-prod, or a checked-in migration in prod).

---

## Step 5 — Payment & enrollment flow (highest-risk — build with tests alongside code)

`server/services/razorpay.js` — thin wrapper around the Razorpay SDK (create order, fetch order, fetch payment, verify signature, refund).

`server/controllers/enrollController.js`

- [ ] `POST /enroll/order` — check active-enrollment invariant (rely on the unique index, catch duplicate-key as 409), create Razorpay order, insert `Payment{status:"created", user_id: req.user.id, ...}`
- [ ] `POST /enroll/verify` —
  1. Look up `Payment` by `{ razorpay_order_id, user_id: req.user.id }`; 403 if not found
  2. If already `paid`, return existing enrollment (idempotent replay)
  3. Verify Razorpay signature
  4. Fetch payment from Razorpay API; compare `amount`, `currency`, `status===captured`
  5. Mongo transaction: `Payment.status="paid"` + create `Enrollment` in one commit
- [ ] No fallback/mock branch reachable outside `NODE_ENV==="test"` — if you need local testing, build a separate `server/services/razorpay.mock.js` swapped in only by test config, never by a runtime missing-secret check

`server/routes/webhooks.js` + `webhookController.js`

- [ ] `POST /webhooks/razorpay` — verify `X-Razorpay-Signature` against raw body (mount this route with `express.raw()`, before the global `express.json()`)
- [ ] Dedupe: store processed `event.id` in a `WebhookEvent` collection/Redis set; skip if already processed
- [ ] Apply `captured/failed/refunded/disputed` to Payment state machine
- [ ] Nightly reconciliation job (BullMQ repeatable job) comparing local `Payment.status` vs Razorpay for any `created` older than N minutes

**Gate (SEC-01 to SEC-06):** run these against a Razorpay test-mode account before moving to Step 6.

---

## Step 6 — Task workflow

`server/controllers/taskController.js`

- [ ] `POST /tasks/submit` — reject if `now > enrollment.end_date` or `now > task.due_at`; create `TaskSubmission{status:"pending"}`

`server/controllers/adminController.js`

- [ ] `POST /admin/submissions/:id/review` — atomic:
  ```js
  const sub = await TaskSubmission.findOneAndUpdate(
    { _id, status: 'pending', task_number: enrollment.current_task },
    { status: decision, reviewed_by: req.user.id },
    { new: true },
  )
  if (!sub) return res.status(409).json({ error: 'stale_review' })
  ```
- [ ] On approval: increment `enrollment.current_task` (never decrement/overwrite), write `AuditLog` entry
- [ ] Scheduled worker (BullMQ repeatable): flips `Enrollment.status` `active → expired` past `end_date`

---

## Step 7 — Certificate issuance (async, queue-based)

`server/workers/certificateWorker.js` (BullMQ worker, separate process or same process with worker thread)

- [ ] Enqueue job on enrollment completion, job ID = `enrollment_id` (BullMQ dedupes by job ID → idempotent)
- [ ] Job: generate PDF, generate `verification_code = crypto.randomUUID()`, upload to private storage, insert `Certificate{enrollment_id (unique)}` — duplicate-key on retry = success no-op, send email

`server/controllers/verifyController.js`

- [ ] `GET /verify/:code` — look up by opaque code, return minimal fields (`name, internship, issue_date`), rate-limited

Frontend:

- [ ] `/verify/:code` route matching the exact URL format encoded in the QR (`FRONTEND_URL/verify/<code>`) — build and test this route together with the QR generator, not separately

**Gate (SEC-11, SEC-13, SEC-14).**

---

## Step 8 — Admin surface

- [ ] DTO validation (`zod`) on every admin write endpoint — explicit allowlist of fields, reject unknown keys
- [ ] Pagination: clamp `limit` server-side (max 100), cursor-based
- [ ] MFA/step-up: add TOTP (`otpauth` + `qrcode`) enrollment for admin users; require re-entry of a fresh TOTP code before certificate revocation / refund / content-delete endpoints
- [ ] Every admin mutation writes an `AuditLog` row

**Gate (SEC-12, SEC-15).**

---

## Step 9 — Frontend build-out

Build pages against already-working, tested backend endpoints only (no placeholder CTAs):

- [ ] Public: landing, internship listing (paginated), verification page
- [ ] Auth: login, register, forgot/reset password
- [ ] Student: dashboard, task submission, payment/checkout, certificate download (signed URL, time-limited)
- [ ] Admin: submission review queue, internship CRUD, certificate/refund actions (with step-up prompt)
- [ ] Input validation mirrors backend DTOs (e.g. LinkedIn URL: `new URL()` parse + hostname allowlist client-side, re-validated server-side regardless)
- [ ] Metrics/testimonials sections pull from real aggregate API endpoints, not hardcoded arrays

---

## Step 10 — Cross-cutting hardening pass

- [ ] Regex-escape helper applied everywhere user input reaches `$regex` (search endpoints)
- [ ] ObjectId validation middleware on every `:id` route param → structured 400 on `CastError`
- [ ] `maxlength`/format validators on every free-text Mongoose field
- [ ] CSP + HSTS + Permissions-Policy set at the CDN/hosting layer for the static frontend

---

## Step 11 — Release gate

Run the full test matrix before any production deploy:

| ID     | Test                                         | Pass condition                  |
| ------ | -------------------------------------------- | ------------------------------- |
| SEC-01 | Boot prod without Razorpay secrets           | Refuses to start                |
| SEC-02 | Call dev/mock endpoints in staging/prod      | Absent/rejected                 |
| SEC-03 | Verify payment using another user's order ID | Rejected pre-mutation           |
| SEC-04 | Replay valid verification 10x concurrently   | 1 Payment, 1 Enrollment         |
| SEC-05 | Valid signature, wrong amount                | Rejected                        |
| SEC-06 | Browser closes after capture                 | Webhook reconciles state        |
| SEC-07 | `javascript:...linkedin.com` input           | Rejected                        |
| SEC-08 | HTML injected into email fields              | Escaped, no active markup       |
| SEC-09 | Cross-site state-changing request            | Rejected (CSRF)                 |
| SEC-10 | Reuse JWT/session after password reset       | Rejected                        |
| SEC-11 | Open generated QR URL                        | Correct verify page loads       |
| SEC-12 | Approve stale/old task twice                 | 409, `current_task` unchanged   |
| SEC-13 | Complete enrollment twice / worker restart   | 1 certificate, 1 email          |
| SEC-14 | Sequential-guess certificate codes           | No enumeration at scale         |
| SEC-15 | Admin revokes certificate                    | MFA required, audit row written |

- [ ] Dependency scan clean (`npm audit --production`)
- [ ] Backup/restore drill on MongoDB completed
- [ ] Load test on `/enroll/verify` and certificate worker specifically (concurrency/race conditions)

---

## Architecture summary

See the accompanying diagram for the request-flow overview. Tiers, top to bottom: **Browser → Edge (CDN/WAF, CORS/CSRF) → API (Auth+Sessions, Domain Services) → Data (MongoDB, Redis/Queue) → External providers (Razorpay, Resend, Storage)**, with a signed webhook returning from Razorpay to the API as the async reconciliation path.
