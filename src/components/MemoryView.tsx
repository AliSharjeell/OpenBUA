import React, { useState, useRef } from 'react';
import { UserDocument } from '../types';
import {
  saveGlobalMemory,
  deleteGlobalMemory,
  toggleGlobalMemoryActive,
  saveTabMemory,
  deleteTabMemory,
  toggleTabMemoryActive,
} from '../services/storage';
import {
  processUploadedFile,
  extractTextForDocument,
  formatFileSize,
  tryLoadFileFromLocalPath,
  detectFileType,
  detectDocumentCategory,
  splitExtractedTextIntoSections,
} from '../services/pdf-parser';
import { Button } from './ui/button';
import { Input, Textarea } from './ui/input';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import {
  FileText,
  Plus,
  Trash2,
  Check,
  Upload,
  Download,
  Sparkles,
  Loader2,
  File,
  Image as ImageIcon,
  Video,
  Film,
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

  // File Upload and OCR states
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadingName, setUploadingName] = useState('');
  const [ocrLoadingId, setOcrLoadingId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // New Memory Form
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [filePath, setFilePath] = useState('');

  const activeMemories = memoryScope === 'global' ? globalMemories : tabMemories;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      await handleProcessFile(files[i]);
    }
  };

  const handleProcessFile = async (file: File) => {
    setIsUploading(true);
    setUploadingName(file.name);
    try {
      const parsed = await processUploadedFile(file, { runOcr: false });
      const newDoc: UserDocument = {
        id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: parsed.title,
        type: parsed.type,
        content: parsed.content,
        summary: `${parsed.fileName} (${formatFileSize(parsed.sizeBytes)})`,
        createdAt: Date.now(),
        sizeBytes: parsed.sizeBytes,
        tags: parsed.tags,
        isActiveForContext: true,
        isGlobal: memoryScope === 'global',
        tabUrlPattern: memoryScope === 'tab' ? currentTabKey : undefined,
        fileName: parsed.fileName,
        mimeType: parsed.mimeType,
        dataUrl: parsed.dataUrl,
        ocrStatus: parsed.ocrStatus,
        fileCategory: parsed.fileCategory,
        thumbnailUrl: parsed.thumbnailUrl,
        videoDuration: parsed.videoDuration,
        filePath: parsed.filePath,
      };

      if (memoryScope === 'global') {
        await saveGlobalMemory(newDoc);
        onGlobalMemoriesChange([newDoc, ...globalMemories]);
      } else {
        await saveTabMemory(currentTabKey, newDoc);
        onTabMemoriesChange([newDoc, ...tabMemories]);
      }
    } catch (err: any) {
      console.error('[AutoForm AI] File upload failed:', err);
      alert(`Failed to process file: ${err?.message || err}`);
    } finally {
      setIsUploading(false);
      setUploadingName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        await handleProcessFile(files[i]);
      }
    }
  };

  const handleDownloadFile = (doc: UserDocument, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!doc.dataUrl) return;
    const link = document.createElement('a');
    link.href = doc.dataUrl;
    link.download = doc.fileName || `${doc.title}.${doc.type === 'pdf' ? 'pdf' : 'txt'}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExtractInfo = async (
    doc: UserDocument,
    mode: 'entire' | 'split' = 'entire',
    e?: React.MouseEvent
  ) => {
    e?.stopPropagation();
    if (!doc.dataUrl) return;
    setOcrLoadingId(doc.id);
    try {
      const extracted = await extractTextForDocument(doc);
      const newCategory = detectDocumentCategory(doc.fileName || doc.title, extracted);

      if (mode === 'split') {
        const sections = splitExtractedTextIntoSections(extracted, doc.title);
        if (sections.length > 1) {
          const newDocs: UserDocument[] = sections.map((sec, idx) => ({
            id: `mem-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
            title: sec.title,
            type: 'markdown',
            content: sec.content,
            summary: `${sec.title} (${sec.content.slice(0, 80)}...)`,
            createdAt: Date.now() + idx,
            sizeBytes: new Blob([sec.content]).size,
            tags: sec.tags,
            isActiveForContext: true,
            isGlobal: memoryScope === 'global',
            tabUrlPattern: memoryScope === 'tab' ? currentTabKey : undefined,
            fileCategory: sec.category,
            ocrStatus: 'done',
          }));

          const updatedParent: UserDocument = {
            ...doc,
            content: extracted,
            fileCategory: newCategory,
            ocrStatus: 'done',
          };

          if (memoryScope === 'global') {
            await saveGlobalMemory(updatedParent);
            for (const nd of newDocs) await saveGlobalMemory(nd);
            onGlobalMemoriesChange([
              ...newDocs,
              ...globalMemories.map((m) => (m.id === doc.id ? updatedParent : m)),
            ]);
          } else {
            await saveTabMemory(currentTabKey, updatedParent);
            for (const nd of newDocs) await saveTabMemory(currentTabKey, nd);
            onTabMemoriesChange([
              ...newDocs,
              ...tabMemories.map((m) => (m.id === doc.id ? updatedParent : m)),
            ]);
          }

          if (selectedDoc?.id === doc.id) {
            setSelectedDoc(updatedParent);
            setContent(extracted);
          }
          return;
        }
      }

      // Default: Update this document as one entire thing
      const updatedDoc: UserDocument = {
        ...doc,
        content: extracted,
        fileCategory: newCategory,
        ocrStatus: 'done',
      };
      if (memoryScope === 'global') {
        await saveGlobalMemory(updatedDoc);
        onGlobalMemoriesChange(globalMemories.map((m) => (m.id === doc.id ? updatedDoc : m)));
      } else {
        await saveTabMemory(currentTabKey, updatedDoc);
        onTabMemoriesChange(tabMemories.map((m) => (m.id === doc.id ? updatedDoc : m)));
      }
      if (selectedDoc?.id === doc.id) {
        setSelectedDoc(updatedDoc);
        setContent(extracted);
      }
    } catch (err: any) {
      console.error('[AutoForm AI] OCR Extraction failed:', err);
      alert(`OCR text extraction failed: ${err?.message || err}`);
    } finally {
      setOcrLoadingId(null);
    }
  };

  const handleSaveMemory = async () => {
    if (!title.trim() && !filePath.trim() && !content.trim()) return;

    let attachedDataUrl = selectedDoc?.dataUrl;
    let attachedMime = selectedDoc?.mimeType;
    let attachedSize = selectedDoc?.sizeBytes || 0;
    let attachedFileName = selectedDoc?.fileName;
    let attachedThumb = selectedDoc?.thumbnailUrl;
    let attachedDuration = selectedDoc?.videoDuration;

    // If local path is provided and no dataUrl is attached, attempt loading
    if (filePath.trim() && !attachedDataUrl) {
      try {
        const loaded = await tryLoadFileFromLocalPath(filePath.trim());
        if (loaded) {
          attachedDataUrl = loaded.dataUrl;
          attachedMime = loaded.mimeType;
          attachedSize = loaded.sizeBytes;
          attachedFileName = loaded.fileName;
        }
      } catch (err) {
        console.warn('[AutoForm AI] Local path load attempt failed:', err);
      }
    }

    const detectedType = detectFileType(attachedFileName || filePath || `${title}.txt`, attachedMime);
    const finalType = selectedDoc?.type || (detectedType !== 'text' ? detectedType : 'markdown');
    const finalCategory = detectDocumentCategory(attachedFileName || filePath || title, content);

    const effectiveTitle = title.trim() || attachedFileName || (finalType === 'video' ? 'Marketing Video' : 'Saved Memory');
    const effectiveContent =
      content.trim() ||
      (finalType === 'video'
        ? `[Video Media: ${attachedFileName || filePath.trim()}] Marketing video ready for Reddit, YouTube, or social upload.`
        : `[File Attachment: ${attachedFileName || filePath.trim()}]`);

    const newDoc: UserDocument = {
      id: selectedDoc?.id || `mem-${Date.now()}`,
      title: effectiveTitle,
      type: finalType,
      content: effectiveContent,
      summary: selectedDoc?.summary || `${effectiveTitle} (${effectiveContent.slice(0, 80)}...)`,
      createdAt: selectedDoc?.createdAt || Date.now(),
      sizeBytes: attachedSize || new Blob([effectiveContent]).size,
      tags: selectedDoc?.tags || [finalCategory !== 'other' ? finalCategory : 'custom'],
      isActiveForContext: selectedDoc ? selectedDoc.isActiveForContext : true,
      isGlobal: memoryScope === 'global',
      tabUrlPattern: memoryScope === 'tab' ? currentTabKey : undefined,
      fileName: attachedFileName,
      mimeType: attachedMime,
      dataUrl: attachedDataUrl,
      ocrStatus: selectedDoc?.ocrStatus || 'done',
      fileCategory: finalCategory,
      filePath: filePath.trim() || selectedDoc?.filePath || undefined,
      thumbnailUrl: attachedThumb,
      videoDuration: attachedDuration,
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
    setFilePath('');
  };

  const openEdit = (doc: UserDocument) => {
    setSelectedDoc(doc);
    setTitle(doc.title);
    setContent(doc.content);
    setFilePath(doc.filePath || '');
    setIsEditing(true);
    setIsAddingNew(true);
  };

  return (
    <div
      className={`flex-1 overflow-y-auto px-4 pt-16 pb-6 space-y-4 text-xs select-text bg-zinc-950 transition-colors ${
        isDragging ? 'ring-2 ring-blue-500/50 bg-blue-950/10' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden File Input for uploading resumes, images, videos, PDFs, docs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mov,.mkv,.avi,.m4v,.md,.markdown,.json,.txt,.doc,.docx"
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* Header and Scope Selector */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-zinc-100 text-sm tracking-tight">Memory</h2>

          <div className="flex items-center gap-1.5">
            {/* Upload Raw File Button */}
            <Button
              size="sm"
              variant="outline"
              disabled={isUploading}
              className="h-7 px-2.5 text-[11px] gap-1.5 rounded-full border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:text-white font-medium shadow-xs transition-colors cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
              title="Upload resume.pdf, video, image, or document"
            >
              {isUploading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
              ) : (
                <Upload className="w-3.5 h-3.5 text-zinc-400" />
              )}
              {isUploading ? 'Uploading...' : 'Upload File'}
            </Button>

            {/* Add Custom Note Button */}
            <Button
              size="sm"
              className="h-7 px-3 text-[11px] gap-1.5 rounded-full bg-[#007AFF] text-white hover:bg-[#0071EB] font-medium shadow-xs transition-colors cursor-pointer"
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
        </div>

        {/* Sub-Tabs: Global Memory vs Current Tab Memory */}
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

      {/* Uploading Banner State */}
      {isUploading && (
        <div className="p-3 rounded-2xl bg-blue-950/40 border border-blue-800/60 flex items-center gap-2.5 text-blue-200">
          <Loader2 className="w-4 h-4 animate-spin text-blue-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium truncate">Uploading {uploadingName}...</p>
            <p className="text-[10px] text-blue-300/80">Saving raw document into memory</p>
          </div>
        </div>
      )}

      {/* Drag & Drop Visual Indicator */}
      {isDragging && (
        <div className="p-6 rounded-3xl border-2 border-dashed border-blue-500/80 bg-blue-950/20 text-center text-blue-300">
          <Upload className="w-6 h-6 mx-auto mb-1 text-blue-400 animate-bounce" />
          <p className="text-xs font-semibold">Drop resume, PDF, video, or image files here</p>
          <p className="text-[10px] text-blue-400/80 mt-0.5">Files will be saved as raw attachments. Extract info with one click.</p>
        </div>
      )}

      {/* Add / Edit Memory Form Panel */}
      {isAddingNew && (
        <Card className="border-zinc-800 bg-zinc-900/90 rounded-3xl shadow-md">
          <CardHeader className="p-3 pb-2 border-b border-zinc-800">
            <CardTitle className="text-xs font-semibold text-zinc-100 flex items-center justify-between">
              <span>
                {isEditing
                  ? `Edit ${memoryScope === 'global' ? 'Global' : 'Tab'} Memory`
                  : `New ${memoryScope === 'global' ? 'Global' : 'Tab'} Memory`}
              </span>
              {selectedDoc?.fileName && (
                <span className="text-[10px] font-mono text-blue-400 bg-blue-950/60 px-2 py-0.5 rounded-full border border-blue-800/50">
                  {selectedDoc.fileName}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 space-y-2.5">
            {/* Raw file details if present */}
            {selectedDoc?.dataUrl && (
              <div className="p-2.5 rounded-2xl bg-zinc-950/60 border border-zinc-800/80 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {selectedDoc.thumbnailUrl ? (
                    <img
                      src={selectedDoc.thumbnailUrl}
                      alt={selectedDoc.fileName || 'video thumbnail'}
                      className="w-8 h-8 rounded-lg object-cover border border-zinc-800 shrink-0"
                    />
                  ) : selectedDoc.type === 'image' && selectedDoc.dataUrl ? (
                    <img
                      src={selectedDoc.dataUrl}
                      alt={selectedDoc.fileName || 'file'}
                      className="w-8 h-8 rounded-lg object-cover border border-zinc-800 shrink-0"
                    />
                  ) : selectedDoc.type === 'video' ? (
                    <Video className="w-5 h-5 text-purple-400 shrink-0" />
                  ) : (
                    <File className="w-5 h-5 text-blue-400 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-zinc-200 truncate">
                      {selectedDoc.fileName || selectedDoc.title}
                    </p>
                    <p className="text-[10px] text-zinc-400">
                      {selectedDoc.sizeBytes > 0 ? formatFileSize(selectedDoc.sizeBytes) : 'Media file'} • {selectedDoc.mimeType || selectedDoc.type}
                      {selectedDoc.videoDuration ? ` • ${selectedDoc.videoDuration}s` : ''}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {/* OCR trigger button */}
                  {(selectedDoc.type === 'image' || selectedDoc.type === 'pdf') && (
                    <Button
                      size="sm"
                      className="h-6 px-2.5 text-[10px] gap-1 rounded-full bg-[#007AFF] text-white hover:bg-[#0071EB] shadow-xs cursor-pointer border-0"
                      disabled={ocrLoadingId === selectedDoc.id}
                      onClick={(e) => handleExtractInfo(selectedDoc, 'entire', e)}
                      title="Extract readable text and details into memory"
                    >
                      {ocrLoadingId === selectedDoc.id ? (
                        <Loader2 className="w-3 h-3 animate-spin text-white" />
                      ) : (
                        <Sparkles className="w-3 h-3 text-white" />
                      )}
                      Extract info into memory
                    </Button>
                  )}

                  {/* Download button */}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px] gap-1 rounded-full text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                    onClick={(e) => handleDownloadFile(selectedDoc, e)}
                    title="Download original raw file"
                  >
                    <Download className="w-3 h-3" />
                    Download
                  </Button>
                </div>
              </div>
            )}

            <div>
              <label className="text-[10px] font-medium text-zinc-400 block mb-1">Title</label>
              <Input
                placeholder="e.g. Resume, Marketing Video, Personal Profile"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-8 rounded-xl bg-zinc-950/80 border-zinc-800 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600"
              />
            </div>

            <div>
              <label className="text-[10px] font-medium text-zinc-400 block mb-1">
                Local File Path / Video Path (Optional)
              </label>
              <Input
                placeholder="e.g. C:\Videos\promo.mp4 or /path/to/demo.mp4"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                className="h-8 rounded-xl bg-zinc-950/80 border-zinc-800 text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600"
              />
              <p className="text-[9px] text-zinc-500 mt-1">
                Specify local path for videos or large assets so OpenBUA can attach them to Reddit, social media, or file forms.
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-medium text-zinc-400 block">
                  Extracted Content / Marketing Copy & Context
                </label>
                {selectedDoc?.dataUrl && (
                  <span className="text-[10px] text-zinc-500">
                    Used by AI agent to fill forms or post copy
                  </span>
                )}
              </div>
              <Textarea
                rows={6}
                placeholder="Personal details, resume text, marketing post copy, hooks, or form answers..."
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
                disabled={!title.trim() && !filePath.trim() && !content.trim()}
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
          <div className="text-center py-8 border border-dashed border-zinc-800/80 rounded-3xl p-6">
            <FileText className="w-7 h-7 text-zinc-600 mx-auto mb-2" />
            <p className="text-xs text-zinc-400 mb-1 font-medium">
              No {memoryScope === 'global' ? 'global' : 'tab'} memories yet
            </p>
            <p className="text-[11px] text-zinc-500 max-w-[240px] mx-auto mb-3">
              {memoryScope === 'global'
                ? 'Upload resume.pdf, images, or enter text to use across all forms.'
                : 'Add memories or files specifically for this webpage.'}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] rounded-full border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-white hover:bg-zinc-800 gap-1.5"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-3 h-3 text-zinc-400" />
              Upload resume or file
            </Button>
          </div>
        ) : (
          activeMemories.map((doc) => {
            const isOcrLoading = ocrLoadingId === doc.id;
            const hasRawFile = Boolean(doc.dataUrl);
            const isResume = doc.fileCategory === 'resume' || doc.tags?.includes('resume');
            const isVideo = doc.type === 'video' || doc.fileCategory === 'video' || doc.tags?.includes('video');

            return (
              <div
                key={doc.id}
                className={`p-3.5 rounded-3xl transition-all cursor-pointer ${
                  doc.isActiveForContext
                    ? 'border border-zinc-800 bg-zinc-900/90 hover:border-zinc-700'
                    : 'border border-transparent bg-zinc-900/50 hover:bg-zinc-900/80'
                }`}
                onClick={() => openEdit(doc)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    {/* Active Toggle Checkmark */}
                    <button
                      type="button"
                      title={doc.isActiveForContext ? 'Turn off memory' : 'Turn on memory'}
                      className={`w-6 h-6 rounded-xl flex items-center justify-center shrink-0 mt-0.5 transition-all cursor-pointer ${
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
                      {/* Title & Badges */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-zinc-100 text-xs truncate">
                          {doc.title}
                        </span>

                        {/* Video Category Badge */}
                        {isVideo && (
                          <span className="text-[9px] font-medium bg-purple-500/10 text-purple-400 px-1.5 py-0.2 rounded-full border border-purple-500/20">
                            Video
                          </span>
                        )}

                        {/* Resume Category Badge */}
                        {isResume && (
                          <span className="text-[9px] font-medium bg-blue-500/10 text-blue-400 px-1.5 py-0.2 rounded-full border border-blue-500/20">
                            Resume
                          </span>
                        )}

                        {/* File Size */}
                        {doc.sizeBytes > 0 && (
                          <span className="text-[9px] text-zinc-500">
                            {formatFileSize(doc.sizeBytes)}
                          </span>
                        )}
                      </div>

                      {/* Content snippet & thumbnail preview */}
                      <div className="flex items-start gap-2 mt-1.5">
                        {doc.thumbnailUrl ? (
                          <div className="relative w-12 h-12 rounded-xl overflow-hidden border border-zinc-800 shrink-0 bg-zinc-950">
                            <img
                              src={doc.thumbnailUrl}
                              alt={doc.fileName || 'video thumbnail'}
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                              <Video className="w-4 h-4 text-white drop-shadow" />
                            </div>
                            {doc.videoDuration ? (
                              <span className="absolute bottom-0.5 right-0.5 bg-black/80 text-[8px] font-mono text-zinc-300 px-1 rounded">
                                {doc.videoDuration}s
                              </span>
                            ) : null}
                          </div>
                        ) : doc.type === 'image' && doc.dataUrl ? (
                          <img
                            src={doc.dataUrl}
                            alt={doc.fileName || 'thumbnail'}
                            className="w-10 h-10 rounded-xl object-cover border border-zinc-800 shrink-0"
                          />
                        ) : isVideo ? (
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center border border-zinc-800 shrink-0 bg-purple-950/30">
                            <Video className="w-5 h-5 text-purple-400" />
                          </div>
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">
                            {doc.content || doc.summary}
                          </p>
                          {doc.filePath && (
                            <p className="text-[10px] text-zinc-500 font-mono truncate mt-0.5" title={doc.filePath}>
                              {doc.filePath}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Raw File Actions Bar (Download & Extract info) */}
                      {(hasRawFile || doc.filePath) && (
                        <div
                          className="flex items-center gap-2 mt-2 pt-2 border-t border-zinc-800/60"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-1.5 ml-auto flex-wrap justify-end">
                            {/* OCR Extraction Button */}
                            {(doc.type === 'image' || doc.type === 'pdf') && (
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  className="flex items-center gap-1.5 text-[11px] font-medium bg-[#007AFF] text-white hover:bg-[#0071EB] active:bg-[#006ee6] px-3 py-1 rounded-full shadow-xs transition-colors cursor-pointer disabled:opacity-50 border-0"
                                  disabled={isOcrLoading}
                                  onClick={(e) => handleExtractInfo(doc, 'entire', e)}
                                  title="Extract readable text and details into memory"
                                >
                                  {isOcrLoading ? (
                                    <Loader2 className="w-3 h-3 animate-spin text-white" />
                                  ) : (
                                    <Sparkles className="w-3 h-3 text-white" />
                                  )}
                                  {isOcrLoading ? 'Extracting info...' : 'Extract info into memory'}
                                </button>

                                {/* Option to split into multiple memory cards for easy retrieval */}
                                {doc.ocrStatus === 'done' && doc.content && (
                                  <button
                                    type="button"
                                    className="flex items-center gap-1 text-[10px] font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-800/80 hover:bg-zinc-800 px-2 py-1 rounded-full border border-zinc-700/60 transition-colors cursor-pointer"
                                    onClick={(e) => handleExtractInfo(doc, 'split', e)}
                                    title="Split extracted sections into separate memory cards for granular retrieval"
                                  >
                                    Split into cards
                                  </button>
                                )}
                              </div>
                            )}

                            {/* Download Button */}
                            {hasRawFile && (
                              <button
                                type="button"
                                className="flex items-center gap-1 text-[10px] font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-800/60 hover:bg-zinc-800 px-2.5 py-1 rounded-full border border-zinc-700/50 transition-colors cursor-pointer"
                                onClick={(e) => handleDownloadFile(doc, e)}
                                title="Download raw file"
                              >
                                <Download className="w-2.5 h-2.5" />
                                Download
                              </button>
                            )}
                          </div>
                        </div>
                      )}
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
            );
          })
        )}
      </div>
    </div>
  );
}
