import assert from 'node:assert/strict';
import { build } from 'esbuild';
const { chromium } = await import(process.env.OPENBUA_PLAYWRIGHT_MODULE || 'playwright');
const output = await build({ entryPoints: ['src/agent/youtube-page.ts'], bundle: true, platform: 'browser', format: 'iife', globalName: 'YouTubeReader', write: false, logLevel: 'error' });
const browser = await chromium.launch({ headless: true, ...(process.env.OPENBUA_CHROME_PATH ? { executablePath: process.env.OPENBUA_CHROME_PATH } : {}) });
try {
  const page = await browser.newPage();
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: '<body></body>' }));
  await page.goto('https://www.youtube.com/results?search_query=mufeez');
  await page.addScriptTag({ content: output.outputFiles[0].text });
  await page.setContent(`<ytd-channel-renderer><a href="/@mufeezperspective">Mufeez Perspective</a></ytd-channel-renderer>
    <ytd-video-renderer><a id="video-title" href="/watch?v=first-video">First actual video</a><ytd-channel-name>Mufeez Perspective</ytd-channel-name><a href="/watch?v=first-video">Thumbnail</a></ytd-video-renderer>
    <ytd-video-renderer><a id="video-title" href="/playlist?list=PL123">Playlist</a></ytd-video-renderer>
    <ytd-video-renderer><a id="video-title" href="/watch?v=second-video">Second actual video</a></ytd-video-renderer>
    <ytd-video-renderer style="display:none"><a id="video-title" href="/watch?v=hidden">Hidden</a></ytd-video-renderer>`);
  const read = () => page.evaluate(() => new Function('return (' + YouTubeReader.inPageReadYouTubeVideos.toString() + ')')()());
  const result = await read();
  assert.equal(result.pageType, 'search'); assert.deepEqual(result.videos.map(video => video.title), ['First actual video', 'Second actual video']);
  assert.equal(result.videos[0].url, 'https://www.youtube.com/watch?v=first-video');
  await page.goto('https://www.youtube.com/@mufeezperspective/videos');
  await page.addScriptTag({ content: output.outputFiles[0].text });
  await page.evaluate(() => { setTimeout(() => { document.body.innerHTML = '<ytd-rich-item-renderer><a id="video-title-link" href="/watch?v=channel-video" title="Channel first video">First</a></ytd-rich-item-renderer>'; }, 250); });
  const channel = await read(); assert.equal(channel.pageType, 'channel'); assert.equal(channel.videos[0].title, 'Channel first video');
  console.log('PASS serialized YouTube reader: skips avatars, playlists and hidden cards, preserves order and watch URLs, waits for asynchronously loaded channel videos');
} finally { await browser.close(); }
