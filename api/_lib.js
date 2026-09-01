/* Shared helpers for all serverless functions.
   No npm dependencies — everything runs on fetch + node:crypto. */
import crypto from 'node:crypto';

export const SUPABASE_URL = process.env.SUPABASE_URL || '';
export const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const RZP_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
export const RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
export const PRICE_PAISE = parseInt(process.env.PRICE_PAISE || '4900', 10);
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
export const ADMIN_SECRET = process.env.ADMIN_SECRET || 'change-me';

export const hasSupabase = () => Boolean(SUPABASE_URL && SUPABASE_KEY);
export const hasRazorpay = () => Boolean(RZP_KEY_ID && RZP_KEY_SECRET);

export function json(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(payload));
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

/* ------------------------------------------------------------- Supabase -- */
export async function sb(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!res.ok) {
    const err = new Error((data && data.message) || 'Supabase request failed');
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return { data, count: countFrom(res) };
}

function countFrom(res) {
  const cr = res.headers.get('content-range');
  if (!cr) return null;
  const n = cr.split('/')[1];
  return n === '*' ? null : parseInt(n, 10);
}

export const sbSelect = (table, query, headers) =>
  sb(`${table}?${query}`, { method: 'GET', headers });

export const sbInsert = (table, rows, prefer = 'return=representation') =>
  sb(table, { method: 'POST', body: JSON.stringify(rows), headers: { Prefer: prefer } });

export const sbUpdate = (table, query, patch) =>
  sb(`${table}?${query}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
    headers: { Prefer: 'return=representation' }
  });

/* -------------------------------------------------------------- helpers -- */
export const newToken = () => crypto.randomBytes(24).toString('base64url');

export const normEmail = e => String(e || '').trim().toLowerCase();
export const normPhone = p => String(p || '').replace(/\D/g, '').slice(-10);

export function verifyRazorpaySignature(orderId, paymentId, signature) {
  const expected = crypto
    .createHmac('sha256', RZP_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function razorpay(path, body) {
  const auth = Buffer.from(`${RZP_KEY_ID}:${RZP_KEY_SECRET}`).toString('base64');
  const res = await fetch(`https://api.razorpay.com/v1/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error((data.error && data.error.description) || 'Razorpay request failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ---------------------------------------------------------- admin token -- */
export function signAdminToken(ttlMs = 8 * 60 * 60 * 1000) {
  const exp = Date.now() + ttlMs;
  const sig = crypto.createHmac('sha256', ADMIN_SECRET).update(String(exp)).digest('hex');
  return `${exp}.${sig}`;
}

export function verifyAdminToken(token) {
  const [exp, sig] = String(token || '').split('.');
  if (!exp || !sig) return false;
  if (Number(exp) < Date.now()) return false;
  const expected = crypto.createHmac('sha256', ADMIN_SECRET).update(exp).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function requireAdmin(req, res) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!verifyAdminToken(token)) { json(res, 401, { error: 'Not signed in' }); return false; }
  return true;
}

/* -------------------------------------------------------------- events --- */
export async function logEvent(type, studentId, meta) {
  if (!hasSupabase()) return;
  try {
    await sbInsert('events', [{ type, student_id: studentId || null, meta: meta || {} }], 'return=minimal');
  } catch { /* analytics must never break a request */ }
}
