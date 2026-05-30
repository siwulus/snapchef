# Repository Guidelines

Rules for `src/components/`. See `@AGENTS.md` at the repo root for repo-wide rules.

## Local Rules

- **Reach for `.astro` first.** Use `.tsx` only when the component needs React state, effects, or browser events (`@./auth/SignInForm.tsx`). Static markup and `Astro.locals` access stay in `.astro` (`@./Topbar.astro`).
- **Cross-component imports** go through `@/components/...`.
- **Do not import server-only modules** (`@/lib/supabase`, `astro:env/server`, `@/lib/services/*`) from `.tsx` files here. Server access happens in the parent `.astro` page or `src/pages/api/*`.
- **Interactivity** is enabled by the parent page's `client:*` directive on the island.

## File Layout & Naming

- `PascalCase.{astro,tsx}` at file level; subdirectories `lowercase` (`auth/`, `ui/`).
- Group by feature when a unit owns multiple files (see `auth/`). Keep generic shadcn primitives in `ui/`.
- No barrel `index.ts`. Reusable React hooks live in `src/components/hooks/`.

## Adding a New Component

0. **Interactive components use shadcn.** Before building any interactive component (dialog, dropdown, popover, input, select, etc.) run `npx shadcn@latest add <name>` and extend the copied primitive. Do not hand-roll interactive behavior from scratch or introduce a second component library alongside shadcn.
1. Pick `.astro` vs `.tsx` by the rule above.
2. For `.tsx`: declare `interface <Name>Props` immediately above the function (`@./auth/FormField.tsx:8-20`).
3. Use a **named export** for leaf / utility components (`FormField`, `PasswordToggle`, `Button`); use **`export default`** only for top-level feature components a page mounts directly (`@./auth/SignInForm.tsx:12`).
4. Icons come from `lucide-react`, sized with Tailwind utilities (`size-4`), not inline `width`/`height`.
5. Color and spacing come from the Tailwind palette / shadcn tokens already in `@src/styles/global.css` — no hardcoded hex values.
