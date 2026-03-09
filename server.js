import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
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

let bannedIPs = loadBannedIPs();

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
  return Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
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

    // Set cookie (30 days)
    res.setHeader('Set-Cookie',
      `mcstyle_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`
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
  const isAdmin = ADMIN_DISCORD_ID && session.discordId === ADMIN_DISCORD_ID;
  res.json({ ...session, isAdmin });
});

app.post('/api/auth/logout', (req, res) => {
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/mcstyle_token=([^;]+)/);
  if (match) sessions.delete(match[1]);
  res.setHeader('Set-Cookie', 'mcstyle_token=; Path=/; HttpOnly; Max-Age=0');
  res.json({ success: true });
});

// --- Public API Routes ---

// Community styles require Discord auth to view
app.get('/api/styles', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Login with Discord to view community styles.' });
  const styles = loadStyles();
  // Strip IPs and private data for public view
  res.json(styles.map(({ ip, discordId, ...rest }) => rest));
});

app.post('/api/styles', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const session = getSession(req);

  if (!session) {
    return res.status(401).json({ error: 'Login with Discord to share styles.' });
  }

  // Check if IP is banned
  if (bannedIPs.includes(ip)) {
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
    createdAt: new Date().toISOString(),
  };

  styles.unshift(newStyle);
  if (styles.length > 500) styles.length = 500;

  saveStyles(styles);

  // Broadcast without private data
  const { ip: _ip, discordId: _did, ...publicStyle } = newStyle;
  broadcast({ type: 'new_style', style: publicStyle });
  res.status(201).json(publicStyle);
});

// --- Admin API Routes ---

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Wrong password.' });
  }
});

// Get all styles with IPs (admin only)
app.get('/api/admin/styles', requireAdmin, (req, res) => {
  const styles = loadStyles();
  res.json(styles);
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

// SPA fallback (Express 5 syntax)
app.get('/{*path}', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`MCStyle server running on port ${PORT}`);
});
