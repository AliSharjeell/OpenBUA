// Only harness recovery directives in the latest user turn can require a tool.
// Ordinary user questions and tool-result text never activate this policy.
export function recoveryRequiresTool(messages: readonly any[]): boolean {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === 'toolResult' || message.role === 'tool') return false;
    if (message.role !== 'user') continue;
    const text = typeof message.content === 'string' ? message.content :
      (Array.isArray(message.content) ? message.content.filter((block: any) => block.type === 'text').map((block: any) => block.text || '').join('\n') : '');
    return /^SYSTEM: (your previous turn was cut off|the previous turn ended before the task was finished|you are stuck)/i.test(text) && /Your next output MUST be a tool call/i.test(text);
  }
  return false;
}

export function toolChoiceRejected(status: number, body: string): boolean {
  return status === 400 && /tool[_ ]choice/i.test(body) && /unsupported|not supported|invalid|not allowed|only|must/i.test(body);
}
