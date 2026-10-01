// Tool definitions conforming to @earendil-works/pi-agent-core AgentTool interface
import { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';
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
} from './browser-bridge';
import {
  loadDocuments,
  getScratchpad,
  saveScratchpad,
  appendToScratchpad,
  clearScratchpad,
  saveSuggestedMemory,
} from '../services/storage';

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
      const totalFields = summary.fields.length;
      const visibleFields = summary.fields.filter(f => f.isVisible);
      const fieldsToShow = visibleFields.slice(0, 100);
      const buttons = summary.buttons.slice(0, 30);
      
      let textOutput = `Found ${totalFields} fields (${visibleFields.length} visible, showing ${fieldsToShow.length}) on page "${summary.title}":\n\n` +
        `Current URL: ${summary.url}\n` +
        (summary.stepIndicators.length > 0 ? `Step Progress: ${summary.stepIndicators.join(' | ')}\n\n` : '') +
        `Fields:\n` +
        fieldsToShow.map(f => {
          let desc = `- [refId: ${f.refId}] Label: "${f.label || f.name || f.placeholder || 'Unnamed'}" | Type: ${f.type}`;
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

      return {
        content: [{ type: 'text', text: textOutput }],
        details: summary,
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
    }),
    { description: 'List of fields and values to fill' }
  ),
});

export const fillFormFieldsTool: AgentTool<typeof FillFormFieldsSchema> = {
  name: 'fill_form_fields',
  label: 'Fill Form Fields',
  description: 'Fills form fields on the active webpage with the provided values. Compatible with React, Vue, contenteditable rich text editors, and standard HTML forms.',
  parameters: FillFormFieldsSchema,
  execute: async (_toolCallId, params): Promise<AgentToolResult> => {
    try {
      const result = await fillActiveTabFields(params.assignments);
      
      const verificationLines = (result.verifications || []).map((v) => {
        const id = v.refId || v.selector || 'field';
        if (v.verified) {
          return `  - [${id}]: [VERIFIED] (DOM value: "${v.actualValue.slice(0, 50)}")`;
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
      const result = await clickActiveTabElement(params);
      return {
        content: [{ type: 'text', text: result.message }],
        details: result,
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
  description: 'Scrolls the active webpage down, up, or to a specific element to reveal more fields or lazy-loaded elements.',
  parameters: ScrollPageSchema,
  execute: async (_toolCallId, params): Promise<AgentToolResult> => {
    try {
      await scrollActiveTab(params.direction as any, params.selector);
      return {
        content: [{ type: 'text', text: `Scrolled page ${params.direction}` }],
        details: { scrolled: true, direction: params.direction },
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
      const docs = await loadDocuments();
      const activeDocs = docs.filter(d => d.isActiveForContext);

      if (activeDocs.length === 0) {
        return {
          content: [{ type: 'text', text: 'No active user documents or profile data found in local storage.' }],
          details: { documentsCount: 0 },
        };
      }

      let formatted = `Found ${activeDocs.length} active documents in user storage:\n\n`;
      activeDocs.forEach((doc, idx) => {
        formatted += `### Document ${idx + 1}: ${doc.title} (${doc.type})\n${doc.content}\n\n`;
      });

      return {
        content: [{ type: 'text', text: formatted }],
        details: {
          documents: activeDocs.map(d => ({ id: d.id, title: d.title, type: d.type })),
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
  description: 'Captures a screenshot of the visible area of the current active browser tab for visual inspection.',
  parameters: CaptureTabScreenshotSchema,
  execute: async (): Promise<AgentToolResult> => {
    try {
      const dataUrl = await captureTabScreenshot();
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      const mimeType = match ? match[1] : 'image/jpeg';
      const base64Data = match ? match[2] : dataUrl;

      return {
        content: [
          { type: 'text', text: 'Screenshot captured successfully of current browser tab.' },
          { type: 'image', data: base64Data, mimeType } as any,
        ],
        details: { dataUrl: dataUrl.slice(0, 100) + '...', size: base64Data.length },
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Failed to capture screenshot: ${err?.message || err}` }],
        details: { error: String(err) },
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
      const text = tabs.map(t => `- [Tab ${t.id}] ${t.active ? '(ACTIVE) ' : ''}"${t.title}" - ${t.url}`).join('\n');
      return {
        content: [{ type: 'text', text: `Open tabs:\n${text}` }],
        details: { tabs },
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
      const res = await getActiveTabPageContent();
      return {
        content: [{ type: 'text', text: `Page Title: ${res.title}\nURL: ${res.url}\n\nContent:\n${res.text}` }],
        details: res,
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Failed to get page text: ${err?.message || err}` }],
        details: { error: String(err) },
      };
    }
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
      const res = await pressKeyCombination({
        key: params.key,
        ctrlKey: params.ctrlKey,
        shiftKey: params.shiftKey,
        altKey: params.altKey,
        selector: params.selector,
      });
      return {
        content: [{ type: 'text', text: res.message }],
        details: res,
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
  description: 'Opens a new browser tab with the specified URL WITHOUT navigating away from the current active tab. Use this when you need to look up information (e.g. from another website) while filling a form so you do NOT lose form progress. After reading the new tab, close it with close_tab and switch back to the original tab.',
  parameters: OpenNewTabSchema,
  execute: async (_toolCallId, params): Promise<AgentToolResult> => {
    try {
      const tabId = await createNewTab(params.url);
      if (tabId) {
        return {
          content: [{ type: 'text', text: `Opened new tab (ID: ${tabId}) with URL: ${params.url}. Use switch_browser_tab to switch to it, or close_tab to close it when done.` }],
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

// Factory to create session-bound tools for the OpenBUA Agent
export function createAgentTools(sessionId?: string): AgentTool<any>[] {
  return [
    getActiveTabFormTool,
    fillFormFieldsTool,
    clickElementTool,
    scrollPageTool,
    getUserDocumentsTool,
    captureTabScreenshotTool,
    listBrowserTabsTool,
    switchBrowserTabTool,
    navigateBrowserTabTool,
    getPageContentTool,
    createAppendToPreviewTool(sessionId),
    createScratchpadTool(sessionId),
    createSuggestMemoryTool(sessionId),
    pressKeyCombinationTool,
    sendWebEmailTool,
    quickUrlCheckTool,
    openNewTabTool,
    closeTabTool,
  ];
}

// All available tools for the OpenBUA Agent (default session fallback)
export const ALL_AGENT_TOOLS: AgentTool<any>[] = createAgentTools('session_default');
