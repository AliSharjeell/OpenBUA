// Tests the thinking watchdog that form-agent.ts installs.
//
// The prompt forbids long deliberation. The model ignored it: a real run burned
// 3m 23s of "Thought for" reasoning about how Google Docs inherits bold and list
// styles before making any call, and the user stopped it. A prompt rule is advice,
// not a limit, so the harness now cuts the stream once a turn has spent its
// thinking budget without acting, and resumes with an act-now directive.
//
// This drives the real harness with synthetic agent events, which is the only
// way to prove the counter resets on a tool call and trips only on real overrun.
import { build } from 'esbuild';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
// Emitted inside the repo so Node can resolve node_modules for the external agent core.
const outPath = join(repoRoot, '.tmp-harness-test.mjs');

const compiled = await build({
  entryPoints: [`${repoRoot}src/agent/form-agent.ts`],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  logLevel: 'silent',
  // The agent core is only needed to run a real turn, which this test does not
  // do; it drives the harness event handler directly.
  external: ['@earendil-works/*', 'pdfjs-dist'],
});
writeFileSync(outPath, compiled.outputFiles[0].text, 'utf8');

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures++;
}

const mod = await import(pathToFileURL(outPath).href);
const FormAgentHarness = mod.FormAgentHarness;
check('FormAgentHarness is exported', typeof FormAgentHarness === 'function');

const BUDGET = FormAgentHarness.THINKING_BUDGET_PER_TURN;
check('a thinking budget is defined', typeof BUDGET === 'number' && BUDGET > 0, String(BUDGET));
check('budget is small enough to cut a 3-minute spiral', BUDGET <= 4000, `${BUDGET} chars`);

/** Build a harness with a stub agent so abort()/prompt() are observable and harmless. */
function makeHarness() {
  let aborts = 0;
  const prompts = [];
  const errors = [];
  const status = [];
  let idleResolvers = [];
  const h = new FormAgentHarness({ selectedMode: 'free', free: {} }, [], {
    onError: (e) => errors.push(e),
    onStatusChange: (busy) => status.push(busy),
  }, [], 'test');
  h.agent = {
    abort: () => {
      aborts += 1;
    },
    // The real one resolves only once the run has settled; hold it open until
    // the test says otherwise so "resumes too early" is detectable.
    waitForIdle: () =>
      new Promise((resolve) => {
        idleResolvers.push(resolve);
      }),
    prompt: async (msg) => {
      prompts.push(msg);
    },
    continue: async () => {
      throw new Error('Cannot continue from message role: assistant');
    },
    state: { messages: [] },
  };
  return {
    h,
    aborts: () => aborts,
    prompts,
    errors,
    status,
    /** Let the stubbed run settle, then give the resume a turn to act. */
    settle: async () => {
      const resolvers = idleResolvers;
      idleResolvers = [];
      for (const r of resolvers) r();
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

/** Feed thinking_delta events of `chars` total length into one turn. */
function think(h, chars, chunk = 400) {
  for (let sent = 0; sent < chars; sent += chunk) {
    h.handleAgentEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', delta: 'x'.repeat(Math.min(chunk, chars - sent)) },
    });
  }
}

{
  // 1. Ordinary thinking must not trip the guard.
  const { h, aborts } = makeHarness();
  h.handleAgentEvent({ type: 'turn_start' });
  think(h, Math.floor(BUDGET * 0.5));
  check('thinking under budget does not trip the watchdog', h.thinkingBudgetTripped === false);
  check('and does not abort the stream', aborts() === 0, String(aborts()));
}

{
  // 2. Overrunning the budget must trip it and abort the stream.
  const { h, aborts } = makeHarness();
  h.handleAgentEvent({ type: 'turn_start' });
  think(h, BUDGET + 500);
  check('thinking over budget trips the watchdog', h.thinkingBudgetTripped === true);
  check('and aborts the stream exactly once', aborts() === 1, String(aborts()));
}

{
  // 3. The guard must not re-fire repeatedly while deltas keep arriving.
  const { h, aborts } = makeHarness();
  h.handleAgentEvent({ type: 'turn_start' });
  think(h, BUDGET + 500);
  think(h, BUDGET + 500);
  check('the watchdog fires only once per turn', aborts() === 1, String(aborts()));
}

{
  // 4. A tool call refills the budget, so long multi-step tasks are not punished.
  const { h, aborts } = makeHarness();
  h.handleAgentEvent({ type: 'turn_start' });
  think(h, BUDGET - 100);
  h.handleAgentEvent({
    type: 'message_update',
    assistantMessageEvent: { type: 'toolcall_start', contentIndex: 0, partial: { content: [] } },
  });
  think(h, BUDGET - 100);
  check('a tool call resets the thinking budget', h.thinkingBudgetTripped === false);
  check('and never aborts across several deliberate steps', aborts() === 0, String(aborts()));
}

{
  // 5. Each new turn gets a fresh budget.
  const { h } = makeHarness();
  h.handleAgentEvent({ type: 'turn_start' });
  think(h, BUDGET + 500);
  check('turn 1 trips', h.thinkingBudgetTripped === true);
  h.handleAgentEvent({ type: 'turn_start' });
  check('a new turn clears the tripped flag', h.thinkingBudgetTripped === false);
  think(h, BUDGET - 100);
  check('and a fresh budget applies to the new turn', h.thinkingBudgetTripped === false);
}

{
  // 6. The resume must tell the model to act, not just continue.
  const directive = FormAgentHarness.ACT_NOW_DIRECTIVE;
  check('an act-now directive exists', typeof directive === 'string' && directive.length > 0);
  check('the directive demands a tool call', /MUST be a tool call/i.test(directive), directive);
  check('the directive forbids more deliberation', /Do not deliberate/i.test(directive));
  check('the directive tells it to stop guessing at formatting', /tool that changes it|stop guessing/i.test(directive));
}

{
  // 7. A user pressing stop must never trigger the watchdog resume.
  const { h } = makeHarness();
  h.handleAgentEvent({ type: 'turn_start' });
  h.userAborted = true;
  think(h, BUDGET + 500);
  check('the watchdog still trips internally', h.thinkingBudgetTripped === true);
  h.handleAgentEvent({ type: 'turn_end' });
  check('but a user abort clears the flag instead of auto-resuming', h.thinkingBudgetTripped === false);
}

{
  // 8. A watchdog resume must wait for the run to settle before prompting.
  // This is the exact failure from a real session: turn_end fires while the run
  // is still active, prompt() throws "Agent is already processing a prompt",
  // and the user was told "Please type continue." by hand.
  const { h, prompts, settle } = makeHarness();
  h.handleAgentEvent({ type: 'turn_start' });
  think(h, BUDGET + 500);
  h.handleAgentEvent({ type: 'turn_end' });
  check('resume does not prompt while the run is still active', prompts.length === 0);
  await settle();
  check('resume prompts once the agent is idle', prompts.length === 1, String(prompts.length));
  check('and it sends the act-now directive', prompts[0] === FormAgentHarness.ACT_NOW_DIRECTIVE);
}

{
  // 9. A user pressing stop while the resume waits must cancel the resume.
  const { h, prompts, settle } = makeHarness();
  h.handleAgentEvent({ type: 'turn_start' });
  think(h, BUDGET + 500);
  h.handleAgentEvent({ type: 'turn_end' });
  h.userAborted = true;
  await settle();
  check('a stop during the settle window suppresses the resume', prompts.length === 0);
}

{
  // 10. A turn that only planned is resumed with a directive too - and with
  // prompt(), not continue(), which refuses to continue from an assistant turn.
  const { h, prompts, settle } = makeHarness();
  h.handleAgentEvent({ type: 'turn_start' });
  think(h, 200);
  h.handleAgentEvent({ type: 'turn_end' });
  await settle();
  check('a stalled turn auto-resumes', prompts.length === 1, String(prompts.length));
  check('with the resume directive', prompts[0] === FormAgentHarness.RESUME_DIRECTIVE);
}

{
  // 11. A provider-side abort is recoverable the same way.
  const { h, prompts, errors, settle } = makeHarness();
  h.handleAgentEvent({ type: 'turn_start' });
  h.handleAgentEvent({ type: 'turn_end', message: { errorMessage: 'rate limited' } });
  await settle();
  check('a provider abort auto-resumes with a directive', prompts.length === 1);
  check('and never surfaces "Please type continue" to the user', !errors.some((e) => /Please type continue/.test(e)), errors.join(' | '));
}

{
  // 12. If the resume itself is refused, the user gets one clear error.
  const { h, prompts, errors, settle } = makeHarness();
  h.agent.prompt = async () => {
    throw new Error('Agent is already processing a prompt.');
  };
  h.handleAgentEvent({ type: 'turn_start' });
  think(h, BUDGET + 500);
  h.handleAgentEvent({ type: 'turn_end' });
  await settle();
  check('a failed resume reports it could not resume', errors.some((e) => /Could not resume automatically/.test(e)), errors.join(' | '));
}

{
  // 13. The stall path must not fire when the user pressed stop.
  const { h, prompts, settle } = makeHarness();
  h.handleAgentEvent({ type: 'turn_start' });
  think(h, 200);
  h.userAborted = true;
  h.handleAgentEvent({ type: 'turn_end' });
  await settle();
  check('a user abort never auto-resumes a stalled turn', prompts.length === 0);
}

{
  // 14. A duplicated turn_end must not queue two resumes that race each other
  // into "Agent is already processing a prompt".
  const { h, prompts, settle } = makeHarness();
  h.handleAgentEvent({ type: 'turn_start' });
  think(h, 200); // under budget, no tools, no text: a stalled turn
  h.handleAgentEvent({ type: 'turn_end' });
  h.handleAgentEvent({ type: 'turn_end' });
  await settle();
  check('a duplicated turn_end queues exactly one resume', prompts.length === 1, String(prompts.length));
}

{
  // 15. A user message arriving while the resume waits must win: their turn
  // will do the work, the act-now directive is stale.
  const { h, prompts, settle } = makeHarness();
  h.handleAgentEvent({ type: 'turn_start' });
  think(h, BUDGET + 500);
  h.handleAgentEvent({ type: 'turn_end' });
  h.userPromptInFlight = true; // what prompt() sets the moment the user sends
  await settle();
  check('an auto-resume stands down for a user message in flight', prompts.length === 0);
}

{
  // 16. Same for a user who took over while the resume was waiting.
  const { h, prompts, settle } = makeHarness();
  h.handleAgentEvent({ type: 'turn_start' });
  think(h, BUDGET + 500);
  h.handleAgentEvent({ type: 'turn_end' });
  h.resumeEpoch += 1; // what prompt()/abort()/reset() bump on takeover
  await settle();
  check('an auto-resume stands down once the user has taken over', prompts.length === 0);
}

rmSync(outPath, { force: true });
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
