// Comprueba una clave de licencia desde la app («Activar Pro»).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, json, normalizeKey, maskEmail } from '../_shared/common.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  try {
    const { key } = await req.json().catch(() => ({ key: '' }));
    const k = normalizeKey(key);
    if (!/^NPRJ-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(k)) return json({ ok: false, error: 'La clave no tiene el formato correcto' }, 400);
    const { data } = await db.from('licenses').select('id,email,revoked,activations,livemode').eq('license_key', k).maybeSingle();
    if (!data || data.revoked) return json({ ok: false, error: 'No encontramos esa clave' }, 404);
    await db.from('licenses').update({ activations: (data.activations ?? 0) + 1, last_activated_at: new Date().toISOString() }).eq('id', data.id);
    return json({ ok: true, key: k, email: maskEmail(data.email), test: !data.livemode });
  } catch (e) {
    console.error('activate', e);
    return json({ ok: false, error: 'No hemos podido comprobar la clave. Inténtalo de nuevo.' }, 500);
  }
});
