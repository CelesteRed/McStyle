import { useState, useRef, useCallback } from 'react';
import './UtilsPanel.css';
import BookFormatterUtil from './BookFormatter';

// ===== TINY TEXT DATA =====
const SMALL_CAPS = {
  'a': '\u1D00', 'b': '\u0299', 'c': '\u1D04', 'd': '\u1D05', 'e': '\u1D07', 'f': '\uA730',
  'g': '\u0262', 'h': '\u029C', 'i': '\u026A', 'j': '\u1D0A', 'k': '\u1D0B', 'l': '\u029F',
  'm': '\u1D0D', 'n': '\u0274', 'o': '\u1D0F', 'p': '\u1D18', 'q': '\u01EB', 'r': '\u0280',
  's': 's', 't': '\u1D1B', 'u': '\u1D1C', 'v': '\u1D20', 'w': '\u1D21', 'x': 'x',
  'y': '\u028F', 'z': '\u1D22',
};
const SUPERSCRIPT = {
  'a': '\u1D43', 'b': '\u1D47', 'c': '\u1D9C', 'd': '\u1D48', 'e': '\u1D49', 'f': '\u1DA0',
  'g': '\u1D4D', 'h': '\u02B0', 'i': '\u2071', 'j': '\u02B2', 'k': '\u1D4F', 'l': '\u02E1',
  'm': '\u1D50', 'n': '\u207F', 'o': '\u1D52', 'p': '\u1D56', 'q': 'q', 'r': '\u02B3',
  's': '\u02E2', 't': '\u1D57', 'u': '\u1D58', 'v': '\u1D5B', 'w': '\u02B7', 'x': '\u02E3',
  'y': '\u02B8', 'z': '\u1DBB',
  '0': '\u2070', '1': '\u00B9', '2': '\u00B2', '3': '\u00B3', '4': '\u2074',
  '5': '\u2075', '6': '\u2076', '7': '\u2077', '8': '\u2078', '9': '\u2079',
};
const SUBSCRIPT = {
  'a': '\u2090', 'e': '\u2091', 'h': '\u2095', 'i': '\u1D62', 'j': '\u2C7C', 'k': '\u2096',
  'l': '\u2097', 'm': '\u2098', 'n': '\u2099', 'o': '\u2092', 'p': '\u209A', 'r': '\u1D63',
  's': '\u209B', 't': '\u209C', 'u': '\u1D64', 'v': '\u1D65', 'x': '\u2093',
  '0': '\u2080', '1': '\u2081', '2': '\u2082', '3': '\u2083', '4': '\u2084',
  '5': '\u2085', '6': '\u2086', '7': '\u2087', '8': '\u2088', '9': '\u2089',
};
const FULLWIDTH = {};
for (let i = 33; i <= 126; i++) {
  FULLWIDTH[String.fromCharCode(i)] = String.fromCharCode(i + 0xFEE0);
}
FULLWIDTH[' '] = '\u3000';

function convert(text, map) {
  return text.toLowerCase().split('').map(ch => map[ch] || ch).join('');
}
function convertFullwidth(text) {
  return text.split('').map(ch => FULLWIDTH[ch] || ch).join('');
}

// ===== MC COLOR KEY DATA =====
const MC_COLOR_CODES = [
  { code: '0', name: 'Black', color: '#000000' },
  { code: '1', name: 'Dark Blue', color: '#0000AA' },
  { code: '2', name: 'Dark Green', color: '#00AA00' },
  { code: '3', name: 'Dark Aqua', color: '#00AAAA' },
  { code: '4', name: 'Dark Red', color: '#AA0000' },
  { code: '5', name: 'Dark Purple', color: '#AA00AA' },
  { code: '6', name: 'Gold', color: '#FFAA00' },
  { code: '7', name: 'Gray', color: '#AAAAAA' },
  { code: '8', name: 'Dark Gray', color: '#555555' },
  { code: '9', name: 'Blue', color: '#5555FF' },
  { code: 'a', name: 'Green', color: '#55FF55' },
  { code: 'b', name: 'Aqua', color: '#55FFFF' },
  { code: 'c', name: 'Red', color: '#FF5555' },
  { code: 'd', name: 'Light Purple', color: '#FF55FF' },
  { code: 'e', name: 'Yellow', color: '#FFFF55' },
  { code: 'f', name: 'White', color: '#FFFFFF' },
];
const MC_FORMAT_CODES = [
  { code: 'l', name: 'Bold' },
  { code: 'o', name: 'Italic' },
  { code: 'n', name: 'Underline' },
  { code: 'm', name: 'Strikethrough' },
  { code: 'k', name: 'Obfuscated' },
  { code: 'r', name: 'Reset' },
];

// ===== COMING SOON ITEMS =====
const COMING_SOON = [
  'Gradient Generator',
  'MOTD Preview',
  'JSON Text Builder',
  'Scoreboard Formatter',
  'Hologram Text',
  'Sign Editor',
];

function loadUtilsState() {
  try {
    return JSON.parse(localStorage.getItem('mcstyle_utils') || '{}');
  } catch { return {}; }
}

function saveUtilsState(state) {
  localStorage.setItem('mcstyle_utils', JSON.stringify(state));
}

function loadLocalOrder() {
  try {
    return JSON.parse(localStorage.getItem('mcstyle_utils_order'));
  } catch { return null; }
}

function saveLocalOrder(order) {
  localStorage.setItem('mcstyle_utils_order', JSON.stringify(order));
}

// ===== COLLAPSIBLE SECTION =====
function UtilSection({ id, title, disabled, savedState, onStateChange, children, draggable, onDragStart, onDragOver, onDragEnd, isDragOver }) {
  const [expanded, setExpanded] = useState(savedState?.expanded ?? false);

  const toggle = () => {
    if (disabled) return;
    const next = !expanded;
    setExpanded(next);
    onStateChange(id, { ...savedState, expanded: next });
  };

  return (
    <div
      className={`util-section ${expanded ? 'expanded' : ''} ${disabled ? 'disabled' : ''} ${isDragOver ? 'drag-over' : ''}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      <button className="util-section-header" onClick={toggle}>
        <span className="util-drag-handle" title="Drag to reorder">{'\u2630'}</span>
        <span className="util-section-title">{title}</span>
        {disabled ? (
          <span className="util-coming-soon">Coming Soon</span>
        ) : (
          <span className="util-chevron">{expanded ? '\u2212' : '+'}</span>
        )}
      </button>
      {expanded && !disabled && (
        <div className="util-section-body">
          {children}
        </div>
      )}
    </div>
  );
}

// ===== TINY TEXT UTILITY =====
function TinyTextUtil({ savedState, onStateChange }) {
  const [input, setInput] = useState(savedState?.input || '');
  const [copiedId, setCopiedId] = useState(null);

  const handleInput = (val) => {
    setInput(val);
    onStateChange({ ...savedState, input: val });
  };

  const copyText = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1200);
    }).catch(() => {});
  };

  const results = [
    { id: 'smallcaps', label: 'Small Caps', text: convert(input, SMALL_CAPS) },
    { id: 'superscript', label: 'Superscript', text: convert(input, SUPERSCRIPT) },
    { id: 'subscript', label: 'Subscript', text: convert(input, SUBSCRIPT) },
  ];

  return (
    <div className="util-content">
      <input
        type="text"
        className="util-input"
        value={input}
        onChange={(e) => handleInput(e.target.value)}
        placeholder="Type text... e.g. owner"
      />
      {input && results.map(r => (
        <div key={r.id} className="util-result">
          <span className="util-result-label">{r.label}</span>
          <div className="util-result-row">
            <span className="util-result-text">{r.text}</span>
            <button className="util-copy-btn" onClick={() => copyText(r.text, r.id)}>
              {copiedId === r.id ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ===== OTHER TEXT GENERATORS =====
function TextGenUtil({ savedState, onStateChange }) {
  const [input, setInput] = useState(savedState?.input || '');
  const [copiedId, setCopiedId] = useState(null);

  const handleInput = (val) => {
    setInput(val);
    onStateChange({ ...savedState, input: val });
  };

  const copyText = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1200);
    }).catch(() => {});
  };

  const reversed = input.split('').reverse().join('');
  const fullwidth = convertFullwidth(input);
  const spaced = input.split('').join(' ');

  const results = [
    { id: 'fullwidth', label: 'Fullwidth', text: fullwidth },
    { id: 'reversed', label: 'Reversed', text: reversed },
    { id: 'spaced', label: 'Spaced Out', text: spaced },
  ];

  return (
    <div className="util-content">
      <input
        type="text"
        className="util-input"
        value={input}
        onChange={(e) => handleInput(e.target.value)}
        placeholder="Type text..."
      />
      {input && results.map(r => (
        <div key={r.id} className="util-result">
          <span className="util-result-label">{r.label}</span>
          <div className="util-result-row">
            <span className="util-result-text">{r.text}</span>
            <button className="util-copy-btn" onClick={() => copyText(r.text, r.id)}>
              {copiedId === r.id ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ===== MC COLOR KEY =====
function ColorKeyUtil() {
  const [copiedCode, setCopiedCode] = useState(null);

  const copy = (text, code) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 1200);
    }).catch(() => {});
  };

  return (
    <div className="util-content">
      <div className="color-key-section">
        <span className="util-result-label">Colors</span>
        <div className="color-key-grid">
          {MC_COLOR_CODES.map(({ code, name, color }) => (
            <button
              key={code}
              className={`color-key-item ${copiedCode === code ? 'copied' : ''}`}
              onClick={() => copy(`&${code}`, code)}
              title={`&${code} - ${name}`}
            >
              <span className="color-key-swatch" style={{ backgroundColor: color }} />
              <span className="color-key-code">&amp;{code}</span>
              <span className="color-key-name">{name}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="color-key-section">
        <span className="util-result-label">Formatting</span>
        <div className="color-key-formats">
          {MC_FORMAT_CODES.map(({ code, name }) => (
            <button
              key={code}
              className={`color-key-fmt ${copiedCode === `f${code}` ? 'copied' : ''}`}
              onClick={() => copy(`&${code}`, `f${code}`)}
            >
              <span className="color-key-code">&amp;{code}</span>
              <span className="color-key-name">{name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ===== SECTION DEFINITIONS =====
const ALL_SECTIONS = [
  { id: 'colorkey', title: 'Minecraft Color Key' },
  { id: 'tinytext', title: 'Tiny Text Generator' },
  { id: 'textgen', title: 'Text Generators' },
  { id: 'bookformatter', title: 'Book Formatter' },
  ...COMING_SOON.map(name => ({ id: name, title: name, disabled: true })),
];

const DEFAULT_ORDER = ALL_SECTIONS.map(s => s.id);

function renderSectionContent(id, utilsState, updateSection) {
  if (id === 'colorkey') return <ColorKeyUtil />;
  if (id === 'tinytext') return (
    <TinyTextUtil
      savedState={utilsState.tinytext}
      onStateChange={(data) => updateSection('tinytext', { ...data, expanded: true })}
    />
  );
  if (id === 'textgen') return (
    <TextGenUtil
      savedState={utilsState.textgen}
      onStateChange={(data) => updateSection('textgen', { ...data, expanded: true })}
    />
  );
  if (id === 'bookformatter') return (
    <BookFormatterUtil
      savedState={utilsState.bookformatter}
      onStateChange={(data) => updateSection('bookformatter', data)}
    />
  );
  return null;
}

// ===== MAIN PANEL =====
export default function UtilsPanel({ open, onToggle, utilsOrder, onUtilsOrderChange }) {
  const [utilsState, setUtilsState] = useState(loadUtilsState);
  const dragItemRef = useRef(null);
  const [dragOverId, setDragOverId] = useState(null);

  const updateSection = (id, data) => {
    setUtilsState(prev => {
      const next = { ...prev, [id]: data };
      saveUtilsState(next);
      return next;
    });
  };

  // Use cloud order > localStorage order > default
  const order = (() => {
    const source = utilsOrder || loadLocalOrder();
    if (!source || !Array.isArray(source)) return DEFAULT_ORDER;
    // Add any missing sections at the end
    const combined = [...source];
    for (const id of DEFAULT_ORDER) {
      if (!combined.includes(id)) combined.push(id);
    }
    // Remove any that no longer exist
    return combined.filter(id => DEFAULT_ORDER.includes(id));
  })();

  const sectionMap = Object.fromEntries(ALL_SECTIONS.map(s => [s.id, s]));

  const handleDragStart = useCallback((e, id) => {
    dragItemRef.current = id;
    e.dataTransfer.effectAllowed = 'move';
    // Make the drag image slightly transparent
    e.currentTarget.style.opacity = '0.5';
  }, []);

  const handleDragOver = useCallback((e, id) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragItemRef.current && dragItemRef.current !== id) {
      setDragOverId(id);
    }
  }, []);

  const handleDragEnd = useCallback((e) => {
    e.currentTarget.style.opacity = '1';
    const fromId = dragItemRef.current;
    const toId = dragOverId;
    dragItemRef.current = null;
    setDragOverId(null);

    if (!fromId || !toId || fromId === toId) return;

    const newOrder = [...order];
    const fromIdx = newOrder.indexOf(fromId);
    const toIdx = newOrder.indexOf(toId);
    if (fromIdx === -1 || toIdx === -1) return;
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, fromId);

    saveLocalOrder(newOrder);
    if (onUtilsOrderChange) onUtilsOrderChange(newOrder);
  }, [order, dragOverId, onUtilsOrderChange]);

  return (
    <div className={`utils-sidebar ${open ? 'open' : 'collapsed'}`}>
      {open && (
        <>
          <div className="utils-header">
            <h2>Utilities</h2>
          </div>

          <div className="utils-list">
            {order.map(id => {
              const section = sectionMap[id];
              if (!section) return null;
              return (
                <UtilSection
                  key={id}
                  id={id}
                  title={section.title}
                  disabled={section.disabled}
                  savedState={utilsState[id]}
                  onStateChange={updateSection}
                  draggable={true}
                  onDragStart={(e) => handleDragStart(e, id)}
                  onDragOver={(e) => handleDragOver(e, id)}
                  onDragEnd={handleDragEnd}
                  isDragOver={dragOverId === id}
                >
                  {renderSectionContent(id, utilsState, updateSection)}
                </UtilSection>
              );
            })}
          </div>
        </>
      )}

      {/* Collapse/expand toggle at bottom */}
      <button className="sidebar-toggle" onClick={() => onToggle(!open)}>
        {open ? '>>' : '<<'}
      </button>
    </div>
  );
}
