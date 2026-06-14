---
change_id: editable-product-list
title: Editable product list
status: implementing
created: 2026-06-14
updated: 2026-06-14
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- Frontend-only refactor of the recipe wizard's consolidated recognized-items review (the "Lista zbiorcza" textarea → a structured per-item editable list). The server already stores structured `RecognizedItem[]` (jsonb); this change makes the UI reflect that.
- Uploading the corrected items to the server is explicitly **out of scope** here — only the client-side editing + a server-ready data shape.
