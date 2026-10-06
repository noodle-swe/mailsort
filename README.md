# MailSort

A desktop email app (Electron) that puts all your Gmail and Outlook accounts in one inbox. Add as many of each as you like. It also sorts job-search mail with a **local Ollama model** through an **MCP server**.

![MailSort inbox in light mode: three accounts in one inbox, tags in the sidebar, an overview with emails that need attention, and the assistant panel](docs/screenshots/inbox-light.jpg)

![Reading an email in dark mode](docs/screenshots/reading-dark.jpg)

Type **"tag the emails"** in the Assistant panel, or click **Tag new emails**, and each new email gets one tag:

| Tag | Meaning |
|---|---|
| Applied | Company confirms they received the application |
| Rejected | Company rejected the application |
| Meeting | Company wants to talk, or sent a meeting/interview link |
| Questions | Company asked a question or made a request |
| Junk | Subscriptions, newsletters, passwords, verification codes, keys |
| Needs Attention | Application is not complete |
| Other | Cannot decide |

Tags are also saved to the mailbox as Gmail labels and Outlook categories (`AI/Meeting`, …), so you see them on your phone too.

**When mail gets tagged.** The button always works, and shows what it is doing: "Starting", then "Tagging 12 of 132" with a bar, a note while Ollama loads the model, and a line at the end that says how many were tagged or what went wrong (the line stays until you dismiss it). New mail is also tagged as it arrives, with two safeguards for laptops:

- If Ollama runs on the same PC as MailSort, automatic tagging stays off until you turn it on in **Settings, Tagging** (loading a model next to the app can slow a laptop to a crawl). With Ollama on another PC it is on.
- It tags at most 50 new emails per sync, newest first; the rest wait for the button. If Ollama fails twice in a row it pauses for 30 minutes and tells you why. A dropped connection is retried twice before a run stops.

Updating the app keeps the tags you already have. Only **Re-tag all emails** in Settings recomputes them.

**First-time setup** (Google/Microsoft app IDs, Ollama on your GPU PC): see [docs/SETUP.md](docs/SETUP.md).

## Several accounts

Click **Add Gmail account** or **Add Outlook account** as many times as you need. Each time, the Google or Microsoft account picker opens, so you can choose a different address even if your browser is already signed in.

- **All inboxes** shows every account together, and each email shows which mailbox it came from.
- Each account also has its own view, unread count and sync status.
- Tagging, search and the MCP tools work across all accounts, or on one account with `accountId`.
- Signing in again with an address you already added refreshes that account instead of adding a duplicate.

## Finding and sorting mail

- **Filters per view.** Every tag and mailbox has a filter bar with the filters that fit it: dates (Today, This week, Last week, 30 days) for Applied and Rejected, **Has invite** for Meeting, **Oldest first** for Questions and Needs Attention, **Newsletters** for Junk, **Needs review** for Other (low confidence tags and model guesses). Each view remembers its own filters.
- **Digest.** The overview shows emails per inbox and tag for this week or last week. A number opens the list already filtered to it.
- **Bulk actions.** Tick the box over a sender's initials (or Ctrl-click a row, Shift-click for a range), then mark read, mark unread or set a tag for all of them. Hover a row for quick read and tag buttons.
- **Read state syncs.** Opening or marking an email read or unread is also done in Gmail and Outlook.
- **Keyboard.** `j`/`k` move, `x` selects, `u` toggles read, `1` to `7` set a tag, `g` then a letter jumps to a tag, `/` searches, `?` lists everything.

## How it works

```
Electron main process
 ├─ core/       SQLite (node:sqlite, FTS5) · Gmail API + Microsoft Graph sync · tagger · tag write-back
 ├─ mcp/        MCP server over the core (7 tools + tag definitions resource)
 │   ├─ in-memory  → Assistant panel: Ollama /api/chat with tools ⇄ MCP client
 │   ├─ named pipe → stdio bridge for other MCP clients (Claude Desktop, MCP Inspector, …)
 │   └─ HTTP       → optional, 127.0.0.1 only
 └─ IPC → React UI (unified inbox, reading pane, tags, assistant, settings)
                                           Ollama on your GPU PC (http://<lan-ip>:11434)
```

The chat model never reads hundreds of emails itself. It calls the `tag_emails` tool, and the tool runs a fast pipeline:

1. **Rules first (0 ms).** Calendar invites and Calendly/Zoom/Teams links, rejection wording, "we received your application", verification codes, newsletters (`List-Unsubscribe`, Gmail Promotions), and sender domains you corrected twice. On the sample set, rules settle about 2 of 3 emails, and every tag they accepted was correct.
2. **The model for the rest.** One small request per email: From, Subject and the first ~1200 cleaned characters. The answer is constrained to a JSON schema with temperature 0. The system prompt is fixed so Ollama can reuse its prompt cache. Requests run 4 at a time.
3. **Learning from you.** When you change a tag, MailSort records the correction and shows similar ones to the model as examples. A sender domain you corrected twice becomes a rule. Your own tags are never overwritten.

## Speed, loading and storage

- **Instant start:** the inbox renders from the local database while sync runs in the background. The list is virtualized and loads 50 rows at a time.
- **Incremental sync:** Gmail `history.list` and Graph delta links, so only changes are downloaded. The first sync covers the last 90 days (configurable).
- **Lean storage:**
  - Each email keeps only cleaned text (≤ 4 KB) plus metadata and an FTS5 search index.
  - Full HTML downloads only when you open an email, then sits in a brotli-compressed cache capped at 200 MB (least recently opened is evicted).
  - Text older than the retention period is dropped, but subject, sender and tag are kept.
  - Attachments are never downloaded.
- **Remote images blocked** until you click **Load images**. This is faster and stops tracking pixels.
- **No re-work:** emails are classified once. A new classifier version re-tags only automatic tags.
- **No native modules:** SQLite comes built into Node/Electron (`node:sqlite`), so nothing needs compiling.

## Design

The UI follows the [Taste Skill](https://www.tasteskill.dev/) redesign rules (installed in `.claude/skills/`), applied to an app rather than a landing page:

- **Backdrop photo:** the photo fills the whole frameless window. Panels look frosted using a tiny pre-blurred copy of the photo (about 1 KB each), so there is no live blur cost on machines without a GPU. Seven photos ship with the app; pick one in **Settings, Appearance**, or press the picture button in the top bar to cycle. The window cross-fades to the new photo, and the overview follows it.
- **Flexible layout:** drag the gaps between panels to resize the sidebar, the email list and the assistant (arrow keys work too, double-click resets). The sidebar collapses to an icon rail, the assistant slides away without losing the conversation, and the layout button switches between columns, split and a single pane. Sizes are remembered. **Appearance** also sets panel transparency and a compact email list.
- **Motion:** panels slide to their new size, the selection pill glides between emails, new rows rise in one after another, numbers count up, and layout changes morph through the View Transitions API. All of it switches off under the system "reduce motion" setting.
- **Fonts and icons:** Geist (bundled, works offline) and Phosphor icons.
- **Color:** one green-tinted neutral palette with an ink primary, so the tag colors are the only hues.
- **Shape:** one corner-radius scale: panels 16px, controls 10px, chips 7px.
- **States:** loading skeletons, a photo overview when no email is open, inline errors, and Settings as a slide-over panel.
- **Light and dark:** both themes follow Windows. Motion respects "reduce motion".

Photos, all under the Unsplash License: [Andrew Ridley](https://unsplash.com/photos/Kt5hRENuotI) (Highland), Paul Jarvis ([Mist](https://unsplash.com/photos/Cm7oKel-X2Q), [Coast](https://unsplash.com/photos/6J--NXulQCs), [Falls](https://unsplash.com/photos/NYDo21ssGao)), [Go Wild](https://unsplash.com/photos/V0yAek6BgGk) (Alps), [Daniel Genser](https://unsplash.com/photos/PzPbh-faPgU) (Golden hour) and [Julie Geiger](https://unsplash.com/photos/dYshDcTI1Js) (Dusk).

To regenerate the screenshots without opening a window: build, seed a demo folder, then run the app in capture mode:

```bat
npm run build
npx tsx scripts/seed-demo.ts %TEMP%\mailsort-demo
set MAILSORT_DATA_DIR=%TEMP%\mailsort-demo
set MAILSORT_CAPTURE=%TEMP%\mailsort-shots
set MAILSORT_THEME=dark
npx electron .
```

## MCP server

Tools: `list_accounts`, `sync_mail`, `search_emails`, `get_email`, `tag_emails` (with progress notifications), `set_tag`, `tag_summary`. Resource: `mail://tags`.

- **Inside the app:** the Assistant panel uses it automatically.
- **Other MCP clients (stdio):** **Settings → MCP server** shows the exact config to paste. It runs a small bridge that connects to MailSort, starting it in the background if needed. During development, after `npm run build`:
  ```json
  { "mcpServers": { "mailsort": { "command": "node", "args": ["C:/path/to/mcp/out/main/mcp-bridge.js"] } } }
  ```
  To try it in the MCP Inspector: `npx @modelcontextprotocol/inspector node out/main/mcp-bridge.js`
- **HTTP:** turn it on in Settings to get `http://127.0.0.1:3917/mcp` (Streamable HTTP, loopback only).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app with hot reload |
| `npm test` | Unit and integration tests (rules, store, pipeline, providers, MCP server, chat agent) |
| `npm run eval -- --url http://<gpu-pc>:11434 --model qwen2.5:7b` | Accuracy, confusion matrix and ms/email on the labeled fixtures (`--llm-only` to test the model alone) |
| `npx tsx scripts/seed-demo.ts <dir>` | Fill a throwaway data folder with sample emails; run with `MAILSORT_DATA_DIR=<dir>` to try the UI without an account |
| `npm run typecheck` | TypeScript checks |
| `npm run dist` | Build a Windows installer (`dist/`) |

## Log file

MailSort writes a log of what went wrong to `%APPDATA%\MailSort\logs\mailsort.log` (older ones become `mailsort.1.log` to `mailsort.3.log`, about 1 MB each). It records:

- the PC and app (Windows version, memory, graphics adapters, Ollama address and models) at start
- sync, tagging and tag write-back problems, with counts, the model, and the kind of Ollama failure (`unreachable`, `dropped`, `model_missing`, ...)
- what Ollama had loaded and how much memory was free after a tagging problem
- uncaught errors, crashed or frozen windows, graphics-process crashes, and the computer going to sleep or waking up

It never records the subject, sender or text of an email. Mailbox addresses are masked (`***@gmail.com`) and tokens are hidden. To send it for help, open **Settings, Troubleshooting** and click **Copy recent log** (the last 200 lines), or **Open log folder**.

## Privacy

- Mail, tags and the database stay on this PC in `%APPDATA%\MailSort`. OAuth refresh tokens are encrypted with Windows DPAPI (Electron `safeStorage`).
- Email text is sent only to your own Ollama host.
- MailSort asks for read and modify access (to add labels/categories). It never sends or deletes mail.
