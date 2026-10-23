import type {AgentTool} from '@earendil-works/pi-agent-core';
import {getActiveTab} from './browser-bridge';

export function inPageFormFingerprint() {
  const nodes=Array.from(document.querySelectorAll<HTMLInputElement>('input,textarea,select,[role="combobox"],[role="radio"],[role="checkbox"],button[aria-expanded],button[aria-pressed]')).slice(0,250);
  return JSON.stringify([location.href,performance.timeOrigin,nodes.map(node=>[node.id,node.getAttribute('data-autoform-ref'),node.type==='password'?'[redacted]':node.value,node.checked,node.disabled,node.getAttribute('aria-invalid'),node.getAttribute('aria-expanded'),node.getAttribute('aria-pressed')])]);
}
export function protectFormRecovery(tools:AgentTool<any>[]) {
  const failures=new Map<string,string>();
  return tools.map<AgentTool<any>>(tool=>!['fill_form_fields','click_element','upload_file_to_form'].includes(tool.name)?tool:{...tool,execute:async(id,params:any,...rest)=>{
    const tab=await getActiveTab();
    const key=JSON.stringify([tab?.id,tool.name,params.frameId,(params.assignments||[]).map((a:any)=>[a.refId,a.selector,a.value]),params.refId,params.selector,params.text,params.fileName]);
    const observe=async()=>{try {return tab?.id && !params.frameId?(await chrome.scripting.executeScript({target:{tabId:tab.id},func:inPageFormFingerprint}))[0]?.result:undefined;}catch{return undefined;}};
    if(failures.has(key)) {
      const current=await observe();
      if(current && current===failures.get(key)) {
        const details={success:false,dispatched:false,recoveryRequired:true,message:'This exact action already failed on the unchanged form. No retry was dispatched. Inspect current validation and controls, change the target/value/approach, or request the specific missing user information.'};
        return {content:[{type:'text' as const,text:JSON.stringify(details)}],details};
      }
    }
    const result=await tool.execute(id,params,...rest),details=result.details as any;
    if(details?.success===false || details?.error || details?.errors?.length) {
      const state=await observe();if(state){if(failures.size>=60)failures.delete(failures.keys().next().value!);failures.set(key,state);}
    } else failures.delete(key);
    return result;
  }});
}
