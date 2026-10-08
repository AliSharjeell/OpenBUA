<p align="center">
  <img src="assets/promonewlogo.png" alt="OpenBUA Header" width="100%" />
</p>

<p align="center">
  <img src="assets/openbua-demo.gif" alt="OpenBUA Autonomous Agent Demo Walkthrough" width="100%" />
  <br />
  <sub>OpenBUA was asked to "Find me 2 students from Australia using Linkedin and email them selling my app Petedoro"</sub>
</p>

---

> Claude Code gave AI agents access to people's terminals. OpenBUA gives agents access to the one place users actually live all day - their own browser, already logged into Gmail, LinkedIn, GitHub, job boards and CRMs.

---

**OpenBUA** (Open Browser Use Agent) is an open-source, autonomous AI browser agent built as a Chrome Extension (Manifest V3) that runs directly inside your everyday browser. Unlike cloud browser-use tools that require spun-up headless containers, login bypass proxies, or remote servers, OpenBUA operates right inside your existing browser session with all your active cookies, credentials, and logins already available.

Built with **`@earendil-works/pi-agent-core`** and **`@earendil-works/pi-ai`**, OpenBUA equips AI models with real-time DOM perception, intelligent multi-step navigation, synthetic event form-filling, incremental live research previews, and a self-learning memory system.

---

## Why OpenBUA? In-Browser Execution vs Cloud Browser-Use

| Capability | OpenBUA | Traditional Cloud Browser-Use |
| --- | --- | --- |
| Session Authentication | Uses your active, signed-in sessions (Gmail, LinkedIn, GitHub, CRM) | Requires re-authentication, 2FA bypass, or fragile cookie imports |
| Infrastructure | 100% Client-Side Chrome Extension (Zero servers) | Spun-up Docker containers, cloud VMs, remote Playwright instances |
| Data Privacy | Zero data leaves your machine; prompts go straight to AI provider | Browsing traffic and page snapshots stream through remote servers |
| Cost | Free Gemini tier (1,500 requests/day) or Bring Your Own Key | Per-minute cloud compute pricing plus proxy bandwidth costs |
| Bot Detection | Bypasses headless blocks by running as a genuine local browser | Regularly blocked by Cloudflare, reCAPTCHA, and bot shields |
| Captcha Handling | Human-in-the-Loop alert banner lets you solve challenges in 1 click | Requires expensive third-party captcha-solving API integrations |
| Real-Time Feedback | Live Research Preview tab streams tables incrementally as agent works | Black-box execution until final summary is returned |
| Knowledge Retention | Proactive self-learning memory with Global and Tab memory tiers | Ephemeral scratchpads discarded after each session |

---

## What Can OpenBUA Do?

Because OpenBUA runs directly in your existing browser, it executes end-to-end autonomous workflows without login barriers:

- **Autonomous Web Research and Lead Generation**:
  - Search directories, platforms, search engines, or social networks across multiple pages.
  - Automatically evaluate candidates, extract verified data, and compile structured tables.
  - Example: *"Search LinkedIn for 'world models PhD' researchers, extract profiles across pages, and compile a structured table with names, headlines, and locations."*
  - Example: *"Go through recent Hacker News submissions on LLM agents, find the top 5 discussions, and summarize key takeaways."*

- **Live Research Preview Tab**:
  - Dedicated Preview tab accessible from the center navigation toggle (Chat / Memory / Preview).
  - Incremental write-as-you-go streaming: The agent streams extracted candidates, table rows, and structured Markdown into the preview buffer as each item is inspected (ReAct 1-item cycle), eliminating black-box waiting.
  - Automatic Markdown table repair engine: Automatically detects and stitches fragmented rows and scattered pipe data into contiguous tables.
  - Scoped per chat session: Each conversation tab maintains its own independent preview buffer with an instant Markdown copy button.

- **Self-Learning Memory System**:
  - Proactive fact extraction: Detects personal details, contact information, university affiliations, and repeatable workflow routines while browsing.
  - Suggested Memories interface: Review suggested memories on a dedicated full-page screen, discard with a single tap, or approve into Tab Memory or Global Memory.
  - Global Memory: General user background (profile, resume, work history) shared across all chats and browser tabs.
  - Tab Memory: Project-specific notes and uploaded documents isolated to the active chat session.
  - Document Uploads: Directly upload PDF, Markdown, Text, JSON, image, and video files with client-side text parsing powered by `pdfjs-dist`.
  - Large Media Storage: Videos and files over 3 MB are kept as raw Blobs in IndexedDB instead of base64 strings in `chrome.storage.local`, so uploading a long video no longer freezes the panel. Inline `dataUrl` is kept only for small files that need OCR.

- **Cross-Platform Social Media Posting**:
  - One `post_to_social` call posts media + caption to X/Twitter, LinkedIn, Reddit, Facebook, Instagram, Threads, Bluesky, Mastodon, YouTube, Pinterest, Tumblr, or TikTok.
  - Resolves the platform from your request or the current tab, opens its composer, attaches stored videos/images, types the caption, and reports composer state so nothing publishes without your say-so.
  - Files of any size are streamed to the page in bounded chunks, so a 200 MB video attaches exactly like a small image.
  - Correctly targets the file input inside the open composer dialog, which is what single-page social apps require.

- **Autonomous Form Filling and Wizard Completion**:
  - Matches web forms, job application portals (Greenhouse, Lever, Workday), and customer onboarding wizards against your stored profile.
  - Dispatches native synthetic event chains (`input`, `change`, `blur`) ensuring 100% compatibility with React, Vue, Angular, Svelte, and vanilla HTML forms.
  - Verifies DOM values after population to prevent hallucinated submissions.

- **Autonomous Email and Webmail Outreach (Gmail, Outlook, Webmail)**:
  - Drafts, reviews, and dispatches genuine emails right from your existing, logged-in browser session (Gmail, Outlook, Yahoo, webmail). No third-party OAuth permissions, SMTP passwords, or external email APIs required.
  - Navigates to your webmail interface, triggers compose dialogs, inputs confirmed recipient chips, formats subject lines and body text, and clicks Send on your command.
  - Features intelligent Gmail Basic HTML mode navigation fallback to eliminate DOM drift and click friction on dynamic Single-Page Applications.

- **Multi-Tab Orchestration and Dynamic Automation**:
  - Opens, switches, and coordinates across browser tabs during multi-step workflows without losing current task progress or form context.
  - Paginated scraping, scrolling dynamically to trigger lazy-loaded elements, and interacting with buttons, dropdowns, and dialogs.

- **Human-in-the-Loop (HITL) CAPTCHA Handling**:
  - Detects bot verification challenges (Cloudflare Turnstile, Google reCAPTCHA, hCaptcha, Arkose Labs) on visited sites.
  - Displays a clean in-panel alert allowing you to solve the challenge manually, then automatically resumes automation upon completion.
  - Employs intelligent fallbacks and exploration budgets to prevent infinite navigation loops.

- **Chain-of-Thought Reasoning and Thinking Traces**:
  - Streams full model reasoning steps live in the side panel before executing browser actions.
  - Clean collapsible thought blocks provide transparency into what the agent is planning next.

---

## AI Models and Supported Providers

OpenBUA supports both zero-cost free operation and flexible Bring Your Own Key (BYOK) providers:

### Google Gemini Free Mode
- **Zero-Cost Access**: Try OpenBUA completely free without paid API subscriptions or credit card billing.
- **Powered by Gemini 3.5 Flash Lite**: Default high-limit free model with automatic rate-limit backoff and pacing (up to 1,500 requests per day).
- **Direct Free Key Access**: Built-in 1-click link to generate your personal free API key directly from Google AI Studio.
- **Full Reasoning Support**: Streams structured chain-of-thought blocks before each browser action.

### Bring Your Own Key (BYOK)
- **OpenAI Compatible**: Connect to OpenAI (GPT-6 Astra, 6.1 Sol, 6 Luna, GPT-4o), Groq, OpenRouter, DeepSeek, or local Ollama instances.
- **Anthropic Compatible**: Connect to Anthropic (Claude Opus 5.5, Sonnet 5.5, Fable 5.1) or MiniMax.
- **Role Normalization and Connection Testing**: Built-in 1-click connection verification and automatic schema adaptation across providers.

---

## Key Architectural Highlights

- **Runs in Your Existing Browser**: No headless emulators, remote browsers, or virtual containers. OpenBUA leverages your everyday authenticated sessions (Google, GitHub, LinkedIn, Twitter/X, internal intranets).
- **100% Client-Side and Zero Backend**: Executes completely client-side in Chrome's Side Panel. Your API keys, browsing data, and documents never touch a third-party application server.
- **Universal Browser Compatibility**: Runs seamlessly on Google Chrome, Brave, Arc Browser, and Microsoft Edge with side panel support.
- **Multi-Tab Chat Sessions**: Create multiple concurrent chat sessions with individual persistent history stored in `chrome.storage.local`. Reloading or closing pages in Chrome never wipes your conversation history.
- **Clean Dark Zinc Interface**: Designed with Tailwind CSS shades of zinc, crisp Inter typography, and Apple-inspired accent elements.

---

## Quick Installation Guide (For New Users)

No technical knowledge or coding required. Follow these steps to install OpenBUA in your browser in under 2 minutes:

### Step 1: Download the Pre-Built Extension
1. Go to the [Releases](https://github.com/AliSharjeell/OpenBUA/releases) page.
2. Under the latest release, click on **`OpenBUA-extension.zip`** to download it.
3. Unzip the downloaded file to a folder on your computer. You will see a folder containing `manifest.json`, `sidepanel.html`, etc.

### Step 2: Open Chrome Extensions and Enable Developer Mode
1. Open Google Chrome.
2. In the address bar, navigate to `chrome://extensions` and press **Enter** (or open the menu at top-right -> **Extensions** -> **Manage Extensions**).
3. In the top-right corner of the Extensions page, switch the **Developer mode** toggle to **ON**.
   - Note: "Developer mode" is a free built-in setting available in every copy of Chrome that allows loading local extensions.

### Step 3: Load the Extension
1. After enabling Developer mode, click the **Load unpacked** button in the top-left corner.
2. Select the unzipped folder containing `manifest.json` (the folder extracted in Step 1).
3. Click **Select Folder**.
4. OpenBUA is now installed. Click the puzzle icon (Extensions) in your Chrome toolbar and pin **OpenBUA** for quick access.

### Step 4: Configure Your AI Key
1. Click the **OpenBUA** icon on your Chrome toolbar to open the Side Panel.
2. Click the **Settings** tab.
3. Choose your configuration:
   - **Google Gemini (Free)**: Click "Get a free Gemini API key", paste your key, and select Gemini 3.5 Flash Lite.
   - **BYOK**: Select OpenAI Compatible or Anthropic Compatible, paste your API key, and specify your model ID.
4. Click **Test Connection** to confirm connectivity, then click **Save Settings**.

---

## Alternative: Build from Source (For Developers)

If you prefer to build the extension from source:

```bash
git clone https://github.com/AliSharjeell/OpenBUA.git
cd OpenBUA
npm install
npm run build
```

Then in `chrome://extensions` with Developer mode enabled, click **Load unpacked** and select the `dist` folder.

---

## Architecture

```
OpenBUA/
├── manifest.json              # Chrome Manifest V3 configuration
├── sidepanel.html             # Side Panel HTML entry
├── vite.config.ts             # Vite build configuration
├── tailwind.config.js         # Dark-zinc palette and Inter font theme
├── scripts/
│   ├── build-extension.js     # Production build and bundling pipeline
│   └── generate-icons.js      # Extension icons generator
├── src/
│   ├── background/
│   │   └── service-worker.ts  # MV3 service worker and side panel launcher
│   ├── content/
│   │   └── content-script.ts  # DOM scanner, native input setter and event dispatcher
│   ├── agent/
│   │   ├── form-agent.ts      # Main agent harness wrapping pi-agent-core Agent
│   │   ├── stream-adapter.ts  # BYOK streaming adapter (OpenAI, Gemini, Anthropic SSE)
│   │   ├── tools.ts           # Browser use tool schemas and executors
│   │   └── browser-bridge.ts  # Chrome tabs and scripting communication bridge
│   ├── services/
│   │   ├── storage.ts         # Scoped local storage service (chrome.storage.local)
│   │   └── pdf-parser.ts      # In-browser PDF and text extractor
│   ├── components/
│   │   ├── ChatView.tsx       # Main chat interface with tool visualizer and file uploader
│   │   ├── MemoryView.tsx     # Global and Tab memory manager with toggle controls
│   │   ├── PreviewView.tsx    # Live research preview tab with streaming markdown
│   │   ├── SuggestedMemoriesView.tsx # Self-learning proactive memory suggestion view
│   │   ├── VaultView.tsx      # Secure credential and profile vault interface
│   │   ├── SettingsView.tsx   # Free Gemini and BYOK provider settings
│   │   ├── MarkdownRenderer.tsx # GitHub Flavored Markdown renderer with table repair
│   │   └── ui/                # UI component primitives (Button, Input, Card, Badge)
│   ├── sidepanel/
│   │   ├── App.tsx            # Application root with persistent chat session tabs
│   │   └── main.tsx           # React entry point
│   └── types/
│       └── index.ts           # TypeScript interfaces and contracts
└── test-form.html             # Multi-step test form for verification
```

---

## Usage Examples

### 1. Autonomous Form Filling
Open any web form (or open `test-form.html` in Chrome) and click the **Fill active form automatically** button above the input bar, or ask:
```
Inspect the form on this page, match it against my stored profile, and fill in all fields.
```
OpenBUA will inspect the DOM, retrieve matching data from your memory store, fill the fields using native synthetic events, and report what was filled.

### 2. Deep Web Research with Live Preview
Navigate to any directory, search results page, or social platform and ask:
```
Search for 'world models PhD' researchers, go through the results pages, and extract a table containing name, current affiliation, and location.
```
Switch to the **Preview** tab in the top navigation to watch candidate rows stream into a formatted markdown table in real time as the agent navigates.

### 3. Real Email Outreach from Your Signed-in Email Client (Gmail, Outlook, Webmail)
Because OpenBUA operates right inside your existing browser, it can send genuine emails through your active, signed-in Gmail or Outlook account without asking for third-party OAuth permissions, SMTP passwords, or API configurations.

Simply open or let OpenBUA navigate to Gmail and instruct it:
```
Email Yann LeCun (yann.lecun@nyu.edu) to supervise our final year project. We are three FAST NUCES computer science students from Karachi, Pakistan building small world models with multi-token prediction. Draft a respectful email introducing our project and send it from my active Gmail account.
```
OpenBUA will:
- Switch to or open your active Gmail tab.
- Click Compose to trigger the Gmail draft window.
- Enter the recipient address and dispatch confirmed chip creation.
- Populate a clear subject line and draft a well-structured email body.
- Click Send to dispatch the email directly from your personal or professional mailbox.

---

## Search & Discovery Keywords

Autonomous AI browser agent, browser-use Chrome extension, in-browser AI automation, automated web research, AI form filling, Claude Code for browser, local browser automation, Manifest V3 AI agent, web scraping assistant, self-learning agent memory, live research preview, BYOK browser agent.

---

## Development

- **Build**: `npm run build`
- **Typecheck**: `npm run typecheck`
- **Media transport tests**: `npm run test:chunks`
- **Development Server**: `npm run dev`

---

## Privacy Policy

OpenBUA is completely client-side. We do not operate external application servers and do not collect, track, log, or sell your browsing history, personal data, or form inputs. Read our full policy in [PRIVACY.md](PRIVACY.md).

---

## License

MIT
