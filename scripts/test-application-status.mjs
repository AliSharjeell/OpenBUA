import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.OPENBUA_PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({...(process.env.OPENBUA_CHROME_PATH?{executablePath:process.env.OPENBUA_CHROME_PATH}:{}),headless:true});
const page=await browser.newPage();
try {
  await page.goto('http://127.0.0.1:5173/test-form.html');
  await page.evaluate(()=>history.replaceState({},'', '/jobs/search/'));
  await page.setContent('<div role="dialog"><h1>Apply to Example Company</h1><p>Contact info</p><p>0%</p><button>Next</button></div><div role="alert">This job is now closed</div>');
  await page.evaluate(()=>{
    window.chrome ||= {};
    window.chrome.runtime={lastError:null,onMessage:{addListener(listener){window.testApplicationListener=listener;}}};
    window.chrome.tabs={query(_query,callback){callback([{id:7,url:'https://www.linkedin.com/jobs/search/'}]);},sendMessage(_id,message,callback){window.testApplicationListener(message,{},callback);}};
    window.chrome.scripting={executeScript:async injection=>[{frameId:0,result:(new Function(`return (${injection.func.toString()})`))()(...(injection.args||[]))}]};
  });
  await page.addScriptTag({path:fileURLToPath(new URL('../dist/content.js',import.meta.url))});
  const inspect=()=>page.evaluate(async()=>{
    const {inspectApplicationStatus}=await import('/src/agent/application-status.ts');return inspectApplicationStatus(7);
  });
  const rejected=await inspect();assert.equal(rejected.state,'rejected');assert.match(rejected.evidence,/job is now closed/i);
  const guarded=await page.evaluate(async status=>{
    const {guardApplicationReport}=await import('/src/agent/application-status.ts');
    return guardApplicationReport('Everything checks out. Application successfully submitted.',status);
  },rejected);
  assert.match(guarded,/not submitted/);assert.match(guarded,/job is now closed/i);
  await page.setContent('<div role="dialog"><h1>Apply to Example Company</h1><p>Contact info</p><p>0%</p><button>Next</button></div>');
  const progress=await inspect();assert.equal(progress.state,'in-progress');assert.match(progress.evidence,/Contact info.*0%/i);assert.deepEqual(progress.actions,['Next']);
  const progressGuard=await page.evaluate(async status=>{
    const {guardApplicationReport}=await import('/src/agent/application-status.ts');return guardApplicationReport('Application submitted.',status);
  },progress);assert.match(progressGuard,/has not been submitted/);
  // A click dispatch succeeds, but delayed website rejection must override it.
  await page.setContent('<div role="dialog"><h1>Apply to Example Company</h1><p>Review</p><button id="submit">Submit application</button></div>');
  await page.evaluate(()=>document.getElementById('submit').onclick=()=>setTimeout(()=>document.body.insertAdjacentHTML('beforeend','<div role="alert">This job is now closed</div>'),200));
  const click=await page.evaluate(async()=>{
    const {clickElementTool}=await import('/src/agent/tools.ts');return clickElementTool.execute('test-click',{text:'Submit application'});
  });
  assert.equal(click.details.dispatched,true);assert.equal(click.details.success,false);assert.equal(click.details.submissionVerified,false);
  assert.equal(click.details.applicationStatus.state,'rejected');assert.match(click.content[0].text,/Application NOT submitted/);
  const harnessReport=await page.evaluate(async status=>{
    const {FormAgentHarness}=await import('/src/agent/form-agent.ts');
    const reports=[],tools=[];
    const harness=new FormAgentHarness({selectedMode:'free',free:{}},[],{onTurnComplete:text=>reports.push(text),onToolCallEnd:tool=>tools.push(tool)},[],'outcome-test');
    await harness.handleAgentEvent({type:'tool_execution_start',toolCallId:'submit-test',toolName:'click_at_position',args:{x:1,y:1}});
    await harness.handleAgentEvent({type:'tool_execution_end',toolCallId:'submit-test',toolName:'click_at_position',result:{details:{success:false,dispatched:true,applicationStatus:status}}});
    await harness.handleAgentEvent({type:'turn_start'});
    harness.currentStreamingText='Everything checks out. Application successfully submitted.';
    await harness.handleAgentEvent({type:'turn_end',message:{}});
    return {report:reports.at(-1),toolStatus:tools[0].status};
  },rejected);
  assert.match(harnessReport.report,/not submitted/);assert.equal(harnessReport.toolStatus,'error');
  await page.setContent('<div role="status">Your application was sent</div>');
  assert.equal((await inspect()).state,'submitted');
  await page.setContent('<div role="status">Your application was sent</div><div role="alert">This job is now closed</div>');
  assert.equal((await inspect()).state,'rejected','visible errors override contradictory success text');
  await page.setContent('<div style="display:none" role="status">Your application was sent</div><p>Applied</p>');
  assert.equal((await inspect()).state,'unconfirmed','hidden confirmation and a background Applied badge are not proof');
  await page.setContent('<div role="dialog"><h1>Apply to Example</h1><div role="alert">Please enter a valid phone number</div><button>Next</button></div>');
  assert.equal((await inspect()).state,'rejected');
  console.log('PASS application outcomes: closed-job toast, current 0%/Next step, delayed rejection after click, final report guard, explicit success, hidden feedback and validation errors');
} finally {await browser.close();}
