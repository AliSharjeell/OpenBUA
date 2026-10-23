import {useEffect,useState} from 'react';

const delays=Array.from({length:9},(_,i)=>{const row=Math.floor(i/3),column=i%3;return (column+Math.abs(row-1))*90;});
export function LoadingPill({label='Working'}:{label?:string}) {
  const [startedAt]=useState(()=>Date.now()),[now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),100);return()=>clearInterval(timer);},[]);
  const seconds=Math.max(0,(now-startedAt)/1000),elapsed=seconds<60?`${seconds.toFixed(1)}s`:`${Math.floor(seconds/60)}m ${(seconds%60).toFixed(1)}s`;
  return <div className="openbua-working-pill pointer-events-auto" role="status"><span aria-hidden="true" className="openbua-drive-grid">{delays.map((delay,index)=><i key={index} style={{animationDelay:`${delay}ms`}}/>)}</span><span className="openbua-working-label">{label}</span><span aria-hidden="true" className="openbua-working-time">{elapsed}</span></div>;
}
