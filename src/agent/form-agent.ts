// Form Filling Agent Harness powered by @earendil-works/pi-agent-core
import { Agent, AgentEvent } from '@earendil-works/pi-agent-core';
import { ALL_AGENT_TOOLS } from './tools';
import { createCustomModel, createStreamFn } from './stream-adapter';
import { AppSettings, UserDocument, ToolCallState, ChatMessage } from '../types';

export interface AgentUpdateListeners {
  onMessageDelta?: (text: string) => void;
  onThinkingDelta?: (text: string) => void;
  onToolCallStart?: (toolCall: ToolCallState) => void;
  onToolCallEnd?: (toolCall: ToolCallState) => void;
  onTurnComplete?: (assistantText: string, toolCalls: ToolCallState[], thinkingText?: string) => void;
  onError?: (error: string) => void;
  onStatusChange?: (isBusy: boolean) => void;
}

export class FormAgentHarness {
  private agent: Agent | null = null;
  private settings: AppSettings;
  private documents: UserDocument[];
  private listeners: AgentUpdateListeners = {};
  private activeToolCalls = new Map<string, ToolCallState>();
  private currentStreamingText = '';
  private currentThinkingText = '';

  constructor(settings: AppSettings, documents: UserDocument[], listeners?: AgentUpdateListeners) {
    this.settings = settings;
    this.documents = documents;
    if (listeners) this.listeners = listeners;
    this.setupAgent();
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

    return `You are openBUA (Open Browser Use Agent), an autonomous browser extension agent that uses the user's active browser to navigate, research, extract data, interact with elements, fill forms, and automate web tasks directly.

CRITICAL OPERATING RULES & ENVIRONMENT CONTEXT:
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
   - When calling 'fill_form_fields', inspect the 'DOM Verifications' in the tool response. If a field shows '⚠️ UNVERIFIED / EMPTY in DOM' or '❌ ELEMENT NOT FOUND', DO NOT claim it was filled.
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
${docsSummary}

${this.settings.systemInstruction || ''}`.trim();
  }

  public setupAgent() {
    const activeProvider = this.settings.activeProvider;
    const providerConfig = activeProvider === 'anthropic' ? this.settings.anthropic : this.settings.openai;
    const config = {
      provider: activeProvider,
      baseUrl: providerConfig.baseUrl,
      apiKey: providerConfig.apiKey,
      model: providerConfig.model,
    };

    const model = createCustomModel(config);
    const systemPrompt = this.buildSystemPrompt();

    this.agent = new Agent({
      initialState: {
        model,
        systemPrompt,
        tools: ALL_AGENT_TOOLS,
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
          this.currentThinkingText || undefined
        );
        break;

      case 'agent_end':
        this.listeners.onStatusChange?.(false);
        break;
    }
  }

  public async prompt(input: string): Promise<void> {
    const providerConfig =
      this.settings.activeProvider === 'anthropic' ? this.settings.anthropic : this.settings.openai;
    if (!providerConfig.apiKey || !providerConfig.apiKey.trim()) {
      const err = `Please enter your ${this.settings.activeProvider.toUpperCase()} API Key in Settings to continue.`;
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
      await this.agent.prompt(input);
    } catch (err: any) {
      console.error('[FormAgentHarness] prompt execution error:', err);
      this.listeners.onError?.(err?.message || String(err));
      // Re-setup agent on error so state is not locked
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
    this.activeToolCalls.clear();
    this.currentStreamingText = '';
    this.listeners.onStatusChange?.(false);
    this.setupAgent();
  }
}
