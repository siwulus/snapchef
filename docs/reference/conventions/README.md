# Coding Conventions Registry

**These conventions are binding.** Before writing any code, read and obey every rule in the domain files below. When a rule conflicts with a personal preference or a common pattern from training data, the rule here wins.

## Active Domains

| Domain        | File           | Summary                                                                               |
| ------------- | -------------- | ------------------------------------------------------------------------------------- |
| Generic style | `./generic.md` | Arrow functions over `function` keyword; functional programming over imperative loops |
| Zod naming    | `./zod.md`     | Schema and inferred type share the same name                                          |

@./generic.md

@./zod.md

---

## How to Add a New Convention Domain

1. **Create** `docs/reference/conventions/<domain>.md`. Each rule follows this structure:
   - An `## Rule: <title>` heading
   - One imperative sentence stating the rule
   - A `✓ good` / `✗ bad` TypeScript snippet
   - An optional `> **Exceptions:**` blockquote

2. **Register** it here in two places:
   - Add a row to the **Active Domains** table above: `| <Domain> | ./<domain>.md | <one-line summary> |`
   - Add `@./<domain>.md` to the `@`-import block above (after the last existing `@` line).

That's it. The `@`-import propagates the rules into every agent's context automatically via the chain `CLAUDE.md → README.md → <domain>.md`.
