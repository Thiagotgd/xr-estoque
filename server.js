'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';

const PORT = 8087;
const SECRET_PATH = '/xr-esto-r9k1';
const DB_PATH = path.join(__dirname, 'estoque.db');

// ─── Database setup ────────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  estoque_minimo INTEGER DEFAULT 0,
  estoque_atual INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS codigos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT UNIQUE NOT NULL,
  produto_id INTEGER REFERENCES produtos(id) ON DELETE CASCADE,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS movimentacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER REFERENCES produtos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK(tipo IN ('entrada','saida')),
  quantidade INTEGER NOT NULL,
  obs TEXT DEFAULT '',
  data TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
`);

// Add pedido_em column if missing
try { db.exec(`ALTER TABLE produtos ADD COLUMN pedido_em TEXT DEFAULT NULL`); } catch(e) {}

// ─── Cotações tables ──────────────────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS fornecedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS notas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fornecedor_id INTEGER REFERENCES fornecedores(id) ON DELETE CASCADE,
  numero TEXT DEFAULT '',
  data TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS nota_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nota_id INTEGER REFERENCES notas(id) ON DELETE CASCADE,
  produto_id INTEGER REFERENCES produtos(id) ON DELETE SET NULL,
  descricao TEXT NOT NULL,
  quantidade REAL NOT NULL,
  preco_unitario REAL NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
`);

// ─── Seed products ─────────────────────────────────────────────────────────────
const PRODUTOS_INICIAIS = [
  {nome:"Cateter 14",min:50},{nome:"Cateter 16",min:0},{nome:"Cateter 20 rosa",min:50},
  {nome:"Cateter 22 azul",min:50},{nome:"Cateter 24 amarela",min:50},{nome:"Equipo macro",min:10},
  {nome:"PRN",min:100},{nome:"Torneira de 3 vias",min:50},{nome:"Extensor 120",min:5},
  {nome:"Extensor 60",min:5},{nome:"Extensor 40",min:5},{nome:"Agulha 25x7 cinza",min:50},
  {nome:"Agulha 30x8 verde",min:50},{nome:"Agulha 40x12 rosa",min:50},{nome:"Agulha insulina",min:50},
  {nome:"Scalp 19 amarela",min:2},{nome:"Scalp 23 azul",min:10},{nome:"Seringa 1ml",min:50},
  {nome:"Seringa 3ml",min:50},{nome:"Seringa 5ml",min:50},{nome:"Seringa 10ml",min:50},
  {nome:"Seringa 20ml",min:50},{nome:"Soro 0,9% 100ml",min:0},{nome:"Soro 0,9% 250ml",min:5},
  {nome:"Soro 0,9% 500ml",min:5},{nome:"Soro 0,9% 1000ml",min:0},{nome:"Soro RL 1000ml",min:6},
  {nome:"Soro RL 500ml",min:6},{nome:"Luva procedimento M",min:1},{nome:"Alcool 70%",min:1},
  {nome:"Agua oxigenada",min:1},{nome:"Clorexidine 1l",min:1},{nome:"Esparadrapo",min:5},
  {nome:"Atadura",min:5},{nome:"Vetrap",min:1},{nome:"Algodao",min:2},{nome:"Gel US 5L",min:1},
  {nome:"Tapete higienico",min:5},{nome:"Isoflurano 100ml",min:0},{nome:"Isoflurano 240ml",min:4},
  {nome:"Dobutamina",min:3},{nome:"Norepinefrina 1mg/ml",min:2},{nome:"Heparina sodica 5000UI",min:8},
  {nome:"Morfina 10mg/ml",min:10},{nome:"Xilazina 10% 50ml",min:0},{nome:"Detomidina 1% 10ml",min:2},
  {nome:"Cetamina 10% 50ml",min:1},{nome:"Midazolam",min:15},{nome:"Lidocaina s/ vaso 20ml",min:10},
  {nome:"Fentanil",min:10},{nome:"Metadona",min:12},{nome:"Dexmedetomidina",min:10},
  {nome:"Propofol",min:20},{nome:"Remifentanil",min:10},{nome:"Glicose",min:5},{nome:"Manitol",min:2},
  {nome:"Sucralfate",min:1},{nome:"Furosemida",min:5},{nome:"Ondansetrona",min:30},
  {nome:"Dipirona",min:1},{nome:"Flumazenil",min:1},{nome:"Naloxona",min:1},{nome:"Ioimbina",min:1},
  {nome:"Adrenalina",min:5},{nome:"Atropina",min:5},{nome:"Dexametazona",min:1},
  {nome:"Calsodada",min:1},{nome:"Contraste tomografia",min:10},{nome:"Dotarem",min:1},
  {nome:"Sonda uretral 20 cavalo",min:3},{nome:"Sonda uretral 18 cavalo",min:3},
  {nome:"Sonda uretral 10",min:5},{nome:"Sonda uretral 8",min:5},{nome:"Sonda uretral 4",min:5},
  {nome:"Gaze",min:1},{nome:"Chem 10",min:1},{nome:"Luva procedimento P",min:1},
  {nome:"Fita Glicose",min:1},{nome:"Gadovist",min:0},{nome:"Emedron",min:1},
  {nome:"Hidrocortisona 500mg",min:2},{nome:"Panelinha Idexx",min:1},
  {nome:"Leucoprotetor Idexx",min:1},{nome:"Reagente Idexx",min:1}
];

const count = db.prepare('SELECT COUNT(*) as c FROM produtos').get();
if (count.c === 0) {
  const insert = db.prepare('INSERT INTO produtos (nome, estoque_minimo) VALUES (?, ?)');
  const insertMany = db.transaction((items) => {
    for (const p of items) insert.run(p.nome, p.min);
  });
  insertMany(PRODUTOS_INICIAIS);
  console.log(`Seeded ${PRODUTOS_INICIAIS.length} products`);
}

// ─── Code128B barcode SVG ───────────────────────────────────────────────────────
const CODE128B_CHARS = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';

const CODE128_PATTERNS = [
  '11011001100','11001101100','11001100110','10010011000','10010001100',
  '10001001100','10011001000','10011000100','10001100100','11001001000',
  '11001000100','11000100100','10110011100','10011011100','10011001110',
  '10111001100','10011101100','10011100110','11001110010','11001011100',
  '11001001110','11011100100','11001110100','11101101110','11101001100',
  '11100101100','11100100110','11101100100','11100110100','11100110010',
  '11011011000','11011000110','11000110110','10100011000','10001011000',
  '10001000110','10110001000','10001101000','10001100010','11010001000',
  '11000101000','11000100010','10110111000','10110001110','10001101110',
  '10111011000','10111000110','10001110110','11101110110','11010001110',
  '11000101110','11011101000','11011100010','11011101110','11101011000',
  '11101000110','11100010110','11101101000','11101100010','11100011010',
  '11101111010','11001000010','11110001010','10100110000','10100001100',
  '10010110000','10010000110','10000101100','10000100110','10110010000',
  '10110000100','10011010000','10011000010','10000110100','10000110010',
  '11000010010','11001010000','11110111010','11000010100','10001111010',
  '10100111100','10010111100','10010011110','10111100100','10011110100',
  '10011110010','11110100100','11110010100','11110010010','11011011110',
  '11011110110','11110110110','10101111000','10100011110','10001011110',
  '10111101000','10111100010','11110101000','11110100010','10111011110',
  '10111101110','11101011110','11110101110','11010000100','11010010000',
  '11010011100','1100011101011'  // stop pattern (index 106)
];

const START_B = 104;
const STOP = 106;

function encodeCode128B(text) {
  const codes = [START_B];
  let checksum = START_B;
  for (let i = 0; i < text.length; i++) {
    const idx = CODE128B_CHARS.indexOf(text[i]);
    if (idx === -1) throw new Error(`Char not in Code128B: ${text[i]}`);
    codes.push(idx);
    checksum += (i + 1) * idx;
  }
  codes.push(checksum % 103);
  codes.push(STOP);
  return codes;
}

function generateBarcodeSVG(text) {
  const codes = encodeCode128B(text);
  let barString = '';
  for (const c of codes) {
    barString += CODE128_PATTERNS[c] || '';
  }
  barString += '11'; // termination bar

  const barWidth = 2;
  const barHeight = 60;
  const marginX = 10;
  const marginTop = 5;
  const textHeight = 16;
  const totalWidth = barString.length * barWidth + marginX * 2;
  const totalHeight = barHeight + marginTop + textHeight + 5;

  let bars = '';
  let x = marginX;
  for (let i = 0; i < barString.length; i++) {
    if (barString[i] === '1') {
      bars += `<rect x="${x}" y="${marginTop}" width="${barWidth}" height="${barHeight}" fill="black"/>`;
    }
    x += barWidth;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}">
  <rect width="${totalWidth}" height="${totalHeight}" fill="white"/>
  ${bars}
  <text x="${totalWidth / 2}" y="${marginTop + barHeight + textHeight}" text-anchor="middle" font-family="monospace" font-size="12" fill="black">${text}</text>
</svg>`;
}

// ─── Next XR code ──────────────────────────────────────────────────────────────
function nextXRCode() {
  const row = db.prepare(`SELECT codigo FROM codigos WHERE codigo LIKE 'XR-%' ORDER BY id DESC LIMIT 1`).get();
  if (!row) return 'XR-00001';
  const num = parseInt(row.codigo.replace('XR-', ''), 10);
  return 'XR-' + String(num + 1).padStart(5, '0');
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function parseBody(req) {
  if (req._body) return Promise.resolve(req._body);
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(data || '{}');
        req._body = parsed;
        resolve(parsed);
      }
      catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie || '';
  header.split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) cookies[k.trim()] = v.join('=').trim();
  });
  return cookies;
}

function isAuthed(req) {
  const cookies = parseCookies(req);
  return !!cookies['xr_session'];
}

async function getUserRole(req) {
  // Ask auth server directly using the user's session cookie
  const cookies = parseCookies(req);
  const token = cookies['xr_session'];
  if (!token) return 'viewer';
  try {
    const resp = await new Promise((resolve, reject) => {
      const options = { hostname: '127.0.0.1', port: 8086, path: '/auth/role', method: 'GET',
        headers: { 'Cookie': `xr_session=${token}` } };
      const r = require('http').request(options, res => {
        let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
      });
      r.on('error', reject); r.end();
    });
    const data = JSON.parse(resp);
    return (data.role || 'viewer').toLowerCase();
  } catch(e) { return 'viewer'; }
}

async function isAdmin(req) {
  const role = await getUserRole(req);
  return role === 'admin';
}
// operator and viewer both have restricted access (no entrada, no produtos mgmt)

function parseURL(urlStr) {
  try { return new URL(urlStr, 'http://localhost'); }
  catch { return null; }
}

// ─── AI Invoice extraction ────────────────────────────────────────────────────
function httpsPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, data: d }));
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(JSON.stringify(body));
    req.end();
  });
}

const NOTA_PROMPT = `Você é um OCR especializado em notas fiscais brasileiras de produtos veterinários/médicos.

Extraia os dados desta nota fiscal / cupom de compra. Leia com EXTREMO cuidado cada item, quantidade e valor.

Retorne APENAS um JSON válido neste formato exato:
{
  "fornecedor": "nome do fornecedor/loja EXATAMENTE como escrito",
  "numero": "número da nota (ou vazio)",
  "data": "DD/MM/YYYY",
  "itens": [
    { "descricao": "nome do item", "quantidade": 1, "preco_unitario": 10.50 }
  ]
}

Regras IMPORTANTES:
- Leia CADA caractere da nota com cuidado. Não invente dados.
- descricao: copie o nome do produto EXATAMENTE como está na nota
- quantidade: o número na coluna QTD/QUANT. Geralmente é inteiro (1, 2, 5, 10...)
- preco_unitario: SEMPRE o preço de UMA ÚNICA UNIDADE. Procure a coluna VL.UNIT, UNIT, V.UNIT, UNITÁRIO.
  * Se a nota só mostra o VALOR TOTAL do item, DIVIDA pelo quantidade para obter o unitário.
  * Exemplo: se qtd=5 e total=50.00, preco_unitario=10.00 (NÃO 50.00)
  * NUNCA coloque o valor total da linha como preco_unitario
- NÃO invente itens que não existem na nota
- Se um campo está ilegível, use "" ou 0
- data no formato DD/MM/YYYY
- Retorne SOMENTE o JSON, nada mais`;

async function extractInvoiceFromImage(base64Image, mimeType) {
  console.log(`[COTACAO] Extraindo nota, imagem: ${Math.round(base64Image.length/1024)}KB, mime: ${mimeType}`);

  // Attempt 1: Groq (free)
  try {
    const resp = await httpsPost('https://api.groq.com/openai/v1/chat/completions', {
      'Authorization': `Bearer ${GROQ_API_KEY}`
    }, {
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      max_tokens: 2048,
      temperature: 0,
      messages: [
        { role: 'system', content: 'Responda APENAS com JSON válido. Sem explicações.' },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
          { type: 'text', text: NOTA_PROMPT }
        ]}
      ]
    });
    console.log(`[COTACAO] Groq status: ${resp.status}`);
    if (resp.status === 200) {
      const parsed = JSON.parse(resp.data);
      const content = parsed.choices?.[0]?.message?.content || '';
      console.log(`[COTACAO] Groq raw: ${content.substring(0, 200)}`);
      const json = content.replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const result = JSON.parse(json);
      if (result.itens && result.itens.length > 0) {
        console.log(`[COTACAO] Groq OK: ${result.itens.length} itens`);
        return result;
      }
    } else {
      console.log(`[COTACAO] Groq error response: ${resp.data.substring(0, 300)}`);
    }
  } catch(e) { console.error('[COTACAO] Groq error:', e.message); }

  // Attempt 2: Gemini Flash (fallback)
  console.log('[COTACAO] Trying Gemini Flash fallback...');
  try {
    const resp = await httpsPost(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`, {}, {
      contents: [{ parts: [
        { inlineData: { mimeType, data: base64Image } },
        { text: NOTA_PROMPT }
      ]}],
      generationConfig: { temperature: 0, maxOutputTokens: 2048 }
    });
    console.log(`[COTACAO] Gemini status: ${resp.status}`);
    if (resp.status === 200) {
      const parsed = JSON.parse(resp.data);
      const content = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
      console.log(`[COTACAO] Gemini raw: ${content.substring(0, 200)}`);
      const json = content.replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const result = JSON.parse(json);
      console.log(`[COTACAO] Gemini OK: ${result.itens?.length || 0} itens`);
      return result;
    } else {
      console.log(`[COTACAO] Gemini error response: ${resp.data.substring(0, 300)}`);
    }
  } catch(e) { console.error('[COTACAO] Gemini error:', e.message); }

  console.log('[COTACAO] Ambos falharam');
  return null;
}

// Parse raw body for multipart or large JSON
function parseRawBody(req, maxSize = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => { size += c.length; if (size > maxSize) { req.destroy(); reject(new Error('Body too large')); } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ─── API Router ────────────────────────────────────────────────────────────────
async function handleAPI(req, res, pathname, query) {
  const method = req.method;

  // GET /api/me — user role
  if (method === 'GET' && pathname === '/api/me') {
    const role = await getUserRole(req);
    return sendJSON(res, 200, { role });
  }

  // Admin-only routes
  const adminRoutes = [
    [/^\/api\/produto$/, 'POST'],
    [/^\/api\/produto\/\d+$/, 'PUT'],
    [/^\/api\/produto\/\d+$/, 'DELETE'],
    [/^\/api\/bipe$/, 'POST'],
    [/^\/api\/etiqueta\/\d+$/, 'POST'],
    [/^\/api\/movimentacao$/, 'POST', (b) => b.tipo === 'entrada'], // só entrada é admin
  ];
  for (const [pattern, meth, check] of adminRoutes) {
    if (method === meth && pattern.test(pathname)) {
      if (check) {
        const body = await parseBody(req);
        req._body = body;
        if (check(body) && !isAdmin(req)) return sendJSON(res, 403, { error: 'Acesso restrito ao admin' });
      } else if (!isAdmin(req)) {
        return sendJSON(res, 403, { error: 'Acesso restrito ao admin' });
      }
    }
  }

  // GET /api/produtos
  if (method === 'GET' && pathname === '/api/produtos') {
    const rows = db.prepare(`
      SELECT p.*, 
        CASE WHEN p.estoque_minimo > 0 AND p.estoque_atual < p.estoque_minimo THEN 1 ELSE 0 END as alerta
      FROM produtos p ORDER BY p.nome COLLATE NOCASE
    `).all();
    return sendJSON(res, 200, rows);
  }

  // GET /api/produto/:id
  if (method === 'GET' && pathname.match(/^\/api\/produto\/\d+$/)) {
    const id = pathname.split('/')[3];
    const row = db.prepare('SELECT * FROM produtos WHERE id = ?').get(id);
    if (!row) return sendJSON(res, 404, { error: 'Not found' });
    return sendJSON(res, 200, row);
  }

  // POST /api/produto
  if (method === 'POST' && pathname === '/api/produto') {
    const body = await parseBody(req);
    if (!body.nome) return sendJSON(res, 400, { error: 'nome required' });
    const r = db.prepare('INSERT INTO produtos (nome, estoque_minimo) VALUES (?, ?)').run(
      body.nome.trim(), body.estoque_minimo ?? 0
    );
    return sendJSON(res, 201, { id: r.lastInsertRowid });
  }

  // PUT /api/produto/:id
  if (method === 'PUT' && pathname.match(/^\/api\/produto\/\d+$/)) {
    const id = pathname.split('/')[3];
    const body = await parseBody(req);
    const existing = db.prepare('SELECT * FROM produtos WHERE id = ?').get(id);
    if (!existing) return sendJSON(res, 404, { error: 'Not found' });
    const nome = body.nome !== undefined ? body.nome.trim() : existing.nome;
    const min = body.estoque_minimo !== undefined ? body.estoque_minimo : existing.estoque_minimo;
    const atual = body.estoque_atual !== undefined ? body.estoque_atual : existing.estoque_atual;
    const qtdCompra = parseInt(body.qtd_compra || 0, 10);
    db.prepare('UPDATE produtos SET nome=?, estoque_minimo=?, estoque_atual=?, qtd_compra=? WHERE id=?').run(nome, min, atual, qtdCompra, id);
    return sendJSON(res, 200, { ok: true });
  }

  // DELETE /api/produto/:id
  if (method === 'DELETE' && pathname.match(/^\/api\/produto\/\d+$/)) {
    const id = pathname.split('/')[3];
    db.prepare('DELETE FROM produtos WHERE id = ?').run(id);
    return sendJSON(res, 200, { ok: true });
  }

  // GET /api/bipe/:codigo
  if (method === 'GET' && pathname.match(/^\/api\/bipe\/.+$/)) {
    const codigo = decodeURIComponent(pathname.slice('/api/bipe/'.length));
    const row = db.prepare(`
      SELECT p.* FROM codigos c
      JOIN produtos p ON p.id = c.produto_id
      WHERE c.codigo = ?
    `).get(codigo);
    if (!row) return sendJSON(res, 200, { novo: true, codigo });
    const alerta = row.estoque_minimo > 0 && row.estoque_atual < row.estoque_minimo;
    return sendJSON(res, 200, { produto: { ...row, alerta } });
  }

  // GET /api/codigos/:produto_id
  if (method === 'GET' && pathname.match(/^\/api\/codigos\/\d+$/)) {
    const id = pathname.split('/')[3];
    const rows = db.prepare('SELECT * FROM codigos WHERE produto_id = ? ORDER BY created_at DESC').all(id);
    return sendJSON(res, 200, rows);
  }

  // DELETE /api/codigo/:id
  if (method === 'DELETE' && pathname.match(/^\/api\/codigo\/\d+$/)) {
    const id = pathname.split('/')[3];
    db.prepare('DELETE FROM codigos WHERE id = ?').run(id);
    return sendJSON(res, 200, { ok: true });
  }

  // POST /api/bipe
  if (method === 'POST' && pathname === '/api/bipe') {
    const body = await parseBody(req);
    if (!body.codigo || !body.produto_id) return sendJSON(res, 400, { error: 'codigo and produto_id required' });
    try {
      if (body.force) {
        db.prepare('INSERT OR REPLACE INTO codigos (codigo, produto_id) VALUES (?, ?)').run(body.codigo, body.produto_id);
      } else {
        db.prepare('INSERT INTO codigos (codigo, produto_id) VALUES (?, ?)').run(body.codigo, body.produto_id);
      }
      return sendJSON(res, 201, { ok: true });
    } catch (e) {
      return sendJSON(res, 409, { error: 'Código já existe' });
    }
  }

  // POST /api/movimentacao
  if (method === 'POST' && pathname === '/api/movimentacao') {
    const body = await parseBody(req);
    const { produto_id, tipo, quantidade, obs } = body;
    if (!produto_id || !tipo || !quantidade) return sendJSON(res, 400, { error: 'produto_id, tipo, quantidade required' });
    if (!['entrada', 'saida'].includes(tipo)) return sendJSON(res, 400, { error: 'tipo must be entrada or saida' });
    const qty = parseInt(quantidade, 10);
    if (isNaN(qty) || qty <= 0) return sendJSON(res, 400, { error: 'quantidade must be positive integer' });

    const now = new Date();
    const data = now.toISOString().slice(0, 10);

    const updateTx = db.transaction(() => {
      db.prepare('INSERT INTO movimentacoes (produto_id, tipo, quantidade, obs, data) VALUES (?, ?, ?, ?, ?)').run(
        produto_id, tipo, qty, obs || '', data
      );
      if (tipo === 'entrada') {
        db.prepare('UPDATE produtos SET estoque_atual = estoque_atual + ? WHERE id = ?').run(qty, produto_id);
      } else {
        db.prepare('UPDATE produtos SET estoque_atual = MAX(0, estoque_atual - ?) WHERE id = ?').run(qty, produto_id);
      }
    });
    updateTx();

    const updated = db.prepare('SELECT * FROM produtos WHERE id = ?').get(produto_id);
    const alerta = tipo === 'saida' && updated.estoque_minimo > 0 && updated.estoque_atual < updated.estoque_minimo;
    return sendJSON(res, 201, {
      ok: true,
      estoque_atual: updated.estoque_atual,
      nome: updated.nome,
      alerta_reposicao: alerta,
      estoque_minimo: updated.estoque_minimo
    });
  }

  // GET /api/movimentacoes
  if (method === 'GET' && pathname === '/api/movimentacoes') {
    const produto_id = query.get('produto_id');
    const tipo = query.get('tipo');
    const search = query.get('search') || '';
    const limit = parseInt(query.get('limit') || '100', 10);
    const offset = parseInt(query.get('offset') || '0', 10);
    let where = '1=1';
    const params = [];
    if (produto_id) { where += ' AND m.produto_id = ?'; params.push(produto_id); }
    if (tipo) { where += ' AND m.tipo = ?'; params.push(tipo); }
    if (search) { where += ' AND p.nome LIKE ?'; params.push('%' + search + '%'); }
    const total = db.prepare(`SELECT COUNT(*) as n FROM movimentacoes m JOIN produtos p ON p.id = m.produto_id WHERE ${where}`).get(...params).n;
    const rows = db.prepare(`SELECT m.*, p.nome as produto_nome FROM movimentacoes m JOIN produtos p ON p.id = m.produto_id WHERE ${where} ORDER BY m.id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    return sendJSON(res, 200, { total, rows });
  }

  // PUT /api/movimentacao/:id — admin only
  if (method === 'PUT' && pathname.match(/^\/api\/movimentacao\/\d+$/)) {
    if (!await isAdmin(req)) return sendJSON(res, 403, { error: 'Admin only' });
    const id = parseInt(pathname.split('/').pop(), 10);
    const body = await parseBody(req);
    const mov = db.prepare('SELECT * FROM movimentacoes WHERE id = ?').get(id);
    if (!mov) return sendJSON(res, 404, { error: 'Não encontrado' });
    const novoTipo = body.tipo || mov.tipo;
    const novaQty = parseInt(body.quantidade, 10) || mov.quantidade;
    const novaObs = body.obs !== undefined ? body.obs : mov.obs;
    // Revert old, apply new to produto estoque
    db.transaction(() => {
      // Revert old mov
      if (mov.tipo === 'entrada') db.prepare('UPDATE produtos SET estoque_atual = estoque_atual - ? WHERE id = ?').run(mov.quantidade, mov.produto_id);
      else db.prepare('UPDATE produtos SET estoque_atual = estoque_atual + ? WHERE id = ?').run(mov.quantidade, mov.produto_id);
      // Apply new
      if (novoTipo === 'entrada') db.prepare('UPDATE produtos SET estoque_atual = estoque_atual + ? WHERE id = ?').run(novaQty, mov.produto_id);
      else db.prepare('UPDATE produtos SET estoque_atual = MAX(0, estoque_atual - ?) WHERE id = ?').run(novaQty, mov.produto_id);
      db.prepare('UPDATE movimentacoes SET tipo = ?, quantidade = ?, obs = ? WHERE id = ?').run(novoTipo, novaQty, novaObs, id);
    })();
    return sendJSON(res, 200, { ok: true });
  }

  // DELETE /api/movimentacao/:id — admin only
  if (method === 'DELETE' && pathname.match(/^\/api\/movimentacao\/\d+$/)) {
    if (!await isAdmin(req)) return sendJSON(res, 403, { error: 'Admin only' });
    const id = parseInt(pathname.split('/').pop(), 10);
    const mov = db.prepare('SELECT * FROM movimentacoes WHERE id = ?').get(id);
    if (!mov) return sendJSON(res, 404, { error: 'Não encontrado' });
    db.transaction(() => {
      if (mov.tipo === 'entrada') db.prepare('UPDATE produtos SET estoque_atual = estoque_atual - ? WHERE id = ?').run(mov.quantidade, mov.produto_id);
      else db.prepare('UPDATE produtos SET estoque_atual = estoque_atual + ? WHERE id = ?').run(mov.quantidade, mov.produto_id);
      db.prepare('DELETE FROM movimentacoes WHERE id = ?').run(id);
    })();
    return sendJSON(res, 200, { ok: true });
  }

  // GET /api/consumo?dias=30
  if (method === 'GET' && pathname === '/api/consumo') {
    const dias = parseInt(query.get('dias') || '30', 10);
    let where = "tipo = 'saida'";
    if (dias > 0) {
      const desde = new Date(Date.now() - dias * 86400000).toISOString().slice(0,10);
      where += ` AND data >= '${desde}'`;
    }
    const rows = db.prepare(`
      SELECT p.nome, SUM(m.quantidade) as total, COUNT(*) as vezes,
             ROUND(SUM(m.quantidade) * 1.0 / MAX(1, ${dias > 0 ? dias : 365}), 1) as media_dia
      FROM movimentacoes m JOIN produtos p ON m.produto_id = p.id
      WHERE ${where}
      GROUP BY m.produto_id ORDER BY total DESC LIMIT 15
    `).all();
    return sendJSON(res, 200, rows);
  }

  // GET /api/compras/whatsapp — must come before /api/compras
  if (method === 'GET' && pathname === '/api/compras/whatsapp') {
    const rows = db.prepare(`
      SELECT nome, estoque_atual, estoque_minimo, qtd_compra,
             (estoque_minimo - estoque_atual) as falta
      FROM produtos
      WHERE estoque_minimo > 0 AND estoque_atual < estoque_minimo
      ORDER BY falta DESC
    `).all();
    if (rows.length === 0) {
      return sendJSON(res, 200, { text: 'Estoque OK - nenhum item abaixo do mínimo! ✅' });
    }
    const lines = ['*📦 Compras XR*', ''];
    for (const r of rows) {
      const qtd = r.qtd_compra > 0 ? r.qtd_compra : r.falta;
      lines.push(`${r.nome} - ${qtd}`);
    }
    return sendJSON(res, 200, { text: lines.join('\n') });
  }

  // GET /api/compras
  if (method === 'GET' && pathname === '/api/compras') {
    const rows = db.prepare(`
      SELECT id, nome, estoque_atual, estoque_minimo, qtd_compra, (estoque_minimo - estoque_atual) as falta, pedido_em
      FROM produtos
      WHERE estoque_minimo > 0 AND estoque_atual < estoque_minimo
      ORDER BY falta DESC
    `).all();
    return sendJSON(res, 200, rows);
  }

  // POST /api/compras/:id/pedido — marca/desmarca pedido feito
  if (method === 'POST' && pathname.match(/^\/api\/compras\/\d+\/pedido$/)) {
    const id = pathname.split('/')[3];
    const produto = db.prepare('SELECT pedido_em FROM produtos WHERE id = ?').get(id);
    if (!produto) return sendJSON(res, 404, { error: 'Produto não encontrado' });
    const now = produto.pedido_em ? null : new Date().toISOString();
    db.prepare('UPDATE produtos SET pedido_em = ? WHERE id = ?').run(now, id);
    return sendJSON(res, 200, { id: +id, pedido_em: now });
  }

  // POST /api/etiqueta/:id
  if (method === 'POST' && pathname.match(/^\/api\/etiqueta\/\d+$/)) {
    const id = pathname.split('/')[3];
    const produto = db.prepare('SELECT * FROM produtos WHERE id = ?').get(id);
    if (!produto) return sendJSON(res, 404, { error: 'Product not found' });

    // Check if product already has an XR- code
    const existing = db.prepare(`SELECT codigo FROM codigos WHERE produto_id = ? AND codigo LIKE 'XR-%' LIMIT 1`).get(id);
    let codigo;
    if (existing) {
      codigo = existing.codigo;
    } else {
      codigo = nextXRCode();
      db.prepare('INSERT INTO codigos (codigo, produto_id) VALUES (?, ?)').run(codigo, id);
    }

    const svg = generateBarcodeSVG(codigo);
    return sendJSON(res, 200, { codigo, svg });
  }

  // ─── COTAÇÕES API ──────────────────────────────────────────────────────────

  // POST /api/cotacao/extrair — upload image, extract invoice via AI
  if (method === 'POST' && pathname === '/api/cotacao/extrair') {
    const raw = await parseRawBody(req);
    let body;
    try { body = JSON.parse(raw.toString()); } catch(e) { return sendJSON(res, 400, { error: 'Invalid JSON' }); }
    const { image, mimeType } = body;
    if (!image) return sendJSON(res, 400, { error: 'image (base64) required' });
    const result = await extractInvoiceFromImage(image, mimeType || 'image/jpeg');
    if (!result) return sendJSON(res, 500, { error: 'Não consegui ler a nota. Tente outra foto.' });
    // Try to match items to existing products
    const produtos = db.prepare('SELECT id, nome FROM produtos ORDER BY nome COLLATE NOCASE').all();
    for (const item of result.itens) {
      const desc = item.descricao.toLowerCase();
      let bestMatch = null, bestScore = 0;
      for (const p of produtos) {
        const pname = p.nome.toLowerCase();
        // Simple word overlap scoring
        const descWords = desc.split(/\s+/);
        const pWords = pname.split(/\s+/);
        let score = 0;
        for (const w of pWords) {
          if (w.length >= 2 && desc.includes(w)) score += w.length;
        }
        for (const w of descWords) {
          if (w.length >= 2 && pname.includes(w)) score += w.length;
        }
        if (score > bestScore) { bestScore = score; bestMatch = p; }
      }
      item.produto_id = bestScore >= 4 ? bestMatch.id : null;
      item.produto_nome = bestScore >= 4 ? bestMatch.nome : null;
    }
    return sendJSON(res, 200, result);
  }

  // POST /api/cotacao/salvar — save confirmed invoice
  if (method === 'POST' && pathname === '/api/cotacao/salvar') {
    const body = await parseBody(req);
    const { fornecedor, numero, data, itens } = body;
    if (!fornecedor || !data || !itens || !itens.length) return sendJSON(res, 400, { error: 'fornecedor, data, itens required' });

    const result = db.transaction(() => {
      // Upsert fornecedor
      db.prepare('INSERT OR IGNORE INTO fornecedores (nome) VALUES (?)').run(fornecedor.trim());
      const forn = db.prepare('SELECT id FROM fornecedores WHERE nome = ?').get(fornecedor.trim());

      // Insert nota
      const nota = db.prepare('INSERT INTO notas (fornecedor_id, numero, data) VALUES (?, ?, ?)').run(forn.id, numero || '', data);
      const notaId = nota.lastInsertRowid;

      // Insert itens
      const insertItem = db.prepare('INSERT INTO nota_itens (nota_id, produto_id, descricao, quantidade, preco_unitario) VALUES (?, ?, ?, ?, ?)');
      for (const item of itens) {
        insertItem.run(notaId, item.produto_id || null, item.descricao, item.quantidade || 1, item.preco_unitario || 0);
      }
      return { nota_id: notaId, fornecedor_id: forn.id };
    })();

    return sendJSON(res, 201, { ok: true, ...result });
  }

  // GET /api/cotacao/precos/:produto_id — price history for a product
  if (method === 'GET' && pathname.match(/^\/api\/cotacao\/precos\/\d+$/)) {
    const prodId = pathname.split('/').pop();
    const rows = db.prepare(`
      SELECT ni.preco_unitario, ni.quantidade, ni.descricao,
             n.data, n.numero as nota_numero,
             f.nome as fornecedor
      FROM nota_itens ni
      JOIN notas n ON n.id = ni.nota_id
      JOIN fornecedores f ON f.id = n.fornecedor_id
      WHERE ni.produto_id = ?
      ORDER BY n.data DESC
    `).all(prodId);
    return sendJSON(res, 200, rows);
  }

  // GET /api/cotacao/precos — price history for all products (latest per product per supplier)
  if (method === 'GET' && pathname === '/api/cotacao/precos') {
    const search = query.get('search') || '';
    let where = '1=1';
    const params = [];
    if (search) { where += ' AND (p.nome LIKE ? OR ni.descricao LIKE ?)'; params.push('%'+search+'%', '%'+search+'%'); }
    const rows = db.prepare(`
      SELECT ni.produto_id, p.nome as produto_nome,
             ni.preco_unitario, ni.descricao,
             n.data, f.nome as fornecedor,
             MIN(ni.preco_unitario) as melhor_preco
      FROM nota_itens ni
      JOIN notas n ON n.id = ni.nota_id
      JOIN fornecedores f ON f.id = n.fornecedor_id
      LEFT JOIN produtos p ON p.id = ni.produto_id
      WHERE ${where}
      GROUP BY ni.produto_id, f.id
      ORDER BY p.nome COLLATE NOCASE, ni.preco_unitario ASC
    `).all(...params);
    return sendJSON(res, 200, rows);
  }

  // GET /api/fornecedores
  if (method === 'GET' && pathname === '/api/fornecedores') {
    const rows = db.prepare('SELECT * FROM fornecedores ORDER BY nome COLLATE NOCASE').all();
    return sendJSON(res, 200, rows);
  }

  // GET /api/notas
  if (method === 'GET' && pathname === '/api/notas') {
    const rows = db.prepare(`
      SELECT n.*, f.nome as fornecedor_nome,
             (SELECT COUNT(*) FROM nota_itens WHERE nota_id = n.id) as total_itens,
             (SELECT SUM(quantidade * preco_unitario) FROM nota_itens WHERE nota_id = n.id) as total_valor
      FROM notas n
      JOIN fornecedores f ON f.id = n.fornecedor_id
      ORDER BY n.data DESC
    `).all();
    return sendJSON(res, 200, rows);
  }

  // GET /api/nota/:id — single nota with items
  if (method === 'GET' && pathname.match(/^\/api\/nota\/\d+$/)) {
    const id = pathname.split('/').pop();
    const nota = db.prepare(`SELECT n.*, f.nome as fornecedor_nome FROM notas n JOIN fornecedores f ON f.id = n.fornecedor_id WHERE n.id = ?`).get(id);
    if (!nota) return sendJSON(res, 404, { error: 'Nota not found' });
    nota.itens = db.prepare('SELECT * FROM nota_itens WHERE nota_id = ? ORDER BY id').all(id);
    return sendJSON(res, 200, nota);
  }

  // DELETE /api/nota/:id
  if (method === 'DELETE' && pathname.match(/^\/api\/nota\/\d+$/)) {
    const id = pathname.split('/').pop();
    db.prepare('DELETE FROM notas WHERE id = ?').run(id);
    return sendJSON(res, 200, { ok: true });
  }

  // PUT /api/nota/:id — edit saved nota
  if (method === 'PUT' && pathname.match(/^\/api\/nota\/\d+$/)) {
    const id = pathname.split('/').pop();
    const body = await parseBody(req);
    const { fornecedor, numero, data, itens } = body;
    if (!fornecedor || !data || !itens || !itens.length) return sendJSON(res, 400, { error: 'fornecedor, data, itens required' });

    const result = db.transaction(() => {
      db.prepare('INSERT OR IGNORE INTO fornecedores (nome) VALUES (?)').run(fornecedor.trim());
      const forn = db.prepare('SELECT id FROM fornecedores WHERE nome = ?').get(fornecedor.trim());
      db.prepare('UPDATE notas SET fornecedor_id = ?, numero = ?, data = ? WHERE id = ?').run(forn.id, numero || '', data, id);
      db.prepare('DELETE FROM nota_itens WHERE nota_id = ?').run(id);
      const insertItem = db.prepare('INSERT INTO nota_itens (nota_id, produto_id, descricao, quantidade, preco_unitario) VALUES (?, ?, ?, ?, ?)');
      for (const item of itens) {
        insertItem.run(id, item.produto_id || null, item.descricao, item.quantidade || 1, item.preco_unitario || 0);
      }
      return { nota_id: id, fornecedor_id: forn.id };
    })();

    return sendJSON(res, 200, { ok: true, ...result });
  }

  return sendJSON(res, 404, { error: 'Not found' });
}

// ─── HTTP Server ───────────────────────────────────────────────────────────────
const indexHTMLPath = path.join(__dirname, 'index.html');
const logoPath = path.join(__dirname, 'logo-xr.png');

const server = http.createServer(async (req, res) => {
  const url = parseURL(req.url);
  if (!url) return sendJSON(res, 400, { error: 'Bad request' });

  const pathname = url.pathname;
  const query = url.searchParams;

  // Auth check: must have xr_session cookie or be accessing root redirect
  // Liberar manifest e ícones sem autenticação (necessário para PWA)
  if (pathname.startsWith('/public/') || pathname === '/manifest.json') {
    // handled below
  } else if (!isAuthed(req) && !pathname.startsWith('/xr-esto-r9k1')) {
    res.writeHead(302, { Location: SECRET_PATH });
    return res.end();
  }

  // Serve frontend at secret path
  if (pathname === SECRET_PATH || pathname === SECRET_PATH + '/') {
    if (!isAuthed(req)) {
      // No auth, but redirect to self — in production Traefik handles auth
      // For local dev, just serve the page
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(fs.readFileSync(indexHTMLPath));
  }

  // Serve logo
  if (pathname === '/logo-xr.png') {
    const logo = fs.readFileSync(logoPath);
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return res.end(logo);
  }

  // Serve public static files (manifest, icons)
  if (pathname.startsWith('/public/')) {
    const filePath = path.join(__dirname, pathname);
    try {
      const data = fs.readFileSync(filePath);
      const ext = path.extname(filePath);
      const types = { '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
      return res.end(data);
    } catch(_) { return sendJSON(res, 404, { error: 'Not found' }); }
  }

  // Strip secret path prefix for API routes
  const apiPath = pathname.startsWith(SECRET_PATH + '/api/') 
    ? pathname.slice(SECRET_PATH.length) 
    : pathname;

  // API routes (accessible once authed)
  if (apiPath.startsWith('/api/')) {
    console.log(`[API] ${req.method} ${apiPath} (original: ${pathname})`);
    if (!isAuthed(req)) {
      console.log(`[API] 401 - no auth cookie`);
      return sendJSON(res, 401, { error: 'Unauthorized' });
    }
    try {
      return await handleAPI(req, res, apiPath, query);
    } catch (e) {
      console.error('API error:', e);
      return sendJSON(res, 500, { error: 'Internal server error' });
    }
  }

  // Root — serve frontend (when accessed via auth proxy)
  if (pathname === '/' || pathname === '') {
    if (isAuthed(req)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(fs.readFileSync(indexHTMLPath));
    }
    res.writeHead(302, { Location: SECRET_PATH });
    return res.end();
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`XR Estoque running on port ${PORT}`);
  console.log(`Secret path: ${SECRET_PATH}`);
});
