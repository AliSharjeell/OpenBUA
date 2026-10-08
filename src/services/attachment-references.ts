import type { UserDocument } from '../types';

export interface AttachmentReference { doc: UserDocument; alias: string; token: string }

export function attachmentReferences(documents: UserDocument[]): AttachmentReference[] {
  const counts: Record<string, number> = {};
  return documents.filter(doc => doc.dataUrl || doc.blobKey || doc.filePath)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map(doc => {
      const kind = doc.type === 'image' ? 'img' : doc.type === 'video' ? 'vid' : 'file';
      const alias = `${kind}${counts[kind] = (counts[kind] || 0) + 1}`;
      return { doc, alias, token: `@${alias}` };
    });
}

export function referencedAttachments(text: string, documents: UserDocument[]): AttachmentReference[] {
  const tokens = [...text.matchAll(/@(?:"((?:\\.|[^"\\])+)"|([^\s@,;!?]+))/g)].map(match => {
    if (match[1]) { try { return JSON.parse(`"${match[1]}"`).toLowerCase(); } catch { return ''; } }
    return match[2].replace(/[.)]+$/, '').toLowerCase();
  });
  const lower = text.toLowerCase();
  const references = attachmentReferences(documents);
  const named = references.filter(({doc, alias}) => tokens.some(token =>
    token === alias || token === doc.id.toLowerCase() || token === (doc.fileName || doc.title).toLowerCase())
    || Boolean(doc.fileName && lower.includes(doc.fileName.toLowerCase())));
  if (named.length || tokens.length) return named;
  // Natural references such as "use my attached resume" select the latest
  // matching file in this chat before considering global attachments.
  if (!/\b(attached|uploaded|this|new|my)\b/i.test(text)) return [];
  const kind = /\b(resume|cv)\b/i.test(text) ? 'resume'
    : /\b(image|images|picture|photo)\b/i.test(text) ? 'image'
    : /\b(video|clip)\b/i.test(text) ? 'video'
    : /\b(file|document|pdf)\b/i.test(text) ? 'document' : '';
  const candidates = references.filter(({doc}) => kind === 'resume'
    ? doc.fileCategory === 'resume' || doc.tags?.includes('resume') || /resume|cv/i.test(doc.fileName || doc.title)
    : kind === 'image' || kind === 'video' ? doc.type === kind
    : kind === 'document' ? doc.type !== 'image' && doc.type !== 'video' : false);
  candidates.sort((a, b) => Number(Boolean(a.doc.isGlobal)) - Number(Boolean(b.doc.isGlobal)) || b.doc.createdAt - a.doc.createdAt);
  return candidates.slice(0, 1);
}
