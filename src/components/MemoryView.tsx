import React, { useState } from 'react';
import { UserDocument } from '../types';
import {
  saveGlobalMemory,
  deleteGlobalMemory,
  toggleGlobalMemoryActive,
  saveTabMemory,
  deleteTabMemory,
  toggleTabMemoryActive,
} from '../services/storage';
import { readFileContent } from '../services/pdf-parser';
import { Button } from './ui/button';
import { Input, Textarea } from './ui/input';
import { Badge, Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import {
  FileText,
  Upload,
  Plus,
  Trash2,
  Check,
  FileCode,
  FileSpreadsheet,
  Globe,
  Layers,
  AlertCircle,
} from 'lucide-react';

interface MemoryViewProps {
  currentTabKey: string;
  currentTabTitle?: string;
  globalMemories: UserDocument[];
  tabMemories: UserDocument[];
  onGlobalMemoriesChange: (docs: UserDocument[]) => void;
  onTabMemoriesChange: (docs: UserDocument[]) => void;
}

export function MemoryView({
  currentTabKey,
  currentTabTitle,
  globalMemories,
  tabMemories,
  onGlobalMemoriesChange,
  onTabMemoriesChange,
}: MemoryViewProps) {
  const [memoryScope, setMemoryScope] = useState<'tab' | 'global'>('global');
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<UserDocument | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // New Memory Form
  const [title, setTitle] = useState('');
  const [type, setType] = useState<'markdown' | 'text' | 'pdf' | 'json'>('markdown');
  const [content, setContent] = useState('');
  const [tagsStr, setTagsStr] = useState('');

  const activeMemories = memoryScope === 'global' ? globalMemories : tabMemories;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const { content: extractedContent, type: fileType } = await readFileContent(file);
      const newDoc: UserDocument = {
        id: `mem-${Date.now()}`,
        title: file.name.replace(/\.[^/.]+$/, ''),
        type: fileType,
        content: extractedContent,
        summary: `Imported from ${file.name} (${Math.round(file.size / 1024)} KB)`,
        createdAt: Date.now(),
        sizeBytes: file.size,
        tags: [fileType, 'imported'],
        isActiveForContext: true,
        isGlobal: memoryScope === 'global',
        tabUrlPattern: memoryScope === 'tab' ? currentTabKey : undefined,
      };

      if (memoryScope === 'global') {
        await saveGlobalMemory(newDoc);
        onGlobalMemoriesChange([newDoc, ...globalMemories]);
      } else {
        await saveTabMemory(currentTabKey, newDoc);
        onTabMemoriesChange([newDoc, ...tabMemories]);
      }
    } catch (err: any) {
      setUploadError(err?.message || 'Failed to parse file');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleSaveMemory = async () => {
    if (!title.trim() || !content.trim()) return;

    const tags = tagsStr
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const newDoc: UserDocument = {
      id: selectedDoc?.id || `mem-${Date.now()}`,
      title: title.trim(),
      type,
      content: content.trim(),
      summary: `${title.trim()} (${content.trim().slice(0, 80)}...)`,
      createdAt: selectedDoc?.createdAt || Date.now(),
      sizeBytes: new Blob([content]).size,
      tags: tags.length > 0 ? tags : ['custom'],
      isActiveForContext: selectedDoc ? selectedDoc.isActiveForContext : true,
      isGlobal: memoryScope === 'global',
      tabUrlPattern: memoryScope === 'tab' ? currentTabKey : undefined,
    };

    if (memoryScope === 'global') {
      await saveGlobalMemory(newDoc);
      if (selectedDoc) {
        onGlobalMemoriesChange(globalMemories.map((m) => (m.id === newDoc.id ? newDoc : m)));
      } else {
        onGlobalMemoriesChange([newDoc, ...globalMemories]);
      }
    } else {
      await saveTabMemory(currentTabKey, newDoc);
      if (selectedDoc) {
        onTabMemoriesChange(tabMemories.map((m) => (m.id === newDoc.id ? newDoc : m)));
      } else {
        onTabMemoriesChange([newDoc, ...tabMemories]);
      }
    }

    resetForm();
  };

  const handleDelete = async (id: string) => {
    if (memoryScope === 'global') {
      await deleteGlobalMemory(id);
      onGlobalMemoriesChange(globalMemories.filter((m) => m.id !== id));
    } else {
      await deleteTabMemory(currentTabKey, id);
      onTabMemoriesChange(tabMemories.filter((m) => m.id !== id));
    }
    if (selectedDoc?.id === id) {
      resetForm();
    }
  };

  const handleToggleTick = async (id: string) => {
    if (memoryScope === 'global') {
      const updated = await toggleGlobalMemoryActive(id);
      onGlobalMemoriesChange(updated);
    } else {
      const updated = await toggleTabMemoryActive(currentTabKey, id);
      onTabMemoriesChange(updated);
    }
  };

  const resetForm = () => {
    setIsAddingNew(false);
    setIsEditing(false);
    setSelectedDoc(null);
    setTitle('');
    setContent('');
    setTagsStr('');
    setType('markdown');
  };

  const openEdit = (doc: UserDocument) => {
    setSelectedDoc(doc);
    setTitle(doc.title);
    setContent(doc.content);
    setType(doc.type);
    setTagsStr(doc.tags?.join(', ') || '');
    setIsEditing(true);
    setIsAddingNew(true);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs select-text bg-zinc-950">
      {/* Header and Scope Selector */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-zinc-100 text-sm tracking-tight">Memory Store</h2>
            <p className="text-[11px] text-zinc-400">
              Profiles & stored knowledge used to fill forms automatically.
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <label
              className={`inline-flex items-center justify-center h-7 w-7 rounded-full border border-zinc-800 bg-zinc-900/80 hover:bg-zinc-850 text-zinc-300 shadow-xs transition-colors ${
                isUploading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
              }`}
              title={isUploading ? 'Importing file...' : 'Upload MD or PDF'}
            >
              <input
                type="file"
                accept=".pdf,.md,.txt,.json"
                className="hidden"
                onChange={handleFileUpload}
                disabled={isUploading}
              />
              <Upload className="w-3.5 h-3.5" />
            </label>

            <Button
              size="sm"
              className="h-7 px-2.5 text-[11px] gap-1.5 rounded-full bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
              onClick={() => {
                resetForm();
                setIsAddingNew(!isAddingNew);
              }}
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </Button>
          </div>
        </div>

        {/* Sub-Tabs: Global Memory vs Current Tab Memory */}
        <div className="flex items-center bg-zinc-900/90 p-1 rounded-full border border-zinc-800">
          <button
            type="button"
            className={`flex-1 flex items-center justify-center gap-1.5 py-1 px-2.5 rounded-full text-[11px] font-medium transition-all ${
              memoryScope === 'global'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
            onClick={() => {
              setMemoryScope('global');
              resetForm();
            }}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Global Memory</span>
            <span className="text-[9px] px-1.5 py-0.2 bg-zinc-950 rounded-full text-zinc-300">
              {globalMemories.filter((m) => m.isActiveForContext).length}
            </span>
          </button>

          <button
            type="button"
            className={`flex-1 flex items-center justify-center gap-1.5 py-1 px-2.5 rounded-full text-[11px] font-medium transition-all ${
              memoryScope === 'tab'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
            onClick={() => {
              setMemoryScope('tab');
              resetForm();
            }}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Current Tab</span>
            <span className="text-[9px] px-1.5 py-0.2 bg-zinc-950 rounded-full text-zinc-300">
              {tabMemories.filter((m) => m.isActiveForContext).length}
            </span>
          </button>
        </div>

        {memoryScope === 'tab' && (
          <div className="px-1 text-[10px] text-zinc-400 truncate">
            Tab scope: <span className="font-mono text-zinc-300">{currentTabTitle || currentTabKey}</span>
          </div>
        )}
      </div>

      {uploadError && (
        <div className="p-2.5 bg-red-950/40 border border-red-900/60 rounded-xl text-red-300 flex items-start gap-2 text-[11px]">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{uploadError}</span>
        </div>
      )}

      {/* Add / Edit Memory Form Panel */}
      {isAddingNew && (
        <Card className="border-zinc-800 bg-zinc-900/90 rounded-2xl shadow-md">
          <CardHeader className="p-3 pb-2 border-b border-zinc-800">
            <CardTitle className="text-xs font-semibold text-zinc-100">
              {isEditing
                ? `Edit ${memoryScope === 'global' ? 'Global' : 'Tab'} Memory`
                : `New ${memoryScope === 'global' ? 'Global' : 'Tab'} Memory`}
            </CardTitle>
            <CardDescription className="text-[10px] text-zinc-400">
              {memoryScope === 'global'
                ? 'General info consistent across all forms and tabs (e.g. Profile, About Me).'
                : 'Custom notes and data specific only to this browser tab.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-3 space-y-2.5">
            <div>
              <label className="text-[10px] font-medium text-zinc-400 block mb-1">Title</label>
              <Input
                placeholder="e.g. Personal Profile, Job History, Address"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-8 rounded-xl bg-zinc-950/80 border-zinc-800 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-medium text-zinc-400 block mb-1">Format</label>
                <select
                  className="w-full h-8 rounded-xl border border-zinc-800 bg-zinc-950/80 px-2 text-xs text-zinc-200"
                  value={type}
                  onChange={(e) => setType(e.target.value as any)}
                >
                  <option value="markdown">Markdown (.md)</option>
                  <option value="text">Plain Text (.txt)</option>
                  <option value="json">JSON (.json)</option>
                  <option value="pdf">Extracted PDF</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-medium text-zinc-400 block mb-1">Tags</label>
                <Input
                  placeholder="profile, contact, work"
                  value={tagsStr}
                  onChange={(e) => setTagsStr(e.target.value)}
                  className="h-8 rounded-xl bg-zinc-950/80 border-zinc-800 text-xs"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-medium text-zinc-400 block mb-1">Content</label>
              <Textarea
                rows={6}
                placeholder="Paste personal details, bio, or form answers here..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="font-mono text-[11px] rounded-xl bg-zinc-950/80 border-zinc-800"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button size="sm" variant="ghost" className="h-7 text-[11px] rounded-full" onClick={resetForm}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 text-[11px] rounded-full bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
                onClick={handleSaveMemory}
                disabled={!title.trim() || !content.trim()}
              >
                {isEditing ? 'Save Changes' : 'Save Memory'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Memory Cards List */}
      <div className="space-y-2">
        {activeMemories.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-zinc-800 rounded-2xl p-6">
            <FileText className="w-7 h-7 text-zinc-600 mx-auto mb-2" />
            <p className="text-xs text-zinc-400 mb-1">
              No {memoryScope === 'global' ? 'global' : 'tab'} memories yet
            </p>
            <p className="text-[11px] text-zinc-500 mb-3 max-w-[240px] mx-auto">
              {memoryScope === 'global'
                ? 'Add your About Me, profile, and resume data to use across all forms.'
                : 'Add memories or notes specifically for this webpage.'}
            </p>
            <Button
              size="sm"
              className="rounded-full text-[11px]"
              onClick={() => {
                resetForm();
                setIsAddingNew(true);
              }}
            >
              Add Memory
            </Button>
          </div>
        ) : (
          activeMemories.map((doc) => {
            const isSelected = selectedDoc?.id === doc.id;
            return (
              <div
                key={doc.id}
                className={`p-3 rounded-2xl border transition-all cursor-pointer ${
                  doc.isActiveForContext
                    ? 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700'
                    : 'border-zinc-850 bg-zinc-950/40 opacity-60 hover:opacity-100'
                }`}
                onClick={() => openEdit(doc)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300 mt-0.5 shrink-0">
                      {doc.type === 'pdf' ? (
                        <FileSpreadsheet className="w-4 h-4 text-rose-400" />
                      ) : doc.type === 'json' ? (
                        <FileCode className="w-4 h-4 text-amber-400" />
                      ) : (
                        <FileText className="w-4 h-4 text-zinc-200" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-zinc-100 text-xs truncate">
                          {doc.title}
                        </span>
                        <Badge variant="zinc" className="uppercase text-[9px] py-0 px-1 font-mono">
                          {doc.type}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-zinc-400 mt-1 line-clamp-2">
                        {doc.summary || doc.content.slice(0, 110)}
                      </p>
                      <div className="flex items-center gap-2.5 mt-2 text-[10px] text-zinc-500">
                        <span>{Math.round((doc.sizeBytes / 1024) * 10) / 10} KB</span>
                        {doc.tags?.slice(0, 3).map((t) => (
                          <span key={t} className="text-zinc-400">
                            #{t}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Clean Tick Checkmark Toggle + Trash Button */}
                  <div
                    className="flex items-center gap-1.5 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      title={doc.isActiveForContext ? 'Turn off memory' : 'Turn on memory'}
                      className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                        doc.isActiveForContext
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/30'
                          : 'bg-zinc-900 text-zinc-600 border border-zinc-800 hover:text-zinc-400'
                      }`}
                      onClick={() => handleToggleTick(doc.id)}
                    >
                      <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                    </button>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 rounded-full text-zinc-500 hover:text-red-400 hover:bg-zinc-800"
                      onClick={() => handleDelete(doc.id)}
                      title="Delete memory"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
