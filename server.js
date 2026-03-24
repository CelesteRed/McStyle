import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { Filter } from 'bad-words';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const PORT = 5858;

// Config from env
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'http://localhost:5173';
const ADMIN_DISCORD_ID = process.env.ADMIN_DISCORD_ID || '';
const IS_HTTPS = DISCORD_REDIRECT_URI.startsWith('https');

// Data file paths (persisted in Docker volume)
const DATA_DIR = process.env.DATA_DIR || join(__dirname, 'data');
const DATA_FILE = join(DATA_DIR, 'styles.json');
const BANNED_FILE = join(DATA_DIR, 'banned_ips.json');
const BANNED_DISCORD_FILE = join(DATA_DIR, 'banned_discord.json');
const USERS_FILE = join(DATA_DIR, 'users.json');
const SESSIONS_FILE = join(DATA_DIR, 'sessions.json');
const SHARES_FILE = join(DATA_DIR, 'shares.json');

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// --- In-memory data cache (load once, write on change) ---

function loadJSON(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf-8')); }
  catch { return fallback; }
}

function saveJSON(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

let styles = loadJSON(DATA_FILE, []);
let bannedIPs = loadJSON(BANNED_FILE, []);
let bannedDiscords = loadJSON(BANNED_DISCORD_FILE, []);
let users = loadJSON(USERS_FILE, {});
let shares = loadJSON(SHARES_FILE, {});

function persistStyles() { saveJSON(DATA_FILE, styles); }
function persistBannedIPs() { saveJSON(BANNED_FILE, bannedIPs); }
function persistBannedDiscords() { saveJSON(BANNED_DISCORD_FILE, bannedDiscords); }
function persistUsers() { saveJSON(USERS_FILE, users); }
function persistShares() { saveJSON(SHARES_FILE, shares); }

// --- Persistent sessions (survive restarts) ---

const sessions = new Map();

function loadSessions() {
  const data = loadJSON(SESSIONS_FILE, []);
  const now = Date.now();
  for (const [token, session] of data) {
    if (session.expiresAt > now) {
      sessions.set(token, session);
    }
  }
}

function persistSessions() {
  saveJSON(SESSIONS_FILE, [...sessions.entries()]);
}

loadSessions();

// Clean expired sessions every hour
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) {
      sessions.delete(token);
      changed = true;
    }
  }
  if (changed) persistSessions();
}, 60 * 60 * 1000);

// --- WebSocket server ---

const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(msg);
    }
  }
}

// Online user tracking — only count Discord-authenticated users
const onlineUsers = new Map(); // ws -> { discordId, username, avatar }

function getAuthenticatedCount() {
  return onlineUsers.size;
}

function broadcastOnlineCount() {
  broadcast({ type: 'online_count', count: getAuthenticatedCount() });
}

wss.on('connection', (ws, req) => {
  // Parse cookie from upgrade request to identify user
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/mcstyle_token=([^;]+)/);
  const token = match ? match[1] : null;
  const session = token ? sessions.get(token) : null;

  if (session) {
    onlineUsers.set(ws, {
      discordId: session.discordId,
      username: session.username,
      avatar: session.avatar,
    });
  }

  // Send current count to newly connected client
  ws.send(JSON.stringify({ type: 'online_count', count: getAuthenticatedCount() }));
  broadcastOnlineCount();

  // Allow client to authenticate after connecting (e.g. if they log in later)
  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'auth' && data.token) {
        const s = sessions.get(data.token);
        if (s && !onlineUsers.has(ws)) {
          onlineUsers.set(ws, { discordId: s.discordId, username: s.username, avatar: s.avatar });
          broadcastOnlineCount();
        }
      }
    } catch { /* ignore */ }
  });

  ws.on('close', () => {
    onlineUsers.delete(ws);
    broadcastOnlineCount();
  });
});

// Heartbeat to keep connections alive
setInterval(() => {
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.ping();
    }
  }
}, 30000);

// --- Profanity filter ---

const filter = new Filter();
filter.addWords(
  'nazi', 'hitler', 'heil', 'swastika', 'kkk', 'whitepow',
  'whitepower', 'n1gger', 'n1gga', 'f4ggot', 'f4g',
  'tr4nny', 'ch1nk', 'sp1c', 'k1ke', 'wetb4ck'
);

const LEET_MAP = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
  '@': 'a', '$': 's', '!': 'i', '+': 't', '(': 'c', '|': 'l',
  '\u00e0': 'a', '\u00e1': 'a', '\u00e2': 'a', '\u00e3': 'a', '\u00e4': 'a',
  '\u00e8': 'e', '\u00e9': 'e', '\u00ea': 'e', '\u00eb': 'e',
  '\u00ec': 'i', '\u00ed': 'i', '\u00ee': 'i', '\u00ef': 'i',
  '\u00f2': 'o', '\u00f3': 'o', '\u00f4': 'o', '\u00f5': 'o', '\u00f6': 'o',
  '\u00f9': 'u', '\u00fa': 'u', '\u00fb': 'u', '\u00fc': 'u',
  '\u00ff': 'y', '\u00f1': 'n', '\u00e7': 'c',
  '\u1D00': 'a', '\u0299': 'b', '\u1D04': 'c', '\u1D05': 'd', '\u1D07': 'e',
  '\uA730': 'f', '\u0262': 'g', '\u029C': 'h', '\u026A': 'i', '\u1D0A': 'j',
  '\u1D0B': 'k', '\u029F': 'l', '\u1D0D': 'm', '\u0274': 'n', '\u1D0F': 'o',
  '\u1D18': 'p', '\u01EB': 'q', '\u0280': 'r', '\u1D1B': 't', '\u1D1C': 'u',
  '\u1D20': 'v', '\u1D21': 'w', '\u028F': 'y', '\u1D22': 'z',
};

const SLUR_PATTERNS = [
  'nigger', 'nigga', 'nigg', 'n1gg',
  'faggot', 'fagot', 'fagg',
  'tranny', 'trannie',
  'chink', 'gook', 'spic', 'spick', 'wetback',
  'kike', 'kyke',
  'coon', 'darkie', 'darky',
  'beaner', 'gringo',
  'towelhead', 'raghead', 'sandnigger',
  'retard', 'retrd',
  'whitepower', 'whitepow', 'heilhitler',
  'nazi', 'hitler', 'heil', 'swastika',
  'kkk',
];

function normalizeText(text) {
  let normalized = text.toLowerCase();
  normalized = normalized.replace(/<#[0-9a-f]{6}>|<\/#[0-9a-f]{6}>|&[0-9a-fk-or]/gi, '');
  normalized = normalized.split('').map(ch => LEET_MAP[ch] || ch).join('');
  normalized = normalized.replace(/[^a-z]/g, '');
  return normalized;
}

function isStrictProfane(text) {
  if (filter.isProfane(text)) return true;
  const normalized = normalizeText(text);
  for (const pattern of SLUR_PATTERNS) {
    if (normalized.includes(pattern)) return true;
  }
  return false;
}

// --- Helpers ---

const ALLOWED_EMOJIS = ['\uD83D\uDD25', '\u2764\uFE0F', '\uD83D\uDE02', '\uD83C\uDFA8'];

function getPublicReactions(reactions, sessionDiscordId) {
  if (!reactions) {
    return { up: 0, down: 0, emojis: {}, userVote: null, userEmojis: [] };
  }
  const up = (reactions.up || []).length;
  const down = (reactions.down || []).length;
  const emojis = {};
  for (const [emoji, emojiUsers] of Object.entries(reactions.emojis || {})) {
    if (emojiUsers.length > 0) emojis[emoji] = emojiUsers.length;
  }
  let userVote = null;
  let userEmojis = [];
  if (sessionDiscordId) {
    if ((reactions.up || []).includes(sessionDiscordId)) userVote = 'up';
    else if ((reactions.down || []).includes(sessionDiscordId)) userVote = 'down';
    for (const [emoji, emojiUsers] of Object.entries(reactions.emojis || {})) {
      if (emojiUsers.includes(sessionDiscordId)) userEmojis.push(emoji);
    }
  }
  return { up, down, emojis, userVote, userEmojis };
}

function getClientIP(req) {
  let ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket.remoteAddress || '';
  if (ip.includes(',')) ip = ip.split(',')[0].trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

// Rate limit: max 5 posts per IP per minute + 5 second cooldown between posts
const rateLimits = new Map();
const lastPostTime = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const lastTime = lastPostTime.get(ip) || 0;
  if (now - lastTime < 5000) {
    return { allowed: false, reason: 'Please wait 5 seconds between submissions.' };
  }
  const entry = rateLimits.get(ip) || [];
  const recent = entry.filter(t => now - t < 60000);
  if (recent.length >= 5) {
    return { allowed: false, reason: 'Too many submissions. Wait a minute.' };
  }
  recent.push(now);
  rateLimits.set(ip, recent);
  lastPostTime.set(ip, now);
  return { allowed: true };
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of rateLimits) {
    const recent = times.filter(t => now - t < 60000);
    if (recent.length === 0) rateLimits.delete(ip);
    else rateLimits.set(ip, recent);
  }
  for (const [ip, time] of lastPostTime) {
    if (now - time > 60000) lastPostTime.delete(ip);
  }
}, 300000);

// Parse session token from cookie
function getSession(req) {
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/mcstyle_token=([^;]+)/);
  if (!match) return null;
  const session = sessions.get(match[1]);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(match[1]);
    return null;
  }
  return session;
}

function generateToken() {
  return randomBytes(32).toString('hex');
}

function makeCookie(name, value, maxAge) {
  let cookie = `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
  if (IS_HTTPS) cookie += '; Secure';
  return cookie;
}

// Admin auth middleware
function requireAdmin(req, res, next) {
  const auth = req.headers['x-admin-password'];
  if (auth === ADMIN_PASSWORD) return next();
  const session = getSession(req);
  if (session && ADMIN_DISCORD_ID && session.discordId === ADMIN_DISCORD_ID) return next();
  return res.status(401).json({ error: 'Unauthorized.' });
}

// --- Express setup ---

const MAX_BODY_SIZE = '1mb';
app.use(express.json({ limit: MAX_BODY_SIZE }));
app.use(express.static(join(__dirname, 'dist')));

// --- Discord OAuth Routes ---

app.get('/api/auth/discord-url', (req, res) => {
  if (!DISCORD_CLIENT_ID) {
    return res.status(500).json({ error: 'Discord not configured.' });
  }
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify',
  });
  res.json({ url: `https://discord.com/api/oauth2/authorize?${params}` });
});

app.post('/api/auth/callback', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'No code provided.' });

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.status(400).json({ error: 'Failed to authenticate with Discord.' });
    }

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userRes.json();
    if (!userData.id) {
      return res.status(400).json({ error: 'Failed to get Discord user info.' });
    }

    const maxAge = 30 * 24 * 60 * 60; // 30 days in seconds
    const user = {
      discordId: userData.id,
      username: userData.username,
      globalName: userData.global_name || userData.username,
      avatar: userData.avatar
        ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
        : null,
      expiresAt: Date.now() + maxAge * 1000,
    };

    const token = generateToken();
    sessions.set(token, user);
    persistSessions();

    // Persist profile info for admin panel
    const loginIp = getClientIP(req);
    const existing = users[user.discordId] || {};
    existing.discordUsername = user.username;
    existing.discordGlobalName = user.globalName;
    existing.discordAvatar = user.avatar;
    existing.lastIp = loginIp;
    users[user.discordId] = existing;
    persistUsers();

    res.setHeader('Set-Cookie', makeCookie('mcstyle_token', token, maxAge));
    const { expiresAt, ...publicUser } = user;
    res.json({ user: publicUser });
  } catch (err) {
    console.error('Discord OAuth error:', err);
    res.status(500).json({ error: 'Discord authentication failed.' });
  }
});

app.get('/api/auth/me', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json(null);
  const isAdmin = !!(ADMIN_DISCORD_ID && session.discordId === ADMIN_DISCORD_ID);
  const { expiresAt, ...publicSession } = session;
  res.json({ ...publicSession, isAdmin });
});

app.post('/api/auth/logout', (req, res) => {
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/mcstyle_token=([^;]+)/);
  if (match) {
    sessions.delete(match[1]);
    persistSessions();
  }
  res.setHeader('Set-Cookie', makeCookie('mcstyle_token', '', 0));
  res.json({ success: true });
});

app.post('/api/auth/clear-data', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });
  const removed = styles.filter(s => s.discordId === session.discordId);
  styles = styles.filter(s => s.discordId !== session.discordId);
  persistStyles();
  removed.forEach(s => broadcast({ type: 'delete_style', id: s.id }));
  res.json({ success: true, deleted: removed.length });
});

// --- Public API Routes ---

app.get('/api/styles', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Login with Discord to view community styles.' });
  res.json(styles.map(({ ip, discordId, reactions, ...rest }) => ({
    ...rest,
    reactions: getPublicReactions(reactions, session.discordId),
  })));
});

app.post('/api/styles', (req, res) => {
  const ip = getClientIP(req);
  const session = getSession(req);

  if (!session) {
    return res.status(401).json({ error: 'Login with Discord to share styles.' });
  }

  if (bannedIPs.includes(ip) || bannedDiscords.includes(session.discordId)) {
    return res.status(403).json({ error: 'You have been blocked from posting.' });
  }

  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return res.status(429).json({ error: rateCheck.reason });
  }

  const { username, formatString, label } = req.body;

  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    return res.status(400).json({ error: 'Username is required.' });
  }
  if (!formatString || typeof formatString !== 'string' || formatString.trim().length === 0) {
    return res.status(400).json({ error: 'Format string is required.' });
  }

  const cleanUsername = username.trim().slice(0, 24);
  const cleanLabel = (label || '').trim().slice(0, 40);
  const cleanFormat = formatString.trim().slice(0, 200);

  if (isStrictProfane(cleanUsername) || isStrictProfane(cleanLabel) || isStrictProfane(cleanFormat)) {
    return res.status(400).json({ error: 'Inappropriate content detected.' });
  }

  const newStyle = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    username: cleanUsername,
    label: cleanLabel,
    formatString: cleanFormat,
    ip: ip,
    discordId: session.discordId,
    discordName: session.globalName || session.username,
    discordAvatar: session.avatar || null,
    createdAt: new Date().toISOString(),
  };

  styles.unshift(newStyle);
  if (styles.length > 500) styles.length = 500;
  persistStyles();

  const { ip: _ip, discordId: _did, ...publicStyle } = newStyle;
  const publicStyleWithReactions = { ...publicStyle, reactions: getPublicReactions(null, null) };
  broadcast({ type: 'new_style', style: publicStyleWithReactions });
  res.status(201).json(publicStyleWithReactions);
});

// --- Admin API Routes ---

const adminLoginAttempts = new Map();

app.post('/api/admin/login', (req, res) => {
  const ip = getClientIP(req);
  const now = Date.now();
  const attempt = adminLoginAttempts.get(ip) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (now > attempt.resetAt) {
    attempt.count = 0;
    attempt.resetAt = now + 15 * 60 * 1000;
  }
  if (attempt.count >= 5) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  }

  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    adminLoginAttempts.delete(ip);
    res.json({ success: true });
  } else {
    attempt.count++;
    adminLoginAttempts.set(ip, attempt);
    res.status(401).json({ error: 'Wrong password.' });
  }
});

app.get('/api/admin/styles', requireAdmin, (req, res) => {
  const session = getSession(req);
  res.json(styles.map(style => ({
    ...style,
    reactions: getPublicReactions(style.reactions, session ? session.discordId : null),
  })));
});

app.delete('/api/admin/styles/:id', requireAdmin, (req, res) => {
  const idx = styles.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Style not found.' });
  styles.splice(idx, 1);
  persistStyles();
  broadcast({ type: 'delete_style', id: req.params.id });
  res.json({ success: true });
});

app.get('/api/admin/banned', requireAdmin, (req, res) => {
  res.json(bannedIPs);
});

app.post('/api/admin/ban', requireAdmin, (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: 'IP is required.' });
  if (!bannedIPs.includes(ip)) {
    bannedIPs.push(ip);
    persistBannedIPs();
  }
  res.json({ success: true, bannedIPs });
});

app.post('/api/admin/unban', requireAdmin, (req, res) => {
  const { ip } = req.body;
  bannedIPs = bannedIPs.filter(i => i !== ip);
  persistBannedIPs();
  res.json({ success: true, bannedIPs });
});

app.post('/api/admin/ban-discord', requireAdmin, (req, res) => {
  const { discordId } = req.body;
  if (!discordId) return res.status(400).json({ error: 'Discord ID is required.' });
  if (!bannedDiscords.includes(discordId)) {
    bannedDiscords.push(discordId);
    persistBannedDiscords();
  }
  res.json({ success: true });
});

app.post('/api/admin/unban-discord', requireAdmin, (req, res) => {
  const { discordId } = req.body;
  bannedDiscords = bannedDiscords.filter(id => id !== discordId);
  persistBannedDiscords();
  res.json({ success: true });
});

app.post('/api/admin/purge-discord', requireAdmin, (req, res) => {
  const { discordId } = req.body;
  if (!discordId) return res.status(400).json({ error: 'Discord ID is required.' });
  const removed = styles.filter(s => s.discordId === discordId);
  styles = styles.filter(s => s.discordId !== discordId);
  persistStyles();
  removed.forEach(s => broadcast({ type: 'delete_style', id: s.id }));
  res.json({ success: true, deleted: removed.length });
});

app.get('/api/admin/online', requireAdmin, (req, res) => {
  const onlineList = [];
  const seen = new Set();
  for (const [, user] of onlineUsers) {
    if (!seen.has(user.discordId)) {
      seen.add(user.discordId);
      onlineList.push({ discordId: user.discordId, username: user.globalName || user.username, avatar: user.avatar });
    }
  }
  res.json(onlineList);
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const result = Object.entries(users).map(([discordId, data]) => {
    const tabCount = data.tabs ? data.tabs.length : 0;
    const dataSize = JSON.stringify(data).length;
    return { discordId, theme: data.theme || 'default', tabCount, dataSize, updatedAt: data.updatedAt || null };
  });
  const onlineIds = new Set([...onlineUsers.values()].map(u => u.discordId));
  const sessionMap = new Map();
  for (const s of sessions.values()) {
    sessionMap.set(s.discordId, s);
  }
  for (const u of result) {
    const session = sessionMap.get(u.discordId);
    const userData = users[u.discordId] || {};
    u.username = session ? session.globalName || session.username : userData.discordGlobalName || userData.discordUsername || u.discordId;
    u.discordTag = session ? session.username : userData.discordUsername || null;
    u.avatar = session ? session.avatar : userData.discordAvatar || null;
    u.lastIp = userData.lastIp || null;
    u.online = onlineIds.has(u.discordId);
    u.banned = bannedDiscords.includes(u.discordId);
  }
  res.json(result);
});

// --- User Data Routes ---

const USER_DATA_MAX_SIZE = 1024 * 1024; // 1MB per user

app.get('/api/user/data', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Login required.' });
  res.json(users[session.discordId] || {});
});

app.post('/api/user/data', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Login required.' });
  const { theme, tabs, utilsOrder } = req.body;
  const existing = users[session.discordId] || {};
  if (theme !== undefined) existing.theme = theme;
  if (tabs !== undefined) {
    existing.tabs = Array.isArray(tabs) ? tabs.slice(0, 100) : existing.tabs;
  }
  if (utilsOrder !== undefined) {
    existing.utilsOrder = Array.isArray(utilsOrder) ? utilsOrder.slice(0, 50) : existing.utilsOrder;
  }
  // Check size limit
  const size = JSON.stringify(existing).length;
  if (size > USER_DATA_MAX_SIZE) {
    return res.status(413).json({ error: 'Data exceeds 1MB limit. Remove some tabs.' });
  }
  existing.updatedAt = new Date().toISOString();
  users[session.discordId] = existing;
  persistUsers();
  res.json({ success: true });
});

// --- Reaction Route ---

app.post('/api/styles/:id/react', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Login required.' });

  const { type } = req.body;
  if (!type || !['up', 'down', ...ALLOWED_EMOJIS].includes(type)) {
    return res.status(400).json({ error: 'Invalid reaction type.' });
  }

  const style = styles.find(s => s.id === req.params.id);
  if (!style) return res.status(404).json({ error: 'Style not found.' });

  if (!style.reactions) {
    style.reactions = { up: [], down: [], emojis: {} };
  }
  if (!style.reactions.up) style.reactions.up = [];
  if (!style.reactions.down) style.reactions.down = [];
  if (!style.reactions.emojis) style.reactions.emojis = {};

  const uid = session.discordId;

  if (type === 'up' || type === 'down') {
    const opposite = type === 'up' ? 'down' : 'up';
    const idx = style.reactions[type].indexOf(uid);
    if (idx !== -1) {
      style.reactions[type].splice(idx, 1);
    } else {
      style.reactions[type].push(uid);
      const oppIdx = style.reactions[opposite].indexOf(uid);
      if (oppIdx !== -1) style.reactions[opposite].splice(oppIdx, 1);
    }
  } else {
    if (!style.reactions.emojis[type]) style.reactions.emojis[type] = [];
    const arr = style.reactions.emojis[type];
    const idx = arr.indexOf(uid);
    if (idx !== -1) {
      arr.splice(idx, 1);
    } else {
      arr.push(uid);
    }
  }

  persistStyles();

  const publicReactions = getPublicReactions(style.reactions, uid);
  broadcast({ type: 'react_style', id: style.id, reactions: getPublicReactions(style.reactions, null) });
  res.json({ reactions: publicReactions });
});

// --- Share Routes ---

// Create a share link (supports single tab or multiple tabs)
app.post('/api/share', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Login required.' });

  let shareTabs;
  if (req.body.tabs && Array.isArray(req.body.tabs)) {
    // Multi-tab share
    shareTabs = req.body.tabs
      .filter(t => t.rawText && typeof t.rawText === 'string' && t.rawText.trim())
      .slice(0, 100)
      .map(t => ({
        name: (t.name || 'Untitled').slice(0, 60),
        rawText: t.rawText.trim().slice(0, 500),
      }));
  } else if (req.body.rawText && typeof req.body.rawText === 'string') {
    // Single tab share (backwards compat)
    shareTabs = [{
      name: (req.body.name || 'Untitled').slice(0, 60),
      rawText: req.body.rawText.trim().slice(0, 500),
    }];
  }

  if (!shareTabs || shareTabs.length === 0) {
    return res.status(400).json({ error: 'At least one tab with rawText is required.' });
  }

  const id = randomBytes(6).toString('hex');
  shares[id] = {
    tabs: shareTabs,
    discordName: session.globalName || session.username,
    discordAvatar: session.avatar,
    createdAt: new Date().toISOString(),
  };
  persistShares();
  res.json({ id, url: `/share/${id}` });
});

// Get share data
app.get('/api/share/:id', (req, res) => {
  const share = shares[req.params.id];
  if (!share) return res.status(404).json({ error: 'Share not found.' });
  res.json(share);
});

// Strip MC formatting codes for plain text embed
function stripMCFormatting(text) {
  return text
    .replace(/<#[0-9A-Fa-f]{6}>/g, '')
    .replace(/<\/#[0-9A-Fa-f]{6}>/g, '')
    .replace(/[&§][0-9a-fk-or]/gi, '');
}

// SPA fallback with OG meta injection for share links
const indexHtml = readFileSync(join(__dirname, 'dist', 'index.html'), 'utf-8');

app.get('/share/:id', (req, res) => {
  const share = shares[req.params.id];
  if (!share) {
    return res.send(indexHtml);
  }
  // Support both old format (share.rawText) and new format (share.tabs[])
  const tabsList = share.tabs || [{ name: share.name, rawText: share.rawText }];
  const firstName = tabsList[0]?.name || 'Untitled';
  const firstRaw = tabsList[0]?.rawText || '';
  const plainText = stripMCFormatting(firstRaw + 'Steve');
  const title = tabsList.length > 1
    ? `MCStyle - ${firstName} and ${tabsList.length - 1} more`
    : `MCStyle - ${firstName}`;
  const description = `${plainText} — shared by ${share.discordName || 'Anonymous'}`;
  const url = `${DISCORD_REDIRECT_URI}/share/${req.params.id}`;

  // Inject OG meta tags by replacing the defaults in the HTML
  const injected = indexHtml
    .replace(/<meta property="og:title" content="[^"]*"/, `<meta property="og:title" content="${escapeHtml(title)}"`)
    .replace(/<meta property="og:description" content="[^"]*"/, `<meta property="og:description" content="${escapeHtml(description)}"`)
    .replace(/<meta property="og:url" content="[^"]*"/, `<meta property="og:url" content="${escapeHtml(url)}"`);

  res.send(injected);
});

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

app.get('/{*path}', (req, res) => {
  res.send(indexHtml);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`MCStyle server running on port ${PORT}`);
});
