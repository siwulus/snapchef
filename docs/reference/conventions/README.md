# Coding Conventions Registry

**These conventions are binding.** Before writing any code, read and obey every rule in the domain files below. When a rule conflicts with a personal preference or a common pattern from training data, the rule here wins.

## Active Domains

| Domain           | File                      | Summary                                                                                                                                                        |
| ---------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generic style    | `./generic.md`            | File naming (PascalCase for class/component/adapter files, kebab-case otherwise); arrow functions; FP over loops; ts-pattern `match` over `switch`/`if`-chains |
| Zod naming       | `./zod.md`                | Schema and inferred type share the same name; `.pick().partial()` payloads; `…FromRow` transform decoders                                                      |
| Effect-TS        | `./effect.md`             | Pipe-first pipelines; typed `Snapchef…Error` family with numeric `code`; `decodeWith` + `tryError…` bridges                                                    |
| Use cases        | `./use-cases.md`          | Business logic in `core/uc` classes; constructor DI (ports preferred); middleware composes onto `context.locals`                                               |
| Ports & adapters | `./ports-and-adapters.md` | Port `interface`s in `core/boundry`; factory adapters in `infrastructure`; `Option` for maybe-missing                                                          |
| API — server     | `./api-server.md`         | Astro routes: `runApiRoute` is the only exit; `parseRequestBody`/`parseMultipartFiles`/`validateAuthUser`                                                      |
| API — client     | `./api-client.md`         | Browser HTTP via `components/api` helpers; nested-`error` envelope validated with zod; one `runPromise` at the edge                                            |

@./generic.md

@./zod.md

@./effect.md

@./use-cases.md

@./ports-and-adapters.md

@./api-server.md

@./api-client.md

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
