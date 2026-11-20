// Crea una sesión de pago de Stripe con Managed Payments (Stripe es el vendedor legal y gestiona el IVA)
// y redirige al cliente a la página de pago. Se abre con un enlace normal: /functions/v1/checkout
import { SITE, corsHeaders, json, stripe } from '../_shared/common.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  try {
    const body = new URLSearchParams();
    body.set('mode', 'payment');
    body.set('managed_payments[enabled]', 'true');
    body.set('line_items[0][quantity]', '1');
    body.set('line_items[0][price_data][currency]', 'eur');
    body.set('line_items[0][price_data][unit_amount]', '2900');
    body.set('line_items[0][price_data][tax_behavior]', 'inclusive');
    body.set('line_items[0][price_data][product_data][name]', 'nprojects Pro');
    body.set('line_items[0][price_data][product_data][description]', 'Licencia de pago único: hasta 10 proyectos a la vez, historial completo, estadísticas y exportación.');
    // Software como servicio, uso personal: código admitido por Managed Payments
    body.set('line_items[0][price_data][product_data][tax_code]', 'txcd_10103000');
    // Códigos de descuento (por ejemplo, el de fundador) creados en el panel de Stripe
    body.set('allow_promotion_codes', 'true');
    body.set('locale', 'es');
    body.set('success_url', `${SITE}/gracias/?session_id={CHECKOUT_SESSION_ID}`);
    body.set('cancel_url', `${SITE}/comprar/?cancelado=1`);
    const session = await stripe('checkout/sessions', { method: 'POST', body });
    if (req.method === 'POST') return json({ url: session.url });
    return new Response(null, { status: 303, headers: { ...corsHeaders, Location: session.url } });
  } catch (e) {
    console.error('checkout', e);
    if (req.method === 'POST') return json({ error: String((e as Error).message) }, 500);
    return new Response(null, { status: 303, headers: { Location: `${SITE}/comprar/?error=1` } });
  }
});
