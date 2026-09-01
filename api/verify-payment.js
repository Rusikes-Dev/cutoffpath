import {
  json, readBody, hasRazorpay, hasSupabase, verifyRazorpaySignature,
  sbSelect, sbInsert, sbUpdate, newToken, logEvent, PRICE_PAISE
} from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!hasRazorpay()) return json(res, 501, { error: 'Payments are not configured' });

  const b = await readBody(req);
  const orderId = b.razorpay_order_id;
  const paymentId = b.razorpay_payment_id;
  const signature = b.razorpay_signature;

  if (!orderId || !paymentId || !signature) return json(res, 400, { error: 'Incomplete payment details' });
  if (!verifyRazorpaySignature(orderId, paymentId, signature)) {
    return json(res, 400, { error: 'Payment signature did not match' });
  }
  if (!hasSupabase()) return json(res, 501, { error: 'Database is not configured' });

  try {
    const { data: orders } = await sbSelect('orders', `razorpay_order_id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`);
    const order = orders && orders[0];
    if (!order) return json(res, 404, { error: 'Order not found' });

    await sbUpdate('orders', `razorpay_order_id=eq.${encodeURIComponent(orderId)}`, {
      status: 'paid', razorpay_payment_id: paymentId
    }).catch(() => {});

    const token = newToken();
    const { data: existing } = await sbSelect(
      'students',
      `email=eq.${encodeURIComponent(order.email)}&phone=eq.${encodeURIComponent(order.phone)}&select=id&limit=1`
    );

    let student;
    if (existing && existing[0]) {
      const { data } = await sbUpdate('students', `id=eq.${existing[0].id}`, {
        name: order.name, access: true, access_token: token, source: 'payment',
        amount_paise: order.amount_paise || PRICE_PAISE,
        razorpay_order_id: orderId, razorpay_payment_id: paymentId,
        last_seen_at: new Date().toISOString()
      });
      student = data && data[0];
    } else {
      const { data } = await sbInsert('students', [{
        name: order.name, email: order.email, phone: order.phone,
        access: true, access_token: token, source: 'payment',
        amount_paise: order.amount_paise || PRICE_PAISE,
        razorpay_order_id: orderId, razorpay_payment_id: paymentId,
        percentile: order.percentile ?? null, merit_rank: order.merit_rank ?? null,
        category: order.category, gender: order.gender
      }]);
      student = data && data[0];
    }

    await logEvent('paid', student && student.id, { amount_paise: order.amount_paise });
    return json(res, 200, { token, name: order.name, access: true });
  } catch (e) {
    return json(res, 500, { error: e.message || 'Could not confirm the payment' });
  }
}
