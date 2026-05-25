# Snapchef — Integration & Deployment Plan

**Target file on approval:** `context/deployment/deploy-plan.md`
**Platform:** Cloudflare Workers (Paid plan, $5/mo) via `@astrojs/cloudflare`
**Stack:** Astro 6 SSR + React 19 + Tailwind 4 + Supabase (Auth + Postgres + Storage) + Node 24
**Subdomain:** `*.workers.dev` (custom domain deferred)
**CI:** Manual first-deploy; auto-deploy on merge wired in a later phase

---

## Context

Snapchef is ready for its first production deploy. The codebase, adapter, env schema, and middleware are in place; what's missing is the operational scaffolding around it — Cloudflare account setup, scoped API token, production secrets, an initial Supabase migration with RLS, a CPU budget appropriate for vision + recipe generation, log persistence beyond the dashboard window, and a CI deploy job. This plan executes those gaps in order, with a manual first deploy as the validation gate before any automation touches production. Every decision in `infrastructure.md`'s risk register is mapped to a concrete phase below.

The exploration agent confirmed: `wrangler.jsonc` exists with `nodejs_compat`, `observability` enabled, and the Astro adapter entrypoint correctly wired; `astro.config.mjs` declares `SUPABASE_URL` / `SUPABASE_KEY` via `astro:env/server`; `src/lib/supabase.ts` reads them server-side; CI lints + builds but does not deploy; and `supabase/migrations/` is empty.

---

## Phase Tracker

- [ ] **Phase -1** — Prerequisites: local CLI tooling installed
- [ ] **Phase 0** — Pre-flight verification (read-only checks)
- [ ] **Phase 1** — Cloudflare account + scoped API token
- [ ] **Phase 2** — Supabase production project + initial migration with RLS
- [ ] **Phase 3** — Wrangler configuration hardening (CPU, observability, env)
- [ ] **Phase 4** — Production secrets staging (`wrangler secret put`)
- [ ] **Phase 5** — Manual first deploy + smoke test
- [ ] **Phase 6** — Logpush → R2 wiring for log retention
- [ ] **Phase 7** — Image-preprocessing decision (recorded, not yet implemented)
- [ ] **Phase 8** — Secrets-drift guardrail (`mise run check-secrets`)
- [ ] **Phase 9** — CI auto-deploy on merge to `main`
- [ ] **Phase 10** — Rollback & smoke-test drill

---

## Phase -1 — Prerequisites: local CLI tooling

Bootstrap the toolchain on the developer machine before touching any cloud account. Everything below is local-only; nothing is mutated in production.

**Node 24 + npm (via mise — already declared in `mise.toml`):**

- [ ] `brew install mise` (macOS) or follow https://mise.jdx.dev/getting-started.html for other OSes
- [ ] `mise install` in the repo root — installs Node 24 from `mise.toml`
- [ ] `node -v` → `v24.x.x`; `npm -v` → present
- [ ] `npm ci` — install project dependencies (`wrangler`, `@astrojs/cloudflare`, `astro`, `@supabase/ssr` are all pinned in `package.json`)

**Wrangler CLI (Cloudflare):**

- [ ] No global install needed — `wrangler ^4` is already a dev dependency. Always invoke as `npx wrangler …` (or `mise run deploy`).
- [ ] If a global install is preferred for ergonomics: `npm install -g wrangler` — version must match the project pin (`^4`) to avoid config schema drift.
- [ ] `npx wrangler --version` → `4.x.x`
- [ ] `npx wrangler login` — opens browser OAuth on first run. **This is a human-only step** (the agent must not run it unattended). Alternative for CI / headless: set `CLOUDFLARE_API_TOKEN` env var (created in Phase 1) and skip `login`.

**Supabase CLI:**

- [ ] `brew install supabase/tap/supabase` (macOS) or see https://supabase.com/docs/guides/local-development/cli/getting-started for npm/scoop/apt instructions. **Do not** `npm install -g supabase` — the npm package is a thin wrapper and is not the recommended path.
- [ ] `supabase --version` → present
- [ ] Docker Desktop installed and running — required for `supabase start` (local stack). `docker info` should succeed.
- [ ] `supabase login` — human-only OAuth step (browser); needed before `supabase link` in Phase 2.

**Optional but recommended:**

- [ ] `gh` (GitHub CLI) — used for repo-secrets management in Phase 9. `brew install gh` then `gh auth login`.

## Phase 0 — Pre-flight verification (read-only)

- [ ] `wrangler.jsonc` has `compatibility_flags: ["nodejs_compat"]` and `observability.enabled = true`
- [ ] `astro.config.mjs` declares `SUPABASE_URL` and `SUPABASE_KEY` under `env.schema` with `context: "server", access: "secret"`
- [ ] `src/lib/supabase.ts` imports from `astro:env/server` (not `import.meta.env` / `process.env`)
- [ ] `package.json` pins `@astrojs/cloudflare ^13`, `wrangler ^4`, `astro ^6`
- [ ] `mise.toml` has Node 24 + `deploy` task
- [ ] `.dev.vars` is gitignored (`git check-ignore .dev.vars`)
- [ ] No `wrangler pages …` references in scripts, docs, or CI (risk: writes to wrong product)

## Phase 1 — Cloudflare account + scoped API token

**Human-only steps (dashboard):**
- [ ] Sign up / log in at dash.cloudflare.com
- [ ] Subscribe **Workers Paid** ($5/mo) — Free tier's 10ms CPU is insufficient for LLM + image work
- [ ] Note the **Account ID** (dashboard right sidebar)
- [ ] Create API token → *Custom token* with permissions:
  - Account → Workers Scripts: **Edit**
  - Account → Workers Routes: **Edit**
  - User → User Details: **Read**
  - (no DNS, no billing, no other accounts)
- [ ] Store token + account ID in a local password manager

**Agent-permitted:**
- [ ] `npx wrangler whoami` — verify token works from laptop (`CLOUDFLARE_API_TOKEN` env var)

## Phase 2 — Supabase production project + initial migration with RLS

**Human-only steps (Supabase dashboard):**
- [ ] Create production project, region close to author
- [ ] Capture `SUPABASE_URL` (project URL) and `SUPABASE_KEY` (anon/public key — used server-side via SSR client)
- [ ] Note the service-role key separately for migrations only (never stored as a Worker secret)

**Agent-permitted:**
- [ ] `npx supabase login` and `npx supabase link --project-ref <ref>`
- [ ] `npx supabase migration new initial_schema`
- [ ] Author the initial migration covering MVP entities (saved recipes, uploads metadata if persisted server-side, any user-owned tables). **Hard rule (CLAUDE.md):** every table must `ENABLE ROW LEVEL SECURITY` and define per-operation, per-role policies in the same migration file.
- [ ] `npx supabase db push` to apply to the linked project
- [ ] Verify in dashboard: each new table shows RLS enabled with named policies
- [ ] Record the **backward-compatibility rule** in `CLAUDE.md` (alongside the existing RLS rule): every future migration must be additive / nullable / non-destructive for at least one Worker version, since `wrangler rollback` does not roll back the DB

## Phase 3 — Wrangler configuration hardening

Edit `wrangler.jsonc`:

- [ ] Add `"limits": { "cpu_ms": 30000 }` — bumps default 30s CPU to the Paid-plan default; raise toward `300000` (5 min) only if Phase 5 smoke test reveals headroom issues
- [ ] Confirm `"observability": { "enabled": true }` is present (it is — keep it)
- [ ] Confirm `"main": "..."` points at `@astrojs/cloudflare/entrypoints/server` (already correct)
- [ ] Confirm `"compatibility_date"` is within the last ~90 days; bump if not
- [ ] Do **not** add Supabase keys under `"vars"` — secrets go via `wrangler secret put` (Phase 4)

## Phase 4 — Production secrets staging

- [ ] `npx wrangler secret put SUPABASE_URL` (paste value from Phase 2)
- [ ] `npx wrangler secret put SUPABASE_KEY` (paste anon key from Phase 2)
- [ ] `npx wrangler secret list` — verify both names appear (values are not shown)
- [ ] Confirm `.dev.vars` has the **same two keys** with the same Supabase project's values (for local parity)

## Phase 5 — Manual first deploy + smoke test

- [ ] `npm run build` locally — confirm `dist/_worker.js/index.js` exists
- [ ] `npx wrangler deploy` — capture the deployed URL (`https://snapchef.<account>.workers.dev`)
- [ ] **Smoke test (golden path):**
  - [ ] Hit the deploy URL → home page renders (no 500)
  - [ ] `/auth/signup` → email+password signup; confirmation email arrives
  - [ ] `/auth/signin` → sign in; `/dashboard` reachable
  - [ ] Image upload + recipe generation (the end-to-end LLM path) returns within 30s
  - [ ] Saved recipe persists, signing out + back in shows it (validates RLS works, not against)
- [ ] `npx wrangler tail` open in a second terminal during smoke test — confirm no untracked errors
- [ ] If any step fails: **do not proceed to CI**; fix and redeploy first

## Phase 6 — Logpush → R2 wiring

`wrangler tail` is live-only; the dashboard's log retention on the $5 tier is short. For a 3-week MVP this matters: an intermittent bug reported by a friend 24h after it fired must still be queryable.

- [ ] Create an R2 bucket (dashboard or `wrangler r2 bucket create snapchef-logs`)
- [ ] Configure Logpush job from the Workers project to that R2 bucket (dashboard: Workers → snapchef → Logs → Logpush)
- [ ] Set retention (R2 lifecycle rule) to 30 days for MVP — adjust if cost matters
- [ ] Smoke test: trigger one request, wait ~5 min, confirm a log object lands in R2

## Phase 7 — Image-preprocessing decision (record now, implement later)

Per `infrastructure.md` risk #1 + pre-mortem: `sharp` does not run in workerd. The decision **must be made before the upload handler is written**, not after.

- [ ] Pick one and record the choice as a code comment near the upload handler entry point:
  - **Option A — Client-side resize** (`createImageBitmap` + canvas, send already-shrunk JPEG). Cheapest, no platform pivot risk. Recommended for MVP.
  - **Option B — Send raw to vision model.** Highest LLM token cost; simplest code.
  - **Option C — Defer to Cloudflare Images** ($/op) or pivot processing to a Container. Document the trigger condition for moving here.
- [ ] If Option A: cap upload to 3 images server-side as a defense-in-depth check

## Phase 8 — Secrets-drift guardrail

Per `infrastructure.md` risk: `.dev.vars` vs deployed Worker secrets drift silently. Catch it early.

- [ ] Add a `mise.toml` task `check-secrets`:
  - Reads keys from `.dev.vars` (names only)
  - Runs `wrangler secret list --format json` and extracts deployed names
  - Diffs the two sets; non-zero exit if they differ
- [ ] Run it as part of local pre-deploy checklist; consider wiring into Phase 9's CI deploy job as a gate

## Phase 9 — CI auto-deploy on merge to `main`

Only after Phase 5 has succeeded **and** at least one manual redeploy has been done cleanly.

- [ ] Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to GitHub repo secrets
- [ ] Extend `.github/workflows/ci.yml` with a `deploy` job that:
  - `needs: build` (only runs if lint + build pass)
  - Runs only on `push` to `main` (not on PRs)
  - Uses `cloudflare/wrangler-action@v3` with the token + account ID
  - Passes `SUPABASE_URL` / `SUPABASE_KEY` from repo secrets through to the build step (already wired) so `astro:env/server` resolves at build time correctly
- [ ] Optional but recommended: PR preview deploys via `wrangler versions upload` + `wrangler versions deploy --preview-alias pr-<num>`. Gate with Cloudflare Access if the URL must stay private.
- [ ] Merge a no-op PR to verify the deploy job runs end-to-end

## Phase 10 — Rollback & smoke-test drill

Validate rollback **before** the first real incident.

- [ ] `npx wrangler deployments list` — record the current live deployment ID
- [ ] Deploy a trivial change (e.g. footer text)
- [ ] `npx wrangler rollback <previous-deployment-id>` — confirm reverts in seconds
- [ ] Re-deploy the trivial change to restore
- [ ] Document the rollback command + DB-migration backward-compat reminder in `README.md` deploy section

---

## Approval & Logs Boundary

**Agent may run unattended:** `wrangler deploy`, `wrangler tail`, `wrangler secret list`, `wrangler versions list/upload/deploy`, `wrangler rollback`, `supabase migration new`, `supabase db push` (against the linked dev/staging project).

**Human-only (panel/click):** first-time `wrangler login`, Cloudflare account creation + Paid subscription, API token creation, R2 bucket creation (first time), Supabase project creation, rotating the Supabase service-role key, dropping any Supabase table, deleting the Worker.

---

## Verification (end-to-end)

After all phases:

1. Visit `https://snapchef.<account>.workers.dev`, complete signup → upload → recipe-generate → save → re-load flow.
2. `npx wrangler tail` for ~30s during a request — confirm structured logs flow.
3. Check the R2 bucket — at least one Logpush object present from today.
4. Verify in Supabase dashboard that the latest test recipe is owned by the test user and **not** visible to a second test account (RLS smoke).
5. Merge a trivial change to `main` and watch CI deploy job complete green.
6. Run `wrangler rollback` against a prior deployment; visit URL; confirm previous version live.

---

## External Integrations — Edge-case Support Notes

- **Supabase Auth confirmation emails:** the default sender is rate-limited (~3/h on free Supabase tier). If smoke testing burns through it, configure a custom SMTP (Resend, Postmark) under Supabase → Authentication → SMTP **before** sharing with close friends.
- **`astro:env/server` build-time vs request-time:** GitHub Actions build job **must** have `SUPABASE_URL` / `SUPABASE_KEY` available before `npm run build` runs, otherwise the bundle silently ships `undefined`. CI already wires this — do not remove.
- **Wrangler login on a fresh machine:** if running deploys from a new laptop and the API token doesn't carry account scope discovery, set `CLOUDFLARE_ACCOUNT_ID` in the env too.
- **R2 bucket name collisions:** R2 bucket names are account-scoped (not global) but must be unique within the account — pick `snapchef-logs` and stick with it.
- **Supabase migration ordering vs Worker rollback:** if a migration has already run and you `wrangler rollback`, the older Worker is now running against a newer schema. This only works if migrations are additive — the rule recorded in Phase 2 is the load-bearing safeguard, not the rollback command itself.
- **Cookies in middleware on `*.workers.dev`:** Supabase SSR cookies should work out-of-the-box on `workers.dev`, but if signin succeeds and `/dashboard` still bounces to `/auth/signin`, the first suspect is `SameSite` / `Secure` cookie flags in the SSR client config.
