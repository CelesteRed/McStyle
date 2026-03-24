import { useState, useEffect, useRef, useCallback } from 'react';
import { parseMCText, MC_COLORS, MC_COLOR_NAMES } from './mcParser';
import ColorPicker from './ColorPicker';
import CommunityPanel from './CommunityPanel';
import UtilsPanel from './UtilsPanel';
import AdminPanel from './AdminPanel';
import './App.css';

const OBFUSCATED_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';

function mcShadowColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.floor(r / 4)}, ${Math.floor(g / 4)}, ${Math.floor(b / 4)})`;
}

function ObfuscatedChar({ children }) {
  const [char, setChar] = useState(children);
  useEffect(() => {
    const interval = setInterval(() => {
      setChar(OBFUSCATED_CHARS[Math.floor(Math.random() * OBFUSCATED_CHARS.length)]);
    }, 50);
    return () => clearInterval(interval);
  }, []);
  return <span>{char}</span>;
}

function MCPreview({ text }) {
  const spans = parseMCText(text);
  return (
    <div className="mc-preview">
      {spans.map((span, i) => {
        const shadow = mcShadowColor(span.color);
        const textShadow = span.bold
          ? `2px 2px 0 ${shadow}, 1px 0 0 currentColor`
          : `2px 2px 0 ${shadow}`;
        const style = {
          color: span.color,
          textShadow,
          fontStyle: span.italic ? 'italic' : 'normal',
          textDecoration: [
            span.underline ? 'underline' : '',
            span.strikethrough ? 'line-through' : '',
          ].filter(Boolean).join(' ') || 'none',
        };
        if (span.obfuscated) {
          return (
            <span key={i} style={style}>
              {span.text.split('').map((c, j) => (
                <ObfuscatedChar key={j}>{c}</ObfuscatedChar>
              ))}
            </span>
          );
        }
        return <span key={i} style={style}>{span.text}</span>;
      })}
    </div>
  );
}

const FORMAT_CODES = [
  { code: 'l', label: 'Bold', className: 'fmt-bold' },
  { code: 'o', label: 'Italic', className: 'fmt-italic' },
  { code: 'n', label: 'Underline', className: 'fmt-underline' },
  { code: 'm', label: 'Strike', className: 'fmt-strike' },
  { code: 'k', label: 'Magic', className: 'fmt-magic' },
];

let tabCounter = 1;

const DEFAULT_RAW = '<#FFFFFF>[Rank]</#FFFFFF> &f';

function createTab(name, rawText) {
  const text = rawText || DEFAULT_RAW;
  return {
    id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
    name: name || `Tab ${tabCounter++}`,
    mode: 'raw',
    rawText: text,
    originalRawText: text,
    prefix: '[Rank]',
    useGradient: false,
    gradientStart: '#67FB00',
    gradientEnd: '#35FFED',
    singleColor: '#FFFFFF',
    activeFormats: [],
    nameSuffix: '&f',
    styledChatEnabled: false,
    chatColorMode: 'first',
    chatCustomColor: '#FF0000',
    saved: false,
  };
}

function isTabDirty(t) {
  return !t.saved && t.rawText !== (t.originalRawText ?? DEFAULT_RAW);
}

function loadSavedTabs() {
  try {
    const data = JSON.parse(localStorage.getItem('mcstyle_tabs'));
    if (data && data.tabs && data.tabs.length > 0) {
      // Restore tabCounter so new tabs don't collide names
      const maxNum = data.tabs.reduce((max, t) => {
        const m = t.name.match(/^Tab (\d+)$/);
        return m ? Math.max(max, parseInt(m[1])) : max;
      }, 0);
      tabCounter = maxNum + 1;
      return data;
    }
  } catch { /* ignore */ }
  return null;
}

function saveTabs(tabs, activeTabId) {
  localStorage.setItem('mcstyle_tabs', JSON.stringify({ tabs, activeTabId }));
}

const PREVIEW_NAME = 'Steve';

const THEMES = [
  { id: 'default', label: 'Default Dark', colors: ['#1a1125', '#f5c842', '#3d2d56'] },
  { id: 'midnight', label: 'Midnight', colors: ['#0d0d1a', '#7b8cff', '#2a2a44'] },
  { id: 'nord', label: 'Nord', colors: ['#2e3440', '#88c0d0', '#4c566a'] },
  { id: 'monokai', label: 'Monokai', colors: ['#272822', '#a6e22e', '#49483e'] },
  { id: 'cherry', label: 'Cherry Blossom', colors: ['#1f0f14', '#ff6b8a', '#4a2838'] },
  { id: 'cyberpunk', label: 'Cyberpunk', colors: ['#0c0015', '#e040fb', '#3a1555'] },
  { id: 'tron', label: 'Tron', colors: ['#0a0e14', '#00e5ff', '#1a3a44'] },
  { id: 'discord', label: 'Discord', colors: ['#313338', '#5865f2', '#3f4147'] },
  { id: 'light', label: 'Light', colors: ['#eeeef3', '#555555', '#d0d0da'] },
];

function App() {
  const [tabs, setTabs] = useState(() => {
    const saved = loadSavedTabs();
    return saved ? saved.tabs : [createTab()];
  });
  const [activeTabId, setActiveTabId] = useState(() => {
    const saved = loadSavedTabs();
    return saved ? saved.activeTabId : tabs[0]?.id;
  });
  const [communityOpen, setCommunityOpen] = useState(true);
  const [utilsOpen, setUtilsOpen] = useState(true);
  const [utilsOrder, setUtilsOrder] = useState(null);
  const [copied, setCopied] = useState(false);
  const [shareLink, setShareLink] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('mcstyle_theme') || 'default');
  const [openMenu, setOpenMenu] = useState(null);
  const [onlineCount, setOnlineCount] = useState(0);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showProfileClear, setShowProfileClear] = useState(false);
  const [profileClearText, setProfileClearText] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareSelectedIds, setShareSelectedIds] = useState(new Set());
  const [shareModalStatus, setShareModalStatus] = useState(null);
  const profileMenuRef = useRef(null);
  const wsRef = useRef(null);
  const wsHandlersRef = useRef(new Set());
  const textareaRef = useRef(null);
  const snifferCooldown = useRef(false);
  const clickTimeout = useRef(null);

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('mcstyle_theme', theme);
  }, [theme]);

  // Shared WebSocket for online count + community updates
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let ws;
    let reconnectTimer;

    function connect() {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'online_count') {
            setOnlineCount(data.count);
          }
          // Forward all messages to registered handlers
          for (const handler of wsHandlersRef.current) {
            handler(data);
          }
        } catch { /* ignore */ }
      };
      ws.onclose = () => { reconnectTimer = setTimeout(connect, 3000); };
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, []);

  // Close menu on click outside
  useEffect(() => {
    if (!openMenu) return;
    const handleClick = (e) => {
      if (!e.target.closest('.menubar')) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [openMenu]);

  // Close profile menu on click outside
  useEffect(() => {
    if (!showProfileMenu) return;
    const handler = (e) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target)) {
        setShowProfileMenu(false);
        setShowProfileClear(false);
        setProfileClearText('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showProfileMenu]);

  const playSnifferSound = () => {
    if (snifferCooldown.current) return;
    snifferCooldown.current = true;
    const n = Math.floor(Math.random() * 3) + 1;
    const audio = new Audio(`/sounds/scenting${n}.ogg`);
    audio.volume = 0.5;
    audio.play().catch(() => {});
    setTimeout(() => { snifferCooldown.current = false; }, 1000);
  };

  const handleLogoClick = () => {
    if (clickTimeout.current) return; // waiting for double-click check
    clickTimeout.current = setTimeout(() => {
      clickTimeout.current = null;
      playSnifferSound();
    }, 250);
  };

  const handleLogoDoubleClick = () => {
    if (clickTimeout.current) {
      clearTimeout(clickTimeout.current);
      clickTimeout.current = null;
    }
    playSnifferSound();
    window.open('https://github.com/CelesteRed', '_blank');
  };

  // Discord auth state
  const [discordUser, setDiscordUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const cloudSyncedRef = useRef(false); // track if we already loaded cloud data
  const cloudSaveTimer = useRef(null);

  // Fetch cloud data once user is available
  useEffect(() => {
    if (!discordUser || cloudSyncedRef.current) return;
    cloudSyncedRef.current = true;
    fetch('/api/user/data').then(res => {
      if (res.ok) return res.json();
      return null;
    }).then(data => {
      if (!data) return;
      if (data.theme) {
        setTheme(data.theme);
      }
      if (data.utilsOrder) {
        setUtilsOrder(data.utilsOrder);
      }
      if (data.tabs && data.tabs.length > 0) {
        const cloudTabs = data.tabs.map(t => ({
          ...createTab(t.name, t.rawText),
          ...t,
          id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
          saved: false,
        }));
        setTabs(cloudTabs);
        setActiveTabId(cloudTabs[0].id);
      }
    }).catch(() => {});
  }, [discordUser]);

  // Auto-save to cloud (debounced 3s) when tabs or theme change and user is logged in
  useEffect(() => {
    if (!discordUser || !cloudSyncedRef.current) return;
    if (cloudSaveTimer.current) clearTimeout(cloudSaveTimer.current);
    cloudSaveTimer.current = setTimeout(() => {
      const strippedTabs = tabs.map(({ id, saved, ...rest }) => rest);
      fetch('/api/user/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme, tabs: strippedTabs, utilsOrder }),
      }).catch(() => {});
    }, 3000);
    return () => {
      if (cloudSaveTimer.current) clearTimeout(cloudSaveTimer.current);
    };
  }, [tabs, theme, utilsOrder, discordUser]);

  useEffect(() => {
    // Check if user is logged in
    fetch('/api/auth/me').then(res => {
      if (res.ok) return res.json();
      return null;
    }).then(user => {
      setDiscordUser(user);
      setAuthLoading(false);
    }).catch(() => setAuthLoading(false));
  }, []);

  // Handle OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      fetch('/api/auth/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      }).then(res => res.json()).then(data => {
        if (data.user) {
          setDiscordUser(data.user);
        }
      }).catch(() => {});
      // Clean URL
      window.history.replaceState({}, '', '/');
    }
  }, []);

  // Load shared tab(s) from /share/:id URL
  useEffect(() => {
    const match = window.location.pathname.match(/^\/share\/([a-f0-9]+)$/);
    if (!match) return;
    fetch(`/api/share/${match[1]}`).then(res => {
      if (!res.ok) return null;
      return res.json();
    }).then(data => {
      if (!data) return;
      // Support both old format (data.rawText) and new format (data.tabs[])
      const tabsList = data.tabs || [{ name: data.name, rawText: data.rawText }];
      const newTabs = tabsList
        .filter(t => t.rawText)
        .map(t => createTab(t.name || 'Shared Style', t.rawText));
      if (newTabs.length === 0) return;
      setTabs(prev => [...prev, ...newTabs]);
      setActiveTabId(newTabs[0].id);
    }).catch(() => {});
    window.history.replaceState({}, '', '/');
  }, []);

  const tab = tabs.find(t => t.id === activeTabId) || tabs[0];

  // Auto-save tabs to localStorage on every change
  useEffect(() => {
    saveTabs(tabs, activeTabId);
  }, [tabs, activeTabId]);

  const updateTab = useCallback((updates) => {
    setTabs(prev => prev.map(t => {
      if (t.id !== activeTabId) return t;
      const updated = { ...t, ...updates };
      // If content changed after being saved, mark unsaved again
      if (updates.rawText !== undefined && t.saved) {
        updated.saved = false;
      }
      return updated;
    }));
  }, [activeTabId]);

  const addTab = (name, rawText) => {
    const newTab = createTab(name, rawText);
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  const [showSavePrompt, setShowSavePrompt] = useState(null); // tab id to close
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [namePromptValue, setNamePromptValue] = useState('');
  const saveCurrentTabRef = useRef(null);

  // Ctrl+S = quick save, Ctrl+Shift+S = save as (name prompt)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (e.shiftKey) {
          // Save As - prompt for name
          setNamePromptValue(tab.name);
          setShowNamePrompt(true);
        } else {
          // Quick save - but if tab has a default name, prompt for a name first
          if (/^Tab \d+$/.test(tab.name)) {
            setNamePromptValue(tab.name);
            setShowNamePrompt(true);
          } else {
            saveCurrentTabRef.current();
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tab.name]);

  const closeTab = (id) => {
    if (tabs.length <= 1) return;
    const t = tabs.find(t => t.id === id);
    if (t && isTabDirty(t)) {
      setShowSavePrompt(id);
      return;
    }
    doCloseTab(id);
  };

  const doCloseTab = (id) => {
    const idx = tabs.findIndex(t => t.id === id);
    const newTabs = tabs.filter(t => t.id !== id);
    setTabs(newTabs);
    if (activeTabId === id) {
      setActiveTabId(newTabs[Math.min(idx, newTabs.length - 1)].id);
    }
    setShowSavePrompt(null);
  };

  // Called from CommunityPanel "Modify" button
  const handleModify = (formatString, label) => {
    addTab(label || 'Modified', formatString);
  };

  // Save to local history then close
  const saveAndClose = () => {
    const t = tabs.find(t => t.id === showSavePrompt);
    if (t) {
      const fs = t.rawText.trim();
      const history = JSON.parse(localStorage.getItem('mcstyle_history') || '[]');
      const entry = {
        id: Date.now().toString(),
        formatString: fs,
        label: t.name,
        date: new Date().toLocaleDateString(),
      };
      localStorage.setItem('mcstyle_history', JSON.stringify([entry, ...history].slice(0, 50)));
    }
    doCloseTab(showSavePrompt);
  };

  // Save current tab without closing (clears dirty state)
  const saveCurrentTab = (customName) => {
    const name = customName || tab.name;
    const fs = tab.rawText.trim();
    const history = JSON.parse(localStorage.getItem('mcstyle_history') || '[]');
    const entry = {
      id: Date.now().toString(),
      formatString: fs,
      label: name,
      date: new Date().toLocaleDateString(),
    };
    localStorage.setItem('mcstyle_history', JSON.stringify([entry, ...history].slice(0, 50)));
    updateTab({ saved: true, name });
  };

  saveCurrentTabRef.current = saveCurrentTab;

  // Save with name (from Ctrl+Shift+S prompt)
  const saveWithName = () => {
    const name = namePromptValue.trim() || tab.name;
    saveCurrentTab(name);
    setShowNamePrompt(false);
  };

  // Derived values from current tab
  const { mode, rawText, prefix, useGradient, gradientStart, gradientEnd, singleColor, activeFormats, nameSuffix, styledChatEnabled, chatColorMode, chatCustomColor } = tab;

  const builderOutput = (() => {
    let result = '';
    if (useGradient) {
      result += `<${gradientStart}>`;
      activeFormats.forEach(code => { result += `&${code}`; });
      result += prefix;
      result += `</${gradientEnd}>`;
    } else {
      result += `<${singleColor}>`;
      activeFormats.forEach(code => { result += `&${code}`; });
      result += prefix;
    }
    result += ` ${nameSuffix}`;
    return result;
  })();

  const chatColor = chatColorMode === 'first'
    ? (useGradient ? gradientStart : singleColor)
    : chatColorMode === 'last'
      ? (useGradient ? gradientEnd : singleColor)
      : chatCustomColor;

  const styledChatOutput = (() => {
    let result = `<${chatColor}>`;
    activeFormats.forEach(code => { result += `&${code}`; });
    result += prefix;
    return result;
  })();

  const currentFormatString = mode === 'raw' ? rawText : builderOutput;
  const previewText = currentFormatString + PREVIEW_NAME;
  const styledChatPreviewText = styledChatOutput + ` ${nameSuffix}` + PREVIEW_NAME;

  const toggleFormat = (code) => {
    updateTab({
      activeFormats: activeFormats.includes(code)
        ? activeFormats.filter(c => c !== code)
        : [...activeFormats, code]
    });
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(currentFormatString).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  const shareTab = async () => {
    if (!discordUser) {
      setShowLoginModal(true);
      return;
    }
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabs: [{ name: tab.name, rawText: currentFormatString }] }),
      });
      const data = await res.json();
      if (data.url) {
        const fullUrl = `${window.location.origin}${data.url}`;
        await navigator.clipboard.writeText(fullUrl);
        setShareLink(fullUrl);
        setTimeout(() => setShareLink(null), 3000);
      }
    } catch { /* */ }
  };

  const openShareModal = () => {
    if (!discordUser) {
      setShowLoginModal(true);
      return;
    }
    setShareSelectedIds(new Set([activeTabId]));
    setShareModalStatus(null);
    setShowShareModal(true);
  };

  const shareSelectedTabs = async () => {
    const selected = tabs.filter(t => shareSelectedIds.has(t.id));
    if (selected.length === 0) return;
    setShareModalStatus('sharing');
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tabs: selected.map(t => ({ name: t.name, rawText: t.rawText })),
        }),
      });
      const data = await res.json();
      if (data.url) {
        const fullUrl = `${window.location.origin}${data.url}`;
        await navigator.clipboard.writeText(fullUrl);
        setShareModalStatus('copied');
        setTimeout(() => {
          setShowShareModal(false);
          setShareModalStatus(null);
        }, 1500);
      }
    } catch {
      setShareModalStatus(null);
    }
  };

  const insertAtCursor = (text) => {
    if (mode !== 'raw' || !textareaRef.current) return;
    const ta = textareaRef.current;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const newText = rawText.slice(0, start) + text + rawText.slice(end);
    updateTab({ rawText: newText });
    setTimeout(() => {
      ta.selectionStart = ta.selectionEnd = start + text.length;
      ta.focus();
    }, 0);
  };

  // Export current tab as .mcstyle file
  const exportTab = () => {
    const { id, saved, ...tabData } = tab;
    const mcstyle = {
      version: 1,
      type: 'mcstyle',
      tabs: [tabData],
    };
    const blob = new Blob([JSON.stringify(mcstyle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tab.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.mcstyle`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export all tabs
  const exportAllTabs = () => {
    const mcstyle = {
      version: 1,
      type: 'mcstyle',
      tabs: tabs.map(({ id, saved, ...rest }) => rest),
    };
    const blob = new Blob([JSON.stringify(mcstyle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mcstyle_project.mcstyle';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import .mcstyle file
  const importFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mcstyle';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          if (data.type !== 'mcstyle' || !data.tabs || !data.tabs.length) {
            alert('Invalid .mcstyle file.');
            return;
          }
          const newTabs = data.tabs.map(t => ({
            ...createTab(t.name, t.rawText),
            ...t,
            id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
            saved: false,
          }));
          setTabs(prev => [...prev, ...newTabs]);
          setActiveTabId(newTabs[0].id);
        } catch {
          alert('Failed to parse .mcstyle file.');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const toggleMenu = (menu) => {
    setOpenMenu(prev => prev === menu ? null : menu);
  };

  return (
    <>
    {/* Menu Bar */}
    <div className="menubar">
      <div className="menubar-left">
        <img
          src="/mcstyle-logo.png"
          alt="MCStyle"
          className="menubar-logo"
          onClick={handleLogoClick}
          onDoubleClick={handleLogoDoubleClick}
          draggable={false}
        />
        <div className="menubar-item" onClick={() => toggleMenu('file')}>
          File
          {openMenu === 'file' && (
            <div className="menubar-dropdown">
              <div className="menubar-dropdown-item" onClick={() => { addTab(); setOpenMenu(null); }}>
                New Tab
              </div>
              <div className="menubar-dropdown-item" onClick={() => {
                if (/^Tab \d+$/.test(tab.name)) {
                  setNamePromptValue(tab.name);
                  setShowNamePrompt(true);
                } else {
                  saveCurrentTabRef.current();
                }
                setOpenMenu(null);
              }}>
                Save<span className="menubar-shortcut">Ctrl+S</span>
              </div>
              <div className="menubar-dropdown-item" onClick={() => {
                setNamePromptValue(tab.name);
                setShowNamePrompt(true);
                setOpenMenu(null);
              }}>
                Save As<span className="menubar-shortcut">Ctrl+Shift+S</span>
              </div>
              <div className="menubar-separator" />
              <div className="menubar-dropdown-item" onClick={() => { importFile(); setOpenMenu(null); }}>
                Import .mcstyle
              </div>
              <div className="menubar-dropdown-item" onClick={() => { exportTab(); setOpenMenu(null); }}>
                Export Tab
              </div>
              <div className="menubar-dropdown-item" onClick={() => { exportAllTabs(); setOpenMenu(null); }}>
                Export All
              </div>
            </div>
          )}
        </div>
        <div className="menubar-item" onClick={() => toggleMenu('view')}>
          View
          {openMenu === 'view' && (
            <div className="menubar-dropdown">
              <div className="menubar-dropdown-item menubar-submenu-parent">
                Theme
                <span className="menubar-submenu-arrow">&#9656;</span>
                <div className="menubar-submenu">
                  {THEMES.map(t => (
                    <div
                      key={t.id}
                      className={`menubar-dropdown-item ${theme === t.id ? 'menubar-active' : ''}`}
                      onClick={(e) => { e.stopPropagation(); setTheme(t.id); setOpenMenu(null); }}
                    >
                      {theme === t.id && <span className="menubar-check">&#10003;</span>}
                      {t.label}
                      <span className="theme-swatches">
                        {t.colors.map((c, i) => (
                          <span key={i} className="theme-swatch" style={{ background: c }} />
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="menubar-separator-v" />
        <div className="menubar-item" onClick={() => {
          if (/^Tab \d+$/.test(tab.name)) {
            setNamePromptValue(tab.name);
            setShowNamePrompt(true);
          } else {
            saveCurrentTabRef.current();
          }
          setOpenMenu(null);
        }}>Save</div>
        <div className="menubar-item" onClick={() => {
          setNamePromptValue(tab.name);
          setShowNamePrompt(true);
          setOpenMenu(null);
        }}>Save As</div>
        <div className="menubar-item" onClick={() => toggleMenu('share')}>
          Share
          {openMenu === 'share' && (
            <div className="menubar-dropdown">
              <div className="menubar-dropdown-item" onClick={() => { shareTab(); setOpenMenu(null); }}>
                Quick Share<span className="menubar-shortcut">Current Tab</span>
              </div>
              <div className="menubar-separator" />
              <div className="menubar-dropdown-item" onClick={() => { openShareModal(); setOpenMenu(null); }}>
                Share Tabs...
              </div>
            </div>
          )}
        </div>
        <div className="menubar-separator-v" />
        <div className="menubar-item" onClick={() => { importFile(); setOpenMenu(null); }}>Import</div>
        <div className="menubar-item" onClick={() => { exportTab(); setOpenMenu(null); }}>Export</div>
      </div>
      <div className="menubar-right">
        {discordUser && discordUser.isAdmin && (
          <div className="menubar-item admin-menubar-item" onClick={() => { setShowAdmin(prev => !prev); setOpenMenu(null); }}>
            Admin
          </div>
        )}
        <div className="menubar-online">
          <span className="menubar-online-dot" />
          {onlineCount} online
        </div>
        {discordUser ? (
          <div className="menubar-profile-wrap" ref={profileMenuRef}>
            <button
              className="menubar-user"
              onClick={() => { setShowProfileMenu(v => !v); setShowProfileClear(false); setProfileClearText(''); }}
            >
              {discordUser.avatar
                ? <img src={discordUser.avatar} alt="" className="menubar-avatar" />
                : <span className="menubar-avatar-placeholder">{(discordUser.globalName || '?')[0]}</span>
              }
              <span className="menubar-username">{discordUser.username}</span>
            </button>
            {showProfileMenu && (
              <div className="menubar-profile-dropdown">
                {!showProfileClear ? (
                  <>
                    <button className="profile-dropdown-item danger" onClick={() => setShowProfileClear(true)}>
                      Clear All Data
                    </button>
                    <button className="profile-dropdown-item" onClick={async () => {
                      await fetch('/api/auth/logout', { method: 'POST' });
                      window.location.reload();
                    }}>
                      Logout
                    </button>
                  </>
                ) : (
                  <div className="profile-dropdown-confirm">
                    <p className="profile-dropdown-warn">This will delete ALL your shared styles and data. This cannot be undone.</p>
                    <p className="profile-dropdown-warn-sub">Type <strong>confirm</strong> to proceed:</p>
                    <input
                      type="text"
                      className="profile-confirm-input"
                      placeholder="Type confirm..."
                      value={profileClearText}
                      onChange={(e) => setProfileClearText(e.target.value)}
                      autoFocus
                    />
                    <div className="profile-confirm-actions">
                      <button
                        className="profile-dropdown-item"
                        onClick={() => { setShowProfileClear(false); setProfileClearText(''); }}
                      >
                        Cancel
                      </button>
                      <button
                        className="profile-dropdown-item danger"
                        disabled={profileClearText !== 'confirm'}
                        onClick={async () => {
                          await fetch('/api/auth/clear-data', { method: 'POST' });
                          setShowProfileMenu(false);
                          setShowProfileClear(false);
                          setProfileClearText('');
                        }}
                      >
                        Delete Everything
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : !authLoading && (
          <>
            <button className="menubar-login-btn" onClick={() => setShowLoginModal(true)}>
              <span className="menubar-avatar-placeholder">?</span>
              Login
            </button>
            {showLoginModal && (
              <div className="login-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowLoginModal(false); }}>
                <div className="login-modal">
                  <button className="login-modal-close" onClick={() => setShowLoginModal(false)}>&times;</button>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="#5865F2"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
                  <h3 className="login-modal-title">Login with Discord</h3>
                  <ul className="login-modal-benefits">
                    <li>Save your projects to the cloud</li>
                    <li>Share styles with the community</li>
                    <li>Access your work from any device</li>
                  </ul>
                  <button className="login-modal-proceed" onClick={async () => {
                    try {
                      const res = await fetch('/api/auth/discord-url');
                      const data = await res.json();
                      if (data.url) window.location.href = data.url;
                    } catch { /* */ }
                  }}>
                    Continue with Discord
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        <span className="menubar-version">v1.1.6</span>
      </div>
    </div>

    <div className="layout-root">
    <CommunityPanel
      currentFormatString={currentFormatString}
      open={communityOpen}
      onToggle={setCommunityOpen}
      onModify={handleModify}
      discordUser={discordUser}
      authLoading={authLoading}
      wsHandlersRef={wsHandlersRef}
    />
    <div className="app">

      {/* Project Tabs */}
      <div className="project-tabs">
        {tabs.map(t => (
          <div
            key={t.id}
            className={`project-tab ${t.id === activeTabId ? 'active' : ''}`}
            onClick={() => setActiveTabId(t.id)}
          >
            <span className="project-tab-name">{t.name}{isTabDirty(t) ? ' *' : ''}</span>
            {tabs.length > 1 && (
              <button
                className="project-tab-close"
                onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
              >
                &times;
              </button>
            )}
          </div>
        ))}
        <button className="project-tab-add" onClick={() => addTab()}>+</button>
        {discordUser && <span className="cloud-sync-note">Cloud sync: up to 100 projects saved</span>}
      </div>

      <div className="page-layout">
        <div className="main-container">

          {/* ===== SECTION 1: LuckPerms + TAB ===== */}
          <div className="plugin-section">
            <div className="section-title">LuckPerms + TAB</div>

            <div className="preview-section">
              <div className="mc-preview-container">
                <div className="mc-tab-header">
                  <span className="tab-label">TAB</span>
                </div>
                <MCPreview text={previewText} />
              </div>
              <div className="mc-preview-container chat-preview">
                <div className="mc-tab-header">
                  <span className="tab-label">CHAT</span>
                </div>
                <div className="chat-line">
                  <MCPreview text={previewText} />
                  <span className="chat-message" style={{ color: '#FFFFFF' }}>: Hello, World!</span>
                </div>
              </div>
            </div>

            <div className="mode-tabs">
              <button
                className={`mode-tab ${mode === 'builder' ? 'active' : ''}`}
                onClick={() => updateTab({ mode: 'builder' })}
              >
                Builder
              </button>
              <button
                className={`mode-tab ${mode === 'raw' ? 'active' : ''}`}
                onClick={() => updateTab({ mode: 'raw' })}
              >
                Raw Editor
              </button>
            </div>

            <div className="editor-section">
              {mode === 'raw' ? (
                <div className="raw-editor">
                  <div className="quick-buttons">
                    <div className="button-group">
                      <span className="group-label">Colors:</span>
                      {Object.entries(MC_COLORS).map(([code, color]) => (
                        <button
                          key={code}
                          className="mc-color-btn"
                          style={{ backgroundColor: color, color: parseInt(code, 16) < 8 ? '#fff' : '#000' }}
                          title={`&${code} - ${MC_COLOR_NAMES[code]}`}
                          onClick={() => insertAtCursor(`&${code}`)}
                        >
                          {code}
                        </button>
                      ))}
                    </div>
                    <div className="button-group">
                      <span className="group-label">Format:</span>
                      {FORMAT_CODES.map(({ code, label }) => (
                        <button
                          key={code}
                          className="mc-fmt-btn"
                          title={`&${code} - ${label}`}
                          onClick={() => insertAtCursor(`&${code}`)}
                        >
                          &amp;{code}
                        </button>
                      ))}
                      <button
                        className="mc-fmt-btn reset-btn"
                        title="&r - Reset"
                        onClick={() => insertAtCursor('&r')}
                      >
                        &amp;r
                      </button>
                    </div>
                  </div>
                  <textarea
                    ref={textareaRef}
                    className="raw-textarea"
                    value={rawText}
                    onChange={(e) => updateTab({ rawText: e.target.value })}
                    placeholder="Enter MC formatted text... e.g. <#67FB00>&l[ᴏᴡɴᴇʀ]</#35FFED> &f"
                    rows={3}
                  />
                </div>
              ) : (
                <div className="builder">
                  <div className="builder-row">
                    <div className="builder-field">
                      <label>Prefix Text</label>
                      <input
                        type="text"
                        value={prefix}
                        onChange={(e) => updateTab({ prefix: e.target.value })}
                        placeholder="[ᴏᴡɴᴇʀ]"
                      />
                    </div>
                  </div>

                  <div className="builder-row">
                    <div className="builder-field">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={useGradient}
                          onChange={(e) => updateTab({ useGradient: e.target.checked })}
                        />
                        Use Gradient
                      </label>
                    </div>
                  </div>

                  {useGradient ? (
                    <div className="builder-row gradient-row">
                      <ColorPicker
                        label="Start Color"
                        value={gradientStart}
                        onChange={(v) => updateTab({ gradientStart: v })}
                      />
                      <div className="gradient-preview" style={{
                        background: `linear-gradient(to right, ${gradientStart}, ${gradientEnd})`
                      }} />
                      <ColorPicker
                        label="End Color"
                        value={gradientEnd}
                        onChange={(v) => updateTab({ gradientEnd: v })}
                      />
                    </div>
                  ) : (
                    <div className="builder-row">
                      <ColorPicker
                        label="Prefix Color"
                        value={singleColor}
                        onChange={(v) => updateTab({ singleColor: v })}
                      />
                    </div>
                  )}

                  <div className="builder-row">
                    <div className="builder-field">
                      <label>Name Color Suffix</label>
                      <input
                        type="text"
                        value={nameSuffix}
                        onChange={(e) => updateTab({ nameSuffix: e.target.value })}
                        placeholder="&f"
                        className="name-suffix-input"
                      />
                      <span className="field-hint">Color code applied before the username (e.g. &amp;f for white)</span>
                    </div>
                  </div>

                  <div className="builder-row">
                    <div className="builder-field">
                      <label>Formatting</label>
                      <div className="format-toggles">
                        {FORMAT_CODES.map(({ code, label, className }) => (
                          <button
                            key={code}
                            className={`fmt-toggle ${className} ${activeFormats.includes(code) ? 'active' : ''}`}
                            onClick={() => toggleFormat(code)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="output-section">
              <div className="section-header">
                Output
                <div className="output-actions">
                  <button className="copy-btn" onClick={copyToClipboard}>
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                  <button className="share-btn" onClick={shareTab}>
                    {shareLink ? 'Link Copied!' : 'Share'}
                  </button>
                </div>
              </div>
              <div className="output-box">
                <code>{currentFormatString}</code>
              </div>
              <div className="output-hint">
                <code className="command-hint">
                  /lp user &lt;player&gt; meta setprefix 900 &quot;{currentFormatString}&quot;
                </code>
              </div>
            </div>
          </div>

          {/* ===== SECTION 2: Styled Chat ===== */}
          <div className="plugin-section styled-chat-section">
            <div className="section-title">
              Styled Chat
              {!styledChatEnabled && (
                <button className="enable-btn" onClick={() => updateTab({ styledChatEnabled: true })}>
                  Enable
                </button>
              )}
              {styledChatEnabled && (
                <button className="disable-btn" onClick={() => updateTab({ styledChatEnabled: false })}>
                  Disable
                </button>
              )}
            </div>

            {!styledChatEnabled && (
              <p className="section-disabled-hint">Single-color prefix for Styled Chat plugin (no gradient support)</p>
            )}

            {styledChatEnabled && (
              <>
                <div className="preview-section">
                  <div className="mc-preview-container">
                    <div className="mc-tab-header">
                      <span className="tab-label">STYLED CHAT</span>
                    </div>
                    <div className="chat-line">
                      <MCPreview text={styledChatPreviewText} />
                      <span className="chat-message" style={{ color: '#FFFFFF' }}>: Hello, World!</span>
                    </div>
                  </div>
                </div>

                <div className="editor-section">
                  <div className="builder">
                    <div className="builder-row">
                      <div className="builder-field">
                        <label>Color Source</label>
                        <div className="chat-color-options">
                          <label className="radio-label">
                            <input
                              type="radio"
                              name={`chatColorMode-${tab.id}`}
                              value="first"
                              checked={chatColorMode === 'first'}
                              onChange={() => updateTab({ chatColorMode: 'first' })}
                            />
                            Use first color
                            <span className="radio-color-swatch" style={{ backgroundColor: useGradient ? gradientStart : singleColor }} />
                          </label>
                          <label className="radio-label">
                            <input
                              type="radio"
                              name={`chatColorMode-${tab.id}`}
                              value="last"
                              checked={chatColorMode === 'last'}
                              onChange={() => updateTab({ chatColorMode: 'last' })}
                            />
                            Use last color
                            <span className="radio-color-swatch" style={{ backgroundColor: useGradient ? gradientEnd : singleColor }} />
                          </label>
                          <label className="radio-label">
                            <input
                              type="radio"
                              name={`chatColorMode-${tab.id}`}
                              value="custom"
                              checked={chatColorMode === 'custom'}
                              onChange={() => updateTab({ chatColorMode: 'custom' })}
                            />
                            Custom color
                          </label>
                        </div>
                        {chatColorMode === 'custom' && (
                          <div className="chat-custom-picker">
                            <ColorPicker
                              value={chatCustomColor}
                              onChange={(v) => updateTab({ chatCustomColor: v })}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="output-section">
                  <div className="section-header">
                    Output
                    <button className="copy-btn" onClick={() => {
                      navigator.clipboard.writeText(styledChatOutput);
                    }}>Copy</button>
                  </div>
                  <div className="output-box">
                    <code>{styledChatOutput}</code>
                  </div>
                  <div className="output-hint">
                    <code className="command-hint">
                      /lp user &lt;player&gt; meta set chatprefix &quot;{styledChatOutput}&quot;
                    </code>
                  </div>
                </div>
              </>
            )}
          </div>

        </div>

      </div>

      {/* Save prompt modal */}
      {showSavePrompt && (
        <div className="save-prompt-overlay">
          <div className="save-prompt">
            <p>This tab has unsaved changes. What would you like to do?</p>
            <div className="save-prompt-actions">
              <button className="save-prompt-btn save" onClick={saveAndClose}>
                Save to History
              </button>
              <button className="save-prompt-btn discard" onClick={() => doCloseTab(showSavePrompt)}>
                Discard
              </button>
              <button className="save-prompt-btn cancel" onClick={() => setShowSavePrompt(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ctrl+S name prompt modal */}
      {showNamePrompt && (
        <div className="save-prompt-overlay">
          <div className="save-prompt">
            <p>Save this tab with a name:</p>
            <input
              type="text"
              className="save-name-input"
              value={namePromptValue}
              onChange={(e) => setNamePromptValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveWithName(); if (e.key === 'Escape') setShowNamePrompt(false); }}
              autoFocus
              placeholder="Tab name..."
            />
            <div className="save-prompt-actions">
              <button className="save-prompt-btn save" onClick={saveWithName}>
                Save
              </button>
              <button className="save-prompt-btn cancel" onClick={() => setShowNamePrompt(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share modal */}
      {showShareModal && (
        <div className="save-prompt-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowShareModal(false); }}>
          <div className="share-modal">
            <button className="login-modal-close" onClick={() => setShowShareModal(false)}>&times;</button>
            <h3 className="share-modal-title">Share Tabs</h3>
            <div className="share-modal-controls">
              <button
                className="share-modal-select-all"
                onClick={() => {
                  if (shareSelectedIds.size === tabs.length) {
                    setShareSelectedIds(new Set());
                  } else {
                    setShareSelectedIds(new Set(tabs.map(t => t.id)));
                  }
                }}
              >
                {shareSelectedIds.size === tabs.length ? 'Deselect All' : 'Select All'}
              </button>
              <span className="share-modal-count">{shareSelectedIds.size} selected</span>
            </div>
            <div className="share-modal-tabs">
              {tabs.map(t => (
                <label key={t.id} className={`share-modal-tab-item ${shareSelectedIds.has(t.id) ? 'selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={shareSelectedIds.has(t.id)}
                    onChange={() => {
                      setShareSelectedIds(prev => {
                        const next = new Set(prev);
                        if (next.has(t.id)) next.delete(t.id);
                        else next.add(t.id);
                        return next;
                      });
                    }}
                  />
                  <span className="share-modal-tab-name">{t.name}</span>
                  {t.id === activeTabId && <span className="share-modal-tab-current">current</span>}
                </label>
              ))}
            </div>
            <button
              className="share-modal-submit"
              disabled={shareSelectedIds.size === 0 || shareModalStatus === 'sharing'}
              onClick={shareSelectedTabs}
            >
              {shareModalStatus === 'copied' ? 'Link Copied!' : shareModalStatus === 'sharing' ? 'Sharing...' : `Share ${shareSelectedIds.size} Tab${shareSelectedIds.size !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      )}

      <footer className="footer">
        <p>McStyle - 2026 - by <a href="https://github.com/CelesteRed" target="_blank" rel="noopener noreferrer">Celeste</a> &lt;3</p>
        <p><a href="https://ko-fi.com/celestered" target="_blank" rel="noopener noreferrer">Buy me a Ko-fi</a></p>
      </footer>

    </div>
    <UtilsPanel open={utilsOpen} onToggle={setUtilsOpen} utilsOrder={utilsOrder} onUtilsOrderChange={setUtilsOrder} />
    <AdminPanel show={showAdmin} onClose={() => setShowAdmin(false)} />
    </div>
    </>
  );
}

export default App;
