// Type definitions for AutoForm AI Chrome Extension

export type ProviderType = 'openai' | 'anthropic';
export type ModelMode = 'free' | 'byok';

export interface FreeModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ProviderConfig {
  provider: ProviderType;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AppSettings {
  activeProvider: ProviderType;
  selectedMode: ModelMode;
  free: FreeModelConfig;
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
  isGlobal?: boolean; // true for General/Global memory consistent across all tabs
  tabUrlPattern?: string; // Optional domain or URL pattern for tab-specific memory
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface BrowserTabInfo {
  id: number;
  title: string;
  url: string;
  favIconUrl?: string;
  active: boolean;
}

export interface ToolCallState {
  id: string;
  toolName: string;
  args: Record<string, any>;
  result?: any;
  status: 'running' | 'success' | 'error';
  errorMessage?: string;
  timestamp: number;
  extra_content?: any;
  thought_signature?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string;
  thinkingDurationMs?: number;
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

export interface FieldFillVerification {
  refId?: string;
  selector?: string;
  requestedValue: string;
  actualValue: string;
  verified: boolean;
  status: string;
}

export interface FormFillResult {
  successCount: number;
  totalRequested: number;
  verifiedCount: number;
  errors: string[];
  verifications: FieldFillVerification[];
}
