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
  assert.equal(await page.evaluate(async status=>{
    const {guardApplicationReport}=await import('/src/agent/application-status.ts');return guardApplicationReport('',status);
  },rejected),'','read-only tool turns must not repeat an old failure');
  // Reproduce the reported LinkedIn transition: old toast, a different job,
  // and a messaging dialog whose shared post mentions applications/resumes.
  await page.setContent('<div role="dialog"><h2>Areesha Azam</h2><p>Automate job applications, resume review</p><button>Send</button></div><a id="job" href="?currentJobId=222">AI/ML Engineer, Internal Platforms</a><div role="alert">This job is now closed</div>');
  const navigation=await page.evaluate(async()=>{
    document.getElementById('job').onclick=event=>{event.preventDefault();history.replaceState({},'', '?currentJobId=222');};
    const {clickElementTool}=await import('/src/agent/tools.ts');const start=performance.now();
    const result=await clickElementTool.execute('new-job',{text:'AI/ML Engineer, Internal Platforms'});
    return {result,elapsed:performance.now()-start};
  });
  assert.equal(navigation.result.details.success,true);assert.equal(navigation.result.details.applicationStatus.state,'unconfirmed');
  assert.deepEqual(navigation.result.details.applicationStatus.actions,[]);
  assert.doesNotMatch(navigation.result.content[0].text,/NOT submitted|job is now closed/);
  assert.ok(navigation.elapsed<900,'navigation should not wait through submission polling');
  await page.setContent('<div role="dialog"><h2>Share your profile?</h2><button>Continue</button></div><div role="alert">This job is now closed</div>');
  const continueResult=await page.evaluate(async()=>{
    const {clickElementTool}=await import('/src/agent/tools.ts');return clickElementTool.execute('continue',{text:'Continue'});
  });
  assert.equal(continueResult.details.success,true);assert.equal(continueResult.details.applicationStatus.state,'in-progress');
  // A popup blocked by Chrome is opened through tabs using its exact URL,
  // without replaying Apply or sending any application twice.
  await page.setContent('<button id="external">Apply</button><div role="alert">This job is now closed</div>');
  const external=await page.evaluate(async()=>{
    window.open=()=>null;
    window.applyClicks=0;window.createdTabs=[];
    window.chrome.tabs.create=(props,callback)=>{window.createdTabs.push(props);callback({id:8});};
    document.getElementById('external').onclick=()=>{window.applyClicks++;window.open('https://company.example/jobs/222/apply','_blank');};
    const {clickElementTool}=await import('/src/agent/tools.ts');
    const result=await clickElementTool.execute('external',{text:'Apply'});
    return {result,clicks:window.applyClicks,tabs:window.createdTabs};
  });
  assert.equal(external.result.details.success,true);assert.equal(external.result.details.externalTabId,8);
  assert.equal(external.clicks,1);assert.equal(external.tabs.length,1);assert.equal(external.tabs[0].url,'https://company.example/jobs/222/apply');
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
  await page.setContent('<div id="captcha" style="position:absolute;left:20px;top:20px;width:160px;height:80px"><button id="captcha-check">Verify</button></div>');
  const captchaSuccess=await page.evaluate(async()=>{
    const {captchaManager}=await import('/src/agent/browser-bridge.ts');
    window.captchaDetected=true;let visionCalls=0,alerts=0;
    const unsubscribe=captchaManager.subscribe(state=>{if(state.isActive) alerts++;});
    const originalFetch=window.fetch;
    window.fetch=async(url,options)=>String(url).includes('/chat/completions')
      ? (visionCalls++,new Response(JSON.stringify({choices:[{message:{content:'{"clicks":[{"x":35,"y":30}]}'}}]}),{status:200}))
      : originalFetch(url,options);
    const originalSend=window.chrome.tabs.sendMessage;
    window.chrome.tabs.sendMessage=(id,message,callback)=>message.action==='CHECK_CAPTCHA'
      ? callback({success:true,data:{detected:window.captchaDetected,type:'generic',selector:'#captcha'}})
      : originalSend(id,message,callback);
    window.chrome.tabs.captureVisibleTab=(options,callback)=>callback('data:image/jpeg;base64,AA==');
    document.getElementById('captcha-check').onclick=()=>{window.captchaDetected=false;};
    const outcome=await captchaManager.runGate(7,'generic','https://www.linkedin.com/jobs/search/');
    unsubscribe();window.fetch=originalFetch;
    return {outcome,visionCalls,alerts};
  });
  assert.equal(captchaSuccess.outcome.solved,true);assert.equal(captchaSuccess.visionCalls,1);assert.equal(captchaSuccess.alerts,0,'automatic success must not ping the user');
  const captchaFallback=await page.evaluate(async()=>{
    const {captchaManager}=await import('/src/agent/browser-bridge.ts');
    window.captchaDetected=true;let visionCalls=0,alerts=0;
    document.getElementById('captcha-check').onclick=()=>{};
    const originalFetch=window.fetch;
    window.fetch=async(url,options)=>String(url).includes('/chat/completions')
      ? (visionCalls++,new Response(JSON.stringify({choices:[{message:{content:'{"clicks":[{"x":35,"y":30}]}'}}]}),{status:200}))
      : originalFetch(url,options);
    const unsubscribe=captchaManager.subscribe(state=>{if(state.isActive){alerts++;setTimeout(()=>captchaManager.resolveActiveGate(false,'Human handoff verified'),0);}});
    const first=await captchaManager.runGate(7,'generic','https://www.linkedin.com/jobs/search/');
    const second=await captchaManager.runGate(7,'generic','https://www.linkedin.com/jobs/search/');
    unsubscribe();window.fetch=originalFetch;
    return {first,second,visionCalls,alerts};
  });
  assert.equal(captchaFallback.first.solved,false);assert.equal(captchaFallback.visionCalls,2,'cached failure must not repeat VLM rounds');
  assert.equal(captchaFallback.alerts,2);assert.match(captchaFallback.second.message,/Human handoff verified/);
  await page.route('**/captcha-frame',route=>route.fulfill({contentType:'text/html',body:'<button style="position:absolute;left:0;top:0">Verify</button>'}));
  await page.setContent('<iframe id="captcha-frame" src="http://127.0.0.1:5173/captcha-frame" style="position:absolute;left:20px;top:20px;width:160px;height:80px;border:0"></iframe>');
  await page.frameLocator('#captcha-frame').getByRole('button').waitFor();
  const framedCaptcha=await page.evaluate(async()=>{
    const {captchaManager}=await import('/src/agent/browser-bridge.ts');
    const frame=document.querySelector('iframe');window.captchaDetected=true;
    window.chrome.tabs.query=(_query,callback)=>callback([{id:7,url:'https://www.linkedin.com/jobs/search/?currentJobId=333'}]);
    window.chrome.tabs.sendMessage=(_id,message,callback)=>message.action==='CHECK_CAPTCHA'
      ? callback({success:true,data:{detected:window.captchaDetected,type:'generic',selector:'#captcha-frame'}})
      : window.testApplicationListener(message,{},callback);
    window.chrome.scripting.executeScript=async injection=>{
      const execute=target=>(new target.Function(`return (${injection.func.toString()})`))()(...(injection.args||[]));
      if(injection.target.allFrames)return [{frameId:0,result:execute(window)},{frameId:5,result:execute(frame.contentWindow)}];
      return [{frameId:injection.target.frameIds?.[0]||0,result:await execute(injection.target.frameIds?.[0]===5?frame.contentWindow:window)}];
    };
    frame.contentDocument.querySelector('button').onclick=()=>{window.captchaDetected=false;};
    const originalFetch=window.fetch;
    window.fetch=async(url,options)=>String(url).includes('/chat/completions')
      ? new Response(JSON.stringify({choices:[{message:{content:'{"clicks":[{"x":35,"y":30}]}'}}]}),{status:200})
      : originalFetch(url,options);
    const outcome=await captchaManager.runGate(7,'generic','https://www.linkedin.com/jobs/search/?currentJobId=333');
    window.fetch=originalFetch;return outcome;
  });
  assert.equal(framedCaptcha.solved,true,'CAPTCHA click must reach the inner frame button');
  const completionProof=await page.evaluate(async()=>{
    const {checkActiveTabCaptcha}=await import('/src/agent/browser-bridge.ts');
    window.chrome.tabs.sendMessage=(_id,_message,callback)=>callback({success:true,data:{detected:true,type:'recaptcha',selector:'iframe'}});
    document.body.insertAdjacentHTML('beforeend','<textarea name="g-recaptcha-response">fixture-completion</textarea>');
    const cleared=await checkActiveTabCaptcha(7);
    document.body.insertAdjacentHTML('beforeend','<iframe title="challenge" src="about:blank"></iframe>');
    const stillBlocked=await checkActiveTabCaptcha(7);
    return {cleared,stillBlocked};
  });
  assert.equal(completionProof.cleared.detected,false,'a completed checkbox can remain visible without blocking automation');
  assert.equal(completionProof.stillBlocked.detected,true,'an active puzzle overrides stale completion evidence');
  console.log('PASS application outcomes: stale job toast, messaging dialog exclusion, fast navigation, profile sharing, blocked popup recovery with one click, delayed genuine rejection, final report guard and visible confirmation');
  console.log('PASS CAPTCHA gate integration: automatic VLM success without user alert, two-round failure before human handoff, cached attempt suppression and iframe click routing');
} finally {await browser.close();}
