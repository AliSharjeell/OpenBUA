export async function windowRpc<T = any>(message: Record<string, unknown>): Promise<T> {
  const response = await chrome.runtime.sendMessage(message);
  if (!response || response.error) throw new Error(response?.error || 'Task window coordinator did not respond');
  return response.value;
}
