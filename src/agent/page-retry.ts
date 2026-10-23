// Read-only classification before any reload: ordinary forms must not lose edits.
export function inPageUnavailable() {
  const text=(document.body?.innerText||'').slice(0,6000);
  const internal=location.protocol==='chrome-error:';
  const network=Boolean(document.querySelector('#main-frame-error,#error-information-popup-container')) && !document.querySelector('input:not([type="hidden"]),textarea,select') && /\bERR_(?:NAME_NOT_RESOLVED|CONNECTION_(?:REFUSED|RESET|TIMED_OUT|CLOSED)|TIMED_OUT|INTERNET_DISCONNECTED|HTTP_RESPONSE_CODE_FAILURE|EMPTY_RESPONSE)\b/.test(text);
  const server=/^(?:502 Bad Gateway|503 Service (?:Unavailable|Temporarily Unavailable)|504 Gateway Time-?out)\b/i.test(document.title.trim()) && !document.querySelector('input:not([type="hidden"]),textarea,select');
  return {unavailable:internal||network||server,evidence:internal?'Chrome network error page':network?(text.match(/ERR_[A-Z_]+/)||[])[0]:server?document.title:''};
}

export async function inspectUnavailable(tabId:number) {
  try {return (await chrome.scripting.executeScript({target:{tabId},func:inPageUnavailable}))[0]?.result || {unavailable:false,evidence:''};}
  catch(error) {
    const message=String(error);
    return {unavailable:/chrome-error:\/\//i.test(message),evidence:/chrome-error:\/\//i.test(message)?'Chrome network error page':''};
  }
}

export async function reloadUnavailable(tabId:number) {
  const before=await inspectUnavailable(tabId);
  if(!before.unavailable)return {success:false,dispatched:false,message:'No supported network/server error is visible. The current form was preserved; do not reload a completed form.'};
  await chrome.tabs.reload(tabId);
  const deadline=Date.now()+8000;
  while(Date.now()<deadline) {
    await new Promise(resolve=>setTimeout(resolve,250));
    if((await chrome.tabs.get(tabId)).status==='complete')break;
  }
  const after=await inspectUnavailable(tabId);
  return {success:!after.unavailable,dispatched:true,evidence:after.evidence||before.evidence,message:after.unavailable?'The site is still unavailable after one Chrome reload. Report this technical blocker and continue other independent work only if authorized.':'Chrome reload completed. Inspect the actual page before resuming; a reload alone does not prove the form is ready.'};
}
