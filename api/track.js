import { json, readBody, hasSupabase, sbSelect, sbInsert } from './_lib.js';

const ALLOWED = new Set([
  'visit', 'tab', 'search', 'paywall_view', 'pay_start', 'pay_cancel', 'paid',
  'restore', 'add_choice', 'download_pdf', 'college_view', 'hostel_notify'
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!hasSupabase()) return json(res, 200, { ok: true });

  const b = await readBody(req);
  const type = String(b.type || '');
  if (!ALLOWED.has(type)) return json(res, 200, { ok: true });

  let studentId = null;
  if (b.token) {
    try {
      const { data } = await sbSelect(
        'students', `access_token=eq.${encodeURIComponent(b.token)}&select=id&limit=1`);
      studentId = data && data[0] ? data[0].id : null;
    } catch { /* ignore */ }
  }

  const meta = (b.meta && typeof b.meta === 'object') ? b.meta : {};
  try {
    await sbInsert('events', [{ type, student_id: studentId, meta }], 'return=minimal');
  } catch { /* never fail the beacon */ }
  return json(res, 200, { ok: true });
}
