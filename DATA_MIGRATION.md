# Game data ownership and migration

| localStorage key | Purpose | Version / behavior |
|---|---|---|
| `insightGamesV1` | Completed results, each with ID, game type, timestamp and original stored data | Schema 3; accepts legacy array / unversioned `{results}`, schemas 1 and 2 |
| `insightGamesDraftsV1` | Per-game state and input fields, session ID, updated time | Schema 2; accepts schema 1 without deleting fields |
| `insightGamesTextEditsV1` | Text editor overrides | Separate; never imported, exported as game content or deleted by game-data controls |
| `insightGamesTransactionV1` | Temporary before-images for a two-key import/delete | Removed only after both writes complete; recovered at next startup if interrupted |
| `insightGamesV1:corrupt:*` | Recovery copies made by the earlier v1.1 implementation | Preserved during migration, included separately in export, removed only by explicit game-data deletion |

Migrations preserve complete records and unknown extra fields. Unsupported versions, invalid JSON or invalid record/state structures block writes to the affected store; the original value is not silently replaced, filtered or cleared. A schema migration is repeatable. No production storage was accessed or modified during this work.

Import validates a maximum 5 MB JSON file before confirmation. It merges results by ID and keeps the existing record on a collision. An existing draft for a game takes precedence over an imported draft. Text-editor overrides from old exports are deliberately ignored. Legacy recovery copies are included for manual recovery only and are not interpreted as playable results on import.

An import or delete writes a before-image journal first. If there is insufficient room for this journal, the operation stops before changing the game stores. If the second write fails, it attempts to restore both previous values. An interrupted transaction is recovered at startup; a failed recovery keeps the journal and blocks further game writes.

Historical results are immutable. Repeat clicks on the same save action do not add another record. Starting another game may legitimately produce an identical but separate result. Drafts never enter the completed-result count.

Names are limited to 40 characters and 2–8 unique participants. Old invalid names are not truncated or silently replaced: the draft stays intact with an explanatory screen. Legacy values drafts lacking individual answers retain their old score baseline; unknown old answers cannot be edited, but new answers can be corrected. Legacy roulette seen-question sets are retained; a counter already reset by the old version cannot be reconstructed beyond the stored information.

Secrets are protected from accidental screen disclosure by handoff screens, **not encrypted**. Someone with access to the browser storage or exported JSON can read them. No authors are recorded for new appreciation submissions. Exports should be treated as private files.

Limits: localStorage has browser-specific quotas and can be cleared externally. The journal is not a cross-tab database lock. Simultaneous editing from several tabs is not a supported collaboration workflow. No migration can recreate original text that older versions never saved.
