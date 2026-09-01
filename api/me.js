import { json, hasSupabase, sbSelect, sbUpdate, PRICE_PAISE } from './_lib.js';

/* Reads the owner's access_mode switch. Falls back to 'paid' if the settings
   table is missing, so a half-finished setup never gives the site away. */
async function accessMode() {
  try {
    const { data } = await sbSelect('settings', "key=eq.access_mode&select=value&limit=1");
    const v = data && data[0] && data[0].value;
    return v === 'free' ? 'free' : 'paid';
  } catch (e) {
    return 'paid';
  }
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const token = url.searchParams.get('token') || '';

  if (!hasSupabase()) {
    return json(res, 200, { access: false, freeMode: false, pricePaise: PRICE_PAISE });
  }

  const mode = await accessMode();
  const base = { freeMode: mode === 'free', pricePaise: PRICE_PAISE };

  if (!token) return json(res, 200, { ...base, access: false });

  try {
    const { data } = await sbSelect(
      'students',
      `access_token=eq.${encodeURIComponent(token)}&select=id,name,email,access&limit=1`
    );
    const s = data && data[0];
    if (!s || !s.access) return json(res, 200, { ...base, access: false });
    sbUpdate('students', `id=eq.${s.id}`, { last_seen_at: new Date().toISOString() }).catch(() => {});
    return json(res, 200, { ...base, access: true, name: s.name, email: s.email });
  } catch (e) {
    return json(res, 200, { ...base, access: false });
  }
}
