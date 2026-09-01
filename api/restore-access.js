import {
  json, readBody, hasSupabase, sbSelect, sbUpdate,
  newToken, normEmail, normPhone, logEvent
} from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!hasSupabase()) return json(res, 501, { error: 'Database is not configured' });

  const b = await readBody(req);
  const email = normEmail(b.email);
  const phone = normPhone(b.phone);
  if (!email || phone.length !== 10) return json(res, 400, { error: 'Enter your email and 10-digit phone' });

  try {
    const q = `email=eq.${encodeURIComponent(email)}&phone=eq.${encodeURIComponent(phone)}&access=is.true&select=id,name&limit=1`;
    const { data } = await sbSelect('students', q);
    const student = data && data[0];
    if (!student) return json(res, 404, { error: 'No paid account found with those details' });

    const token = newToken();
    await sbUpdate('students', `id=eq.${student.id}`, {
      access_token: token, last_seen_at: new Date().toISOString()
    });
    await logEvent('restore', student.id, {});
    return json(res, 200, { token, name: student.name, access: true });
  } catch (e) {
    return json(res, 500, { error: 'Could not restore access right now' });
  }
}
