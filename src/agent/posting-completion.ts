// Publication evidence is separate from preparing a draft or dispatching a click.
export class PostingCompletion {
  requested = false;
  state = '';
  message = '';
  retries = 0;
  url = '';
  begin(request: string) {
    if (!/^(?:continue|resume|try again|keep going)[.!\s]*$/i.test(request)) this.requested = /\b(post|publish|submit)\b/i.test(request) && !/\b(?:draft only|do not post|don't post|do not publish)\b/i.test(request);
    this.retries = 0;
  }
  observe(tool: string, details: any) {
    if (tool === 'prepare_reddit_post' && details?.success) {
      this.state = 'draft'; this.message = 'A draft was prepared; publication has not been verified.';
    }
    if (['submit_reddit_post', 'verify_reddit_post'].includes(tool)) {
      this.state = details?.postVerified === true && details?.state === 'posted' ? 'posted' : details?.state || 'unconfirmed';
      this.message = details?.message || 'Publication has not been verified.';
      this.url = details?.url || '';
    }
  }
  needsRecovery(text: string) {
    return this.requested && this.state && this.state !== 'posted' &&
      /^(?:done|all done|all set|finished|completed|posted|published|success)[.!\s]*$/i.test(text.trim());
  }
  directive() {
    return `SYSTEM: Your "Done" response was rejected: no verified published post exists for the current draft. Last observed state: ${this.state}. ${this.message} Resolve the actual visible requirement using the exact dialog controls. Optional tags without flair choices are not a required flair; close with Cancel rather than searching for nonexistent options. If a Post click was already dispatched and is unconfirmed, use verify_reddit_post, never re-click Post. If blocked by rules, removal, CAPTCHA, sign-in or cooldown, report the blocker and remaining work accurately. Continue the authorized task if it is possible; do not claim a draft or a single destination completes the entire campaign.`;
  }
  report(text: string) {
    if (!this.requested || !this.state || this.state === 'posted') return text;
    if (this.needsRecovery(text) || /\b(?:successfully (?:posted|published)|(?:posted|published) (?:both|all|the post))\b/i.test(text)) {
      return `The post has not been confirmed as published. ${this.message}${this.url ? `\nCurrent page: ${this.url}` : ''}\nThe posting task is incomplete.`;
    }
    return text;
  }
}
