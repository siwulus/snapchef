---
change_id: ui-improvments
title: "Recipe wizard UI improvements: back link, cancel, read-only steps, title"
status: implemented
created: 2026-06-18
updated: 2026-06-18
archived_at: null
---

## Notes

Provide the UI improvements listed below:

1. During the creation of a new recipe, there should be a link at the top of the page on the left side allowing you to go back to the recipes list. Going back to the list of recipes with unsaved, a new recipe should display the dialog box informing about losing the content, similar to how it is for leaving the page without saving
2. After the first step of the wizard, when the recipe session is created, at the bottom of the page there should be the cancel button, which allows canceling the creation and going back to the list of recipes. Canceling the session should delete everything that is connected with the session
3. Currently going through next steps in a Recipe Wizard. The previous step is presented for read-only or it disappears for generation. The intended behavior is that the previous step should be visible but be read-only so it works as expected in a step between upload and review. For the next step from review to generate it should keep everything that was presented before. With this change the meal description should be now only read-only text, not an editable text area
4. Presentation: the recipe after generation should have the recipe name above the presented content
