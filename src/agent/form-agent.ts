// Form Filling Agent Harness powered by @earendil-works/pi-agent-core
import { Agent, AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core';
import { AssistantMessage, ToolResultMessage } from '@earendil-works/pi-ai';
import { ALL_AGENT_TOOLS, createAgentTools } from './tools';
import { createCustomModel, createStreamFn } from './stream-adapter';
import { AppSettings, UserDocument, ToolCallState, ChatMessage, ProviderConfig } from '../types';
import { setActiveSessionIdState, getScratchpad, appendToScratchpad, loadSuggestedMemories, saveSuggestedMemory } from '../services/storage';

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
      // Filter out pure error alert notifications and interruption notices
      if (
        (msg.content?.startsWith('⚠️') ||
          msg.content?.startsWith('Error:') ||
          msg.content?.startsWith('Agent interrupted.')) &&
        (!msg.toolCalls || msg.toolCalls.length === 0)
      ) {
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

/**
 * Automatically detects user profile details, affiliations, and preferences
 * from the user's prompt and queues them as Suggested Memories for 1-click review.
 */
export async function detectAndQueueMemorySuggestions(
  input: string,
  sessionId: string,
  existingMemories: UserDocument[]
): Promise<void> {
  try {
    const existingSugs = await loadSuggestedMemories(sessionId);
    const existingTitles = new Set([
      ...existingMemories.map((m) => m.title.toLowerCase()),
      ...existingSugs.map((s) => s.title.toLowerCase()),
    ]);
    const existingContents = new Set([
      ...existingMemories.map((m) => m.content.toLowerCase()),
      ...existingSugs.map((s) => s.content.toLowerCase()),
    ]);

    const suggestionsToQueue: Array<{
      title: string;
      content: string;
      category: 'profile' | 'preference' | 'workflow' | 'fact' | 'task';
      reason: string;
    }> = [];

    // 1. Detect Email Addresses (e.g. k230904@nu.edu.pk, alex@gmail.com)
    const emailMatches = input.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
    if (emailMatches) {
      for (const email of emailMatches) {
        const lowerEmail = email.toLowerCase();
        if (!existingContents.has(lowerEmail)) {
          const isStudent = lowerEmail.includes('.edu') || lowerEmail.includes('nu.edu.pk');
          const title = isStudent ? 'Student Email' : 'Email Address';
          if (!existingTitles.has(title.toLowerCase())) {
            suggestionsToQueue.push({
              title,
              content: email,
              category: 'profile',
              reason: 'Identified email address provided in chat request',
            });
          }

          // If FAST NUCES university email
          if (lowerEmail.endsWith('@nu.edu.pk') || lowerEmail.includes('nu.edu.pk')) {
            if (
              !existingTitles.has('university') &&
              !existingTitles.has('university affiliation') &&
              !existingContents.has('national university of computer and emerging sciences (fast-nuces)')
            ) {
              suggestionsToQueue.push({
                title: 'University Affiliation',
                content: 'National University of Computer and Emerging Sciences (FAST-NUCES)',
                category: 'profile',
                reason: 'Inferred from @nu.edu.pk student email domain',
              });
            }
          }
        }
      }
    }

    // 2. Detect University / College Mentions (e.g. FAST, NUCES)
    if (/\b(?:fast[\s-]*(?:nuces|university)?|nuces)\b/i.test(input)) {
      if (
        !existingTitles.has('university') &&
        !existingTitles.has('university affiliation') &&
        !existingContents.has('national university of computer and emerging sciences (fast-nuces)')
      ) {
        suggestionsToQueue.push({
          title: 'University Affiliation',
          content: 'National University of Computer and Emerging Sciences (FAST-NUCES)',
          category: 'profile',
          reason: 'Mentioned FAST University in chat prompt',
        });
      }
    }

    // 3. Detect Extracurricular / Society Interests
    if (/(?:societ(?:y|ies)|induction|inductions|excom|club\s+recruitment)/i.test(input)) {
      if (
        !existingTitles.has('extracurricular interests') &&
        !existingTitles.has('society interests')
      ) {
        suggestionsToQueue.push({
          title: 'Extracurricular Interests',
          content: 'Active interest in university student societies, club inductions, and executive committee roles',
          category: 'preference',
          reason: 'Inferred from request to discover university society inductions',
        });
      }
    }

    // 4. Detect Phone Numbers
    const phoneMatch = input.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
    if (phoneMatch && !existingContents.has(phoneMatch[0].trim())) {
      if (!existingTitles.has('phone number') && !existingTitles.has('contact phone')) {
        suggestionsToQueue.push({
          title: 'Phone Number',
          content: phoneMatch[0].trim(),
          category: 'profile',
          reason: 'Detected contact phone number in chat prompt',
        });
      }
    }

    for (const item of suggestionsToQueue) {
      await saveSuggestedMemory({
        id: `sug-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: item.title,
        content: item.content,
        category: item.category,
        reason: item.reason,
        createdAt: Date.now(),
        sessionId,
      });
    }
  } catch (err) {
    console.warn('[FormAgentHarness] Proactive suggestion detection error:', err);
  }
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
0. MANDATORY REASONING PROTOCOL (THOUGHT TAGS):
   - At the beginning of EVERY turn and before calling ANY tool or replying, you MUST ALWAYS output your step-by-step reasoning inside <thought>...</thought> tags in your message content first!
   - Format:
     <thought>
     [Your concise observation of current state, analysis, and immediate plan]
     </thought>
     Then invoke tools or provide your response.
   - Never skip the <thought>...</thought> block on any turn.

0.5. CRITICAL PROTOCOL: INCREMENTAL REPORTING & 1-ITEM CYCLE ('append_to_preview'):
   - LIVE PREVIEW IS A CUSTOMER-FACING REPORT AREA:
     * ONLY append clean, finalized findings (e.g. markdown table rows or clean summary sections).
     * NEVER write internal reasoning, thoughts, searching status, or meta-planning into 'append_to_preview'. Put all thoughts strictly inside <thought>...</thought> tags!
   - WORKING MEMORY PERSISTENCE:
     * Your internal reasoning context gets compressed and pruned over long tasks.
     * You MUST treat 'append_to_preview' as your persistent external data record.
     * NEVER wait until all search results or emails are examined before writing.
   - THE 1-ITEM CYCLE:
     Whenever processing a list of items (e.g. emails, search results, candidate threads, tabs):
     * Step A: Open 1 item.
     * Step B: Extract relevant details (or confirm it is irrelevant).
     * Step C: If relevant, IMMEDIATELY invoke 'append_to_preview' with a clean markdown table row for that item.
     * Step D: Only after the tool returns success, navigate to the next item.
   - ATOMIC TABLE PATTERN:
     In your very first research action, initialize the table header once:
     append_to_preview({ content: "# Societies with Inductions — 2nd October Onwards\n\n| # | Society | Induction Date | Venue / Time | Notes |\n|---|---|---|---|---|\n" })
     Then for each item discovered, emit ONE atomic table row:
     append_to_preview({ content: "| 1 | FAST Entrepreneurship Society (FES) | Date not specified (email sent Oct 1) | Library Discussion Room (12:30–1:30 PM) | ExCom 2026–27 |\n" })

0.6. MANDATORY PROACTIVE MEMORY SUGGESTIONS ('suggest_memory'):
   - DETECT USER DETAILS IMMEDIATELY ON TURN 1 AND THROUGHOUT RUN:
     * Proactively inspect the user's prompt and active browsing data for personal facts, contact details, affiliations, or preferences:
       - Student / Contact Email (e.g. k230904@nu.edu.pk) -> suggest_memory({ title: "Student Email", content: "k230904@nu.edu.pk", category: "profile", reason: "Identified student email in request" })
       - University Affiliation (e.g. FAST-NUCES from @nu.edu.pk) -> suggest_memory({ title: "University Affiliation", content: "National University of Computer and Emerging Sciences (FAST-NUCES)", category: "profile", reason: "Inferred from @nu.edu.pk student domain" })
       - Extracurricular Interests (e.g. university societies) -> suggest_memory({ title: "Extracurricular Interests", content: "Active interest in university student societies and executive committee inductions", category: "preference", reason: "Inferred from society induction research inquiry" })
       - Full Name, Phone numbers, Major/Degree, Graduation Year, Career Roles.
     * Always call 'suggest_memory' proactively whenever you see such facts! The user will see a badge on their top-right Suggested Memories button and can approve them with 1 click.

   - FEW-SHOT REASONING TRAJECTORY (FOLLOW THIS EXACT PATTERN):
     User: "i want you to access my gmail (k230904@nu.edu.pk) and find me the societies that have their inductions opened 2nd october onwards for all societies."
     Turn 1:
     <thought>
     The user provided their student email k230904@nu.edu.pk and university context. I should proactively suggest saving this email, university affiliation, and society interests to memories, and initialize the preview table.
     </thought>
     Tool Call: suggest_memory({ title: "Student Email", content: "k230904@nu.edu.pk", category: "profile", reason: "Student email provided in prompt" })
     Tool Call: suggest_memory({ title: "University Affiliation", content: "National University of Computer and Emerging Sciences (FAST-NUCES)", category: "profile", reason: "Identified from @nu.edu.pk domain" })
     Tool Call: suggest_memory({ title: "Extracurricular Interests", content: "Active interest in university student societies and executive committee inductions", category: "preference", reason: "Inferred from society induction research task" })
     Tool Call: append_to_preview({ content: "# Societies with Inductions — 2nd October Onwards\n\n| # | Society | Induction Date | Venue / Time | Notes |\n|---|---|---|---|---|\n" })
     Observation: Suggested memories queued & Table initialized in Live Preview.

     Turn 2:
     <thought>
     Now navigating directly to Gmail search results URL to inspect induction emails without relying on browser back button.
     </thought>
     Tool Call: navigate_browser_tab({ url: "https://mail.google.com/mail/u/3/#search/in%3Aanywhere+after%3A2026%2F09%2F28+(induction+OR+inductions)" })
     Observation: Email list loaded with relevant society threads.

     Turn 3:
     <thought>
     Opening thread 1: TLC Inductions.
     </thought>
     Tool Call: click_element({ text: "The Literary Club" })
     Observation: TLC dates: Day 1 Oct 1, Day 2 Oct 2 (10:00am–3:30pm). Matches Oct 2 onwards.

     Turn 4:
     <thought>
     Appending row 1 for TLC to live preview immediately.
     </thought>
     Tool Call: append_to_preview({ content: "| 1 | The Literary Club (TLC) | Thu Oct 1 & Fri Oct 2 (10:00am–3:30pm) | Day 1: LLC; Day 2: S2, AB1 | Apply online + interview |\n" })
     Observation: Appended row to Live Preview successfully.

1. USER'S PRIMARY BROWSER & SIGNED-IN SESSIONS:
   - You run directly inside the user's everyday personal desktop browser.
   - ALWAYS assume the user is ALREADY signed into their accounts (Google, YouTube, GitHub, Twitter/X, Reddit, work portals, etc.) unless an explicit "Sign in" button is visible and blocking form interaction.
   - Do NOT assume the user is logged out.
2. NEVER ASK THE USER TO SHARE SCREENSHOTS OR PASTE URLS:
   - You have direct access to the user's active browser tab via 'get_active_tab_form', 'get_page_content', and 'click_element'.
   - Call 'get_active_tab_form' when interacting with forms, applications, or inputs. Do NOT call 'get_active_tab_form' on video, content, search, or social media sites just to click a link or button.
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
7. LONG-RUNNING RESEARCH, DATA ACCUMULATION & LIVE PREVIEW ('append_to_preview' / 'scratchpad'):
   - The user has a dedicated "Preview" tab in the center navigation toggle (with an iMessage-blue notification badge when new content is added) that displays the contents of the live preview in real time as you work!
   - When the user asks you to find, search, compare, or extract items (e.g. "find events/inductions from Gmail", "find cheapest return flights", "find 50 tech leads", "extract products", "summarize unread emails"):
   - Call 'append_to_preview' AS YOU FIND EACH ITEM or batch of items, formatted cleanly in Markdown (tables, bullet points, headers).
   - This lets the user watch your findings accumulate live in real time in their Preview tab without having to wait until your entire run finishes!
   - Example: append_to_preview({ content: "| TLC Day 2 | Oct 2, 2026 | 3:00 PM | CS Lawn |\n" })
   - Using 'append_to_preview' also ensures you never lose collected data as you navigate across multiple tabs or pages.
8. FAST EMAIL & WEBMAIL AUTOMATION (Gmail, Outlook, Webmail):
   - MITIGATE SPA NAVIGATION FRICTION (BAN BROWSER BACK BUTTONS IN GMAIL):
     * Standard Gmail is a heavily virtualized Single-Page Application (SPA). Clicking "Back", "Go back", or browser back buttons in Gmail fails or leads to infinite loops and DOM element drift.
     * To return to search results:
       - Direct URL Navigation: Call 'navigate_browser_tab' directly to the search URL (e.g. 'https://mail.google.com/mail/u/{authuser}/#search/{query}').
       - Multi-Tab Isolation: Open candidate emails in a new tab via 'open_new_tab', read content with 'get_page_content', append findings to preview, and call 'close_tab'.
     * Pre-Filter via Gmail Search Operators:
       - Target queries tightly with date operators (e.g. 'after:2026/10/01 induction') rather than wide date ranges to minimize thread count.
       - Extract snippets directly from search results DOM when sender, date, and subject already reveal the status!
   - GMAIL SEARCH & READING — BASIC HTML MODE (ELIMINATES VIRTUAL DOM & REFID DRIFT):
     * When reading, searching, or exploring Gmail:
       - Prefer switching to or loading the Basic HTML view: 'https://mail.google.com/mail/u/{authuser}/h/' (e.g. 'https://mail.google.com/mail/u/3/h/').
       - In Basic HTML view, all email threads are rendered in standard, non-virtualized <table> rows with direct <a> links and static URLs (e.g., '?v=c&th=...'). Elements don't disappear on scroll, and navigation succeeds on the first attempt!
     * Direct URL Navigation Fallback: When inspecting search results or email threads, prefer navigating directly to the thread link ('href') using 'navigate_browser_tab(url=href)' extracted from 'get_page_content', instead of calling fragile 'click_element(text=...)' on dynamic div containers.
   - DIRECT COMPOSE DEEP-LINKING (FASTEST PATH):
     When the user instructs you to email someone, do NOT guess accounts or navigate slowly through UI compose buttons if a direct URL is possible:
     * Navigate directly using 'navigate_browser_tab' to:
       https://mail.google.com/mail/?authuser={email}&view=cm&fs=1&to={to}&su={subject}&body={body}
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
   - BAN POST-ACTION SCREENSHOTS: Taking screenshots to verify form typing, sending, navigation, or sorting consumes high model inference time (vision token processing) and adds 15-20 seconds of unnecessary latency. NEVER call 'capture_tab_screenshot' to "confirm visually" after routine form submissions, fills, navigations, clicks, or sorting. Screenshots are strictly reserved for unhandled errors or when visually blocked.

10. ANTI-LOOP STATE CHECKLIST & SATURATION CRITERIA (EXPLORATION BUDGET):
    - Prevent the "State-Drift & Unbounded Exploration Loop" when inspecting lists, search results, or candidate threads:
    - DISCOVERED VS VISITED LISTS (WORKING MEMORY PERSISTENCE):
      * On initial search or page listing, extract the candidate items/threads into a 'Discovered' list in your scratchpad or thoughts.
      * Maintain an explicit 'Visited' list. NEVER re-open, re-read, or re-click any thread, lead, or link already marked as 'Visited'.
    - SINGLE-PASS PROCESSING & IMMEDIATE PREVIEW STREAMING:
      * Process each thread or item strictly ONCE:
        Open thread/item -> Extract required fields (dates, times, venues, contacts, status) -> If it matches or qualifies, IMMEDIATELY call 'scratchpad' so user sees it in live preview -> Mark as 'Visited'.
      * Never navigate back to re-inspect an already visited item or second-guess extracted data.
    - EXPLORATION BUDGET & BAN ON QUERY-MUTATION CYCLING:
      * Maximum 1 Search Query: Execute a single well-targeted search query (at most 2 only if the first returns 0 results).
      * NEVER enter a query-tweaking rabbit hole: Do NOT modify date filters, keywords, or operators (e.g. cycling 'after:09/28' -> 'after:09/30' -> 'after:10/01') when minor uncertainty arises. Work strictly with the initial retrieved list.
      * Saturation / Stopping Criterion: Inspect up to a maximum budget of the top 8–10 most relevant items. Once inspected or when sufficient answers are found, STOP IMMEDIATELY, synthesize findings into a clean Markdown table, and answer the user.
      * Graceful Ambiguity Handling: If a date or detail is past, ambiguous, or unstated, record the best estimate and note any minor uncertainty in the final output rather than re-searching indefinitely.

11. LINKEDIN DISCOVERY & GOOGLE X-RAY SEARCH DIRECTIVE (CRITICAL):
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

12. ZERO-CLICK SERP SNIPPET EXTRACTION & ELIMINATING REDUNDANT VERIFICATION:
   - Google SERP snippets ALREADY contain the prospect's full name, academic institution/role, and unmasked email address (e.g., "Alex Yang — A-Level Student at Aquinas College ... 25alex.yang@gmail.com", "Ece Yalın — Student at University of Warwick ... eceyalin.tc@gmail.com").
   - EXTRACT NAME, INSTITUTION, AND EMAIL DIRECTLY FROM THE GOOGLE SERP SNIPPET IN A SINGLE TURN!
   - STRICT EXTRACTION GUARD: NEVER navigate to the target profile URL (uk.linkedin.com/in/*, github.io) solely to "verify" what is already visible in the search snippet. Navigating to external sites adds 45+ seconds of redundant page loads and DOM trees without new information.
   - LOOSE PERSONA MATCHING: Treat any lead listing a degree expected within ±2 years of the current year (or recent graduates/alumni) as an active match. Do not execute additional verification searches or debate graduation months/semesters.

13. PRODUCT KNOWLEDGE PERSISTENCE & ATOMIC 3-STEP DAG ARCHITECTURE:
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

14. HUMAN-IN-THE-LOOP (HITL) 10-SECOND CAPTCHA INTERCEPT GATE & AUTOMATED PIVOT:
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
15. MULTI-TAB MANAGEMENT — NEVER NAVIGATE AWAY FROM A PARTIALLY-FILLED FORM:
    - CRITICAL: ONLY when you are actively in the middle of filling a multi-field form (e.g. job application, signup) and need to look up information from another website:
      * NEVER use 'navigate_browser_tab' on the current tab — this will DESTROY all form progress and you will lose every field you already filled!
      * ALWAYS use 'open_new_tab' to open the lookup URL in a separate tab.
      * Read the needed info with 'get_page_content'.
      * Use 'close_tab' to close the lookup tab when done, then 'switch_browser_tab' back to the original form tab to continue filling.
    - It is completely SAFE to use 'navigate_browser_tab' when you are not mid-form (e.g. the user asked you to go to a URL, search for something, or open a video/profile).
16. SUBMISSION PERMISSION (${(this.settings.autoConfirmSubmit ?? true) ? 'ASK FOR REVIEW' : 'FULL ACCESS'}):
${(this.settings.autoConfirmSubmit ?? true)
  ? `    - STRICT REQUIREMENT: Before clicking any final form submission, purchase, or destructive button, you MUST STOP and ask the user for review and confirmation. Present a concise summary of the filled fields and ask the user to confirm submission.`
  : `    - FULL AUTONOMY: You have full access to complete actions. When all form fields or required inputs are filled, proceed directly to submit the form without pausing for user confirmation.`}

17. OPERATING TRANSPARENCY & USER COMMUNICATION:
    - Put your internal planning, DOM analysis, and tool decisions inside <thought>...</thought> tags.
    - When communicating directly to the user (e.g. asking a question, reporting results, or summarizing completed work), output clean text outside of the <thought> tags.
    - When a task is complete or between steps, summarize your progress clearly to the user.

18. FAST-PATH DIRECT BROWSING & MINIMAL TURNS (TARGET: UNDER 25 SECONDS):
    - DIRECT BROWSING COMMANDS (e.g. "open YouTube and search MrBeast and go to his channel and sort by most viewed", "go to reddit.com/r/technology", "open GitHub"):
      * COMPOUND DIRECT URL NAVIGATION (CRITICAL):
        Construct direct, deep URLs immediately instead of chaining 8 baby steps:
        - YouTube Search: 'https://www.youtube.com/results?search_query={query}'
        - YouTube Channel Videos: 'https://www.youtube.com/@{handle}/videos' (e.g. 'https://www.youtube.com/@MrBeast/videos')
        - Twitter/X Profile: 'https://x.com/{handle}'
        - GitHub Repo: 'https://github.com/{owner}/{repo}'
        - Google Search: 'https://www.google.com/search?q={query}'
        NEVER navigate to a homepage (like 'https://www.youtube.com') just to find and type into a search box. Navigate directly to the search results or target channel URL in Turn 1!
      * NO PROACTIVE TAB LISTING: DO NOT call 'list_browser_tabs' before starting a direct navigation or search task. If the active tab is an internal page (e.g. chrome://extensions/, newtab) or you are opening a new destination, use 'navigate_browser_tab' directly or 'open_new_tab'.
      * NO REDUNDANT TAB SWITCHING: 'open_new_tab' automatically activates and focuses the newly opened tab. NEVER call 'switch_browser_tab' immediately after 'open_new_tab'.
      * NO FORM INSPECTION ON CONTENT / VIDEO SITES:
        - NEVER call 'get_active_tab_form' on YouTube, video players, search engines, or article sites to find links, tabs, or buttons. Form inspection is only for text data entry (signups, logins, applications).
        - Click elements directly: 'click_element({ text: "Popular" })', 'click_element({ text: "Videos" })', or 'click_element({ selector: "..." })'.
      * ONE-STEP SORTING & FILTERING:
        - When the user asks to go to a channel and sort videos by popular / most viewed:
          Turn 1: Navigate directly to the channel videos URL: 'https://www.youtube.com/@{handle}/videos' (e.g. 'https://www.youtube.com/@MrBeast/videos').
          Turn 2: Click the 'Popular' chip/tab: 'click_element({ text: "Popular" })'.
          Turn 3: Report completion to the user!
      * IGNORE NON-BLOCKING BACKGROUND NOTICES:
        - If page text mentions background notices (e.g. "You're signed out", "TV watch history", cookie banners that don't block interaction), DO NOT waste turns pressing Escape or trying to close them. Proceed directly with your action.
      * ZERO REDUNDANT VERIFICATION TURNS:
        - When an action like 'click_element({ text: "Popular" })' or URL navigation succeeds, DO NOT call 'capture_tab_screenshot' or call 'get_page_content' repeatedly just to verify. Report the result to the user immediately.
      * TURN BUDGET: Standard browsing, searching, and sorting tasks MUST complete in 2 to 3 turns maximum.

19. FAST WEB MESSAGING AUTOMATION (WhatsApp Web, Telegram, Slack, Web Chat, DMs):
    - When the user asks to send a message or text someone on WhatsApp Web, Telegram, Slack, or web chat (e.g. "text to sidhart on whatsapp that this is a test reply", "send a message on Slack", "DM user on Twitter/X"):
      * PROHIBIT UNNECESSARY TAB LISTING:
        - If WhatsApp Web or the target chat is already the active tab, DO NOT call 'list_browser_tabs'.
      * CHAT SELECTION (IF NEEDED):
        - If the target chat is not open, click on the contact name ('click_element({ text: "Sidhart" })') or search contact via the chat search box.
      * 2-STEP ATOMIC DISPATCH:
        - Step 1: Type the message into the active compose box using 'fill_form_fields({ refId: "...", value: "..." })'.
        - Step 2: Send IMMEDIATELY:
          Call 'press_key_combination({ key: "Enter" })' OR click the Send button ('click_element({ text: "Send", selector: "button[aria-label*=\'Send\' i], span[data-icon=\'send\'], [data-icon=\'send\'], button[data-tab=\'11\']" })').
      * ZERO-CYCLE COMPLETION:
        - Once 'Enter' is pressed or the Send button is clicked, THE MESSAGE IS SENT!
        - DO NOT call 'get_active_tab_form' or 'capture_tab_screenshot' to "verify" or "inspect" whether the message was sent.
        - Report completion immediately to the user!
      * TURN BUDGET: Message sending MUST complete in 1 to 2 turns maximum (under 15 seconds).

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
        tools: createAgentTools(this.sessionId),
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

  private pruneAgentStateMessages(): void {
    if (!this.agent || !this.agent.state || !Array.isArray(this.agent.state.messages)) return;
    const messages = this.agent.state.messages;
    const total = messages.length;
    if (total <= 3) return;

    // Prune older turn tool results and purge base64 image data to prevent compounding context bloat
    for (let i = 0; i < total - 3; i++) {
      const msg = messages[i] as any;
      if (msg.role === 'toolResult' && Array.isArray(msg.content)) {
        // Keep scratchpad and append_to_preview unpruned so accumulated working notes remain intact
        if (msg.toolName === 'scratchpad' || msg.toolName === 'append_to_preview') {
          continue;
        }

        for (const item of msg.content) {
          // Purge heavy base64 image data from previous turns
          if (item.type === 'image' || item.data || (item.text && item.text.startsWith('data:image/'))) {
            item.type = 'text';
            item.text = '[Screenshot previously captured and evaluated]';
            delete item.data;
            delete item.mimeType;
          } else if (item.type === 'text' && typeof item.text === 'string' && item.text.length > 350) {
            const pruned = item.text.length - 250;
            item.text = item.text.slice(0, 250) + `\n... [Prior turn DOM content compacted - ${pruned} chars pruned]`;
          }
        }
      }
    }
  }

  private async handleAgentEvent(event: any) {
    switch (event.type) {
      case 'agent_start':
        this.listeners.onStatusChange?.(true);
        this.currentStreamingText = '';
        this.currentThinkingText = '';
        this.sessionThinkingText = '';
        this.activeToolCalls.clear();
        break;

      case 'turn_start':
        this.pruneAgentStateMessages();
        this.currentStreamingText = '';
        this.currentThinkingText = '';
        this.activeToolCalls.clear();
        break;

      case 'message_update':
        if (event.assistantMessageEvent) {
          const ame = event.assistantMessageEvent;
          if (ame.type === 'text_delta') {
            this.currentStreamingText += ame.delta;
            this.listeners.onMessageDelta?.(this.currentStreamingText);
          } else if (ame.type === 'thinking_delta') {
            this.currentThinkingText += ame.delta;
            this.listeners.onThinkingDelta?.(this.currentThinkingText);
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

      case 'turn_end': {
        this.pruneAgentStateMessages();
        if (event.message?.errorMessage) {
          this.listeners.onError?.(event.message.errorMessage);
        }
        const hasTools = this.activeToolCalls.size > 0;
        const thinkingForTurn =
          this.currentThinkingText ||
          (hasTools && this.currentStreamingText.trim() ? this.currentStreamingText.trim() : undefined);
        const textForTurn = hasTools && !this.currentThinkingText ? '' : this.currentStreamingText;

        this.listeners.onTurnComplete?.(
          textForTurn,
          Array.from(this.activeToolCalls.values()),
          thinkingForTurn || undefined
        );
        break;
      }

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

    // Proactively scan user input for personal details, student email, university, or interests
    await detectAndQueueMemorySuggestions(input, this.sessionId, this.documents);

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
