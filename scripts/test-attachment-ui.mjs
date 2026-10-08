import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
// Run with a local Vite server and Playwright installed, or set OPENBUA_PLAYWRIGHT_MODULE.
const { chromium } = await import(process.env.OPENBUA_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({...(process.env.OPENBUA_CHROME_PATH ? {executablePath:process.env.OPENBUA_CHROME_PATH} : {}), headless:true});
const page = await browser.newPage({viewport:{width:440,height:850}});
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const docs = [
  {id:'resume-test',title:'resume',fileName:'resume.pdf',type:'pdf',dataUrl:'data:application/pdf;base64,cGRm',content:'Ali resume text',ocrStatus:'done',createdAt:3,sizeBytes:3,isActiveForContext:true,isGlobal:false,tabUrlPattern:'session_test'},
  ...[1,2].map(n=>({id:`image-${n}`,title:`image ${n}`,fileName:`photo ${n}.png`,type:'image',dataUrl:png,content:'Image pending extraction',ocrStatus:'pending',createdAt:n,sizeBytes:10,isActiveForContext:true,isGlobal:false,tabUrlPattern:'session_test',mimeType:'image/png'})),
];
const settings = {selectedMode:'free',activeProvider:'openai',free:{baseUrl:'http://127.0.0.1:5173/fake/v1',apiKey:'test-key',model:'test-model'},openai:{baseUrl:'',apiKey:'',model:''},anthropic:{baseUrl:'',apiKey:'',model:''},autoConfirmSubmit:false};
await page.addInitScript(({docs,settings})=>{
  const stored={autoform_settings:settings,autoform_chat_sessions:[{id:'session_test',title:'Job Find',createdAt:1,updatedAt:1}],openbua_last_active_session_id:'session_test',autoform_tab_mem_session_test:docs,openbua_last_active_nav_tab:'chat'};
  for(const [k,v] of Object.entries(stored))localStorage.setItem(k,JSON.stringify(v));
},{docs,settings});
const requests=[];
await page.route('**/fake/v1/chat/completions',async route=>{
  const data=route.request().postDataJSON();requests.push(data);
  const text=data.messages.some(m=>Array.isArray(m.content)&&m.content.some(c=>c.type==='image_url'))?'Visual description: a small white square. OCR: sample image text.':'Read the referenced attachment.';
  if(data.stream){await route.fulfill({contentType:'text/event-stream',body:`data: ${JSON.stringify({id:'test',object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:null}]})}\n\ndata: ${JSON.stringify({id:'test',choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`});}
  else await route.fulfill({json:{id:'test',object:'chat.completion',choices:[{index:0,message:{role:'assistant',content:text},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}});
});
try{
  await page.goto('http://127.0.0.1:5173/sidepanel.html');
  await page.getByLabel('Attached files',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Attached files',{exact:true}).getByRole('button').count(),3);
  const input=page.locator('textarea');
  await input.fill('Describe @img2');
  await page.getByRole('listbox').waitFor();
  await input.press('Enter');
  assert.equal(await input.inputValue(),'Describe @img2 ');
  assert.equal(await page.getByRole('listbox').count(),0);
  if (process.env.OPENBUA_UI_SCREENSHOT) await page.screenshot({path:process.env.OPENBUA_UI_SCREENSHOT});
  await input.press('Enter');
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('autoform_tab_mem_session_test')).find(d=>d.id==='image-2').ocrStatus==='done');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('autoform_tab_mem_session_test')).find(d=>d.id==='image-2'));
  assert.match(saved.content,/Visual description/);assert.equal(saved.dataUrl,png);
  assert.equal(requests.filter(r=>r.messages.some(m=>Array.isArray(m.content)&&m.content.some(c=>c.type==='image_url'))).length,1);
  await page.waitForFunction(() => document.body.textContent.includes('Read the referenced attachment.'));
  assert.ok(requests.some(r=>JSON.stringify(r.messages).includes('image-2')&&JSON.stringify(r.messages).includes('sample image text')));
  // Exercise the built content script in real Chrome with Easy Apply-style
  // hidden controls, checking File bytes and the site's change handler.
  const uploadPage = await browser.newPage();
  await uploadPage.setContent('<input type="file" accept="image/*" id="media"><div role="dialog"><label for="resume">Upload resume</label><input type="file" accept=".pdf,.doc,.docx" id="resume" style="display:none"><span id="uploaded-name"></span></div>');
  await uploadPage.evaluate(() => {
    window.chrome ||= {};
    window.chrome.runtime = {onMessage:{addListener(listener){window.testUploadListener = listener;}}};
    document.getElementById('resume').addEventListener('change', event => {
      document.getElementById('uploaded-name').textContent = event.target.files[0]?.name;
    });
  });
  await uploadPage.addScriptTag({path:fileURLToPath(new URL('../dist/content.js', import.meta.url))});
  const call = request => uploadPage.evaluate(request => new Promise(resolve => window.testUploadListener(request, {}, resolve)), request);
  const inspection = await call({action:'INSPECT_PAGE_FORM'});
  const hiddenResume = inspection.data.fields.find(field=>field.id==='resume');
  assert.equal(hiddenResume.type,'file');assert.equal(hiddenResume.isVisible,false);assert.equal(hiddenResume.accept,'.pdf,.doc,.docx');
  const raw = '%PDF-1.4 exact resume bytes';
  await call({action:'PREPARE_FILE_UPLOAD',transferId:'browser-upload',fileName:'new-resume.pdf',mimeType:'application/pdf',totalChunks:1});
  await call({action:'FILE_UPLOAD_CHUNK',transferId:'browser-upload',index:0,data:Buffer.from(raw).toString('base64')});
  const upload = await call({action:'COMMIT_FILE_UPLOAD',transferId:'browser-upload',selector:'input[type="file"]',dropEvents:false});
  assert.ok(upload.success,upload.message);
  assert.equal(await uploadPage.locator('#uploaded-name').textContent(),'new-resume.pdf');
  assert.equal(await uploadPage.evaluate(()=>document.getElementById('resume').files[0].text()),raw);
  assert.equal(await uploadPage.evaluate(()=>document.getElementById('media').files.length),0);
  console.log('PASS Chrome hidden resume upload: exact bytes, compatible selector and site change event');
  console.log('PASS browser: floating shelf, @ autocomplete, keyboard insertion, VLM-before-chat, persisted memory and preserved raw bytes');
}finally{await browser.close();}

