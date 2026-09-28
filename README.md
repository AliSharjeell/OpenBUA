# OpenBUA (Open Browser Use Agent)

**OpenBUA** is an open-source, autonomous browser use Chrome Extension (Manifest V3) that runs directly inside your everyday browser. Unlike cloud browser-use tools that require spun-up headless containers, login bypass proxies, or remote servers, OpenBUA operates right inside your existing Chrome instance with all your active sessions, cookies, and logins already available.

Built with **`@earendil-works/pi-agent-core`** and **`@earendil-works/pi-ai`**, OpenBUA equips AI models with real-time DOM perception, intelligent multi-step navigation, native synthetic event form-filling, and local persistent memory.

---

## What Can OpenBUA Do?

Because OpenBUA runs directly in your existing browser, it can perform complex autonomous workflows without needing you to log in again:

- **Autonomous Web Research & Lead Generation**:
  - Example: *"Search LinkedIn for 'world models PhD' researchers, extract profiles across pages, and compile a structured table with names, headlines, and locations."*
  - Example: *"Go through recent Hacker News submissions on LLM agents, find the top 5 discussions, and summarize key takeaways."*
- **Autonomous Form Filling & Wizard Completion**:
  - Automatically matches job application forms (Greenhouse, Lever, Workday) and complex customer onboarding forms with your locally stored resume and profile.
  - Dispatches native synthetic event chains (`input`, `change`, `blur`) ensuring 100% compatibility with React, Vue, Angular, Svelte, and vanilla forms.
- **Social Media & Community Interaction**:
  - Interacts with YouTube, Twitter/X, Reddit, GitHub, and forums using your already logged-in session.
- **Multi-Step Web Tasks & Data Extraction**:
  - Paginated data scraping, clicking pagination buttons, navigating between tabs, scrolling dynamically to trigger lazy-loaded items, and compiling results into clean GitHub Flavored Markdown tables.

---

## Key Features

- **Runs in Your Existing Browser**: Zero headless emulators or cloud browsers. OpenBUA leverages your everyday authenticated sessions (Google, GitHub, LinkedIn, Twitter/X, internal company portals).
- **100% Client-Side & Zero Backend**: Executes completely client-side in Chrome's Side Panel. Your API keys, browsing data, and documents never touch a third-party server.
- **Multi-Tab Chat Sessions**: Create multiple concurrent chat sessions with individual persistent history stored forever in `chrome.storage.local`. Navigating or reloading pages in Chrome never wipes your chat history.
- **Hybrid Memory Architecture**:
  - **Global Memory**: General knowledge (personal profile, resume, work history) available across all chats and browser tabs.
  - **Tab Memory**: Notes and documents scoped specifically to your active chat session.
  - **Direct Upload**: Drop or upload PDF, Markdown, Text, or JSON files straight from the chat bar. Text extraction runs entirely in-browser using `pdfjs-dist`.
- **Bring Your Own Key (BYOK)**:
  - Connect any OpenAI-compatible provider (OpenAI, OpenRouter, Groq, DeepSeek, Local Ollama).
  - Connect any Anthropic-compatible provider (Claude, MiniMax, Mimo).
  - Built-in live connection testing and automatic role normalization.
- **Robust DOM Perception & Action Tools**:
  - `get_active_tab_form`: Discovers inputs, selects, textareas, buttons, and contenteditable elements with stable IDs.
  - `fill_form_fields`: Sets values using native prototype setters with DOM verification to prevent hallucinated submissions.
  - `click_element`: Simulates trusted clicks on buttons, links, and interactive elements.
  - `scroll_page`: Scrolls dynamically to reveal below-the-fold content.
  - `capture_tab_screenshot`: Visual snapshot inspection.
  - `get_page_content`: Full structured DOM text extraction.
  - `list_browser_tabs`, `switch_browser_tab`, `navigate_browser_tab`: Cross-tab browser navigation.
- **Clean Dark Zinc Interface**:
  - Designed with Tailwind CSS shades of zinc and Geist font.
  - Rounded pill tab selectors, markdown preview rendering with `marked`, and collapsible execution traces for tool calls.

## Quick Installation Guide (For New Users)

No technical knowledge or coding required. Follow these steps to install OpenBUA in your browser in under 2 minutes:

### Step 1: Download the Pre-Built Extension
1. Go to the [Releases](https://github.com/AliSharjeell/OpenBUA/releases) page.
2. Under the latest release, click on **`OpenBUA-v1.0.0.zip`** to download it.
3. Unzip / extract the downloaded file to a folder on your computer (e.g. your Downloads or Documents folder). You will see a folder containing `manifest.json`, `sidepanel.html`, etc.

### Step 2: Open Chrome Extensions & Enable Developer Mode
1. Open Google Chrome.
2. In the address bar at the top, type `chrome://extensions` and press **Enter** (or click the three dots menu at top-right -> **Extensions** -> **Manage Extensions**).
3. In the top-right corner of the Extensions page, switch the **Developer mode** toggle to **ON**.
   - Note: You do NOT need a paid Chrome Web Store developer account. "Developer mode" is a free built-in switch available in every copy of Chrome that lets you load unpacked extensions.

### Step 3: Load the Extension
1. After turning Developer mode on, three buttons will appear in the top-left corner: **Load unpacked**, **Pack extension**, and **Update**.
2. Click **Load unpacked**.
3. In the file picker window, select the unzipped folder containing `manifest.json` (the folder you extracted in Step 1).
4. Click **Select Folder**.
5. OpenBUA is now installed! Click the puzzle icon (Extensions) in your Chrome toolbar and click the pin icon next to **OpenBUA** so it stays visible on your toolbar.

### Step 4: Configure Your AI Key (Or Get a Free Key)
1. Click the **OpenBUA** icon on your Chrome toolbar to open the Side Panel.
2. Click the **Settings** tab.
3. Choose your provider:
   - **OpenAI Compatible**: for OpenAI (ChatGPT), Groq, OpenRouter, DeepSeek, or local Ollama.
   - **Anthropic Compatible**: for Claude or MiniMax.
4. Paste your API Key and enter your Model ID (e.g. `qwen/qwen3.8-27b`, `gpt-4o`, `claude-3-7-sonnet-20250219`).
5. Click **Test Connection** to make sure it works, then click **Save Settings**.

---

## How to Use OpenBUA 100% Free with Groq

You do not need a paid subscription or credit card to use OpenBUA. Groq provides ultra-fast free cloud API access:

1. **Create a Free Groq Account**:
   - Go to [console.groq.com](https://console.groq.com) and sign up for a free account.
2. **Generate an API Key**:
   - Navigate to the **API Keys** tab on the left menu (or visit [console.groq.com/keys](https://console.groq.com/keys)).
   - Click **Create API Key**, give it a name (e.g., `OpenBUA`), and copy the key (starts with `gsk_...`).
3. **Configure in OpenBUA**:
   - Open OpenBUA in your Chrome side panel and go to **Settings**.
   - Under **OpenAI Compatible**, paste your `gsk_...` key. OpenBUA will automatically detect your Groq key!
   - Base URL: `https://api.groq.com/openai/v1/chat/completions` (or click the **Groq (Free)** preset button).
   - Model ID: `qwen/qwen3.8-27b` (recommended, high rate limit and excellent tool performance) or `llama-3.3-70b-versatile`.
   - Click **Save Settings**.
4. **Built-in Rate Limit Handling**:
   - Groq free tier has an input tokens-per-minute rate limit. OpenBUA has built-in smart rate-limit retry: if you reach a free tier limit, OpenBUA automatically pauses, displays a countdown timer, and resumes your task seamlessly without crashing!

**Important Disclaimer**: Groq free accounts have strict rate limiting and limitations on both input and output tokens. This is great for testing and getting started, but for serious, fast, and reliable work, use a proper API key from a paid provider such as Claude, GPT, GLM, Qwen, Kimi, Meta, Minimax, Grok, Mimo, or DeepSeek.

---

## Alternative: Build from Source (For Developers)

If you prefer to build the extension yourself:

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
├── tailwind.config.js         # Dark-zinc palette & Geist font theme
├── scripts/
│   ├── build-extension.js     # Production build & bundling pipeline
│   └── generate-icons.js      # Extension icons generator
├── src/
│   ├── background/
│   │   └── service-worker.ts  # MV3 service worker & side panel launcher
│   ├── content/
│   │   └── content-script.ts  # DOM scanner, native input setter & event dispatcher
│   ├── agent/
│   │   ├── form-agent.ts      # Main agent harness wrapping pi-agent-core Agent
│   │   ├── stream-adapter.ts  # BYOK streaming adapter (OpenAI & Anthropic SSE)
│   │   ├── tools.ts           # Browser use tool schemas & executors
│   │   └── browser-bridge.ts  # Chrome tabs & scripting communication bridge
│   ├── services/
│   │   ├── storage.ts         # Scoped local storage service (chrome.storage.local)
│   │   └── pdf-parser.ts      # In-browser PDF & text extractor
│   ├── components/
│   │   ├── ChatView.tsx       # Main chat interface with tool visualizer & file uploader
│   │   ├── MemoryView.tsx     # Global & Tab memory manager with toggle controls
│   │   ├── MarkdownRenderer.tsx # GitHub Flavored Markdown renderer
│   │   ├── InspectorView.tsx  # Live DOM element scanner & interactive triggers
│   │   ├── SettingsView.tsx   # BYOK provider, endpoint & key settings
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

### 2. Deep Web Research & Data Extraction
Navigate to any directory, search results page, or social platform and ask:
```
Search for 'world models PhD' researchers, go through the results pages, and extract a table containing name, current affiliation, and location.
```

### 3. Page Interaction & Automation
```
Scroll down to the comments section of this video and draft a thoughtful response based on the video topic.
```

---

## Development

- **Build**: `npm run build`
- **Typecheck**: `npm run typecheck`
- **Development Server**: `npm run dev`

---

## License
MIT
