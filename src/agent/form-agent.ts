// Form Filling Agent Harness powered by @earendil-works/pi-agent-core
import { Agent, AgentEvent } from '@earendil-works/pi-agent-core';
import { ALL_AGENT_TOOLS } from './tools';
import { createCustomModel, createStreamFn } from './stream-adapter';
import { AppSettings, UserDocument, ToolCallState, ChatMessage } from '../types';

export interface AgentUpdateListeners {
  onMessageDelta?: (text: string) => void;
  onToolCallStart?: (toolCall: ToolCallState) => void;
  onToolCallEnd?: (toolCall: ToolCallState) => void;
  onTurnComplete?: (assistantText: string, toolCalls: ToolCallState[]) => void;
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

    return `You are AutoForm AI, an autonomous browser extension agent specialized in inspecting and filling web forms directly on the active browser tab.

CRITICAL RULES & OPERATING INSTRUCTIONS:
1. DIRECT BROWSER DOM ACCESS: You have direct access to the user's active browser tab via the tool 'get_active_tab_form'.
2. NEVER ASK THE USER TO SHARE SCREENSHOTS OR PASTE URLS: Never ask the user to share a screenshot, paste HTML, or provide the form fields manually. You MUST call 'get_active_tab_form' immediately to inspect the active tab's form yourself.
3. NEVER ASK THE USER FOR PROFILE DETAILS: The user's complete profile, resume, and application data are already loaded above in "USER'S STORED KNOWLEDGE & DOCUMENTS" and accessible via 'get_user_documents'. Do NOT ask the user for their name, email, phone, or address; match them directly from their documents!
4. MANDATORY PROTOCOL WHEN USER ASKS TO FILL OR SCAN:
   - Step 1: Immediately call 'get_active_tab_form' to find all inputs, textareas, selects, checkboxes, and buttons.
   - Step 2: Match each form field with the user's stored documents.
   - Step 3: Call 'fill_form_fields' with the assignments array.
   - Step 4: For multi-step forms (e.g. "Step 1 of 3", "Next: Experience"), click the next button using 'click_element', wait, inspect the next step, and continue filling!
   - Step 5: Inform the user once the fields have been populated.
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
        this.activeToolCalls.clear();
        break;

      case 'turn_start':
        this.currentStreamingText = '';
        break;

      case 'message_update':
        if (event.assistantMessageEvent) {
          const ame = event.assistantMessageEvent;
          if (ame.type === 'text_delta') {
            this.currentStreamingText += ame.delta;
            this.listeners.onMessageDelta?.(this.currentStreamingText);
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

      case 'tool_execution_start':
        if (event.toolCall) {
          const tc = event.toolCall;
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
        break;

      case 'tool_execution_end':
        if (event.toolCall) {
          const existing = this.activeToolCalls.get(event.toolCall.id);
          if (existing) {
            existing.status = event.isError ? 'error' : 'success';
            existing.result = event.result?.details || event.result?.content?.[0]?.text;
            if (event.isError) {
              existing.errorMessage = String(event.result?.content?.[0]?.text || 'Tool failed');
            }
            this.listeners.onToolCallEnd?.(existing);
          }
        }
        break;

      case 'turn_end':
        if (event.message?.errorMessage) {
          this.listeners.onError?.(event.message.errorMessage);
        }
        this.listeners.onTurnComplete?.(
          this.currentStreamingText,
          Array.from(this.activeToolCalls.values())
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
