# PDFEDI Editor Audit Report

**Date:** 2026-10-12
**Scope:** The `/editor` web app on production (https://pdfedi.onrender.com/editor)
**Method:** Live browser interaction — uploaded a 2-page test PDF, exercised every toolbar feature, verified download output by parsing the downloaded file.
**Test-only:** no source files modified, nothing committed or deployed.

## Verdict summary

| # | Feature | Verdict |
|---|---------|---------|
| 1 | Load & render | **PASS** |
| 2 | Text edit (existing + new) | **PASS** (2 defects, see E-1, E-2) |
| 3 | Highlight | **FAIL** — tool does nothing (E-3) |
| 4 | Shapes | **PASS** |
| 5 | Image insertion | **FAIL** — no file picker opens (E-4) |
| 6 | Signature | **PASS** |
| 7 | Undo / redo | **PASS** |
| 8 | Page ops (rotate/add/thumb nav) | **PASS** |
| 9 | Page delete | **FAIL** — hangs the editor, reproduced 2× (E-5) |
| 10 | Download / export | **PASS** (output verified: 2 pages, edit baked in as real text) |
| 11 | Non-PDF upload handling | **PASS** — clean "Please choose a PDF file." |

## Issues found

### E-5 — Page delete hangs the editor (high severity, reproduced 2×)
Deleting a page via the thumbnail controls freezes the renderer; the tab stops responding entirely. Reproduced in two independent browser sessions (blank page added, then deleted). Users lose unsaved work with no recovery except reload.

### E-3 — Highlight tool is non-functional (high severity)
The Annotate → Highlight menu item activates (checked state) but no highlight ever renders, across 6+ attempts (drag-select, word click, keyboard, select-then-highlight). The PDF renders on a bare `<canvas>` with no text layer, so text-selection-based highlighting has nothing to attach to. The tool is dead UI.

### E-4 — Image insertion has no file picker (high severity)
The Image tool activates (pressed state) but no interaction — click, double-click, drag, Enter — opens a file picker. DOM inspection confirms no `<input type=file>` exists for image selection. The tool cannot be used at all.

### E-1 — Escape discards text edits (medium)
After editing text, pressing Escape reverts the change instead of committing it; only Enter commits. Users who instinctively hit Escape lose their edit silently.

### E-2 — Edited text can overlap other lines (medium)
After editing an existing line, the edited element rendered on top of the title line above it — a visible layout defect.

## Verified strengths
- Text edits persist as genuine document text through download (parsed the downloaded PDF: edit present in extracted text, correct page count).
- Undo/redo, shapes, signature pad, page rotate, add-blank-page, thumbnails all work.
- Non-PDF uploads rejected cleanly with a user-facing message.
- No crashes on any path except page delete.
