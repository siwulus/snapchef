---
change_id: migration-to-react-form
title: Migration to React form (react-hook-form + Zod foundation)
status: implemented
created: 2026-05-30
updated: 2026-05-31
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- Foundation change: establishes the standard form stack (react-hook-form + Zod + shadcn `form`) for all current and future forms.
- Reference implementation = the two existing auth forms (sign in / sign up).
- Designed to absorb future file-upload (S-01) and dynamic-array (S-01 recognized items) and free-text (S-02) forms without redesign.
