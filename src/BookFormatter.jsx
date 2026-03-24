import { useState } from 'react';
import { parseMCText } from './mcParser';
import './BookFormatter.css';

const MAX_PAGES = 50;
const MAX_CHARS_PER_PAGE = 256;

// ===== RENDER HELPERS =====

function renderBookLine(text) {
  const spans = parseMCText(text);
  if (!spans.length) return <span>&nbsp;</span>;
  return spans.map((span, i) => {
    if (span.obfuscated) {
      return (
        <span key={i} className="mc-obf" style={{ color: span.color || '#1a0a00' }}>
          {span.text}
        </span>
      );
    }
    const style = {
      color: span.color || '#1a0a00',
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

function ampToSection(text) {
  return text.replace(/&([0-9a-fklmnorA-FKLMNOR])/g, '§$1');
}

function escapeForCmd(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

// ===== MAIN COMPONENT =====

export default function BookFormatterUtil({ savedState, onStateChange }) {
  const [pages, setPages] = useState(() => savedState?.pages ?? ['']);
  const [currentPage, setCurrentPage] = useState(0);
  const [title, setTitle] = useState(() => savedState?.title ?? '');
  const [author, setAuthor] = useState(() => savedState?.author ?? '');
  const [copied, setCopied] = useState(null);
  const [exportFmt, setExportFmt] = useState('cmd'); // 'cmd' | 'json'

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
    const pagesStr = pages.map(p => {
      const raw = escapeForCmd(ampToSection(p));
      return `'{"text":"${raw}"}'`;
    }).join(',');
    return `/give @p written_book[written_book_content={title:"${t}",author:"${a}",pages:[${pagesStr}]}]`;
  };

  const buildJson = () => {
    const obj = {
      title: title || 'Untitled',
      author: author || 'Author',
      pages: pages.map(p => ({ text: ampToSection(p) })),
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
      <span className="util-result-label" style={{ display: 'block', marginTop: 4 }}>Preview — Page {currentPage + 1} of {pages.length}</span>
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
                ? currentText.split('\n').map((line, li) => (
                    <div key={li} className="book-preview-line">
                      {renderBookLine(line)}
                    </div>
                  ))
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

      {/* ── Export ── */}
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
