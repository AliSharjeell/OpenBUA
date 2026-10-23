import {useEffect,useRef,useState} from 'react';
import {Globe,ChevronDown,ArrowUpRight} from 'lucide-react';
import {MarkdownRenderer} from '../MarkdownRenderer';
export function messageSources(content:string) {
  const sources=new Map<string,{href:string;label:string;domain:string}>();
  for(const match of content.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g))try{const url=new URL(match[2]);if(!url.username&&!url.password)sources.set(url.href,{href:url.href,label:match[1],domain:url.hostname});}catch{}
  return [...sources.values()];
}
export function StreamingText({content,streaming,onFollowUp,followUps=[]}:{content:string;streaming:boolean;onFollowUp?:(text:string)=>void;followUps?:string[]}) {
  const previous=useRef(''),[open,setOpen]=useState(false);
  const prefix=streaming&&content.startsWith(previous.current)?previous.current:'',delta=content.slice(prefix.length),sources=messageSources(content);
  useEffect(()=>{previous.current=content;},[content]);
  return <div className="agent-streaming-text">{streaming?<p className="agent-stream-prose">{prefix}<span key={content.length} className="agent-stream-word">{delta}</span><span className="agent-stream-caret" aria-hidden="true"/></p>:<MarkdownRenderer content={content}/>}
    {!streaming&&sources.length>0&&<div className="agent-sources"><button type="button" aria-expanded={open} onClick={()=>setOpen(!open)}><Globe size={12}/>{sources.length} {sources.length===1?'source':'sources'}<ChevronDown size={12} className={open?'agent-chevron-open':''}/></button>{open&&<div>{sources.map(source=><a key={source.href} href={source.href} target="_blank" rel="noreferrer"><span>{source.label}</span><small>{source.domain}</small></a>)}</div>}</div>}
    {!streaming&&onFollowUp&&followUps.length>0&&<div className="agent-follow-ups">{followUps.map(text=><button type="button" key={text} onClick={()=>onFollowUp(text)}><ArrowUpRight size={12}/>{text}</button>)}</div>}
  </div>;
}
