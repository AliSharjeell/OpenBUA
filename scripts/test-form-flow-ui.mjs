import assert from 'node:assert/strict';
let chromium;try{({chromium}=await import('@playwright/test'));}catch{({chromium}=await import('file:///C:/AppsNew/nascon-agentika/node_modules/@playwright/test/index.mjs'));}
const browser=await chromium.launch({headless:true,executablePath:process.env.OPENBUA_CHROME_PATH||'C:/Users/alish/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'});
const page=await browser.newPage({viewport:{width:440,height:850}}),requests=[],errors=[];
page.on('pageerror',error=>errors.push(error.message));
const settings={selectedMode:'byok',activeProvider:'anthropic',free:{baseUrl:'',apiKey:'',model:'Free'},openai:{baseUrl:'',apiKey:'',model:''},anthropic:{baseUrl:'https://api.minimax.io/anthropic',apiKey:'fixture-only',model:'MiniMax-M3.1-Flash[1m]'},autoConfirmSubmit:false};
await page.addInitScript(settings=>{
 for(const [key,value] of Object.entries({autoform_settings:settings,autoform_global_memory:[],autoform_chat_sessions:[{id:'flow_test',title:'Form Fixture',createdAt:1,updatedAt:1}],openbua_last_active_session_id:'flow_test',openbua_last_active_nav_tab:'chat'}))localStorage.setItem(key,JSON.stringify(value));
},settings);
const event=body=>'data: '+JSON.stringify(body)+'\n\n';
await page.route('https://api.minimax.io/anthropic/v1/messages',async route=>{
 const payload=route.request().postDataJSON();requests.push(payload);
 if(!payload.stream){await route.fulfill({json:{content:[{type:'text',text:'Review Form Availability Details'}]}});return;}
 const answered=JSON.stringify(payload.messages).includes('Two weeks');
 const block=answered?{type:'text',text:''}:{type:'tool_use',id:'question-one',name:'request_user_input',input:{}};
 const delta=answered?{type:'text_delta',text:'Your availability is recorded for this form.'}:{type:'input_json_delta',partial_json:JSON.stringify({questions:[{q:'When can you start?',type:'text',options:[]}]})};
 await route.fulfill({contentType:'text/event-stream',body:[{type:'content_block_start',index:0,content_block:block},{type:'content_block_delta',index:0,delta},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:answered?'end_turn':'tool_use'}},{type:'message_stop'}].map(event).join('')});
});
try {
 await page.goto('http://127.0.0.1:5173/sidepanel.html');
 const input=page.getByRole('textbox',{name:'Prompt',exact:true});await input.waitFor();
 await page.getByRole('button',{name:'Choose model'}).click();assert.equal(await page.getByRole('menuitemradio',{name:/MiniMax/}).getAttribute('aria-checked'),'true');await page.getByRole('menuitemradio',{name:/MiniMax/}).click();
 await input.fill('/');await page.getByRole('listbox',{name:'Commands'}).waitFor();await input.press('ArrowDown');await input.press('Enter');assert.match(await input.inputValue(),/Inspect this page/);
 await page.getByRole('button',{name:'Add attachments and sources'}).click();await page.getByRole('button',{name:'Reference a saved attachment'}).click();assert.equal(await input.inputValue(),'@');
 await input.fill('Ask me when I can start, then acknowledge my answer.');await input.press('Enter');
 await page.getByRole('heading',{name:'When can you start?'}).waitFor();
 await page.getByRole('textbox',{name:'Your answer',exact:true}).fill('Two weeks');await page.getByRole('button',{name:'Send answer',exact:true}).click();
 await page.getByText('Your availability is recorded for this form.',{exact:true}).waitFor();
 assert.ok(requests.filter(request=>request.stream).length>=2);
 for(const request of requests)assert.deepEqual(request.output_config,{effort:'low'});
 assert.ok(requests.some(request=>JSON.stringify(request.messages).includes('tool_result')&&JSON.stringify(request.messages).includes('Two weeks')));
 assert.deepEqual(errors,[]);
 await page.screenshot({path:'.tmp-visual-agent-ui/integrated-chat.png',fullPage:true});
 console.log('PASS: actual ChatView commands, model selection, source actions and MiniMax low-effort tool-question-answer continuation (mock provider, no real submission)');
} finally {await browser.close();}
