// Form Filling Agent Harness powered by @earendil-works/pi-agent-core
import { Agent, AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core';
import { AssistantMessage, ToolResultMessage } from '@earendil-works/pi-ai';
import { ALL_AGENT_TOOLS } from './tools';
import { createCustomModel, createStreamFn } from './stream-adapter';
import { AppSettings, UserDocument, ToolCallState, ChatMessage, ProviderConfig } from '../types';
import { setActiveSessionIdState } from '../services/storage';

export interface AgentUpdateListeners {
  onMessageDelta?: (text: string) => void;
  onThinkingDelta?: (text: string) => void;
  onToolCallStart?: (toolCall: ToolCallState) => void;
  onToolCallEnd?: (toolCall: ToolCallState) => void;
  onTurnComplete?: (assistantText: string, toolCalls: ToolCallState[], thinkingText?: string) => void;
  onError?: (error: string) => void;
  onStatusChange?: (isBusy: boolean) => void;
}

export function convertChatMessagesToAgentMessages(
  chatMessages: ChatMessage[],
  config: ProviderConfig
): AgentMessage[] {
  const result: AgentMessage[] = [];

  // Identify older assistant turns with tool calls to compact rehydrated history
  const assistantMsgsWithTools = chatMessages.filter(
    (m) => m.role === 'assistant' && (m.toolCalls || []).some((tc) => tc.id && tc.toolName)
  );
  const recentAssistantMsgIds = new Set<string>();
  if (assistantMsgsWithTools.length > 0) {
    const recent = assistantMsgsWithTools.slice(-2);
    for (const m of recent) {
      if (m.id) recentAssistantMsgIds.add(m.id);
    }
  }

  for (const msg of chatMessages) {
    if (msg.role === 'user') {
      const text = msg.content?.trim();
      if (text) {
        result.push({
          role: 'user',
          content: text,
          timestamp: msg.timestamp || Date.now(),
        });
      }
    } else if (msg.role === 'assistant') {
      // Filter out pure error alert notifications
      if (msg.content?.startsWith('⚠️') && (!msg.toolCalls || msg.toolCalls.length === 0)) {
        continue;
      }

      const contentBlocks: any[] = [];

      if (msg.thinking && msg.thinking.trim()) {
        contentBlocks.push({
          type: 'thinking',
          thinking: msg.thinking,
        });
      }

      const cleanContent = msg.content?.replace(/^⚠️\s*/, '').trim();
      if (cleanContent) {
        contentBlocks.push({
          type: 'text',
          text: cleanContent,
        });
      }

      const validToolCalls = (msg.toolCalls || []).filter((tc) => tc.id && tc.toolName);
      for (const tc of validToolCalls) {
        contentBlocks.push({
          type: 'toolCall',
          id: tc.id,
          name: tc.toolName,
          arguments: tc.args || {},
          args: tc.args || {},
          extra_content: tc.extra_content,
          thought_signature: tc.thought_signature,
        });
      }

      if (contentBlocks.length === 0) {
        contentBlocks.push({
          type: 'text',
          text: 'Understood.',
        });
      }

      result.push({
        role: 'assistant',
        content: contentBlocks,
        api: config.provider === 'anthropic' ? 'anthropic-messages' : 'openai-completions',
        provider: config.provider,
        model: config.model,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        stopReason: validToolCalls.length > 0 ? 'toolUse' : 'stop',
        timestamp: msg.timestamp || Date.now(),
      } as AssistantMessage);

      // Check if this assistant turn is recent or older
      const isOlderTurn = msg.id ? !recentAssistantMsgIds.has(msg.id) : false;

      // Immediately append corresponding ToolResultMessages for each toolCall
      for (const tc of validToolCalls) {
        let resultText = '';
        if (typeof tc.result === 'string') {
          resultText = tc.result;
        } else if (tc.result?.message) {
          resultText = tc.result.message;
        } else if (tc.result) {
          resultText = JSON.stringify(tc.result);
        } else if (tc.errorMessage) {
          resultText = `Error: ${tc.errorMessage}`;
        } else {
          resultText = tc.status === 'error' ? 'Tool execution failed' : 'Completed';
        }

        // Compact older turn DOM dumps from rehydrated history (keep scratchpad intact)
        if (isOlderTurn && tc.toolName !== 'scratchpad' && resultText.length > 350) {
          const pruned = resultText.length - 300;
          resultText = resultText.slice(0, 300) + `\n... [Prior turn DOM content compacted - ${pruned} chars pruned]`;
        }

        result.push({
          role: 'toolResult',
          toolCallId: tc.id,
          toolName: tc.toolName,
          content: [{ type: 'text', text: resultText }],
          isError: tc.status === 'error',
          timestamp: tc.timestamp || msg.timestamp || Date.now(),
        } as ToolResultMessage);
      }
    }
  }

  return result;
}

export class FormAgentHarness {
  private agent: Agent | null = null;
  private settings: AppSettings;
  private documents: UserDocument[];
  private listeners: AgentUpdateListeners = {};
  private activeToolCalls = new Map<string, ToolCallState>();
  private currentStreamingText = '';
  private currentThinkingText = '';
  private sessionThinkingText = '';
  private chatHistory: ChatMessage[] = [];
  private sessionId: string = 'session_default';

  constructor(
    settings: AppSettings,
    documents: UserDocument[],
    listeners?: AgentUpdateListeners,
    initialChatHistory: ChatMessage[] = [],
    sessionId: string = 'session_default'
  ) {
    this.settings = settings;
    this.documents = documents;
    if (listeners) this.listeners = listeners;
    this.chatHistory = initialChatHistory;
    this.sessionId = sessionId;
    setActiveSessionIdState(sessionId);
    this.setupAgent();
  }

  public setSessionId(sessionId: string) {
    this.sessionId = sessionId;
    setActiveSessionIdState(sessionId);
  }

  public getSessionId(): string {
    return this.sessionId;
  }

  public updateConfig(settings: AppSettings, documents: UserDocument[]) {
    this.settings = settings;
    this.documents = documents;
    this.setupAgent();
  }

  public setListeners(listeners: AgentUpdateListeners) {
    this.listeners = listeners;
  }

  private buildSystemPrompt(): string {
    const activeDocs = this.documents.filter((d) => d.isActiveForContext);
    let docsSummary = '';

    if (activeDocs.length > 0) {
      docsSummary = `\n\n### USER'S STORED KNOWLEDGE & DOCUMENTS:\nAll user documents, personal profile, resume, and data are stored below. Use this exact data to fill matching web forms:\n`;
      activeDocs.forEach((doc, idx) => {
        docsSummary += `\n--- Document [${idx + 1}]: ${doc.title} (${doc.type}) ---\n${doc.content}\n`;
      });
    } else {
      docsSummary = `\n\nNo user documents are currently active in storage. If you need data, call get_user_documents or ask user.`;
    }

    return `You are OpenBUA (Open Browser Use Agent), an autonomous browser extension agent that uses the user's active browser to navigate, research, extract data, interact with elements, fill forms, and automate web tasks directly.

CRITICAL OPERATING RULES & ENVIRONMENT CONTEXT:
0. REASONING & CHAIN-OF-THOUGHT MANDATE:
   - For every user message or turn, you must FIRST reason step-by-step: understand the user's intent, inspect what needs to be done, evaluate the browser context, and plan your immediate action or response before executing tools or outputting your response.
   - Always think concisely step-by-step.
1. USER'S PRIMARY BROWSER & SIGNED-IN SESSIONS:
   - You run directly inside the user's everyday personal desktop browser.
   - ALWAYS assume the user is ALREADY signed into their accounts (Google, YouTube, GitHub, Twitter/X, Reddit, work portals, etc.) unless an explicit "Sign in" button is visible and blocking form interaction.
   - Do NOT assume the user is logged out.
2. NEVER ASK THE USER TO SHARE SCREENSHOTS OR PASTE URLS:
   - You have direct access to the user's active browser tab via 'get_active_tab_form', 'get_page_content', and 'inspect_element'.
   - Call 'get_active_tab_form' immediately to inspect the active tab's form and inputs yourself.
3. NEVER ASK THE USER FOR STORED PROFILE DETAILS:
   - The user's complete profile, resume, and application data are loaded below in "USER'S STORED KNOWLEDGE & DOCUMENTS" and accessible via 'get_user_documents'. Match them directly!
4. ANTI-HALLUCINATION & STRICT DOM VERIFICATION PROTOCOL:
   - NEVER fabricate or hallucinate that a comment was posted, a form was submitted, or a field was filled if the tool response does not confirm it.
   - When calling 'fill_form_fields', inspect the 'DOM Verifications' in the tool response. If a field shows '[UNVERIFIED] in DOM' or '[NOT FOUND]', DO NOT claim it was filled.
   - To post a comment (e.g. YouTube):
     a. Locate the comment box (often contenteditable or #simplebox-placeholder).
     b. Call 'fill_form_fields' with the text.
     c. Look for the submit/comment button (e.g., text: "Comment", "Post", "Reply", or refId).
     d. Call 'click_element' on that button.
     e. Only claim it was posted after clicking the submit button. Never fabricate timestamps or fake usernames (e.g. "@Alex Mercer 20 minutes ago").
5. MANDATORY WORKFLOW WHEN USER ASKS TO FILL OR COMMENT:
   - Step 1: Call 'get_active_tab_form' to find all inputs, contenteditable elements, textareas, selects, and buttons.
   - Step 2: Match each form field with the user's stored documents or user's instructions.
   - Step 3: Call 'fill_form_fields' with the assignments.
   - Step 4: For multi-step forms or submission, click the relevant button using 'click_element'.
   - Step 5: Inform the user honestly of the outcome based on tool results.
6. TABLE & DATA EXTRACTION FORMATTING:
   - When presenting structured lists of data, profiles, leads, or search results across pages, ALWAYS format them as standard GitHub Flavored Markdown (GFM) tables with header and delimiter rows:
     | # | Name | Headline / Affiliation | Location |
     |---|------|------------------------|----------|
     | 1 | Jane Doe | PhD Researcher | Stanford, USA |
   - Separate every page or section table with a blank line before and after the table to ensure clean rendering.
7. LONG-RUNNING RESEARCH & DATA ACCUMULATION ('scratchpad'):
   - When the user gives you a long-running research or extraction goal (e.g. "find me 100 world model researchers", "find 50 tech leads", "extract all products"):
   - Use the 'scratchpad' tool with action 'append' as you find each item or batch of items across pages.
   - Example: scratchpad({ action: 'append', content: '1. Yann LeCun - Meta AI / NYU - World models architecture\n2. David Ha - Sakana AI...' })
   - This ensures you never lose collected data as you navigate across multiple tabs or pages.
   - Use 'scratchpad' action 'read' to review your progress, verify your count, and format your final response to the user.
8. FAST EMAIL & WEBMAIL AUTOMATION (Gmail, Outlook, Webmail):
   - DIRECT COMPOSE DEEP-LINKING (FASTEST PATH):
     When the user instructs you to email someone, do NOT guess accounts or navigate slowly through UI compose buttons if a direct URL is possible:
     * Navigate directly using 'navigate_browser_tab' to:
       https://mail.google.com/mail/?authuser={email}&view=cm&fs=1&to={to}&su={subject}&body={body}
       (If the user specified an account like 'alisharjeelofficial@gmail.com', use it in authuser. If no specific account was requested, omit authuser: https://mail.google.com/mail/?view=cm&fs=1&to={to}&su={subject}&body={body})
     * All parameters (to, su, body) MUST be properly URL-encoded.
     * This immediately opens the Gmail compose window pre-filled with the recipient, subject, and body!
     * Once loaded, simply dispatch the email by clicking the 'Send' button (or pressing Control+Enter).
   - STANDARD COMPOSE FALLBACK:
     If already on Gmail/webmail and navigating to a deep-link is not needed:
     * Click 'Compose', call 'get_active_tab_form', fill fields, and click 'Send'.

9. ELIMINATE VERIFICATION DEATH-SPIRALS & SPA EXIT CRITERIA:
   - In modern SPAs like Gmail, URLs often retain parameters like '?compose=new' or '?view=cm', and DOM templates for dialogs persist invisibly.
   - Once a 'Message sent' toast appears, the compose dialog closes, or the message is visible in Sent mail, mark the action complete immediately!
   - Do NOT attempt to close, clean up, or inspect background template elements. Do NOT enter an overthinking loop verifying already submitted actions.
   - BAN POST-ACTION SCREENSHOTS: Taking screenshots to verify form typing and sending consumes high model inference time (vision token processing). Never call 'capture_tab_screenshot' after routine form submissions, fills, or email sends. Screenshots are strictly reserved for unhandled errors or when visually blocked.

10. LINKEDIN DISCOVERY & GOOGLE X-RAY SEARCH DIRECTIVE (CRITICAL):
   - HARD ROUTING RULE FOR LINKEDIN PROSPECTING:
     IF the user task mentions finding leads, students, researchers, or prospects "on LinkedIn" or "via LinkedIn" with emails:
     * NEVER NAVIGATE TO linkedin.com/search OR linkedin.com/in/*. NEVER click LinkedIn location modals or filter buttons!
     * LinkedIn strictly conceals emails from non-connections in UI modals (less than 1% are public). Navigating to LinkedIn is a 100% dead-end.
     * ROUTE DIRECTLY TO GOOGLE X-RAY SEARCH! Google X-Ray surfaces profiles where users explicitly typed their public contact email in their bio or headline.
   - PRIMARY SEARCH ENGINE IS ALWAYS GOOGLE (BAN BING & DUCKDUCKGO):
     * ALWAYS route all search lookups through Google Search ('https://www.google.com/search?q={query}' or 'google_xray_search').
     * NEVER use DuckDuckGo or Bing with boolean operators (site:, quotes, @gmail.com) because both engines aggressively trigger bot verification challenges and CAPTCHAs.
   - CANONICAL HIGH-YIELD GOOGLE X-RAY QUERIES (ONE-QUERY DISCOVERY):
     Execute a single, high-recall boolean dork on Google that surfaces profiles with public emails:
     * UK Students:
       https://www.google.com/search?q=site:linkedin.com/in+("student"+OR+"undergraduate"+OR+"BSc"+OR+"MEng")+("@gmail.com")+("London"+OR+"Manchester"+OR+"Birmingham"+OR+"Warwick"+OR+"UK"+OR+"United+Kingdom")
     * US Students:
       https://www.google.com/search?q=site:linkedin.com/in+("student"+OR+"undergrad"+OR+"CS")+("@gmail.com"+OR+"@*.edu")+("University"+OR+"College")+USA
     * World Model / AI Researchers:
       https://www.google.com/search?q=site:linkedin.com/in+OR+site:github.io+("world+models"+OR+"robotics"+OR+"AI")+("PhD"+OR+"professor"+OR+"researcher")+("@gmail.com"+OR+"@*.edu")

11. ZERO-CLICK SERP SNIPPET EXTRACTION & ELIMINATING REDUNDANT VERIFICATION:
   - Google SERP snippets ALREADY contain the prospect's full name, academic institution/role, and unmasked email address (e.g., "Alex Yang — A-Level Student at Aquinas College ... 25alex.yang@gmail.com", "Ece Yalın — Student at University of Warwick ... eceyalin.tc@gmail.com").
   - EXTRACT NAME, INSTITUTION, AND EMAIL DIRECTLY FROM THE GOOGLE SERP SNIPPET IN A SINGLE TURN!
   - STRICT EXTRACTION GUARD: NEVER navigate to the target profile URL (uk.linkedin.com/in/*, github.io) solely to "verify" what is already visible in the search snippet. Navigating to external sites adds 45+ seconds of redundant page loads and DOM trees without new information.
   - LOOSE PERSONA MATCHING: Treat any lead listing a degree expected within ±2 years of the current year (or recent graduates/alumni) as an active match. Do not execute additional verification searches or debate graduation months/semesters.

12. PRODUCT KNOWLEDGE PERSISTENCE & ATOMIC 3-STEP DAG ARCHITECTURE:
   - PERSIST PRODUCT KNOWLEDGE ON TURN 1 (NEVER RE-VISIT TARGET APP):
     When an outreach task involves pitching a product, app, or website (e.g. "pitching petedoro.com"):
     * Turn 1: Inspect the product site ONCE ('get_page_content'). Extract 3 core product bullets (problem solved, key feature/hook, and CTA).
     * Immediately write them to the scratchpad: scratchpad({ action: 'set', content: 'PRODUCT HOOKS: 1. ... 2. ... 3. ...' }).
     * NEVER navigate back to the product website later in the workflow!
   - ATOMIC 3-STEP DAG EXECUTION (TARGET: UNDER 45 SECONDS):
     [Turn 1: Setup & Target Cache] (~10s)
       └─ Inspect product site -> Extract 3 hooks -> Save to Scratchpad
     [Turn 2: Discovery via Single Google X-Ray] (~15s)
       └─ Run single Google X-Ray query -> Extract Candidate 1 & Candidate 2 directly from SERP snippets
     [Turn 3: Parallel Dispatch] (~20s)
       └─ Batch execute send_web_email(Candidate 1) AND send_web_email(Candidate 2) concurrently in a single turn
       └─ Return final completion summary to user
   - BATCH PARALLEL TOOL CALLING POLICY:
     When multiple staged leads are ready for outreach, ALWAYS call 'send_web_email' concurrently in a single turn for all recipients rather than splitting into sequential turns.

13. HUMAN-IN-THE-LOOP (HITL) 10-SECOND CAPTCHA INTERCEPT GATE & AUTOMATED PIVOT:
   - When encountering a bot challenge or CAPTCHA (Cloudflare Turnstile, reCAPTCHA, hCaptcha, Bing verification, Arkose Labs):
     * OpenBUA automatically fires an audio/visual Human-in-the-Loop alert with a strict 10-second countdown for the user to solve it in their browser.
     * If the human solves it within 10 seconds, the gate clears and page automation resumes uninterrupted.
   - AUTOMATED PIVOT WORKAROUND PROTOCOL (WHEN TIMEOUT OR BLOCKED):
     * If any tool response returns '[BLOCKED BY CAPTCHA]: CAPTCHA challenge timed out after 10s...':
     * IMMEDIATELY ABORT THE CURRENT DOMAIN OR SEARCH ENGINE!
     * NEVER retry navigating to the same blocked URL or cycling query mutations on the blocked search engine.
     * Execute the instant automated workaround:
       - If blocked on DuckDuckGo, Bing, or Yahoo -> PIVOT IMMEDIATELY TO GOOGLE X-RAY SEARCH ('https://www.google.com/search?q=...').
       - If blocked on a prospect website/profile -> EXTRACT DATA DIRECTLY FROM THE GOOGLE SERP SNIPPET or switch to another candidate from the search results without navigating to the blocked website.
       - If blocked while checking a portfolio -> Treat the candidate as unverified and move directly to the next lead.
14. MULTI-TAB MANAGEMENT — NEVER NAVIGATE AWAY FROM A PARTIALLY-FILLED FORM:
    - CRITICAL: When you are in the middle of filling a form and need to look up information from another website (e.g. checking a company's address, verifying a URL, researching a question's answer):
      * NEVER use 'navigate_browser_tab' on the current tab — this will DESTROY all form progress and you will lose every field you already filled!
      * ALWAYS use 'open_new_tab' to open the lookup URL in a separate tab.
      * Use 'switch_browser_tab' to switch to the new tab, then 'get_page_content' or 'get_active_tab_form' to read the information you need.
      * Use 'close_tab' to close the lookup tab when done, then 'switch_browser_tab' back to the original form tab to continue filling.
    - WORKFLOW FOR MID-FORM LOOKUPS:
      1. Note the current form tab ID (from 'list_browser_tabs').
      2. Call 'open_new_tab' with the research URL → returns new tab ID.
      3. Call 'switch_browser_tab' to the new tab ID.
      4. Read the needed info with 'get_page_content'.
      5. Call 'close_tab' on the lookup tab ID.
      6. Call 'switch_browser_tab' back to the original form tab ID.
      7. Continue filling the form with the information you gathered.
    - It is SAFE to use 'navigate_browser_tab' ONLY when you are not mid-form (e.g. the user just asked you to go to a URL, or you haven't started filling anything yet).
15. SUBMISSION PERMISSION (${(this.settings.autoConfirmSubmit ?? true) ? 'ASK FOR REVIEW' : 'FULL ACCESS'}):
${(this.settings.autoConfirmSubmit ?? true)
  ? `    - STRICT REQUIREMENT: Before clicking any final form submission, purchase, or destructive button, you MUST STOP and ask the user for review and confirmation. Present a concise summary of the filled fields and ask the user to confirm submission.`
  : `    - FULL AUTONOMY: You have full access to complete actions. When all form fields or required inputs are filled, proceed directly to submit the form without pausing for user confirmation.`}

16. OPERATING TRANSPARENCY & USER COMMUNICATION:
    - ALWAYS communicate with the user before and during multi-step browser actions.
    - Before calling any tools, output a concise 1-2 sentence message explaining what you are doing (e.g. "Opening YouTube in a new tab to find MrBeast's channel...", "Searching for videos and sorting by popularity...").
    - When a task is complete or between steps, summarize your progress clearly to the user.
    - NEVER execute tools silently without providing an accompanying status explanation in your message.

${docsSummary}

${this.settings.systemInstruction || ''}`.trim();
  }

  public getActiveConfig(): ProviderConfig {
    if (this.settings.selectedMode === 'free') {
      return {
        provider: 'openai',
        baseUrl: this.settings.free?.baseUrl || 'https://generativelanguage.googleapis.com/v1beta/openai/',
        apiKey: this.settings.free?.apiKey || '',
        model: this.settings.free?.model || 'gemini-3.5-flash-lite',
        isFreeMode: true,
        mode: 'free',
      };
    }
    const isAnthropic = this.settings.activeProvider === 'anthropic';
    const cfg = isAnthropic ? this.settings.anthropic : this.settings.openai;
    return {
      provider: this.settings.activeProvider,
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      isFreeMode: false,
      mode: 'byok',
    };
  }

  public setConversationHistory(history: ChatMessage[]) {
    this.chatHistory = history;
    const config = this.getActiveConfig();
    const agentMessages = convertChatMessagesToAgentMessages(this.chatHistory, config);
    if (this.agent) {
      try {
        this.agent.state.messages = agentMessages;
      } catch {
        this.setupAgent();
      }
    } else {
      this.setupAgent();
    }
  }

  public setupAgent(initialHistory?: ChatMessage[]) {
    if (initialHistory) {
      this.chatHistory = initialHistory;
    }
    const config = this.getActiveConfig();

    const model = createCustomModel(config);
    const systemPrompt = this.buildSystemPrompt();
    const agentMessages = convertChatMessagesToAgentMessages(this.chatHistory, config);

    this.agent = new Agent({
      initialState: {
        model,
        systemPrompt,
        tools: ALL_AGENT_TOOLS,
        messages: agentMessages.length > 0 ? agentMessages : undefined,
      },
      streamFn: (m, ctx, opts) => createStreamFn(config, m, ctx, opts?.signal),
      toolExecution: 'sequential',
    });

    // Subscribe to pi-agent-core lifecycle events
    this.agent.subscribe((event: AgentEvent) => {
      this.handleAgentEvent(event);
    });
  }

  private handleAgentEvent(event: any) {
    switch (event.type) {
      case 'agent_start':
        this.listeners.onStatusChange?.(true);
        this.currentStreamingText = '';
        this.currentThinkingText = '';
        this.sessionThinkingText = '';
        this.activeToolCalls.clear();
        break;

      case 'turn_start':
        this.currentStreamingText = '';
        this.currentThinkingText = '';
        break;

      case 'message_update':
        if (event.assistantMessageEvent) {
          const ame = event.assistantMessageEvent;
          if (ame.type === 'text_delta') {
            this.currentStreamingText += ame.delta;
            this.listeners.onMessageDelta?.(this.currentStreamingText);
          } else if (ame.type === 'thinking_delta') {
            this.currentThinkingText += ame.delta;
            if (!this.sessionThinkingText) {
              this.sessionThinkingText = ame.delta;
            } else if (this.currentThinkingText === ame.delta && !this.sessionThinkingText.endsWith('\n\n')) {
              this.sessionThinkingText += `\n\n${ame.delta}`;
            } else {
              this.sessionThinkingText += ame.delta;
            }
            this.listeners.onThinkingDelta?.(this.sessionThinkingText);
          } else if (ame.type === 'toolcall_start') {
            const tc = ame.partial?.content?.[ame.contentIndex];
            if (tc && tc.type === 'toolCall') {
              const toolState: ToolCallState = {
                id: tc.id,
                toolName: tc.name,
                args: tc.args || {},
                status: 'running',
                timestamp: Date.now(),
                extra_content: (tc as any).extra_content,
                thought_signature: (tc as any).thought_signature,
              };
              this.activeToolCalls.set(tc.id, toolState);
              this.listeners.onToolCallStart?.(toolState);
            }
          } else if (ame.type === 'toolcall_end') {
            const tc = ame.toolCall;
            if (tc) {
              const existing = this.activeToolCalls.get(tc.id);
              if (existing) {
                existing.args = tc.args;
                if ((tc as any).extra_content) existing.extra_content = (tc as any).extra_content;
                if ((tc as any).thought_signature) existing.thought_signature = (tc as any).thought_signature;
                this.listeners.onToolCallStart?.(existing);
              }
            }
          }
        }
        break;

      case 'tool_execution_start': {
        const anyEvt = event as any;
        const toolCallId = anyEvt.toolCallId || anyEvt.toolCall?.id || `tc_${Date.now()}`;
        const toolName = anyEvt.toolName || anyEvt.toolCall?.name || 'tool';
        const args = anyEvt.args || anyEvt.toolCall?.args || {};

        let toolState = this.activeToolCalls.get(toolCallId);
        if (!toolState) {
          toolState = {
            id: toolCallId,
            toolName,
            args,
            status: 'running',
            timestamp: Date.now(),
          };
          this.activeToolCalls.set(toolCallId, toolState);
        } else {
          toolState.status = 'running';
          if (args && Object.keys(args).length > 0) toolState.args = args;
        }
        this.listeners.onToolCallStart?.(toolState);
        break;
      }

      case 'tool_execution_end': {
        const anyEvt = event as any;
        const toolCallId = anyEvt.toolCallId || anyEvt.toolCall?.id;
        const existing = toolCallId ? this.activeToolCalls.get(toolCallId) : null;
        if (existing) {
          existing.status = anyEvt.isError ? 'error' : 'success';
          existing.result = anyEvt.result?.details || anyEvt.result?.content?.[0]?.text || anyEvt.result;
          if (anyEvt.isError) {
            existing.errorMessage = String(anyEvt.result?.content?.[0]?.text || anyEvt.result?.error || 'Tool failed');
          }
          this.listeners.onToolCallEnd?.(existing);
        }
        break;
      }

      case 'turn_end':
        if (event.message?.errorMessage) {
          this.listeners.onError?.(event.message.errorMessage);
        }
        this.listeners.onTurnComplete?.(
          this.currentStreamingText,
          Array.from(this.activeToolCalls.values()),
          this.sessionThinkingText || this.currentThinkingText || undefined
        );
        break;

      case 'agent_end':
        this.listeners.onStatusChange?.(false);
        break;
    }
  }

  public async prompt(input: string): Promise<void> {
    const config = this.getActiveConfig();
    if (!config.apiKey || !config.apiKey.trim()) {
      const modeLabel =
        this.settings.selectedMode === 'free' ? 'Gemini Free' : this.settings.activeProvider.toUpperCase();
      const err = `Please enter your ${modeLabel} API Key in Settings to continue.`;
      this.listeners.onError?.(err);
      this.listeners.onStatusChange?.(false);
      throw new Error(err);
    }

    if (!this.agent) {
      this.setupAgent();
    }
    if (!this.agent) throw new Error('Agent failed to initialize');

    try {
      this.listeners.onStatusChange?.(true);

      const currentMsgs = this.agent.state.messages;
      const lastMsg = currentMsgs[currentMsgs.length - 1];
      const isAlreadyLastUserMsg =
        lastMsg &&
        lastMsg.role === 'user' &&
        (typeof lastMsg.content === 'string'
          ? lastMsg.content.trim() === input.trim()
          : Array.isArray(lastMsg.content) && (lastMsg.content[0] as any)?.text?.trim() === input.trim());

      if (isAlreadyLastUserMsg) {
        try {
          await this.agent.continue();
        } catch {
          await this.agent.prompt(input);
        }
      } else {
        await this.agent.prompt(input);
      }
    } catch (err: any) {
      console.error('[FormAgentHarness] prompt execution error:', err);
      this.listeners.onError?.(err?.message || String(err));
      // Re-setup agent on error so state is not locked, preserving history
      this.setupAgent();
      throw err;
    } finally {
      this.listeners.onStatusChange?.(false);
    }
  }

  public abort() {
    if (this.agent) {
      this.agent.abort();
      this.listeners.onStatusChange?.(false);
      this.setupAgent();
    }
  }

  public reset() {
    this.chatHistory = [];
    this.activeToolCalls.clear();
    this.currentStreamingText = '';
    this.currentThinkingText = '';
    this.sessionThinkingText = '';
    this.listeners.onStatusChange?.(false);
    this.setupAgent();
  }
}
