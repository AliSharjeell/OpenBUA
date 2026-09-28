import React, { useState } from 'react';
import { AppSettings, ProviderType } from '../types';
import { saveSettings } from '../services/storage';
import { Button } from './ui/button';
import { Input, Textarea } from './ui/input';
import { Badge, Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import {
  Key,
  Globe,
  Cpu,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Sparkles,
  ShieldCheck,
  Zap,
} from 'lucide-react';

interface SettingsViewProps {
  settings: AppSettings;
  onSettingsSaved: (updated: AppSettings) => void;
}

export function SettingsView({ settings, onSettingsSaved }: SettingsViewProps) {
  const [activeProvider, setActiveProvider] = useState<ProviderType>(settings.activeProvider);

  // OpenAI Config
  const [openaiUrl, setOpenaiUrl] = useState(settings.openai.baseUrl || 'https://api.openai.com/v1');
  const [openaiKey, setOpenaiKey] = useState(settings.openai.apiKey || '');
  const [openaiModel, setOpenaiModel] = useState(settings.openai.model || 'gpt-4o');

  // Anthropic Config
  const [anthropicUrl, setAnthropicUrl] = useState(settings.anthropic.baseUrl || 'https://api.anthropic.com/v1');
  const [anthropicKey, setAnthropicKey] = useState(settings.anthropic.apiKey || '');
  const [anthropicModel, setAnthropicModel] = useState(settings.anthropic.model || 'claude-3-7-sonnet-20250219');

  const [autoConfirmSubmit, setAutoConfirmSubmit] = useState(settings.autoConfirmSubmit ?? true);
  const [systemInstruction, setSystemInstruction] = useState(settings.systemInstruction || '');

  const [showKey, setShowKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Connection testing state
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccess(false);

    const updated: AppSettings = {
      activeProvider,
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

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);

    const isAnthropic = activeProvider === 'anthropic';
    const key = isAnthropic ? anthropicKey.trim() : openaiKey.trim();
    const url = isAnthropic ? anthropicUrl.trim() : openaiUrl.trim();
    const model = isAnthropic ? anthropicModel.trim() : openaiModel.trim();

    if (!key) {
      setTestResult({
        success: false,
        message: `Please enter an API Key for ${activeProvider.toUpperCase()} first.`,
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
          message: `Connection successful! (${elapsed}ms) Model responded.`,
        });
      } else {
        let endpoint = url.replace(/\/+$/, '');
        if (!endpoint.endsWith('/chat/completions')) endpoint = `${endpoint}/chat/completions`;

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model: model || 'gpt-4o',
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
          message: `Connection successful! (${elapsed}ms) Model responded.`,
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

  const currentKey = activeProvider === 'anthropic' ? anthropicKey : openaiKey;
  const isKeyConfigured = Boolean(currentKey && currentKey.trim().length > 3);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-1.5">
            <Key className="w-4 h-4 text-zinc-300" />
            Model & Provider Settings
          </h2>
          <p className="text-[11px] text-zinc-400">
            Configure BYOK endpoints and models (OpenAI, Anthropic, Minimax, MiMo, etc.)
          </p>
        </div>
      </div>

      {/* Provider Switcher Tabs */}
      <div className="flex rounded-md bg-zinc-900 p-1 border border-zinc-800">
        <button
          className={`flex-1 py-1.5 px-3 rounded text-xs font-medium transition-all ${
            activeProvider === 'openai'
              ? 'bg-zinc-800 text-zinc-100 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
          onClick={() => setActiveProvider('openai')}
        >
          OpenAI Compatible
        </button>
        <button
          className={`flex-1 py-1.5 px-3 rounded text-xs font-medium transition-all ${
            activeProvider === 'anthropic'
              ? 'bg-zinc-800 text-zinc-100 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
          onClick={() => setActiveProvider('anthropic')}
        >
          Anthropic Compatible
        </button>
      </div>

      {/* Active Provider Form */}
      {activeProvider === 'openai' ? (
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardHeader className="p-3 pb-2 border-b border-zinc-800/60">
            <CardTitle className="text-xs font-medium flex items-center gap-1.5 text-zinc-200">
              <Globe className="w-3.5 h-3.5 text-zinc-400" />
              OpenAI / Compatible Endpoint & Key
            </CardTitle>
            <CardDescription className="text-[10px]">
              Works with official OpenAI, OpenRouter, Minimax OpenAI API, Groq, Ollama, etc.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-3 space-y-3">
            <div>
              <label className="text-[11px] text-zinc-400 block mb-1">Base URL</label>
              <Input
                placeholder="https://api.openai.com/v1"
                value={openaiUrl}
                onChange={(e) => setOpenaiUrl(e.target.value)}
              />
              <div className="flex gap-1.5 mt-1.5 flex-wrap">
                <span className="text-[9px] text-zinc-500">Presets:</span>
                <button
                  type="button"
                  className="text-[9px] text-zinc-400 hover:text-zinc-200 underline"
                  onClick={() => setOpenaiUrl('https://api.openai.com/v1')}
                >
                  OpenAI
                </button>
                <button
                  type="button"
                  className="text-[9px] text-zinc-400 hover:text-zinc-200 underline"
                  onClick={() => setOpenaiUrl('https://openrouter.ai/api/v1')}
                >
                  OpenRouter
                </button>
                <button
                  type="button"
                  className="text-[9px] text-zinc-400 hover:text-zinc-200 underline"
                  onClick={() => setOpenaiUrl('https://api.minimax.chat/v1')}
                >
                  Minimax
                </button>
              </div>
            </div>

            <div>
              <label className="text-[11px] text-zinc-400 block mb-1">API Key</label>
              <div className="relative">
                <Input
                  type={showKey ? 'text' : 'password'}
                  placeholder="sk-..."
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  className="pr-8"
                />
                <button
                  type="button"
                  className="absolute right-2 top-2 text-zinc-400 hover:text-zinc-200"
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
              />
              <div className="flex gap-1.5 mt-1.5 flex-wrap">
                <span className="text-[9px] text-zinc-500">Presets:</span>
                {['gpt-4o', 'gpt-4o-mini', 'minimax-text-01', 'deepseek-chat'].map((m) => (
                  <button
                    key={m}
                    type="button"
                    className="text-[9px] text-zinc-400 hover:text-zinc-200 underline"
                    onClick={() => setOpenaiModel(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardHeader className="p-3 pb-2 border-b border-zinc-800/60">
            <CardTitle className="text-xs font-medium flex items-center gap-1.5 text-zinc-200">
              <Globe className="w-3.5 h-3.5 text-zinc-400" />
              Anthropic / Compatible Endpoint & Key
            </CardTitle>
            <CardDescription className="text-[10px]">
              Works with official Anthropic, Minimax Anthropic-compatible, Mimo, Claude proxies.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-3 space-y-3">
            <div>
              <label className="text-[11px] text-zinc-400 block mb-1">Base URL</label>
              <Input
                placeholder="https://api.anthropic.com/v1"
                value={anthropicUrl}
                onChange={(e) => setAnthropicUrl(e.target.value)}
              />
              <div className="flex gap-1.5 mt-1.5 flex-wrap">
                <span className="text-[9px] text-zinc-500">Presets:</span>
                <button
                  type="button"
                  className="text-[9px] text-zinc-400 hover:text-zinc-200 underline"
                  onClick={() => setAnthropicUrl('https://api.anthropic.com/v1')}
                >
                  Anthropic Default
                </button>
                <button
                  type="button"
                  className="text-[9px] text-zinc-400 hover:text-zinc-200 underline"
                  onClick={() => setAnthropicUrl('https://api.minimax.chat/v1')}
                >
                  Minimax (Anthropic)
                </button>
              </div>
            </div>

            <div>
              <label className="text-[11px] text-zinc-400 block mb-1">Anthropic / Mimo API Key</label>
              <div className="relative">
                <Input
                  type={showKey ? 'text' : 'password'}
                  placeholder="sk-ant-..."
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  className="pr-8"
                />
                <button
                  type="button"
                  className="absolute right-2 top-2 text-zinc-400 hover:text-zinc-200"
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
              />
              <div className="flex gap-1.5 mt-1.5 flex-wrap">
                <span className="text-[9px] text-zinc-500">Presets:</span>
                {['claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'].map((m) => (
                  <button
                    key={m}
                    type="button"
                    className="text-[9px] text-zinc-400 hover:text-zinc-200 underline"
                    onClick={() => setAnthropicModel(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Safety & Preferences */}
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
            />
          </div>
        </CardContent>
      </Card>

      {/* Test Connection Probe */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTestConnection}
            disabled={isTesting}
            className="gap-1.5"
          >
            <Zap className={`w-3.5 h-3.5 ${isTesting ? 'animate-pulse text-amber-400' : ''}`} />
            {isTesting ? 'Testing Probe...' : 'Test Connection'}
          </Button>

          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 gap-1.5 bg-zinc-100 text-zinc-900 hover:bg-zinc-200 font-semibold"
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
