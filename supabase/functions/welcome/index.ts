// Envía el correo de bienvenida a quien se apunta a la lista de espera.
// Lo llama un trigger de la base de datos con el id de la fila. La función lee el email
// de la tabla y lo envía una sola vez (welcome_sent_at), así que no se puede usar para spam.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, json, sendEmail, welcomeEmail } from '../_shared/common.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  try {
    const { id } = await req.json().catch(() => ({ id: null }));
    if (!Number.isInteger(id)) return json({ error: 'Falta el id' }, 400);
    // Marcar primero para que dos llamadas a la vez no envíen dos correos
    const { data } = await db.from('waitlist').update({ welcome_sent_at: new Date().toISOString() })
      .eq('id', id).is('welcome_sent_at', null).select('email').maybeSingle();
    if (!data?.email) return json({ ok: true, skipped: true });
    const sent = await sendEmail({ to: data.email, ...welcomeEmail() });
    if (!sent) await db.from('waitlist').update({ welcome_sent_at: null }).eq('id', id);
    return json({ ok: sent });
  } catch (e) {
    console.error('welcome', e);
    return json({ ok: false }, 500);
  }
});
