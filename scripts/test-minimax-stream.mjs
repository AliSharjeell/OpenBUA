import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {writeFileSync,rmSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const path=resolve('.tmp-minimax-stream.mjs');
const result=await build({entryPoints:['src/agent/stream-adapter.ts'],bundle:true,write:false,platform:'node',format:'esm',external:['@earendil-works/*'],plugins:[{name:'mock-tools',setup(builder){builder.onResolve({filter:/^\.\/tools$/},()=>({path:'tools',namespace:'mock'}));builder.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const ALL_AGENT_TOOLS=[];'}));}}]});
writeFileSync(path,result.outputFiles[0].text);
const original=globalThis.fetch;
try {
 const {createStreamFn,createCustomModel}=await import(pathToFileURL(path).href);
 const config={provider:'anthropic',baseUrl:'https://api.minimax.io/anthropic',apiKey:'fixture-only',model:'MiniMax-M3.1-Flash[1m]',reasoningEffort:'low'};
 const thinking='Preserved provider continuity. '.repeat(70),signature='opaque-provider-signature';
 const events=[
  {type:'content_block_start',index:0,content_block:{type:'thinking',thinking:''}},
  {type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking}},
  {type:'content_block_delta',index:0,delta:{type:'signature_delta',signature}},
  {type:'content_block_stop',index:0},
  {type:'content_block_start',index:1,content_block:{type:'tool_use',id:'call-one',name:'read_form'}},
  {type:'content_block_delta',index:1,delta:{type:'input_json_delta',partial_json:'{}'}},
  {type:'content_block_stop',index:1},
  {type:'message_delta',delta:{stop_reason:'tool_use'}},
  {type:'message_stop'}];
 const requests=[];
 globalThis.fetch=async(url,options)=>{requests.push({url,payload:JSON.parse(options.body)});return new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{status:200});};
 const stream=await createStreamFn(config,createCustomModel(config),{messages:[{role:'user',content:'Inspect form'}],systemPrompt:'Fixture'});
 let message;for await(const event of stream){assert.notEqual(event.type,'error');if(event.type==='done')message=event.message;}
 assert.equal(message.content[0].thinking,thinking);assert.equal(message.content[0].thinkingSignature,signature);assert.equal(message.stopReason,'toolUse');
 const second=await createStreamFn(config,createCustomModel(config),{messages:[{role:'user',content:'Inspect form'},message,{role:'toolResult',toolCallId:'call-one',toolName:'read_form',content:[{type:'text',text:'Email required'}]}],systemPrompt:'Fixture'});
 for await(const event of second)assert.notEqual(event.type,'error');
 for(const request of requests){assert.equal(request.url,'https://api.minimax.io/anthropic/v1/messages');assert.deepEqual(request.payload.output_config,{effort:'low'});assert.equal(request.payload.thinking,undefined);}
 const history=requests[1].payload.messages.find(message=>message.role==='assistant').content;
 assert.deepEqual(history[0],{type:'thinking',thinking,signature});assert.equal(history[1].type,'tool_use');
 assert.equal(requests[1].payload.messages.at(-1).content[0].tool_use_id,'call-one');
 console.log('PASS: actual MiniMax streaming payload uses low effort and preserves full thinking, signature and tool-result continuity across turns (mock provider)');
} finally {globalThis.fetch=original;rmSync(path,{force:true});}
