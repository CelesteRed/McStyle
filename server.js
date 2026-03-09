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

// WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1) { // WebSocket.OPEN
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

// Leet/unicode substitution map - normalize text before checking
const LEET_MAP = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
  '@': 'a', '$': 's', '!': 'i', '+': 't', '(': 'c', '|': 'l',
  '\u00e0': 'a', '\u00e1': 'a', '\u00e2': 'a', '\u00e3': 'a', '\u00e4': 'a',
  '\u00e8': 'e', '\u00e9': 'e', '\u00ea': 'e', '\u00eb': 'e',
  '\u00ec': 'i', '\u00ed': 'i', '\u00ee': 'i', '\u00ef': 'i',
  '\u00f2': 'o', '\u00f3': 'o', '\u00f4': 'o', '\u00f5': 'o', '\u00f6': 'o',
  '\u00f9': 'u', '\u00fa': 'u', '\u00fb': 'u', '\u00fc': 'u',
  '\u00ff': 'y', '\u00f1': 'n', '\u00e7': 'c',
  // Small caps and other unicode tricks
  '\u1D00': 'a', '\u0299': 'b', '\u1D04': 'c', '\u1D05': 'd', '\u1D07': 'e',
  '\uA730': 'f', '\u0262': 'g', '\u029C': 'h', '\u026A': 'i', '\u1D0A': 'j',
  '\u1D0B': 'k', '\u029F': 'l', '\u1D0D': 'm', '\u0274': 'n', '\u1D0F': 'o',
  '\u1D18': 'p', '\u01EB': 'q', '\u0280': 'r', '\u1D1B': 't', '\u1D1C': 'u',
  '\u1D20': 'v', '\u1D21': 'w', '\u028F': 'y', '\u1D22': 'z',
};

// Hardcoded slur patterns (normalized form) - catches the root regardless of bypass
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
  // Lowercase
  let normalized = text.toLowerCase();
  // Strip MC format codes
  normalized = normalized.replace(/<#[0-9a-f]{6}>|<\/#[0-9a-f]{6}>|&[0-9a-fk-or]/gi, '');
  // Apply leet/unicode substitutions
  normalized = normalized.split('').map(ch => LEET_MAP[ch] || ch).join('');
  // Strip all non-alphanumeric (spaces, dots, dashes, underscores, special chars)
  normalized = normalized.replace(/[^a-z]/g, '');
  return normalized;
}

function isStrictProfane(text) {
  // Check with bad-words library first (original text)
  if (filter.isProfane(text)) return true;
  // Normalize and check against slur patterns
  const normalized = normalizeText(text);
  for (const pattern of SLUR_PATTERNS) {
    if (normalized.includes(pattern)) return true;
  }
  return false;
}

// Data file path (persisted in Docker volume)
const DATA_DIR = process.env.DATA_DIR || join(__dirname, 'data');
const DATA_FILE = join(DATA_DIR, 'styles.json');

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

// Rate limit: max 5 posts per IP per minute
const rateLimits = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimits.get(ip) || [];
  const recent = entry.filter(t => now - t < 60000);
  if (recent.length >= 5) return false;
  recent.push(now);
  rateLimits.set(ip, recent);
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of rateLimits) {
    const recent = times.filter(t => now - t < 60000);
    if (recent.length === 0) rateLimits.delete(ip);
    else rateLimits.set(ip, recent);
  }
}, 300000);

app.use(express.json());
app.use(express.static(join(__dirname, 'dist')));

// --- API Routes ---

app.get('/api/styles', (req, res) => {
  const styles = loadStyles();
  res.json(styles);
});

app.post('/api/styles', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many submissions. Wait a minute.' });
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
    createdAt: new Date().toISOString(),
  };

  styles.unshift(newStyle);
  if (styles.length > 500) styles.length = 500;

  saveStyles(styles);

  // Broadcast new style to all connected clients
  broadcast({ type: 'new_style', style: newStyle });

  res.status(201).json(newStyle);
});

// SPA fallback (Express 5 syntax)
app.get('/{*path}', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`MCStyle server running on port ${PORT}`);
});
