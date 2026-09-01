import {
  json, readBody, hasSupabase, sbSelect, sbInsert, sbUpdate, sb,
  newToken, normEmail, normPhone, signAdminToken, verifyAdminToken,
  ADMIN_PASSWORD
} from './_lib.js';

const HEAD = { Prefer: 'count=exact', Range: '0-0' };

async function countRows(table, filter) {
  const q = `select=id${filter ? '&' + filter : ''}`;
  const { count } = await sbSelect(table, q, HEAD);
  return count || 0;
}

async function sumRevenue() {
  const { data } = await sbSelect('students', 'select=amount_paise&access=is.true&source=eq.payment');
  return (data || []).reduce((t, r) => t + (r.amount_paise || 0), 0);
}

async function stats() {
  const since = d => new Date(Date.now() - d * 864e5).toISOString();
  const [students, paid, granted, orders, searches, visits, paywalls, pdfs, today7] =
    await Promise.all([
      countRows('students'),
      countRows('students', 'access=is.true&source=eq.payment'),
      countRows('students', 'access=is.true&source=eq.admin'),
      countRows('orders'),
      countRows('events', 'type=eq.search'),
      countRows('events', 'type=eq.visit'),
      countRows('events', 'type=eq.paywall_view'),
      countRows('events', 'type=eq.download_pdf'),
      countRows('events', `created_at=gte.${since(7)}`)
    ]);
  const revenue = await sumRevenue();
  return {
    students, paid, granted, orders, searches, visits, paywalls, pdfs,
    events7d: today7,
    revenueRupees: Math.round(revenue / 100),
    conversion: paywalls ? +((paid / paywalls) * 100).toFixed(1) : 0
  };
}

async function series(days = 14) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const { data } = await sbSelect(
    'events',
    `select=type,created_at&created_at=gte.${since}&order=created_at.asc&limit=20000`);
  const buckets = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    buckets[d] = { date: d, visits: 0, searches: 0, paid: 0 };
  }
  (data || []).forEach(e => {
    const d = e.created_at.slice(0, 10);
    if (!buckets[d]) return;
    if (e.type === 'visit') buckets[d].visits++;
    else if (e.type === 'search') buckets[d].searches++;
    else if (e.type === 'paid') buckets[d].paid++;
  });
  return Object.values(buckets);
}

async function topSearches() {
  const { data } = await sbSelect(
    'events', 'select=meta&type=eq.search&order=created_at.desc&limit=2000');
  const cat = {}, gen = {};
  (data || []).forEach(e => {
    const m = e.meta || {};
    if (m.category) cat[m.category] = (cat[m.category] || 0) + 1;
    if (m.gender) gen[m.gender] = (gen[m.gender] || 0) + 1;
  });
  const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return { categories: top(cat), genders: top(gen) };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const b = await readBody(req);
  const action = String(b.action || '');

  if (action === 'login') {
    if (!ADMIN_PASSWORD) return json(res, 501, { error: 'Set ADMIN_PASSWORD in your environment first' });
    if (String(b.password || '') !== ADMIN_PASSWORD) return json(res, 401, { error: 'Wrong password' });
    return json(res, 200, { token: signAdminToken() });
  }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || b.token;
  if (!verifyAdminToken(token)) return json(res, 401, { error: 'Session expired — sign in again' });
  if (!hasSupabase()) return json(res, 501, { error: 'Database is not configured' });

  try {
    switch (action) {
      case 'stats':
        return json(res, 200, {
          stats: await stats(), series: await series(14), top: await topSearches()
        });

      case 'students': {
        const q = String(b.q || '').trim();
        const page = Math.max(0, parseInt(b.page || 0, 10));
        const size = 25;
        let filter = 'select=*&order=created_at.desc';
        if (q) {
          const safe = encodeURIComponent(`*${q}*`);
          filter += `&or=(name.ilike.${safe},email.ilike.${safe},phone.ilike.${safe})`;
        }
        const { data, count } = await sbSelect('students', filter, {
          Prefer: 'count=exact', Range: `${page * size}-${page * size + size - 1}`
        });
        return json(res, 200, { students: data || [], total: count, page, size });
      }

      case 'grant': {
        const name = String(b.name || '').trim() || 'Manual access';
        const email = normEmail(b.email);
        const phone = normPhone(b.phone);
        if (!email || phone.length !== 10) return json(res, 400, { error: 'Email and 10-digit phone are required' });
        const accessToken = newToken();
        const { data: existing } = await sbSelect(
          'students',
          `email=eq.${encodeURIComponent(email)}&phone=eq.${encodeURIComponent(phone)}&select=id&limit=1`);
        if (existing && existing[0]) {
          const { data } = await sbUpdate('students', `id=eq.${existing[0].id}`, {
            name, access: true, access_token: accessToken, source: 'admin'
          });
          return json(res, 200, { student: data && data[0], created: false });
        }
        const { data } = await sbInsert('students', [{
          name, email, phone, access: true, access_token: accessToken,
          source: 'admin', amount_paise: 0
        }]);
        return json(res, 200, { student: data && data[0], created: true });
      }

      case 'setAccess': {
        if (!b.id) return json(res, 400, { error: 'Missing student id' });
        const { data } = await sbUpdate('students', `id=eq.${b.id}`, { access: !!b.access });
        return json(res, 200, { student: data && data[0] });
      }

      case 'delete': {
        if (!b.id) return json(res, 400, { error: 'Missing student id' });
        await sb(`students?id=eq.${b.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
        return json(res, 200, { ok: true });
      }

      case 'getSettings': {
        try {
          const { data } = await sbSelect('settings', 'key=eq.access_mode&select=value&limit=1');
          const v = data && data[0] && data[0].value;
          return json(res, 200, { accessMode: v === 'free' ? 'free' : 'paid' });
        } catch (e) {
          return json(res, 200, { accessMode: 'paid', warning: 'settings table not found — run schema.sql' });
        }
      }

      case 'setAccessMode': {
        const mode = b.mode === 'free' ? 'free' : 'paid';
        await sb('settings', {
          method: 'POST',
          body: JSON.stringify([{ key: 'access_mode', value: mode, updated_at: new Date().toISOString() }]),
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }
        });
        return json(res, 200, { accessMode: mode });
      }

      case 'recentEvents': {
        const { data } = await sbSelect(
          'events', 'select=type,meta,created_at&order=created_at.desc&limit=60');
        return json(res, 200, { events: data || [] });
      }

      default:
        return json(res, 400, { error: 'Unknown action' });
    }
  } catch (e) {
    return json(res, 500, { error: e.message || 'Something went wrong' });
  }
}
