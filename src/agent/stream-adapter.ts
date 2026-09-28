// Client-side BYOK Stream Adapter for pi-agent-core and pi-ai
// Supports OpenAI-compatible and Anthropic-compatible endpoints with custom baseUrl, apiKey, and model name.

import {
  AssistantMessage,
  AssistantMessageEventStream,
  createAssistantMessageEventStream,
  Model,
  TextContent,
  ToolCall,
  TranscriptContext,
} from '@earendil-works/pi-ai';
import { ALL_AGENT_TOOLS } from './tools';
import { ProviderConfig } from '../types';

export function createCustomModel(config: ProviderConfig): Model<any> {
  return {
    id: config.model,
    name: config.model,
    provider: config.provider,
    api: config.provider === 'anthropic' ? 'anthropic-messages' : 'openai-completions',
    capabilities: ['tools', 'streaming', 'image'],
  } as unknown as Model<any>;
}

export async function createStreamFn(
  config: ProviderConfig,
  model: Model<any>,
  context: TranscriptContext,
  signal?: AbortSignal
): Promise<AssistantMessageEventStream> {
  const stream = createAssistantMessageEventStream();

  // Run the stream generation asynchronously
  (async () => {
    try {
      if (config.provider === 'anthropic') {
        await streamAnthropic(config, model, context, stream, signal);
      } else {
        await streamOpenAI(config, model, context, stream, signal);
      }
    } catch (err: any) {
      console.error('[AutoForm StreamAdapter] Stream error:', err);
      if (signal?.aborted) {
        const abortedMsg: AssistantMessage = {
          role: 'assistant',
          content: [{ type: 'text', text: 'Request was cancelled.' }],
          stopReason: 'aborted',
          errorMessage: 'Request was cancelled',
        };
        stream.push({ type: 'error', reason: 'aborted', error: abortedMsg });
        stream.end(abortedMsg);
      } else {
        const errorMsg: AssistantMessage = {
          role: 'assistant',
          content: [{ type: 'text', text: `⚠️ API Error: ${err?.message || String(err)}` }],
          stopReason: 'error',
          errorMessage: err?.message || String(err),
        };
        stream.push({ type: 'error', reason: 'error', error: errorMsg });
        stream.end(errorMsg);
      }
    }
  })();

  return stream;
}

// ---------------------------------------------------------
// OpenAI-Compatible Streaming (OpenAI, Minimax, Groq, DeepSeek, etc.)
// ---------------------------------------------------------
async function streamOpenAI(
  config: ProviderConfig,
  model: Model<any>,
  context: TranscriptContext,
  stream: AssistantMessageEventStream,
  signal?: AbortSignal
): Promise<void> {
  let endpoint = config.baseUrl.trim().replace(/\/+$/, '');
  if (endpoint.endsWith('/chat/completions')) {
    // already ends with /chat/completions
  } else if (endpoint.endsWith('/v1')) {
    endpoint = `${endpoint}/chat/completions`;
  } else {
    endpoint = `${endpoint}/v1/chat/completions`;
  }

  // 1. Extract system prompt from context.messages (where pi-agent-core carries it)
  let systemPrompt = context.systemPrompt || '';
  for (const m of context.messages) {
    if (m.role === 'system') {
      const text =
        typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content)
          ? m.content.map((c: any) => c.text || '').join('\n')
          : '';
      if (text) {
        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${text}` : text;
      }
    }
  }

  // Convert context messages to OpenAI format
  const messages: any[] = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  for (const m of context.messages) {
    if (m.role === 'system') {
      // Already captured in leading system message
      continue;
    } else if (m.role === 'user') {
      const text =
        typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content)
          ? m.content.map((c: any) => c.text || '').join('\n')
          : String(m.content || '');
      messages.push({ role: 'user', content: text });
    } else if (m.role === 'assistant') {
      let textParts = '';
      let toolCalls: any[] = [];

      if (typeof m.content === 'string') {
        textParts = m.content;
      } else if (Array.isArray(m.content)) {
        textParts = m.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text || '')
          .join('\n');

        toolCalls = m.content
          .filter((c: any) => c.type === 'toolCall' || c.type === 'tool_use')
          .map((c: any) => {
            const rawArgs = c.arguments || c.args || c.input || {};
            return {
              id: c.id,
              type: 'function',
              function: {
                name: c.name,
                arguments: typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs),
              },
            };
          });
      }

      const msg: any = { role: 'assistant' };
      if (textParts) msg.content = textParts;
      if (toolCalls.length > 0) {
        msg.tool_calls = toolCalls;
        if (!textParts) msg.content = null;
      }
      messages.push(msg);
    } else if (m.role === 'toolResult') {
      const text = Array.isArray(m.content)
        ? m.content.map((c: any) => c.text || '').join('\n')
        : typeof m.content === 'string'
        ? m.content
        : JSON.stringify(m.content || '');

      messages.push({
        role: 'tool',
        tool_call_id: m.toolCallId,
        content: text,
      });
    }
  }

  // Tools: Always ensure full tool definitions are passed
  const tools = ALL_AGENT_TOOLS.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  const payload: any = {
    model: config.model || model.id || 'gpt-4o',
    messages,
    stream: true,
  };

  if (tools.length > 0) {
    payload.tools = tools;
    payload.tool_choice = 'auto';
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey.trim()}`,
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI Provider error (${response.status}): ${errorBody || response.statusText}`);
  }

  if (!response.body) {
    throw new Error('Response body is null');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');

  let assistantMessage: AssistantMessage = {
    role: 'assistant',
    content: [],
    stopReason: 'stop',
  };

  stream.push({ type: 'start', partial: assistantMessage });

  let textContentBlock: TextContent | null = null;
  const toolCallAccumulators = new Map<number, { id: string; name: string; argsStr: string }>();

  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const dataStr = line.slice(5).trim();
      if (dataStr === '[DONE]') continue;

      try {
        const json = JSON.parse(dataStr);
        const choice = json.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;
        if (!delta) continue;

        // Reasoning / Thinking delta (e.g., DeepSeek R1, OpenAI o1/o3-mini, Minimax)
        const reasoningDelta = delta.reasoning_content || delta.reasoning || delta.thought || '';
        if (reasoningDelta) {
          stream.push({
            type: 'thinking_delta' as any,
            delta: reasoningDelta,
            partial: assistantMessage,
          });
        }

        // Text delta
        if (delta.content) {
          if (!textContentBlock) {
            textContentBlock = { type: 'text', text: '' };
            assistantMessage.content.push(textContentBlock);
            const contentIndex = assistantMessage.content.length - 1;
            stream.push({ type: 'text_start', contentIndex, partial: assistantMessage });
          }
          textContentBlock.text += delta.content;
          const contentIndex = assistantMessage.content.indexOf(textContentBlock);
          stream.push({
            type: 'text_delta',
            contentIndex,
            delta: delta.content,
            partial: assistantMessage,
          });
        }

        // Tool calls delta
        if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallAccumulators.has(idx)) {
              toolCallAccumulators.set(idx, {
                id: tc.id || `call_${idx}_${Date.now()}`,
                name: tc.function?.name || '',
                argsStr: tc.function?.arguments || '',
              });
            } else {
              const acc = toolCallAccumulators.get(idx)!;
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.name += tc.function.name;
              if (tc.function?.arguments) acc.argsStr += tc.function.arguments;
            }
          }
        }

        if (choice.finish_reason) {
          if (choice.finish_reason === 'tool_calls') {
            assistantMessage.stopReason = 'toolUse';
          }
        }
      } catch {
        // Skip malformed SSE lines
      }
    }
  }

  // Finalize text block
  if (textContentBlock) {
    const contentIndex = assistantMessage.content.indexOf(textContentBlock);
    stream.push({
      type: 'text_end',
      contentIndex,
      content: textContentBlock.text,
      partial: assistantMessage,
    });
  }

  // Finalize tool calls
  if (toolCallAccumulators.size > 0) {
    assistantMessage.stopReason = 'toolUse';
    for (const [_, acc] of toolCallAccumulators.entries()) {
      let parsedArgs: Record<string, any> = {};
      try {
        parsedArgs = JSON.parse(acc.argsStr || '{}');
      } catch {
        parsedArgs = { raw: acc.argsStr };
      }

      const toolCall: any = {
        type: 'toolCall',
        id: acc.id,
        name: acc.name,
        arguments: parsedArgs,
        args: parsedArgs,
      };

      assistantMessage.content.push(toolCall);
      const contentIndex = assistantMessage.content.length - 1;

      stream.push({ type: 'toolcall_start', contentIndex, partial: assistantMessage });
      stream.push({
        type: 'toolcall_end',
        contentIndex,
        toolCall,
        partial: assistantMessage,
      });
    }
  }

  stream.push({
    type: 'done',
    reason: assistantMessage.stopReason as any,
    message: assistantMessage,
  });
  stream.end(assistantMessage);
}

// ---------------------------------------------------------
// Anthropic-Compatible Streaming (Claude, Minimax-Anthropic, Mimo)
// ---------------------------------------------------------
async function streamAnthropic(
  config: ProviderConfig,
  model: Model<any>,
  context: TranscriptContext,
  stream: AssistantMessageEventStream,
  signal?: AbortSignal
): Promise<void> {
  let endpoint = config.baseUrl.trim().replace(/\/+$/, '');
  if (endpoint.endsWith('/messages')) {
    // already ends with /messages
  } else if (endpoint.endsWith('/v1')) {
    endpoint = `${endpoint}/messages`;
  } else {
    endpoint = `${endpoint}/v1/messages`;
  }

  // 1. Extract system prompt from context.messages
  let systemText = context.systemPrompt || '';
  for (const m of context.messages) {
    if (m.role === 'system') {
      const text =
        typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content)
          ? m.content.map((c: any) => c.text || '').join('\n')
          : '';
      if (text) {
        systemText = systemText ? `${systemText}\n\n${text}` : text;
      }
    }
  }

  // Convert context messages to Anthropic format
  const rawMessages: any[] = [];

  for (const m of context.messages) {
    if (m.role === 'system') {
      continue;
    } else if (m.role === 'user') {
      const text =
        typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content)
          ? m.content.map((c: any) => c.text || '').join('\n')
          : String(m.content || '');
      rawMessages.push({
        role: 'user',
        content: text.trim() ? [{ type: 'text', text }] : [{ type: 'text', text: 'Continue' }],
      });
    } else if (m.role === 'assistant') {
      const contentBlocks: any[] = [];
      if (typeof m.content === 'string') {
        if (m.content.trim()) {
          contentBlocks.push({ type: 'text', text: m.content });
        }
      } else if (Array.isArray(m.content)) {
        for (const block of m.content) {
          if (block.type === 'text' && block.text && block.text.trim()) {
            contentBlocks.push({ type: 'text', text: block.text });
          } else if (block.type === 'thinking' && block.thinking && block.thinking.trim()) {
            contentBlocks.push({
              type: 'text',
              text: `[Thinking: ${block.thinking.slice(0, 1000)}]`,
            });
          } else if (block.type === 'toolCall' || block.type === 'tool_use') {
            const rawArgs = block.arguments || block.args || block.input || {};
            let parsedArgs = rawArgs;
            if (typeof rawArgs === 'string') {
              try {
                parsedArgs = JSON.parse(rawArgs);
              } catch {
                parsedArgs = { raw: rawArgs };
              }
            }
            contentBlocks.push({
              type: 'tool_use',
              id: block.id || `call_${Date.now()}`,
              name: block.name || block.function?.name || 'tool',
              input: parsedArgs,
            });
          }
        }
      }

      // Anthropic / MiniMax rule: Assistant MUST have non-empty content
      if (contentBlocks.length === 0) {
        contentBlocks.push({ type: 'text', text: 'Understood. Continuing...' });
      }

      rawMessages.push({ role: 'assistant', content: contentBlocks });
    } else if (m.role === 'toolResult') {
      const text = Array.isArray(m.content)
        ? m.content.map((c: any) => c.text || '').join('\n')
        : typeof m.content === 'string'
        ? m.content
        : JSON.stringify(m.content || '');

      rawMessages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolCallId,
            content: text || 'Success',
          },
        ],
      });
    }
  }

  // Normalize rawMessages to enforce:
  // 1. Strictly alternating user and assistant roles
  // 2. Merging consecutive user messages (e.g. multiple tool results from parallel/sequential calls)
  // 3. Merging consecutive assistant messages
  // 4. Starting with a user message
  const messages: any[] = [];

  for (const rawMsg of rawMessages) {
    if (messages.length === 0 && rawMsg.role === 'assistant') {
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: 'Please proceed with the task.' }],
      });
    }

    const prevMsg = messages[messages.length - 1];

    if (prevMsg && prevMsg.role === rawMsg.role) {
      const prevBlocks = Array.isArray(prevMsg.content)
        ? prevMsg.content
        : [{ type: 'text', text: String(prevMsg.content || '') }];
      const currBlocks = Array.isArray(rawMsg.content)
        ? rawMsg.content
        : [{ type: 'text', text: String(rawMsg.content || '') }];
      prevMsg.content = [...prevBlocks, ...currBlocks];
    } else {
      messages.push(rawMsg);
    }
  }

  // Final validation pass on all messages
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      msg.content = msg.content.filter((b: any) => {
        if (b.type === 'text') {
          return Boolean(b.text && String(b.text).trim().length > 0);
        }
        return true;
      });

      if (msg.content.length === 0) {
        msg.content.push({
          type: 'text',
          text: msg.role === 'assistant' ? 'Continuing...' : 'Continue',
        });
      }
    }
  }

  // Convert tools
  const tools = ALL_AGENT_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));

  const payload: any = {
    model: config.model || model.id || 'claude-3-7-sonnet-20250219',
    max_tokens: 4096,
    messages,
    stream: true,
  };

  if (systemText) {
    payload.system = systemText;
  }
  if (tools.length > 0) {
    payload.tools = tools;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey.trim(),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true', // Required for browser calls
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Anthropic Provider error (${response.status}): ${errorBody || response.statusText}`);
  }

  if (!response.body) {
    throw new Error('Response body is null');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');

  let assistantMessage: AssistantMessage = {
    role: 'assistant',
    content: [],
    stopReason: 'stop',
  };

  stream.push({ type: 'start', partial: assistantMessage });

  let currentBlockType: 'text' | 'tool_use' | null = null;
  let currentBlockIndex = 0;
  let currentToolUse: { id: string; name: string; jsonAccumulator: string } | null = null;

  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const dataStr = line.slice(5).trim();

      try {
        const event = JSON.parse(dataStr);

        switch (event.type) {
          case 'content_block_start': {
            currentBlockIndex = event.index ?? assistantMessage.content.length;
            if (event.content_block?.type === 'text') {
              currentBlockType = 'text';
              const textBlock: TextContent = { type: 'text', text: '' };
              assistantMessage.content.push(textBlock);
              stream.push({
                type: 'text_start',
                contentIndex: currentBlockIndex,
                partial: assistantMessage,
              });
            } else if (event.content_block?.type === 'thinking') {
              currentBlockType = 'thinking' as any;
            } else if (event.content_block?.type === 'tool_use') {
              currentBlockType = 'tool_use';
              currentToolUse = {
                id: event.content_block.id,
                name: event.content_block.name,
                jsonAccumulator: '',
              };
              const toolCall: any = {
                type: 'toolCall',
                id: event.content_block.id,
                name: event.content_block.name,
                arguments: {},
                args: {},
              };
              assistantMessage.content.push(toolCall);
              currentBlockIndex = assistantMessage.content.length - 1;
              stream.push({
                type: 'toolcall_start',
                contentIndex: currentBlockIndex,
                partial: assistantMessage,
              });
            }
            break;
          }

          case 'content_block_delta': {
            if (currentBlockType === ('thinking' as any) || event.delta?.type === 'thinking_delta') {
              const delta = event.delta?.thinking || event.delta?.text || '';
              stream.push({
                type: 'thinking_delta' as any,
                delta,
                partial: assistantMessage,
              });
            } else if (currentBlockType === 'text' && event.delta?.type === 'text_delta') {
              const delta = event.delta.text || '';
              const block = assistantMessage.content[currentBlockIndex] as TextContent;
              if (block) block.text += delta;
              stream.push({
                type: 'text_delta',
                contentIndex: currentBlockIndex,
                delta,
                partial: assistantMessage,
              });
            } else if (currentBlockType === 'tool_use' && event.delta?.type === 'input_json_delta') {
              if (currentToolUse) {
                const delta = event.delta.partial_json || '';
                currentToolUse.jsonAccumulator += delta;
                stream.push({
                  type: 'toolcall_delta',
                  contentIndex: currentBlockIndex,
                  delta,
                  partial: assistantMessage,
                });
              }
            }
            break;
          }

          case 'content_block_stop': {
            if (currentBlockType === 'text') {
              const block = assistantMessage.content[currentBlockIndex] as TextContent;
              stream.push({
                type: 'text_end',
                contentIndex: currentBlockIndex,
                content: block ? block.text : '',
                partial: assistantMessage,
              });
            } else if (currentBlockType === 'tool_use' && currentToolUse) {
              let parsedInput: Record<string, any> = {};
              try {
                parsedInput = JSON.parse(currentToolUse.jsonAccumulator || '{}');
              } catch {
                parsedInput = { raw: currentToolUse.jsonAccumulator };
              }

              const toolCall = assistantMessage.content[currentBlockIndex] as any;
              if (toolCall) {
                toolCall.arguments = parsedInput;
                toolCall.args = parsedInput;
              }
              assistantMessage.stopReason = 'toolUse';

              stream.push({
                type: 'toolcall_end',
                contentIndex: currentBlockIndex,
                toolCall: toolCall || {
                  type: 'toolCall',
                  id: currentToolUse.id,
                  name: currentToolUse.name,
                  arguments: parsedInput,
                  args: parsedInput,
                },
                partial: assistantMessage,
              });
              currentToolUse = null;
            }
            currentBlockType = null;
            break;
          }

          case 'message_delta': {
            if (event.delta?.stop_reason) {
              if (event.delta.stop_reason === 'tool_use') {
                assistantMessage.stopReason = 'toolUse';
              } else {
                assistantMessage.stopReason = 'stop';
              }
            }
            break;
          }
        }
      } catch {
        // Skip malformed SSE lines
      }
    }
  }

  // Ensure assistantMessage is never completely empty
  if (assistantMessage.content.length === 0) {
    const fallbackText: TextContent = { type: 'text', text: 'Done.' };
    assistantMessage.content.push(fallbackText);
    stream.push({
      type: 'text_start',
      contentIndex: 0,
      partial: assistantMessage,
    });
    stream.push({
      type: 'text_delta',
      contentIndex: 0,
      delta: 'Done.',
      partial: assistantMessage,
    });
    stream.push({
      type: 'text_end',
      contentIndex: 0,
      content: 'Done.',
      partial: assistantMessage,
    });
  } else {
    // If there is only an empty text block and no tool calls, fill it
    const hasToolCall = assistantMessage.content.some((c: any) => c.type === 'toolCall');
    if (!hasToolCall) {
      for (const block of assistantMessage.content) {
        if (block.type === 'text' && !block.text.trim()) {
          block.text = 'Done.';
        }
      }
    }
  }

  stream.push({
    type: 'done',
    reason: assistantMessage.stopReason as any,
    message: assistantMessage,
  });
  stream.end(assistantMessage);
}
