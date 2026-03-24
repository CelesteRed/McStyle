import { useState } from 'react';
import { parseMCText } from './mcParser';
import './BookFormatter.css';

const MAX_PAGES = 50;
const MAX_CHARS_PER_PAGE = 256;

// ===== RENDER HELPERS =====

function bookColor(color) {
  // Default parser color is #FFFFFF (for dark backgrounds) — remap to dark for the book's cream page
  if (!color || color.toUpperCase() === '#FFFFFF') return '#1a0a00';
  return color;
}

// Raw mode: show the &codes visually but still colored
function renderBookLineRaw(text) {
  const spans = parseMCText(text);
  if (!spans.length) return <span>&nbsp;</span>;

  // Rebuild the original text with codes visible, but apply colors
  // We re-parse manually to keep the codes in the output
  const result = [];
  let i = 0;
  let currentColor = null;
  let bold = false, italic = false, underline = false, strikethrough = false, obfuscated = false;

  while (i < text.length) {
    // Check for gradient syntax
    const gradientMatch = text.slice(i).match(/^<(#[0-9A-Fa-f]{6})>(.*?)<\/(#[0-9A-Fa-f]{6})>/);
    if (gradientMatch) {
      // Show the whole gradient block in the start color
      const startColor = gradientMatch[1];
      result.push(
        <span key={result.length} style={{ color: bookColor(startColor) }}>
          {gradientMatch[0]}
        </span>
      );
      i += gradientMatch[0].length;
      continue;
    }

    // Check for hex tag
    const hexMatch = text.slice(i).match(/^<(#[0-9A-Fa-f]{6})>/);
    if (hexMatch && !text.slice(i).match(/^<#[0-9A-Fa-f]{6}>.*?<\/#[0-9A-Fa-f]{6}>/)) {
      currentColor = hexMatch[1];
      result.push(
        <span key={result.length} style={{ color: bookColor(currentColor) }}>
          {hexMatch[0]}
        </span>
      );
      i += hexMatch[0].length;
      continue;
    }

    // Check for & or § codes
    if ((text[i] === '&' || text[i] === '§') && i + 1 < text.length) {
      const code = text[i + 1].toLowerCase();
      const MC_COLORS_MAP = { '0':'#000000','1':'#0000AA','2':'#00AA00','3':'#00AAAA','4':'#AA0000','5':'#AA00AA','6':'#FFAA00','7':'#AAAAAA','8':'#555555','9':'#5555FF','a':'#55FF55','b':'#55FFFF','c':'#FF5555','d':'#FF55FF','e':'#FFFF55','f':'#FFFFFF' };
      if (MC_COLORS_MAP[code]) {
        currentColor = MC_COLORS_MAP[code];
        bold = false; italic = false; underline = false; strikethrough = false; obfuscated = false;
        result.push(
          <span key={result.length} style={{ color: bookColor(currentColor) }}>
            {text[i] + text[i + 1]}
          </span>
        );
        i += 2;
        continue;
      }
      if ('lonmkr'.includes(code)) {
        if (code === 'l') bold = true;
        if (code === 'o') italic = true;
        if (code === 'n') underline = true;
        if (code === 'm') strikethrough = true;
        if (code === 'k') obfuscated = true;
        if (code === 'r') { bold = false; italic = false; underline = false; strikethrough = false; obfuscated = false; currentColor = null; }
        result.push(
          <span key={result.length} style={{ color: bookColor(currentColor), fontWeight: bold ? 'bold' : undefined, fontStyle: italic ? 'italic' : undefined }}>
            {text[i] + text[i + 1]}
          </span>
        );
        i += 2;
        continue;
      }
    }

    // Regular character
    const style = {
      color: bookColor(currentColor),
      fontWeight: bold ? 'bold' : undefined,
      fontStyle: italic ? 'italic' : undefined,
      textDecoration: [underline ? 'underline' : null, strikethrough ? 'line-through' : null].filter(Boolean).join(' ') || undefined,
    };
    result.push(<span key={result.length} style={style}>{text[i]}</span>);
    i++;
  }
  return result;
}

function renderBookLine(text) {
  const spans = parseMCText(text);
  if (!spans.length) return <span>&nbsp;</span>;
  return spans.map((span, i) => {
    if (span.obfuscated) {
      return (
        <span key={i} className="mc-obf" style={{ color: bookColor(span.color) }}>
          {span.text}
        </span>
      );
    }
    const style = {
      color: bookColor(span.color),
      fontWeight: span.bold ? 'bold' : undefined,
      fontStyle: span.italic ? 'italic' : undefined,
      textDecoration: [
        span.underline ? 'underline' : null,
        span.strikethrough ? 'line-through' : null,
      ].filter(Boolean).join(' ') || undefined,
    };
    return <span key={i} style={style}>{span.text}</span>;
  });
}

// Map MC hex colors to JSON text component color names
const HEX_TO_MC_NAME = {
  '#000000': 'black', '#0000AA': 'dark_blue', '#00AA00': 'dark_green',
  '#00AAAA': 'dark_aqua', '#AA0000': 'dark_red', '#AA00AA': 'dark_purple',
  '#FFAA00': 'gold', '#AAAAAA': 'gray', '#555555': 'dark_gray',
  '#5555FF': 'blue', '#55FF55': 'green', '#55FFFF': 'aqua',
  '#FF5555': 'red', '#FF55FF': 'light_purple', '#FFFF55': 'yellow',
  '#FFFFFF': 'white',
};

// Get all spans for a full page (handling newlines)
function pageToSpans(pageText) {
  const lines = pageText.split('\n');
  const allSpans = [];
  lines.forEach((line, li) => {
    if (li > 0) allSpans.push({ text: '\n' });
    const parsed = parseMCText(line);
    parsed.forEach(span => allSpans.push(span));
  });
  return allSpans;
}

function spanToObj(span) {
  const obj = { text: span.text };
  if (span.color) {
    if (span.color.toUpperCase() === '#FFFFFF') {
      obj.color = 'black';
    } else {
      const name = HEX_TO_MC_NAME[span.color.toUpperCase()];
      obj.color = name || span.color.toLowerCase();
    }
  }
  if (span.bold) obj.bold = true;
  if (span.italic) obj.italic = true;
  if (span.underline) obj.underlined = true;
  if (span.strikethrough) obj.strikethrough = true;
  if (span.obfuscated) obj.obfuscated = true;
  return obj;
}

// Convert a component object to SNBT string
function objToSnbt(obj) {
  const parts = [];
  const escaped = obj.text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  parts.push(`text:"${escaped}"`);
  if (obj.color) parts.push(`color:"${obj.color}"`);
  if (obj.bold === true) parts.push('bold:true');
  if (obj.italic === true) parts.push('italic:true');
  if (obj.underlined === true) parts.push('underlined:true');
  if (obj.strikethrough === true) parts.push('strikethrough:true');
  if (obj.obfuscated === true) parts.push('obfuscated:true');
  return `{${parts.join(',')}}`;
}

// Build a page as a JSON array string for old format: '["",{...},{...}]'
function pageToOldFormat(pageText) {
  const spans = pageToSpans(pageText);
  if (spans.length === 0) return '\'""\'';
  const parts = spans.map(s => JSON.stringify(spanToObj(s)));
  return `'["",${parts.join(',')}]'`;
}

// Build a page as SNBT array for new format: ["",{...},{...}]
function pageToNewFormat(pageText) {
  const spans = pageToSpans(pageText);
  if (spans.length === 0) return '""';
  const parts = spans.map(s => objToSnbt(spanToObj(s)));
  return `["",${parts.join(',')}]`;
}

// ===== MAIN COMPONENT =====

export default function BookFormatterUtil({ savedState, onStateChange }) {
  const [pages, setPages] = useState(() => savedState?.pages ?? ['']);
  const [currentPage, setCurrentPage] = useState(0);
  const [title, setTitle] = useState(() => savedState?.title ?? '');
  const [author, setAuthor] = useState(() => savedState?.author ?? '');
  const [copied, setCopied] = useState(null);
  const [exportFmt, setExportFmt] = useState('cmd'); // 'cmd' | 'json'
  const [showRaw, setShowRaw] = useState(true);
  const [mcVersion, setMcVersion] = useState(() => savedState?.mcVersion ?? 'new'); // 'legacy' (pre-1.16) | 'old' (1.16-1.20.4) | 'new' (1.20.5+)

  const persist = (patch) => {
    onStateChange({ ...savedState, ...patch, expanded: true });
  };

  // ===== PAGE MANAGEMENT =====

  const updatePage = (idx, text) => {
    const next = [...pages];
    next[idx] = text;
    setPages(next);
    persist({ pages: next });
  };

  const addPage = () => {
    if (pages.length >= MAX_PAGES) return;
    const next = [...pages, ''];
    setPages(next);
    setCurrentPage(next.length - 1);
    persist({ pages: next });
  };

  const removePage = (idx) => {
    if (pages.length <= 1) return;
    const next = pages.filter((_, i) => i !== idx);
    setPages(next);
    setCurrentPage(Math.min(currentPage, next.length - 1));
    persist({ pages: next });
  };

  const movePage = (from, to) => {
    if (to < 0 || to >= pages.length) return;
    const next = [...pages];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setPages(next);
    setCurrentPage(to);
    persist({ pages: next });
  };

  // ===== EXPORT =====

  const buildCommand = () => {
    const t = (title || 'Untitled').replace(/"/g, '\\"');
    const a = (author || 'Author').replace(/"/g, '\\"');

    if (mcVersion === 'old') {
      const pagesStr = pages.map(p => pageToOldFormat(p)).join(',');
      return `/give @p written_book{pages:[${pagesStr}],title:"${t}",author:"${a}"}`;
    }
    // 1.20.5+: Data component syntax, pages are bare SNBT
    const pagesStr = pages.map(p => pageToNewFormat(p)).join(',');
    return `/give @p written_book[written_book_content={pages:[${pagesStr}],title:"${t}",author:"${a}"}]`;
  };

  const buildJson = () => {
    const obj = {
      title: title || 'Untitled',
      author: author || 'Author',
      pages: pages.map(p => {
        const spans = pageToSpans(p);
        return ['', ...spans.map(s => spanToObj(s))];
      }),
    };
    return JSON.stringify(obj, null, 2);
  };

  const getExportText = () => exportFmt === 'json' ? buildJson() : buildCommand();

  const copyExport = () => {
    navigator.clipboard.writeText(getExportText()).then(() => {
      setCopied('export');
      setTimeout(() => setCopied(null), 1500);
    }).catch(() => {});
  };

  // ===== CURRENT PAGE STATE =====

  const currentText = pages[currentPage] ?? '';
  const charCount = currentText.length;
  const isOverLimit = charCount > MAX_CHARS_PER_PAGE;
  const lineCount = currentText.split('\n').length;

  return (
    <div className="util-content book-formatter">

      {/* ── Meta ── */}
      <div className="book-meta-row">
        <input
          className="util-input"
          placeholder="Book title..."
          value={title}
          maxLength={32}
          onChange={(e) => { setTitle(e.target.value); persist({ title: e.target.value }); }}
        />
        <input
          className="util-input book-author-input"
          placeholder="Author..."
          value={author}
          maxLength={16}
          onChange={(e) => { setAuthor(e.target.value); persist({ author: e.target.value }); }}
        />
      </div>

      {/* ── Page Tabs ── */}
      <div className="book-tabs">
        <div className="book-tabs-scroll">
          {pages.map((_, i) => (
            <button
              key={i}
              className={`book-tab${i === currentPage ? ' active' : ''}`}
              onClick={() => setCurrentPage(i)}
            >
              {i + 1}
              {pages.length > 1 && i === currentPage && (
                <span
                  className="book-tab-x"
                  onClick={(e) => { e.stopPropagation(); removePage(i); }}
                  title="Remove page"
                >×</span>
              )}
            </button>
          ))}
          {pages.length < MAX_PAGES && (
            <button className="book-tab book-tab-add" onClick={addPage} title="Add page">+</button>
          )}
        </div>
        {pages.length > 1 && (
          <div className="book-page-arrows">
            <button
              className="book-arrow-btn"
              onClick={() => movePage(currentPage, currentPage - 1)}
              disabled={currentPage === 0}
              title="Move page left"
            >◀</button>
            <button
              className="book-arrow-btn"
              onClick={() => movePage(currentPage, currentPage + 1)}
              disabled={currentPage === pages.length - 1}
              title="Move page right"
            >▶</button>
          </div>
        )}
      </div>

      {/* ── Editor ── */}
      <div className="book-editor-wrap">
        <textarea
          className={`book-textarea${isOverLimit ? ' over-limit' : ''}`}
          value={currentText}
          onChange={(e) => updatePage(currentPage, e.target.value)}
          placeholder={"Write page content...\n\nUse &a, &c, &l, &o etc.\nPress Enter for new lines."}
          spellCheck={false}
        />
        <div className="book-editor-footer">
          <span className="book-hint">Supports &amp;a–&amp;f colors, &amp;l bold, &amp;o italic, &amp;k obfuscated, &amp;r reset</span>
          <span className={`book-charcount${isOverLimit ? ' over' : ''}`}>
            {charCount}/{MAX_CHARS_PER_PAGE}
          </span>
        </div>
      </div>

      {/* ── Preview ── */}
      <div className="book-preview-header">
        <span className="util-result-label">Preview — Page {currentPage + 1} of {pages.length}</span>
        <button
          className={`book-fmt-btn book-raw-toggle`}
          onClick={() => setShowRaw(!showRaw)}
          title="Toggle between raw codes and formatted preview"
        >{showRaw ? 'Raw' : 'Formatted'}</button>
      </div>
      <div className="book-preview-outer">
        <div className="book-frame">
          <div className="book-page">
            {/* Title shown on first page */}
            {currentPage === 0 && title && (
              <div className="book-preview-title">{title}</div>
            )}
            {/* Text */}
            <div className="book-preview-body">
              {currentText
                ? <div className="book-preview-text">
                    {currentText.split('\n').map((line, li, arr) => (
                      <span key={li}>
                        {showRaw ? renderBookLineRaw(line) : renderBookLine(line)}
                        {li < arr.length - 1 && <br />}
                      </span>
                    ))}
                  </div>
                : <span className="book-preview-empty">Empty page...</span>
              }
            </div>
            {/* Page number */}
            <div className="book-preview-pgnum">
              - {currentPage + 1} -
            </div>
          </div>
        </div>
      </div>

      {/* ── Version + Export ── */}
      <div className="book-version-row">
        <span className="book-version-label">MC Version:</span>
        <button
          className={`book-fmt-btn${mcVersion === 'old' ? ' active' : ''}`}
          onClick={() => { setMcVersion('old'); persist({ mcVersion: 'old' }); }}
        >1.16–1.20.4</button>
        <button
          className={`book-fmt-btn${mcVersion === 'new' ? ' active' : ''}`}
          onClick={() => { setMcVersion('new'); persist({ mcVersion: 'new' }); }}
        >1.20.5+</button>
      </div>
      <div className="book-export-row">
        <div className="book-export-toggles">
          <button
            className={`book-fmt-btn${exportFmt === 'cmd' ? ' active' : ''}`}
            onClick={() => setExportFmt('cmd')}
          >/give Command</button>
          <button
            className={`book-fmt-btn${exportFmt === 'json' ? ' active' : ''}`}
            onClick={() => setExportFmt('json')}
          >JSON</button>
        </div>
        <button className="util-copy-btn book-copy-btn" onClick={copyExport}>
          {copied === 'export' ? '✓ Copied!' : 'Copy'}
        </button>
      </div>
      <div className="book-export-preview">
        <code className="book-export-code">{getExportText()}</code>
      </div>

    </div>
  );
}
