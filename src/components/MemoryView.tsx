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
import { Button } from './ui/button';
import { Input, Textarea } from './ui/input';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import {
  FileText,
  Plus,
  Trash2,
  Check,
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

  // New Memory Form
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const activeMemories = memoryScope === 'global' ? globalMemories : tabMemories;

  const handleSaveMemory = async () => {
    if (!title.trim() || !content.trim()) return;

    const newDoc: UserDocument = {
      id: selectedDoc?.id || `mem-${Date.now()}`,
      title: title.trim(),
      type: selectedDoc?.type || 'markdown',
      content: content.trim(),
      summary: `${title.trim()} (${content.trim().slice(0, 80)}...)`,
      createdAt: selectedDoc?.createdAt || Date.now(),
      sizeBytes: new Blob([content]).size,
      tags: selectedDoc?.tags || ['custom'],
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
  };

  const openEdit = (doc: UserDocument) => {
    setSelectedDoc(doc);
    setTitle(doc.title);
    setContent(doc.content);
    setIsEditing(true);
    setIsAddingNew(true);
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 pt-16 pb-6 space-y-4 text-xs select-text bg-zinc-950">
      {/* Header and Scope Selector */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-zinc-100 text-sm tracking-tight">Memory</h2>

          <Button
            size="sm"
            className="h-7 px-3 text-[11px] gap-1.5 rounded-full bg-zinc-100 text-zinc-950 hover:bg-zinc-200 cursor-pointer"
            onClick={() => {
              if (isAddingNew && !isEditing) {
                resetForm();
              } else {
                resetForm();
                setIsAddingNew(true);
              }
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </Button>
        </div>

        {/* Sub-Tabs: Global Memory vs Current Tab Memory (Styled like BYOK provider selector) */}
        <div className="flex rounded-full bg-zinc-900 p-0.5 border border-zinc-800">
          <button
            type="button"
            className={`flex-1 py-1.5 px-3 rounded-full text-xs font-medium transition-all cursor-pointer ${
              memoryScope === 'global'
                ? 'bg-zinc-100 text-zinc-950 font-semibold shadow-xs'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
            onClick={() => {
              setMemoryScope('global');
              resetForm();
            }}
          >
            Global Memory
          </button>
          <button
            type="button"
            className={`flex-1 py-1.5 px-3 rounded-full text-xs font-medium transition-all cursor-pointer ${
              memoryScope === 'tab'
                ? 'bg-zinc-100 text-zinc-950 font-semibold shadow-xs'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
            onClick={() => {
              setMemoryScope('tab');
              resetForm();
            }}
          >
            Current Tab
          </button>
        </div>

        {memoryScope === 'tab' && (
          <div className="px-1 text-[10px] text-zinc-400 truncate">
            Tab scope: <span className="font-mono text-zinc-300">{currentTabTitle || currentTabKey}</span>
          </div>
        )}
      </div>

      {/* Add / Edit Memory Form Panel */}
      {isAddingNew && (
        <Card className="border-zinc-800 bg-zinc-900/90 rounded-2xl shadow-md">
          <CardHeader className="p-3 pb-2 border-b border-zinc-800">
            <CardTitle className="text-xs font-semibold text-zinc-100">
              {isEditing
                ? `Edit ${memoryScope === 'global' ? 'Global' : 'Tab'} Memory`
                : `New ${memoryScope === 'global' ? 'Global' : 'Tab'} Memory`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 space-y-2.5">
            <div>
              <label className="text-[10px] font-medium text-zinc-400 block mb-1">Title</label>
              <Input
                placeholder="e.g. Personal Profile, Job History, Address"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-8 rounded-xl bg-zinc-950/80 border-zinc-800 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600"
              />
            </div>

            <div>
              <label className="text-[10px] font-medium text-zinc-400 block mb-1">Content</label>
              <Textarea
                rows={6}
                placeholder="Paste personal details, bio, or form answers here..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="font-sans text-[11px] leading-relaxed rounded-xl bg-zinc-950/80 border-zinc-800 text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[11px] rounded-full text-zinc-400 hover:text-zinc-200 cursor-pointer"
                onClick={resetForm}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 text-[11px] rounded-full bg-[#007AFF] text-white hover:bg-[#0071EB] font-medium px-4 shadow-xs transition-colors cursor-pointer"
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
          <div className="text-center py-8 border border-dashed border-zinc-800/80 rounded-2xl p-6">
            <FileText className="w-7 h-7 text-zinc-600 mx-auto mb-2" />
            <p className="text-xs text-zinc-400 mb-1 font-medium">
              No {memoryScope === 'global' ? 'global' : 'tab'} memories yet
            </p>
            <p className="text-[11px] text-zinc-500 max-w-[240px] mx-auto">
              {memoryScope === 'global'
                ? 'Add your About Me, profile, and resume data to use across all forms.'
                : 'Add memories or notes specifically for this webpage.'}
            </p>
          </div>
        ) : (
          activeMemories.map((doc) => (
            <div
              key={doc.id}
              className={`p-3 rounded-2xl transition-all cursor-pointer ${
                doc.isActiveForContext
                  ? 'border border-zinc-800 bg-zinc-900/90 hover:border-zinc-700'
                  : 'border border-transparent bg-zinc-900/50 hover:bg-zinc-900/80'
              }`}
              onClick={() => openEdit(doc)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                  {/* Clean White Tick in place of the file icon */}
                  <button
                    type="button"
                    title={doc.isActiveForContext ? 'Turn off memory' : 'Turn on memory'}
                    className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5 transition-all cursor-pointer ${
                      doc.isActiveForContext
                        ? 'bg-zinc-800 text-white'
                        : 'bg-zinc-800/40 text-transparent hover:text-zinc-500'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleTick(doc.id);
                    }}
                  >
                    <Check
                      className={`w-3.5 h-3.5 stroke-[2.5] ${
                        doc.isActiveForContext ? 'text-white' : 'opacity-0'
                      }`}
                    />
                  </button>

                  <div className="min-w-0 flex-1">
                    <span className="font-semibold text-zinc-100 text-xs truncate block">
                      {doc.title}
                    </span>
                    <p className="text-[11px] text-zinc-400 mt-1 line-clamp-2 leading-relaxed">
                      {doc.content || doc.summary}
                    </p>
                  </div>
                </div>

                {/* Trash Button */}
                <div
                  className="flex items-center shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 rounded-full text-zinc-500 hover:text-red-400 hover:bg-zinc-800 cursor-pointer"
                    onClick={() => handleDelete(doc.id)}
                    title="Delete memory"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
