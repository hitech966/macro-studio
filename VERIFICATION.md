# Verification: 0.2.3

Local environment: Windows x64, Node 24, Python 3.12. These are observed results,
not a guarantee of input delivery to every app, keyboard layout or display setup.

## Current release

- Production TypeScript check and Vite build passed.
- 19 Python engine unit tests and 5 shortcut-manager unit tests passed.
- Desktop UI/IPC suite passed in source and packaged Windows app with native checks
  explicitly skipped. Visual checks at 1440x960 and 1080x760 passed, including no
  horizontal overflow at the smaller size.
- UI coverage: batch deletion/Undo, library deletion, autosave, loops, adjacent
  Dry run/Run macro buttons, keybind editor/persistence/duplicate rejection, scripts,
  JSON round trip, recording-journal and corrupt-store backup recovery.
- The latest full native suite failed global F8 pause delivery in source and
  packaged runs. The cause is unresolved. Do not treat all global shortcuts as
  reverified for this release; test your stop controls before relying on them.

## Earlier native evidence: 0.2.1

- 38 full desktop checks passed in both source and packaged Windows app.
- A movement-only recorder test initially failed. Added position sampling during
  explicit recording and retention of the final coalesced movement point.
- Movement without clicks then streamed/saved spaced path points and replayed to
  the expected endpoint. Mouse buttons, wheel, keyboard, default and custom global
  shortcuts passed in that run.
- This historical result does not replace the latest shortcut failure above.

## Boundaries

macOS and Linux X11 native input have not been exercised on target systems.
Wayland is disabled. Broad multi-display/scaling tests, signing/notarization,
target-window synchronization and crash/power-loss fault injection remain future work.

Reproduce the non-native checks with `npm test`, `npm run build` and
`npx electron . --smoke-test --smoke-ui`. `npm run test:desktop` uses real input in
an isolated profile and disposable target; leave the desktop free while it runs.
JSON reports/screenshots are generated under ignored `test-results/`; no private
profiles or raw local logs are included in the public repository.
