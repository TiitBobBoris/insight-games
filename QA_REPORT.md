# Insight Games v1.1.1 — stabilization QA

Branch: `codex/qa-stabilization-2026-09-20`. No merge to main and no production deployment. No new games. No AGENTS.md was present in the workspace/repository inventory; the existing README had no additional project instructions.

## Implemented fixes

- Mustrimurdja: immediate state capture, backward/forward preservation, refresh restoration and corrected earlier answers in the final result. Neutral value choice, Estonian “Vallandaja”, hypothesis wording.
- All ten games: retained draft state/input restoration, separate completed-result counting and clear continue/new actions. Wheel dragging also persists its values. Peak and state result screens can be restored.
- Appreciation: confirmed entries persist before the success message; no author field. Unsaved secret text restores behind a handoff screen; revealing saved-in-progress appreciation requires explicit action.
- Know-me: restored secret/guess/reveal stages first show a neutral handoff. Saved rounds include target and participant context; the map does not combine different participants into one personality score.
- Data layer: schema 3 results, schema 2 drafts, strict read/import checks, no silent filtering or clearing of corrupt/unknown data, interrupted-operation journal, honest write-failure messages and visible storage warning.
- Game-data export/import/delete: distinct from text-editor controls; safe merge confirmation, cancellation, private JSON contents, preservation of text edits, app-owned deletion only.
- History: dated, game-specific expandable original stored answers/results, need strengths/risks/practical direction, source links from themes, separate start-new action, repeated-save suppression without overwriting old history.
- Roulette: independent pack state, explicit exhaustion, no immediate boundary duplicate, persistent cumulative shown count and compatibility with legacy seen sets.
- Participants: 2–8 unique trimmed names, 40-character limit, import checks and non-destructive handling of old invalid names.
- Needs/values: previous-question navigation, highlighted old answer, score recomputation, stable tie order and explicit tie caveats. Legacy value scores retained where individual past answers were never stored.
- Targeted UX: patch version/build, minimum 44 px button height, consistent built-in game names, neutral peak defaults, equal-score wheel/state wording, wrapping of long text.

## Already present before this QA pass

v1.1 version/build display, initial migration and draft framework, first export/import/delete controls, initial overflow CSS, preview back-navigation fix, and all six need profiles / 15 pair summaries. These were extended or corrected rather than duplicated. The repository contains one needs questionnaire, with 15 possible leading pairs; no extra questionnaire or game was added.

## Automated checks

`npm test`: **27 passed, 0 failed** at the recorded test run. Node/jsdom tests, not a real browser.

Coverage includes data-loss/back-navigation, refresh/reopen of all ten game families, secret handoff state, anonymous confirmed entries, both score-correction flows and complete quizzes, roulette exhaustion/boundary/legacy migration, strict import and real FileReader flow, cancel/delete/export/import roundtrip, immutable history and HTML escaping, migration idempotence, unsupported/corrupt formats, interrupted transaction recovery, second-write rollback, storage denial/quota, name validation and preservation, counters, all six need profiles and 15 pairs, and consecutive game navigation without JavaScript errors.

Inline JavaScript syntax check: passed. `git diff --check`: passed.

## Actual browser evidence

Chrome, non-production HTMLPreview of commit `a90c300a969c5934bd400c4b243e1c6ac4e538f0` (first QA checkpoint). Later validation/layout hardening is covered by automated tests but has **not** completed a fresh browser pass.

| Check | Observed result |
|---|---|
| Dashboard at 360 / 390 / 430 / 1180 px iframe widths | No horizontal overflow; visible buttons at least 44 px high. Scrollbar-adjusted content widths: 345 / 375 / 415 / 1165 px |
| Pattern step 1 → 2 → back | Both text answers retained |
| Edit earlier answer, finish all steps | Changed fact present in result |
| Refresh at step 6 | Continued at step 6; written plan present in completed result |
| Save twice | One result; “already saved” message |
| Map history | Dated record opened with full edited fact and plan |
| JSON export | Downloaded JSON inspected: schema 3, one result, no text-editor overrides |
| Console during completed path | No application JS error observed; one unrelated extension metadata error |
| Delete cancellation / remaining browser paths | Blocked by remote browser control timeout at native confirmation dialog; not claimed as passed |

The remote browser's dialog handling and subsequent tab operations timed out; documented dialog, keyboard, fresh-tab and close recovery did not restore control. No deletion was confirmed. This is a test-environment limitation, not evidence that application deletion is broken. `control-browser` guidance was followed; no alternate low-level access or production testing was used.

## Acceptance status and remaining risks

The full requested real-browser acceptance suite is **not complete**. In particular, the remaining nine games' refresh/handoff paths, roulette boundaries, a long-name/long-text layout stress test, browser back/forward, destructive JSON roundtrip/cancel/error flows, and the latest patch's layouts still require a fresh functioning browser session. Their relevant logic is covered by automated tests, but that is not a substitute for the missing browser checks.

No physical iPhone/Android, Safari, touch gesture or mobile keyboard test was performed. The viewport harness is actual desktop Chrome rendering at narrow CSS widths, not a real device test.

Old results only expose data actually saved by older code; missing historical originals cannot be reconstructed. Storage/export is plaintext. Several simultaneously editing tabs can still race. A failed storage write is reported but cannot guarantee refresh persistence. Unsupported stores remain blocked and need manual recovery rather than destructive reset.

## Release decision

**Not yet signed off for ten groups.** The changes are suitable for a draft code review and a non-production pilot. Complete the missing browser matrix and one real-phone/keyboard check before merging or broad group testing. The PR must remain draft until these acceptance gaps are closed.
