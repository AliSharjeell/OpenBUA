// Self-contained so Chrome can serialize this reader into the active page.
export async function inPageReadYouTubeVideos() {
  const read = () => {
    const videos: Array<{ title: string; url: string; channel: string }> = [];
    const seen = new Set<string>();
    for (const card of Array.from(document.querySelectorAll('ytd-video-renderer,ytd-grid-video-renderer,ytd-rich-item-renderer'))) {
      if (!(card as HTMLElement).getClientRects().length) continue;
      const links = Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href]'));
      const link = links.find(a => /video-title/.test(a.id)) || links.find(a => /\/watch\?/.test(a.getAttribute('href') || ''));
      if (!link) continue;
      const url = new URL(link.href, location.href);
      const id = url.searchParams.get('v');
      if (url.hostname !== 'www.youtube.com' || url.pathname !== '/watch' || !id || seen.has(id)) continue;
      const title = (link.getAttribute('title') || link.textContent || link.getAttribute('aria-label') || '').trim();
      if (!title) continue;
      seen.add(id);
      videos.push({ title, url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`, channel: (card.querySelector('ytd-channel-name')?.textContent || '').trim() });
      if (videos.length === 10) break;
    }
    return videos;
  };
  const deadline = Date.now() + 4000;
  let videos = read();
  while (!videos.length && Date.now() < deadline && !location.pathname.startsWith('/watch')) {
    await new Promise(resolve => setTimeout(resolve, 200));
    videos = read();
  }
  return { url: location.href, pageType: location.pathname === '/watch' ? 'watch' : location.pathname === '/results' ? 'search' : 'channel', videos,
    message: videos.length ? 'Videos are in displayed order. Open videos[0].url for the first video. Channel avatars and tabs are not videos.' : 'No regular video links found yet. Inspect page content once; do not guess coordinates or repeatedly wait.' };
}
