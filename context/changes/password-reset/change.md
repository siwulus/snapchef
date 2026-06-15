---
change_id: password-reset
title: Password reset
status: implementing
created: 2026-06-15
updated: 2026-06-15
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- Roadmap item **F-03** (`password-reset`, Stream B — Domknięcie autentykacji). PRD ref **FR-013** + Access Control (self-service recovery).
- Completes the auth flow: FR-001 register + email confirm → FR-002 sign in/out → **FR-013 password reset**.
- Near-mirror of the merged `email-verification-gating` change — same hexagon, same `token_hash` callback mechanism, `type=recovery` instead of `type=email`.
