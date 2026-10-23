import {useEffect,useState} from 'react';
import {ChevronDown,Check,LoaderCircle,TriangleAlert} from 'lucide-react';
import {getBrowserWindowId} from '../../agent/window-context';
type Task={id:string;label:string;state:string;result:string;windowId?:number};
export function TaskRows({sessionId}:{sessionId?:string}) {
  const [tasks,setTasks]=useState<Task[]>([]),[expanded,setExpanded]=useState<Set<string>>(new Set());
  useEffect(()=>{
    if(!sessionId || typeof chrome==='undefined' || !chrome.storage)return;
    const update=(jobs:Record<string,any>)=>setTasks(Object.values(jobs).filter(job=>job.parentSessionId===sessionId && job.ownerWindowId===getBrowserWindowId()).map(job=>({id:job.id,label:job.task?.instruction||'Browser task',state:job.state,result:job.result||'',windowId:job.windowId})));
    void chrome.storage.local.get('openbua_parallel_jobs').then(data=>update(data.openbua_parallel_jobs||{}));
    const changed=(changes:Record<string,chrome.storage.StorageChange>)=>{if(changes.openbua_parallel_jobs)update(changes.openbua_parallel_jobs.newValue||{});};
    chrome.storage.onChanged.addListener(changed);return()=>chrome.storage.onChanged.removeListener(changed);
  },[sessionId]);
  if(!tasks.length)return null;
  return <section className="agent-task-rows" aria-label="Browser tasks">{tasks.map(task=>{const running=['starting','running'].includes(task.state),done=['completed','done'].includes(task.state),open=expanded.has(task.id);return <div className="agent-task" key={task.id}>
    <button type="button" aria-expanded={open} onClick={()=>setExpanded(current=>{const next=new Set(current);open?next.delete(task.id):next.add(task.id);return next;})}>{running?<LoaderCircle size={19} className="agent-spin"/>:done?<Check size={19} className="agent-success"/>:<TriangleAlert size={19} className="agent-error"/>}<span>{task.label}</span><small data-state={task.state}>{task.state}</small><ChevronDown size={13} className={open?'agent-chevron-open':''}/></button>
    {open&&<div className="agent-task-detail">{task.result||'Waiting for the browser worker’s next update.'}</div>}
  </div>;})}</section>;
}
