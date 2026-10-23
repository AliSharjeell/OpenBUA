import assert from 'node:assert/strict';
import {build} from 'esbuild';
let chromium;
try {({chromium}=await import('@playwright/test'));} catch {({chromium}=await import('file:///C:/AppsNew/nascon-agentika/node_modules/@playwright/test/index.mjs'));}
async function source(file,plugins=[]) {
  const result=await build({entryPoints:[file],bundle:true,platform:'node',format:'esm',write:false,plugins});
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const {providerEffortOptions,providerEndpoint,resolveProviderConfig}=await source('src/services/provider-config.ts');
const mini={provider:'anthropic',baseUrl:'https://api.minimax.io/anthropic',model:'MiniMax-M3.1-Flash[1m]'};
assert.deepEqual(providerEffortOptions(mini),{output_config:{effort:'low'}});
assert.deepEqual(providerEffortOptions({...mini,reasoningEffort:'high'}),{output_config:{effort:'high'}});
assert.deepEqual(providerEffortOptions({...mini,provider:'openai'}),{reasoning_effort:'low'});
assert.deepEqual(providerEffortOptions({...mini,baseUrl:'https://minimax.io.evil.test'}),{});
assert.deepEqual(providerEffortOptions({...mini,model:'claude-sonnet-4-5'}),{});
assert.equal(providerEndpoint(mini),'https://api.minimax.io/anthropic/v1/messages');
assert.equal(providerEndpoint({...mini,baseUrl:'https://api.minimax.io/anthropic/v1/'}),'https://api.minimax.io/anthropic/v1/messages');
assert.equal(providerEndpoint({provider:'openai',baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai'}),'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
assert.equal(resolveProviderConfig({selectedMode:'byok',activeProvider:'anthropic',anthropic:mini}).reasoningEffort,'low');
const {HumanInput}=await source('src/agent/human-input.ts');
const broker=new HumanInput();let changes=0;broker.subscribe(()=>changes++);
const questions=[{q:'Preferred arrangement?',type:'radio',options:['Remote','Onsite']},{q:'Skills?',type:'check',options:['Python','React']}];
const pending=broker.tool().execute('test',{questions},new AbortController().signal);
assert.equal(broker.current.questions.length,2);
assert.throws(()=>broker.answer('stale',[]),/no longer pending/);
assert.throws(()=>broker.answer(broker.current.id,[{selected:['Invented'],custom:''},{selected:['Python'],custom:''}]),/Answer every/);
const answers=[{selected:['Remote'],custom:''},{selected:['Python','React'],custom:'Also TypeScript'}];
broker.answer(broker.current.id,answers);
assert.deepEqual((await pending).details.answers,answers);assert.equal(broker.current,null);assert.equal(changes,2);
const abort=new AbortController();const waiting=broker.tool().execute('abort',{questions},abort.signal);abort.abort();
assert.equal((await waiting).details.skipped,true);assert.equal(broker.current,null);
let state='first',calls=0;
globalThis.chrome={scripting:{executeScript:async()=>[{result:state}]}};
const {protectFormRecovery}=await source('src/agent/form-recovery.ts',[{name:'mock-browser',setup(build){build.onResolve({filter:/^\.\/browser-bridge$/},()=>({path:'mock-browser',namespace:'mock'}));build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const getActiveTab=async()=>({id:7});'}));}}]);
const [wrapped]=protectFormRecovery([{name:'fill_form_fields',execute:async()=>{calls++;return {details:{success:false,errors:['Selection required']},content:[]};}}]);
const args={assignments:[{refId:'af_1',value:'Karachi'}]};
await wrapped.execute('one',args);const repeated=await wrapped.execute('two',{...args,explanation:'Try again'});
assert.equal(calls,1);assert.equal(repeated.details.dispatched,false);
state='changed';await wrapped.execute('three',args);assert.equal(calls,2);
const {inPageCompletedFields}=await source('src/agent/native-field-state.ts');
const {inPageControls}=await source('src/agent/page-controls.ts');
const {inPageAutocomplete}=await source('src/agent/autocomplete.ts');
const browser=await chromium.launch({headless:true,executablePath:process.env.OPENBUA_CHROME_PATH||'C:/Users/alish/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'});
try {
 const page=await browser.newPage();
 await page.setContent('<input id="email" type="email" value="ali@example.test"><input id="combo" role="combobox" value="Karachi"><input id="invalid" aria-invalid="true" value="yes"><input id="secret" type="password" value="hidden"><div id="host"></div>');
 await page.evaluate(()=>document.querySelector('#host').attachShadow({mode:'open'}).innerHTML='<textarea id="shadow">Saved text</textarea>');
 const result=await page.evaluate(inPageCompletedFields,[{selector:'#email',value:'ali@example.test'},{selector:'#combo',value:'Karachi'},{selector:'#invalid',value:'yes'},{selector:'#secret',value:'hidden'},{selector:'#email',value:'ali@example.test',pressEnter:true},{selector:'#shadow',value:'Saved text'}]);
 assert.deepEqual(result.map(value=>value.index),[0,5]);
 await page.setContent('<input role="combobox" aria-label="Country" aria-expanded="true">');
 await page.evaluate(()=>setTimeout(()=>{const list=document.createElement('div');list.role='listbox';list.innerHTML='<button role="option">Pakistan</button>';document.body.append(list);},120));
 const controls=await page.evaluate(inPageControls,{optionQuery:'Pakistan'});
 assert.ok(controls.controls.some(control=>control.label==='Pakistan'),'Expanded dropdown waits for delayed real options');
 assert.ok(!JSON.stringify(controls).includes('job_google_sign_in'),'No unavailable JobBot tool guidance');
 await page.setContent('<div><input id="city" role="combobox" aria-label="City" aria-expanded="true"><span id="chosen"></span></div><div role="listbox"><button role="option">Karachi, Sindh, Pakistan</button></div>');
 await page.evaluate(inPageAutocomplete,[]);
 await page.evaluate(()=>document.querySelector('[role="option"]').onclick=()=>{document.querySelector('#city').value='';document.querySelector('#city').setAttribute('aria-expanded','false');document.querySelector('#chosen').textContent='Karachi, Sindh, Pakistan';document.querySelector('[role="listbox"]').hidden=true;});
 await page.getByRole('option').click();
 await page.waitForFunction(()=>document.querySelector('#city').dataset.openbuaSelectedLabel==='Karachi, Sindh, Pakistan');
 const committed=await page.evaluate(inPageAutocomplete,[{selector:'#city',value:'Karachi, Sindh, Pakistan'}]);
 assert.equal(committed[0].selected,true);assert.equal(committed[0].value,'Karachi, Sindh, Pakistan');
 console.log('PASS: MiniMax effort and endpoints, real input lifecycle, unchanged-failure guard, native no-op safety, delayed dropdown inspection');
} finally {await browser.close();}

