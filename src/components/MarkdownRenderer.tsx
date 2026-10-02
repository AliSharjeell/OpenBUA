import React, { useMemo } from 'react';
import { marked } from 'marked';

// Configure marked for clean GFM rendering
const renderer = new marked.Renderer();
renderer.link = function ({ href, title, text }) {
  const titleAttr = title ? ` title="${title}"` : '';
  return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
};

const origTable = renderer.table.bind(renderer);
renderer.table = function (token) {
  const html = origTable(token);
  return `<div class="table-wrapper">${html}</div>`;
};

const origTableCell = renderer.tablecell.bind(renderer);
renderer.tablecell = function (token) {
  let html = origTableCell(token);
  if (!token.header) {
    const rawText = token.text.trim();
    if (/^(done|verified|sent|pitch sent|completed|success)$/i.test(rawText)) {
      html = html.replace(
        `>${token.text}<`,
        `><span class="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">${token.text}</span><`
      );
    } else if (/^(pitching|pitching now|in progress|active|pending|queued)$/i.test(rawText)) {
      html = html.replace(
        `>${token.text}<`,
        `><span class="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">${token.text}</span><`
      );
    } else if (/^(failed|error|blocked|rejected)$/i.test(rawText)) {
      html = html.replace(
        `>${token.text}<`,
        `><span class="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-rose-500/15 text-rose-400 border border-rose-500/30">${token.text}</span><`
      );
    }
  }
  return html;
};

marked.setOptions({
  gfm: true,
  breaks: true,
  renderer,
});

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

function inferColumnHeader(colIdx: number, allCellValues: string[], totalCols: number): string {
  const values = allCellValues.map((v) => (v || '').trim()).filter(Boolean);

  const isNumber = values.length > 0 && values.every((v) => /^#?\d+[\.\)]?$/.test(v));
  if (isNumber) return '#';

  const isEmail = values.length > 0 && values.some((v) => v.includes('@') && !v.includes(' '));
  if (isEmail) return 'Contact / Email';

  const isUrl = values.length > 0 && values.every((v) => v.startsWith('http') || v.startsWith('www.'));
  if (isUrl) return 'Link / URL';

  const statusKeywords = [
    'done',
    'sent',
    'pending',
    'pitching',
    'verified',
    'failed',
    'todo',
    'active',
    'complete',
    'in progress',
    'success',
    'contacted',
    'replied',
  ];
  const isStatus =
    values.length > 0 &&
    values.every((v) => {
      const lower = v.toLowerCase().trim();
      return (
        lower.length <= 20 &&
        !lower.includes(':') &&
        statusKeywords.some((sk) => lower === sk || lower.startsWith(sk))
      );
    });
  if (isStatus) return 'Status';

  if (colIdx === 0 && totalCols > 3) return '#';
  if (colIdx === 1 || (colIdx === 0 && totalCols <= 3)) return 'Target / Entity';
  if (colIdx === 2) return 'Role / Organization';
  if (colIdx === 3 && totalCols > 4) return 'Contact / Info';
  if (colIdx === totalCols - 1 && values.some((v) => v.length < 18)) return 'Status';
  if (colIdx === totalCols - 2) return 'Notes / Details';

  return `Detail ${colIdx + 1}`;
}

function isHeaderRow(cells: string[], nextRowCells?: string[] | null): boolean {
  const headerTerms = [
    '#', 'id', 'no', 'name', 'target', 'investor', 'role', 'title', 'company', 'firm',
    'fund', 'email', 'contact', 'status', 'stage', 'pitch', 'notes', 'angle',
    'action', 'result', 'category', 'location', 'type', 'date', 'url', 'item',
    'product', 'price', 'amount', 'qty', 'quantity', 'cost', 'description',
    'details', 'summary', 'source', 'link', 'phone', 'score', 'rating', 'tag',
    'tags', 'code', 'user', 'group', 'team', 'domain', 'website',
  ];
  const lowerCells = cells.map((c) => c.toLowerCase().trim());
  if (/^\d+$/.test(lowerCells[0])) return false;
  if (lowerCells.some((c) => c.includes('@'))) return false;

  const matches = lowerCells.filter((c) => headerTerms.some((t) => c === t || c.includes(t)));
  if (matches.length >= 1) return true;

  if (nextRowCells && nextRowCells.length > 0) {
    const nextLower = nextRowCells.map((c) => c.toLowerCase().trim());
    const nextHasNumbers = nextLower.some((c) => /[\d$€£]/.test(c) || c.includes('@'));
    const currHasNumbers = lowerCells.some((c) => /[\d$€£]/.test(c) || c.includes('@'));
    if (nextHasNumbers && !currHasNumbers) return true;
  }

  return false;
}

function repairMarkdownTables(raw: string): string {
  if (!raw) return '';

  const lines = raw.split('\n');

  // Step 1: Normalize TSV lines
  const step1Lines: string[] = [];
  let inTsvBlock = false;
  let tsvColCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (line.includes('\t') && !trimmed.startsWith('|')) {
      const parts = line.split('\t').map((p) => p.trim());
      if (parts.length >= 2) {
        if (!inTsvBlock) {
          inTsvBlock = true;
          tsvColCount = parts.length;
          step1Lines.push(`| ${parts.join(' | ')} |`);
          step1Lines.push(`| ${parts.map(() => '---').join(' | ')} |`);
          continue;
        } else {
          while (parts.length < tsvColCount) parts.push('');
          step1Lines.push(`| ${parts.slice(0, tsvColCount).join(' | ')} |`);
          continue;
        }
      }
    } else {
      if (trimmed.length > 0 && !trimmed.startsWith('|')) {
        inTsvBlock = false;
      }
    }
    step1Lines.push(line);
  }

  // Step 2: Parse all pipe lines
  interface ParsedLine {
    raw: string;
    trimmed: string;
    idx: number;
    isPipe: boolean;
    isSep: boolean;
    cells: string[] | null;
    colCount: number;
  }

  const parsedLines: ParsedLine[] = step1Lines.map((line, idx) => {
    const trimmed = line.trim();
    const isPipe = trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 1;
    const isSep = isPipe && /^\|[\s\-:|]+\|$/.test(trimmed);
    const cells = isPipe && !isSep ? trimmed.split('|').slice(1, -1).map((c) => c.trim()) : null;
    return {
      raw: line,
      trimmed,
      idx,
      isPipe,
      isSep,
      cells,
      colCount: cells ? cells.length : 0,
    };
  });

  // Step 3: Identify complete tables already well-formed with a separator line
  interface ExistingTable {
    colCount: number;
    headerIdx: number;
    sepIdx: number;
    startIdx: number;
    endIdx: number;
  }

  const existingTables: ExistingTable[] = [];
  const handledLineIndices = new Set<number>();

  for (let i = 0; i < parsedLines.length - 1; i++) {
    if (parsedLines[i].isPipe && !parsedLines[i].isSep && parsedLines[i + 1].isSep) {
      const colCount = parsedLines[i].colCount;
      const startIdx = i;
      let endIdx = i + 1;
      while (endIdx + 1 < parsedLines.length && parsedLines[endIdx + 1].isPipe && !parsedLines[endIdx + 1].isSep) {
        endIdx++;
      }
      for (let k = startIdx; k <= endIdx; k++) {
        handledLineIndices.add(k);
      }
      existingTables.push({
        colCount,
        headerIdx: startIdx,
        sepIdx: startIdx + 1,
        startIdx,
        endIdx,
      });
      i = endIdx;
    }
  }

  // Step 4: Group unhandled pipe rows by colCount
  const unhandledByCols = new Map<number, ParsedLine[]>();
  for (let i = 0; i < parsedLines.length; i++) {
    const item = parsedLines[i];
    if (item.isPipe && !item.isSep && !handledLineIndices.has(i)) {
      if (!unhandledByCols.has(item.colCount)) {
        unhandledByCols.set(item.colCount, []);
      }
      unhandledByCols.get(item.colCount)!.push(item);
    }
  }

  const replacements = new Map<number, string>();
  const insertions = new Map<number, string>();

  for (const [colCount, rows] of unhandledByCols.entries()) {
    if (rows.length === 0) continue;

    const matchingExistingTable = existingTables.find((t) => t.colCount === colCount);
    if (matchingExistingTable) {
      const formattedRows = rows.map((r) => r.raw);
      insertions.set(
        matchingExistingTable.endIdx,
        (insertions.get(matchingExistingTable.endIdx) || '') + '\n' + formattedRows.join('\n')
      );
      for (const r of rows) {
        replacements.set(r.idx, '');
      }
    } else {
      const isScattered = rows.some((r, i) => i > 0 && r.idx !== rows[i - 1].idx + 1);
      const allCells = rows.map((r) => r.cells!);
      const firstRowIsH = isHeaderRow(rows[0].cells!, rows[1]?.cells);

      let headerRow = '';
      let sepRow = '';
      let bodyRows: string[] = [];

      if (firstRowIsH) {
        headerRow = rows[0].raw;
        sepRow = `| ${rows[0].cells!.map(() => '---').join(' | ')} |`;
        bodyRows = rows.slice(1).map((r) => r.raw);
      } else {
        const inferredHeaders: string[] = [];
        for (let c = 0; c < colCount; c++) {
          const vals = allCells.map((row) => row[c]);
          inferredHeaders.push(inferColumnHeader(c, vals, colCount));
        }
        headerRow = `| ${inferredHeaders.join(' | ')} |`;
        sepRow = `| ${inferredHeaders.map((h) => (h === '#' || h === 'Status' ? ':---:' : '---')).join(' | ')} |`;
        bodyRows = rows.map((r) => r.raw);
      }

      const consolidatedTable = `\n\n${headerRow}\n${sepRow}\n${bodyRows.join('\n')}\n\n`;

      if (isScattered) {
        let targetIdx = rows[0].idx;
        for (let back = rows[0].idx - 1; back >= Math.max(0, rows[0].idx - 15); back--) {
          const backTrimmed = step1Lines[back].trim();
          if (/^(#+|\*\*|__)?\s*(investor|candidate|lead|prospect|company|item|target)\s*(1|#1|\b)/i.test(backTrimmed)) {
            targetIdx = back;
            break;
          }
        }

        if (targetIdx !== rows[0].idx) {
          replacements.set(targetIdx, consolidatedTable + step1Lines[targetIdx]);
          replacements.set(rows[0].idx, '');
        } else {
          replacements.set(rows[0].idx, consolidatedTable);
        }

        for (let k = 1; k < rows.length; k++) {
          replacements.set(rows[k].idx, '');
        }
      } else {
        replacements.set(rows[0].idx, consolidatedTable);
        for (let k = 1; k < rows.length; k++) {
          replacements.set(rows[k].idx, '');
        }
      }
    }
  }

  const outputLines: string[] = [];
  for (let i = 0; i < step1Lines.length; i++) {
    if (replacements.has(i)) {
      const rep = replacements.get(i);
      if (rep) {
        outputLines.push(rep);
      }
    } else {
      outputLines.push(step1Lines[i]);
    }

    if (insertions.has(i)) {
      outputLines.push(insertions.get(i)!);
    }
  }

  return outputLines.join('\n').replace(/\n{3,}/g, '\n\n');
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  const html = useMemo(() => {
    if (!content) return '';
    try {
      const prepared = repairMarkdownTables(content);
      return marked.parse(prepared) as string;
    } catch (e) {
      console.warn('[MarkdownRenderer] Parse error:', e);
      return content;
    }
  }, [content]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest('a');
    if (!target) return;
    const href = target.getAttribute('href');
    if (!href || href.startsWith('#')) return;

    e.preventDefault();
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: href });
    } else {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div
      className={`markdown-body text-xs text-zinc-200 select-text leading-relaxed ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={handleClick}
    />
  );
}

