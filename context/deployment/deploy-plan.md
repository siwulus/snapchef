# Snapchef — Integration & Deployment Plan

**Platform:** Cloudflare Workers (Paid plan, $5/mo) via `@astrojs/cloudflare`
**Stack:** Astro 6 SSR + React 19 + Tailwind 4 + Supabase (Auth + Postgres + Storage) + Node 24
**Subdomain:** `*.workers.dev` (custom domain deferred)
**Deploy model:** **Cloudflare Workers Builds** watches the GitHub repo and deploys automatically on every push to `main`. **No manual `wrangler deploy`. No GitHub Actions deploy job.** PRs may produce preview deploys via the same integration.

---

## Context

Snapchef is ready for its first production deploy. The codebase, adapter, env schema, and middleware are in place; what's missing is the operational scaffolding around it — Cloudflare account setup, the Workers Builds GitHub integration, production secrets (configured in the Cloudflare dashboard, not via `wrangler secret put`), an initial Supabase migration with RLS, a CPU budget appropriate for vision + recipe generation, and log persistence beyond the dashboard window.

Because deployment is triggered by Cloudflare watching the repo, **the merge button is the deploy button**. The GitHub Actions workflow stays scoped to lint + build verification on PRs; it never runs `wrangler deploy`. The first deploy occurs the first time `main` advances after Workers Builds is connected.

The exploration agent confirmed: `wrangler.jsonc` has `nodejs_compat` + `observability` + the correct Astro adapter entrypoint; `astro.config.mjs` declares `SUPABASE_URL` / `SUPABASE_KEY` via `astro:env/server`; `src/lib/supabase.ts` reads them server-side; CI lints + builds; and `supabase/migrations/` is empty.

---

## Phase Tracker

- [ ] **Phase -1** — Prerequisites: local CLI tooling installed
- [ ] **Phase 0** — Pre-flight verification (read-only checks)
- [ ] **Phase 1** — Cloudflare account (Workers Paid)
- [ ] **Phase 2** — Supabase production project + initial migration with RLS
- [ ] **Phase 3** — Wrangler configuration hardening (CPU, observability, env)
- [ ] **Phase 4** — Connect Workers Builds to the GitHub repo
- [ ] **Phase 5** — Configure production secrets & vars in the Cloudflare dashboard
- [ ] **Phase 6** — First deploy via merge to `main` + smoke test
- [ ] **Phase 7** — Logpush → R2 wiring for log retention
- [ ] **Phase 8** — Image-preprocessing decision (recorded, not yet implemented)
- [ ] **Phase 9** — Branch-deploy / PR previews (optional but recommended)
- [ ] **Phase 10** — Rollback drill via the Cloudflare dashboard

---

## Phase -1 — Prerequisites: local CLI tooling

Local tooling is for **development and DB migrations only** — never for production deploys.

**Node 24 + npm (via mise — already declared in `mise.toml`):**

- [ ] `brew install mise` (macOS) or follow https://mise.jdx.dev/getting-started.html for other OSes
- [ ] `mise install` in the repo root — installs Node 24 from `mise.toml`
- [ ] `node -v` → `v24.x.x`; `npm -v` → present
- [ ] `npm ci` — install project dependencies

**Wrangler CLI (Cloudflare) — local dev + diagnostics only, NOT for deploy:**

- [ ] No global install needed — `wrangler ^4` is a dev dependency. Always invoke as `npx wrangler …`.
- [ ] `npx wrangler --version` → `4.x.x`
- [ ] **Do not run `npx wrangler deploy` against the production Worker.** Deploys are owned by Workers Builds. Use Wrangler only for `wrangler dev` (local), `wrangler tail` (live logs), and read-only `wrangler deployments list` / `wrangler versions list`.
- [ ] `npx wrangler login` is optional — only needed if you intend to use `wrangler tail` from your laptop. Human-only browser OAuth step.

**Supabase CLI:**

- [ ] `brew install supabase/tap/supabase` (macOS) or see https://supabase.com/docs/guides/local-development/cli/getting-started for npm/scoop/apt. **Do not** `npm install -g supabase`.
- [ ] `supabase --version` → present
- [ ] Docker Desktop installed and running — required for `supabase start` (local stack). `docker info` should succeed.
- [ ] `supabase login` — human-only OAuth step (browser); needed before `supabase link` in Phase 2.

**Optional but recommended:**

- [ ] `gh` (GitHub CLI) — `brew install gh` then `gh auth login`. Used to set up the GitHub side of the Cloudflare integration smoothly.

## Phase 0 — Pre-flight verification (read-only)

- [ ] `wrangler.jsonc` has `compatibility_flags: ["nodejs_compat"]` and `observability.enabled = true`
- [ ] `astro.config.mjs` declares `SUPABASE_URL` and `SUPABASE_KEY` under `env.schema` with `context: "server", access: "secret"`
- [ ] `src/lib/supabase.ts` imports from `astro:env/server` (not `import.meta.env` / `process.env`)
- [ ] `package.json` pins `@astrojs/cloudflare ^13`, `wrangler ^4`, `astro ^6`
- [ ] `mise.toml` has Node 24 declared (Workers Builds will mirror this)
- [ ] `.dev.vars` is gitignored (`git check-ignore .dev.vars`)
- [ ] No `wrangler pages …` references in scripts, docs, or CI (risk: writes to wrong product)
- [ ] `.github/workflows/ci.yml` does **not** contain any `wrangler deploy` step (deploys belong to Cloudflare, not to GitHub Actions)

## Phase 1 — Cloudflare account (Workers Paid)

**Human-only steps (dashboard):**

- [ ] Sign up / log in at dash.cloudflare.com
- [ ] Subscribe **Workers Paid** ($5/mo) — Free tier's 10ms CPU is insufficient for LLM + image work
- [ ] Note the **Account ID** (dashboard right sidebar) — used in Phase 4 to identify the target account
- [ ] **No API token is required for the deploy path** — Workers Builds uses its own GitHub App authorization, not a long-lived API token. Skip the scoped-token step from earlier drafts of this plan.

## Phase 2 — Supabase production project + initial migration with RLS

**Human-only steps (Supabase dashboard):**

- [ ] Create production project, region close to author
- [ ] Capture `SUPABASE_URL` (project URL) and `SUPABASE_KEY` (anon/public key — used server-side via SSR client)
- [ ] Note the service-role key separately for migrations only (never stored as a Worker secret)

**Agent-permitted (local):**

- [ ] `npx supabase login` (if not done in Phase -1) and `npx supabase link --project-ref <ref>`
- [ ] `npx supabase migration new initial_schema`
- [ ] Author the initial migration covering MVP entities (saved recipes, uploads metadata if persisted server-side, any user-owned tables). **Hard rule (CLAUDE.md):** every table must `ENABLE ROW LEVEL SECURITY` and define per-operation, per-role policies in the same migration file.
- [ ] `npx supabase db push` to apply to the linked project
- [ ] Verify in dashboard: each new table shows RLS enabled with named policies
- [ ] Record the **backward-compatibility rule** in `CLAUDE.md` (alongside the existing RLS rule): every future migration must be additive / nullable / non-destructive for at least one Worker version, since rolling a Worker back via the Cloudflare dashboard does **not** roll back the DB

## Phase 3 — Wrangler configuration hardening

Edit `wrangler.jsonc` — this file is what Workers Builds will read on each deploy:

- [ ] Add `"limits": { "cpu_ms": 30000 }` — bumps default 30s CPU to the Paid-plan default; raise toward `300000` (5 min) only if Phase 6 smoke test reveals headroom issues
- [ ] Confirm `"observability": { "enabled": true }` is present (it is — keep it)
- [ ] Confirm `"main": "..."` points at `@astrojs/cloudflare/entrypoints/server` (already correct)
- [ ] Confirm `"compatibility_date"` is within the last ~90 days; bump if not
- [ ] Confirm `"name"` matches what you want to appear in the Cloudflare dashboard (the URL will be `https://<name>.<account-subdomain>.workers.dev`)
- [ ] Do **not** add Supabase keys under `"vars"` — secrets go via the dashboard (Phase 5)
- [ ] Commit and merge these changes to `main` **before** connecting Workers Builds (Phase 4), or expect the very first build after connecting to consume them

## Phase 4 — Connect Workers Builds to the GitHub repo

This is the load-bearing phase. After it lands, every push to `main` deploys.

**Human-only steps (Cloudflare dashboard → Workers & Pages → Create → Workers → Connect to Git):**

- [ ] Authorize the **Cloudflare GitHub App** on the org/account that owns the snapchef repo. Restrict its access to just this repo (not "all repositories").
- [ ] Select the `snapchef` repository.
- [ ] **Production branch:** `main`.
- [ ] **Build configuration:**
  - Build command: `npm ci && npm run build`
  - Deploy command: `npx wrangler deploy` (this is Cloudflare's own runner running it inside the build environment — not your laptop)
  - Root directory: repository root (`/`)
  - Node version: `24` (matches `mise.toml`)
- [ ] **Do not enable auto-deploy yet** if the dashboard offers a "deploy now from latest commit" toggle — toggle it on only after Phase 5 (secrets) is complete, otherwise the first build will deploy a Worker that 500s on missing env.
- [ ] Confirm the integration shows the linked repo + branch in the project's _Settings → Builds_ panel.

## Phase 5 — Configure production secrets & vars in the Cloudflare dashboard

Because deploys are owned by Workers Builds, **secrets live in the Cloudflare dashboard, not on a laptop running `wrangler secret put`**. Setting them via Wrangler is still possible, but mixing both sources is the most common cause of "works locally, prod is undefined" drift on this deploy model — pick one source of truth (the dashboard) and stay there.

**Human-only steps (Workers & Pages → snapchef → Settings → Variables and Secrets):**

- [ ] Add `SUPABASE_URL` as a **Secret** (not a plain variable). Production environment.
- [ ] Add `SUPABASE_KEY` (anon/public key) as a **Secret**. Production environment.
- [ ] Verify in _Settings → Variables_: both names appear with `[secret]` masking. Confirm `Environment = Production`.

## Phase 6 — First deploy via merge to `main` + smoke test

- [ ] Confirm the working tree on `main` is clean and includes Phase 3's `wrangler.jsonc` updates.
- [ ] Open a trivial PR (e.g. add `## Deploy` heading to `README.md`) → squash-merge to `main` → watch Workers Builds in the Cloudflare dashboard pick it up. The build log streams in _Workers & Pages → snapchef → Deployments_.
- [ ] Build completes green → deployment URL goes live at `https://<name>.<account-subdomain>.workers.dev`.
- [ ] **Smoke test (golden path):**
  - [ ] Hit the deploy URL → home page renders (no 500)
  - [ ] `/auth/signup` → email+password signup; confirmation email arrives
  - [ ] `/auth/signin` → sign in; `/dashboard` reachable
  - [ ] Image upload + recipe generation (the end-to-end LLM path) returns within 30s
  - [ ] Saved recipe persists; signing out + back in shows it (validates RLS works _for_ the user, not _against_)
  - [ ] Open a second browser / incognito with a different account — confirm the first user's recipe is **not** visible (RLS smoke from the other side)
- [ ] `npx wrangler tail` from laptop during smoke test — confirm no untracked errors. Read-only; safe to run.
- [ ] If any step fails: **revert the merge on `main`** (which automatically redeploys the prior version via Workers Builds) or use the dashboard rollback path (Phase 10). Do not "fix forward" until the regression is understood.

---

## Approval & Mutation Boundary

**Owned by Cloudflare Workers Builds (no human action per deploy):** every production deploy. Triggered by `git push` / merge to `main`. Source of truth = the `main` branch + the dashboard config (build command, env, secrets).

**Agent may run unattended (read-only or local):** `wrangler tail`, `wrangler deployments list`, `wrangler versions list`, `wrangler dev` (local), `supabase migration new`, `supabase db push` (against the linked Supabase project — note this _is_ a mutation of the DB but not of the Worker).

**Human-only (panel/click):** Cloudflare account creation + Paid subscription, Workers Builds connect / disconnect, GitHub App authorization, **all** Cloudflare secret/var changes (Phase 5), R2 bucket creation, Logpush job creation, rotating the Supabase service-role key, dropping any Supabase table, deleting the Worker, dashboard rollback.

---

## Verification (end-to-end)

After all phases:

1. Visit `https://<name>.<account-subdomain>.workers.dev`, complete signup → upload → recipe-generate → save → re-load flow.
2. `npx wrangler tail` for ~30s during a request — confirm structured logs flow.
3. Check the R2 bucket — at least one Logpush object present from today.
4. Verify in Supabase dashboard that the latest test recipe is owned by the test user and **not** visible to a second test account.
5. Merge a trivial PR → watch Workers Builds run end-to-end and the new deployment go live without any laptop intervention.
6. Roll back to the prior deployment via the dashboard; visit URL; confirm previous version live; re-merge to restore.

---

## External Integrations — Edge-case Support Notes

- **Cloudflare GitHub App scope:** authorize it for just the snapchef repo, not "All repositories". Re-scoping later requires a human dashboard step on both Cloudflare and GitHub.
- **First build fails on missing secrets:** the most common first-time error is the build succeeding but the runtime 500ing because secrets were added as _runtime_ vars only, not as _build_ vars. Astro's `astro:env/server` resolves at build time for Vite-bundled modules — see Phase 5's "Critical" bullet. If it bites, the symptom is `SUPABASE_URL is undefined` in `wrangler tail` immediately after a successful build.
- **Workers Builds Node version:** if the build picks a different Node than `mise.toml` declares, set Node version explicitly in the build config (Phase 4). Astro 6 requires Node ≥ 20.18; pin 24 for parity with local.
- **`@astrojs/cloudflare` adapter detection:** Workers Builds detects the adapter from `astro.config.mjs` and runs `wrangler deploy` against the generated `dist/_worker.js`. No additional config required, but if the build outputs to a different directory in the future (custom `outDir`), the deploy command needs updating.
- **Supabase Auth confirmation emails:** the default sender is rate-limited (~3/h on free Supabase tier). If smoke testing burns through it, configure a custom SMTP (Resend, Postmark) under Supabase → Authentication → SMTP **before** sharing with close friends.
- **Branch protection on `main`:** since merge = deploy, protect `main`. Require PR review + green CI before merge. Without it, a direct push to `main` ships to production with no review gate.
- **Concurrent merges race:** Workers Builds processes builds serially per project, so two rapid merges deploy in order — but in-flight requests during the swap may briefly see either version. Atomic at the request level; not transactional across requests.
- **Build environment cache:** Workers Builds caches `node_modules` between runs. If a dependency upgrade behaves oddly in prod but works locally, the build cache is the first suspect — clear it from _Settings → Builds → Clear build cache_.
- **R2 bucket name collisions:** R2 bucket names are account-scoped (not global) but must be unique within the account — pick `snapchef-logs` and stick with it.
- **Rollback vs migrations:** rolling back a Worker via the dashboard does NOT roll back Supabase migrations. The migration backward-compat rule (Phase 2) is what keeps rollback safe — without it, rollback can succeed in the Cloudflare panel and still produce 500s because the running code expects a column that no longer exists.
- **Cookies on `*.workers.dev`:** Supabase SSR cookies work out-of-the-box on `workers.dev`, but if signin succeeds and `/dashboard` still bounces to `/auth/signin`, the first suspect is `SameSite` / `Secure` cookie flags in the SSR client config.
