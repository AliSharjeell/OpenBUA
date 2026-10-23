import {useCallback,useEffect,useRef,useState} from 'react';
type Recognition={start:()=>void;stop:()=>void;abort:()=>void;lang:string;continuous:boolean;interimResults:boolean;onresult:((event:any)=>void)|null;onend:(()=>void)|null;onerror:((event:any)=>void)|null};
export function useDictation(onTranscript:(text:string)=>void) {
  const [listening,setListening]=useState(false),[error,setError]=useState(''),ref=useRef<Recognition|null>(null),callback=useRef(onTranscript);callback.current=onTranscript;
  const Constructor=typeof window==='undefined'?undefined:(window as unknown as {SpeechRecognition?:new()=>Recognition;webkitSpeechRecognition?:new()=>Recognition}).SpeechRecognition || (window as unknown as {webkitSpeechRecognition?:new()=>Recognition}).webkitSpeechRecognition;
  const stop=useCallback(()=>ref.current?.stop(),[]);
  useEffect(()=>()=>{if(ref.current){ref.current.onend=null;ref.current.onresult=null;ref.current.onerror=null;ref.current.abort();}},[]);
  const toggle=()=>{
    if(listening){stop();return;}
    if(!Constructor)return;
    const recognition=new Constructor();ref.current=recognition;recognition.lang=navigator.language||'en-US';recognition.continuous=false;recognition.interimResults=false;
    recognition.onresult=event=>{let text='';for(let i=event.resultIndex;i<event.results.length;i++)if(event.results[i].isFinal)text+=event.results[i][0].transcript+' ';if(text.trim())callback.current(text.trim());};
    recognition.onend=()=>setListening(false);recognition.onerror=()=>{setListening(false);setError('Dictation could not continue. Check microphone permissions or type your message.');};
    setError('');try{recognition.start();setListening(true);}catch{setListening(false);setError('Dictation could not start. Check microphone permissions.');}
  };
  return {supported:Boolean(Constructor),listening,error,toggle,stop};
}
