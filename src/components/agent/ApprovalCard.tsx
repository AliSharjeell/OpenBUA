import {useState} from 'react';
import {ChevronLeft,ChevronRight,ArrowUpRight} from 'lucide-react';
import type {InputRequest,InputAnswer} from '../../agent/human-input';
export function ApprovalCard({request,onSubmit,onSkip}:{request:InputRequest;onSubmit:(answers:InputAnswer[])=>void;onSkip:()=>void}) {
  const [index,setIndex]=useState(0),[answers,setAnswers]=useState<InputAnswer[]>(()=>request.questions.map(()=>({selected:[],custom:''}))),[error,setError]=useState('');
  const question=request.questions[index],answer=answers[index],last=index===request.questions.length-1,hasAnswer=answer.selected.length>0||Boolean(answer.custom.trim());
  const update=(value:InputAnswer)=>setAnswers(current=>current.map((old,i)=>i===index?value:old));
  const advance=()=>{if(!last){setIndex(index+1);return;}const missing=answers.findIndex(answer=>!answer.selected.length&&!answer.custom.trim());if(missing>=0){setIndex(missing);setError('Answer this question or skip the request.');return;}try{onSubmit(answers);}catch(error){setError((error as Error).message);}};
  return <section className="agent-approval" aria-label="Your answer needed"><span className="agent-eyebrow">Your answer needed</span><h3>{question.q}</h3>
    <div className="agent-choice-list" role={question.type==='radio'?'radiogroup':undefined} aria-label={question.q}>{question.type!=='text'&&question.options.map(option=><label key={option} className="agent-choice"><input type={question.type==='check'?'checkbox':'radio'} name={request.id+'-'+index} checked={answer.selected.includes(option)} onChange={()=>update({custom:'',selected:question.type==='radio'?[option]:answer.selected.includes(option)?answer.selected.filter(value=>value!==option):[...answer.selected,option]})}/><span>{option}</span></label>)}</div>
    <textarea aria-label="Your answer" value={answer.custom} placeholder={question.type==='text'?'Write your answer…':'Something else…'} onChange={event=>update({selected:question.type==='radio'?[]:answer.selected,custom:event.target.value})}/>
    {error&&<p role="alert" className="agent-error">{error}</p>}
    <footer><div className="agent-question-nav"><button type="button" aria-label="Previous question" disabled={!index} onClick={()=>setIndex(index-1)}><ChevronLeft size={14}/></button><span key={index}>{index+1} / {request.questions.length}</span><button type="button" aria-label="Next question" disabled={last} onClick={()=>setIndex(index+1)}><ChevronRight size={14}/></button></div><div><button type="button" className="agent-quiet-button" onClick={onSkip}>Skip request</button><button type="button" className="agent-send-answer" disabled={!hasAnswer} onClick={advance}>{last?'Send answer':'Continue'}<ArrowUpRight size={13}/></button></div></footer>
  </section>;
}
