---
project: snapchef
researched_at: 2026-05-25
recommended_platform: Cloudflare Workers
runner_up: Railway
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 SSR (React 19 islands, Tailwind 4)
  runtime: Cloudflare workerd (via @astrojs/cloudflare)
---

## Recommendation

**Deploy on Cloudflare Workers** (not Pages — see "Pages-vs-Workers" below).

The tech stack already pins `@astrojs/cloudflare`, the developer has hands-on Cloudflare familiarity, the 30s LLM response NFR fits Workers' wall-clock model (CPU time excludes `fetch()` wait, raisable to 5 min on the Paid plan), and the platform scores Pass on all five agent-friendly criteria — including first-party MCP servers and `llms.txt`-published docs. External Supabase sidesteps the only weak axis (managed-service co-location). At ~$5/mo with $5/MB request/CPU headroom, cost is bounded and predictable for a solo MVP serving the author + close friends.

## Platform Comparison

Scoring legend: **P** = Pass, **◐** = Partial, **F** = Fail. Score = count of P + 0.5×◐.

| Platform | CLI-first | Managed/SLS | Agent docs | Stable deploy API | MCP/Integration | Score |
|---|---|---|---|---|---|---|
| **Cloudflare Workers** | P | P | P (`llms.txt`) | P | P (first-party) | **5.0** |
| **Railway** | P | ◐ (container) | P (`.md` variant) | P | P (GA) | **4.5** |
| **Vercel** | P | P | ◐ | P | P (Beta, Feb 2026) | **4.5** |
| **Render** | P | ◐ | ◐ | P | P (GA Aug 2025) | **4.0** |
| **Fly.io** | P | ◐ (VMs) | ◐ | P | P (GA) | **4.0** |
| **Netlify** | P | P | ◐ | P | P (GA) | **4.5*** |

\*Netlify scores 4.5 numerically but is **soft-failed** by the 30s NFR: synchronous Functions cap at 26s (Pro, on request); the only path past it is Edge Functions + SSE streaming, which is a refactor.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Exact stack alignment, developer familiarity, $5/mo Paid plan with 10M req + 30M CPU-ms included. CPU limit raisable to 5 min on Paid (GA, March 2025). 30s LLM calls are wall-clock — CPU budget covers parsing/encoding only, not the await. First-party MCP servers (API MCP, Workers Bindings, Observability) and a public `llms.txt` make agent-driven ops first-class. Workers Static Assets is GA and is now the canonical SSR target; Pages is in maintenance posture.

#### 2. Railway (Runner-up)

If the project ever hits a workerd ceiling (Sharp, large multipart parsing, Node-only libs), Railway is the cleanest pivot: swap `@astrojs/cloudflare` for `@astrojs/node` standalone, point Nixpacks at the build, done. No Dockerfile, no function timeouts, $5/mo Hobby + ~$3–8 usage. MCP server and Claude Code agent integration are GA. Trades edge globality (irrelevant here — single region) and the $5 included credit for a much simpler runtime mental model.

#### 3. Vercel

Fluid Compute now allows 300s function duration on Hobby (raised from 60s, GA), which would cover the 30s NFR. Official Vercel MCP server (Beta, Feb 2026) and a mature CLI. Two blockers, though: (a) Hobby ToS prohibits commercial/revenue-generating use — even speculative monetization pushes you to Pro at $20/dev/mo; (b) Astro 6 SSR has an open esbuild regression on Vercel (withastro/astro#16258) that costs evening hours of a 3-week MVP if it bites.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **No `sharp` in workerd.** Server-side image preprocessing (EXIF strip, resize before sending 4MB photos to the vision model to control token cost) needs Cloudflare Images ($/op), a pure-JS resizer (slow, CPU-hungry), or client-side resizing.
2. **CPU budget vs multi-image vision requests.** Default 30s CPU is raisable to 5 min, but base64-encoding multiple 4MB image blobs to data URLs for the LLM is CPU-bound, not I/O — three images per request can spike close to the wall on slower regions.
3. **`.dev.vars` vs Worker secrets drift.** Local dev reads `.dev.vars`; production reads `wrangler secret put`. Drift is a silent solo-dev bug — local works, prod 500s on `undefined`.
4. **Workers Logs retention is short on the $5 tier.** Debugging a 3-hour-old intermittent bug requires an external sink (Logpush) — not free, not on by default.
5. **Pages-vs-Workers terminology drift.** The Astro adapter now targets Workers via Workers Static Assets, but tutorials and even this project's earlier docs reference Pages fluidly. `wrangler pages deploy` and `wrangler deploy` both look successful but write to different products.

### Pre-Mortem — How This Could Fail

Six months in, Snapchef stalled. The MVP shipped on Workers in week 3 as planned. By month two, the author tried to add server-side image preprocessing — strip EXIF and resize before sending to the vision model to cap LLM cost per recipe. Sharp wouldn't run in workerd; the pure-JS alternative chewed 200ms+ of CPU per image at 4MB inputs, and three images per request started tripping the bumped 5-min CPU on slower regions. The fix — moving preprocessing to a Cloudflare Container or punting back to client-side — took two evenings of after-hours work the 3-week budget had no slack for. Meanwhile, an intermittent recipe-generation 500 affected one close-friends test user; Workers Logs retention on the $5 tier was too short and no external sink was wired, so the bug took a week to reproduce. By month four, secrets had drifted between `.dev.vars` and the live Worker — local worked, prod returned undefined env, and the author rebuilt the secret pipeline twice before realising `astro:env` was caching at build time in CI.

### Unknown Unknowns

- **`nodejs_compat` is incomplete.** Some `fs`, `stream` consumers, and `crypto.createHmac` variants throw or behave subtly differently. Supabase-JS server works fine; reaching for a Node-only third-party helper later may not.
- **`astro:env/server` resolution timing.** The same code path resolves at *build time* in Vite-resolved modules and at *request time* in the Worker entry. CI builds without secrets staged correctly will silently bake `undefined` into the bundle.
- **Local-vs-cloud env sprawl.** `.env` (Node tools), `.dev.vars` (workerd local), Supabase's `.env.local`, plus `wrangler secret put` for prod — four places, easy to forget one.
- **Cloudflare Pages is in maintenance posture, not deprecated.** Pages still works but new features (Workers Static Assets, Workers Logs improvements, MCP coverage) ship to Workers first. Older Pages tutorials use a different deploy command and secrets path.
- **CPU includes JSON parsing of accumulated LLM streams.** A token-stream accumulated and `JSON.parse`'d at the end can spike CPU at the tail — distinct from the I/O wait during streaming.

## Operational Story

- **Preview deploys**: Workers supports *versioned* deploys (`wrangler versions upload` + `wrangler versions deploy`) and per-PR ephemeral preview URLs via GitHub Actions + the Wrangler action. Preview URLs are publicly reachable by default — gate with Cloudflare Access (Zero Trust) if the dev URL must stay private to the author + close friends.
- **Secrets**: Production secrets live in Cloudflare via `wrangler secret put SUPABASE_URL` / `wrangler secret put SUPABASE_KEY`. Local dev secrets live in `.dev.vars` (gitignored). GitHub Actions reads `CLOUDFLARE_API_TOKEN` and Supabase secrets from repo secrets. Rotation: rotate in Supabase first, then `wrangler secret put` (zero downtime — next request picks up new value). Tokens are scoped to one Worker + Workers Scripts:Edit; no DNS, no billing, no other projects.
- **Rollback**: `wrangler rollback [deployment-id]` reverts to a prior deployment. Time-to-revert is seconds (Workers atomic deploy swap). **DB migrations don't roll back automatically** — every Supabase migration must be designed to be backward-compatible with the previous Worker version, or rollback only restores the code while the schema stays forward.
- **Approval**: Agent may perform unattended: `wrangler deploy` to staging URL, `wrangler tail`, `wrangler secret list`, `wrangler versions list`. Human-only (panel/click): rotating the primary Supabase service key, dropping a Supabase table, deleting the Worker, changing Cloudflare account-level settings, first-time `wrangler login`.
- **Logs**: `wrangler tail` for live tail. Persistent logs via Workers Logs (dashboard) — short retention on the $5 tier; wire Logpush to R2 or external sink if longer retention matters. Cloudflare Observability MCP exposes structured log queries to the agent.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Image preprocessing dead-end (no Sharp in workerd) | Devil's advocate | M | M | Decide before week 1: either skip server preprocessing (send raw to vision model, accept higher token cost), or do it client-side with `createImageBitmap` + canvas; document the decision in code comments near the upload handler. |
| CPU budget spike on multi-image upload | Devil's advocate | M | M | Cap upload to 3 images, server-side; bump `cpu_ms` to 30000 (or higher up to 5 min) in `wrangler.toml`; benchmark base64 encoding cost on a slow region before claiming MVP-ready. |
| `.dev.vars` vs Worker secret drift | Devil's advocate | H | L | Document the four-env sprawl in `README.md` once; add a `mise run check-secrets` task that diffs `.dev.vars` keys vs deployed Worker secrets (lists, not values). |
| Workers Logs retention insufficient to debug late-noticed bug | Devil's advocate | M | M | Wire Logpush → R2 in Plan Mode deploy plan from day one; cost is negligible at MVP traffic, retention is what matters. |
| Wrong deploy command writes to Pages instead of Workers | Devil's advocate | L | M | Enforce in `package.json`/`mise.toml`: only `wrangler deploy` (not `wrangler pages deploy`) is wired; remove any Pages references from CLAUDE.md / deploy docs once Plan Mode confirms target. |
| Six-month image-preprocessing pivot eats slack the 3-week MVP doesn't have | Pre-mortem | M | H | Make the preprocessing decision **before** writing the upload handler, not after; if it can't be deferred, treat Cloudflare Containers OR Railway pivot as the contingency and document the trigger condition. |
| `astro:env` resolution baking `undefined` into CI build | Unknown unknowns | M | H | CI must `wrangler secret put` (or use GitHub Actions secret push step) **before** the build job; fail the build if `SUPABASE_URL` or `SUPABASE_KEY` are missing — don't let it deploy a broken bundle. |
| `nodejs_compat` shim incompleteness blocks a future dependency | Unknown unknowns | L | M | Before adding any Node-only npm dep, check it against Cloudflare's `nodejs_compat` matrix; default to workerd-native or browser-isomorphic alternatives. |
| Supabase migration rolls forward while Worker rolls back | Research finding | M | H | Every migration must be backward-compatible (additive columns, nullable, no destructive renames) for at least one Worker version; document this as a hard rule in CLAUDE.md alongside the existing RLS rule. |
| Token-stream tail JSON parse spikes CPU | Unknown unknowns | L | L | Stream tokens to client incrementally (SSE); avoid server-side accumulate-then-parse; if accumulating, do it in chunks. |

## Getting Started

These commands are validated against the versions in `tech-stack.md`: Astro 6 + `@astrojs/cloudflare` v13+ + Node 24 + `mise`. Wrangler is the only platform CLI required.

1. **Sign up for Cloudflare Workers Paid plan ($5/mo).** Free tier's 10ms CPU and 100k req/day caps are too tight for vision + recipe generation. Done in the Cloudflare dashboard, not via CLI.
2. **Create a scoped API token in the Cloudflare dashboard.** Permissions: *Account → Workers Scripts:Edit*, *Account → Workers Routes:Edit*, *User → User Details:Read* — nothing else. No DNS, no billing, no other projects. Store as `CLOUDFLARE_API_TOKEN` in GitHub repo secrets and in `.dev.vars` for local Wrangler.
3. **Local dev uses the Astro dev server, not Wrangler.** `npm run dev` (Astro 6 + Cloudflare adapter v13 runs against the real `workerd` runtime via Vite plugin — `wrangler dev` is redundant for app-level work). Use `wrangler dev` only when reproducing a Worker-specific issue.
4. **Stage secrets for production**: `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_KEY`. Verify with `npx wrangler secret list`.
5. **First deploy**: `npx wrangler deploy`. The adapter writes to `dist/_worker.js/index.js`; `wrangler.toml`'s `main` points there. **Do not use `wrangler pages deploy`** — this project targets Workers via Workers Static Assets, not Pages.
6. **Configure CPU**: in `wrangler.toml` set `[limits] cpu_ms = 30000` (default is 30s; raise toward 300000 = 5min if image preprocessing or recipe parsing approaches the limit). Requires Paid plan.
7. **Wire log retention**: configure Logpush to R2 (or external) so logs older than the dashboard tier's retention window remain queryable.
8. **Hand off to Plan Mode**: open Plan Mode with prompt *"Wykonajmy pierwsze wdrożenie w oparciu o `@infrastructure.md`, zgodnie ze stackiem z `@tech-stack.md`"* — Plan Mode produces `context/deployment/deploy-plan.md` as the audit trail.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration (not applicable — Workers does not use containers for this stack).
- CI/CD pipeline setup (GitHub Actions exists per `tech-stack.md`; Plan Mode will fill in the deploy step).
- Production-scale architecture (multi-region HA, DR, SLA commitments) — explicitly MVP scope.
- Co-located database/storage selection — Supabase is fixed by `tech-stack.md`.
