// Webhook de Stripe: cuando se completa un pago, crea la licencia y envía la clave por email,
// aunque el comprador cierre la página antes de llegar a /gracias/.
// En Stripe: Developers → Webhooks → endpoint con los eventos checkout.session.completed
// y checkout.session.async_payment_succeeded. Su secreto (whsec_…) va en STRIPE_WEBHOOK_SECRET.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { json, ensureLicense, verifyStripeSignature } from '../_shared/common.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret) { console.error('Falta STRIPE_WEBHOOK_SECRET'); return json({ error: 'Sin configurar' }, 500); }
  const payload = await req.text();
  if (!(await verifyStripeSignature(payload, req.headers.get('stripe-signature'), secret))) {
    return json({ error: 'Firma no válida' }, 400);
  }
  try {
    const event = JSON.parse(payload);
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const s = event.data.object;
      if (['paid', 'no_payment_required'].includes(s.payment_status)) {
        const lic = await ensureLicense(db, s);
        console.log('licencia lista', s.id, lic.key.slice(0, 9) + '…');
      }
    }
    return json({ received: true });
  } catch (e) {
    console.error('stripe-webhook', e);
    // 500 para que Stripe lo reintente más tarde
    return json({ error: 'Error procesando el evento' }, 500);
  }
});
