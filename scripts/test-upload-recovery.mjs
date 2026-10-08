import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFileSync, rmSync } from 'node:fs';
const out = new URL('../.tmp-upload-recovery.mjs', import.meta.url);
const built = await build({entryPoints:['src/agent/file-injection.ts'],bundle:true,write:false,platform:'node',format:'esm'});
writeFileSync(out,built.outputFiles[0].text);
const calls=[];
globalThis.chrome={scripting:{async executeScript(injection){
  // Chrome rejects undefined array entries instead of converting them to null.
  assert.ok(injection.args.every(arg=>arg!==undefined),`${injection.func.name}: Value is unserializable`);
  assert.doesNotThrow(()=>JSON.stringify(injection.args));
  calls.push(injection);
  if(injection.func.name==='inPageVerifyFileUpload')return [{frameId:3,result:{state:globalThis.verificationState || 'not-found'}}];
  if(injection.func.name==='inPageFindUploadTarget')return [{frameId:3,result:1000}];
  if(injection.func.name==='inPageCommitTransfer')return [{frameId:3,result:{success:true,attached:true,message:'Attached resume.pdf'}}];
  return [{frameId:3,result:{ok:true}}];
}}};
try{
  const {injectFileIntoTab}=await import(out.href);
  for(const options of [{},{refId:'af_2'},{selector:'input[type="file"]'}]){
    calls.length=0;
    const result=await injectFileIntoTab(7,{fileName:'resume.pdf',mimeType:'application/pdf',source:{kind:'dataUrl',dataUrl:'data:application/pdf;base64,cGRm'},...options},async()=>{throw new Error('Content script unavailable');});
    assert.equal(result.success,true,result.message);
    assert.ok(calls.find(c=>c.func.name==='inPageCommitTransfer'));
    assert.ok(calls.filter(c=>['inPageBeginTransfer','inPagePushChunk','inPageCommitTransfer'].includes(c.func.name)).every(c=>c.target.frameIds[0]===3));
  }
  const request={fileName:'resume.pdf',mimeType:'application/pdf',source:{kind:'dataUrl',dataUrl:'data:application/pdf;base64,cGRm'}};
  const timeoutAfterDispatch=async(_tab, message)=>{
    if(message.action==='COMMIT_FILE_UPLOAD')throw new Error('Simulated lost upload response');
    return {success:true};
  };
  calls.length=0;
  globalThis.verificationState='selected';
  const recovered=await injectFileIntoTab(7,request,timeoutAfterDispatch);
  assert.equal(recovered.success,true);assert.equal(recovered.selected,true);assert.equal(recovered.verified,true);
  assert.match(recovered.message,/Do not upload it again/);
  assert.ok(calls.every(call=>call.func.name==='inPageVerifyFileUpload'),'response failure must not send the file twice');
  calls.length=0;
  globalThis.verificationState='not-found';
  const uncertain=await injectFileIntoTab(7,request,timeoutAfterDispatch);
  assert.equal(uncertain.success,false);assert.equal(uncertain.needsVerification,true);
  assert.match(uncertain.message,/Capture a screenshot/);
  assert.ok(calls.every(call=>call.func.name==='inPageVerifyFileUpload'),'unconfirmed commit must not trigger a second transport');
  globalThis.verificationState='present';
  const present=await injectFileIntoTab(7,request,async()=>({success:true,attached:false,message:'Input reset'}));
  assert.equal(present.success,true);assert.equal(present.selected,false);assert.equal(present.needsVerification,true);
  assert.match(present.message,/Verify that this file is selected/);
  console.log('PASS Chrome-serializable upload arguments: filename only, refId only, selector only, and frame routing');
}finally{rmSync(out,{force:true});}
