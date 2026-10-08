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
    assert.ok(calls.filter(c=>c.func.name!=='inPageFindUploadTarget').every(c=>c.target.frameIds[0]===3));
  }
  console.log('PASS Chrome-serializable upload arguments: filename only, refId only, selector only, and frame routing');
}finally{rmSync(out,{force:true});}
