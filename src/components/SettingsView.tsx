import React, { useState, useEffect } from 'react';
import { AppSettings, ProviderType, ModelMode } from '../types';
import { saveSettings } from '../services/storage';
import { Button } from './ui/button';
import { Input, Textarea } from './ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import {
  Key,
  Globe,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Sparkles,
  ShieldCheck,
  Zap,
  ExternalLink,
  Activity,
  Check,
} from 'lucide-react';

interface SettingsViewProps {
  settings: AppSettings;
  onSettingsSaved: (updated: AppSettings) => void;
  activeTab?: ModelMode;
  onTabChange?: (tab: ModelMode) => void;
}

export function SettingsView({ settings, onSettingsSaved, activeTab, onTabChange }: SettingsViewProps) {
  // Mode: Free vs BYOK
  const [currentTab, setCurrentTab] = useState<ModelMode>(activeTab || settings.selectedMode || 'free');

  useEffect(() => {
    if (activeTab && activeTab !== currentTab) {
      setCurrentTab(activeTab);
    }
  }, [activeTab]);

  const handleTabSwitch = (tab: ModelMode) => {
    setCurrentTab(tab);
    onTabChange?.(tab);
  };

  // Selected active mode for the agent ('free' or 'byok')
  const [selectedMode, setSelectedMode] = useState<ModelMode>(settings.selectedMode || 'free');

  // Free Tier (Google Gemini) Config
  const [freeUrl, setFreeUrl] = useState(
    settings.free?.baseUrl || 'https://generativelanguage.googleapis.com/v1beta/openai/'
  );
  const [freeKey, setFreeKey] = useState(settings.free?.apiKey || '');
  const [freeModel, setFreeModel] = useState(settings.free?.model || 'gemini-3.8-flash');

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

  const [autoConfirmSubmit, setAutoConfirmSubmit] = useState(settings.autoConfirmSubmit ?? true);
  const [systemInstruction, setSystemInstruction] = useState(settings.systemInstruction || '');

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
          if (endpoint.endsWith('/v1')) {
            endpoint = `${endpoint}/chat/completions`;
          } else {
            endpoint = `${endpoint}/chat/completions`;
          }
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
      {/* Header with Title and Mode Indicator */}
      <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-1.5">
            <Key className="w-4 h-4 text-zinc-300" />
            Model & Provider Settings
          </h2>
          <p className="text-[11px] text-zinc-400">
            Switch between Google Gemini Free Tier and Custom BYOK Endpoints
          </p>
        </div>
      </div>

      {/* Free vs BYOK Tab Switcher Bar */}
      <div className="flex rounded-xl bg-zinc-900/90 p-1 border border-zinc-800 shadow-sm">
        <button
          type="button"
          className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            currentTab === 'free'
              ? 'bg-zinc-100 text-zinc-950 font-semibold shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
          onClick={() => handleTabSwitch('free')}
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          <span>Free Models</span>
          {selectedMode === 'free' && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 ml-0.5" title="Active Model" />
          )}
        </button>
        <button
          type="button"
          className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            currentTab === 'byok'
              ? 'bg-zinc-100 text-zinc-950 font-semibold shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
          onClick={() => handleTabSwitch('byok')}
        >
          <Globe className="w-3.5 h-3.5 text-blue-400" />
          <span>BYOK</span>
          {selectedMode === 'byok' && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 ml-0.5" title="Active Model" />
          )}
        </button>
      </div>

      {/* ======================================================== */}
      {/* FREE TIER TAB (Google Gemini Free) */}
      {/* ======================================================== */}
      {currentTab === 'free' && (
        <div className="space-y-3.5">
          <Card className="border-zinc-800 bg-zinc-900/60 shadow-lg">
            <CardHeader className="p-3 pb-2.5 border-b border-zinc-800/60">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-semibold flex items-center gap-1.5 text-zinc-100">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  Google Gemini Free Tier
                </CardTitle>

                {/* Current Model Status / Set Button */}
                {selectedMode === 'free' ? (
                  <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-2.5 py-1 rounded-full shadow-xs">
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span>Current Model</span>
                  </div>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleSetCurrentModel('free')}
                    className="h-6 text-[10px] px-2.5 rounded-full border-zinc-700 hover:border-emerald-500/80 hover:text-emerald-300 transition-colors"
                  >
                    Set as Current Model
                  </Button>
                )}
              </div>
              <CardDescription className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                Free browser automation via Google AI Studio. 100% free with any standard Google account.
              </CardDescription>
            </CardHeader>

            <CardContent className="p-3 space-y-3.5">
              {/* Get API Key Action Button */}
              <div className="p-3 bg-gradient-to-r from-blue-950/40 via-zinc-900/60 to-purple-950/30 border border-blue-900/40 rounded-xl flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-xs font-medium text-zinc-100 flex items-center gap-1.5">
                    <span>Google AI Studio Key</span>
                    <span className="text-[10px] text-emerald-400 font-semibold bg-emerald-950/80 px-1.5 py-0.2 rounded border border-emerald-800/60">
                      FREE
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-400 leading-normal">
                    Sign in with Google & click "Create API key"
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleOpenAiStudio}
                  className="bg-blue-600 hover:bg-blue-500 text-white font-medium text-[11px] h-7 px-3 rounded-lg shrink-0 flex items-center gap-1.5 shadow-md shadow-blue-950/50 cursor-pointer"
                >
                  <span>Get Gemini API Key</span>
                  <ExternalLink className="w-3 h-3" />
                </Button>
              </div>

              {/* Gemini API Key Input */}
              <div>
                <label className="text-[11px] font-medium text-zinc-300 block mb-1">
                  Gemini API Key
                </label>
                <div className="relative">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    placeholder="AIzaSy..."
                    value={freeKey}
                    onChange={(e) => setFreeKey(e.target.value)}
                    className="pr-8 bg-zinc-950 border-zinc-800 font-mono text-[11px]"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-2 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                    onClick={() => setShowKey(!showKey)}
                  >
                    {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Model Selection */}
              <div>
                <label className="text-[11px] font-medium text-zinc-300 block mb-1">
                  Model
                </label>
                <Input
                  placeholder="gemini-3.8-flash"
                  value={freeModel}
                  onChange={(e) => setFreeModel(e.target.value)}
                  className="bg-zinc-950 border-zinc-800 font-mono text-[11px]"
                />
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  <span className="text-[9px] text-zinc-500">Presets:</span>
                  {['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'].map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`text-[9px] underline transition-colors cursor-pointer ${
                        freeModel === m ? 'text-amber-400 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                      onClick={() => setFreeModel(m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Base URL (OpenAI Compatible) */}
              <div>
                <label className="text-[11px] font-medium text-zinc-400 block mb-1">
                  OpenAI Compatible Endpoint
                </label>
                <Input
                  value={freeUrl}
                  onChange={(e) => setFreeUrl(e.target.value)}
                  className="bg-zinc-950 border-zinc-800 font-mono text-[10px] text-zinc-300"
                />
              </div>
            </CardContent>
          </Card>

          {/* Usage Limits & Quota Card */}
          <Card className="border-zinc-800/80 bg-zinc-900/40">
            <CardHeader className="p-3 pb-2 border-b border-zinc-800/60 flex flex-row items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-emerald-400" />
                <CardTitle className="text-xs font-medium text-zinc-200">
                  Gemini Free Tier Usage Limits
                </CardTitle>
              </div>
              <button
                type="button"
                onClick={handleOpenAiStudio}
                className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 underline cursor-pointer"
              >
                <span>Usage Dashboard</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </button>
            </CardHeader>
            <CardContent className="p-3">
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="bg-zinc-950/80 p-2 rounded-lg border border-zinc-800/60">
                  <div className="text-[10px] text-zinc-400">Daily Requests (RPD)</div>
                  <div className="text-xs font-semibold text-zinc-100 mt-0.5">1,500 / day</div>
                  <div className="text-[9px] text-zinc-500 mt-0.5">Resets midnight PT</div>
                </div>

                <div className="bg-zinc-950/80 p-2 rounded-lg border border-zinc-800/60">
                  <div className="text-[10px] text-zinc-400">Rate Limit (RPM)</div>
                  <div className="text-xs font-semibold text-zinc-100 mt-0.5">15 / minute</div>
                  <div className="text-[9px] text-zinc-500 mt-0.5">Fast bursts allowed</div>
                </div>

                <div className="bg-zinc-950/80 p-2 rounded-lg border border-zinc-800/60">
                  <div className="text-[10px] text-zinc-400">Token Quota (TPM)</div>
                  <div className="text-xs font-semibold text-zinc-100 mt-0.5">1,000,000 / min</div>
                  <div className="text-[9px] text-zinc-500 mt-0.5">Input tokens</div>
                </div>

                <div className="bg-zinc-950/80 p-2 rounded-lg border border-zinc-800/60">
                  <div className="text-[10px] text-zinc-400">Context Window</div>
                  <div className="text-xs font-semibold text-zinc-100 mt-0.5">1,048,576 tokens</div>
                  <div className="text-[9px] text-zinc-500 mt-0.5">1 Million context</div>
                </div>
              </div>

              <div className="mt-2.5 pt-2 border-t border-zinc-800/60 flex items-center justify-between text-[10px] text-zinc-400">
                <span>Cost: <strong className="text-emerald-400 font-semibold">$0.00 / month</strong></span>
                <span className="text-zinc-500">Google AI Studio Free Tier</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ======================================================== */}
      {/* BYOK TAB (Bring Your Own Key: OpenAI / Anthropic) */}
      {/* ======================================================== */}
      {currentTab === 'byok' && (
        <div className="space-y-3.5">
          <Card className="border-zinc-800 bg-zinc-900/60 shadow-lg">
            <CardHeader className="p-3 pb-2.5 border-b border-zinc-800/60">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-semibold flex items-center gap-1.5 text-zinc-100">
                  <Globe className="w-3.5 h-3.5 text-blue-400" />
                  BYOK Custom Model
                </CardTitle>

                {/* Current Model Status / Set Button */}
                {selectedMode === 'byok' ? (
                  <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-2.5 py-1 rounded-full shadow-xs">
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span>Current Model</span>
                  </div>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleSetCurrentModel('byok')}
                    className="h-6 text-[10px] px-2.5 rounded-full border-zinc-700 hover:border-emerald-500/80 hover:text-emerald-300 transition-colors"
                  >
                    Set as Current Model
                  </Button>
                )}
              </div>
              <CardDescription className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                Connect your personal API keys (OpenAI, Anthropic, DeepSeek, Groq, OpenRouter, MiniMax, etc.)
              </CardDescription>
            </CardHeader>

            <CardContent className="p-3 space-y-3.5">
              {/* Provider Sub-tabs */}
              <div className="flex rounded-lg bg-zinc-950 p-1 border border-zinc-800">
                <button
                  type="button"
                  className={`flex-1 py-1.5 px-3 rounded text-xs font-medium transition-all cursor-pointer ${
                    activeProvider === 'openai'
                      ? 'bg-zinc-800 text-zinc-100 shadow-sm font-semibold'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                  onClick={() => setActiveProvider('openai')}
                >
                  OpenAI Compatible
                </button>
                <button
                  type="button"
                  className={`flex-1 py-1.5 px-3 rounded text-xs font-medium transition-all cursor-pointer ${
                    activeProvider === 'anthropic'
                      ? 'bg-zinc-800 text-zinc-100 shadow-sm font-semibold'
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
                    <label className="text-[11px] text-zinc-400 block mb-1">Base URL</label>
                    <Input
                      placeholder="https://api.openai.com/v1"
                      value={openaiUrl}
                      onChange={(e) => setOpenaiUrl(e.target.value)}
                      className="bg-zinc-950 border-zinc-800 font-mono text-[11px]"
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
                      <label className="text-[11px] text-zinc-400">API Key</label>
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
                        className="pr-8 bg-zinc-950 border-zinc-800 font-mono text-[11px]"
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-2 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                        onClick={() => setShowKey(!showKey)}
                      >
                        {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] text-zinc-400 block mb-1">Model ID</label>
                    <Input
                      placeholder="gpt-4o"
                      value={openaiModel}
                      onChange={(e) => setOpenaiModel(e.target.value)}
                      className="bg-zinc-950 border-zinc-800 font-mono text-[11px]"
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
                    <label className="text-[11px] text-zinc-400 block mb-1">Base URL</label>
                    <Input
                      placeholder="https://api.anthropic.com/v1"
                      value={anthropicUrl}
                      onChange={(e) => setAnthropicUrl(e.target.value)}
                      className="bg-zinc-950 border-zinc-800 font-mono text-[11px]"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] text-zinc-400 block mb-1">Anthropic API Key</label>
                    <div className="relative">
                      <Input
                        type={showKey ? 'text' : 'password'}
                        placeholder="sk-ant-..."
                        value={anthropicKey}
                        onChange={(e) => setAnthropicKey(e.target.value)}
                        className="pr-8 bg-zinc-950 border-zinc-800 font-mono text-[11px]"
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-2 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                        onClick={() => setShowKey(!showKey)}
                      >
                        {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] text-zinc-400 block mb-1">Model Name</label>
                    <Input
                      placeholder="claude-3-7-sonnet-20250219"
                      value={anthropicModel}
                      onChange={(e) => setAnthropicModel(e.target.value)}
                      className="bg-zinc-950 border-zinc-800 font-mono text-[11px]"
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
            </CardContent>
          </Card>
        </div>
      )}

      {/* Autonomous Safety & Preferences (Shown for both modes) */}
      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardHeader className="p-3 pb-2 border-b border-zinc-800/60">
          <CardTitle className="text-xs font-medium flex items-center gap-1.5 text-zinc-200">
            <ShieldCheck className="w-3.5 h-3.5 text-zinc-400" />
            Autonomous Preferences
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 space-y-3">
          <label className="flex items-center gap-2 cursor-pointer text-zinc-200">
            <input
              type="checkbox"
              checked={autoConfirmSubmit}
              onChange={(e) => setAutoConfirmSubmit(e.target.checked)}
              className="rounded bg-zinc-800 border-zinc-700 text-zinc-100"
            />
            <span className="text-xs">Require confirmation before final form submission</span>
          </label>

          <div>
            <label className="text-[11px] text-zinc-400 block mb-1">Custom System Instruction</label>
            <Textarea
              rows={2}
              placeholder="Custom instructions (e.g. Always format phone numbers as (XXX) XXX-XXXX...)"
              value={systemInstruction}
              onChange={(e) => setSystemInstruction(e.target.value)}
              className="bg-zinc-950 border-zinc-800 text-xs"
            />
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons: Test Connection & Save Settings */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTestConnection}
            disabled={isTesting}
            className="gap-1.5 cursor-pointer border-zinc-800 hover:bg-zinc-900"
          >
            <Zap className={`w-3.5 h-3.5 ${isTesting ? 'animate-pulse text-amber-400' : ''}`} />
            {isTesting ? 'Testing Probe...' : 'Test Connection'}
          </Button>

          <Button
            size="sm"
            onClick={() => handleSave()}
            disabled={isSaving}
            className="flex-1 gap-1.5 bg-zinc-100 text-zinc-900 hover:bg-zinc-200 font-semibold cursor-pointer"
          >
            {saveSuccess ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Saved!
              </>
            ) : (
              'Save Settings'
            )}
          </Button>
        </div>

        {testResult && (
          <div
            className={`p-2.5 rounded-md border text-[11px] flex items-start gap-2 ${
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
