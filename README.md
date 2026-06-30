# Snapchef

Snapchef helps home cooks decide what to make from the ingredients they already have. Instead of typing out a list, you photograph your fridge and pantry — Snapchef recognizes the products, lets you correct the consolidated list, and, given a free-text meal context (e.g. "a light Mediterranean dinner"), generates a recipe you can save and revisit. It targets the everyday trio of decision paralysis ("what do I cook tonight?"), the friction of manual inventory, and food waste.

## Tech Stack

- [Astro](https://astro.build/) v6 - Modern web framework with server-first rendering
- [React](https://react.dev/) v19 - UI library for interactive components
- [TypeScript](https://www.typescriptlang.org/) v5 - Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) v4 - Utility-first CSS framework
- [Supabase](https://supabase.com/) - Authentication and backend-as-a-service
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge deployment runtime

## Prerequisites

- [mise](https://mise.jdx.dev/) — run `mise install` to provision the pinned Node.js 24 and pnpm 11 from `mise.toml`
- Or install Node.js 24 and [pnpm](https://pnpm.io/) 11 manually

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/siwulus/snapchef.git
cd snapchef
```

2. Install dependencies:

```bash
pnpm install
```

3. Set up Supabase and configure environment variables — see [Supabase Configuration](#supabase-configuration) below.

4. Create a `.dev.vars` file for local Cloudflare dev secrets:

```bash
cp .env.example .dev.vars
```

5. Run the development server:

```bash
pnpm dev
```

## Available Scripts

- `pnpm dev` - Start development server (Cloudflare workerd runtime)
- `pnpm build` - Build for production
- `pnpm preview` - Preview production build
- `pnpm lint` - Run ESLint with type-checked rules
- `pnpm lint:fix` - Auto-fix ESLint issues
- `pnpm format` - Run Prettier

## Project Structure

```md
.
├── src/
│ ├── layouts/ # Astro layouts
│ ├── pages/ # Astro pages
│ │ └── api/ # API endpoints
│ ├── components/ # UI components (Astro & React)
│ └── assets/ # Static assets
├── public/ # Public assets
├── wrangler.jsonc # Cloudflare Workers config
```

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for authentication. Environment variables are declared via Astro's `astro:env` schema and are treated as **server-only secrets** — they are never exposed to the client.

### First-time setup (local, no cloud project needed)

Requires [Docker](https://www.docker.com/) and ~7 GB RAM.

1. Create your `.env` file:

```bash
cp .env.example .env
```

2. Initialize the local Supabase project (creates a `supabase/` config folder):

```bash
pnpm exec supabase init
```

3. Start the local stack (downloads Docker images on first run):

```bash
pnpm exec supabase start
```

4. Copy the credentials printed by the CLI into your `.env` and `.dev.vars`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
```

5. To stop the stack when done:

```bash
pnpm exec supabase stop
```

The local Studio UI is available at `http://localhost:54323`.

The migrations under `supabase/migrations/` (recipe-session and recipe tables, RLS policies, the photos storage bucket) are applied automatically when the stack starts; run `pnpm exec supabase db reset` to re-apply them from scratch. After a schema change, regenerate the typed DB client with `pnpm db:types`.

### Using a cloud Supabase project instead

If you prefer to use a hosted Supabase project, add these variables to your `.env` and `.dev.vars` files:

| Variable       | Description                                                |
| -------------- | ---------------------------------------------------------- |
| `SUPABASE_URL` | Project URL from Supabase dashboard → Settings → API       |
| `SUPABASE_KEY` | `anon` public key from Supabase dashboard → Settings → API |

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<anon-key>
```

### Email confirmation in local development

By default Supabase requires email confirmation before a user can sign in. To skip this during local development:

1. Open the Supabase dashboard for your project
2. Go to **Authentication → Email → Confirm email**
3. Toggle it **off**

Users can then sign in immediately after sign-up without clicking a confirmation link.

### Auth routes

| Route                   | Description                                                    |
| ----------------------- | -------------------------------------------------------------- |
| `/auth/signin`          | Email/password sign-in form                                    |
| `/auth/signup`          | Email/password sign-up form                                    |
| `/auth/confirm-email`   | Post-signup "check your inbox" page                            |
| `/auth/forgot-password` | Request a password-reset link                                  |
| `/auth/reset-password`  | Set a new password from a recovery link                        |
| `/recipes`              | Protected app (redirects to `/auth/signin` if unauthenticated) |

Route protection is handled in `src/middleware.ts`. Add paths to the `PROTECTED_ROUTES` array there to require authentication.

## Deployment

This project deploys to [Cloudflare Workers](https://workers.cloudflare.com/) via **Workers Builds** — Cloudflare watches the GitHub repo and deploys automatically on every push to `main`. **Do not run `pnpm exec wrangler deploy` against production.** Source of truth = the `main` branch plus the Cloudflare dashboard config.

- Secrets (`SUPABASE_URL`, `SUPABASE_KEY`) are set in the Cloudflare dashboard under **Workers & Pages → snapchef → Settings → Variables and Secrets** (mirror them to _Build variables and secrets_ so `astro:env/server` resolves at build time).
- Local dev secrets live in `.env` (Node) and `.dev.vars` (`wrangler dev`); both are gitignored.
- Live logs: `pnpm exec wrangler tail` (read-only; safe).
- To roll back: Cloudflare dashboard → Workers & Pages → snapchef → Deployments → Rollback. **Do not** roll back if a non-backward-compatible Supabase migration shipped with that version.

## CI

GitHub Actions (`.github/workflows/ci.yml`) has two jobs:

- **`ci`** (lint + unit tests + build) runs on **every push to any branch**.
- **`e2e`** (Playwright, against a staging Supabase) runs on **pull requests to `main`** — the LLM boundaries are swapped for deterministic fakes via `E2E_FAKE_LLM`, so no model API key is needed.

Configure `SUPABASE_KEY` and `E2E_USER_PASSWORD` as repository **secrets**, and `SUPABASE_URL` and `E2E_USER_EMAIL` as repository **variables**. CI does **not** deploy — deploys are owned by Cloudflare Workers Builds (see Deployment above).

## License

MIT
