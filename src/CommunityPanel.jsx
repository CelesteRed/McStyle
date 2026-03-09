import { useState, useEffect, useCallback, useRef } from 'react';
import { parseMCText } from './mcParser';
import './CommunityPanel.css';

function MiniMCPreview({ text }) {
  const spans = parseMCText(text);
  return (
    <span className="mini-mc-preview">
      {spans.map((span, i) => {
        const r = parseInt(span.color.slice(1, 3), 16);
        const g = parseInt(span.color.slice(3, 5), 16);
        const b = parseInt(span.color.slice(5, 7), 16);
        const shadow = `rgb(${Math.floor(r / 4)}, ${Math.floor(g / 4)}, ${Math.floor(b / 4)})`;
        const textShadow = span.bold
          ? `1.5px 1.5px 0 ${shadow}, 0.75px 0 0 currentColor`
          : `1.5px 1.5px 0 ${shadow}`;
        return (
          <span key={i} style={{
            color: span.color,
            textShadow,
            fontStyle: span.italic ? 'italic' : 'normal',
            textDecoration: [
              span.underline ? 'underline' : '',
              span.strikethrough ? 'line-through' : '',
            ].filter(Boolean).join(' ') || 'none',
          }}>{span.text}</span>
        );
      })}
    </span>
  );
}

function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : '';
}

function setCookie(name, value, days = 365) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function playPing() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1200, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
    setTimeout(() => ctx.close(), 500);
  } catch {
    // audio not available
  }
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem('mcstyle_history') || '[]');
  } catch {
    return [];
  }
}

function saveHistory(items) {
  localStorage.setItem('mcstyle_history', JSON.stringify(items));
}

export default function CommunityPanel({ currentFormatString, open, onToggle, onModify }) {
  const openRef = useRef(open);
  const [tab, setTab] = useState('history');

  // Community state
  const [styles, setStyles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState(() => getCookie('mcstyle_username'));
  const [label, setLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [copiedId, setCopiedId] = useState(null);

  // History state
  const [history, setHistory] = useState(loadHistory);
  const [historyLabel, setHistoryLabel] = useState('');

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Fetch community styles when switching to community tab
  const fetchStyles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/styles');
      if (res.ok) setStyles(await res.json());
    } catch { /* silently fail */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open && tab === 'community') fetchStyles();
  }, [open, tab, fetchStyles]);

  // WebSocket for real-time community updates
  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${location.host}/ws`;
    let ws;
    let reconnectTimer;

    function connect() {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'new_style') {
            setStyles((prev) => [msg.style, ...prev]);
            if (!openRef.current) playPing();
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

  useEffect(() => {
    if (username) setCookie('mcstyle_username', username);
  }, [username]);

  // Save to local history
  const saveToHistory = () => {
    if (!currentFormatString.trim()) return;
    const entry = {
      id: Date.now().toString(),
      formatString: currentFormatString.trim(),
      label: historyLabel.trim() || 'Untitled',
      date: new Date().toLocaleDateString(),
    };
    const updated = [entry, ...history].slice(0, 50);
    setHistory(updated);
    saveHistory(updated);
    setHistoryLabel('');
  };

  const removeFromHistory = (id) => {
    const updated = history.filter(h => h.id !== id);
    setHistory(updated);
    saveHistory(updated);
  };

  // Share to community
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!username.trim()) { setError('Enter your MC username first!'); return; }
    if (!currentFormatString.trim()) { setError('Create a style first before sharing!'); return; }

    setSubmitting(true);
    try {
      const res = await fetch('/api/styles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          formatString: currentFormatString.trim(),
          label: label.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to share style.');
      } else {
        setSuccess('Style shared!');
        setLabel('');
        fetchStyles();
        setTimeout(() => setSuccess(''), 2000);
      }
    } catch {
      setError('Network error. Try again.');
    }
    setSubmitting(false);
  };

  const copyStyle = (formatString, id) => {
    navigator.clipboard.writeText(formatString).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1200);
    });
  };

  return (
    <div className={`community-sidebar ${open ? 'open' : 'collapsed'}`}>
      {open && (
        <>
          <div className="community-header">
            <div className="community-tabs">
              <button
                className={`community-tab ${tab === 'history' ? 'active' : ''}`}
                onClick={() => setTab('history')}
              >
                History
              </button>
              <button
                className={`community-tab ${tab === 'community' ? 'active' : ''}`}
                onClick={() => setTab('community')}
              >
                Community
              </button>
            </div>
          </div>

          <div className="community-body">
            {/* ===== HISTORY TAB ===== */}
            {tab === 'history' && (
              <>
                <div className="share-form">
                  <div className="share-form-title">Save Current Style</div>
                  <input
                    type="text"
                    placeholder="Label (e.g. Owner, Admin...)"
                    value={historyLabel}
                    onChange={(e) => setHistoryLabel(e.target.value)}
                    className="share-input"
                    maxLength={40}
                  />
                  <div className="share-preview-row">
                    <span className="share-preview-label">Style:</span>
                    <div className="share-preview-mc">
                      <MiniMCPreview text={currentFormatString + 'Steve'} />
                    </div>
                  </div>
                  <button className="share-btn" onClick={saveToHistory}>
                    Save to History
                  </button>
                </div>

                <div className="community-divider" />

                <div className="community-list">
                  {history.length === 0 && (
                    <div className="community-empty">No saved styles yet. Save one above!</div>
                  )}
                  {history.map((item) => (
                    <div key={item.id} className="community-card">
                      <div className="community-card-preview">
                        <MiniMCPreview text={item.formatString + 'Steve'} />
                      </div>
                      <div className="community-card-info">
                        <span className="community-card-label">{item.label}</span>
                        <span className="community-card-date">{item.date}</span>
                      </div>
                      <div className="community-card-actions">
                        <button
                          className="community-card-copy"
                          onClick={() => copyStyle(item.formatString, item.id)}
                        >
                          {copiedId === item.id ? 'Copied!' : 'Copy'}
                        </button>
                        <button
                          className="community-card-modify"
                          onClick={() => onModify && onModify(item.formatString, item.label)}
                        >
                          Modify
                        </button>
                        <button
                          className="community-card-delete"
                          onClick={() => removeFromHistory(item.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* ===== COMMUNITY TAB ===== */}
            {tab === 'community' && (
              <>
                <form className="share-form" onSubmit={handleSubmit}>
                  <div className="share-form-title">Share Your Style</div>
                  <input
                    type="text"
                    placeholder="MC Username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="share-input"
                    maxLength={24}
                  />
                  <input
                    type="text"
                    placeholder="Label (e.g. Owner, Admin...)"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    className="share-input"
                    maxLength={40}
                  />
                  <div className="share-preview-row">
                    <span className="share-preview-label">Sharing:</span>
                    <div className="share-preview-mc">
                      <MiniMCPreview text={currentFormatString + (username || 'Steve')} />
                    </div>
                  </div>
                  <button type="submit" className="share-btn" disabled={submitting}>
                    {submitting ? 'Sharing...' : 'Share Style'}
                  </button>
                  {error && <div className="share-error">{error}</div>}
                  {success && <div className="share-success">{success}</div>}
                </form>

                <div className="community-divider" />

                <div className="community-list">
                  {loading && <div className="community-loading">Loading...</div>}
                  {!loading && styles.length === 0 && (
                    <div className="community-empty">No styles shared yet. Be the first!</div>
                  )}
                  {styles.map((style) => (
                    <div key={style.id} className="community-card">
                      <div className="community-card-preview">
                        <MiniMCPreview text={style.formatString + style.username} />
                      </div>
                      <div className="community-card-info">
                        <span className="community-card-user">{style.username}</span>
                        {style.label && <span className="community-card-label">{style.label}</span>}
                      </div>
                      <div className="community-card-actions">
                        <button
                          className="community-card-copy"
                          onClick={() => copyStyle(style.formatString, style.id)}
                        >
                          {copiedId === style.id ? 'Copied!' : 'Copy'}
                        </button>
                        <button
                          className="community-card-modify"
                          onClick={() => onModify && onModify(style.formatString, style.label || style.username)}
                        >
                          Modify
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* Collapse/expand toggle at bottom */}
      <button className="sidebar-toggle" onClick={() => onToggle(!open)}>
        {open ? '<<' : '>>'}
      </button>
    </div>
  );
}
