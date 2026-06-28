---
change_id: package-code-review
title: Independent code-review package powered by the Claude Code SDK
status: implemented
created: 2026-06-28
updated: 2026-06-28
archived_at: null
---

## Notes

Add to the project an independent package responsible for making code review.

1. Code reviewer should be located under packages/code-review And should be a fully independent project with a separate package.json
2. The same package manager should be used as it is for the main project
3. it should use Claude Code SDK as engine for making the code review
4. Any structured input/output should be handled with Zod
5. As input the git diff should be accepted
6. The response should be the valid call to review
   As the result of this change we should have an initial version of code reviewer which can be run locally through the terminal. The initial logic is simple: as input git diff is passed, as the result the review is generated
