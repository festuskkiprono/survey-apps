# Survey App (HTML / CSS / JS, no frameworks)

A vanilla rewrite of the original React + Java survey app. All data
lives in the browser's `localStorage` — there is no backend.

## Running it

**Do not open the HTML files directly by double-clicking them.**
Browsers vary in how they handle `localStorage` on `file://` pages
(some isolate every page from every other), which breaks the flow
where the admin creates a survey and the public page needs to see it.

Instead, serve the folder with any static server so every page
shares one real origin (`http://localhost:...`):

### Option A — VS Code Live Server (recommended)
1. Install the "Live Server" extension in VS Code.
2. Right-click `admin-surveys.html` → "Open with Live Server".

### Option B — Python (already installed on most machines)
```bash
cd survey-app
python3 -m http.server 8000
```
Then visit `http://localhost:8000/admin-surveys.html`.

## Pages

| File | Purpose |
|---|---|
| `admin-surveys.html` | Survey list — table, create/edit dialog, delete confirmation |
| `admin-questions.html?surveyId=1` | Survey details, question table, add/edit dialog (per-type config), preview dialog |
| `survey.html?surveyId=1` | Public quiz for one survey, with `<< < > >>` navigation to other surveys |

Start at `admin-surveys.html`, create a survey, add a few questions
of different types, then open `survey.html` to try the respondent
view.

## Where things live

- `js/storage.js` — the entire data layer (localStorage reads/writes,
  ID generation). Everything else calls into `window.SurveyDB`.
- `js/render-input.js` — the single, config-driven renderer that
  turns a question's `type` into the right HTML input. Adding a new
  input type is a one-entry addition to `QUESTION_TYPES` here.
- `js/dialog.js` — small shared helpers around the native `<dialog>`
  element (open/close/confirm), used by all three pages.
- `js/utils.js` — tiny shared helpers (currently just `escapeHtml`).
- `css/tokens.css` — design tokens (colors, spacing, fonts), ported
  from the original app. This is the single source of truth for the
  visual theme.
- `css/base.css`, `css/components.css` — shared resets and UI
  patterns (buttons, tables, dialogs, forms, badges) used everywhere.
- `css/admin-surveys.css`, `css/admin-questions.css`, `css/survey.css`
  — small page-specific overrides.

## Debugging the data store

Open the browser console on any page and run:

```js
SurveyDB.dump()      // logs the full parsed contents of localStorage
SurveyDB.clearAll()  // wipes all survey app data (careful!)
```

You can also inspect the raw values directly in DevTools:
**Application → Storage → Local Storage** (Chrome/Edge) or
**Storage → Local Storage** (Firefox/Safari).

## Known limitations (by design, per project scope)

- **No soft delete.** Deleting a survey or question removes it
  permanently. Deleting a survey also removes its questions.
  Existing responses to a deleted survey are kept (they snapshot the
  survey's name at submission time), but you can no longer answer it.
- **No status lifecycle** (draft/active/inactive). Every question
  in a survey is shown to respondents.
- **File uploads are stored as base64** directly in `localStorage`,
  unencrypted. Browsers cap total localStorage per origin at roughly
  5–10MB, so a few uploaded files can fill that budget quickly. If
  you outgrow this, swapping `storage.js`'s file handling for
  IndexedDB is a contained change — nothing else needs to know.
- **Fonts and icons** need to be added locally before the branded
  look is complete — see `fonts/README.txt` and `icons/README.txt`.
