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

// In-memory session store: token -> { discordId, username, discriminator, avatar, globalName }
const sessions = new Map();

// WebSocket server
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

// Profanity filter - strict with bypass detection
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

// Data file paths (persisted in Docker volume)
const DATA_DIR = process.env.DATA_DIR || join(__dirname, 'data');
const DATA_FILE = join(DATA_DIR, 'styles.json');
const BANNED_FILE = join(DATA_DIR, 'banned_ips.json');
const BANNED_DISCORD_FILE = join(DATA_DIR, 'banned_discord.json');
const USERS_FILE = join(DATA_DIR, 'users.json');

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

function loadStyles() {
  if (!existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveStyles(styles) {
  writeFileSync(DATA_FILE, JSON.stringify(styles, null, 2));
}

function loadBannedIPs() {
  if (!existsSync(BANNED_FILE)) return [];
  try {
    return JSON.parse(readFileSync(BANNED_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveBannedIPs(ips) {
  writeFileSync(BANNED_FILE, JSON.stringify(ips, null, 2));
}

function loadBannedDiscords() {
  if (!existsSync(BANNED_DISCORD_FILE)) return [];
  try {
    return JSON.parse(readFileSync(BANNED_DISCORD_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveBannedDiscords(ids) {
  writeFileSync(BANNED_DISCORD_FILE, JSON.stringify(ids, null, 2));
}

function loadUsers() {
  if (!existsSync(USERS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(USERS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveUsers(users) {
  writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

const ALLOWED_EMOJIS = ['🔥', '❤️', '😂', '🎨'];

// Convert raw reactions (with discordId arrays) to public counts
function getPublicReactions(reactions, sessionDiscordId) {
  if (!reactions) {
    const result = { up: 0, down: 0, emojis: {}, userVote: null, userEmojis: [] };
    return result;
  }
  const up = (reactions.up || []).length;
  const down = (reactions.down || []).length;
  const emojis = {};
  for (const [emoji, users] of Object.entries(reactions.emojis || {})) {
    if (users.length > 0) emojis[emoji] = users.length;
  }
  let userVote = null;
  let userEmojis = [];
  if (sessionDiscordId) {
    if ((reactions.up || []).includes(sessionDiscordId)) userVote = 'up';
    else if ((reactions.down || []).includes(sessionDiscordId)) userVote = 'down';
    for (const [emoji, users] of Object.entries(reactions.emojis || {})) {
      if (users.includes(sessionDiscordId)) userEmojis.push(emoji);
    }
  }
  return { up, down, emojis, userVote, userEmojis };
}

let bannedIPs = loadBannedIPs();
let bannedDiscords = loadBannedDiscords();

function getClientIP(req) {
  let ip = getClientIP(req) || '';
  if (ip.includes(',')) ip = ip.split(',')[0].trim();
  // Strip IPv6-mapped IPv4 prefix (::ffff:1.2.3.4 -> 1.2.3.4)
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

// Rate limit: max 5 posts per IP per minute + 5 second cooldown between posts
const rateLimits = new Map();
const lastPostTime = new Map();

function checkRateLimit(ip) {
  const now = Date.now();

  // 5 second cooldown
  const lastTime = lastPostTime.get(ip) || 0;
  if (now - lastTime < 5000) {
    return { allowed: false, reason: 'Please wait 5 seconds between submissions.' };
  }

  // Max 5 per minute
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
  // Clean old lastPostTime entries
  for (const [ip, time] of lastPostTime) {
    if (now - time > 60000) lastPostTime.delete(ip);
  }
}, 300000);

// Admin auth middleware - password OR Discord admin ID
function requireAdmin(req, res, next) {
  const auth = req.headers['x-admin-password'];
  if (auth === ADMIN_PASSWORD) return next();

  // Check if logged-in Discord user is the admin
  const session = getSession(req);
  if (session && ADMIN_DISCORD_ID && session.discordId === ADMIN_DISCORD_ID) return next();

  return res.status(401).json({ error: 'Unauthorized.' });
}

app.use(express.json());
app.use(express.static(join(__dirname, 'dist')));

// Parse session token from cookie
function getSession(req) {
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/mcstyle_token=([^;]+)/);
  if (!match) return null;
  return sessions.get(match[1]) || null;
}

function generateToken() {
  return randomBytes(32).toString('hex');
}

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
    // Exchange code for token
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

    // Get user info
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userRes.json();
    if (!userData.id) {
      return res.status(400).json({ error: 'Failed to get Discord user info.' });
    }

    const user = {
      discordId: userData.id,
      username: userData.username,
      globalName: userData.global_name || userData.username,
      avatar: userData.avatar
        ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
        : null,
    };

    // Create session
    const token = generateToken();
    sessions.set(token, user);

    // Persist profile info so admin panel can always show it
    const loginIp = getClientIP(req);
    const users = loadUsers();
    const existing = users[user.discordId] || {};
    existing.discordUsername = user.username;
    existing.discordGlobalName = user.globalName;
    existing.discordAvatar = user.avatar;
    existing.lastIp = loginIp;
    users[user.discordId] = existing;
    saveUsers(users);

    // Set cookie (30 days)
    res.setHeader('Set-Cookie',
      `mcstyle_token=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${30 * 24 * 60 * 60}`
    );
    res.json({ user });
  } catch (err) {
    console.error('Discord OAuth error:', err);
    res.status(500).json({ error: 'Discord authentication failed.' });
  }
});

app.get('/api/auth/me', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json(null);
  const isAdmin = !!(ADMIN_DISCORD_ID && session.discordId === ADMIN_DISCORD_ID);
  res.json({ ...session, isAdmin });
});

app.post('/api/auth/logout', (req, res) => {
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/mcstyle_token=([^;]+)/);
  if (match) sessions.delete(match[1]);
  res.setHeader('Set-Cookie', 'mcstyle_token=; Path=/; HttpOnly; Max-Age=0');
  res.json({ success: true });
});

app.post('/api/auth/clear-data', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });
  const styles = loadStyles();
  const filtered = styles.filter(s => s.discordId !== session.discordId);
  saveStyles(filtered);
  // Broadcast deletions so other clients see the removal
  const removed = styles.filter(s => s.discordId === session.discordId);
  removed.forEach(s => broadcast({ type: 'delete_style', id: s.id }));
  res.json({ success: true, deleted: removed.length });
});

// --- Public API Routes ---

// Community styles require Discord auth to view
app.get('/api/styles', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Login with Discord to view community styles.' });
  const styles = loadStyles();
  // Strip IPs and private data for public view, add public reactions
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

  // Check if IP or Discord is banned
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

  const styles = loadStyles();

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

  saveStyles(styles);

  // Broadcast without private data
  const { ip: _ip, discordId: _did, ...publicStyle } = newStyle;
  const publicStyleWithReactions = { ...publicStyle, reactions: getPublicReactions(null, null) };
  broadcast({ type: 'new_style', style: publicStyleWithReactions });
  res.status(201).json(publicStyleWithReactions);
});

// --- Admin API Routes ---

const adminLoginAttempts = new Map(); // ip -> { count, resetAt }

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

// Get all styles with IPs (admin only)
app.get('/api/admin/styles', requireAdmin, (req, res) => {
  const styles = loadStyles();
  const session = getSession(req);
  res.json(styles.map(style => ({
    ...style,
    reactions: getPublicReactions(style.reactions, session ? session.discordId : null),
  })));
});

// Delete a style by ID
app.delete('/api/admin/styles/:id', requireAdmin, (req, res) => {
  const styles = loadStyles();
  const filtered = styles.filter(s => s.id !== req.params.id);
  if (filtered.length === styles.length) {
    return res.status(404).json({ error: 'Style not found.' });
  }
  saveStyles(filtered);
  broadcast({ type: 'delete_style', id: req.params.id });
  res.json({ success: true });
});

// Get banned IPs
app.get('/api/admin/banned', requireAdmin, (req, res) => {
  res.json(bannedIPs);
});

// Ban an IP
app.post('/api/admin/ban', requireAdmin, (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: 'IP is required.' });
  if (!bannedIPs.includes(ip)) {
    bannedIPs.push(ip);
    saveBannedIPs(bannedIPs);
  }
  res.json({ success: true, bannedIPs });
});

// Unban an IP
app.post('/api/admin/unban', requireAdmin, (req, res) => {
  const { ip } = req.body;
  bannedIPs = bannedIPs.filter(i => i !== ip);
  saveBannedIPs(bannedIPs);
  res.json({ success: true, bannedIPs });
});

// Ban a Discord user
app.post('/api/admin/ban-discord', requireAdmin, (req, res) => {
  const { discordId } = req.body;
  if (!discordId) return res.status(400).json({ error: 'Discord ID is required.' });
  if (!bannedDiscords.includes(discordId)) {
    bannedDiscords.push(discordId);
    saveBannedDiscords(bannedDiscords);
  }
  res.json({ success: true });
});

// Unban a Discord user
app.post('/api/admin/unban-discord', requireAdmin, (req, res) => {
  const { discordId } = req.body;
  bannedDiscords = bannedDiscords.filter(id => id !== discordId);
  saveBannedDiscords(bannedDiscords);
  res.json({ success: true });
});

// Purge all styles from a Discord user
app.post('/api/admin/purge-discord', requireAdmin, (req, res) => {
  const { discordId } = req.body;
  if (!discordId) return res.status(400).json({ error: 'Discord ID is required.' });
  const styles = loadStyles();
  const removed = styles.filter(s => s.discordId === discordId);
  const kept = styles.filter(s => s.discordId !== discordId);
  saveStyles(kept);
  removed.forEach(s => broadcast({ type: 'delete_style', id: s.id }));
  res.json({ success: true, deleted: removed.length });
});

// Admin: list online users
app.get('/api/admin/online', requireAdmin, (req, res) => {
  const users = [];
  const seen = new Set();
  for (const [, user] of onlineUsers) {
    if (!seen.has(user.discordId)) {
      seen.add(user.discordId);
      users.push({ discordId: user.discordId, username: user.globalName || user.username, avatar: user.avatar });
    }
  }
  res.json(users);
});

// Admin: list all registered users with storage info
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = loadUsers();
  const result = Object.entries(users).map(([discordId, data]) => {
    const tabCount = data.tabs ? data.tabs.length : 0;
    const dataSize = JSON.stringify(data).length;
    return {
      discordId,
      theme: data.theme || 'default',
      tabCount,
      dataSize,
      updatedAt: data.updatedAt || null,
    };
  });
  // Enrich with online status and username from active sessions
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

app.get('/api/user/data', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Login required.' });
  const users = loadUsers();
  res.json(users[session.discordId] || {});
});

app.post('/api/user/data', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Login required.' });
  const { theme, tabs } = req.body;
  const users = loadUsers();
  const existing = users[session.discordId] || {};
  if (theme !== undefined) existing.theme = theme;
  if (tabs !== undefined) {
    existing.tabs = Array.isArray(tabs) ? tabs.slice(0, 100) : existing.tabs;
  }
  existing.updatedAt = new Date().toISOString();
  users[session.discordId] = existing;
  saveUsers(users);
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

  const styles = loadStyles();
  const style = styles.find(s => s.id === req.params.id);
  if (!style) return res.status(404).json({ error: 'Style not found.' });

  // Initialize reactions if missing
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
      // Toggle off
      style.reactions[type].splice(idx, 1);
    } else {
      // Add vote, remove opposite
      style.reactions[type].push(uid);
      const oppIdx = style.reactions[opposite].indexOf(uid);
      if (oppIdx !== -1) style.reactions[opposite].splice(oppIdx, 1);
    }
  } else {
    // Emoji reaction
    if (!style.reactions.emojis[type]) style.reactions.emojis[type] = [];
    const arr = style.reactions.emojis[type];
    const idx = arr.indexOf(uid);
    if (idx !== -1) {
      arr.splice(idx, 1);
    } else {
      arr.push(uid);
    }
  }

  saveStyles(styles);

  const publicReactions = getPublicReactions(style.reactions, uid);
  broadcast({ type: 'react_style', id: style.id, reactions: getPublicReactions(style.reactions, null) });
  res.json({ reactions: publicReactions });
});

// SPA fallback (Express 5 syntax)
app.get('/{*path}', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`MCStyle server running on port ${PORT}`);
});
