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

export default function CommunityPanel({ currentFormatString, open, onToggle, onModify, discordUser, authLoading }) {
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
          } else if (msg.type === 'delete_style') {
            setStyles((prev) => prev.filter(s => s.id !== msg.id));
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
                className={`community-tab ${tab === 'community' ? 'active' : ''} ${!discordUser ? 'locked' : ''}`}
                onClick={() => discordUser ? setTab('community') : setTab('community')}
              >
                Community {!discordUser && !authLoading ? '\uD83D\uDD12' : ''}
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
            {tab === 'community' && !discordUser && (
              <div className="community-login-gate">
                <div className="login-gate-icon">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#5865F2" strokeWidth="1.5">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
                  </svg>
                </div>
                <p className="login-gate-title">Discord Login Required</p>
                <p className="login-gate-desc">Link your Discord account to view and share community styles.</p>
                <button className="discord-login-btn" onClick={async () => {
                  try {
                    const res = await fetch('/api/auth/discord-url');
                    const data = await res.json();
                    if (data.url) window.location.href = data.url;
                  } catch { /* */ }
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
                  </svg>
                  Login with Discord
                </button>
              </div>
            )}

            {tab === 'community' && discordUser && (
              <>
                <div className="community-user-bar">
                  {discordUser.avatar && <img className="community-user-avatar" src={discordUser.avatar} alt="" />}
                  <span className="community-user-name">{discordUser.globalName}</span>
                  <button className="community-logout-btn" onClick={async () => {
                    await fetch('/api/auth/logout', { method: 'POST' });
                    window.location.reload();
                  }}>Logout</button>
                </div>

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
                        {style.discordName && <span className="community-card-discord">{style.discordName}</span>}
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
