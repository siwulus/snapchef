---
run_date: 2026-05-21
starter_id: 10x-astro-starter
project_name: snapchef
package_manager: npm
language_family: js
cwd_strategy: git-clone
phase_3_status: ok
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: snapchef
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

### Why this stack

Solo author building Snapchef as a 3-week after-hours MVP: a mobile-friendly
web app with email+password auth, per-user image upload, LLM-powered vision
(product recognition) and recipe generation, plus per-user private persistence
of saved recipes. The recommended default for `(web, js)` is 10x-astro-starter
— Astro 6 + React 19 + TypeScript + Tailwind 4 + Supabase + Cloudflare. It
directly covers the load-bearing FRs out of the box: Supabase Auth handles
FR-001/FR-002, Supabase Storage handles FR-003 image uploads, and Supabase
Postgres with row-level security gives the per-user data isolation called out
in the privacy guardrail and FR-009–012. TypeScript end-to-end clears all four
agent-friendly gates. Deployment lands on Cloudflare Pages/Workers (starter
default); the ~30s edge-runtime ceiling matches the PRD's 30s response-time
NFR for AI calls, with Vercel/Fly available as fallbacks if image-recognition
latency creeps past the ceiling. CI runs on GitHub Actions with
auto-deploy-on-merge — what the starter ships with, and the right shape for
solo + short timeline.

## Pre-scaffold verification

| Signal | Value | Severity |
| --- | --- | --- |
| GitHub repo | `przeprogramowani/10x-astro-starter` | — |
| `pushed_at` | 2026-05-17T10:33:39Z (4 days ago) | fresh |
| npm package check | skipped — `cmd_template` uses `git clone`, no npm `create-*` CLI | n/a |

No staleness warnings. Proceeded to scaffold.

## Scaffold log

**Resolved command:**
```
git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install
```

**Strategy:** clone the starter repo into a temp directory (`.bootstrap-scaffold/`), delete the cloned `.git/`, move files up applying the conflict matrix, then delete the temp directory.

**Exit code:** 0 (clone + npm install both succeeded).

**npm install:** 774 packages added in 43s; 309 packages looking for funding.

**Files moved into cwd:**
- `.env.example`, `.gitignore`, `.nvmrc`, `.prettierrc.json` (no conflict)
- `.github/`, `.husky/`, `.vscode/` (no conflict)
- `README.md`, `astro.config.mjs`, `components.json`, `eslint.config.js`, `tsconfig.json`, `wrangler.jsonc` (no conflict)
- `package.json`, `package-lock.json` (no conflict)
- `node_modules/`, `public/`, `src/`, `supabase/` (no conflict)

**Conflicts resolved (sidelined as `.scaffold` siblings):**
- `CLAUDE.md` — existing user file kept; scaffold's copy saved as `CLAUDE.md.scaffold`. Diff with `diff CLAUDE.md CLAUDE.md.scaffold` to see what the starter ships.

**`.gitignore` handling:** cwd had no existing `.gitignore`, so the scaffold's copy moved in directly (no append-merge needed).

**`context/` preservation:** verified — your existing `context/foundation/`, `context/changes/`, `context/archive/` are untouched.

**Cleanup:** `.bootstrap-scaffold/.git/` deleted before move-up; `.bootstrap-scaffold/` removed after move.

## Post-scaffold audit

**Command:** `npm audit --json`

**Severity counts:**

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 1 |
| Moderate | 10 |
| Low | 0 |
| **Total** | **11** |

### High-severity finding (surfaced inline)

- **`devalue` (transitive)** — Svelte devalue: DoS via sparse array deserialization (GHSA-77vg-94rm-hx3p, CVSS 7.5). Range `5.6.3 - 5.8.0`. `fixAvailable: true`. Reached via the Astro/Cloudflare toolchain.

### Moderate-severity findings (log-only)

Direct dependencies flagged:
- `@astrojs/check` (>=0.9.3) — via `@astrojs/language-server` → `volar-service-yaml`
- `@astrojs/cloudflare` (>=12.2.4) — via `@cloudflare/vite-plugin` and `wrangler`
- `wrangler` (<=0.0.0-kickoff-demo || >=3.108.0) — via `miniflare`

Transitive dependencies flagged:
- `@astrojs/language-server`, `@cloudflare/vite-plugin`, `miniflare`, `volar-service-yaml`, `yaml-language-server`, `ws` (GHSA-58qx-3vcg-4xpx — uninitialized memory disclosure)

**Direct vs transitive split:** 3 direct, 7 transitive (devalue + 6 moderate transitives).

**Suggested next action (informational, not auto-applied):** `npm audit fix` for non-breaking fixes, or `npm audit fix --force` for fixes that include semver-major bumps (e.g., `@astrojs/check` 0.9.2, `@astrojs/cloudflare` 12.6.13, `wrangler` 3.107.3 — note these are *downgrades* from the starter's pins, so review carefully).

## Hints recorded but not acted on

The following hand-off fields were read but bootstrapper v1 does not act on them. They are preserved here as audit-trail context for the future memory-architecture skill (M1L4):

- `hints.team_size: solo` — informs collaborator-tier choices in agent context, not scaffold.
- `hints.deployment_target: cloudflare-pages` — starter already targets Cloudflare by default; no extra action needed.
- `hints.ci_provider: github-actions` — `.github/` ships with the starter, but a project-specific CI workflow file is not generated in v1.
- `hints.ci_default_flow: auto-deploy-on-merge` — same as above; future skill will wire this.
- `hints.bootstrapper_confidence: first-class` — no compensation action needed.
- `hints.path_taken: standard` — informational.
- `hints.quality_override: false` — no override applied.
- `hints.self_check_answers: null` — none supplied.
- `hints.has_auth: true` — Supabase Auth is in the starter; no extra wiring done in v1. Configure RLS policies and auth UI as part of implementation.
- `hints.has_ai: true` — no AI SDK installed by v1. Pick and install (e.g., `@anthropic-ai/sdk`, `openai`, or `ai`) during implementation.
- `hints.has_payments: false`, `has_realtime: false`, `has_background_jobs: false` — no compensation actions.

## Next steps

Your project is scaffolded and verified — happy hacking.

A future skill (M1L4 — "Memory Architecture") will set up the full agent context: merging your existing `CLAUDE.md` with `CLAUDE.md.scaffold`, generating `AGENTS.md`, wiring CI workflow files, and applying any compensation actions tied to the hint flags above.

Immediate manual follow-ups you may want to consider:
1. `diff CLAUDE.md CLAUDE.md.scaffold` and merge anything starter-specific you want into your `CLAUDE.md`, then delete the `.scaffold` sibling.
2. Copy `.env.example` to `.env` and fill in Supabase + Cloudflare credentials.
3. Decide whether to address the high-severity `devalue` advisory via `npm audit fix` now or after first commit.
4. `git add` the new scaffold files and create your first commit.
