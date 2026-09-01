import { json, hasSupabase, sbSelect, sbUpdate } from './_lib.js';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const token = url.searchParams.get('token') || '';
  if (!token) return json(res, 200, { access: false });
  if (!hasSupabase()) return json(res, 200, { access: false });

  try {
    const { data } = await sbSelect(
      'students',
      `access_token=eq.${encodeURIComponent(token)}&select=id,name,email,access&limit=1`
    );
    const s = data && data[0];
    if (!s || !s.access) return json(res, 200, { access: false });
    sbUpdate('students', `id=eq.${s.id}`, { last_seen_at: new Date().toISOString() }).catch(() => {});
    return json(res, 200, { access: true, name: s.name, email: s.email });
  } catch (e) {
    return json(res, 200, { access: false });
  }
}
