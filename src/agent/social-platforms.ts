// Data-driven recipes for posting to social platforms.
//
// The agent used to have Reddit-only knowledge baked into its prompt and a
// hardcoded hostname check in the bridge. Everything platform-specific now lives
// here as data, so adding a platform is one entry in this table and no code
// change anywhere else.
//
// Only the mechanics that genuinely differ per platform are modelled: where the
// composer lives and how to open it. Media attachment itself is handled by the
// generic chunked injector, which finds the composer file input at runtime.

export type SocialPlatformId =
  | 'x'
  | 'linkedin'
  | 'reddit'
  | 'facebook'
  | 'instagram'
  | 'threads'
  | 'bluesky'
  | 'mastodon'
  | 'youtube'
  | 'pinterest'
  | 'tumblr'
  | 'tiktok';

export interface PlatformRecipe {
  id: SocialPlatformId;
  label: string;
  /** Hostnames that identify this platform. Also used for auto-detection. */
  hostnames: string[];
  /** Aliases the agent may use when naming the platform. */
  aliases: string[];
  /**
   * Preferred composer URLs, tried in order. The first that loads is used.
   * These deep-link straight to an open composer where the platform supports it.
   */
  composeUrls: string[];
  /** Human-readable step to open the composer if no deep link worked. */
  manualSteps: string[];
  /** Whether the platform can publish a single video file. */
  supportsVideo: boolean;
  notes: string;
}

export const PLATFORM_RECIPES: PlatformRecipe[] = [
  {
    id: 'x',
    label: 'X (formerly Twitter)',
    hostnames: ['x.com', 'twitter.com'],
    aliases: ['x', 'twitter', 'tweet'],
    composeUrls: ['https://x.com/compose/post', 'https://twitter.com/compose/post'],
    manualSteps: [
      'Open https://x.com/compose/post',
      'If the composer did not open, click the "Post" button in the left sidebar.',
    ],
    supportsVideo: true,
    notes:
      'Media attaches to the dialog that opens from "Post". After attaching, wait for the media preview to render before submitting - uploading can take a while for long videos.',
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    hostnames: ['linkedin.com'],
    aliases: ['linkedin', 'li'],
    composeUrls: ['https://www.linkedin.com/feed/', 'https://www.linkedin.com/'],
    manualSteps: [
      'Open the LinkedIn feed.',
      'Click "Start a post" at the top of the feed to open the composer dialog.',
    ],
    supportsVideo: true,
    notes:
      'The post composer is a dialog opened from "Start a post". It may default to the document/idea tab - switch to the "Video" or "Media" tab before attaching a video. Native video upload is available; otherwise attach the file via the media icon.',
  },
  {
    id: 'reddit',
    label: 'Reddit',
    hostnames: ['reddit.com'],
    aliases: ['reddit'],
    composeUrls: ['https://www.reddit.com/submit', 'https://www.reddit.com/'],
    manualSteps: ['Open https://www.reddit.com/submit', 'Choose the correct subreddit before posting.'],
    supportsVideo: true,
    notes:
      'Reddit requires a subreddit and title. If the post box is a link post, switch to the "Text" (self post) tab, then open the "Images & Video" tab to attach media.',
  },
  {
    id: 'facebook',
    label: 'Facebook',
    hostnames: ['facebook.com', 'fb.com'],
    aliases: ['facebook', 'fb'],
    composeUrls: ['https://www.facebook.com/', 'https://m.facebook.com/'],
    manualSteps: ['Open facebook.com', 'Click "Create post" in the feed composer.'],
    supportsVideo: true,
    notes: 'The feed composer supports a single video. Longer videos may need to be a Reel.',
  },
  {
    id: 'instagram',
    label: 'Instagram',
    hostnames: ['instagram.com'],
    aliases: ['instagram', 'ig'],
    composeUrls: ['https://www.instagram.com/', 'https://www.instagram.com/accounts/your-feed/'],
    manualSteps: ['Open instagram.com', 'Click the "+" create button, then "Post".'],
    supportsVideo: true,
    notes:
      'Instagram web only accepts square or 4:5 media up to 60 minutes. Reels are vertical 9:16. A landscape desktop video may be rejected or need cropping.',
  },
  {
    id: 'threads',
    label: 'Threads',
    hostnames: ['threads.net'],
    aliases: ['threads'],
    composeUrls: ['https://www.threads.net/', 'https://www.threads.net/intent/post'],
    manualSteps: ['Open threads.net', 'Click the "Create" button to open the composer.'],
    supportsVideo: true,
    notes: 'Attach media from the composer toolbar before posting.',
  },
  {
    id: 'bluesky',
    label: 'Bluesky',
    hostnames: ['bsky.app', 'bsky.social'],
    aliases: ['bluesky', 'bsky'],
    composeUrls: ['https://bsky.app/', 'https://bsky.app/compose/post'],
    manualSteps: ['Open bsky.app', 'The composer is always open at the top of the home page.'],
    supportsVideo: true,
    notes: 'The composer is inline on the home page, not a dialog. The file input is inside it.',
  },
  {
    id: 'mastodon',
    label: 'Mastodon',
    hostnames: ['mastodon.social', 'mastodon.online', 'mstdn.social', 'hachyderm.io'],
    aliases: ['mastodon', 'masto'],
    composeUrls: ['https://mastodon.social/home', 'https://mastodon.social/'],
    manualSteps: ['Open your Mastodon home timeline', 'The composer is the "What is on your mind?" box.'],
    supportsVideo: true,
    notes:
      'Instance-specific, so hostnames vary. Video support and size limits depend on the instance. If no composer file input is found, the "Add media" button reveals one.',
  },
  {
    id: 'youtube',
    label: 'YouTube',
    hostnames: ['youtube.com', 'studio.youtube.com'],
    aliases: ['youtube', 'yt'],
    composeUrls: ['https://studio.youtube.com/', 'https://www.youtube.com/'],
    manualSteps: ['Open YouTube Studio', 'Click "Create" then "Upload videos".'],
    supportsVideo: true,
    notes:
      'YouTube Studio upload is a multi-step wizard (upload, details, checks, visibility) and a long processing wait. Uploading is not a single composer action.',
  },
  {
    id: 'pinterest',
    label: 'Pinterest',
    hostnames: ['pinterest.com'],
    aliases: ['pinterest', 'pin'],
    composeUrls: ['https://www.pinterest.com/pin/create/button/', 'https://www.pinterest.com/'],
    manualSteps: ['Open pinterest.com', 'Click the "+" create button.'],
    supportsVideo: true,
    notes: 'Pinterest requires a destination link alongside the media.',
  },
  {
    id: 'tumblr',
    label: 'Tumblr',
    hostnames: ['tumblr.com'],
    aliases: ['tumblr'],
    composeUrls: ['https://www.tumblr.com/', 'https://www.tumblr.com/compose'],
    manualSteps: ['Open tumblr.com', 'Click the post button to open the composer.'],
    supportsVideo: true,
    notes: 'The composer defaults to the "Photo" post type, which accepts video files.',
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    hostnames: ['tiktok.com'],
    aliases: ['tiktok'],
    composeUrls: ['https://www.tiktok.com/upload', 'https://www.tiktok.com/'],
    manualSteps: ['Open tiktok.com', 'Click "Upload" to post a video.'],
    supportsVideo: true,
    notes:
      'TikTok web upload supports a single video per post and is a multi-step wizard with a processing wait.',
  },
];

/** Look a platform up by id, label or alias. */
export function findPlatform(idOrAlias: string): PlatformRecipe | undefined {
  const needle = idOrAlias.trim().toLowerCase();
  if (!needle) return undefined;
  return PLATFORM_RECIPES.find(
    (p) => p.id === needle || p.aliases.includes(needle) || p.label.toLowerCase() === needle
  );
}

/** Detect the platform from the URL of the tab the agent is working in. */
export function resolvePlatformForUrl(url: string): PlatformRecipe | undefined {
  const lower = (url || '').toLowerCase();
  if (!lower) return undefined;
  return PLATFORM_RECIPES.find((p) => p.hostnames.some((h) => lower.includes(h)));
}

/** Every platform id, for tool schema enums and prompt text. */
export const SUPPORTED_PLATFORM_IDS = PLATFORM_RECIPES.map((p) => p.id);

/** Compact catalogue for the agent prompt. */
export function describePlatforms(): string {
  return PLATFORM_RECIPES.map((p) => `- ${p.id} (${p.label}): ${p.composeUrls[0]}`).join('\n');
}

export interface OpenComposerResult {
  success: boolean;
  message: string;
  url?: string;
  platformId?: SocialPlatformId;
  /** The agent should do these when the deep link did not open a composer. */
  fallbackSteps?: string[];
}

/**
 * Open a platform's composer, preferring a deep link. Reports honest failure so
 * the agent can fall back to the manual steps instead of silently continuing on
 * the home page.
 */
export async function openPlatformComposer(
  platform: PlatformRecipe,
  opts: { tabId?: number; waitMs?: number } = {}
): Promise<OpenComposerResult> {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    return {
      success: false,
      message: 'Chrome extension APIs are unavailable in this context.',
      fallbackSteps: platform.manualSteps,
    };
  }

  const fallbackSteps = platform.manualSteps;
  const url = platform.composeUrls[0];

  try {
    if (opts.tabId) {
      await chrome.tabs.update(opts.tabId, { url });
      await waitForTabComplete(opts.tabId, opts.waitMs ?? 15000);
    } else {
      const tab = await chrome.tabs.create({ url, active: true });
      if (tab?.id) await waitForTabComplete(tab.id, opts.waitMs ?? 15000);
    }

    return {
      success: true,
      message: `Opened the ${platform.label} composer at ${url}. If the composer is not on screen, ${platform.manualSteps.join(' ')}`,
      url,
      platformId: platform.id,
      fallbackSteps,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Could not open ${platform.label} automatically (${err?.message || err}). ${platform.manualSteps.join(' ')}`,
      fallbackSteps,
    };
  }
}

/** Poll a tab until it finishes loading, so we do not inject into a blank page. */
function waitForTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        chrome.tabs.onUpdated.removeListener(listener);
      } catch {
        /* noop */
      }
      resolve();
    };

    const listener = (id: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') finish();
    };

    const timer = setTimeout(finish, timeoutMs);
    try {
      chrome.tabs.onUpdated.addListener(listener);
    } catch {
      /* noop */
    }

    // If it already finished loading we would wait for the timeout, so probe.
    try {
      chrome.tabs.get(tabId, (tab) => {
        if (tab && tab.status === 'complete') finish();
      });
    } catch {
      finish();
    }
  });
}
