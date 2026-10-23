import {useEffect,useState} from 'react';
export type LoadingVariant='Drive'|'Dots'|'Orbit'|'Surfer';
const order=[0,1,2,5,8,7,6,3];
export function LoaderGrid({variant='Drive'}:{variant?:LoadingVariant}) {
  return <span aria-hidden="true" className={`agent-pixels ${variant==='Dots'?'agent-pixels-round':''}`}>{Array.from({length:9},(_,i)=>{
    const delay=variant==='Orbit'?(order.indexOf(i)<0?null:order.indexOf(i)*110):(i%3+Math.abs(Math.floor(i/3)-1))*90;
    return <i key={i} style={{animationDelay:`${delay||0}ms`,animationDuration:variant==='Orbit'?'950ms':'650ms',...(delay===null?{animation:'none',opacity:.07}:{})}}/>;
  })}</span>;
}
export function LoadingState({label='Working',variant='Drive',startedAt,videoSrc='https://95dnc2a95qgwt9ff.public.blob.vercel-storage.com/subway-surfers-min.mp4'}:{label?:string;variant?:LoadingVariant;startedAt:number;videoSrc?:string}) {
  const [now,setNow]=useState(Date.now()),[videoOk,setVideoOk]=useState(true),[style,setStyle]=useState<LoadingVariant>(variant);
  useEffect(()=>{if(typeof chrome!=='undefined' && chrome.storage)void chrome.storage.local.get('openbua_activity_style').then(data=>{if(['Drive','Dots','Orbit','Surfer'].includes(data.openbua_activity_style))setStyle(data.openbua_activity_style);}).catch(()=>{});},[]);
  useEffect(()=>setVideoOk(true),[style,videoSrc]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),100);return()=>clearInterval(timer);},[startedAt]);
  const seconds=Math.max(0,(now-startedAt)/1000),elapsed=seconds<60?`${seconds.toFixed(1)}s`:`${Math.floor(seconds/60)}m ${(seconds%60).toFixed(1)}s`;
  return <div className="agent-loading" role="status"><div className="agent-loading-line"><LoaderGrid variant={style}/><span className="agent-shimmer">{label}</span><span className="agent-elapsed" aria-hidden="true">{elapsed}</span><select className="agent-style-select" aria-label="Activity animation" value={style} onChange={event=>{const value=event.target.value as LoadingVariant;setStyle(value);if(typeof chrome!=='undefined' && chrome.storage)void chrome.storage.local.set({openbua_activity_style:value});}}>{['Drive','Dots','Orbit','Surfer'].map(value=><option key={value}>{value}</option>)}</select></div>
    {style==='Surfer' && videoSrc && <div className="agent-video">{videoOk?<video src={videoSrc} autoPlay muted loop playsInline onError={()=>setVideoOk(false)}/>:<span>Video unavailable</span>}</div>}
  </div>;
}
