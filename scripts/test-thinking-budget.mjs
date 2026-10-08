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
  plugins: [{ name: 'worker-url', setup(builder) {
    builder.onResolve({ filter: /pdf\.worker\.min\.mjs\?url$/ }, () => ({ path: 'worker', namespace: 'worker-url' }));
    builder.onLoad({ filter: /.*/, namespace: 'worker-url' }, () => ({ contents: 'export default "";' }));
  } }],
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
  const turns = [];
  let idleResolvers = [];
  const h = new FormAgentHarness({ selectedMode: 'free', free: {} }, [], {
    onError: (e) => errors.push(e),
    onStatusChange: (busy) => status.push(busy),
    onTurnComplete: (text, tools, thinking) => turns.push({ text, tools, thinking }),
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
    turns,
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

{
  // 17. Acting earns the retry budget back. The cap exists to stop a loop of
  // cut -> resume -> cut with nothing to show for it, not to punish a long
  // productive run - a real session had 4 watchdog cuts but 6 successful tool
  // calls, and the 4th cut exhausted the budget and killed a healthy task.
  const { h, prompts, errors, settle } = makeHarness();
  const cut = async () => {
    h.handleAgentEvent({ type: 'turn_start' });
    think(h, BUDGET + 500);
    h.handleAgentEvent({ type: 'turn_end' });
    await settle();
  };
  await cut();
  await cut();
  await cut();
  check('three actionless cuts spend the whole retry budget', prompts.length === 3, String(prompts.length));

  // A tool call lands: the run is alive and making progress.
  h.handleAgentEvent({ type: 'turn_start' });
  h.handleAgentEvent({
    type: 'message_update',
    assistantMessageEvent: { type: 'toolcall_start', contentIndex: 0, partial: { content: [] } },
  });
  h.handleAgentEvent({ type: 'tool_execution_end', toolCallId: 't1' });
  h.handleAgentEvent({ type: 'turn_end' });
  await settle();
  check('a finished tool call does not burn a retry', prompts.length === 3, String(prompts.length));

  await cut();
  check('and progress earns the retry budget back', prompts.length === 4, String(prompts.length));
  check('with the same act-now directive as before', prompts[3] === FormAgentHarness.ACT_NOW_DIRECTIVE);
  check('and the productive run never sees a give-up', errors.length === 0, errors.join(' | '));
}

{
  // 18. When the retries are gone the run must stop honestly. The stream
  // adapter's abort text says "Agent interrupted." but the user interrupted
  // nothing - the watchdog cut the turn - so the harness must replace it.
  const { h, prompts, errors, turns, settle } = makeHarness();
  const giveUp = FormAgentHarness.RAMBLING_GIVE_UP_MESSAGE;
  check('a rambling give-up message exists', typeof giveUp === 'string' && giveUp.length > 0);
  check('and it never claims the user interrupted', !/cancel|abort|interrupt/i.test(giveUp), giveUp);

  for (let i = 0; i < 4; i++) {
    h.handleAgentEvent({ type: 'turn_start' });
    think(h, BUDGET + 500);
    // The exact shape a real cut produces: the stream adapter's abort message.
    h.handleAgentEvent({
      type: 'turn_end',
      message: { errorMessage: 'Agent interrupted. Type continue to resume.' },
    });
    await settle();
  }
  check('a rambling loop gets exactly the retry budget', prompts.length === 3, String(prompts.length));
  check('and then stops instead of looping forever', prompts.length === 3);
  check(
    'the stop is reported with the honest message',
    errors.some((e) => e === giveUp),
    errors.join(' | ')
  );
  check('and the misleading interrupt text is never shown', !errors.some((e) => /interrupt/i.test(e)), errors.join(' | '));
  check('the give-up turn still finalizes for the UI', turns.length === 1, String(turns.length));
}

{
  // 19. The canvas-editing prompt must never tell the model to wake the editor
  // with a caret-moving key. That advice sent Home/End into a Google Doc, and
  // the keypresses on those keys typed "$" and "#" into the document.
  const { h } = makeHarness();
  const prompt = h.buildSystemPrompt();
  check('the system prompt builds', typeof prompt === 'string' && prompt.length > 0);
  check(
    'it never points the agent at Home/End to focus an editor',
    !/press(ing)?\s+["']?(Home|End)\b/i.test(prompt) &&
      !/key:\s*["'](Home|End)["']/i.test(prompt) &&
      !/navigation key/i.test(prompt),
    (prompt.match(/.{0,40}(press(ing)?\s+["']?(Home|End)|key:\s*["'](Home|End)|navigation key).{0,40}/i) || [])[0] ||
      'clean'
  );
  check(
    'it tells the agent that type_text primes focus itself',
    /primes editor focus itself/i.test(prompt)
  );
  check(
    'and to click precisely instead of mashing keys',
    /never mash keys/i.test(prompt) && /click again/i.test(prompt)
  );
  check(
    'it warns that a gap between headings is paragraph spacing, not a blank line',
    /Paragraph spacing is not a blank line/i.test(prompt)
  );
  check(
    'and forbids Backspace/Enter as a way to "remove the gap"',
    /Do not join\/split lines to fix it/i.test(prompt)
  );
  check(
    'it demands a complete formatted clone and verifies all new text',
    /heading through final bullet/i.test(prompt) && /Verify all new text, formatting, placement/i.test(prompt)
  );
}

/** Fire one finished tool call, the shape the harness sees from a real run. */
function finishTool(h, id, toolName, args) {
  h.handleAgentEvent({ type: 'tool_execution_start', toolCallId: id, toolName, args });
  h.handleAgentEvent({ type: 'tool_execution_end', toolCallId: id, toolName, args });
}

{
  // 20. A Backspace/Enter oscillation must be cut. A real run joined two
  // heading-styled lines and re-split them for ~13 minutes: the gap between
  // them was paragraph spacing, not a blank line. Every keypress is a tool
  // call, so tool_execution_end refills the shared retry budget and nothing
  // else could stop the loop - the user had to.
  const { h, aborts, prompts, errors, settle } = makeHarness();
  const key = (k, extra = {}, id = `k${Math.random()}`) =>
    finishTool(h, id, 'press_key_combination', { key: k, ...extra });

  // Ordinary editing must not trip it: deleting a word, adding blank lines.
  h.handleAgentEvent({ type: 'turn_start' });
  for (let i = 0; i < 5; i++) key('Backspace');
  for (let i = 0; i < 5; i++) key('Enter');
  check('runs of one edit key are ordinary editing', h.editLoopTripped === false);
  check('and never abort a healthy edit', aborts() === 0, String(aborts()));

  // Modifier combos are commands (Ctrl+Z, Ctrl+B), not line-break thrash.
  key('z', { ctrlKey: true });
  key('b', { ctrlKey: true });
  check('modifier combos are not counted as the loop', h.editLoopTripped === false);

  // Screenshot/click between the keys is exactly the real loop's shape. A
  // content edit first, so this phase counts its own pairs.
  finishTool(h, 'type0', 'type_text', { text: 'Novum — Suite' });
  h.handleAgentEvent({ type: 'turn_start' });
  key('Backspace');
  finishTool(h, 'shot1', 'capture_tab_screenshot', {});
  key('Enter');
  check('one join/split pair is a mistake, not a loop', h.editLoopTripped === false);
  finishTool(h, 'click1', 'click_at_position', { x: 1, y: 1 });
  key('Backspace');
  key('Enter');
  check('two join/split pairs are still tolerated', h.editLoopTripped === false);
  key('Backspace');
  key('Enter');
  check('the third join/split pair trips the guard', h.editLoopTripped === true);
  check('and aborts the stream exactly once', aborts() === 1, String(aborts()));

  h.handleAgentEvent({ type: 'turn_end' });
  await settle();
  check('the steer names the mistake, not a bare continue', prompts.length === 1);
  check('with the edit-loop directive', prompts[0] === FormAgentHarness.EDIT_LOOP_DIRECTIVE);
  check('and the directive explains the gap is spacing', /paragraph spacing, not an empty line/i.test(prompts[0]));
  check('and forbids the key pair', /Do not press Backspace or Enter/i.test(prompts[0]));
  check('a steered turn reports no error to the user', errors.length === 0, errors.join(' | '));
}

{
  // 21. Typing between the key pairs is real progress and clears the pattern.
  const { h, aborts } = makeHarness();
  const key = (k, id = `k${Math.random()}`) =>
    finishTool(h, id, 'press_key_combination', { key: k });

  h.handleAgentEvent({ type: 'turn_start' });
  key('Backspace');
  key('Enter');
  key('Backspace');
  key('Enter');
  finishTool(h, 'type1', 'type_text', { text: 'Technologies: Rust, Tauri.' });
  key('Backspace');
  key('Enter');
  key('Backspace');
  key('Enter');
  check('content edits reset the oscillation window', h.editLoopTripped === false);
  check('so a productive run is never cut', aborts() === 0, String(aborts()));
}

{
  // 22. When the steers run out the run must stop honestly, same contract as
  // the rambling give-up: never "Agent interrupted", never blame the user.
  const { h, prompts, errors, turns, settle } = makeHarness();
  const giveUp = FormAgentHarness.EDIT_LOOP_GIVE_UP_MESSAGE;
  check('an edit-loop give-up message exists', typeof giveUp === 'string' && giveUp.length > 0);
  check('and it never claims the user interrupted', !/interrupt/i.test(giveUp), giveUp);

  const key = (k, id = `k${Math.random()}`) =>
    finishTool(h, id, 'press_key_combination', { key: k });
  for (let round = 0; round < 3; round++) {
    h.handleAgentEvent({ type: 'turn_start' });
    for (let i = 0; i < 3; i++) {
      key('Backspace');
      key('Enter');
    }
    // The exact shape a real cut produces: the stream adapter's abort message.
    h.handleAgentEvent({
      type: 'turn_end',
      message: { errorMessage: 'Agent interrupted. Type continue to resume.' },
    });
    await settle();
  }
  check('the loop gets exactly its own steer budget', prompts.length === 2, String(prompts.length));
  check('and then stops instead of looping forever', prompts.length === 2);
  check(
    'the stop is reported with the honest message',
    errors.some((e) => e === giveUp),
    errors.join(' | ')
  );
  check('and the misleading interrupt text is never shown', !errors.some((e) => /interrupt/i.test(e)), errors.join(' | '));
  check('the give-up turn still finalizes for the UI', turns.length === 1, String(turns.length));
}

{
  // 23. The edit-loop guard has its own budget precisely because the shared one
  // cannot hold: tool_execution_end refills autoResumeCount on every keypress.
  const { h, prompts, settle } = makeHarness();
  const key = (k, id = `k${Math.random()}`) =>
    finishTool(h, id, 'press_key_combination', { key: k });

  // Burn the shared budget, then prove a tool call (a keypress!) refills it -
  // which is why the loop never starved the old guards.
  h.handleAgentEvent({ type: 'turn_start' });
  for (let i = 0; i < 3; i++) {
    key('Backspace');
    key('Enter');
    key('Backspace');
    key('Enter');
    key('Backspace');
    key('Enter');
    h.handleAgentEvent({ type: 'turn_end' });
    await settle();
  }
  check('a keypress loop still exhausts its own budget', prompts.length === 2, String(prompts.length));
  check('and does not borrow from the shared one', h.editLoopResumeCount >= FormAgentHarness.MAX_EDIT_LOOP_RESUMES);
}

rmSync(outPath, { force: true });
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
