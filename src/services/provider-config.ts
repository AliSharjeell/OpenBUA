import type {AppSettings,ProviderConfig} from '../types';

export function resolveProviderConfig(settings:AppSettings):ProviderConfig {
  if(settings.selectedMode==='free')return {...settings.free,provider:'openai',mode:'free',isFreeMode:true};
  const selected=settings[settings.activeProvider];
  return {...selected,provider:settings.activeProvider,mode:'byok',isFreeMode:false,
    ...(/MiniMax-M3\.1-Flash/i.test(selected.model) && !selected.reasoningEffort?{reasoningEffort:'low' as const}:{})};
}
export function providerEffortOptions(config:ProviderConfig) {
  let host='';try{host=new URL(config.baseUrl).hostname;}catch{return {};}
  if(!/(^|\.)(?:minimax|minimaxi)\.(?:io|cn)$/.test(host) || !/MiniMax-M3\.1-Flash/i.test(config.model))return {};
  const effort=config.reasoningEffort || 'low';
  return config.provider==='anthropic'?{output_config:{effort}}:{reasoning_effort:effort};
}
export function providerEndpoint(config:Pick<ProviderConfig,'provider'|'baseUrl'>) {
  const base=config.baseUrl.trim().replace(/\/+$/,'');
  if(config.provider==='anthropic')return base.endsWith('/messages')?base:`${base}${base.endsWith('/v1')?'':'/v1'}/messages`;
  return base.endsWith('/chat/completions')?base:`${base}${/\/v\d+(?:beta\d*)?(?:\/openai)?$/.test(base)?'':'/v1'}/chat/completions`;
}
