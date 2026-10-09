import { inspectApplicationStatus, describeApplicationStatus } from './application-status';
import { prepareApplicationAction, finishApplicationAction, type ApplicationActionContext } from './application-action';
import { inspectAutocomplete } from './autocomplete';
import { inspectSelectionControls } from './selection-controls';
import { readCommunityRules, observeRulesPage, completedRulesNavigation, describeCommunityRules } from './community-rules';
import { writeRedditDraft } from './reddit-editor';
import { inPageReadYouTubeVideos } from './youtube-page';
import { redditPostAction, redditPostingCooldown } from './reddit-submit';
import { reviewRedditDraft } from './reddit-review';
import { xCommunityAction, interceptXCommunityClick } from './x-community';
import { protectPageTrust, type PageTrustPolicy } from './page-trust';
// Tool definitions conforming to @earendil-works/pi-agent-core AgentTool interface
import { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';
import { checkCanvasTextInsertion } from './canvas-edit-check';
import { protectDocsEdits, DocsEditPolicy } from './docs-edit-safety';
import { inspectDocsEditorTool, selectDocsTextTool, setDocsFormattingTool, docsClipboardTool, findDocsTextTool, confirmDocsCloneTool } from './docs-tools';
import {
  inspectActiveTabForm,
  fillActiveTabFields,
  clickActiveTabElement,
  scrollActiveTab,
  getActiveTabPageContent,
  listAllTabs,
  switchTab,
  createNewTab,
  closeBrowserTab,
  navigateActiveTab,
  captureTabScreenshot,
  pressKeyCombination,
  sendWebEmailDirect,
  checkUrlReachable,
  searchWeb,
  uploadFileToActiveTab,
  getActiveTab,
  clickAtPosition,
  typeActiveTabText,
  getActiveTabViewport,
  clipboardAction,
} from './browser-bridge';
import {
  findPlatform,
  resolvePlatformForUrl,
  openPlatformComposer,
  describePlatforms,
  SUPPORTED_PLATFORM_IDS,
} from './social-platforms';
import {
  getActiveContextMemories,
  getActiveSessionIdState,
  getScratchpad,
  saveScratchpad,
  appendToScratchpad,
  clearScratchpad,
  saveSuggestedMemory,
} from '../services/storage';

async function beginApplicationAction() {
  const tab = await getActiveTab();
  return tab?.id && /linkedin\.com\/jobs|careers|application|apply/i.test(tab.url || '')
    ? prepareApplicationAction(tab.id) : undefined;
}

async function recoverBeforeAdvance(params:{refId?:string;selector?:string;text?:string;x?:number;y?:number}) {
  const tab=await getActiveTab();
  if(!tab?.id || typeof chrome==='undefined' || !chrome.scripting) return null;
  const membership = await interceptXCommunityClick({ id: tab.id, url: tab.url }, params);
  if (membership) return membership;
  if (/reddit\.com\/r\/[^/]+\/submit/i.test(tab.url || '')) {
    let posting = /^(?:post|submit|publish)$/i.test(params.text || '');
    if (!params.text) {
      const targets = await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [params.refId || '', params.selector || '', params.x ?? null, params.y ?? null], func: (ref: string, selector: string, x: number | null, y: number | null) => {
        const find = (root: ParentNode): Element | null => {
          let direct: Element | null = null;
          try { direct = root.querySelector(ref ? `[data-autoform-ref="${CSS.escape(ref)}"]` : selector || ':not(*)'); } catch {}
          if (direct) return direct;
          for (const host of Array.from(root.querySelectorAll('*'))) if (host.shadowRoot) { const match = find(host.shadowRoot); if (match) return match; }
          return null;
        };
        let target = ref || selector ? find(document) : x !== null && y !== null ? document.elementFromPoint(x / (devicePixelRatio || 1), y / (devicePixelRatio || 1)) : null;
        while (target?.shadowRoot && x !== null && y !== null) {
          const inner = target.shadowRoot.elementFromPoint(x / (devicePixelRatio || 1), y / (devicePixelRatio || 1));
          if (!inner || inner === target) break; target = inner;
        }
        const button = target?.closest('button,[role="button"],input[type="submit"],r-post-form-submit-button');
        const label = (button?.getAttribute('aria-label') || button?.textContent || '').trim();
        if (/save.?draft/i.test(button?.id || '') || /^(?:save draft|drafts?|cancel)$/i.test(label)) return false;
        if (button?.id === 'inner-post-submit-button' || button?.tagName === 'R-POST-FORM-SUBMIT-BUTTON') return true;
        if (/^(?:post|submit|publish)$/i.test(label)) return true;
        const host = (button?.getRootNode() as ShadowRoot | undefined)?.host;
        return !label && host?.tagName === 'R-POST-FORM-SUBMIT-BUTTON' && /^post$/i.test((host.textContent || '').trim());
      } });
      posting = Boolean(targets[0]?.result);
    }
    if (posting) {
      return redditPostAction(tab.id, true);
    }
  }
  const hit=await chrome.scripting.executeScript({target:{tabId:tab.id},args:[params.refId||'',params.selector||'',params.text||'',params.x??null,params.y??null],func:(refId:string,selector:string,text:string,x:number|null,y:number|null)=>{
    let target:Element|null=null;
    if(refId) target=document.querySelector(`[data-autoform-ref="${CSS.escape(refId)}"]`);
    else if(selector){try{target=document.querySelector(selector);}catch{}}
    else if(x!==null && y!==null) target=document.elementFromPoint(x/(devicePixelRatio||1),y/(devicePixelRatio||1))?.closest('button,[role="button"],input[type="submit"]')||null;
    else if(text) target=Array.from(document.querySelectorAll('button,[role="button"],input[type="submit"]')).find(el=>el.getClientRects().length && (el.textContent||el.getAttribute('value')||'').trim().toLowerCase()===text.toLowerCase().trim())||null;
    const label=(target?.textContent||target?.getAttribute('value')||'').trim();
    if(!/^(?:next|continue|save\s*(?:&|and)\s*continue|submit(?: application)?|apply now)$/i.test(label)) return null;
    const scope=target?.closest('form')||document;
    return Array.from(scope.querySelectorAll('input, textarea'))
      .filter(el=>el.getClientRects().length).map(el=>{
        const input=el as HTMLInputElement;
        let value=input.value;
        try {
          const failed=JSON.parse(input.dataset.openbuaAutocompleteFailure||'null');
          if(failed?.[1]===value) value=failed[0];
        } catch {}
        return {refId:el.getAttribute('data-autoform-ref')||'',selector:el.id?`#${CSS.escape(el.id)}`:'',value};
      });
  }});
  const fields=hit[0]?.result;
  if(!fields?.length) return null;
  const observations=await inspectAutocomplete(tab.id,fields,true);
  const blocked=observations.filter(field=>field.invalid || (field.autocomplete && Boolean(field.value.trim()) && !field.selected));
  if(!blocked.length)return null;
  return {success:false,dispatched:false,validationBlocked:true,fields:blocked,
    message:`Cannot advance: ${blocked.map(field=>`${field.label||field.refId}: ${field.message||'a dropdown option has not been selected'}; query "${field.value}"; options: ${field.options.join(', ')||'none'}`).join('; ')}. Fix the named field or use a shorter search and select an option. Dismissing the popup and repeating Next will not fix validation. No Next/Submit click was dispatched.`};
}

async function observeApplicationAction(message: string, dispatched: boolean, context?: ApplicationActionContext) {
  if (!context) return {message,success:dispatched};
  const action = await finishApplicationAction(context);
  if (dispatched && action.blockedUrl) {
    const tabs = await listAllTabs();
    const existing = tabs.find(tab => tab.url === action.blockedUrl);
    const tabId = existing ? (await switchTab(existing.id), existing.id) : await createNewTab(action.blockedUrl);
    if (tabId) return {message:`${message}\nOpened the website's external application destination in tab ${tabId}: ${action.blockedUrl}. Inspect that tab to continue.`,
      success:true,dispatched,externalTabId:tabId,applicationStatus:{state:'unconfirmed' as const,evidence:'External application opened; not submitted',actions:[],url:action.blockedUrl}};
  }
  const outcome = await inspectApplicationStatus(context.tabId, dispatched && action.submission, context.before.feedback || []);
  // Navigation and intermediate steps remain successful dispatches. Only an
  // actual submission attempt can fail due to application outcome feedback.
  const note = action.submission ? describeApplicationStatus(outcome) : '';
  return {message:note ? `${message}\n\n${note}` : message,
    success:dispatched && !(action.submission && outcome.state === 'rejected'), dispatched, submissionVerified:outcome.state === 'submitted',
    applicationStatus:outcome};
}

export const verifyApplicationStatusTool: AgentTool<any> = {
  name:'verify_application_status',label:'Verify Application Outcome',
  description:'Read the current application step and visible success/error feedback. Use after submitting or when a job may be closed. A dispatched click does not prove submission.',
  parameters:Type.Object({}),
  execute:async()=>{
    const tab=await getActiveTab();
    if (tab?.id && /^https:\/\/(?:www\.|old\.|new\.)?reddit\.com\//i.test(tab.url || '')) {
      const result = await redditPostAction(tab.id, false);
      return { content: [{ type: 'text', text: result.message }], details: result as any };
    }
    const outcome=tab?.id ? await inspectApplicationStatus(tab.id) : {state:'unconfirmed' as const,evidence:'No active application tab',actions:[]};
    return {content:[{type:'text',text:describeApplicationStatus(outcome)||'No application UI detected.'}],details:{...outcome,submissionVerified:outcome.state==='submitted'}};
  },
};

// 1. Inspect Form Elements on Current Tab
const GetActiveTabFormSchema = Type.Object({
  includeButtons: Type.Optional(Type.Boolean({ description: 'Whether to include action buttons (Next, Submit, etc.)' })),
  selector: Type.Optional(Type.String({ description: 'Optional CSS selector to scope inspection to a specific dialog or container (e.g. "[role=dialog]" or ".M9")' })),
});

export const getActiveTabFormTool: AgentTool<typeof GetActiveTabFormSchema> = {
  name: 'get_active_tab_form',
  label: 'Inspect Active Form',
  description: 'Inspect all form fields, input elements, textareas, dropdown selects, buttons, and multi-step indicators on the current tab. Automatically prioritizes active modals, popups, and compose windows.',
  parameters: GetActiveTabFormSchema,
  execute: async (_toolCallId, params): Promise<AgentToolResult> => {
    try {
      const summary = await inspectActiveTabForm(params.selector);
      const activeTab = await getActiveTab();
      const observations = activeTab?.id ? await inspectAutocomplete(activeTab.id).catch(()=>[]) : [];
      const selection = activeTab?.id && typeof chrome !== 'undefined' && chrome.scripting
        ? await inspectSelectionControls(activeTab.id, params.selector).catch(() => ({ scopeFound: true, scopes: [], controls: [] }))
        : { scopeFound: true, scopes: [], controls: [] };
      for (const field of summary.fields) {
        const observed = observations.find(item=>item.refId===field.refId);
        if (!observed) continue;
        if (!field.label && observed.label) field.label=observed.label;
        if (observed.autocomplete) {
          field.type='autocomplete';
          field.options=observed.options.map(label=>({value:label,label,selected:label===observed.value}));
          field.sectionHint=[field.sectionHint,observed.message,observed.needsSelection?'Dropdown selection required':''].filter(Boolean).join(' · ');
        }
        if(observed.invalid) field.sectionHint=[field.sectionHint,'INVALID',observed.message].filter(Boolean).join(' · ');
      }
      const totalFields = summary.fields.length;
      const visibleFields = summary.fields.filter(f => f.isVisible);
      const fieldsToShow = summary.fields.filter(f => f.isVisible || f.type === 'file').slice(0, 100);
      const buttons = summary.buttons.slice(0, 30);
      
      let textOutput = `Found ${totalFields} fields (${visibleFields.length} visible, showing ${fieldsToShow.length}) on page "${summary.title}":\n\n` +
        `Current URL: ${summary.url}\n` +
        (summary.stepIndicators.length > 0 ? `Step Progress: ${summary.stepIndicators.join(' | ')}\n\n` : '') +
        `Fields:\n` +
        fieldsToShow.map(f => {
          let desc = `- [refId: ${f.refId}] Label: "${f.label || f.name || f.placeholder || 'Unnamed'}" | Type: ${f.type}`;
          if (f.type === 'file') desc += ` | Accepts: ${f.accept || '*/*'}${f.isVisible ? '' : ' | Hidden upload control (usable by upload_file_to_form)'}`;
          if (f.disabled) desc += ' | Disabled';
          if (f.placeholder) desc += ` | Placeholder: "${f.placeholder}"`;
          if (f.value) desc += ` | Current Value: "${f.value}"`;
          if (f.sectionHint) desc += ` | Section: "${f.sectionHint}"`;
          if (f.required) desc += ` (REQUIRED)`;
          if (f.options && f.options.length > 0) {
            desc += ` | Options: [${f.options.map(o => `"${o.label}" (value: "${o.value}")`).slice(0, 6).join(', ')}]`;
          }
          return desc;
        }).join('\n');

      if (buttons.length > 0) {
        textOutput += `\n\nAction Buttons:\n` +
          buttons.map(b => `- [refId: ${b.refId}] "${b.text}" (${b.isSubmit ? 'SUBMIT' : b.isNext ? 'NEXT STEP' : 'Action'})`).join('\n');
      }

      if (!selection.scopeFound) textOutput += `\nRequested scope was not found. Actual visible popup scopes: ${JSON.stringify(selection.scopes)}. Do not assume the popup is empty.`;
      if (selection.controls.length) textOutput += '\n\nSelection Controls (click the exact refId, then verify selection before applying):\n' + selection.controls.map(control =>
        `- [refId: ${control.refId}] "${control.label}" | ${control.role} | ${control.selected ? 'SELECTED' : 'not selected'}${control.disabled ? ' | Disabled' : ''}`
      ).join('\n');
      Object.assign(summary, { selectionControls: selection.controls, scopeFound: selection.scopeFound, popupScopes: selection.scopes });
      return {
        content: [{ type: 'text', text: textOutput }],
        details: {...summary, fields:fieldsToShow.map(field=>({...field,options:field.options?.length
          ? [...field.options.filter(option=>option.selected),...field.options.filter(option=>!option.selected)].slice(0,12) : field.options})),buttons} as any,
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Failed to inspect form: ${err?.message || err}` }],
        details: { error: String(err) },
      };
    }
  },
};

// 2. Fill Form Fields
const FillFormFieldsSchema = Type.Object({
  assignments: Type.Array(
    Type.Object({
      refId: Type.Optional(Type.String({ description: 'The refId from get_active_tab_form (e.g. "af_1")' })),
      selector: Type.Optional(Type.String({ description: 'CSS selector if refId is not available' })),
      value: Type.String({ description: 'The exact value to set into the input/select/textarea' }),
      reason: Type.Optional(Type.String({ description: 'Explanation of which user data was matched to this field' })),
      pressEnter: Type.Optional(Type.Boolean({ description: 'If true, automatically dispatches Enter immediately after typing this field (ideal for sending chat messages in 1 single turn)' })),
    }),
    { description: 'List of fields and values to fill' }
  ),
  pressEnter: Type.Optional(Type.Boolean({ description: 'If true, automatically dispatches Enter immediately after filling the fields (ideal for sending WhatsApp/chat messages or submitting search in 1 single turn)' })),
});

export const fillFormFieldsTool: AgentTool<typeof FillFormFieldsSchema> = {
  name: 'fill_form_fields',
  label: 'Fill Form Fields',
  description: 'Fills form fields on the active webpage with the provided values. Compatible with React, Vue, contenteditable rich text editors, and standard HTML forms. Supports pressEnter: true to type and send messages or submit search in a single action.',
  parameters: FillFormFieldsSchema,
  execute: async (_toolCallId, params): Promise<AgentToolResult> => {
    try {
      const result = await fillActiveTabFields(params.assignments, params.pressEnter);
      
      const verificationLines = (result.verifications || []).map((v) => {
        const id = v.refId || v.selector || 'field';
        if (v.verified) {
          return `  - [${id}]: [VERIFIED - Field successfully populated and active in DOM]`;
        } else if (!v.elementFound) {
          return `  - [${id}]: [NOT FOUND]`;
        } else {
          return `  - [${id}]: [UNVERIFIED] in DOM (Requested: "${v.requestedValue.slice(0, 30)}", Actual on page: "${v.actualValue.slice(0, 30)}")`;
        }
      });

      let text = `Filled ${result.successCount} of ${params.assignments.length} fields successfully.\n`;
      if (verificationLines.length > 0) {
        text += `DOM Verifications:\n${verificationLines.join('\n')}\n`;
      }
      if (result.errors.length > 0) {
        text += `Errors:\n${result.errors.join('\n')}`;
      }

      return {
        content: [{ type: 'text', text: text.trim() }],
        details: { ...result, assignments: params.assignments },
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Failed to fill fields: ${err?.message || err}` }],
        details: { error: String(err) },
      };
    }
  },
};

// 3. Click Element
const ClickElementSchema = Type.Object({
  refId: Type.Optional(Type.String({ description: 'The refId of the button/element' })),
  text: Type.Optional(Type.String({ description: 'The visible text on the button (e.g. "Next", "Save & Continue")' })),
  selector: Type.Optional(Type.String({ description: 'CSS selector if refId/text is not known' })),
});

export const clickElementTool: AgentTool<typeof ClickElementSchema> = {
  name: 'click_element',
  label: 'Click Button / Element',
  description: 'Clicks a button or link on the active webpage, such as "Next", "Continue", "Add Experience", or form tabs.',
  parameters: ClickElementSchema,
  execute: async (_toolCallId, params): Promise<AgentToolResult> => {
    try {
      const blocked = await recoverBeforeAdvance(params);
      if(blocked) return {content:[{type:'text',text:blocked.message}],details:blocked as any};
      const context = await beginApplicationAction();
      const result = await clickActiveTabElement(params);
      const observed = await observeApplicationAction(result.message, result.success, context);
      return {
        content: [{ type: 'text', text: observed.message }],
        details: { ...result, ...observed } as any,
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Failed to click element: ${err?.message || err}` }],
        details: { error: String(err) },
      };
    }
  },
};

// 4. Scroll Page
const ScrollPageSchema = Type.Object({
  direction: Type.Union([
    Type.Literal('down'),
    Type.Literal('up'),
    Type.Literal('top'),
    Type.Literal('bottom'),
    Type.Literal('element'),
  ], { description: 'Direction or target to scroll' }),
  selector: Type.Optional(Type.String({ description: 'CSS selector if scrolling to a specific element' })),
});

export const scrollPageTool: AgentTool<typeof ScrollPageSchema> = {
  name: 'scroll_page',
  label: 'Scroll Webpage',
  description: 'Scrolls the active webpage or chat message container down, up, top, bottom, or to a specific element to reveal older messages, more fields, or lazy-loaded elements.',
  parameters: ScrollPageSchema,
  execute: async (_toolCallId, params): Promise<AgentToolResult> => {
    try {
      const res = await scrollActiveTab(params.direction as any, params.selector);
      const text = res.message || `Scrolled page ${params.direction}`;
      return {
        content: [{ type: 'text', text }],
        details: { scrolled: res.success, direction: params.direction, message: res.message },
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Failed to scroll page: ${err?.message || err}` }],
        details: { error: String(err) },
      };
    }
  },
};

// 5. Get User Stored Documents / Profile Data
const GetUserDocumentsSchema = Type.Object({
  query: Type.Optional(Type.String({ description: 'Optional search keyword to find specific information' })),
});

export const getUserDocumentsTool: AgentTool<typeof GetUserDocumentsSchema> = {
  name: 'get_user_documents',
  label: 'Read User Documents / Profile',
  description: 'Reads the user stored documents, resumes, PDF text, and profiles from local extension storage to obtain accurate personal and application data.',
  parameters: GetUserDocumentsSchema,
  execute: async (_toolCallId, params): Promise<AgentToolResult> => {
    try {
      const docs = await getActiveContextMemories(getActiveSessionIdState());
      const activeDocs = docs.filter(d => d.isActiveForContext);

      if (activeDocs.length === 0) {
        return {
          content: [{ type: 'text', text: 'No active user documents or profile data found in local storage.' }],
          details: { documentsCount: 0 },
        };
      }

      let formatted = `Found ${activeDocs.length} active documents in user storage:\n\n`;
      activeDocs.forEach((doc, idx) => {
        let meta = `${doc.type}`;
        if (doc.fileCategory) meta += `, category: ${doc.fileCategory}`;
        meta += `, upload ID: "${doc.id}"`;
        if (doc.fileName) meta += `, filename: "${doc.fileName}"`;
        if (doc.filePath) meta += `, path: "${doc.filePath}"`;
        if (doc.videoDuration) meta += `, duration: ${doc.videoDuration}s`;
        if (doc.dataUrl || doc.blobKey) meta += `, raw file attachment available for form upload`;
        formatted += `### Document ${idx + 1}: ${doc.title} (${meta})\n${doc.content}\n\n`;
      });

      return {
        content: [{ type: 'text', text: formatted }],
        details: {
          documents: activeDocs.map(d => ({
            id: d.id,
            title: d.title,
            type: d.type,
            fileName: d.fileName,
            fileCategory: d.fileCategory,
            filePath: d.filePath,
            videoDuration: d.videoDuration,
            hasRawFile: Boolean(d.dataUrl || d.blobKey),
          })),
        },
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Failed to read documents: ${err?.message || err}` }],
        details: { error: String(err) },
      };
    }
  },
};

// 6. Capture Visible Tab Screenshot
const CaptureTabScreenshotSchema = Type.Object({});

export const captureTabScreenshotTool: AgentTool<typeof CaptureTabScreenshotSchema> = {
  name: 'capture_tab_screenshot',
  label: 'Capture Screenshot',
  description:
    'Captures a screenshot of the visible area of the current active browser tab for visual inspection. The result also reports the page\'s CSS viewport size and device pixel ratio. Screenshot pixels may be larger than CSS pixels on a HiDPI display; click_at_position takes screenshot pixel coordinates and converts them for you, so just read the position off the image and pass it straight through.',
  parameters: CaptureTabScreenshotSchema,
  execute: async (): Promise<AgentToolResult> => {
    try {
      const dataUrl = await captureTabScreenshot();
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      const mimeType = match ? match[1] : 'image/jpeg';
      const base64Data = match ? match[2] : dataUrl;

      // Report the real CSS viewport so coordinate arithmetic is never guesswork.
      const viewport = await getActiveTabViewport().catch(() => null);
      const geometry = viewport
        ? ` CSS viewport: ${viewport.width}x${viewport.height}px, devicePixelRatio ${viewport.devicePixelRatio}.` +
          (viewport.devicePixelRatio !== 1
            ? ` This screenshot is ${viewport.devicePixelRatio}x the CSS viewport; click_at_position converts coordinates for you.`
            : '')
        : '';

      return {
        content: [
          { type: 'text', text: `Screenshot captured successfully of current browser tab.${geometry}` },
          { type: 'image', data: base64Data, mimeType } as any,
        ],
        details: {
          dataUrl: dataUrl.slice(0, 100) + '...',
          size: base64Data.length,
          viewport: viewport
            ? { width: viewport.width, height: viewport.height, devicePixelRatio: viewport.devicePixelRatio }
            : undefined,
        } as any,
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Failed to capture screenshot: ${err?.message || err}. Use get_active_tab_form or get_page_content. Do not keep requesting screenshots or waiting for a cooldown.` }],
        details: { success: false, error: String(err), recovery: 'inspect-dom' },
      };
    }
  },
};

// 7. List Open Browser Tabs
const ListBrowserTabsSchema = Type.Object({});

export const listBrowserTabsTool: AgentTool<typeof ListBrowserTabsSchema> = {
  name: 'list_browser_tabs',
  label: 'List Browser Tabs',
  description: 'Lists all open tabs in the current browser window with their IDs, titles, URLs, and active status.',
  parameters: ListBrowserTabsSchema,
  execute: async (): Promise<AgentToolResult> => {
    try {
      const tabs = await listAllTabs();
      const text = tabs
        .map((t) => {
          let cleanUrl = t.url;
          if (cleanUrl.length > 90) {
            try {
              const u = new URL(cleanUrl);
              cleanUrl = `${u.origin}${u.pathname}${u.search ? '?...' : ''}`;
              if (cleanUrl.length > 90) cleanUrl = cleanUrl.slice(0, 87) + '...';
            } catch {
              cleanUrl = cleanUrl.slice(0, 87) + '...';
            }
          }
          return `- [Tab ${t.id}] ${t.active ? '(ACTIVE) ' : ''}"${t.title.slice(0, 60)}" - ${cleanUrl}`;
        })
        .join('\n');
      return {
        content: [{ type: 'text', text: `Open tabs (${tabs.length} total):\n${text}` }],
        details: { tabsCount: tabs.length },
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Failed to list tabs: ${err?.message || err}` }],
        details: { error: String(err) },
      };
    }
  },
};

// 8. Switch Browser Tab
const SwitchBrowserTabSchema = Type.Object({
  tabId: Type.Number({ description: 'The ID of the tab to switch to' }),
});

export const switchBrowserTabTool: AgentTool<typeof SwitchBrowserTabSchema> = {
  name: 'switch_browser_tab',
  label: 'Switch Active Tab',
  description: 'Switches the active browser focus to another tab by tabId.',
  parameters: SwitchBrowserTabSchema,
  execute: async (_toolCallId, params): Promise<AgentToolResult> => {
    try {
      const success = await switchTab(params.tabId);
      return {
        content: [{ type: 'text', text: success ? `Switched to tab ${params.tabId}` : `Failed to switch to tab ${params.tabId}` }],
        details: { success, tabId: params.tabId },
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Failed to switch tab: ${err?.message || err}` }],
        details: { error: String(err) },
      };
    }
  },
};

// 9. Navigate Active Tab
const NavigateBrowserTabSchema = Type.Object({
  url: Type.String({ description: 'The URL to navigate the active tab to' }),
});

export const navigateBrowserTabTool: AgentTool<typeof NavigateBrowserTabSchema> = {
  name: 'navigate_browser_tab',
  label: 'Navigate Tab URL',
  description: 'Navigates the active browser tab to a specified URL. WARNING: This replaces the current page — if you are mid-form, use open_new_tab instead to avoid losing form progress!',
  parameters: NavigateBrowserTabSchema,
  execute: async (_toolCallId, params): Promise<AgentToolResult> => {
    try {
      const completed = completedRulesNavigation(params.url);
      if (completed) return { content: [{ type: 'text', text: describeCommunityRules(completed) }],
        details: { dispatched: false, navigationSkipped: true, lookupComplete: true, communityRules: completed } };
      const res = await navigateActiveTab(params.url);
      if (!res.success && res.blockedByCaptcha) {
        return {
          content: [{ type: 'text', text: `[BLOCKED BY CAPTCHA]: ${res.message}` }],
          details: res,
        };
      }
      return {
        content: [{ type: 'text', text: res.success ? `Navigated active tab to ${params.url}` : `Failed to navigate tab: ${res.message || ''}` }],
        details: res,
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Failed to navigate tab: ${err?.message || err}` }],
        details: { error: String(err) },
      };
    }
  },
};

// 10. Get Page Content
const GetPageContentSchema = Type.Object({});

export const getPageContentTool: AgentTool<typeof GetPageContentSchema> = {
  name: 'get_page_content',
  label: 'Get Page Content',
  description: 'Extracts full readable text content and metadata from the active webpage.',
  parameters: GetPageContentSchema,
  execute: async (): Promise<AgentToolResult> => {
    try {
      const resPromise = getActiveTabPageContent(4000);
      const timeoutPromise = new Promise<{ text: string; title: string; url: string }>((resolve) =>
        setTimeout(
          () =>
            resolve({
              title: 'Extraction Timeout',
              url: '',
              text: 'Page content extraction timed out after 6 seconds. Proceed with other actions or navigate if needed.',
            }),
          6000
        )
      );
      const res = await Promise.race([resPromise, timeoutPromise]);
      const rules = observeRulesPage(res);
      return {
        content: [{ type: 'text', text: `Page Title: ${res.title}\nURL: ${res.url}\n\nContent:\n${res.text}${rules ? '\n\n' + describeCommunityRules(rules) : ''}` }],
        details: { ...res, ...(rules ? { communityRules: rules } : {}) },
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Failed to get page text: ${err?.message || err}` }],
        details: { error: String(err) },
      };
    }
  },
};

function createRedditPostTool(submit: boolean): AgentTool {
  return {
    name: submit ? 'submit_reddit_post' : 'verify_reddit_post', label: submit ? 'Submit Reddit Post' : 'Verify Reddit Post',
    description: submit ? 'Submit the fully prepared Reddit draft through its actual Post button after review_reddit_post checks are resolved. Reports requirements or matching permalink, including observed removals. A task removal stops the batch. No coordinate guessing or automatic re-clicks. Call only when the user authorized posting.' : 'Read-only Reddit publication verification. Checks matching permalink/title and removal notices, distinguishing submitted-but-removed from visible or unconfirmed. Never clicks or posts.',
    parameters: Type.Object({}),
    execute: async (): Promise<AgentToolResult> => {
      const tab = await getActiveTab();
      if (!tab?.id || !/^https:\/\/(?:www\.|old\.|new\.)?reddit\.com\//i.test(tab.url || '')) return { content: [{ type: 'text', text: 'Open the target Reddit page first.' }], details: { success: false } };
      try {
        const result = await redditPostAction(tab.id, submit);
        return { content: [{ type: 'text', text: result.message }], details: result as any };
      } catch (error: any) { return { content: [{ type: 'text', text: `Reddit outcome is unconfirmed: ${error?.message || error}. Do not repeat Post; inspect the page.` }], details: { success: false, state: 'unconfirmed' } }; }
    },
  };
}
export const submitRedditPostTool = createRedditPostTool(true);
export const verifyRedditPostTool = createRedditPostTool(false);

export const readYouTubeVideosTool: AgentTool = {
  name: 'read_youtube_videos', label: 'Read YouTube Videos',
  description: 'Read actual video titles and watch URLs in displayed order on YouTube search or channel pages. Excludes channel avatars, tabs and playlist links. Waits briefly for real results instead of fixed sleeps. Use videos[0].url with navigate_browser_tab for the first video.',
  parameters: Type.Object({}),
  execute: async (): Promise<AgentToolResult> => {
    const tab = await getActiveTab();
    if (!tab?.id || !/^https:\/\/(?:www\.)?youtube\.com\//i.test(tab.url || '')) return { content: [{ type: 'text', text: 'Open the YouTube search or channel page first.' }], details: { success: false } };
    try {
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: inPageReadYouTubeVideos });
      const result = results[0]?.result;
      return { content: [{ type: 'text', text: JSON.stringify(result || { message: 'Could not inspect YouTube. Use get_page_content.' }) }], details: { ...result, success: Boolean(result?.videos.length) } };
    } catch (error: any) { return { content: [{ type: 'text', text: `Could not read YouTube videos: ${error?.message || error}. Use get_page_content instead of random clicks.` }], details: { success: false } }; }
  },
};

const PrepareRedditPostSchema = Type.Object({
  title: Type.String({ description: 'Single-line post title, separate from body' }),
  body: Type.String({ description: 'Complete post body, with blank lines between paragraphs and standalone URLs separated from following text' }),
});
export const prepareRedditPostTool: AgentTool<typeof PrepareRedditPostSchema> = {
  name: 'prepare_reddit_post', label: 'Prepare Reddit Post',
  description: 'Replace and fully verify a Reddit draft using distinct title/body fields. Preserves paragraphs using Markdown mode when available, otherwise editor paste. Does not submit. Use this for repairs instead of typing at an uncertain caret.',
  parameters: PrepareRedditPostSchema,
  execute: async (_id, params): Promise<AgentToolResult> => {
    const tab = await getActiveTab();
    if (!tab?.id || !/^https:\/\/(?:www\.|old\.|new\.)?reddit\.com\/r\/[^/]+\/submit\/?(?:\?|$)/i.test(tab.url || '')) return { content: [{ type: 'text', text: 'Open the target Reddit submit page first.' }], details: { success: false } };
    try {
      const result = await writeRedditDraft(tab.id, [{ role: 'title', value: params.title }, { role: 'body', value: params.body }]);
      const success = result.successCount === 2 && result.errors.length === 0;
      return { content: [{ type: 'text', text: success ? 'Distinct title and complete body verified, including paragraph breaks. Draft prepared; not submitted. If the user authorized posting, use submit_reddit_post next, not coordinate clicks or verify_application_status.' : `Draft needs repair; do not append or submit. ${result.errors.join('\n')}` }], details: { ...result, success } };
    } catch (error: any) { return { content: [{ type: 'text', text: `Draft write could not be confirmed. Inspect before retrying: ${error?.message || error}` }], details: { success: false } }; }
  },
};

export const readCommunityRulesTool: AgentTool = {
  name: 'read_community_rules',
  label: 'Read Community Rules',
  description: 'Read the active Reddit community rules and visible sidebar/composer guidance in one bounded lookup. Returns found, explicit empty, or unavailable. Reuses the result for five minutes; do not cycle alternate rules pages afterwards.',
  parameters: Type.Object({}),
  execute: async (): Promise<AgentToolResult> => {
    try {
      const result = await readCommunityRules();
      return { content: [{ type: 'text', text: `${describeCommunityRules(result)}\n\n${JSON.stringify(result)}` }], details: result };
    } catch (error: any) {
      return { content: [{ type: 'text', text: error?.message || String(error) }], details: { error: String(error) } };
    }
  },
};

export const reviewRedditPostTool: AgentTool = {
  name: 'review_reddit_post', label: 'Review Reddit Draft',
  description: 'Review the exact prepared Reddit draft before publishing. Retrieves cached community rules/sidebar guidance, flags duplicate submissions and observed removals, and lists promotion, link, flair/tag and factual-claim checks. This is not a guarantee of moderation approval. Resolve the checks before submit_reddit_post.',
  parameters: Type.Object({}),
  execute: async (): Promise<AgentToolResult> => {
    try {
      const tab = await getActiveTab();
      if (!tab?.id) throw new Error('Open the prepared Reddit draft first.');
      const result = await reviewRedditDraft(tab.id);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
    } catch (error: any) { return { content: [{ type: 'text', text: error?.message || String(error) }], details: { state: 'blocked' } }; }
  },
};

const JoinXCommunitySchema = Type.Object({
  confirmRules: Type.Optional(Type.Boolean({ description: 'Confirm a visible Agree and join dialog only after reading its community rules. Default false.' })),
  verifyOnly: Type.Optional(Type.Boolean({ description: 'Read membership state without clicking. Use once after an unconfirmed attempt.' })),
});
export const joinXCommunityTool: AgentTool<typeof JoinXCommunitySchema> = {
  name: 'join_x_community', label: 'Join X Community',
  description: 'Join the active X community through one native click per stage. Returns joined, requested, rules_required, blocked or unconfirmed. Already-joined/pending membership is never toggled. Read returned rules, then confirmRules:true once if appropriate. After unconfirmed use verifyOnly:true once; do not retry with coordinates or generic clicks.',
  parameters: JoinXCommunitySchema,
  execute: async (_id, params): Promise<AgentToolResult> => {
    try {
      const tab = await getActiveTab();
      if (!tab?.id || !/^https:\/\/(?:www\.)?(?:x|twitter)\.com\/i\/communities\/\d+(?:\/|\?|$)/i.test(tab.url || '')) throw new Error('Open the actual X /i/communities/<id> page first.');
      const result = await xCommunityAction(tab.id, params.verifyOnly ? 'verify' : params.confirmRules ? 'confirm' : 'join');
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
    } catch (error: any) { return { content: [{ type: 'text', text: `Membership is unconfirmed: ${error?.message || error}. Do not re-click; inspect the current state.` }], details: { success: false, state: 'unconfirmed' } }; }
  },
};

// 11. Scratchpad / Research Notepad
const ScratchpadSchema = Type.Object({
  action: Type.Union([
    Type.Literal('append'),
    Type.Literal('read'),
    Type.Literal('write'),
    Type.Literal('clear'),
  ], { description: 'Action to perform: "append" to add newly discovered items/research/notes, "read" to review all collected data, "write" to overwrite, "clear" to reset.' }),
  content: Type.Optional(Type.String({ description: 'Text to append or write to the scratchpad (required for "append" and "write")' })),
});

export function createScratchpadTool(sessionId?: string): AgentTool<typeof ScratchpadSchema> {
  return {
    name: 'scratchpad',
    label: 'Live Preview & Research Scratchpad',
    description: 'MANDATORY REAL-TIME PREVIEW & RESEARCH SCRATCHPAD. Content appended here is displayed immediately in real time to the user in their dedicated "Preview" tab as you work! Whenever you discover ANY matching item, qualifying society induction date, event, flight, lead, or research note, you MUST IMMEDIATELY call scratchpad with action="append" and clean Markdown so the user watches discoveries appear live without waiting.',
    parameters: ScratchpadSchema,
    execute: async (_toolCallId, params): Promise<AgentToolResult> => {
      try {
        const action = params.action;
        if (action === 'append') {
          const textToAppend = params.content || '';
          if (!textToAppend.trim()) {
            return {
              content: [{ type: 'text', text: 'Error: content is required for append action.' }],
              details: { success: false },
            };
          }
          const updated = await appendToScratchpad(textToAppend, sessionId);
          const lineCount = updated.split('\n').filter(Boolean).length;
          return {
            content: [{ type: 'text', text: `Added to scratchpad successfully. Current scratchpad contains ${lineCount} items (${updated.length} chars).\n\nLatest entry added:\n${textToAppend}` }],
            details: { success: true, action: 'append', totalChars: updated.length, lineCount },
          };
        } else if (action === 'read') {
          const current = await getScratchpad(sessionId);
          const lineCount = current.split('\n').filter(Boolean).length;
          return {
            content: [{ type: 'text', text: current ? `Current Scratchpad Content (${lineCount} items / ${current.length} chars):\n\n${current}` : 'Scratchpad is currently empty.' }],
            details: { success: true, action: 'read', content: current, lineCount },
          };
        } else if (action === 'write') {
          const newContent = params.content || '';
          await saveScratchpad(newContent, sessionId);
          return {
            content: [{ type: 'text', text: `Scratchpad updated (${newContent.length} chars).` }],
            details: { success: true, action: 'write', totalChars: newContent.length },
          };
        } else if (action === 'clear') {
          await clearScratchpad(sessionId);
          return {
            content: [{ type: 'text', text: 'Scratchpad cleared.' }],
            details: { success: true, action: 'clear' },
          };
        }

        return {
          content: [{ type: 'text', text: 'Unknown action' }],
          details: { success: false },
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Scratchpad error: ${err?.message || err}` }],
          details: { error: String(err) },
        };
      }
    },
  };
}

export const scratchpadTool: AgentTool<typeof ScratchpadSchema> = createScratchpadTool();

// 11b. Atomic Append to Preview Tool
const AppendToPreviewSchema = Type.Object({
  content: Type.String({
    description: 'Markdown snippet to append to the live preview buffer (e.g. table header, table row, bullet point, or section heading). Call this immediately when any single society, date, flight, or candidate is discovered.',
  }),
});

export function createAppendToPreviewTool(sessionId?: string): AgentTool<typeof AppendToPreviewSchema> {
  return {
    name: 'append_to_preview',
    label: 'Append to Live Preview',
    description: 'Appends a markdown chunk, table row, or section to the live preview buffer. Call this IMMEDIATELY when any single item, society, induction date, or result is discovered so the user sees real-time progress in their Preview tab.',
    parameters: AppendToPreviewSchema,
    execute: async (_toolCallId, params): Promise<AgentToolResult> => {
      try {
        const textToAppend = params.content || '';
        if (!textToAppend.trim()) {
          return {
            content: [{ type: 'text', text: 'Error: content is required.' }],
            details: { success: false },
          };
        }
        const updated = await appendToScratchpad(textToAppend, sessionId);
        const lineCount = updated.split('\n').filter(Boolean).length;
        return {
          content: [{ type: 'text', text: `Appended to Live Preview successfully. Current preview contains ${lineCount} lines (${updated.length} chars).\n\nAppended:\n${textToAppend}` }],
          details: { success: true, totalChars: updated.length, lineCount },
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Append to preview error: ${err?.message || err}` }],
          details: { error: String(err) },
        };
      }
    },
  };
}

export const appendToPreviewTool: AgentTool<typeof AppendToPreviewSchema> = createAppendToPreviewTool();

// 12. Suggest Memory Tool
const SuggestMemorySchema = Type.Object({
  title: Type.String({ description: 'Short descriptive title of the memory (e.g. "User Contact Phone", "Preferred Airline", "LinkedIn Easy Apply Routine")' }),
  content: Type.String({ description: 'The exact fact, personal detail, user preference, or repeatable task instruction to remember' }),
  category: Type.Optional(Type.Union([
    Type.Literal('profile'),
    Type.Literal('preference'),
    Type.Literal('workflow'),
    Type.Literal('fact'),
    Type.Literal('task'),
  ], { description: 'Category: "profile" for user identity/contact, "preference" for user choices, "workflow" or "task" for repeatable task instructions, "fact" for general facts' })),
  reason: Type.Optional(Type.String({ description: 'Why this memory is suggested (e.g. "Extracted from LinkedIn job form", "User specified in chat")' })),
});

export function createSuggestMemoryTool(sessionId?: string): AgentTool<typeof SuggestMemorySchema> {
  return {
    name: 'suggest_memory',
    label: 'Suggest New Memory',
    description: 'Suggests personal information, preferences, repeatable task steps, or facts discovered during your execution to be remembered. The user sees a badge on their top-right Suggested Memories button and can approve it with 1 click as Global Memory or Tab Memory, or discard it.',
    parameters: SuggestMemorySchema,
    execute: async (_toolCallId, params): Promise<AgentToolResult> => {
      try {
        const title = params.title.trim();
        const content = params.content.trim();
        if (!title || !content) {
          return {
            content: [{ type: 'text', text: 'Error: title and content are required.' }],
            details: { success: false },
          };
        }
        const sug = {
          id: `sug-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          title,
          content,
          category: params.category || 'fact',
          reason: params.reason?.trim(),
          createdAt: Date.now(),
          sessionId,
        };
        await saveSuggestedMemory(sug);
        return {
          content: [{ type: 'text', text: `Suggested memory "${title}" queued for user review. The user will review it in their Suggested Memories panel to approve as Global, Tab Memory, or discard it.` }],
          details: { success: true, suggestion: sug },
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Failed to record suggested memory: ${err?.message || err}` }],
          details: { error: String(err) },
        };
      }
    },
  };
}

export const suggestMemoryTool: AgentTool<typeof SuggestMemorySchema> = createSuggestMemoryTool();

// 12. Keyboard Shortcut / Key Press Dispatcher
const PressKeySchema = Type.Object({
  key: Type.String({ description: 'Key to dispatch, e.g. "Enter", "Escape", "Tab", "ArrowDown"' }),
  ctrlKey: Type.Optional(Type.Boolean({ description: 'Whether Control key is held down (e.g. Ctrl+Enter to send in Gmail)' })),
  shiftKey: Type.Optional(Type.Boolean({ description: 'Whether Shift key is held down' })),
  altKey: Type.Optional(Type.Boolean({ description: 'Whether Alt key is held down' })),
  selector: Type.Optional(Type.String({ description: 'Optional CSS selector of target element' })),
});

export const pressKeyCombinationTool: AgentTool<typeof PressKeySchema> = {
  name: 'press_key_combination',
  label: 'Keyboard Shortcut / Key Press',
  description: 'Dispatches keyboard shortcuts (e.g. Ctrl+Enter to immediately send in Gmail, Escape to dismiss dialogs, Enter to submit forms) without needing to search for dynamic button IDs.',
  parameters: PressKeySchema,
  execute: async (_toolCallId, params): Promise<AgentToolResult> => {
    try {
      const context = /enter/i.test(params.key) ? await beginApplicationAction() : undefined;
      const res = await pressKeyCombination({
        key: params.key,
        ctrlKey: params.ctrlKey,
        shiftKey: params.shiftKey,
        altKey: params.altKey,
        selector: params.selector,
      });
      const observed = /enter/i.test(params.key) ? await observeApplicationAction(res.message, res.success, context) : {message:res.message,success:res.success};
      return {
        content: [{ type: 'text', text: observed.message }],
        details: { ...res, ...observed } as any,
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Failed to dispatch key: ${err?.message || err}` }],
        details: { error: String(err) },
      };
    }
  },
};

// 13. Fast Direct Webmail Email Sender (Compound Action)
const SendWebEmailSchema = Type.Object({
  to: Type.String({ description: 'Recipient email address (e.g. user@example.com)' }),
  subject: Type.String({ description: 'Email subject line' }),
  body: Type.String({ description: 'Email body text' }),
  userEmail: Type.Optional(Type.String({ description: 'Optional user Gmail address (e.g. alisharjeelofficial@gmail.com) for direct authuser routing' })),
});

export const sendWebEmailTool: AgentTool<typeof SendWebEmailSchema> = {
  name: 'send_web_email',
  label: 'Direct Email Sender',
  description: 'Fast compound action to compose and send an email via Gmail in a single turn. Navigates directly to the pre-filled compose window and dispatches Send without requiring multi-turn micro-actions.',
  parameters: SendWebEmailSchema,
  execute: async (_toolCallId, params): Promise<AgentToolResult> => {
    try {
      const res = await sendWebEmailDirect({
        to: params.to,
        subject: params.subject,
        body: params.body,
        userEmail: params.userEmail,
      });
      return {
        content: [{ type: 'text', text: res.message }],
        details: res,
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Failed to send email: ${err?.message || err}` }],
        details: { error: String(err) },
      };
    }
  },
};

// 14. Quick Lightweight URL Reachability Check
const QuickUrlCheckSchema = Type.Object({
  url: Type.String({ description: 'The website or portfolio URL to verify (e.g. https://person.github.io)' }),
});

export const quickUrlCheckTool: AgentTool<typeof QuickUrlCheckSchema> = {
  name: 'quick_url_check',
  label: 'Quick URL Reachability Check',
  description: 'Performs a lightweight background HTTP check (under 3 seconds) to verify if a website or portfolio is live (HTTP 200 OK) without navigating the active browser tab or loading heavy scripts.',
  parameters: QuickUrlCheckSchema,
  execute: async (_toolCallId, params): Promise<AgentToolResult> => {
    try {
      const res = await checkUrlReachable(params.url);
      return {
        content: [{ type: 'text', text: res.message }],
        details: res,
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Failed to check URL: ${err?.message || err}` }],
        details: { error: String(err) },
      };
    }
  },
};

// 15. Open New Browser Tab
const OpenNewTabSchema = Type.Object({
  url: Type.String({ description: 'The URL to open in the new tab' }),
});

export const openNewTabTool: AgentTool<typeof OpenNewTabSchema> = {
  name: 'open_new_tab',
  label: 'Open New Tab',
  description: 'Opens a new browser tab with the specified URL and automatically focuses and switches to it as the active tab. Use this when you want to open a destination in a fresh tab or look up information without replacing the current tab. The new tab is ALREADY active and focused upon creation, so you do NOT need to call switch_browser_tab.',
  parameters: OpenNewTabSchema,
  execute: async (_toolCallId, params): Promise<AgentToolResult> => {
    try {
      const completed = completedRulesNavigation(params.url);
      if (completed) return { content: [{ type: 'text', text: describeCommunityRules(completed) }],
        details: { dispatched: false, navigationSkipped: true, lookupComplete: true, communityRules: completed } };
      const tabId = await createNewTab(params.url);
      if (tabId) {
        return {
          content: [{ type: 'text', text: `Opened new tab (ID: ${tabId}) with URL: ${params.url} and switched to it. It is now the active tab and ready for actions.` }],
          details: { success: true, tabId, url: params.url },
        };
      }
      return {
        content: [{ type: 'text', text: `Failed to open new tab for ${params.url}` }],
        details: { success: false },
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Failed to open new tab: ${err?.message || err}` }],
        details: { error: String(err) },
      };
    }
  },
};

// 16. Close Browser Tab
const CloseTabSchema = Type.Object({
  tabId: Type.Number({ description: 'The ID of the tab to close (get tab IDs from list_browser_tabs or open_new_tab)' }),
});

export const closeTabTool: AgentTool<typeof CloseTabSchema> = {
  name: 'close_tab',
  label: 'Close Tab',
  description: 'Closes a browser tab by its ID. Use this to clean up tabs you opened with open_new_tab after you are done reading information from them.',
  parameters: CloseTabSchema,
  execute: async (_toolCallId, params): Promise<AgentToolResult> => {
    try {
      const success = await closeBrowserTab(params.tabId);
      return {
        content: [{ type: 'text', text: success ? `Closed tab ${params.tabId} successfully.` : `Failed to close tab ${params.tabId}.` }],
        details: { success, tabId: params.tabId },
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Failed to close tab: ${err?.message || err}` }],
        details: { error: String(err) },
      };
    }
  },
};

// 17. Search Web Tool (Fast Background Search)
const SearchWebSchema = Type.Object({
  query: Type.String({
    description: 'The search query or terms to look up on the web (e.g. "Foundersuite 59 VC firms 2025", "The Last of Us quote")',
  }),
  limit: Type.Optional(
    Type.Number({ description: 'Maximum number of results to return (default 5, max 10)' })
  ),
});

export const searchWebTool: AgentTool<typeof SearchWebSchema> = {
  name: 'search_web',
  label: 'Fast Web Search',
  description:
    'Performs a fast, lightweight background web search (under 1.5s) returning top titles, URLs, and clean snippets. Use this whenever you need to check facts, find a website URL, or look up information WITHOUT opening new tabs, scraping spammy wikis, or disrupting your active page focus.',
  parameters: SearchWebSchema,
  execute: async (_toolCallId, params): Promise<AgentToolResult> => {
    try {
      const res = await searchWeb(params.query, params.limit);
      if (!res.success || res.results.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: res.message || `No search results found for "${params.query}". Answer from internal knowledge or use direct URL navigation.`,
            },
          ],
          details: res as any,
        };
      }

      const formatted = res.results
        .map(
          (r, idx) =>
            `${idx + 1}. **${r.title}**\n   URL: ${r.url}\n   Snippet: ${r.snippet}`
        )
        .join('\n\n');

      return {
        content: [
          {
            type: 'text',
            text: `Found ${res.results.length} web search results for "${params.query}":\n\n${formatted}`,
          },
        ],
        details: res as any,
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Search failed: ${err?.message || err}` }],
        details: { error: String(err) },
      };
    }
  },
};

// 18. Wait / Pause Tool (Mandatory for chat polling, waiting for replies, streaming completions)
const WaitSecondsSchema = Type.Object({
  seconds: Type.Number({
    description:
      'Number of seconds to pause execution (1 to 30 seconds, default 5). Use when waiting for a chat contact to reply on WhatsApp/Slack/Telegram, waiting for AI streaming responses, or waiting for page updates. NEVER call search_web to pass time.',
    minimum: 1,
    maximum: 30,
  }),
  reason: Type.Optional(
    Type.String({
      description: 'Reason for pausing (e.g. "Waiting for Mustafa to type reply in WhatsApp Web")',
    })
  ),
});

export const waitSecondsTool: AgentTool<typeof WaitSecondsSchema> = {
  name: 'wait_seconds',
  label: 'Wait / Pause Execution',
  description:
    'Pauses execution for a specified number of seconds (1 to 30) before the next action. MANDATORY for polling in multi-round chat loops (WhatsApp, Slack, Telegram) while waiting for contacts to reply, waiting for AI streaming responses to complete, or waiting for asynchronous page updates. NEVER call search_web to pass time.',
  parameters: WaitSecondsSchema,
  execute: async (_toolCallId, params): Promise<AgentToolResult> => {
    const rawSec = typeof params.seconds === 'number' ? params.seconds : 5;
    const cooldown = redditPostingCooldown();
    if (cooldown && /reddit|rate.?limit|cooldown|retry.*post/i.test(params.reason || '')) return { content: [{ type: 'text', text: cooldown.message }], details: cooldown };
    const clampedSec = Math.max(1, Math.min(30, Math.round(rawSec)));
    const reasonText = params.reason ? ` for: "${params.reason}"` : '';

    await new Promise((resolve) => setTimeout(resolve, clampedSec * 1000));

    return {
      content: [
        {
          type: 'text',
          text: `Paused for ${clampedSec} second(s)${reasonText}. Ready to re-check page content or take the next action.`,
        },
      ],
      details: { seconds: clampedSec, reason: params.reason },
    };
  },
};

// 19. Upload Raw Stored File (Resume, Image, PDF, Video) to Active Form
const UploadFileToFormSchema = Type.Object({
  fileName: Type.Optional(
    Type.String({
      description:
        'Exact filename, document ID, or title from get_user_documents or referenced attachments (e.g. "resume.pdf", "mem-123", "profile.png"). Prefer the document ID to disambiguate duplicate names. Named files never fall back to another attachment. If omitted, an application page prefers the stored resume and a social composer prefers video.',
    })
  ),
  refId: Type.Optional(
    Type.String({
      description: 'The refId of the file input element from get_active_tab_form (e.g. "af_2")',
    })
  ),
  selector: Type.Optional(
    Type.String({
      description:
        'CSS selector of the file input or upload dropzone (e.g. "input[type=\'file\']" or ".upload-dropzone"). Usually omit this: OpenBUA finds the composer file input automatically, preferring the one inside the visible dialog.',
    })
  ),
});

export const uploadFileToFormTool: AgentTool<typeof UploadFileToFormSchema> = {
  name: 'upload_file_to_form',
  label: 'Upload File / Video / Resume to Form',
  description:
    'Programmatically attaches a stored raw file (marketing video mp4/webm/mov, resume.pdf, PNG/JPG photo, or document) from the user\'s Memory to a file input (<input type="file">), dropzone, or open social media composer. Works on any site: X/Twitter, LinkedIn, Reddit, Facebook, Instagram, Threads, Bluesky, Mastodon, and job boards. Files of any size are streamed in chunks, so large videos are supported. Use this whenever a form or composer asks for a file upload, or when posting media to a social platform. It does NOT submit the post - review the result, then click the Post/Share button.',
  parameters: UploadFileToFormSchema,
  execute: async (_toolCallId, params): Promise<AgentToolResult> => {
    try {
      const res = await uploadFileToActiveTab({
        refId: params.refId,
        selector: params.selector,
        fileName: params.fileName,
      });

      return {
        content: [{ type: 'text', text: res.message }],
        details: res,
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Failed to upload file to form: ${err?.message || err}` }],
        details: { error: String(err) },
      };
    }
  },
};

// 20. Post media + text to a social platform (platform-agnostic)

/**
 * Pick the composer text field out of an inspected form. Search boxes and
 * sidebars are excluded so the caption never lands in the wrong input.
 */
function formFieldsForCaption(
  fields: Array<{ refId: string; type: string; label?: string; visible: boolean }> | undefined
): Array<{ refId: string }> {
  if (!fields || fields.length === 0) return [];
  const isTextual = (type: string) =>
    type === 'contenteditable' || type === 'textarea' || type === 'text' || type === '';

  return fields
    .filter((f) => f.visible && isTextual(f.type))
    .filter((f) => !/search|find|filter|recipient|subject/i.test(f.label || ''))
    .sort((a, b) => {
      // Prefer a field that is explicitly labelled as post text.
      const score = (label?: string) => (/post|write|caption|share|thought/i.test(label || '') ? 0 : 1);
      return score(a.label) - score(b.label);
    })
    .map((f) => ({ refId: f.refId }));
}

const PostToSocialSchema = Type.Object({
  platform: Type.Optional(
    Type.String({
      description:
        'Platform to post to: x, linkedin, reddit, facebook, instagram, threads, bluesky, mastodon, youtube, pinterest, tumblr, or tiktok. Omit to use the platform of the current tab.',
    })
  ),
  text: Type.Optional(
    Type.String({
      description: 'The post caption/body to type into the composer. Omit to attach media only.',
    })
  ),
  media: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'Names or keywords of stored Memory files to attach (e.g. ["consistnet.mp4"], ["demo"]). Omit for a text-only post.',
    })
  ),
  openComposer: Type.Optional(
    Type.Boolean({
      description:
        'Navigate the current tab to the platform composer first. Default true. Set false if the user already has the composer open.',
    })
  ),
});

export const postToSocialTool: AgentTool<typeof PostToSocialSchema> = {
  name: 'post_to_social',
  label: 'Post Media + Text to Any Social Platform',
  description:
    'Posts to ANY social platform in one step: resolves the platform (X/Twitter, LinkedIn, Reddit, Facebook, Instagram, Threads, Bluesky, Mastodon, YouTube, Pinterest, Tumblr, TikTok), opens its composer, attaches one or more stored videos/images from Memory by streaming them in chunks, and types the caption. Returns the composer state so you can verify the media preview rendered, then click the Post/Share/Submit button. Does NOT publish automatically unless you click submit afterwards.',
  parameters: PostToSocialSchema,
  execute: async (_toolCallId, params): Promise<AgentToolResult> => {
    const steps: string[] = [];
    const details: Record<string, any> = {};

    try {
      const activeTab = await getActiveTab();
      const currentUrl = activeTab?.url || '';

      // 1. Resolve the platform from the explicit name or the current tab.
      const recipe = params.platform
        ? findPlatform(params.platform)
        : resolvePlatformForUrl(currentUrl);

      if (!recipe) {
        const known = SUPPORTED_PLATFORM_IDS.join(', ');
        return {
          content: [
            {
              type: 'text',
              text: params.platform
                ? `Unknown platform "${params.platform}". Supported platforms: ${known}.`
                : `Could not tell which platform this is (current tab: ${currentUrl || 'unknown'}). Pass platform explicitly. Supported: ${known}.`,
            },
          ],
          details: { success: false, supported: SUPPORTED_PLATFORM_IDS },
        };
      }
      details.platform = recipe.id;
      details.platformLabel = recipe.label;

      // 2. Open the composer.
      if (params.openComposer !== false && activeTab?.id) {
        const opened = await openPlatformComposer(recipe, { tabId: activeTab.id });
        steps.push(opened.message);
        details.composerOpened = opened.success;
        details.composerUrl = opened.url;
        if (!opened.success) {
          details.fallbackSteps = opened.fallbackSteps;
        }
        // Let the composer render before we inspect it.
        await new Promise((r) => setTimeout(r, 1200));
      } else {
        steps.push(`Using the already-open composer on ${currentUrl || 'the current tab'}.`);
      }

      // 3. Attach media, one file at a time so a single failure is isolated.
      const mediaResults: Array<{ name: string; success: boolean; message: string }> = [];
      for (const mediaName of params.media || []) {
        const upload = await uploadFileToActiveTab({ fileName: mediaName });
        mediaResults.push({ name: mediaName, success: upload.success, message: upload.message });
        // Platforms queue uploads asynchronously; give each one room to start.
        if (upload.success) await new Promise((r) => setTimeout(r, 1500));
      }
      details.media = mediaResults;

      // 4. Inspect the composer so the agent can verify before submitting.
      let formSummary: string | undefined;
      try {
        const form = await inspectActiveTabForm();
        formSummary = `Composer fields: ${form.fields.length}, buttons: ${form.buttons.length}.`;
        details.formFields = form.fields.map((f) => ({
          refId: f.refId,
          type: f.type,
          label: f.label || f.ariaLabel,
          visible: f.isVisible,
        }));
        details.formButtons = form.buttons.map((b) => ({ refId: b.refId, text: b.text, isSubmit: b.isSubmit }));
      } catch {
        steps.push('Could not read the composer form; verify visually before submitting.');
      }

      // 5. Type the caption into whichever composer text field is on screen.
      let textFilled = false;
      if (params.text) {
        try {
          let target:
            | { refId?: string; selector?: string; value: string; pressEnter?: boolean }
            | undefined;
          if (formFieldsForCaption(details.formFields).length > 0) {
            const best = formFieldsForCaption(details.formFields)[0];
            target = { refId: best.refId, value: params.text };
          } else {
            // Fall back to the platform's usual composer selector.
            target = {
              selector: 'div[contenteditable="true"][role="textbox"], textarea, [data-lexical-editor="true"]',
              value: params.text,
            };
          }
          const fill = await fillActiveTabFields([target], false);
          textFilled = fill.successCount > 0;
          details.textFill = fill;
        } catch (err: any) {
          steps.push(`Could not type the caption automatically: ${err?.message || err}`);
        }
      }
      details.textFilled = textFilled;

      const failedMedia = mediaResults.filter((m) => !m.success);
      const summaryLines = [
        `Platform: ${recipe.label} (${recipe.id})`,
        `Composer: ${details.composerUrl || currentUrl}`,
        ...steps,
        ...mediaResults.map((m) => `- media "${m.name}": ${m.success ? 'attached' : 'FAILED - ' + m.message}`),
        `Caption: ${params.text ? (textFilled ? 'typed into the composer' : 'NOT typed - type it manually') : 'none'}`,
        formSummary || '',
        '',
        failedMedia.length
          ? `WARNING: ${failedMedia.length} media file(s) failed to attach. Do not submit until this is resolved.`
          : 'All requested media attached.',
        `Platform notes: ${recipe.notes}`,
        '',
        'NEXT: verify the media preview rendered, then click the Post/Share/Submit button with click_element. Do not submit if any media failed.',
      ].filter(Boolean);

      return {
        content: [{ type: 'text', text: summaryLines.join('\n') }],
        details: { ...details, success: failedMedia.length === 0 },
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Failed to prepare social post: ${err?.message || err}` }],
        details: { error: String(err) },
      };
    }
  },
};

// 21. Click at viewport coordinates (the only way to place a caret in a
//     canvas-rendered editor such as Google Docs, Sheets, Figma or Canva)
const ClickAtPositionSchema = Type.Object({
  x: Type.Number({ description: 'Horizontal position in pixels of the actual capture_tab_screenshot image. Pass the image coordinate unchanged; the tool converts to CSS pixels.' }),
  y: Type.Number({ description: 'Vertical position in pixels of the actual capture_tab_screenshot image. Pass the image coordinate unchanged; do not estimate from a resized preview or divide by devicePixelRatio.' }),
  clickCount: Type.Optional(
    Type.Number({ description: 'Number of clicks. Use 2 to double-click (select a word). Default 1.' })
  ),
  shiftKey: Type.Optional(
    Type.Boolean({
      description:
        'Hold Shift to extend the selection from the existing caret to this point. This is the only way to select a range of text in a canvas editor such as Google Docs, where there is no element to target. Use it to select an existing block before copying it.',
    })
  ),
  button: Type.Optional(
    Type.Number({ description: '0 = left, 2 = right. Default 0. Right-click opens a context menu.' })
  ),
});

export const clickAtPositionTool: AgentTool<typeof ClickAtPositionSchema> = {
  name: 'click_at_position',
  label: 'Click at Coordinates',
  description:
    'Clicks at an exact viewport (x, y) coordinate instead of the centre of a matched element. This is the ONLY way to place a text caret inside a canvas-rendered editor: Google Docs, Sheets, Slides, Figma, Canva and Word Online paint their content onto a <canvas>, so there is no element to target and click_element cannot reach them. Take a screenshot first, read the target position off it, then click. The reply tells you which element was under the cursor and whether this is a canvas editor.',
  parameters: ClickAtPositionSchema,
  execute: async (_toolCallId, params): Promise<AgentToolResult> => {
    try {
      if (typeof params.x !== 'number' || typeof params.y !== 'number') {
        return {
          content: [{ type: 'text', text: 'Both x and y are required and must be numbers.' }],
          details: { success: false },
        };
      }
      const blocked = await recoverBeforeAdvance(params);
      if(blocked) return {content:[{type:'text',text:blocked.message}],details:blocked as any};
      const context = await beginApplicationAction();
      const res = await clickAtPosition({
        x: params.x,
        y: params.y,
        clickCount: params.clickCount,
        shiftKey: params.shiftKey,
        button: params.button,
      });
      const observed = await observeApplicationAction(res.message, res.success, context);
      return {
        content: [{ type: 'text', text: observed.message }],
        details: {
          ...observed,
          element: res.element,
          cssX: res.cssX,
          cssY: res.cssY,
          viewport: res.viewport
            ? { width: res.viewport.width, height: res.viewport.height, devicePixelRatio: res.viewport.devicePixelRatio }
            : undefined,
        } as any,
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Failed to click at position: ${err?.message || err}` }],
        details: { error: String(err) },
      };
    }
  },
};

// 22. Type text at the current caret
const TypeTextSchema = Type.Object({
  text: Type.String({
    description:
      'The text to type. Use \\n between lines; each newline is sent as a real Enter (or paragraph break) so multi-line documents work.',
  }),
  clearFirst: Type.Optional(
    Type.Boolean({
      description:
        'Select-all and delete before typing. Use this to replace an existing document rather than append to it. Default false.',
    })
  ),
  expectedCaretText: Type.Optional(Type.String({
    description: 'Existing text expected in the selected range, such as the target project title. When the editor exposes a different selection, typing is blocked. An empty selection cannot verify the caret; always inspect a screenshot after moving it.',
  })),
  allowUniformParagraphStyle: Type.Optional(Type.Boolean({
    description: 'Allow multiple paragraphs to inherit the current heading/bold formatting ONLY when every inserted paragraph should intentionally have that same style. Keep false for a project title plus technologies and bullets; clone the source formatting and edit each line separately.',
  })),
});

export const typeTextTool: AgentTool<typeof TypeTextSchema> = {
  name: 'type_text',
  label: 'Type Text at Caret',
  description:
    'Types text at the current cursor position, one line at a time. Required for canvas editors such as Google Docs. Place the caret with click_at_position, then inspect a screenshot and any reported caret-line text before writing into a specific section. Text verification does not verify placement or formatting. An unverified insert may have landed: inspect a screenshot before retrying. Line breaks are typed as Enter.',
  parameters: TypeTextSchema,
  execute: async (_toolCallId, params): Promise<AgentToolResult> => {
    try {
      const check = await checkCanvasTextInsertion(params.text, params.expectedCaretText, params.allowUniformParagraphStyle);
      if (!check.allowed) {
        return { content: [{ type: 'text', text: check.message || 'Insertion blocked.' }], details: { success: false, inserted: false } };
      }
      const res = await typeActiveTabText({
        text: params.text,
        clearFirst: params.clearFirst,
      });
      return { content: [{ type: 'text', text: res.message }], details: res };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Failed to type text: ${err?.message || err}` }],
        details: { error: String(err) },
      };
    }
  },
};

// 23. Clipboard: copy/paste an existing block to reuse its exact formatting
const ClipboardActionSchema = Type.Object({
  action: Type.String({
    description:
      'copy, cut, paste, selectAll, or duplicate. Dispatches keyboard events; inspect the result because dispatch does not prove a clipboard operation occurred. In Google Docs use docs_clipboard for copy, cut and paste.',
  }),
});

export const clipboardActionTool: AgentTool<typeof ClipboardActionSchema> = {
  name: 'clipboard_action',
  label: 'Clipboard (Copy / Paste)',
  description:
    'Dispatch a clipboard keyboard shortcut in the active tab. Dispatch success does not verify clipboard contents or document changes. In Google Docs use select_docs_text and docs_clipboard to clone formatted blocks, and inspect_docs_editor to inspect formatting. Do not use duplicate in Docs: Ctrl+D is not a document block duplication command. Verify selection and placement with screenshots.',
  parameters: ClipboardActionSchema,
  execute: async (_toolCallId, params): Promise<AgentToolResult> => {
    const allowed = ['copy', 'cut', 'paste', 'selectAll', 'duplicate'];
    const action = String(params.action || '').trim();
    if (!allowed.includes(action)) {
      return {
        content: [
          {
            type: 'text',
            text: `Unknown clipboard action "${action}". Use one of: ${allowed.join(', ')}.`,
          },
        ],
        details: { success: false, allowed },
      };
    }
    try {
      const res = await clipboardAction(action as 'copy' | 'cut' | 'paste' | 'selectAll' | 'duplicate');
      return { content: [{ type: 'text', text: `Clipboard shortcut dispatched. Verify the result with a screenshot; clipboard contents and document changes are unverified.` }], details: { action, dispatched: res.success, verified: false } };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Clipboard action failed: ${err?.message || err}` }],
        details: { error: String(err) },
      };
    }
  },
};

// Factory to create session-bound tools for the OpenBUA Agent
export function createAgentTools(sessionId?: string, docsPolicy?: DocsEditPolicy, pagePolicy: PageTrustPolicy = { userRequests: [] }): AgentTool<any>[] {
  return protectPageTrust(protectDocsEdits([
    getActiveTabFormTool,
    inspectDocsEditorTool,
    findDocsTextTool,
    selectDocsTextTool,
    setDocsFormattingTool,
    docsClipboardTool,
    confirmDocsCloneTool,
    fillFormFieldsTool,
    prepareRedditPostTool,
    reviewRedditPostTool,
    joinXCommunityTool,
    submitRedditPostTool,
    verifyRedditPostTool,
    readYouTubeVideosTool,
    uploadFileToFormTool,
    postToSocialTool,
    clickElementTool,
    verifyApplicationStatusTool,
    scrollPageTool,
    clickAtPositionTool,
    typeTextTool,
    clipboardActionTool,
    getUserDocumentsTool,
    captureTabScreenshotTool,
    listBrowserTabsTool,
    switchBrowserTabTool,
    navigateBrowserTabTool,
    getPageContentTool,
    readCommunityRulesTool,
    createAppendToPreviewTool(sessionId),
    createScratchpadTool(sessionId),
    createSuggestMemoryTool(sessionId),
    pressKeyCombinationTool,
    sendWebEmailTool,
    quickUrlCheckTool,
    searchWebTool,
    waitSecondsTool,
    openNewTabTool,
    closeTabTool,
  ], docsPolicy), pagePolicy);
}

// All available tools for the OpenBUA Agent (default session fallback)
export const ALL_AGENT_TOOLS: AgentTool<any>[] = createAgentTools('session_default');
