# code-review

A terminal code reviewer. Pipe a **git diff** in on stdin; get a structured code
review out. It uses the **Claude Code SDK** (`@anthropic-ai/claude-agent-sdk`) as
its engine and the model's **native structured output** (constrained to a Zod-derived
JSON Schema), so the review is validated end to end.

This is an independent package in the repo's pnpm workspace — it does **not** touch
the Astro app, and it runs locally via `tsx` (no build step).

## Requirements

- Node `24` and pnpm `11` (already the repo toolchain — `mise.toml`).
- One root `pnpm install` (links this workspace member).
- An Anthropic credential (see [Authentication](#authentication)).

## Authentication

The reviewer reads its credential from the environment, preferring a **Claude
Pro/Max subscription token** over a standalone API key. It checks, in order:

| Env var                   | Billing                                  | How to get it         |
| ------------------------- | ---------------------------------------- | --------------------- |
| `CLAUDE_CODE_OAUTH_TOKEN` | Your **Claude Pro/Max subscription**     | `claude setup-token`  |
| `ANTHROPIC_API_KEY`       | Standalone **pay-as-you-go** API account | console.anthropic.com |
| `ANTHROPIC_AUTH_TOKEN`    | Custom/gateway auth                      | your gateway          |

Generate the subscription token once (interactive; requires an active Pro/Max plan
and the `claude` CLI):

```bash
claude setup-token   # prints a sk-ant-oat01-… token
```

Then put it in **`packages/code-review/.env`** (gitignored, auto-loaded by the CLI):

```bash
# packages/code-review/.env
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-…
```

The CLI auto-loads this file when no credential is already present in the
environment, so an exported variable or the repo-root `.env` (loaded by mise)
always takes precedence. You can also just `export CLAUDE_CODE_OAUTH_TOKEN=…`.

## Usage

```bash
git diff | pnpm --filter code-review review                 # pretty review
git diff | pnpm --filter code-review review -- --json       # raw validated JSON
git diff | pnpm --filter code-review review -- --model claude-opus-4-8
git diff | pnpm --filter code-review review -- --verbose    # stream loop progress (-v)
```

Review only what changed (staged changes, a branch, a single file):

```bash
git diff --staged            | pnpm --filter code-review review
git diff main...HEAD         | pnpm --filter code-review review
git diff -- src/app.ts       | pnpm --filter code-review review
```

> Pass flags **after `--`** so pnpm forwards them to the tool (pnpm otherwise eats
> `--json`/`-v` as its own). The CLI strips the separator pnpm leaves behind.

### Flags

| Flag                 | Default             | Description                                                                                                                          |
| -------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `--json`             | off                 | Emit the raw validated review as pretty JSON instead of text.                                                                        |
| `--model <id>`       | `claude-sonnet-4-6` | Model id, e.g. `claude-opus-4-8` for a deeper (slower) review.                                                                       |
| `--project-root <p>` | repo root           | Project root the reviewer reads files + `CLAUDE.md` from (the agent's `cwd`). Defaults to the repo root; CI passes the checkout dir. |
| `--verbose`, `-v`    | off                 | Stream the agentic loop's progress to **stderr** (see below).                                                                        |

> **Run from the repo root** (or pass `--project-root`). The reviewer examines the diff against
> the whole project, so its working directory must be the repository root — that is the default,
> but `pnpm --filter … exec` changes the cwd, which is why CI passes `--project-root` explicitly.

### `--verbose` output

Verbose logs go to **stderr**, so stdout stays a clean review/JSON stream
(`… -- --json -v 2>/dev/null` still yields pure JSON). You'll see:

```
→ reviewing diff (model=claude-sonnet-4-6, 1.4 KB)
· session ready — model=claude-sonnet-4-6, tools=3, permission=dontAsk
· assistant turn — Reading the changed files and their callers…
→ Read(src/lib/core/uc/auth/AuthenticatorUC.ts)
← ok
→ Grep(signInWithPassword)
← ok
✓ review complete — 7 turn(s), 18230ms, $0.0210, 24800/640 tok
```

The `→ Tool(arg)` / `← ok|error` lines are the agentic exploration loop: each file the
reviewer reads and each search it runs against the project shows up here.

## Output

**Pretty (default):** a verdict line, the summary, a per-concern **Areas** block
(every concern with its `ok | concerns | blocking | not_applicable` status and a
rationale), then findings grouped and ordered by severity (`critical` → `major` →
`minor` → `nit`), each showing `[category] file:line — title`, the detail, and a
suggestion when present.

**JSON (`--json`):** the validated `Review` object:

```jsonc
{
  "summary": "…",
  // One entry per concern — the model must report every concern (coverage is
  // enforced by the schema), with a status of ok | concerns | blocking | not_applicable.
  "areas": {
    "correctness": { "status": "blocking", "rationale": "…" },
    "error_handling": { "status": "ok", "rationale": "…" },
    "security": { "status": "ok", "rationale": "…" },
    "tests": { "status": "ok", "rationale": "…" },
    "api_contract": { "status": "ok", "rationale": "…" },
    "maintainability": { "status": "ok", "rationale": "…" },
    "frontend": { "status": "not_applicable", "rationale": "…" },
  },
  "findings": [
    {
      "severity": "critical", // critical | major | minor | nit
      "category": "correctness", // the concern this finding belongs to
      "file": "src/math.ts",
      "line": 12, // optional
      "title": "Division by zero not guarded",
      "detail": "…",
      "suggestion": "…", // optional
    },
  ],
  // Derived from the area statuses, not chosen by the model: any blocking →
  // request_changes; else any concerns → comment; else approve.
  "verdict": "request_changes",
}
```

## Exit codes

| Code | Meaning                                                         |
| ---- | --------------------------------------------------------------- |
| `0`  | Success — review printed (regardless of verdict).               |
| `1`  | No diff on stdin, missing credential, or the review run failed. |
| `2`  | Invalid CLI arguments / options.                                |

## How it works

`cli.ts` reads the diff from stdin and parses flags → `engine.runReview()` calls a
headless `query()` that runs **with the full project as context**: `cwd` is the project
root, read-only tools (`Read`, `Glob`, `Grep`) let the agent explore the codebase, and
`settingSources: ["project"]` + the `claude_code` system-prompt preset load `CLAUDE.md`
and the binding conventions. The model investigates the diff against the real repository —
callers, types, tests, conventions — then emits its review as native structured output
(`outputFormat: { type: "json_schema", schema }`, derived from the `ReviewDraft` Zod schema —
per-concern coverage, no verdict). The SDK validates the response against the schema and
returns it on the result message's `structured_output` field; the engine derives the verdict
from the area statuses and assembles the final `Review` → `render.ts` prints pretty text or JSON.

Because the reviewer reads the repo and loads `CLAUDE.md`, a run costs more tokens and takes
longer (a multi-turn agentic loop) than a diff-only pass — budget for it on larger diffs.

## Development

```bash
pnpm --filter code-review typecheck   # tsc --noEmit
pnpm --filter code-review test        # vitest (no network; the SDK is mocked)
```

Source layout (`src/`): `review.ts` (schema), `options.ts` (CLI options),
`prompt.ts` (reviewer prompt), `engine.ts` (SDK call), `render.ts` (output),
`log.ts` (verbose formatter), `cli.ts` (entry).

## Scope

Diff in → review out. The diff is supplied on stdin (the tool does not run `git` itself);
the reviewer reads the surrounding project read-only to judge it in context. PR-comment
posting and the merge-gate status live in the sibling `@snapchef/code-review-ci` package and
the `packages/code-review-action` composite action — this package is just the engine. No
diff chunking, retries, or caching.
