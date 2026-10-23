import {useState} from 'react';
import {ChevronDown,Check,LoaderCircle,TriangleAlert,Terminal} from 'lucide-react';
import type {ToolCallState} from '../../types';
export function toolDetail(value:unknown) {
  try{return JSON.stringify(value,(key,item)=>/password|api[_-]?key|authorization|access[_-]?token|dataUrl/i.test(key)?'[redacted]':item,2) || '';}catch{return 'Tool output could not be formatted.';}
}
export function ToolChips({calls}:{calls:ToolCallState[]}) {
  const [open,setOpen]=useState(false),[rows,setRows]=useState<Set<string>>(new Set());
  return <section className="agent-tool-chips"><button type="button" className="agent-trace-heading" aria-expanded={open} onClick={()=>setOpen(!open)}><Terminal size={13}/><span>{calls.length} tool {calls.length===1?'call':'calls'}</span><ChevronDown size={13} className={open?'agent-chevron-open':''}/></button>
    {open&&<div className="agent-tool-list">{calls.map(call=>{const expanded=rows.has(call.id),target=call.args?.refId||call.args?.selector||call.args?.fileName||call.args?.url||call.args?.query||call.status;
      return <div key={call.id} className="agent-tool-item"><button type="button" className="agent-tool-row" aria-expanded={expanded} onClick={()=>setRows(current=>{const next=new Set(current);expanded?next.delete(call.id):next.add(call.id);return next;})}>
        {call.status==='running'?<LoaderCircle size={13} className="agent-spin"/>:call.status==='error'?<TriangleAlert size={13} className="agent-error"/>:<Check size={13}/>}
        <span>{call.toolName}</span><code title={String(target)}>{String(target)}</code><ChevronDown size={12} className={expanded?'agent-chevron-open':''}/></button>
        {expanded&&<div className="agent-tool-detail"><strong>Arguments</strong><pre>{toolDetail(call.args)}</pre>{call.result!==undefined&&<><strong>Result</strong><pre>{toolDetail(call.result)}</pre></>}{call.errorMessage&&<p className="agent-error">{call.errorMessage}</p>}</div>}
      </div>;
    })}</div>}
  </section>;
}
