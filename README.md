# AutoForm AI ⚡

**AutoForm AI** is an autonomous, 100% client-side Chrome Extension (Manifest V3) that intelligently inspects and fills web forms using your locally stored documents, resumes, and personal profiles.

Built with **`@earendil-works/pi-agent-core`** and **`@earendil-works/pi-ai`** as the main AI agent harness, featuring a sleek, dark-themed **Shadcn UI** sidebar layout with **Geist font** and shades of zinc.

---

## 🌟 Key Features

- **100% Client-Side & Zero Backend**: Runs directly inside your browser as a Chrome Extension with no external servers.
- **Pi AI & Agent Core Harness**: Powered by `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` for autonomous loop management, tool execution, and streaming responses.
- **Deep DOM Inspection & Form Filling Tools**:
  - `get_active_tab_form`: Discovers all inputs, dropdowns (`<select>`), textareas, checkboxes, radio buttons, labels, and action buttons.
  - `fill_form_fields`: Uses native property setters and dispatches complete synthetic event chains (`input`, `change`, `blur`) to ensure 100% compatibility with **React, Vue, Angular, Svelte**, and vanilla forms.
  - `click_element`: Clicks buttons like "Next", "Continue", or tabs in multi-page forms.
  - `scroll_page`: Scrolls to reveal hidden or lazy-loaded fields.
  - `get_user_documents`: Reads personal data from local storage.
  - `capture_tab_screenshot`: Visual tab inspection.
  - `list_browser_tabs`, `switch_browser_tab`, `navigate_browser_tab`: Complete Chrome browser control tools.
- **Multipage & Multi-Step Form Support**: Autonomously inspects current step, fills matching fields, advances to the next step, re-inspects new fields, and requests confirmation before final submission.
- **Local Knowledge Vault**:
  - Store resumes, work history, addresses, and custom profile data.
  - Supports uploading `.pdf` files (with in-browser text extraction powered by `pdfjs-dist`), `.md` (Markdown), `.txt`, and `.json`.
  - Persisted securely in `chrome.storage.local`.
- **BYOK (Bring Your Own Key)**:
  - Supports **OpenAI-compatible** APIs (OpenAI, OpenRouter, Minimax, Groq, DeepSeek, Local Ollama).
  - Supports **Anthropic-compatible** APIs (Anthropic Claude, Minimax Anthropic-compatible, Mimo).
  - Customizable **Base URL**, **API Key**, and **Model ID**.
  - Built-in **Connection Test Probe** to verify credentials and response latency.
  - Sets `anthropic-dangerous-direct-browser-access: true` automatically for direct browser calls.
- **Minimalist Dark Zinc UI**:
  - Styled with Tailwind shades of zinc (`zinc-950` to `zinc-50`) and Geist font.
  - Interactive tool execution accordions showing live arguments and outputs.
  - Quick action chips: *Fill Form*, *Inspect Fields*, *Next Step*, *Screenshot*.

---

## 🏗️ Architecture

```
form-filling-ai/
├── manifest.json              # Chrome Manifest V3 configuration
├── sidepanel.html             # Chrome Side Panel HTML entry
├── vite.config.ts             # Vite build configuration
├── tailwind.config.js         # Dark-zinc palette & Geist font theme
├── scripts/
│   ├── build-extension.js     # Production build & bundling pipeline
│   └── generate-icons.js      # Script that generated extension icons
├── src/
│   ├── background/
│   │   └── service-worker.ts  # MV3 background worker & sidePanel trigger
│   ├── content/
│   │   └── content-script.ts  # DOM scanner, native input setter & event dispatcher
│   ├── agent/
│   │   ├── form-agent.ts      # Main agent harness wrapping pi-agent-core Agent
│   │   ├── stream-adapter.ts  # BYOK streaming adapter (OpenAI & Anthropic SSE)
│   │   ├── tools.ts           # AgentTool definitions with TypeBox schemas
│   │   └── browser-bridge.ts  # Chrome tabs & scripting communication bridge
│   ├── services/
│   │   ├── storage.ts         # Local storage service (chrome.storage.local)
│   │   └── pdf-parser.ts      # In-browser PDF & text extractor
│   ├── components/
│   │   ├── ChatView.tsx       # Sidebar chat layout with tool visualizer
│   │   ├── VaultView.tsx      # Document & PDF knowledge base manager
│   │   ├── InspectorView.tsx  # Live DOM form scanner & button triggers
│   │   ├── SettingsView.tsx   # BYOK provider, endpoint & key settings
│   │   └── ui/                # Shadcn zinc UI components (Button, Input, Card, Badge)
│   └── sidepanel/
│       ├── App.tsx            # Main application tab orchestrator
│       └── main.tsx           # React entry point
└── test-form.html             # Interactive multi-step form for testing
```

---

## 🚀 Getting Started

### 1. Build the Extension
```bash
npm run build
```
This builds:
- Sidepanel app to `dist/sidepanel.html` and `dist/assets/`
- Background service worker to `dist/background.js`
- Content script to `dist/content.js`
- Copies `manifest.json` and icons to `dist/`

### 2. Load into Google Chrome
1. Open Google Chrome and go to `chrome://extensions/`.
2. Toggle on **Developer mode** in the top-right corner.
3. Click **Load unpacked** (top-left).
4. Select the `dist` folder located inside `C:\AppsNew\form-filling-ai\dist`.
5. Pin the **AutoForm AI** extension to your toolbar.

### 3. Open Side Panel & Configure BYOK
1. Click the **AutoForm AI** icon in Chrome's toolbar (or open Chrome's Side Panel).
2. Go to the **BYOK** tab (Settings):
   - Choose **OpenAI Compatible** or **Anthropic Compatible**.
   - Enter your **API Key** (e.g. OpenAI key, Anthropic key, Minimax key, Mimo key).
   - Enter your custom **Base URL** (or leave default).
   - Enter your **Model ID** (e.g. `gpt-4o`, `claude-3-7-sonnet-20250219`, `minimax-text-01`).
   - Click **Test Connection** to verify your key.
   - Click **Save Settings**.

### 4. Manage Your Documents (Vault)
1. Go to the **Vault** tab.
2. An example profile is provided by default (*Alex Mercer*).
3. Upload your resume or document as a **PDF**, **Markdown**, or **Text** file using the **Upload PDF/MD** button.
4. Toggle documents active or inactive for the agent's context.

### 5. Test Form Filling
1. Open `test-form.html` in Chrome:
   - File path: `file:///C:/AppsNew/form-filling-ai/test-form.html`
2. Open the AutoForm AI side panel.
3. Click the **⚡ Fill Form** button or type:
   > *"Fill out this application form using my active profile."*
4. Watch the agent:
   - Call `get_active_tab_form` to inspect the form inputs.
   - Call `fill_form_fields` to populate first name, last name, email, phone, city, etc.
   - Notice the green visual highlight on filled fields.
   - Call `click_element` or click **Next Step** to proceed to Step 2 (Experience) and Step 3.

---

## 🛠️ Development & Typecheck

- **Rebuild Extension**: `npm run build`
- **Typecheck**: `npm run typecheck`
- **Vite Dev Server**: `npm run dev`

---

## 📄 License
MIT
