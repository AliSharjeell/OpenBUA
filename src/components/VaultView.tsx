import React, { useState } from 'react';
import { UserDocument } from '../types';
import { saveDocument, deleteDocument, toggleDocumentActive } from '../services/storage';
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
  CheckCircle2,
  FileCode,
  FileSpreadsheet,
  Edit2,
  Eye,
  AlertCircle,
  Sparkles,
} from 'lucide-react';

interface VaultViewProps {
  documents: UserDocument[];
  onDocumentsChange: (docs: UserDocument[]) => void;
}

export function VaultView({ documents, onDocumentsChange }: VaultViewProps) {
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<UserDocument | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // New Doc Form
  const [title, setTitle] = useState('');
  const [type, setType] = useState<'markdown' | 'text' | 'pdf' | 'json'>('markdown');
  const [content, setContent] = useState('');
  const [tagsStr, setTagsStr] = useState('');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const { content: extractedContent, type: fileType } = await readFileContent(file);
      const newDoc: UserDocument = {
        id: `doc-${Date.now()}`,
        title: file.name.replace(/\.[^/.]+$/, ''),
        type: fileType,
        content: extractedContent,
        summary: `Imported from ${file.name} (${Math.round(file.size / 1024)} KB)`,
        createdAt: Date.now(),
        sizeBytes: file.size,
        tags: [fileType, 'imported'],
        isActiveForContext: true,
      };

      await saveDocument(newDoc);
      const updated = [newDoc, ...documents];
      onDocumentsChange(updated);
    } catch (err: any) {
      setUploadError(err?.message || 'Failed to parse file');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleCreateDocument = async () => {
    if (!title.trim() || !content.trim()) return;

    const tags = tagsStr
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const newDoc: UserDocument = {
      id: selectedDoc?.id || `doc-${Date.now()}`,
      title: title.trim(),
      type,
      content: content.trim(),
      summary: `${title.trim()} (${content.trim().slice(0, 80)}...)`,
      createdAt: selectedDoc?.createdAt || Date.now(),
      sizeBytes: new Blob([content]).size,
      tags: tags.length > 0 ? tags : ['manual'],
      isActiveForContext: selectedDoc ? selectedDoc.isActiveForContext : true,
    };

    await saveDocument(newDoc);

    let updatedDocs: UserDocument[];
    if (selectedDoc) {
      updatedDocs = documents.map((d) => (d.id === newDoc.id ? newDoc : d));
    } else {
      updatedDocs = [newDoc, ...documents];
    }

    onDocumentsChange(updatedDocs);
    resetForm();
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteDocument(id);
    const updated = documents.filter((d) => d.id !== id);
    onDocumentsChange(updated);
    if (selectedDoc?.id === id) {
      resetForm();
    }
  };

  const handleToggleActive = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = await toggleDocumentActive(id);
    onDocumentsChange(updated);
  };

  const openEdit = (doc: UserDocument) => {
    setSelectedDoc(doc);
    setTitle(doc.title);
    setType(doc.type);
    setContent(doc.content);
    setTagsStr(doc.tags?.join(', ') || '');
    setIsEditing(true);
    setIsAddingNew(true);
  };

  const resetForm = () => {
    setIsAddingNew(false);
    setIsEditing(false);
    setSelectedDoc(null);
    setTitle('');
    setType('markdown');
    setContent('');
    setTagsStr('');
    setUploadError(null);
  };

  const activeCount = documents.filter((d) => d.isActiveForContext).length;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
      {/* Top Banner */}
      <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-zinc-300" />
            Knowledge Vault
          </h2>
          <p className="text-[11px] text-zinc-400">
            {activeCount} of {documents.length} documents active for form-filling context
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="cursor-pointer">
            <input
              type="file"
              accept=".pdf,.md,.markdown,.txt,.json"
              className="hidden"
              onChange={handleFileUpload}
              disabled={isUploading}
            />
            <Button variant="outline" size="sm" className="gap-1.5" disabled={isUploading}>
              <Upload className="w-3.5 h-3.5" />
              {isUploading ? 'Parsing...' : 'Upload PDF/MD'}
            </Button>
          </label>
          <Button
            size="sm"
            onClick={() => {
              resetForm();
              setIsAddingNew(true);
            }}
            className="gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Doc
          </Button>
        </div>
      </div>

      {uploadError && (
        <div className="p-3 bg-red-950/40 border border-red-900/60 rounded-md text-red-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{uploadError}</span>
        </div>
      )}

      {/* Add / Edit Form Modal/Panel */}
      {isAddingNew && (
        <Card className="border-zinc-700 bg-zinc-900 shadow-md">
          <CardHeader className="p-3 pb-2 border-b border-zinc-800">
            <CardTitle className="text-xs font-medium text-zinc-200">
              {isEditing ? 'Edit Document' : 'Create New Knowledge Document'}
            </CardTitle>
            <CardDescription className="text-[10px]">
              This text is passed to AutoForm AI to fill matching form fields accurately.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-3 space-y-3">
            <div>
              <label className="text-[11px] text-zinc-400 block mb-1">Document Title</label>
              <Input
                placeholder="e.g. Work History & Resume"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-zinc-400 block mb-1">Type</label>
                <select
                  className="w-full h-8 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-100"
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
                <label className="text-[11px] text-zinc-400 block mb-1">Tags (comma-separated)</label>
                <Input
                  placeholder="profile, resume, work"
                  value={tagsStr}
                  onChange={(e) => setTagsStr(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] text-zinc-400 block mb-1">Content / Data</label>
              <Textarea
                rows={8}
                className="font-mono text-[11px]"
                placeholder="# Resume / Personal Information&#10;- Full Name: Alex Mercer&#10;- Email: alex@example.com&#10;- Phone: (555) 123-4567..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={resetForm}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleCreateDocument} disabled={!title.trim() || !content.trim()}>
                {isEditing ? 'Save Changes' : 'Add to Vault'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Document List */}
      <div className="space-y-2">
        {documents.length === 0 ? (
          <div className="text-center py-10 border border-dashed border-zinc-800 rounded-lg p-6">
            <FileText className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
            <p className="text-xs text-zinc-400 mb-1">No documents in your vault</p>
            <p className="text-[11px] text-zinc-500 mb-4">
              Upload your resume or profile data (PDF/MD) so the AI can fill forms for you.
            </p>
            <Button
              size="sm"
              onClick={() => {
                resetForm();
                setIsAddingNew(true);
              }}
            >
              Add Your Profile
            </Button>
          </div>
        ) : (
          documents.map((doc) => {
            const isSelected = selectedDoc?.id === doc.id;
            return (
              <div
                key={doc.id}
                className={`p-3 rounded-lg border transition-all cursor-pointer ${
                  doc.isActiveForContext
                    ? 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700'
                    : 'border-zinc-800/40 bg-zinc-950/40 opacity-70 hover:opacity-100'
                }`}
                onClick={() => openEdit(doc)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5">
                    <div className="p-1.5 rounded bg-zinc-800 text-zinc-300 mt-0.5 shrink-0">
                      {doc.type === 'pdf' ? (
                        <FileSpreadsheet className="w-4 h-4 text-rose-400" />
                      ) : doc.type === 'json' ? (
                        <FileCode className="w-4 h-4 text-amber-400" />
                      ) : (
                        <FileText className="w-4 h-4 text-zinc-200" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-zinc-200 text-xs">{doc.title}</span>
                        <Badge variant="zinc" className="uppercase text-[9px]">
                          {doc.type}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-zinc-400 mt-1 line-clamp-2">
                        {doc.summary || doc.content.slice(0, 120)}
                      </p>
                      <div className="flex items-center gap-3 mt-2 text-[10px] text-zinc-500">
                        <span>{Math.round(doc.sizeBytes / 1024 * 10) / 10} KB</span>
                        <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                        {doc.tags?.map((t) => (
                          <span key={t} className="text-zinc-400">
                            #{t}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant={doc.isActiveForContext ? 'default' : 'outline'}
                      size="sm"
                      className="h-6 px-2 text-[10px] gap-1"
                      onClick={(e) => handleToggleActive(doc.id, e)}
                    >
                      {doc.isActiveForContext ? (
                        <>
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Active
                        </>
                      ) : (
                        'Inactive'
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-zinc-400 hover:text-zinc-100"
                      onClick={() => openEdit(doc)}
                      title="Edit Document"
                    >
                      <Edit2 className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-zinc-400 hover:text-red-400"
                      onClick={(e) => handleDelete(doc.id, e)}
                      title="Delete Document"
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
