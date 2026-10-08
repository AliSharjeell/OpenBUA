import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.OPENBUA_PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,...(process.env.OPENBUA_CHROME_PATH?{executablePath:process.env.OPENBUA_CHROME_PATH}:{})});
const page=await browser.newPage();
try {
  await page.goto('http://127.0.0.1:5173/test-form.html');
  await page.evaluate(()=>{
    window.chrome={runtime:{lastError:null,onMessage:{addListener(listener){window.testListener=listener;}}},
      tabs:{query(_q,cb){cb([{id:7,url:'https://jobs.micro1.ai/post/fixture'}]);},sendMessage(_id,message,callback){window.testListener(message,{},callback);}},
      scripting:{executeScript:async injection=>[{frameId:0,result:await (new Function(`return (${injection.func.toString()})`))()(...(injection.args||[]))}]}};
  });
  await page.addScriptTag({path:fileURLToPath(new URL('../dist/content.js',import.meta.url))});
  const setup=async mode=>{
    await page.setContent('<form><p>Your Location (City, State)</p><div class="MuiAutocomplete-root"><input id="city" data-autoform-ref="af_5" role="combobox" aria-expanded="true" aria-controls="cities" aria-invalid="true" value="Karachi, Pakistan"></div><div id="cities" role="listbox">No options</div><button type="submit">Next</button></form><div role="listbox"><div role="option">Karachi, USA</div></div>');
    await page.evaluate(mode=>{
      window.queries=[];window.nextClicks=0;window.selected=false;
      const input=document.getElementById('city'),list=document.getElementById('cities');let timer;
      const render=()=>{
        list.style.display='block';list.replaceChildren();
        const labels=mode==='empty'?[]:input.value==='Karachi'?(mode==='ambiguous'?['Karachi, Sindh, Pakistan','Karachi, Punjab, Pakistan']:['Karachi, Sindh, Pakistan']):[];
        if(!labels.length)list.textContent='No options';
        for(const label of labels){const option=document.createElement('div');option.role='option';option.textContent=label;
          option.onclick=()=>{input.value=label;input.setAttribute('aria-invalid','false');input.setAttribute('aria-expanded','false');list.style.display='none';window.selected=true;};list.append(option);}
      };
      input.oninput=()=>{window.queries.push(input.value);window.selected=false;input.setAttribute('aria-expanded','true');clearTimeout(timer);timer=setTimeout(render,100);};
      input.onkeydown=()=>{input.setAttribute('aria-expanded','true');render();};
      document.querySelector('form').onsubmit=event=>{event.preventDefault();window.nextClicks++;};
    },mode);
  };
  await setup('success');
  const fill=await page.evaluate(async()=>{
    const {fillFormFieldsTool}=await import('/src/agent/tools.ts');const start=performance.now();
    return {result:await fillFormFieldsTool.execute('city-fill',{assignments:[{refId:'af_5',value:'Karachi, Pakistan'}]}),elapsed:performance.now()-start,queries:window.queries,selected:window.selected};
  });
  assert.equal(fill.result.details.successCount,1);assert.equal(fill.selected,true);
  assert.equal(fill.result.details.verifications[0].status,'selected-option');
  assert.equal(fill.result.details.verifications[0].actualValue,'Karachi, Sindh, Pakistan');
  assert.ok(fill.queries.includes('Karachi'));assert.ok(fill.elapsed<1500,'recovery should return when options arrive');
  const advance=await page.evaluate(async()=>{const {clickElementTool}=await import('/src/agent/tools.ts');return clickElementTool.execute('next',{text:'Next'});});
  assert.equal(advance.details.success,true);assert.equal(await page.evaluate(()=>window.nextClicks),1);
  await setup('empty');
  const blocked=await page.evaluate(async()=>{const {clickElementTool}=await import('/src/agent/tools.ts');return clickElementTool.execute('next-invalid',{text:'Next'});});
  assert.equal(blocked.details.success,false);assert.equal(blocked.details.dispatched,false);assert.equal(blocked.details.validationBlocked,true);
  assert.equal(await page.evaluate(()=>window.nextClicks),0);assert.match(blocked.content[0].text,/No options|no options/);
  const repeated=await page.evaluate(async()=>{const before=window.queries.length;const {clickElementTool}=await import('/src/agent/tools.ts');
    const result=await clickElementTool.execute('next-again',{text:'Next'});return {result,addedQueries:window.queries.length-before};});
  assert.equal(repeated.result.details.validationBlocked,true);assert.equal(repeated.addedQueries,0,'unchanged errors must not replay identical recovery queries');
  const inspection=await page.evaluate(async()=>{
    const select=document.createElement('select');select.setAttribute('aria-label','Phone number country');
    for(let i=0;i<220;i++){const option=document.createElement('option');option.value=String(i);option.textContent=`Country ${i}`;option.selected=i===180;select.append(option);}
    document.querySelector('form').append(select);
    const {getActiveTabFormTool}=await import('/src/agent/tools.ts');return getActiveTabFormTool.execute('inspect',{});
  });
  const city=inspection.details.fields.find(field=>field.id==='city');
  assert.equal(city.type,'autocomplete');assert.match(city.label,/Location/);assert.match(city.sectionHint,/INVALID|No options/i);
  const country=inspection.details.fields.find(field=>field.type==='select');
  assert.ok(country.options.length<=12);assert.equal(country.options[0].value,'180','compact dropdown evidence retains the selected country');
  await setup('ambiguous');
  const ambiguous=await page.evaluate(async()=>{const {fillFormFieldsTool}=await import('/src/agent/tools.ts');return fillFormFieldsTool.execute('ambiguous',{assignments:[{refId:'af_5',value:'Karachi, Pakistan'}]});});
  assert.equal(ambiguous.details.successCount,0);assert.equal(await page.evaluate(()=>window.selected),false);
  assert.match(ambiguous.content[0].text,/UNVERIFIED/);
  await page.setContent('<div role="listbox"><div role="option" onclick="window.explicitOptionClicked=true">Karachi, Sindh, Pakistan</div></div>');
  const explicit=await page.evaluate(async()=>{const {clickElementTool}=await import('/src/agent/tools.ts');return clickElementTool.execute('option',{text:'Karachi, Sindh, Pakistan'});});
  assert.equal(explicit.details.success,true);assert.equal(await page.evaluate(()=>window.explicitOptionClicked),true);
  console.log('PASS autocomplete: shortened city query, actual scoped option selection, event-driven recovery, no-option Next suppression, ambiguity protection and explicit listbox option clicks');
} finally {await browser.close();}
