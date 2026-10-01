import React, { useState, useEffect } from 'react';
import { AppSettings, ProviderType, ModelMode } from '../types';
import { saveSettings, getGeminiDailyUsage, GeminiUsageInfo } from '../services/storage';
import { Input } from './ui/input';
import {
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Sparkles,
  Zap,
  ExternalLink,
  Activity,
  Check,
  Globe,
} from 'lucide-react';

interface SettingsViewProps {
  settings: AppSettings;
  onSettingsSaved: (updated: AppSettings) => void;
  activeTab?: ModelMode;
  onTabChange?: (tab: ModelMode) => void;
}

export function SettingsView({ settings, onSettingsSaved, activeTab, onTabChange }: SettingsViewProps) {
  // Mode: Free vs BYOK (synced from App header)
  const [currentTab, setCurrentTab] = useState<ModelMode>(activeTab || settings.selectedMode || 'free');

  useEffect(() => {
    if (activeTab && activeTab !== currentTab) {
      setCurrentTab(activeTab);
    }
  }, [activeTab]);

  // Selected active model mode for the agent ('free' or 'byok')
  const [selectedMode, setSelectedMode] = useState<ModelMode>(settings.selectedMode || 'free');

  // Free Tier (Google Gemini) Config - hidden under the hood as requested
  const [freeUrl] = useState(
    settings.free?.baseUrl || 'https://generativelanguage.googleapis.com/v1beta/openai/'
  );
  const [freeKey, setFreeKey] = useState(settings.free?.apiKey || '');
  const [freeModel] = useState(settings.free?.model || 'gemini-3.8-flash');

  // Gemini daily usage limits tracking (1,500 RPD)
  const [geminiUsage, setGeminiUsage] = useState<GeminiUsageInfo>({
    count: 0,
    limit: 1500,
    remaining: 1500,
    remainingPercent: 100,
    date: new Date().toISOString().slice(0, 10),
  });

  useEffect(() => {
    getGeminiDailyUsage().then(setGeminiUsage).catch(() => {});
  }, []);

  // BYOK Provider Type ('openai' | 'anthropic')
  const [activeProvider, setActiveProvider] = useState<ProviderType>(settings.activeProvider || 'openai');

  // BYOK OpenAI Config
  const [openaiUrl, setOpenaiUrl] = useState(settings.openai?.baseUrl || 'https://api.openai.com/v1');
  const [openaiKey, setOpenaiKey] = useState(settings.openai?.apiKey || '');
  const [openaiModel, setOpenaiModel] = useState(settings.openai?.model || 'gpt-4o');

  // BYOK Anthropic Config
  const [anthropicUrl, setAnthropicUrl] = useState(settings.anthropic?.baseUrl || 'https://api.anthropic.com/v1');
  const [anthropicKey, setAnthropicKey] = useState(settings.anthropic?.apiKey || '');
  const [anthropicModel, setAnthropicModel] = useState(settings.anthropic?.model || 'claude-3-7-sonnet-20250219');

  // Permissions: Ask for review (true, default) vs Full access (false)
  const [autoConfirmSubmit, setAutoConfirmSubmit] = useState(settings.autoConfirmSubmit ?? true);
  const [systemInstruction] = useState(settings.systemInstruction || '');

  const [showKey, setShowKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Connection testing state
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleOpenAiStudio = () => {
    const url = 'https://aistudio.google.com/api-keys';
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url });
    } else {
      window.open(url, '_blank');
    }
  };

  const handleSave = async (overrideSelectedMode?: ModelMode) => {
    setIsSaving(true);
    setSaveSuccess(false);

    const modeToSave = overrideSelectedMode || selectedMode;

    const updated: AppSettings = {
      activeProvider,
      selectedMode: modeToSave,
      free: {
        baseUrl: freeUrl.trim(),
        apiKey: freeKey.trim(),
        model: freeModel.trim(),
      },
      openai: {
        baseUrl: openaiUrl.trim(),
        apiKey: openaiKey.trim(),
        model: openaiModel.trim(),
      },
      anthropic: {
        baseUrl: anthropicUrl.trim(),
        apiKey: anthropicKey.trim(),
        model: anthropicModel.trim(),
      },
      autoConfirmSubmit,
      systemInstruction: systemInstruction.trim(),
    };

    await saveSettings(updated);
    onSettingsSaved(updated);
    setIsSaving(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  const handleSetCurrentModel = async (mode: ModelMode) => {
    setSelectedMode(mode);
    await handleSave(mode);
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);

    const isFree = currentTab === 'free';
    const isAnthropic = !isFree && activeProvider === 'anthropic';

    const key = isFree ? freeKey.trim() : isAnthropic ? anthropicKey.trim() : openaiKey.trim();
    const url = isFree ? freeUrl.trim() : isAnthropic ? anthropicUrl.trim() : openaiUrl.trim();
    const model = isFree ? freeModel.trim() : isAnthropic ? anthropicModel.trim() : openaiModel.trim();

    if (!key) {
      setTestResult({
        success: false,
        message: `Please enter an API Key first.`,
      });
      setIsTesting(false);
      return;
    }

    const startTime = Date.now();

    try {
      if (isAnthropic) {
        let endpoint = url.replace(/\/+$/, '');
        if (!endpoint.endsWith('/messages')) endpoint = `${endpoint}/v1/messages`;

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: model || 'claude-3-7-sonnet-20250219',
            max_tokens: 5,
            messages: [{ role: 'user', content: 'ping' }],
          }),
        });

        const elapsed = Date.now() - startTime;
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errText}`);
        }

        setTestResult({
          success: true,
          message: `Connection successful! (${elapsed}ms) Anthropic model responded.`,
        });
      } else {
        // OpenAI or Gemini OpenAI-compatible
        let endpoint = url.replace(/\/+$/, '');
        if (!endpoint.endsWith('/chat/completions')) {
          endpoint = `${endpoint}/chat/completions`;
        }

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model: model || (isFree ? 'gemini-3.8-flash' : 'gpt-4o'),
            max_tokens: 5,
            messages: [{ role: 'user', content: 'ping' }],
          }),
        });

        const elapsed = Date.now() - startTime;
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errText}`);
        }

        setTestResult({
          success: true,
          message: `Connection successful! (${elapsed}ms) ${isFree ? 'Gemini Free model' : 'OpenAI-compatible model'} responded.`,
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: `Connection failed: ${err?.message || String(err)}`,
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 pt-16 pb-6 space-y-4 text-xs bg-zinc-950">
      {/* ======================================================== */}
      {/* FREE TIER TAB (Google Gemini Free) */}
      {/* ======================================================== */}
      {currentTab === 'free' && (
        <div className="space-y-4">
          {/* Header Row: Current Model status & toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs font-semibold text-zinc-100">Google Gemini Free</span>
            </div>

            {selectedMode === 'free' ? (
              <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-2.5 py-0.5 rounded-full shadow-xs">
                <Check className="w-3 h-3 text-emerald-400" />
                <span>Current Model</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleSetCurrentModel('free')}
                className="text-[10px] font-medium px-2.5 py-0.5 rounded-full border border-zinc-700 hover:border-emerald-500/80 hover:text-emerald-300 text-zinc-300 transition-colors cursor-pointer"
              >
                Set as Current Model
              </button>
            )}
          </div>

          {/* 1. Circular Button: Get Gemini API Key */}
          <div>
            <button
              type="button"
              onClick={handleOpenAiStudio}
              className="w-full py-2.5 px-4 rounded-full bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-100 font-medium text-xs flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer active:scale-[0.99]"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Get Gemini API Key</span>
              <ExternalLink className="w-3 h-3 text-zinc-400" />
            </button>
          </div>

          {/* 2. Input Box: Gemini API Key */}
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-zinc-300 block">
              Gemini API Key
            </label>
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                placeholder="AIzaSy..."
                value={freeKey}
                onChange={(e) => setFreeKey(e.target.value)}
                className="pr-8 bg-zinc-900 border-zinc-800 font-mono text-[11px] rounded-xl focus:border-zinc-600"
              />
              <button
                type="button"
                className="absolute right-2.5 top-2.5 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* 3. Percentage / Quota Bar */}
          <div className="p-3 rounded-xl bg-zinc-900/70 border border-zinc-800/80 space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-1.5 text-zinc-300">
                <Activity className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-medium">Free Tier Daily Quota</span>
              </div>
              <span className="text-xs font-semibold text-emerald-400">
                {geminiUsage.remainingPercent}% left
              </span>
            </div>

            {/* Percentage Bar */}
            <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500"
                style={{ width: `${geminiUsage.remainingPercent}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[10px] text-zinc-400 pt-0.5">
              <span>{geminiUsage.remaining.toLocaleString()} / 1,500 requests remaining</span>
              <button
                type="button"
                onClick={handleOpenAiStudio}
                className="text-blue-400 hover:text-blue-300 flex items-center gap-0.5 underline cursor-pointer"
              >
                <span>AI Studio</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </button>
            </div>
          </div>

          {/* 4. Permissions Section */}
          <div className="space-y-2 pt-1">
            <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider block">
              Permissions
            </label>
            <div className="grid grid-cols-2 gap-2">
              {/* Ask for review (Default) */}
              <button
                type="button"
                onClick={() => setAutoConfirmSubmit(true)}
                className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  autoConfirmSubmit
                    ? 'bg-zinc-900 border-[#007AFF]/60 shadow-sm ring-1 ring-[#007AFF]/30'
                    : 'bg-zinc-950 border-zinc-800/80 hover:border-zinc-700 text-zinc-400'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className={`text-xs font-semibold ${autoConfirmSubmit ? 'text-white' : 'text-zinc-300'}`}>
                    Ask for review
                  </span>
                  <div
                    className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                      autoConfirmSubmit ? 'border-[#007AFF] bg-[#007AFF]' : 'border-zinc-600'
                    }`}
                  >
                    {autoConfirmSubmit && <Check className="w-2.5 h-2.5 text-white" />}
                  </div>
                </div>
                <p className="text-[10px] text-zinc-400 leading-tight">
                  Asks before final submission or major actions
                </p>
              </button>

              {/* Full access */}
              <button
                type="button"
                onClick={() => setAutoConfirmSubmit(false)}
                className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  !autoConfirmSubmit
                    ? 'bg-zinc-900 border-[#007AFF]/60 shadow-sm ring-1 ring-[#007AFF]/30'
                    : 'bg-zinc-950 border-zinc-800/80 hover:border-zinc-700 text-zinc-400'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className={`text-xs font-semibold ${!autoConfirmSubmit ? 'text-white' : 'text-zinc-300'}`}>
                    Full access
                  </span>
                  <div
                    className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                      !autoConfirmSubmit ? 'border-[#007AFF] bg-[#007AFF]' : 'border-zinc-600'
                    }`}
                  >
                    {!autoConfirmSubmit && <Check className="w-2.5 h-2.5 text-white" />}
                  </div>
                </div>
                <p className="text-[10px] text-zinc-400 leading-tight">
                  Autonomously fills and submits end-to-end
                </p>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* BYOK TAB (Bring Your Own Key: OpenAI / Anthropic) */}
      {/* ======================================================== */}
      {currentTab === 'byok' && (
        <div className="space-y-4">
          {/* Header Row: Current Model status & toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-xs font-semibold text-zinc-100">BYOK Custom Model</span>
            </div>

            {selectedMode === 'byok' ? (
              <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-2.5 py-0.5 rounded-full shadow-xs">
                <Check className="w-3 h-3 text-emerald-400" />
                <span>Current Model</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleSetCurrentModel('byok')}
                className="text-[10px] font-medium px-2.5 py-0.5 rounded-full border border-zinc-700 hover:border-emerald-500/80 hover:text-emerald-300 text-zinc-300 transition-colors cursor-pointer"
              >
                Set as Current Model
              </button>
            )}
          </div>

          {/* Provider Switcher */}
          <div className="flex rounded-full bg-zinc-900 p-0.5 border border-zinc-800">
            <button
              type="button"
              className={`flex-1 py-1.5 px-3 rounded-full text-xs font-medium transition-all cursor-pointer ${
                activeProvider === 'openai'
                  ? 'bg-zinc-100 text-zinc-950 font-semibold shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              onClick={() => setActiveProvider('openai')}
            >
              OpenAI Compatible
            </button>
            <button
              type="button"
              className={`flex-1 py-1.5 px-3 rounded-full text-xs font-medium transition-all cursor-pointer ${
                activeProvider === 'anthropic'
                  ? 'bg-zinc-100 text-zinc-950 font-semibold shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              onClick={() => setActiveProvider('anthropic')}
            >
              Anthropic Compatible
            </button>
          </div>

          {activeProvider === 'openai' ? (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-medium text-zinc-300 block mb-1">Base URL</label>
                <Input
                  placeholder="https://api.openai.com/v1"
                  value={openaiUrl}
                  onChange={(e) => setOpenaiUrl(e.target.value)}
                  className="bg-zinc-900 border-zinc-800 font-mono text-[11px] rounded-xl focus:border-zinc-600"
                />
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  <span className="text-[9px] text-zinc-500">Presets:</span>
                  <button
                    type="button"
                    className="text-[9px] text-zinc-400 hover:text-zinc-200 underline cursor-pointer"
                    onClick={() => setOpenaiUrl('https://api.openai.com/v1')}
                  >
                    OpenAI
                  </button>
                  <button
                    type="button"
                    className="text-[9px] text-zinc-400 hover:text-zinc-200 underline cursor-pointer"
                    onClick={() => setOpenaiUrl('https://api.deepseek.com/v1')}
                  >
                    DeepSeek
                  </button>
                  <button
                    type="button"
                    className="text-[9px] text-zinc-400 hover:text-zinc-200 underline cursor-pointer"
                    onClick={() => setOpenaiUrl('https://openrouter.ai/api/v1')}
                  >
                    OpenRouter
                  </button>
                  <button
                    type="button"
                    className="text-[9px] text-zinc-400 hover:text-zinc-200 underline cursor-pointer"
                    onClick={() => {
                      setOpenaiUrl('https://api.groq.com/openai/v1/chat/completions');
                      setOpenaiModel('qwen/qwen3.8-27b');
                    }}
                  >
                    Groq
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-medium text-zinc-300">API Key</label>
                  {openaiKey.trim().startsWith('gsk_') && (
                    <span className="text-[10px] text-amber-400 font-medium flex items-center gap-1 bg-amber-950/60 px-2 py-0.5 rounded-full border border-amber-800/60">
                      Groq Key
                    </span>
                  )}
                </div>
                <div className="relative">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    placeholder="sk-... or gsk_..."
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    className="pr-8 bg-zinc-900 border-zinc-800 font-mono text-[11px] rounded-xl focus:border-zinc-600"
                  />
                  <button
                    type="button"
                    className="absolute right-2.5 top-2.5 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                    onClick={() => setShowKey(!showKey)}
                  >
                    {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-medium text-zinc-300 block mb-1">Model ID</label>
                <Input
                  placeholder="gpt-4o"
                  value={openaiModel}
                  onChange={(e) => setOpenaiModel(e.target.value)}
                  className="bg-zinc-900 border-zinc-800 font-mono text-[11px] rounded-xl focus:border-zinc-600"
                />
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  <span className="text-[9px] text-zinc-500">Presets:</span>
                  {['gpt-4o', 'gpt-4o-mini', 'deepseek-chat', 'qwen/qwen3.8-27b'].map((m) => (
                    <button
                      key={m}
                      type="button"
                      className="text-[9px] text-zinc-400 hover:text-zinc-200 underline cursor-pointer"
                      onClick={() => setOpenaiModel(m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-medium text-zinc-300 block mb-1">Base URL</label>
                <Input
                  placeholder="https://api.anthropic.com/v1"
                  value={anthropicUrl}
                  onChange={(e) => setAnthropicUrl(e.target.value)}
                  className="bg-zinc-900 border-zinc-800 font-mono text-[11px] rounded-xl focus:border-zinc-600"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-zinc-300 block mb-1">Anthropic API Key</label>
                <div className="relative">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    placeholder="sk-ant-..."
                    value={anthropicKey}
                    onChange={(e) => setAnthropicKey(e.target.value)}
                    className="pr-8 bg-zinc-900 border-zinc-800 font-mono text-[11px] rounded-xl focus:border-zinc-600"
                  />
                  <button
                    type="button"
                    className="absolute right-2.5 top-2.5 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                    onClick={() => setShowKey(!showKey)}
                  >
                    {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-medium text-zinc-300 block mb-1">Model Name</label>
                <Input
                  placeholder="claude-3-7-sonnet-20250219"
                  value={anthropicModel}
                  onChange={(e) => setAnthropicModel(e.target.value)}
                  className="bg-zinc-900 border-zinc-800 font-mono text-[11px] rounded-xl focus:border-zinc-600"
                />
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  <span className="text-[9px] text-zinc-500">Presets:</span>
                  {['claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'].map((m) => (
                    <button
                      key={m}
                      type="button"
                      className="text-[9px] text-zinc-400 hover:text-zinc-200 underline cursor-pointer"
                      onClick={() => setAnthropicModel(m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Permissions Section (Same as Free mode) */}
          <div className="space-y-2 pt-1">
            <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider block">
              Permissions
            </label>
            <div className="grid grid-cols-2 gap-2">
              {/* Ask for review (Default) */}
              <button
                type="button"
                onClick={() => setAutoConfirmSubmit(true)}
                className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  autoConfirmSubmit
                    ? 'bg-zinc-900 border-[#007AFF]/60 shadow-sm ring-1 ring-[#007AFF]/30'
                    : 'bg-zinc-950 border-zinc-800/80 hover:border-zinc-700 text-zinc-400'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className={`text-xs font-semibold ${autoConfirmSubmit ? 'text-white' : 'text-zinc-300'}`}>
                    Ask for review
                  </span>
                  <div
                    className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                      autoConfirmSubmit ? 'border-[#007AFF] bg-[#007AFF]' : 'border-zinc-600'
                    }`}
                  >
                    {autoConfirmSubmit && <Check className="w-2.5 h-2.5 text-white" />}
                  </div>
                </div>
                <p className="text-[10px] text-zinc-400 leading-tight">
                  Asks before final submission or major actions
                </p>
              </button>

              {/* Full access */}
              <button
                type="button"
                onClick={() => setAutoConfirmSubmit(false)}
                className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  !autoConfirmSubmit
                    ? 'bg-zinc-900 border-[#007AFF]/60 shadow-sm ring-1 ring-[#007AFF]/30'
                    : 'bg-zinc-950 border-zinc-800/80 hover:border-zinc-700 text-zinc-400'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className={`text-xs font-semibold ${!autoConfirmSubmit ? 'text-white' : 'text-zinc-300'}`}>
                    Full access
                  </span>
                  <div
                    className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                      !autoConfirmSubmit ? 'border-[#007AFF] bg-[#007AFF]' : 'border-zinc-600'
                    }`}
                  >
                    {!autoConfirmSubmit && <Check className="w-2.5 h-2.5 text-white" />}
                  </div>
                </div>
                <p className="text-[10px] text-zinc-400 leading-tight">
                  Autonomously fills and submits end-to-end
                </p>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* Bottom Action Buttons: Save Settings & Test API */}
      {/* ======================================================== */}
      <div className="pt-2 space-y-2">
        <div className="flex items-center gap-2">
          {/* Main Save Settings Button in iMessage Blue (#007AFF) */}
          <button
            type="button"
            onClick={() => handleSave()}
            disabled={isSaving}
            className="flex-1 py-2 px-5 rounded-full bg-[#007AFF] hover:bg-[#0066d6] text-white font-semibold text-xs shadow-md transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            {saveSuccess ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                <span>Saved!</span>
              </>
            ) : isSaving ? (
              <span>Saving...</span>
            ) : (
              <span>Save Settings</span>
            )}
          </button>

          {/* Smaller Test API button on the right */}
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={isTesting}
            className="py-2 px-3.5 rounded-full bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white font-medium text-xs transition-all cursor-pointer flex items-center gap-1.5 shrink-0 disabled:opacity-50"
          >
            <Zap className={`w-3.5 h-3.5 ${isTesting ? 'animate-pulse text-amber-400' : 'text-zinc-400'}`} />
            <span>{isTesting ? 'Testing...' : 'Test API'}</span>
          </button>
        </div>

        {testResult && (
          <div
            className={`p-2.5 rounded-xl border text-[11px] flex items-start gap-2 ${
              testResult.success
                ? 'bg-emerald-950/40 border-emerald-900/60 text-emerald-300'
                : 'bg-red-950/40 border-red-900/60 text-red-300'
            }`}
          >
            {testResult.success ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span>{testResult.message}</span>
          </div>
        )}
      </div>
    </div>
  );
}
