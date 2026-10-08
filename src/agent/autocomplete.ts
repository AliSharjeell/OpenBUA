export interface AutocompleteObservation {
  refId:string; selector:string; label:string; value:string;
  autocomplete:boolean; invalid:boolean; expanded:boolean;
  options:string[]; message:string; selected?:boolean; recovered?:boolean; needsSelection?:boolean;
}

// Chrome serializes this function. Keep every DOM helper inside its body.
export async function inPageAutocomplete(
  assignments:Array<{refId?:string;selector?:string;value:string}>=[],
  recover=false,
):Promise<AutocompleteObservation[]> {
  const visible=(el:Element)=>el.getClientRects().length>0 && getComputedStyle(el).visibility!=='hidden';
  const normalize=(s:string)=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const find=(a:{refId?:string;selector?:string})=>{
    if(a.refId) return document.querySelector(`[data-autoform-ref="${CSS.escape(a.refId)}"]`);
    try {return a.selector?document.querySelector(a.selector):null;} catch {return null;}
  };
  const targets=assignments.length?assignments.map(a=>({el:find(a),requested:a.value}))
    :Array.from(document.querySelectorAll('input, textarea')).filter(visible).map(el=>({el,requested:(el as HTMLInputElement).value}));
  const observations:AutocompleteObservation[]=[];
  for(const {el,requested} of targets) {
    if(!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) continue;
    const input=el;
    const root=input.closest('.MuiAutocomplete-root, [data-autocomplete]') || input.parentElement?.closest('[role="combobox"]') || input.parentElement;
    const combo=input.getAttribute('role')==='combobox' || input.hasAttribute('aria-autocomplete')
      || Boolean(input.closest('.MuiAutocomplete-root, [data-autocomplete]'));
    // Email recipient widgets have their own chip semantics.
    const autocomplete=combo && input.type!=='email' && !/recipient|^to$|^cc$|^bcc$/i.test(input.getAttribute('aria-label')||'');
    const label=input.getAttribute('aria-label') || input.labels?.[0]?.textContent?.trim()
      || root?.previousElementSibling?.textContent?.trim() || input.name || input.placeholder;
    const popup=()=>{
      const ids=(input.getAttribute('aria-controls') || input.getAttribute('aria-owns') || '').split(/\s+/).filter(Boolean);
      const linked=ids.map(id=>document.getElementById(id)).find(node=>node && visible(node));
      if(linked) return linked;
      const local=root?.querySelector('[role="listbox"], .MuiAutocomplete-noOptions');
      if(local && visible(local))return local;
      // MUI renders "No options" in a portal without a listbox or aria-controls.
      // Only associate that portal when exactly one combobox is expanded.
      const expanded=document.querySelectorAll('input[aria-expanded="true"]');
      if(expanded.length===1 && expanded[0]===input) {
        const poppers=Array.from(document.querySelectorAll('.MuiAutocomplete-popper, [data-autocomplete-popup]')).filter(visible);
        if(poppers.length===1)return poppers[0];
      }
      return null;
    };
    const options=()=>Array.from(popup()?.querySelectorAll('[role="option"]')||[]).filter(visible)
      .filter(option=>option.getAttribute('aria-disabled')!=='true');
    const invalid=()=>input.getAttribute('aria-invalid')==='true' || Boolean(input.validity && !input.validity.valid);
    const feedback=()=>{
      const ids=[input.getAttribute('aria-errormessage'),input.getAttribute('aria-describedby')].filter(Boolean).join(' ').split(/\s+/);
      const messages=ids.map(id=>document.getElementById(id)).filter((node):node is HTMLElement=>Boolean(node && visible(node))).map(node=>node.innerText);
      const noOptions=popup()?.textContent?.match(/no options|no results|not found|no matching/i)?.[0];
      return [...messages,noOptions].filter(Boolean).join(' · ');
    };
    const requestedParts=requested.split(',').map(normalize).filter(Boolean);
    let selected=input.dataset.openbuaSelectedOption===input.value && !invalid()
      && requestedParts.every(part=>` ${normalize(input.value)} `.includes(` ${part} `));
    let recovered=false;
    const failureKey=()=>JSON.stringify([requested,input.value,feedback()]);
    const sameFailure=input.dataset.openbuaAutocompleteFailure===failureKey() && !options().length;
    if(recover && autocomplete && requested && !selected && !sameFailure) {
      input.dataset.openbuaRequestedOption=requested;
      input.focus();
      // Open an existing typed query without submitting the containing form.
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',code:'ArrowDown',keyCode:40,bubbles:true}));
      const queries=[requested];
      if(requested.includes(',') && /location|city|state|town/i.test(label)) queries.push(requested.split(',')[0].trim());
      for(const query of queries) {
        const changed=input.value!==query;
        if(changed) {
          const prototype=input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype,'value')?.set?.call(input,query);
          input.dispatchEvent(new Event('input',{bubbles:true}));
          input.dispatchEvent(new Event('change',{bubbles:true}));
        }
        const deadline=Date.now()+1200;
        const started=Date.now();
        let candidates:Element[]=[];
        // Return as soon as options or explicit empty feedback arrive.
        while(Date.now()<deadline) {
          candidates=options();
          if(candidates.length || ((!changed || Date.now()-started>=350) && /no options|no results|not found|no matching/i.test(feedback()))) break;
          await new Promise(resolve=>setTimeout(resolve,40));
        }
        const parts=requested.split(',').map(normalize).filter(Boolean);
        const matches=candidates.filter(option=>parts.every(part=>` ${normalize(option.textContent||'')} `.includes(` ${part} `)));
        const exact=matches.filter(option=>normalize(option.textContent||'')===normalize(requested));
        const choice=exact.length===1?exact[0]:matches.length===1?matches[0]:null;
        if(!choice) continue;
        const chosen=(choice.textContent||'').trim();
        (choice as HTMLElement).click();
        const finish=Date.now()+400;
        while(Date.now()<finish) {
          if(!invalid() && input.getAttribute('aria-expanded')!=='true' && normalize(input.value)===normalize(chosen)) {
            selected=true;input.dataset.openbuaSelectedOption=input.value;break;
          }
          await new Promise(resolve=>setTimeout(resolve,20));
        }
        if(selected){recovered=query!==requested;delete input.dataset.openbuaAutocompleteFailure;break;}
      }
      if(!selected)input.dataset.openbuaAutocompleteFailure=failureKey();
    }
    observations.push({refId:input.getAttribute('data-autoform-ref')||'',selector:input.id?`#${CSS.escape(input.id)}`:'',
      label,value:input.value,autocomplete,invalid:invalid(),expanded:input.getAttribute('aria-expanded')==='true',
      options:options().slice(0,10).map(option=>(option.textContent||'').trim()),message:feedback(),selected,recovered,
      needsSelection:autocomplete && Boolean(input.dataset.openbuaRequestedOption) && !selected});
  }
  return observations;
}

export async function inspectAutocomplete(tabId:number, assignments:Array<{refId?:string;selector?:string;value:string}>=[], recover=false) {
  const result=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:inPageAutocomplete,args:[assignments,recover]});
  return result[0]?.result || [];
}
