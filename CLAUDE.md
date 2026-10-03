# MailSort notes for Claude Code

- UI work: follow `.claude/skills/redesign-existing-projects` and the app-relevant parts of `.claude/skills/design-taste-frontend` (typography, one palette, states, icons, dark mode, motion, no em-dashes). Its landing-page layout rules do not apply to this app.
- Keep the design tokens in `src/renderer/src/styles.css`: one neutral palette with an ink primary, tag colors from `src/core/tags.ts`, radius scale 16/10/7px, Phosphor icons only.
- Check UI changes visually without opening a window: seed a demo folder, then run with `MAILSORT_CAPTURE` (see README, Design section).
- `npm test` and `npm run typecheck` must pass. Terminals started by editors may set `ELECTRON_RUN_AS_NODE=1`; unset it before launching Electron.
