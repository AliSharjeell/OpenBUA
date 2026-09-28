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
      docsSummary = `\n\n### USER'S STORED KNOWLEDGE & DOCUMENTS:\nYou have access to the user's stored documents below. Use this exact data to fill web forms:\n`;
      activeDocs.forEach((doc, idx) => {
        docsSummary += `\n--- Document [${idx + 1}]: ${doc.title} (${doc.type}) ---\n${doc.content}\n`;
      });
    } else {
      docsSummary = `\n\nNo user documents are currently active in storage. If needed, ask the user or call get_user_documents.`;
    }

    return `You are AutoForm AI, an autonomous browser extension agent specialized in inspecting and filling web forms.

YOUR CAPABILITIES & PROTOCOL:
1. Inspect the form: Call 'get_active_tab_form' to find all form fields, inputs, dropdown selects, textareas, checkboxes, radio buttons, and action buttons.
2. Match with user data: Use the user's stored documents and profile data provided below to determine the best values for each field.
3. Fill fields: Call 'fill_form_fields' with the assignments array.
4. Multi-page & Multi-step forms: If the page has steps (e.g. "Step 1 of 4") or requires clicking "Next", "Continue", or "Save & Proceed", click that button using 'click_element', inspect the next step, and continue filling!
5. Final Submission Safety: Do NOT click final "Submit" or "Apply" buttons without notifying the user, unless the user explicitly requested automatic submission.
6. Provide a concise, clear summary of what you filled and any fields that were left empty or need user attention.
${docsSummary}

${this.settings.systemInstruction || ''}`.trim();
  }

  private setupAgent() {
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
    if (!this.agent) {
      this.setupAgent();
    }
    if (!this.agent) throw new Error('Agent failed to initialize');

    const providerConfig =
      this.settings.activeProvider === 'anthropic' ? this.settings.anthropic : this.settings.openai;
    if (!providerConfig.apiKey || !providerConfig.apiKey.trim()) {
      throw new Error(`Please enter your ${this.settings.activeProvider.toUpperCase()} API Key in Settings to continue.`);
    }

    try {
      await this.agent.prompt(input);
    } catch (err: any) {
      this.listeners.onError?.(err?.message || String(err));
      this.listeners.onStatusChange?.(false);
      throw err;
    }
  }

  public abort() {
    if (this.agent) {
      this.agent.abort();
      this.listeners.onStatusChange?.(false);
    }
  }

  public reset() {
    if (this.agent) {
      this.agent.reset();
      this.activeToolCalls.clear();
      this.currentStreamingText = '';
      this.listeners.onStatusChange?.(false);
    }
  }
}
