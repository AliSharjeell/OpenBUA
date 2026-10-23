import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
let chromium;
try {({chromium}=await import('@playwright/test'));}catch{({chromium}=await import('file:///C:/AppsNew/nascon-agentika/node_modules/@playwright/test/index.mjs'));}
const browser=await chromium.launch({headless:true,executablePath:process.env.OPENBUA_CHROME_PATH||'C:/Users/alish/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'});
const page=await browser.newPage({viewport:{width:440,height:950}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
await page.route('**/__agent_ui_test',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><style>body{margin:0;background:#09090b;color:#f4f4f5;font:13px system-ui}main{padding:24px;display:grid;gap:24px}button,input,textarea,select{font:inherit}button{border:0;background:transparent;color:inherit;cursor:pointer}*{box-sizing:border-box}</style></head><body><main class="agent-ui" id="test-root"></main><script type="module">
import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module">
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js'; const {createRoot}=ReactDOM;
import {ApprovalCard} from '/src/components/agent/ApprovalCard.tsx';
import {LoadingState} from '/src/components/agent/LoadingState.tsx';
import {ThinkingState} from '/src/components/agent/ThinkingState.tsx';
import {ToolChips} from '/src/components/agent/ToolChips.tsx';
import {StreamingText} from '/src/components/agent/StreamingText.tsx';
import {HumanInput} from '/src/agent/human-input.ts';
import '/src/styles/agent-ui.css';
const h=React.createElement;
window.broker=new HumanInput();
window.pending=window.broker.tool().execute('actual-ui-request',{questions:[{q:'Which arrangement works for you?',type:'radio',options:['Remote','Onsite']},{q:'What is your availability?',type:'text',options:[]}]},new AbortController().signal).then(result=>window.answerResult=result);
createRoot(document.querySelector('#test-root')).render(h(React.Fragment,null,
 h(LoadingState,{label:'Inspecting form',startedAt:Date.now()-2100,videoSrc:'/missing-test-video.mp4'}),
 h(ThinkingState,{label:'Reading fields',done:'Read fields',working:true,rows:[{id:'read',label:'Read required fields',status:'success'}]}),
 h(ToolChips,{calls:[{id:'fill',toolName:'fill_form_fields',status:'error',args:{refId:'af_1',apiKey:'private-fixture-key'},result:{success:false,error:'Please choose an option'}}]}),
 h(StreamingText,{content:'Read the [form guide](https://example.test/guide).',streaming:false,followUps:['Verify this form'],onFollowUp:text=>window.followup=text}),
 h(ApprovalCard,{request:window.broker.current,onSubmit:answers=>window.broker.answer(window.broker.current.id,answers),onSkip:()=>window.broker.answer(window.broker.current.id,[],true)})
));
</script></body></html>`}));
try {
 await page.goto('http://127.0.0.1:5173/__agent_ui_test');
 await page.getByRole('heading',{name:'Which arrangement works for you?'}).waitFor();
 assert.equal(await page.locator('.agent-pixels i').count(),9);
 const before=await page.locator('.agent-elapsed').innerText();await page.waitForTimeout(150);assert.notEqual(await page.locator('.agent-elapsed').innerText(),before);
 await page.getByLabel('Activity animation').selectOption('Dots');assert.equal(await page.locator('.agent-pixels-round').count(),1);
 await page.getByLabel('Activity animation').selectOption('Surfer');await page.getByText('Video unavailable',{exact:true}).waitFor();
 await page.getByLabel('Activity animation').selectOption('Drive');
 await page.getByRole('button',{name:'Reading fields'}).click();assert.equal(await page.getByText('Read required fields',{exact:true}).count(),0);
 await page.getByRole('button',{name:'1 tool call'}).click();await page.getByRole('button',{name:/fill_form_fields/}).click();
 assert.match(await page.locator('.agent-tool-detail').innerText(),/Please choose an option/);assert.ok(!(await page.locator('.agent-tool-detail').innerText()).includes('private-fixture-key'));
 await page.getByRole('button',{name:'1 source'}).click();assert.equal(await page.locator('.agent-sources a').getAttribute('href'),'https://example.test/guide');
 await page.getByRole('button',{name:'Verify this form'}).click();assert.equal(await page.evaluate(()=>window.followup),'Verify this form');
 await page.getByRole('radio',{name:'Remote',exact:true}).check();
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByRole('textbox',{name:'Your answer',exact:true}).fill('Available in two weeks');
 await page.getByRole('button',{name:'Send answer',exact:true}).click();
 const result=await page.evaluate(()=>window.pending);
 assert.deepEqual(result.details.answers,[{selected:['Remote'],custom:''},{selected:[],custom:'Available in two weeks'}]);
 await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await page.locator('.agent-pixels i').first().evaluate(node=>getComputedStyle(node).animationName),'none');
 await mkdir('.tmp-visual-agent-ui',{recursive:true});
 await page.screenshot({path:'.tmp-visual-agent-ui/agent-ui-440.png',fullPage:true});
 await page.setViewportSize({width:320,height:950});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Question cards and tool traces fit a 320px panel');
 await page.screenshot({path:'.tmp-visual-agent-ui/agent-ui-320.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('PASS: actual question tool answers, loader styles/time/fallback/reduced motion, trace/tool expansion/redaction, real sources and follow-ups, 440px and 320px layouts');
} catch(error){console.error('Browser errors:',errors);throw error;} finally {await browser.close();}


