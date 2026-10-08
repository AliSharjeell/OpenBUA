import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, crc32 } from 'node:zlib';
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
function makeDocx(compress = true) {
  const name = Buffer.from('word/document.xml');
  const xml = Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Word resume &amp; profile</w:t></w:r></w:p><w:p><w:r><w:t>AI Engineer</w:t></w:r></w:p></w:body></w:document>');
  const data = compress ? deflateRawSync(xml) : xml;
  const local = Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(compress ? 8 : 0,8);local.writeUInt32LE(crc32(xml),14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(xml.length,22);local.writeUInt16LE(name.length,26);
  const central = Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(compress ? 8 : 0,10);central.writeUInt32LE(crc32(xml),16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(xml.length,24);central.writeUInt16LE(name.length,28);
  const directory = Buffer.concat([central,name]);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(local.length+name.length+data.length,16);
  return Buffer.concat([local,name,data,directory,end]);
}
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
  const word = makeDocx();
  await page.locator('input[type="file"]').setInputFiles({name:'new-resume.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:word});
  await page.getByLabel('Attached files',{exact:true}).getByText('new-resume.docx',{exact:true}).waitFor();
  await input.fill('Summarize @file2');
  await input.press('Enter');
  await input.press('Enter');
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('autoform_tab_mem_session_test')).find(d=>d.fileName==='new-resume.docx')?.ocrStatus==='done');
  const savedWord=await page.evaluate(()=>JSON.parse(localStorage.getItem('autoform_tab_mem_session_test')).find(d=>d.fileName==='new-resume.docx'));
  assert.equal(savedWord.content,'Word resume & profile\nAI Engineer');
  assert.ok(savedWord.dataUrl);
  const storedWordText=await page.evaluate(async bytes=>{
    const {extractTextFromDocx}=await import('/src/services/docx-parser.ts');
    return extractTextFromDocx(new Blob([new Uint8Array(bytes)]));
  },Array.from(makeDocx(false)));
  assert.equal(storedWordText,savedWord.content);
  const corruptWord=await page.evaluate(async()=>{
    const {extractTextFromDocx}=await import('/src/services/docx-parser.ts');
    try {await extractTextFromDocx(new Blob(['invalid archive']));return false;}catch{return true;}
  });
  assert.ok(corruptWord);
  console.log('PASS browser Word extraction: compressed/stored DOCX, paragraph text, invalid ZIP rejection, automatic memory persistence');
  // Exercise the built content script in real Chrome with Easy Apply-style
  // hidden controls, checking File bytes and the site's change handler.
  const uploadPage = await browser.newPage();
  await uploadPage.goto('http://127.0.0.1:5173/test-form.html');
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
  // LinkedIn consumes the File and clears its input while displaying a
  // selected resume card. That must not turn a successful delivery into failure.
  await uploadPage.evaluate(() => {
    document.querySelector('[role="dialog"]').insertAdjacentHTML('beforeend', '<label id="resume-card"><span id="resume-filename"></span><input type="radio" name="resume-choice" checked></label>');
    document.getElementById('resume').addEventListener('change', event => {
      window.receivedResume = event.target.files[0].text();
      document.getElementById('resume-filename').textContent = event.target.files[0].name;
      event.target.value = '';
    });
  });
  await call({action:'PREPARE_FILE_UPLOAD',transferId:'reset-upload',fileName:'resume.pdf',mimeType:'application/pdf',totalChunks:1});
  await call({action:'FILE_UPLOAD_CHUNK',transferId:'reset-upload',index:0,data:Buffer.from(raw).toString('base64')});
  const resetResult=await call({action:'COMMIT_FILE_UPLOAD',transferId:'reset-upload',selector:'#resume',dropEvents:false});
  assert.equal(resetResult.success,true,resetResult.message);assert.equal(resetResult.attached,false);
  assert.match(resetResult.message,/Do not upload again/);
  assert.equal(await uploadPage.evaluate(()=>window.receivedResume),raw);
  assert.equal(await uploadPage.evaluate(()=>document.getElementById('resume').files.length),0);
  const verify = () => uploadPage.evaluate(async()=>{
    const {verifyFileUploadInTab} = await import('/src/agent/file-injection.ts');
    window.chrome.scripting = {executeScript:async injection=>{
      if(injection.args.some(value=>value===undefined))throw new Error('Value is unserializable');
      const args=JSON.parse(JSON.stringify(injection.args));
      return [{frameId:0,result:(new Function(`return (${injection.func.toString()})`))()(...args)}];
    }};
    return verifyFileUploadInTab(1,'resume.pdf');
  });
  const verified=await verify();assert.equal(verified.selected,true);assert.equal(verified.success,true);
  await uploadPage.evaluate(()=>{
    document.querySelector('#resume-card input').checked=false;
    document.querySelector('[role="dialog"]').insertAdjacentHTML('beforeend','<label>old-resume.pdf<input type="radio" name="resume-choice" checked></label>');
  });
  const unselected=await verify();assert.equal(unselected.selected,false);assert.equal(unselected.needsVerification,true);
  await uploadPage.evaluate(()=>{document.getElementById('resume-card').style.display='none';document.getElementById('uploaded-name').style.display='none';});
  assert.equal(await verify(),null,'hidden filename must not confirm an upload');
  console.log('PASS Chrome reset-input recovery, selected resume verification, sibling-selection isolation and hidden filename rejection');
  console.log('PASS Chrome hidden resume upload: exact bytes, compatible selector and site change event');
  console.log('PASS browser: floating shelf, @ autocomplete, keyboard insertion, VLM-before-chat, persisted memory and preserved raw bytes');
}finally{await browser.close();}

