import { useState, useEffect, useRef, useCallback } from 'react';
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

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AdminPanel({ show, onClose }) {
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [adminPass, setAdminPass] = useState('');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('online');

  // Styles state
  const [styles, setStyles] = useState([]);
  const [loadingStyles, setLoadingStyles] = useState(false);

  // Banned IPs state
  const [bannedIPs, setBannedIPs] = useState([]);
  const [newBanIP, setNewBanIP] = useState('');

  // Online users state
  const [onlineUsers, setOnlineUsers] = useState([]);

  // All users state (with storage info)
  const [allUsers, setAllUsers] = useState([]);

  // Dragging state
  const [pos, setPos] = useState({ x: 100, y: 80 });
  const dragRef = useRef(null);
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const handleMouseDown = useCallback((e) => {
    if (e.target.closest('.admin-close') || e.target.closest('.admin-tab') || e.target.closest('input') || e.target.closest('button')) return;
    dragging.current = true;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  }, [pos]);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!dragging.current) return;
      setPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
    };
    const handleMouseUp = () => { dragging.current = false; };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

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
    setOnlineUsers([]);
    setAllUsers([]);
  };

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

  const fetchOnlineUsers = async () => {
    try {
      const res = await fetch('/api/admin/online', { headers });
      if (res.ok) setOnlineUsers(await res.json());
    } catch { /* */ }
  };

  const fetchAllUsers = async () => {
    try {
      const res = await fetch('/api/admin/users', { headers });
      if (res.ok) setAllUsers(await res.json());
    } catch { /* */ }
  };

  useEffect(() => {
    if (!authed) return;
    if (activeTab === 'styles') fetchAdminStyles();
    if (activeTab === 'bans') fetchBannedIPs();
    if (activeTab === 'online') { fetchOnlineUsers(); fetchAllUsers(); }
  }, [authed, activeTab]);

  const deleteStyle = async (id) => {
    try {
      const res = await fetch(`/api/admin/styles/${id}`, { method: 'DELETE', headers });
      if (res.ok) setStyles(prev => prev.filter(s => s.id !== id));
    } catch { /* */ }
  };

  const banIP = async (ip) => {
    try {
      const res = await fetch('/api/admin/ban', { method: 'POST', headers, body: JSON.stringify({ ip }) });
      if (res.ok) {
        const data = await res.json();
        setBannedIPs(data.bannedIPs);
        setNewBanIP('');
      }
    } catch { /* */ }
  };

  const unbanIP = async (ip) => {
    try {
      const res = await fetch('/api/admin/unban', { method: 'POST', headers, body: JSON.stringify({ ip }) });
      if (res.ok) {
        const data = await res.json();
        setBannedIPs(data.bannedIPs);
      }
    } catch { /* */ }
  };

  const banAndPurge = async (ip) => {
    await banIP(ip);
    const toDelete = styles.filter(s => s.ip === ip);
    for (const s of toDelete) await deleteStyle(s.id);
  };

  if (!show) return null;

  return (
    <div
      className="admin-float"
      ref={dragRef}
      style={{ left: pos.x, top: pos.y }}
    >
      <div className="admin-header" onMouseDown={handleMouseDown}>
        <h2>Admin Panel</h2>
        <button className="admin-close" onClick={() => { onClose(); logout(); }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
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
            <button className={`admin-tab ${activeTab === 'online' ? 'active' : ''}`} onClick={() => setActiveTab('online')}>
              Online ({onlineUsers.length})
            </button>
            <button className={`admin-tab ${activeTab === 'styles' ? 'active' : ''}`} onClick={() => setActiveTab('styles')}>
              Styles ({styles.length})
            </button>
            <button className={`admin-tab ${activeTab === 'bans' ? 'active' : ''}`} onClick={() => setActiveTab('bans')}>
              Bans ({bannedIPs.length})
            </button>
            <button className="admin-tab logout" onClick={logout}>Logout</button>
          </div>

          {activeTab === 'online' && (
            <div className="admin-body">
              <button className="admin-refresh" onClick={() => { fetchOnlineUsers(); fetchAllUsers(); }}>Refresh</button>
              <div className="admin-section-label">Online Now</div>
              <div className="admin-online-list">
                {onlineUsers.length === 0 && <div className="admin-empty">No users online.</div>}
                {onlineUsers.map(u => (
                  <div key={u.discordId} className="admin-online-user">
                    {u.avatar && <img src={u.avatar} alt="" className="admin-online-avatar" />}
                    <span className="admin-online-username">{u.username}</span>
                    <span className="admin-online-dot-green" />
                  </div>
                ))}
              </div>
              <div className="admin-section-label">All Users ({allUsers.length})</div>
              <div className="admin-users-list">
                {allUsers.map(u => (
                  <div key={u.discordId} className="admin-user-card">
                    <div className="admin-user-top">
                      {u.avatar && <img src={u.avatar} alt="" className="admin-online-avatar" />}
                      <span className="admin-online-username">{u.username}</span>
                      {u.online && <span className="admin-online-dot-green" />}
                    </div>
                    <div className="admin-user-stats">
                      <span>{u.tabCount} tabs</span>
                      <span>{formatBytes(u.dataSize)}</span>
                      <span className="admin-user-theme">{u.theme}</span>
                      {u.updatedAt && <span className="admin-user-date">{new Date(u.updatedAt).toLocaleDateString()}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'styles' && (
            <div className="admin-body">
              <button className="admin-refresh" onClick={fetchAdminStyles}>Refresh</button>
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
                      <button className="admin-action-btn delete" onClick={() => deleteStyle(s.id)}>Delete</button>
                      {s.ip && (
                        <>
                          <button className="admin-action-btn ban" onClick={() => banIP(s.ip)}>Ban IP</button>
                          <button className="admin-action-btn purge" onClick={() => banAndPurge(s.ip)}>Ban + Purge</button>
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
                {bannedIPs.length === 0 && <div className="admin-empty">No banned IPs.</div>}
                {bannedIPs.map(ip => (
                  <div key={ip} className="admin-ban-item">
                    <span className="admin-ban-ip">{ip}</span>
                    <button className="admin-action-btn unban" onClick={() => unbanIP(ip)}>Unban</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
