import assert from 'node:assert/strict';
const { chromium } = await import(process.env.OPENBUA_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.OPENBUA_CHROME_PATH ? { executablePath: process.env.OPENBUA_CHROME_PATH } : {}) });
const page = await browser.newPage();
try {
  await page.goto('http://127.0.0.1:5173/test-form.html');
  const checks = await page.evaluate(async () => {
    const mod = await import('/src/agent/reddit-review.ts');
    const draft = { url: 'https://www.reddit.com/r/test/submit/', values: { title: '[Chrome/Web, Beta] Feedback on browser automation', body: 'Try my beta at https://openbua.com\n\nSo far: 23 interviews. $10K MRR.' } };
    const rules = { community: 'test', source: 'https://www.reddit.com/r/test/about/rules.json', state: 'empty', rules: [], guidance: 'Tag platform/stage. Ready to test products only.' };
    const review = mod.assessRedditDraft(draft, rules, []);
    const unavailable = mod.assessRedditDraft(draft, { ...rules, state: 'unavailable' }, []);
    const wrongCommunity = mod.assessRedditDraft(draft, { ...rules, community: 'other' }, []);
    const duplicate = mod.assessRedditDraft(draft, rules, [{ draft, state: 'posted', url: 'https://www.reddit.com/r/other/comments/123/post/' }]);
    const removed = mod.assessRedditDraft(draft, rules, [{ draft: { ...draft, values: { title: 'Different', body: 'Different' } }, state: 'removed', url: 'https://www.reddit.com/r/test/comments/456/post/' }]);
    window.chrome = { tabs: { query: (_q, cb) => cb([{ id: 7, url: draft.url }]) }, scripting: { executeScript: async injection => {
      if (!injection.args) return [{ result: draft }];
      return [{ result: { source: rules.source, rules: [], guidance: rules.guidance } }];
    } } };
    const liveReview = await mod.reviewRedditDraft(7);
    const tools = await import('/src/agent/tools.ts');
    const tool = await tools.reviewRedditPostTool.execute('review', {});
    mod.recordRedditOutcome(draft, 'removed', 'https://www.reddit.com/r/test/comments/removed/post/');
    const blockedReview = await mod.reviewRedditDraft(7);
    return { review, unavailable, wrongCommunity, duplicate, removed, liveReview, tool: tool.details, blockedReview,
      exactBlock: mod.redditDraftReviewBlocker(7, draft), changedBlock: mod.redditDraftReviewBlocker(7, { ...draft, values: { title: 'Different', body: 'Different' } }), batchBlock: mod.redditRemovalBlocker() };
  });
  assert.equal(checks.review.state, 'needs_review', 'empty custom rules is a completed lookup, not posting approval');
  assert.equal(checks.review.blockers.length, 0);
  assert.equal(checks.review.rules.guidance, 'Tag platform/stage. Ready to test products only.');
  assert.equal(checks.review.warnings.length, 2, 'links and financial/outcome claims need review');
  assert.match(checks.review.checks.join(' '), /self-promotion.*flair/);
  assert.equal(checks.unavailable.state, 'blocked'); assert.equal(checks.wrongCommunity.state, 'blocked');
  assert.match(checks.duplicate.blockers.join(' '), /already submitted/);
  assert.match(checks.removed.blockers.join(' '), /stopped/);
  assert.equal(checks.liveReview.state, 'needs_review'); assert.equal(checks.tool.state, 'needs_review');
  assert.equal(checks.blockedReview.state, 'blocked'); assert.ok(checks.exactBlock); assert.equal(checks.changedBlock, null);
  assert.match(checks.batchBlock, /does not establish an account restriction/);
  console.log('PASS Reddit pre-post checklist, rules availability/destination, claim/link warnings, duplicate and removal blockers, exact draft review and task removal stop');
} finally { await browser.close(); }
