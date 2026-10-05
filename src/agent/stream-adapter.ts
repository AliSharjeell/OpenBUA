// Client-side BYOK Stream Adapter for pi-agent-core and pi-ai
// Supports OpenAI-compatible and Anthropic-compatible endpoints with custom baseUrl, apiKey, and model name.

import {
  AssistantMessage,
  AssistantMessageEventStream,
  createAssistantMessageEventStream,
  Model,
  TextContent,
  ThinkingContent,
  ToolCall,
  TranscriptContext,
} from '@earendil-works/pi-ai';
import { ALL_AGENT_TOOLS } from './tools';
import { recoveryRequiresTool, toolChoiceRejected } from './recovery-tool-choice';
import { ProviderConfig } from '../types';
import { incrementGeminiDailyUsage } from '../services/storage';

let lastFreeRequestTimestamp = 0;

export function createCustomModel(config: ProviderConfig): Model<any> {
  const isGemini =
    (config.model || '').toLowerCase().includes('gemini') ||
    (config.baseUrl || '').includes('generativelanguage.googleapis.com');
  return {
    id: config.model,
    name: config.model,
    provider: config.provider,
    api: config.provider === 'anthropic' ? 'anthropic-messages' : 'openai-completions',
    reasoning: isGemini || false,
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
          content: [{ type: 'text', text: 'Agent interrupted. Type continue to resume.' }],
          stopReason: 'aborted',
          errorMessage: 'Agent interrupted. Type continue to resume.',
        };
        stream.push({ type: 'error', reason: 'aborted', error: abortedMsg });
        stream.end(abortedMsg);
      } else {
        const errorMsg: AssistantMessage = {
          role: 'assistant',
          content: [{ type: 'text', text: `API Error: ${err?.message || String(err)}` }],
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

/**
 * Sliding-window context compaction helper:
 * Analyzes the transcript to identify older tool calls (> 2 assistant turns ago)
 * and maps toolCallId -> toolName.
 *
 * Rules:
 * - The most recent 2 assistant turns that invoked tools retain 100% full fidelity
 *   (full DOM text, forms, elements, and vision screenshots).
 * - Assistant turns older than 2 turns have:
 *   1. Vision screenshots pruned except the latest visual observation.
 *   2. Bulky DOM text (>350 chars) truncated to ~300 chars.
 *   3. 'scratchpad' results are strictly preserved (never truncated).
 */
export function analyzeAssistantTurns(messages: any[]): {
  olderToolCallIds: Set<string>;
  toolCallIdToName: Map<string, string>;
} {
  const assistantTurnsWithTools: Array<{ toolCallIds: string[] }> = [];
  const toolCallIdToName = new Map<string, string>();

  for (const m of messages) {
    if (m.role === 'assistant') {
      const toolCallIds: string[] = [];
      if (Array.isArray(m.content)) {
        for (const block of m.content) {
          if ((block.type === 'toolCall' || block.type === 'tool_use') && block.id) {
            toolCallIds.push(block.id);
            const name = block.name || block.function?.name || '';
            if (name) toolCallIdToName.set(block.id, name);
          }
        }
      }
      if (toolCallIds.length > 0) {
        assistantTurnsWithTools.push({ toolCallIds });
      }
    }
  }

  const olderToolCallIds = new Set<string>();
  if (assistantTurnsWithTools.length > 2) {
    const olderTurns = assistantTurnsWithTools.slice(0, assistantTurnsWithTools.length - 2);
    for (const turn of olderTurns) {
      for (const id of turn.toolCallIds) {
        olderToolCallIds.add(id);
      }
    }
  }

  // Keep the newest visual observation available through intervening clicks,
  // keypresses and text reads. Tool age is not evidence that an image was
  // superseded, and dropping it makes canvas editing depend on memory alone.
  const latestImageResult = [...messages].reverse().find((m: any) =>
    m.role === 'toolResult' && Array.isArray(m.content) &&
    m.content.some((block: any) => block.type === 'image' && block.data)
  );
  if (latestImageResult) olderToolCallIds.delete(latestImageResult.toolCallId);

  return { olderToolCallIds, toolCallIdToName };
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

  // Detect Groq specifically by checking for the exact Groq API endpoint.
  // Standard providers (Mimo, DeepSeek, OpenAI, Claude, OpenRouter, MiniMax) are NEVER throttled or compacted.
  const isGroq = endpoint.includes('api.groq.com/openai/v1/chat/completions');
  const isGemini = endpoint.includes('generativelanguage.googleapis.com') || (config.model || '').toLowerCase().includes('gemini');
  const isFreeMode = Boolean(config.isFreeMode || config.mode === 'free');

  const flushPendingImages = (targetArray: any[]) => {
    if (pendingToolImages.length > 0 && !isGroq) {
      for (const img of pendingToolImages) {
        targetArray.push({
          role: 'user',
          content: [
            { type: 'text', text: '[Screenshot of current browser tab for visual inspection]:' },
            {
              type: 'image_url',
              image_url: {
                url: `data:${img.mimeType || 'image/jpeg'};base64,${img.data}`,
              },
            },
          ],
        });
      }
      pendingToolImages.length = 0;
    }
  };

  const { olderToolCallIds, toolCallIdToName } = analyzeAssistantTurns(context.messages);
  const pendingToolImages: Array<{ data: string; mimeType?: string }> = [];

  for (const m of context.messages) {
    if (m.role !== 'toolResult') {
      flushPendingImages(messages);
    }

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
      let thinkingParts = '';
      let toolCalls: any[] = [];

      const isGoogle = isGemini;

      if (typeof m.content === 'string') {
        textParts = m.content;
      } else if (Array.isArray(m.content)) {
        textParts = m.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text || '')
          .join('\n');

        thinkingParts = m.content
          .filter((c: any) => c.type === 'thinking')
          .map((c: any) => c.thinking || '')
          .join('\n');

        toolCalls = m.content
          .filter((c: any) => c.type === 'toolCall' || c.type === 'tool_use')
          .map((c: any) => {
            const rawArgs = c.arguments || c.args || c.input || {};
            const tcObj: any = {
              id: c.id,
              type: 'function',
              function: {
                name: c.name,
                arguments: typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs),
              },
            };
            const thoughtSig = c.thought_signature || c.extra_content?.google?.thought_signature;
            if (isGoogle) {
              const sig = thoughtSig || 'skip_thought_signature_validator';
              tcObj.extra_content = {
                google: {
                  thought_signature: sig,
                },
              };
              tcObj.thought_signature = sig;
            } else if (c.extra_content) {
              tcObj.extra_content = c.extra_content;
              if (c.thought_signature) tcObj.thought_signature = c.thought_signature;
            } else if (c.thought_signature) {
              tcObj.thought_signature = c.thought_signature;
            }
            return tcObj;
          });
      }

      const msg: any = { role: 'assistant' };
      if (textParts && textParts.trim().length > 0) {
        msg.content = textParts;
      }
      if (thinkingParts && thinkingParts.trim().length > 0) {
        msg.reasoning_content = thinkingParts;
      }

      if (toolCalls.length > 0) {
        msg.tool_calls = toolCalls;
        if (!msg.content) msg.content = null;
      } else if (!msg.content) {
        // Assistant turns without tool calls MUST provide content per OpenAI spec
        msg.content = msg.reasoning_content?.slice(0, 500) || 'Understood.';
      }
      messages.push(msg);
    } else if (m.role === 'toolResult') {
      const isOlderTurn = olderToolCallIds.has(m.toolCallId);
      const toolName = (m as any).toolName || toolCallIdToName.get(m.toolCallId) || '';
      const isScratchpad = toolName === 'scratchpad' || toolName === 'append_to_preview';

      let text = Array.isArray(m.content)
        ? m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text || '').join('\n')
        : typeof m.content === 'string'
        ? m.content
        : JSON.stringify(m.content || '');

      const imageBlocks = Array.isArray(m.content)
        ? m.content.filter((c: any) => c.type === 'image' && c.data)
        : [];

      if (isOlderTurn) {
        // Prune older vision screenshots to preserve model inference speed and tokens
        if (imageBlocks.length > 0) {
          text = (text ? text + '\n' : '') + '[Older screenshot omitted; this does not verify any action or caret placement.]';
        }
        // Compact older turn bulky DOM/HTML dumps (never prune scratchpad notes)
        if (!isScratchpad && text.length > 350) {
          const pruned = text.length - 300;
          text = text.slice(0, 300) + `\n... [Prior turn DOM content compacted - ${pruned} chars pruned]`;
        }
      } else {
        // Recent turn: preserve vision screenshot blocks for visual inspection
        if (imageBlocks.length > 0) {
          pendingToolImages.push(...imageBlocks);
        }
      }

      // ONLY cap tool output for Groq free-tier due to its severe 7000 ITPM limit. Standard models get full tool output!
      if (isGroq && text.length > 2500) {
        text = text.slice(0, 2500) + '\n... [Remaining content trimmed for Groq rate limit]';
      }

      messages.push({
        role: 'tool',
        tool_call_id: m.toolCallId,
        content: text || 'Success',
      });
    }
  }

  // Flush any remaining tool images at end of conversation history
  flushPendingImages(messages);

  // Extra compaction pass for Groq free tier if needed
  if (isGroq) {
    const totalMsgs = messages.length;
    for (let i = 0; i < totalMsgs - 4; i++) {
      const msg = messages[i];
      if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > 250) {
        msg.content = msg.content.slice(0, 250) + '\n... [Prior turn output compacted for Groq limit]';
      }
    }
  }

  // Final validation pass to enforce OpenAI spec across all assistant turns:
  // Assistant messages must provide content, reasoning_content, or tool_calls
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'assistant') {
      const hasTools = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
      const hasContent = typeof msg.content === 'string' && msg.content.trim().length > 0;
      const hasReasoning = typeof msg.reasoning_content === 'string' && msg.reasoning_content.trim().length > 0;
      if (!hasTools && !hasContent) {
        msg.content = hasReasoning ? (msg.reasoning_content.slice(0, 500) || 'Thinking...') : 'Understood.';
      }
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
    payload.tool_choice = recoveryRequiresTool(context.messages || []) ? 'required' : 'auto';
  }

  // Request thoughts / reasoning traces for Gemini models via Google OpenAI-compatible endpoint
  if (isGemini) {
    const thinkingConfig: any = {
      include_thoughts: true,
      thinking_budget: 1024,
    };

    payload.extra_body = {
      google: {
        thinking_config: thinkingConfig,
      },
    };
  }

  // If using Groq, clamp max_tokens to prevent OTPM (output tokens per minute) errors on Groq's free tier.
  // Standard models (Mimo, Claude, OpenAI, DeepSeek) are NEVER clamped.
  if (isGroq) {
    if ((config.model || '').includes('qwen')) {
      payload.max_tokens = 450;
    } else {
      payload.max_tokens = 2048;
    }
  }

  let response: Response | null = null;
  const maxRetries = isGroq ? 4 : isFreeMode ? 4 : 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let fetchError: any = null;

    if (isFreeMode) {
      const minSpacingMs = 3500;
      const elapsed = Date.now() - lastFreeRequestTimestamp;
      if (elapsed < minSpacingMs && lastFreeRequestTimestamp > 0) {
        const sleepMs = minSpacingMs - elapsed;
        await new Promise((r) => setTimeout(r, sleepMs));
      }
      lastFreeRequestTimestamp = Date.now();
    }

    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey.trim()}`,
        },
        body: JSON.stringify(payload),
        signal,
      });
    } catch (err: any) {
      fetchError = err;
      if (signal?.aborted) {
        throw err;
      }
    }

    if (fetchError) {
      if (attempt < maxRetries) {
        console.warn(`[streamOpenAI] Network fetch error on attempt ${attempt + 1}/${maxRetries + 1} (${fetchError.message || fetchError}). Retrying...`);
        const delayMs = Math.min(2500, 400 * Math.pow(2, attempt));
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw new Error(`Failed to reach API server (${fetchError.message || 'Failed to fetch'}). Please check your internet connection or API endpoint.`);
    }

    if (response && response.ok) {
      if (isGemini || endpoint.includes('generativelanguage.googleapis.com')) {
        incrementGeminiDailyUsage().catch(() => {});
      }
      break;
    }

    const errorBody = await response.text();

    if (payload.tool_choice === 'required' && toolChoiceRejected(response.status, errorBody) && attempt < maxRetries) {
      console.warn('[streamOpenAI] Provider rejected required tool choice; retrying recovery with auto tool choice.');
      payload.tool_choice = 'auto';
      continue;
    }

    // If Gemini model rejected thinking_config with 400 Bad Request on attempt 0, try reasoning_effort fallback
    if (response && response.status === 400 && payload.google && attempt === 0) {
      console.warn('[streamOpenAI] Model returned 400 with thinking_config. Retrying with reasoning_effort...');
      delete payload.google;
      delete payload.extra_body;
      payload.reasoning_effort = 'low';
      continue;
    }
    // If reasoning_effort was also rejected with 400, strip reasoning controls completely
    if (response && response.status === 400 && payload.reasoning_effort && attempt <= 1) {
      console.warn('[streamOpenAI] Model returned 400 with reasoning_effort. Retrying without reasoning params...');
      delete payload.reasoning_effort;
      continue;
    }

    // Free Mode (Gemini Free Tier) 429 Rate Limit Interception & Auto-Waiting
    if (response && response.status === 429 && isFreeMode && attempt < maxRetries) {
      let waitSeconds = 30;
      const retryDelayMatch = errorBody.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s?"/i);
      const retryInMatch = errorBody.match(/retry in\s*(\d+(?:\.\d+)?)s/i);
      const retryAfterHeader = response.headers?.get('retry-after');

      if (retryDelayMatch && retryDelayMatch[1]) {
        waitSeconds = Math.ceil(parseFloat(retryDelayMatch[1])) + 1;
      } else if (retryInMatch && retryInMatch[1]) {
        waitSeconds = Math.ceil(parseFloat(retryInMatch[1])) + 1;
      } else if (retryAfterHeader && !isNaN(Number(retryAfterHeader))) {
        waitSeconds = Math.ceil(Number(retryAfterHeader)) + 1;
      } else {
        waitSeconds = Math.min(60, Math.max(15, (attempt + 1) * 15));
      }

      const activeModelName = config.model || 'Gemini Free';
      stream.push({
        type: 'text_delta',
        contentIndex: 0,
        delta: `\n⏳ Rate limit reached for ${activeModelName} (${attempt + 1}/${maxRetries}). Auto-waiting ${waitSeconds}s to resume (or switch model in Settings)...\n`,
        partial: { role: 'assistant', content: [] } as any,
      });

      for (let s = waitSeconds; s > 0; s--) {
        if (signal?.aborted) {
          throw new Error('Agent interrupted. Type continue to resume.');
        }
        await new Promise((r) => setTimeout(r, 1000));
      }

      stream.push({
        type: 'text_delta',
        contentIndex: 0,
        delta: `🔄 Quota window refreshed. Resuming task...\n`,
        partial: { role: 'assistant', content: [] } as any,
      });
      continue;
    }

    // Check for 413 (Payload Too Large) or 429 (Rate Limit - ITPM input or OTPM output tokens)
    const isRateOrSizeLimit = response.status === 413 || response.status === 429;
    if (isRateOrSizeLimit && isGroq && attempt < maxRetries) {
      // 1. If error specifically asks to reduce message size or indicates ITPM input limit exceeded (413 or 429)
      if (
        response.status === 413 ||
        errorBody.includes('reduce your message size') ||
        errorBody.includes('Request too large') ||
        (errorBody.includes('ITPM') && errorBody.includes('Limit'))
      ) {
        stream.push({
          type: 'text_delta',
          delta: `⏳ Free tier token limit reached (requested size exceeded limit). Auto-compacting conversation history...\n`,
        });

        // Aggressively compact all tool messages to 200 chars max
        for (const msg of payload.messages) {
          if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > 200) {
            msg.content = msg.content.slice(0, 200) + '... [Compacted]';
          }
          if (msg.role === 'system' && typeof msg.content === 'string' && msg.content.length > 1200) {
            msg.content = msg.content.slice(0, 1200) + '\n... [Stored knowledge trimmed to fit token limits]';
          }
        }

        // If history is still long, retain system prompt + initial user task + last 2 turns
        if (payload.messages.length > 6) {
          const sys = payload.messages.find((m: any) => m.role === 'system');
          const firstUser = payload.messages.find((m: any) => m.role === 'user');
          const recent = payload.messages.slice(-3);
          const pruned = [];
          if (sys) pruned.push(sys);
          if (firstUser && !recent.includes(firstUser)) pruned.push(firstUser);
          for (const r of recent) {
            if (!pruned.includes(r)) pruned.push(r);
          }
          payload.messages = pruned;
        }

        payload.max_tokens = Math.min(payload.max_tokens || 450, 350);
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }

      // 2. If error specifically asks to reduce max_tokens (OTPM output tokens exceeded)
      if (errorBody.includes('reduce max_tokens') || errorBody.includes('OTPM')) {
        const currentMax = payload.max_tokens || 450;
        payload.max_tokens = Math.max(200, Math.floor(currentMax * 0.5));
        stream.push({
          type: 'text_delta',
          delta: `⏳ Output token limit hit. Retrying with shorter response (max ${payload.max_tokens} tokens)...\n`,
        });
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }

      // 3. Standard 429 countdown
      let waitSeconds = 6;
      try {
        const match = errorBody.match(/try again in ([\d\.]+)s/i);
        if (match && match[1]) {
          waitSeconds = Math.ceil(parseFloat(match[1])) + 1;
        }
      } catch (e) {
        waitSeconds = 6;
      }

      for (let s = waitSeconds; s > 0; s--) {
        if (signal?.aborted) break;
        stream.push({
          type: 'text_delta',
          delta: attempt === 0 && s === waitSeconds
            ? `⏳ Groq Free Tier rate limit reached. Auto-resuming in ${s}s...\n`
            : ``,
        });
        await new Promise((r) => setTimeout(r, 1000));
      }

      if (signal?.aborted) {
        throw new Error('Agent interrupted. Type continue to resume.');
      }
      continue;
    }

    // For non-Groq, non-Free (BYOK) providers, retry on transient 5xx server errors or transient 429 rate limits
    if (!isGroq && !isFreeMode && response && (response.status >= 500 || response.status === 429) && attempt < maxRetries) {
      console.warn(`[streamOpenAI] HTTP ${response.status} received on attempt ${attempt + 1}/${maxRetries + 1}. Retrying...`);
      const delayMs = Math.min(3000, 800 * Math.pow(2, attempt));
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }

    throw new Error(`OpenAI Provider error (${response?.status || 'Unknown'}): ${errorBody || response?.statusText || 'Request failed'}`);
  }

  if (!response || !response.ok) {
    throw new Error(`Request failed after retries`);
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
  let thinkingContentBlock: ThinkingContent | null = null;
  const toolCallAccumulators = new Map<
    number,
    { id: string; name: string; argsStr: string; extra_content?: any; thought_signature?: string }
  >();
  let isInsideInlineThink = false;
  let activeThinkClosingTag = '</think>';

  const emitThinkingDelta = (chunk: string) => {
    if (!chunk) return;
    if (!thinkingContentBlock) {
      thinkingContentBlock = { type: 'thinking', thinking: '' };
      assistantMessage.content.push(thinkingContentBlock);
      const contentIndex = assistantMessage.content.length - 1;
      stream.push({ type: 'thinking_start' as any, contentIndex, partial: assistantMessage });
    }
    thinkingContentBlock.thinking += chunk;
    const contentIndex = assistantMessage.content.indexOf(thinkingContentBlock);
    stream.push({
      type: 'thinking_delta' as any,
      contentIndex,
      delta: chunk,
      partial: assistantMessage,
    });
  };

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

        const delta = choice.delta || choice.message || {};

        // Reasoning / Thinking delta (Gemini reasoning_content/thought/parts, DeepSeek R1, OpenAI o1/o3-mini, Minimax)
        let reasoningDelta = '';
        if (typeof delta.reasoning_content === 'string') {
          reasoningDelta = delta.reasoning_content;
        } else if (typeof delta.thought === 'string') {
          reasoningDelta = delta.thought;
        } else if (typeof delta.thought_summary === 'string') {
          reasoningDelta = delta.thought_summary;
        } else if (typeof delta.reasoning === 'string') {
          reasoningDelta = delta.reasoning;
        } else if (typeof (choice as any).reasoning_content === 'string') {
          reasoningDelta = (choice as any).reasoning_content;
        } else if (typeof (choice as any).thought === 'string') {
          reasoningDelta = (choice as any).thought;
        } else if (Array.isArray(delta.parts)) {
          for (const p of delta.parts) {
            if (p && p.thought && p.text) {
              reasoningDelta += p.text;
            } else if (p && !p.thought && p.text && !delta.content) {
              delta.content = (delta.content || '') + p.text;
            }
          }
        } else if (delta.extra_content?.google?.thought !== undefined) {
          const gThought = delta.extra_content.google.thought;
          if (typeof gThought === 'string') {
            reasoningDelta = gThought;
          } else if (gThought && typeof gThought === 'object' && gThought.text) {
            reasoningDelta = gThought.text;
          } else if (gThought === true && delta.content) {
            // Google flagged this entire delta's content as thought / reasoning
            let thoughtStr = delta.content;
            thoughtStr = thoughtStr.replace(/^<thought>/i, '').replace(/<\/thought>$/i, '');
            reasoningDelta = thoughtStr;
            delta.content = '';
          }
        } else if (delta.thought && typeof delta.thought === 'object') {
          reasoningDelta = delta.thought.text || delta.thought.content || '';
        } else if (delta.reasoning_content && typeof delta.reasoning_content === 'object') {
          reasoningDelta = (delta.reasoning_content as any).text || '';
        }

        if (reasoningDelta) {
          emitThinkingDelta(reasoningDelta);
        }

        // Text delta (with inline <think>...</think> and <thought>...</thought> tag interception)
        if (delta.content) {
          let textToEmit = delta.content;

          while (textToEmit.length > 0) {
            if (isInsideInlineThink) {
              const endIdx =
                textToEmit.indexOf(activeThinkClosingTag) !== -1
                  ? textToEmit.indexOf(activeThinkClosingTag)
                  : textToEmit.indexOf('</think>') !== -1
                  ? textToEmit.indexOf('</think>')
                  : textToEmit.indexOf('</thought>');

              if (endIdx !== -1) {
                const matchedCloseTag = textToEmit.slice(endIdx).startsWith('</thought>')
                  ? '</thought>'
                  : '</think>';
                const thinkPart = textToEmit.slice(0, endIdx);
                if (thinkPart) {
                  emitThinkingDelta(thinkPart);
                }
                isInsideInlineThink = false;
                textToEmit = textToEmit.slice(endIdx + matchedCloseTag.length);
              } else {
                emitThinkingDelta(textToEmit);
                textToEmit = '';
              }
            } else {
              const thinkIdx = textToEmit.indexOf('<think>');
              const thoughtIdx = textToEmit.indexOf('<thought>');
              let startIdx = -1;
              let tagLen = 0;
              let closingTag = '</think>';

              if (thinkIdx !== -1 && (thoughtIdx === -1 || thinkIdx < thoughtIdx)) {
                startIdx = thinkIdx;
                tagLen = 7; // '<think>'.length
                closingTag = '</think>';
              } else if (thoughtIdx !== -1) {
                startIdx = thoughtIdx;
                tagLen = 9; // '<thought>'.length
                closingTag = '</thought>';
              }

              if (startIdx !== -1) {
                activeThinkClosingTag = closingTag;
                const beforeThink = textToEmit.slice(0, startIdx);
                textToEmit = textToEmit.slice(startIdx + tagLen);

                if (beforeThink) {
                  if (!textContentBlock) {
                    textContentBlock = { type: 'text', text: '' };
                    assistantMessage.content.push(textContentBlock);
                    const contentIndex = assistantMessage.content.length - 1;
                    stream.push({ type: 'text_start', contentIndex, partial: assistantMessage });
                  }
                  textContentBlock.text += beforeThink;
                  const contentIndex = assistantMessage.content.indexOf(textContentBlock);
                  stream.push({
                    type: 'text_delta',
                    contentIndex,
                    delta: beforeThink,
                    partial: assistantMessage,
                  });
                }

                isInsideInlineThink = true;
              } else {
                if (!textContentBlock) {
                  textContentBlock = { type: 'text', text: '' };
                  assistantMessage.content.push(textContentBlock);
                  const contentIndex = assistantMessage.content.length - 1;
                  stream.push({ type: 'text_start', contentIndex, partial: assistantMessage });
                }
                textContentBlock.text += textToEmit;
                const contentIndex = assistantMessage.content.indexOf(textContentBlock);
                stream.push({
                  type: 'text_delta',
                  contentIndex,
                  delta: textToEmit,
                  partial: assistantMessage,
                });
                textToEmit = '';
              }
            }
          }
        }

        // Tool calls delta
        if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            // Determine a unique accumulator key:
            // 1. If tc.index is explicitly specified (number), use String(tc.index)
            // 2. Else if tc.id is provided, use tc.id
            // 3. Else fallback to unique call id
            let key: string;
            if (typeof tc.index === 'number') {
              key = `idx_${tc.index}`;
            } else if (tc.id) {
              key = `id_${tc.id}`;
            } else if (tc.function?.name && toolCallAccumulators.size > 0) {
              const lastKey = Array.from(toolCallAccumulators.keys()).pop()!;
              const lastAcc = toolCallAccumulators.get(lastKey)!;
              if (lastAcc.name === tc.function.name) {
                key = lastKey;
              } else {
                key = `call_${toolCallAccumulators.size}`;
              }
            } else {
              key = `call_${toolCallAccumulators.size}`;
            }

            const extra = tc.extra_content || delta.extra_content || choice.extra_content || (json as any).extra_content;
            const thoughtSig =
              tc.thought_signature ||
              delta.thought_signature ||
              extra?.google?.thought_signature ||
              tc.provider_specific_fields?.thought_signature;

            if (!toolCallAccumulators.has(key)) {
              toolCallAccumulators.set(key, {
                id: tc.id || `call_${toolCallAccumulators.size}_${Date.now()}`,
                name: tc.function?.name || '',
                argsStr: tc.function?.arguments || '',
                extra_content: extra,
                thought_signature: thoughtSig,
              });
            } else {
              const acc = toolCallAccumulators.get(key)!;
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) {
                if (!acc.name) {
                  acc.name = tc.function.name;
                } else if (acc.name === tc.function.name) {
                  // Duplicate full name sent across chunks, do not append
                } else if (tc.function.name.startsWith(acc.name)) {
                  acc.name = tc.function.name;
                } else if (!acc.name.includes(tc.function.name)) {
                  acc.name += tc.function.name;
                }
              }
              if (tc.function?.arguments) acc.argsStr += tc.function.arguments;
              if (extra) acc.extra_content = extra;
              if (thoughtSig) acc.thought_signature = thoughtSig;
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

  // Finalize thinking block
  if (thinkingContentBlock) {
    const contentIndex = assistantMessage.content.indexOf(thinkingContentBlock);
    stream.push({
      type: 'thinking_end' as any,
      contentIndex,
      content: thinkingContentBlock.thinking,
      partial: assistantMessage,
    });
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
        extra_content: acc.extra_content,
        thought_signature: acc.thought_signature,
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
  const { olderToolCallIds, toolCallIdToName } = analyzeAssistantTurns(context.messages);
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
      const isOlderTurn = olderToolCallIds.has(m.toolCallId);
      const toolName = (m as any).toolName || toolCallIdToName.get(m.toolCallId) || '';
      const isScratchpad = toolName === 'scratchpad' || toolName === 'append_to_preview';

      let textParts = Array.isArray(m.content)
        ? m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text || '').join('\n')
        : typeof m.content === 'string'
        ? m.content
        : JSON.stringify(m.content || '');

      const imageBlocks = Array.isArray(m.content)
        ? m.content.filter((c: any) => c.type === 'image' && c.data)
        : [];

      const toolResultContent: any[] = [];

      if (isOlderTurn) {
        // Prune older screenshots to prevent massive multi-megabyte vision token payloads
        if (imageBlocks.length > 0) {
          textParts = (textParts ? textParts + '\n' : '') + '[Older screenshot omitted; this does not verify any action or caret placement.]';
        }
        // Compact older turn bulky DOM/HTML dumps (never prune scratchpad notes)
        if (!isScratchpad && textParts.length > 350) {
          const pruned = textParts.length - 300;
          textParts = textParts.slice(0, 300) + `\n... [Prior turn DOM content compacted - ${pruned} chars pruned]`;
        }
        if (textParts.trim()) {
          toolResultContent.push({ type: 'text', text: textParts });
        }
      } else {
        // Recent turn: preserve full text and vision screenshots
        if (textParts.trim()) {
          toolResultContent.push({ type: 'text', text: textParts });
        }
        for (const img of imageBlocks) {
          toolResultContent.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: img.mimeType || 'image/jpeg',
              data: img.data,
            },
          });
        }
      }

      if (toolResultContent.length === 0) {
        toolResultContent.push({ type: 'text', text: 'Success' });
      }

      rawMessages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolCallId,
            content: toolResultContent,
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
    if (recoveryRequiresTool(context.messages || [])) payload.tool_choice = { type: 'any' };
  }

  let response: Response | null = null;
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let fetchError: any = null;
    try {
      response = await fetch(endpoint, {
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
    } catch (err: any) {
      fetchError = err;
      if (signal?.aborted) {
        throw err;
      }
    }

    if (fetchError) {
      if (attempt < maxRetries) {
        console.warn(`[streamAnthropic] Network fetch error on attempt ${attempt + 1}/${maxRetries + 1} (${fetchError.message || fetchError}). Retrying...`);
        const delayMs = Math.min(2500, 400 * Math.pow(2, attempt));
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw new Error(`Failed to reach Anthropic API server (${fetchError.message || 'Failed to fetch'}). Please check your internet connection or API endpoint.`);
    }

    if (response && response.ok) {
      break;
    }

    // Handle transient 429 rate limit or 529 overload / 5xx server errors
    if (response && (response.status === 429 || response.status === 529 || response.status >= 500) && attempt < maxRetries) {
      console.warn(`[streamAnthropic] HTTP ${response.status} received on attempt ${attempt + 1}/${maxRetries + 1}. Retrying...`);
      const delayMs = Math.min(3000, 800 * Math.pow(2, attempt));
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }

    if (response) {
      const errorBody = await response.text();
      throw new Error(`Anthropic Provider error (${response.status}): ${errorBody || response.statusText}`);
    }
  }

  if (!response || !response.ok) {
    throw new Error('Anthropic request failed after retries');
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
