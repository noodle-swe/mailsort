# Setup

MailSort needs three things before it can sort your mail:

1. A Google OAuth client, for Gmail.
2. A Microsoft app registration, for Outlook.com and Microsoft 365.
3. Ollama running on your GPU PC and reachable from this PC.

You only do this once. The IDs go in `.env` and are compiled into the app.

## 1. Gmail: Google Cloud OAuth client

1. Open <https://console.cloud.google.com/> and create a project (for example "MailSort").
2. **APIs & Services → Library**: search for **Gmail API** and click **Enable**.
3. **Google Auth Platform** (formerly "OAuth consent screen"):
   - **Branding**: give the app a name and your email.
   - **Audience**: choose **External**.
   - **Data access**: add the scope `https://www.googleapis.com/auth/gmail.modify`. MailSort needs it to read mail and add the `AI/...` labels.
4. **Clients → Create client**: choose application type **Desktop app**. Copy the **Client ID** and **Client secret**.
5. **Audience → Publish app** (set it to *In production*).
   - While the app is in *Testing*, Google expires refresh tokens after 7 days, so you would have to sign in again every week.
   - Unverified apps show a "Google hasn't verified this app" screen. For your own accounts, click **Advanced → Go to MailSort**.

## 2. Outlook: Microsoft Entra app registration

You need a (free) Azure account. A personal Microsoft account works.

1. Open <https://portal.azure.com/> → **Microsoft Entra ID → App registrations → New registration**.
2. **Supported account types**: *Accounts in any organizational directory and personal Microsoft accounts*.
3. **Redirect URI**: platform **Public client/native (mobile & desktop)**, value `http://localhost`.
4. Click **Register**, then copy the **Application (client) ID**.
5. **API permissions → Add a permission → Microsoft Graph → Delegated permissions**. Add `Mail.ReadWrite`, `User.Read` and `offline_access`.
   - Work or school accounts may need an admin to grant consent.
   - `Mail.ReadWrite` is needed to add the `AI/...` categories. MailSort never sends or deletes mail.

## 3. Put the IDs in `.env`

```bat
copy .env.example .env
```

```ini
MAIN_VITE_GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
MAIN_VITE_GOOGLE_CLIENT_SECRET=GOCSPX-...
MAIN_VITE_MICROSOFT_CLIENT_ID=00000000-0000-0000-0000-000000000000
```

`.env` is in `.gitignore`. Don't commit it.

## 4. Ollama on the GPU PC

On the PC with the graphics card:

1. Install Ollama from <https://ollama.com/download>.
2. Pull a model that is good at JSON and tool calling:
   ```bat
   ollama pull qwen2.5:7b
   ```
   An 8 GB GPU fits a 7–8B model. With more memory you can try a larger model; with less, try `qwen2.5:3b`.
3. Make Ollama listen on the network. Set these **user environment variables** (Windows: Settings → System → About → Advanced system settings → Environment Variables), then quit Ollama from the tray icon and start it again:

   | Variable | Value | Why |
   |---|---|---|
   | `OLLAMA_HOST` | `0.0.0.0:11434` | Accept connections from other PCs on the LAN |
   | `OLLAMA_NUM_PARALLEL` | `4` | How many emails Ollama classifies at once. MailSort's "Parallel requests" is Auto by default and finds the best level up to this value. Higher values need more GPU memory; on a small GPU keep it at `1` or `2` |
   | `OLLAMA_KEEP_ALIVE` | `30m` | Keep the model loaded between batches |

4. Allow the port through the firewall, **for your local network only** (PowerShell as admin):
   ```powershell
   New-NetFirewallRule -DisplayName "Ollama (LAN)" -Direction Inbound -Protocol TCP -LocalPort 11434 -RemoteAddress LocalSubnet -Action Allow
   ```
5. From the MailSort PC, check that Ollama is reachable:
   ```bat
   curl http://192.168.1.50:11434/api/version
   ```

> **Security:** Ollama has no password, and email text travels unencrypted between the two PCs. Only open the port on a network you trust. Otherwise use [Tailscale](https://tailscale.com/) or an SSH tunnel (`ssh -L 11434:localhost:11434 you@gpu-pc`) and point MailSort at `http://127.0.0.1:11434`.

## 5. Run MailSort

```bat
npm install
npm run dev
```

Then, in the app:

1. Open **Settings** (⚙). Set **Server URL** to your GPU PC (e.g. `http://192.168.1.50:11434`) and click **Test**. Pick the chat model.
2. Click **+ Add Gmail** / **+ Add Outlook** and sign in in the browser window that opens.
3. When the first sync finishes, click **Tag new emails** or type "tag the emails" in the Assistant.

To check accuracy on your Ollama host before using it on real mail:

```bat
npm run eval -- --url http://192.168.1.50:11434 --model qwen2.5:7b
```

## Troubleshooting

| Problem | Fix |
|---|---|
| "MailSort must run as an Electron app" | The terminal has `ELECTRON_RUN_AS_NODE=1` set (some editor-embedded terminals do). Run `set ELECTRON_RUN_AS_NODE=` and try again, or use a normal terminal. |
| "Can't reach Ollama" | Check `OLLAMA_HOST`, the firewall rule and the IP address; test with `curl` as above. |
| "Model … is not on the Ollama host" | Run `ollama pull <model>` on the GPU PC, or pick another model in Settings. |
| "does not support tool calling" | The chat model can't use tools. Use `qwen2.5:7b`, `qwen3:8b` or `llama3.1:8b`. |
| Gmail asks you to sign in again every week | The Google app is still in *Testing*. Publish it (step 1.5). |
| "Signed out - please sign in again" | Access was revoked or expired. Use **+ Add Gmail/Outlook** again with the same address; your mail and tags are kept. |
| Tags don't appear in Gmail/Outlook | Check **Settings → Save tags to Gmail labels and Outlook categories**. Failed writes retry after the next successful sync. |
