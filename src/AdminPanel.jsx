import { useState, useEffect } from 'react';
import { parseMCText } from './mcParser';
import './AdminPanel.css';

function MiniMCPreview({ text }) {
  const spans = parseMCText(text);
  return (
    <span className="admin-mc-preview">
      {spans.map((span, i) => {
        const r = parseInt(span.color.slice(1, 3), 16);
        const g = parseInt(span.color.slice(3, 5), 16);
        const b = parseInt(span.color.slice(5, 7), 16);
        const shadow = `rgb(${Math.floor(r / 4)}, ${Math.floor(g / 4)}, ${Math.floor(b / 4)})`;
        return (
          <span key={i} style={{
            color: span.color,
            textShadow: `1.5px 1.5px 0 ${shadow}`,
            fontStyle: span.italic ? 'italic' : 'normal',
          }}>{span.text}</span>
        );
      })}
    </span>
  );
}

export default function AdminPanel() {
  const [show, setShow] = useState(false);
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [adminPass, setAdminPass] = useState('');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('styles');

  // Styles state
  const [styles, setStyles] = useState([]);
  const [loadingStyles, setLoadingStyles] = useState(false);

  // Banned IPs state
  const [bannedIPs, setBannedIPs] = useState([]);
  const [newBanIP, setNewBanIP] = useState('');

  const headers = { 'Content-Type': 'application/json', 'x-admin-password': adminPass };

  const login = async () => {
    setError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setAuthed(true);
        setAdminPass(password);
        setPassword('');
      } else {
        setError('Wrong password.');
      }
    } catch {
      setError('Connection failed.');
    }
  };

  const logout = () => {
    setAuthed(false);
    setAdminPass('');
    setStyles([]);
    setBannedIPs([]);
  };

  // Fetch admin data
  const fetchAdminStyles = async () => {
    setLoadingStyles(true);
    try {
      const res = await fetch('/api/admin/styles', { headers });
      if (res.ok) setStyles(await res.json());
    } catch { /* */ }
    setLoadingStyles(false);
  };

  const fetchBannedIPs = async () => {
    try {
      const res = await fetch('/api/admin/banned', { headers });
      if (res.ok) setBannedIPs(await res.json());
    } catch { /* */ }
  };

  useEffect(() => {
    if (authed && activeTab === 'styles') fetchAdminStyles();
    if (authed && activeTab === 'bans') fetchBannedIPs();
  }, [authed, activeTab]);

  const deleteStyle = async (id) => {
    try {
      const res = await fetch(`/api/admin/styles/${id}`, { method: 'DELETE', headers });
      if (res.ok) {
        setStyles(prev => prev.filter(s => s.id !== id));
      }
    } catch { /* */ }
  };

  const banIP = async (ip) => {
    try {
      const res = await fetch('/api/admin/ban', {
        method: 'POST', headers,
        body: JSON.stringify({ ip }),
      });
      if (res.ok) {
        const data = await res.json();
        setBannedIPs(data.bannedIPs);
        setNewBanIP('');
      }
    } catch { /* */ }
  };

  const unbanIP = async (ip) => {
    try {
      const res = await fetch('/api/admin/unban', {
        method: 'POST', headers,
        body: JSON.stringify({ ip }),
      });
      if (res.ok) {
        const data = await res.json();
        setBannedIPs(data.bannedIPs);
      }
    } catch { /* */ }
  };

  // Ban IP and delete all their styles
  const banAndPurge = async (ip) => {
    await banIP(ip);
    const toDelete = styles.filter(s => s.ip === ip);
    for (const s of toDelete) {
      await deleteStyle(s.id);
    }
  };

  if (!show) {
    return (
      <button className="admin-toggle" onClick={() => setShow(true)} title="Admin">
        A
      </button>
    );
  }

  return (
    <div className="admin-overlay">
      <div className="admin-modal">
        <div className="admin-header">
          <h2>Admin Panel</h2>
          <button className="admin-close" onClick={() => { setShow(false); logout(); }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {!authed ? (
          <div className="admin-login">
            <input
              type="password"
              placeholder="Admin password..."
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && login()}
              className="admin-input"
              autoFocus
            />
            <button className="admin-btn" onClick={login}>Login</button>
            {error && <div className="admin-error">{error}</div>}
          </div>
        ) : (
          <>
            <div className="admin-tabs">
              <button
                className={`admin-tab ${activeTab === 'styles' ? 'active' : ''}`}
                onClick={() => setActiveTab('styles')}
              >
                Styles ({styles.length})
              </button>
              <button
                className={`admin-tab ${activeTab === 'bans' ? 'active' : ''}`}
                onClick={() => setActiveTab('bans')}
              >
                Banned IPs ({bannedIPs.length})
              </button>
              <button className="admin-tab logout" onClick={logout}>Logout</button>
            </div>

            {activeTab === 'styles' && (
              <div className="admin-body">
                <button className="admin-refresh" onClick={fetchAdminStyles}>
                  Refresh
                </button>
                {loadingStyles && <div className="admin-loading">Loading...</div>}
                <div className="admin-style-list">
                  {styles.map(s => (
                    <div key={s.id} className="admin-style-card">
                      <div className="admin-style-preview">
                        <MiniMCPreview text={s.formatString + s.username} />
                      </div>
                      <div className="admin-style-info">
                        <span className="admin-style-user">{s.username}</span>
                        {s.label && <span className="admin-style-label">{s.label}</span>}
                        <span className="admin-style-ip">{s.ip || '?'}</span>
                        <span className="admin-style-date">
                          {s.createdAt ? new Date(s.createdAt).toLocaleString() : ''}
                        </span>
                      </div>
                      <div className="admin-style-actions">
                        <button className="admin-action-btn delete" onClick={() => deleteStyle(s.id)}>
                          Delete
                        </button>
                        {s.ip && (
                          <>
                            <button className="admin-action-btn ban" onClick={() => banIP(s.ip)}>
                              Ban IP
                            </button>
                            <button className="admin-action-btn purge" onClick={() => banAndPurge(s.ip)}>
                              Ban + Purge
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'bans' && (
              <div className="admin-body">
                <div className="admin-ban-form">
                  <input
                    type="text"
                    placeholder="IP address to ban..."
                    value={newBanIP}
                    onChange={(e) => setNewBanIP(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && banIP(newBanIP)}
                    className="admin-input"
                  />
                  <button className="admin-btn" onClick={() => banIP(newBanIP)}>Ban</button>
                </div>
                <div className="admin-ban-list">
                  {bannedIPs.length === 0 && (
                    <div className="admin-empty">No banned IPs.</div>
                  )}
                  {bannedIPs.map(ip => (
                    <div key={ip} className="admin-ban-item">
                      <span className="admin-ban-ip">{ip}</span>
                      <button className="admin-action-btn unban" onClick={() => unbanIP(ip)}>
                        Unban
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
