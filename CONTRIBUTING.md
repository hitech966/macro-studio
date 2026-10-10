# Contributing

Start with the source setup in README.md. Before a pull request, run `npm test`
and `npm run build`. Run the desktop UI suite when changing editor/IPC behavior.
Native input tests require an interactive test desktop and explicit input permissions;
do not run them against sensitive apps or on a shared active desktop.

Keep the UI, IPC boundary and automation engine separate. Preserve validation,
explicit consent to record, cancelable waits, input cleanup and emergency stops.
Do not add stealth capture, credential collection, privilege bypass or evasion.

For bugs, include version, OS, display scaling, keyboard layout, reproduction steps,
expected/actual behavior and relevant sanitized errors. Remove private input from
macros and screenshots. Never commit user profiles, recording journals or secrets.

Describe what changed and which checks passed. Do not call a platform supported
solely because its unit tests pass; native input needs target-system validation.
