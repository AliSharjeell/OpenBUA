// Type definitions for AutoForm AI Chrome Extension

export type ProviderType = 'openai' | 'anthropic';

export interface ProviderConfig {
  provider: ProviderType;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AppSettings {
  activeProvider: ProviderType;
  openai: {
    baseUrl: string;
    apiKey: string;
    model: string;
  };
  anthropic: {
    baseUrl: string;
    apiKey: string;
    model: string;
  };
  autoConfirmSubmit: boolean; // Ask user before clicking final submit
  systemInstruction?: string;
}

export interface UserDocument {
  id: string;
  title: string;
  type: 'pdf' | 'markdown' | 'text' | 'json';
  content: string;
  summary?: string;
  createdAt: number;
  sizeBytes: number;
  tags?: string[];
  isActiveForContext: boolean;
}

export interface ToolCallState {
  id: string;
  toolName: string;
  args: Record<string, any>;
  result?: any;
  status: 'running' | 'success' | 'error';
  errorMessage?: string;
  timestamp: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: ToolCallState[];
  isStreaming?: boolean;
}

export interface FormElementDescriptor {
  refId: string;
  tagName: string;
  type: string;
  id: string;
  name: string;
  label: string;
  placeholder: string;
  value: string;
  checked?: boolean;
  required: boolean;
  disabled: boolean;
  readonly: boolean;
  isVisible: boolean;
  selector: string;
  options?: Array<{ value: string; label: string; selected: boolean }>;
  sectionHint?: string;
  ariaLabel?: string;
}

export interface PageFormSummary {
  title: string;
  url: string;
  fields: FormElementDescriptor[];
  stepIndicators: string[];
  buttons: Array<{
    refId: string;
    text: string;
    type: string;
    isSubmit: boolean;
    isNext: boolean;
    isPrevious: boolean;
  }>;
}
