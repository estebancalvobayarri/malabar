// Entrega la clave de licencia tras el pago. La página /gracias/ la llama con el session_id de Stripe.
// Es idempotente: la misma sesión de pago siempre devuelve la misma clave (el webhook puede haberla creado ya).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, json, stripe, ensureLicense } from '../_shared/common.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  try {
    const url = new URL(req.url);
    let sessionId = url.searchParams.get('session_id') ?? '';
    if (!sessionId && req.method === 'POST') sessionId = (await req.json().catch(() => ({}))).session_id ?? '';
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return json({ error: 'Sesión de pago no válida' }, 400);

    const { data: existing } = await db.from('licenses').select('license_key,email').eq('stripe_session_id', sessionId).maybeSingle();
    if (existing) return json({ key: existing.license_key, email: existing.email });

    const s = await stripe(`checkout/sessions/${sessionId}`);
    if (s.status !== 'complete' || !['paid', 'no_payment_required'].includes(s.payment_status)) {
      return json({ error: 'El pago todavía no está completado' }, 402);
    }
    return json(await ensureLicense(db, s));
  } catch (e) {
    console.error('license', e);
    return json({ error: 'No hemos podido generar tu clave. Escríbenos a nprojects@nprojects.app.' }, 500);
  }
});
