// Webhook de Stripe: cuando se completa un pago, crea la licencia y envía la clave por email,
// aunque el comprador cierre la página antes de llegar a /gracias/.
// En Stripe: Developers → Webhooks → endpoint con los eventos checkout.session.completed
// y checkout.session.async_payment_succeeded. Su secreto (whsec_…) va en STRIPE_WEBHOOK_SECRET.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { json, ensureLicense, verifyStripeSignature } from '../_shared/common.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  // Un secreto por cada endpoint: el de prueba y el de modo real
  const secrets = [Deno.env.get('STRIPE_WEBHOOK_SECRET'), Deno.env.get('STRIPE_WEBHOOK_SECRET_LIVE')].filter(Boolean) as string[];
  if (!secrets.length) { console.error('Falta STRIPE_WEBHOOK_SECRET'); return json({ error: 'Sin configurar' }, 500); }
  const payload = await req.text();
  const sig = req.headers.get('stripe-signature');
  let valid = false;
  for (const secret of secrets) if (await verifyStripeSignature(payload, sig, secret)) { valid = true; break; }
  if (!valid) {
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
