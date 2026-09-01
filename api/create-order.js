import {
  json, readBody, hasRazorpay, hasSupabase, razorpay, sbInsert,
  RZP_KEY_ID, PRICE_PAISE, normEmail, normPhone
} from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!hasRazorpay()) return json(res, 501, { error: 'Payments are not configured' });

  const b = await readBody(req);
  const name = String(b.name || '').trim().slice(0, 120);
  const email = normEmail(b.email);
  const phone = normPhone(b.phone);

  if (name.length < 3) return json(res, 400, { error: 'Enter your full name' });
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return json(res, 400, { error: 'Enter a valid email' });
  if (phone.length !== 10) return json(res, 400, { error: 'Enter a 10-digit phone number' });

  try {
    const order = await razorpay('orders', {
      amount: PRICE_PAISE,
      currency: 'INR',
      receipt: 'cp_' + Date.now().toString(36),
      notes: { name, email, phone }
    });

    if (hasSupabase()) {
      await sbInsert('orders', [{
        razorpay_order_id: order.id,
        name, email, phone,
        amount_paise: PRICE_PAISE,
        status: 'created',
        percentile: b.percentile ?? null,
        merit_rank: b.rank ?? null,
        category: b.category || null,
        gender: b.gender || null
      }], 'return=minimal').catch(() => {});
    }

    return json(res, 200, {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: RZP_KEY_ID
    });
  } catch (e) {
    return json(res, 502, { error: e.message || 'Could not create the order' });
  }
}
