# AutoForm AI ⚡

**AutoForm AI** is an autonomous, 100% client-side Chrome Extension (Manifest V3) that intelligently inspects, reasons over, and fills web forms using your locally stored profile and documents (PDF, Markdown, Text, JSON).

Built with **`@earendil-works/pi-agent-core`** and **`@earendil-works/pi-ai`** as the core AI agent harness, featuring a sleek, dark-themed **Shadcn UI** sidebar layout with **Geist font** and shades of zinc.

---

## 🌟 Key Features

- **100% Client-Side & Zero Backend**: Runs directly inside your browser as a Chrome Side Panel extension. Zero external backend servers—your data, keys, and documents remain strictly local.
- **Pi AI & Agent Core Harness**: Powered by `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` for autonomous loop management, tool calling, and live streaming.
- **Deep DOM Inspection & Native Form Filling Tools**:
  - `get_active_tab_form`: Discovers all inputs, selects, textareas, checkboxes, radio buttons, labels, and action buttons in the active tab.
  - `fill_form_fields`: Uses native prototype property setters and dispatches complete synthetic event chains (`input`, `change`, `blur`) to ensure 100% compatibility with **React, Vue, Angular, Svelte**, and vanilla forms.
  - `click_element`: Clicks buttons like "Next", "Continue", or tabs in multi-page wizard forms.
  - `scroll_page`: Scrolls dynamically to reveal hidden or lazy-loaded fields.
  - `get_user_documents`: Reads personal profile and memory data from local storage.
  - `capture_tab_screenshot`: Visual inspection of web pages.
  - `list_browser_tabs`, `switch_browser_tab`, `navigate_browser_tab`: Full browser control capabilities.
- **Per-Tab Chat & Memory + Global Memory**:
  - **In-Sidebar Tab Strip**: Switch between open browser tabs directly inside the side panel with inverted white active pill indicators and site favicons.
  - **Tab-Scoped Chat**: Each browser tab maintains its own chat history and transcript persisted in `chrome.storage.local`.
  - **Global Memory**: Persistent memory across all tabs (e.g., personal profile, resume, contact info).
  - **Tab-Scoped Memory**: Dedicated memories for specific sites or tasks.
  - **Clean Tick Toggles**: Quickly turn individual memories on or off for the AI context.
- **Direct Chat File Upload**:
  - Upload `.pdf`, `.md`, `.txt`, or `.json` files directly from the chat input.
  - In-browser text extraction powered by `pdfjs-dist`.
- **Rich Markdown Chat Previews**:
  - Live preview and rendering of formatted GitHub Flavored Markdown (tables, code blocks, lists, bold text) using `marked`.
- **BYOK (Bring Your Own Key)**:
  - Supports **OpenAI-compatible** APIs (OpenAI, OpenRouter, Groq, DeepSeek, Local Ollama).
  - Supports **Anthropic-compatible** APIs (Claude, MiniMax, Mimo).
  - Configurable **Base URL**, **API Key**, and **Model ID**.
  - Built-in **Connection Test Probe** to verify credentials and response latency.
  - Automated role normalization (enforcing alternating `user`/`assistant` turns and merging multi-tool results) to ensure compatibility with MiniMax and Claude APIs.
- **Minimalist Dark Zinc UI**:
  - Styled with Tailwind shades of zinc (`zinc-950` to `zinc-50`) and Geist font.
  - Rounded pill tab selectors and round input design.
  - Expandable tool execution blocks displaying real-time execution steps and results.

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
│   └── generate-icons.js      # Extension icons generator
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
│   │   ├── storage.ts         # Scoped local storage service (chrome.storage.local)
│   │   └── pdf-parser.ts      # In-browser PDF & text extractor
│   ├── components/
│   │   ├── ChatView.tsx       # Sidebar chat layout with tool visualizer & direct upload
│   │   ├── MemoryView.tsx     # Global & Tab memory manager with tick toggles
│   │   ├── MarkdownRenderer.tsx # GitHub Flavored Markdown renderer
│   │   ├── InspectorView.tsx  # Live DOM form scanner & button triggers
│   │   ├── SettingsView.tsx   # BYOK provider, endpoint & key settings
│   │   └── ui/                # Shadcn zinc UI components (Button, Input, Card, Badge)
│   ├── sidepanel/
│   │   ├── App.tsx            # Main application tab orchestrator with browser tabs strip
│   │   └── main.tsx           # React entry point
│   └── types/
│       └── index.ts           # TypeScript interfaces and contracts
└── test-form.html             # Multi-step test form for verification
```

---

## 🚀 Getting Started

### 1. Build the Extension
```bash
npm install
npm run build
```
This builds:
- Sidepanel app to `dist/sidepanel.html` and `dist/assets/`
- Background service worker to `dist/background.js`
- Content script to `dist/content.js`
- Copies `manifest.json`, `test-form.html`, and icons to `dist/`

### 2. Load into Google Chrome
1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Toggle on **Developer mode** in the top-right corner.
3. Click **Load unpacked** (top-left).
4. Select the `dist` folder located inside `form-filling-ai/dist`.
5. Pin the **AutoForm AI** extension to your toolbar.

### 3. Open Side Panel & Configure Settings
1. Click the **AutoForm AI** icon in Chrome's toolbar (or open Chrome's Side Panel).
2. Go to the **Settings** tab:
   - Choose **OpenAI Compatible** or **Anthropic Compatible**.
   - Enter your **API Key** (OpenAI, Claude, MiniMax, etc.).
   - Enter your custom **Base URL** (or leave default).
   - Enter your **Model ID** (e.g. `gpt-4o`, `claude-3-7-sonnet-20250219`, `minimax-text-01`).
   - Click **Test Connection** to verify your credentials.
   - Click **Save Settings**.

### 4. Manage Memory
1. Go to the **Memory** tab.
2. A default profile (*Alex Mercer*) is pre-loaded in **Global Memory**.
3. Upload your resume or custom document as a **PDF**, **Markdown**, or **Text** file using the upload icon, or add details directly.
4. Use the tick toggles to enable or disable individual memories from the AI's context.

### 5. Fill Forms Autonomously
1. Open any web form (or open `test-form.html` in Chrome).
2. In the AutoForm AI chat, click the **Fill Form** button above the input bar or type:
   > *"Inspect this current page form, match with my profile, and fill all inputs."*
3. AutoForm AI will inspect all input fields, map your details accurately, fill every input, and report the results!

---

## 🛠️ Development & Typecheck

- **Rebuild Extension**: `npm run build`
- **Typecheck**: `npm run typecheck`
- **Vite Dev Preview**: `npm run dev`

---

## 📄 License
MIT
