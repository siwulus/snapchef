---
change_id: wizard-moving-back-forward
title: Let users move back and forward through the new-recipe wizard
status: implementing
created: 2026-06-29
updated: 2026-06-29
archived_at: null
---

## Notes

Currently the wizard of creating a new recipe allows only for moving forward from the first to the last step. Having implemented the last changes, the state machine has the guard `valid session`. We can add a new feature for the user: moving back and forward during the session of creating a new recipe. User should have the possibility to move back in the wizard steps to:

- correct his previous decision
- change the recipe description
- modify the recognized items
- delete or update the photos

Moving back into the wizard process from a business point of view means moving to the previous state and re-execution of the steps which are next in a process. So if we move back to taking the photos, it means that from a business point of view we are repeating all the consequence steps which are required to generate the recipe.

From the UI perspective, if the data field in the first iteration is available, it should pre-populate the form fields. The user should have only the possibility to use it as it was provided before, or modify and resend.
