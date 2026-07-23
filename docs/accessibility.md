# Accessibility baseline

The selected beta path targets WCAG 2.2 level AA for registration, sign-in and
profile editing. Accessibility is a release requirement, not an optional visual
enhancement.

## Implemented interaction contract

- Create-account and sign-in controls use the ARIA tabs pattern. `Left`,
  `Right`, `Home` and `End` switch tabs and move focus.
- Registration and sign-in use native forms, so Enter submits the current form.
  Buttons inside repeatable qualification and role editors are explicitly
  non-submit controls.
- Required account fields have persistent instructions, autocomplete purpose
  and `aria-invalid` state after validation. Invalid steps render an assertive,
  programmatically focused summary instead of silently disabling progression.
- Loading state is exposed with `aria-busy` and polite status text. Registration,
  sign-in and profile save reject duplicate requests in component code as well
  as disabling their visible controls.
- Profile-save failures use a focused, assertive summary containing stable public
  guidance rather than upstream error detail.
- Location lookup exposes loading, empty, invalid, throttled and unavailable
  outcomes. Suggestion controls remain native buttons, and their region is
  connected to an ARIA combobox.
- Motion-heavy presentation is disabled when `prefers-reduced-motion: reduce`
  is active.

## Automated verification

`npm test -- --watch=false` runs axe-core against the rendered create, sign-in,
profile-read and profile-edit states. It also verifies tab keyboard behavior,
form relationships, focused error summaries, accessible field guidance,
provider-failure feedback and duplicate-request suppression.

The jsdom runner cannot calculate rendered colour contrast, zoom/reflow or
screen-reader speech. Those checks belong to the existing
`jobseekercopilot/e2e` Playwright/Cucumber accessibility profile and the release
review; no second browser framework should be added to this repository.

## Manual release checklist

Before a beta release, use the local Docker Compose stack and the authoritative
E2E repository to check:

1. Complete registration, sign-in and profile editing with keyboard only at
   100% and 200% zoom.
2. Confirm visible focus order, Enter submission, tab arrow navigation and that
   focus moves to each error summary.
3. Confirm field instructions, loading status, location empty/offline status and
   save failures are announced with NVDA/Firefox or VoiceOver/Safari.
4. Confirm text and focus-indicator contrast in the built browser application,
   including forced-colours and reduced-motion preferences.
5. Confirm rapid repeated activation causes one network request.

Record browser, assistive-technology version and any exception in the owning
release issue. Automated axe results do not by themselves constitute a complete
WCAG conformance claim.
