import type {AppSettings} from '../../types';
import {Plus,BookOpen,ChevronRight,Check} from 'lucide-react';
export const FORM_COMMANDS=[
  {name:'/fill',description:'Fill from your saved facts',prompt:'Inspect this form and fill the known fields from my active saved documents. Ask for required missing information.'},
  {name:'/inspect',description:'Read fields and validation',prompt:'Inspect this page’s form fields, required answers and current validation errors. Do not change anything yet.'},
  {name:'/verify',description:'Check the current form',prompt:'Verify the currently filled form against my active saved documents and report missing or incorrect values. Do not submit.'},
  {name:'/summarize',description:'Summarize this page',prompt:'Summarize the current page and cite the actual source URL.'},
];
export function CommandMenu({commands,index,onPick}:{commands:typeof FORM_COMMANDS;index:number;onPick:(text:string)=>void}) {
  return <div className="agent-composer-menu" role="listbox" id="form-commands" aria-label="Commands">{commands.map((command,i)=><button type="button" role="option" aria-selected={index===i} data-active={index===i} key={command.name} onMouseDown={event=>event.preventDefault()} onClick={()=>onPick(command.prompt)}><span>{command.name}</span><small>{command.description}</small></button>)}</div>;
}
export function SourceMenu({onAttach,onMemory,onReference}:{onAttach:()=>void;onMemory:()=>void;onReference:()=>void}) {
  return <div className="agent-composer-menu" aria-label="Attachments and sources"><button type="button" onClick={onAttach}><Plus size={15}/>Add photos & files<small>Upload from your computer</small></button><button type="button" onClick={onReference}><span>@</span>Reference a saved attachment</button><button type="button" onClick={onMemory}><BookOpen size={14}/>Manage Memory<ChevronRight size={12}/></button></div>;
}
export function ModelMenu({settings,onPick,onConfigure}:{settings:AppSettings;onPick:(provider:'free'|'openai'|'anthropic')=>void;onConfigure:()=>void}) {
  const choices=[{key:'free' as const,name:settings.free.model,ready:Boolean(settings.free.apiKey),label:'Free'},{key:'openai' as const,name:settings.openai.model,ready:Boolean(settings.openai.apiKey),label:'BYOK'},{key:'anthropic' as const,name:settings.anthropic.model,ready:Boolean(settings.anthropic.apiKey),label:'BYOK'}];
  return <div className="agent-composer-menu" role="menu" aria-label="Models">{choices.filter(choice=>choice.ready).map(choice=><button type="button" role="menuitemradio" aria-checked={settings.selectedMode==='free'?choice.key==='free':choice.key===settings.activeProvider} key={choice.key} onClick={()=>onPick(choice.key)}><span>{choice.name}</span><small>{choice.label}</small>{(settings.selectedMode==='free'?choice.key==='free':choice.key===settings.activeProvider)&&<Check size={12}/>}</button>)}<button type="button" role="menuitem" onClick={onConfigure}>Configure models<ChevronRight size={12}/></button></div>;
}
