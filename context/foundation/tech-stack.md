---
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
---

## Why this stack

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
