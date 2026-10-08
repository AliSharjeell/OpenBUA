import type { UserDocument } from '../types';

export interface AttachmentReference { doc: UserDocument; alias: string; token: string }

export function attachmentReferences(documents: UserDocument[]): AttachmentReference[] {
  const counts: Record<string, number> = {};
  return documents.filter(doc => doc.dataUrl || doc.blobKey || doc.filePath)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map(doc => {
      const kind = doc.type === 'image' ? 'img' : doc.type === 'video' ? 'vid' : 'file';
      const alias = `${kind}${counts[kind] = (counts[kind] || 0) + 1}`;
      return { doc, alias, token: `@${JSON.stringify(doc.fileName || doc.title)}` };
    });
}

export function referencedAttachments(text: string, documents: UserDocument[]): AttachmentReference[] {
  const tokens = [...text.matchAll(/@(?:"((?:\\.|[^"\\])+)"|([^\s@,;!?]+))/g)].map(match => {
    if (match[1]) { try { return JSON.parse(`"${match[1]}"`).toLowerCase(); } catch { return ''; } }
    return match[2].replace(/[.)]+$/, '').toLowerCase();
  });
  const lower = text.toLowerCase();
  return attachmentReferences(documents).filter(({doc, alias}) => tokens.some(token =>
    token === alias || token === doc.id.toLowerCase() || token === (doc.fileName || doc.title).toLowerCase())
    || Boolean(doc.fileName && lower.includes(doc.fileName.toLowerCase())));
}
