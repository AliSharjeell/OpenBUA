import type {FormFillResult,FieldFillVerification} from '../types';

// Serialized into the browser. Only exact, valid native text values can be a
// no-op. Autocomplete text, radios, selects, passwords and implicit Enter are not.
export function inPageCompletedFields(assignments:{refId?:string;selector?:string;value:string;pressEnter?:boolean}[]) {
  const roots:ParentNode[]=[];
  const visit=(root:ParentNode)=>{roots.push(root);for(const node of Array.from(root.querySelectorAll('*')))if(node.shadowRoot)visit(node.shadowRoot);};visit(document);
  return assignments.flatMap((assignment,index)=>{
    if(assignment.pressEnter)return [];
    let matches:Element[]=[];
    try {const selector=assignment.refId?`[data-autoform-ref="${CSS.escape(assignment.refId)}"]`:assignment.selector;if(!selector)return [];matches=roots.flatMap(root=>Array.from(root.querySelectorAll(selector)));}catch{return [];}
    if(matches.length!==1)return [];
    const node=matches[0];if(!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement))return [];
    if(!/^(?:text|email|tel|url|number|date|textarea)$/.test(node.type) || node.matches('[role="combobox"],[aria-autocomplete],[aria-haspopup],[aria-expanded],[aria-controls],[list]') || !node.validity.valid || node.getAttribute('aria-invalid')==='true')return [];
    if(!node.value || node.value.replace(/\r\n/g,'\n')!==String(assignment.value).replace(/\r\n/g,'\n'))return [];
    return [{index,refId:assignment.refId||'',selector:assignment.selector,requestedValue:assignment.value,actualValue:node.value,verified:true,elementFound:true}];
  });
}

export function mergeCompletedFields(result:FormFillResult,completed:FieldFillVerification[],total:number):FormFillResult {
  return {...result,totalRequested:total,successCount:result.successCount+completed.length,verifiedCount:(result.verifiedCount||0)+completed.length,verifications:[...completed,...result.verifications]};
}
