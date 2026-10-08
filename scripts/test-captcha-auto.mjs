import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundled=await build({entryPoints:['src/agent/captcha-auto.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {attemptVisibleCaptcha}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const make=()=>{
  const state={detected:true,active:true,calls:0,clicks:0};
  const deps={current:async()=>state.active,detected:async()=>state.detected,
    snapshot:async()=>({image:'data:image/png;base64,AA==',boxes:[{x:10,y:10,width:100,height:100}]}),
    vision:async()=>{state.calls++;return '{"clicks":[{"x":20,"y":20}]}';},
    click:async()=>{state.clicks++;state.detected=false;return true;}};
  return {state,deps};
};
let {state,deps}=make();
assert.equal(await attemptVisibleCaptcha(deps),true);assert.equal(state.calls,1);assert.equal(state.clicks,1);
({state,deps}=make());deps.click=async()=>{state.clicks++;return true;};
assert.equal(await attemptVisibleCaptcha(deps),false);assert.equal(state.calls,2);assert.equal(state.clicks,2,'two unsuccessful rounds must hand back to the human gate');
({state,deps}=make());deps.vision=async()=>'{"clicks":[{"x":20,"y":20},{"x":400,"y":400}]}';
assert.equal(await attemptVisibleCaptcha(deps),false);assert.equal(state.clicks,0,'reject an entire out-of-bounds plan before interacting');
({state,deps}=make());deps.vision=async()=>{state.active=false;return '{"clicks":[{"x":20,"y":20}]}';};
assert.equal(await attemptVisibleCaptcha(deps),false);assert.equal(state.clicks,0,'tab changes stop stale model actions');
({state,deps}=make());let aborted=false;
deps.vision=async(_image,_prompt,signal)=>{signal.addEventListener('abort',()=>aborted=true);return new Promise(()=>{});};
assert.equal(await attemptVisibleCaptcha(deps,25),false);assert.equal(aborted,true);assert.equal(state.clicks,0);
({state,deps}=make());deps.vision=async()=>'{"clicks":[]}';
assert.equal(await attemptVisibleCaptcha(deps),false);assert.equal(state.clicks,0);
({state,deps}=make());deps.vision=async()=>{throw new Error('Vision unavailable');};
assert.equal(await attemptVisibleCaptcha(deps),false);assert.equal(state.clicks,0);
console.log('PASS CAPTCHA automatic attempts: visible success, two-round handoff, full-plan bounds validation, active-tab cancellation, abortable timeout and unsupported/provider-error fallback');
