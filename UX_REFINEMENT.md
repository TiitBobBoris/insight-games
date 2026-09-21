# Interaction refinement · 2026-09-21

## Research and decisions

Read Apple's [Motion guidance](https://developer.apple.com/design/human-interface-guidelines/motion) in Chrome and inspected [apple.com](https://www.apple.com/) visually. Motion should communicate feedback, remain brief, respect accessibility settings and never block the next action. The website's clear hierarchy, restrained surfaces and primary/secondary buttons informed this implementation. This is an adaptation for Insight Games, not a native Apple interface or a performance certification.

- System typography, quieter white surfaces, restrained shadows and more consistent spacing.
- 48 px main buttons, at least 44 px controls, immediate CSS press feedback and hover effects restricted to mouse-like pointers.
- 160–200 ms incoming content motion, with no delayed event handlers or outgoing screen snapshots. These durations are project choices, not Apple requirements. Avoiding outgoing snapshots also avoids prolonging display of secret answers.
- Reduced-motion preference disables CSS motion and roulette Web Animations; static selection and text feedback remain available.
- 16 px regular-weight form text, safe-area padding, visible keyboard focus, live-region save messages and clearer disabled states.
- Returning to the dashboard restores its in-session scroll position and launch-button focus. Opening a game focuses its heading without opening a keyboard.
- No game-data schema or scoring changes. Existing editor overrides retain precedence.

## Verification

30 Node/jsdom tests pass, including new checks for return focus/scroll, retained answers, and reduced-motion roulette behavior. All previous storage, migration, privacy, quiz and roulette regressions still pass. `git diff --check` passes.

Actual desktop Chrome, non-production preview checkpoint `582794214e7b001b817fb7f6bc554a0bad6286e1`:

- Dashboard and roulette at 360, 390, 430 and 1180 CSS px iframe widths: no horizontal overflow, no visible buttons below 44 px height.
- All ten game opening screens at 360 CSS px: opened and returned successfully, no horizontal overflow or undersized visible buttons.
- Roulette: contextual followups 1/2 and 2/2, disabled completed button, refresh restores the same base question, second followup and count.
- Pattern: two text answers retained after next/back; form font measured at 16 px.
- No app JavaScript errors observed; one unrelated browser-extension metadata error.
- Final small typography adjustments (regular-weight form text and 24 px mobile prompts) are followed by a final preview check before release.

Narrow desktop Chrome frames are not physical-device testing. iPhone/Android touch feel, virtual keyboard, Safari and system reduced-motion rendering remain unverified. The older full stabilization browser matrix is still incomplete; this focused interaction pass does not close all gaps in QA_REPORT.md.
