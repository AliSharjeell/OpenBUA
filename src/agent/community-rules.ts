import { getActiveTab } from './browser-bridge';
import { getActiveSessionIdState } from '../services/storage';

export type CommunityRules = {
  community: string;
  source: string;
  state: 'found' | 'empty' | 'unavailable';
  rules: Array<{ title: string; description: string }>;
  guidance: string;
  reason?: string;
  checkedGuidance?: boolean;
};

const outcomes = new Map<string, { at: number; result: CommunityRules }>();
const pending = new Map<string, Promise<CommunityRules>>();
const TTL = 5 * 60_000;

export function redditCommunity(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/^(?:www\.|old\.|new\.|m\.)?reddit\.com$/i.test(parsed.hostname)) return null;
    return parsed.pathname.match(/^\/(?:r|mod)\/([a-z0-9_]+)/i)?.[1]?.toLowerCase() || null;
  } catch { return null; }
}

function key(community: string) { return `${getActiveSessionIdState()}|${community}`; }
function remember(result: CommunityRules, lookupKey = key(result.community)) {
  outcomes.set(lookupKey, { at: Date.now(), result });
  return result;
}
function cached(community: string) {
  const entry = outcomes.get(key(community));
  if (!entry || Date.now() - entry.at >= TTL) { outcomes.delete(key(community)); return null; }
  return entry.result;
}

export function describeCommunityRules(result: CommunityRules): string {
  const outcome = result.state === 'empty'
    ? 'The rules endpoint returned an explicit empty custom-rule list. This lookup is complete; do not search alternate rules URLs hoping for missing entries.'
    : result.state === 'found'
      ? 'Custom rules were retrieved. Use these rules; do not repeat the lookup.'
      : 'Rules could not be verified. Stop this lookup instead of cycling URLs, waiting, or repeatedly inspecting the same page.';
  return `[COMMUNITY RULES: ${result.state.toUpperCase()} for r/${result.community}] ${outcome}\n` +
    'An empty custom-rule list does not grant permission to post anything. Apply visible community guidance, platform policies and composer requirements. The empty state completes the custom-rules check; do not invent missing rules. Only an unavailable state requires skipping this destination when the user requires verified rules: record the reason and continue with the others. Never report that rules were read when retrieval failed.';
}

// Recognize raw JSON only on the actual rules endpoint. Truncated JSON, a
// loading shell, a quote in a post, and an HTTP error are not an empty rule list.
export function observeRulesPage(page: { url: string; text: string }): CommunityRules | null {
  const community = redditCommunity(page.url);
  if (!community || !/\/about\/rules\.json\/?(?:\?|$)/i.test(page.url)) return null;
  const body = page.text.split('### Page Text Excerpt:\n').pop()?.trim() || '';
  try {
    const data = JSON.parse(body);
    if (!Array.isArray(data.rules) || !data.rules.every((rule: any) => rule && typeof rule.short_name === 'string' && typeof rule.description === 'string')) return null;
    return remember({ community, source: page.url, state: data.rules.length ? 'found' : 'empty',
      rules: data.rules.map((rule: any) => ({ title: rule.short_name, description: rule.description })), guidance: '' });
  } catch { return null; }
}

export function completedRulesNavigation(url: string): CommunityRules | null {
  const community = redditCommunity(url);
  if (!community || !/\/(?:about\/rules(?:\.json)?|rules)\/?(?:\?|$)/i.test(new URL(url).pathname)) return null;
  return cached(community);
}

export async function readCommunityRules(): Promise<CommunityRules> {
  const tab = await getActiveTab();
  const community = redditCommunity(tab?.url || '');
  if (!community || !tab?.id) throw new Error('Open the target Reddit community first.');
  const known = cached(community);
  if (known?.checkedGuidance) return known;
  const lookupKey = key(community);
  if (pending.has(lookupKey)) return pending.get(lookupKey)!;
  const lookup = (async () => {
    const unavailable = (reason: string): CommunityRules => ({ community, source: tab.url || '', state: 'unavailable', rules: [], guidance: '', reason });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const scripts = await Promise.race([
        chrome.scripting.executeScript({ target: { tabId: tab.id! }, args: [community, known?.state !== 'unavailable' ? known?.rules ?? null : null], func: async (name: string, knownRules: Array<{ title: string; description: string }> | null) => {
          const source = `${location.origin}/r/${encodeURIComponent(name)}/about/rules.json`;
          // Sidebar/composer guidance is extracted separately from the feed,
          // where the usual page-text prefix hides it behind dozens of posts.
          const nodes = Array.from(document.querySelectorAll('.side .md, aside, [id*="community-rules"], [data-testid*="community-rules"], .submit_text'));
          const guidance = [...new Set(nodes.map(node => (node as HTMLElement).innerText?.trim()).filter(Boolean))].join('\n\n').slice(0, 12000);
          if (knownRules) return { source, guidance, rules: knownRules };
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 3000);
          try {
            const response = await fetch(source, { credentials: 'same-origin', signal: controller.signal });
            if (!response.ok) return { source, guidance, reason: `Rules endpoint returned HTTP ${response.status}` };
            const data = await response.json();
            if (!Array.isArray(data.rules) || !data.rules.every((rule: any) => rule && typeof rule.short_name === 'string' && typeof rule.description === 'string')) return { source, guidance, reason: 'Rules response did not contain a valid rule list' };
            return { source, guidance, rules: data.rules.map((rule: any) => ({ title: rule.short_name, description: rule.description })) };
          } catch { return { source, guidance, reason: 'Rules request timed out or could not be read' }; }
          finally { clearTimeout(timer); }
        } }),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Rules lookup exceeded four seconds')), 4000); }),
      ]);
      const data = scripts[0]?.result;
      if (!data) return remember({ ...unavailable('No readable rules response'), checkedGuidance: true }, lookupKey);
      return remember({ community, source: data.source, rules: data.rules || [], guidance: data.guidance || '',
        state: Array.isArray(data.rules) ? (data.rules.length ? 'found' : 'empty') : 'unavailable', reason: data.reason, checkedGuidance: true }, lookupKey);
    } catch (error: any) { return remember({ ...unavailable(error?.message || 'Rules lookup failed'), checkedGuidance: true }, lookupKey); }
    finally { clearTimeout(timer); pending.delete(lookupKey); }
  })();
  pending.set(lookupKey, lookup);
  return lookup;
}
