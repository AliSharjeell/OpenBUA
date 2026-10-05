// Integration test: FormAgentHarness against a real pi-agent-core Agent run.
//
// The unit tests in test-thinking-budget.mjs stub the agent, so they cannot see
// pi-agent-core's run lifecycle - which is where the real bug lived. turn_end
// fires while the run is still active (activeRun is cleared only in finishRun),
// so a resume issued from turn_end was rejected with "Agent is already
// processing a prompt" and the user saw "Please type continue." by hand.
//
// This drives the real thing: a scripted model streams thinking until the
// harness watchdog cuts it off, and the harness must resume on its own with the
// act-now directive - proven by the stream being invoked a second time and by
// no "already processing" error ever surfacing.
import { build } from 'esbuild';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { Agent } from '@earendil-works/pi-agent-core';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const outPath = join(repoRoot, '.tmp-harness-test.mjs');

const compiled = await build({
  entryPoints: [`${repoRoot}src/agent/form-agent.ts`],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  logLevel: 'silent',
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait for `cond`, polling; false on timeout. */
async function until(cond, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await sleep(10);
  }
  return cond();
}

/**
 * A model that behaves like the failure in the field: run 1 deliberates in
 * thinking forever (so the harness watchdog aborts it mid-stream), and any
 * later run answers with text. Records invocations and the transcript each run
 * saw, so a working auto-resume is observable as a second call that carries the
 * act-now directive.
 */
function scriptedStreamFn(counter) {
  return (_model, context, opts) => {
    counter.calls += 1;
    const call = counter.calls;
    counter.contexts.push(context);
    const signal = opts?.signal;
    const stream = createAssistantMessageEventStream();

    const partial = {
      role: 'assistant',
      content: [],
      api: 'openai-completions',
      provider: 'test',
      model: 'test-model',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      stopReason: 'stop',
      timestamp: Date.now(),
    };

    void (async () => {
      stream.push({ type: 'start', partial });

      if (call >= 2) {
        // Keep the retry open long enough to observe the previous request's
        // finally block and agent_end without allowing either to hide Stop.
        await sleep(40);
        // The resumed turn: act immediately, like the directive demands.
        const text = 'Adding the project entry now.';
        partial.content = [{ type: 'text', text }];
        stream.push({ type: 'text_start', contentIndex: 0, partial });
        stream.push({ type: 'text_delta', contentIndex: 0, delta: text, partial });
        stream.push({ type: 'text_end', contentIndex: 0, content: text, partial });
        stream.push({ type: 'done', reason: 'stop', message: partial });
        stream.end(partial);
        return;
      }

      // First turn: think and think, until the watchdog aborts us.
      let thought = '';
      partial.content = [{ type: 'thinking', thinking: '' }];
      stream.push({ type: 'thinking_start', contentIndex: 0, partial });
      while (thought.length < 30000) {
        if (signal?.aborted) {
          counter.firstRunAbortedAt = thought.length;
          const aborted = {
            ...partial,
            content: [{ type: 'thinking', thinking: thought }],
            stopReason: 'aborted',
            errorMessage: 'Agent interrupted.',
          };
          // Same shape the real stream adapter uses on abort.
          stream.push({ type: 'error', reason: 'aborted', error: aborted });
          stream.end(aborted);
          return;
        }
        const delta = 'x'.repeat(400);
        thought += delta;
        partial.content = [{ type: 'thinking', thinking: thought }];
        stream.push({ type: 'thinking_delta', contentIndex: 0, delta, partial });
        await sleep(5);
      }
    })();

    return stream;
  };
}

/** Wire a real Agent to a real harness; the scripted model replaces the network. */
function makeLiveHarness() {
  const errors = [];
  const status = [];
  const counter = { calls: 0, contexts: [], firstRunAbortedAt: null };
  const h = new FormAgentHarness({ selectedMode: 'free', free: {} }, [], {
    onError: (e) => errors.push(e),
    onStatusChange: (busy) => status.push(busy),
  }, [], 'test-live');

  const agent = new Agent({
    initialState: {
      model: {
        id: 'test-model',
        name: 'test-model',
        provider: 'test',
        api: 'openai-completions',
        capabilities: ['tools', 'streaming'],
      },
      systemPrompt: 'test',
      tools: [],
    },
    streamFn: scriptedStreamFn(counter),
    toolExecution: 'sequential',
  });

  let agentEnds = 0;
  agent.subscribe((event) => {
    if (event.type === 'agent_end') agentEnds += 1;
    // Mirror what setupAgent() wires in production.
    h.handleAgentEvent(event);
  });
  h.agent = agent;

  return { h, agent, counter, errors, status, agentEnds: () => agentEnds };
}

{
  // 1. The cut-off turn must resume by itself, against the real run lifecycle.
  const { agent, counter, errors, status, agentEnds } = makeLiveHarness();
  await agent.prompt('write another project on top of termote');

  // The first run is done; the resume is in flight. It must start a second run.
  const resumed = await until(() => counter.calls >= 2);
  check('a watchdog cut resumes with a new run', resumed, `streamFn calls=${counter.calls}`);
  const finished = await until(() => agentEnds() >= 2);
  check('and the resumed run finishes', finished, `agent_end count=${agentEnds()}`);
  await until(() => status.at(-1) === false);
  check('activity remains visible throughout automatic retry', status.slice(0, -1).every(Boolean), JSON.stringify(status));
  check('activity clears after the final run completes', status.at(-1) === false);

  check(
    'no "already processing" error ever surfaces',
    !errors.some((e) => /already processing/i.test(e)),
    errors.join(' | ')
  );
  check(
    'and the user is never told to type continue',
    !errors.some((e) => /Please type continue/.test(e)),
    errors.join(' | ')
  );
}

{
  // 2. The cut must be the watchdog's doing, and the resumed run must be told
  // to act - otherwise test 1's "second run" would just be another ramble.
  const { agent, counter } = makeLiveHarness();
  await agent.prompt('do the thing');
  await until(() => counter.calls >= 2);

  check(
    'the first run was cut off mid-thought by the watchdog',
    counter.firstRunAbortedAt !== null && counter.firstRunAbortedAt < 30000,
    `aborted after ${counter.firstRunAbortedAt} thinking chars`
  );

  const resumedContext = JSON.stringify(counter.contexts[1] ?? {});
  check(
    'the resumed run carries the act-now directive',
    /MUST be a tool call/.test(resumedContext),
    resumedContext.slice(0, 200)
  );
}

{
  // Exercise the public request's finally block, not just Agent.prompt().
  const { h, counter, status, agentEnds } = makeLiveHarness();
  h.getActiveConfig = () => ({ apiKey: 'test-key', provider: 'openai' });
  const request = h.prompt('write a project');
  check('activity is visible immediately before async preparation', status.at(-1) === true);
  await request;
  await until(() => counter.calls >= 2);
  check('original request completion keeps the retry indicator active', status.at(-1) === true, JSON.stringify(status));
  await until(() => agentEnds() >= 2 && status.at(-1) === false);
  check('public request and retry never flicker idle', status.slice(0, -1).every(Boolean), JSON.stringify(status));
  check('public request becomes idle after all runs finish', status.at(-1) === false);
}

{
  // Stop while storage preparation is pending must prevent a later run start.
  const { h, counter, status } = makeLiveHarness();
  h.getActiveConfig = () => ({ apiKey: 'test-key', provider: 'openai' });
  let release;
  globalThis.chrome = { runtime: {}, storage: { local: {
    get(_keys, callback) { release = () => callback({}); },
    set(_values, callback) { callback(); },
  } } };
  try {
    const request = h.prompt('write a project');
    check('preparation shows activity while storage is pending', status.at(-1) === true);
    h.abort();
    check('Stop hides activity immediately', status.at(-1) === false);
    release();
    await request;
    check('stopped preparation never starts a model run', counter.calls === 0);
    check('late preparation completion cannot restore activity', status.at(-1) === false);
  } finally {
    delete globalThis.chrome;
  }
}

rmSync(outPath, { force: true });
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
