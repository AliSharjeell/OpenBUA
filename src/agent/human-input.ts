import type {AgentTool} from '@earendil-works/pi-agent-core';
import {Type} from '@sinclair/typebox';

export type InputQuestion={q:string;type:'radio'|'check'|'text';options:string[]};
export type InputRequest={id:string;questions:InputQuestion[]};
export type InputAnswer={selected:string[];custom:string};
export class HumanInput {
  current:InputRequest|null=null;
  private listeners=new Set<()=>void>();
  private finish?: (value:{skipped:boolean;answers:InputAnswer[]})=>void;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private notify(){for(const listener of this.listeners)listener();}
  answer(id:string,answers:InputAnswer[],skipped=false) {
    if(!this.current || this.current.id!==id)throw new Error('This question is no longer pending.');
    if(!skipped && (answers.length!==this.current.questions.length || this.current.questions.some((question,index)=>{
      const answer=answers[index];return !answer || !Array.isArray(answer.selected) || answer.selected.some(value=>!question.options.includes(value)) || (question.type==='radio' && answer.selected.length>1) || (!answer.selected.length && !answer.custom?.trim());
    })))throw new Error('Answer every question or skip the request.');
    this.finish?.({skipped,answers:skipped?[]:answers});
  }
  cancel(){this.finish?.({skipped:true,answers:[]});}
  tool():AgentTool<any> {
    return {name:'request_user_input',label:'Ask for missing information',description:'Pause for one to six concise questions when a required fact, preference or consent is missing. The user answers a real card in chat. Use actual options from the page, or text for an open answer. Never infer personal facts or fabricate consent. Does not submit any form.',parameters:Type.Object({questions:Type.Array(Type.Object({q:Type.String({minLength:1,maxLength:500}),type:Type.Union([Type.Literal('radio'),Type.Literal('check'),Type.Literal('text')]),options:Type.Array(Type.String(),{maxItems:12})}),{minItems:1,maxItems:6})}),
      execute:async(_id,params,signal)=>{
        if(this.current)throw new Error('An input request is already pending.');
        if(signal?.aborted)throw new Error('Input request stopped.');
        const request={id:crypto.randomUUID(),questions:params.questions} as InputRequest;
        const value=await new Promise<{skipped:boolean;answers:InputAnswer[]}>(resolve=>{
          const abort=()=>this.finish?.({skipped:true,answers:[]});
          this.finish=value=>{signal?.removeEventListener('abort',abort);this.finish=undefined;this.current=null;this.notify();resolve(value);};
          this.current=request;signal?.addEventListener('abort',abort,{once:true});this.notify();
        });
        return {content:[{type:'text',text:JSON.stringify({questions:request.questions,...value})}],details:{questions:request.questions,...value}};
      }};
  }
}
