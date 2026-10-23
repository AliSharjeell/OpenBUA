import {useId,useState} from 'react';
import {ChevronDown,Check,LoaderCircle,TriangleAlert} from 'lucide-react';
export type TraceRow={id:string;label:string;secondary?:string;status?:'running'|'success'|'error';detail?:string;href?:string};
export function ThinkingState({label,done,working,rows,children}:{label:string;done:string;working:boolean;rows?:TraceRow[];children?:React.ReactNode}) {
  const [manual,setManual]=useState<boolean|null>(null),id=useId(),expanded=manual??working;
  return <section className="agent-trace">
    <button type="button" className="agent-trace-heading" aria-expanded={expanded} aria-controls={id} onClick={()=>setManual(!expanded)}><span className={working?'agent-shimmer':''}>{working?label:done}</span><ChevronDown size={13} className={expanded?'agent-chevron-open':''}/></button>
    {expanded && <div id={id} className="agent-trace-body">{children}{rows?.map(row=><div className="agent-trace-row" key={row.id}>{row.status==='running'?<LoaderCircle className="agent-spin" size={13}/>:row.status==='error'?<TriangleAlert className="agent-error" size={13}/>:<Check size={13}/>}<span>{row.label}</span>{row.secondary&&<small>{row.secondary}</small>}</div>)}</div>}
  </section>;
}
