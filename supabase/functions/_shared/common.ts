// Utilidades comunes de las funciones de pago de nprojects
export const SITE = Deno.env.get('SITE_URL') ?? 'https://nprojects.app';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// Llamada a la API de Stripe con la clave secreta guardada como secreto de Supabase
export async function stripe(path: string, init: { method?: string; body?: URLSearchParams } = {}) {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) throw new Error('Falta el secreto STRIPE_SECRET_KEY');
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // Versión de la API que pide Managed Payments (2025-03-31.basil o posterior)
      'Stripe-Version': '2025-03-31.basil',
    },
    body: init.body,
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message ?? `Error de Stripe (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

// Claves del tipo NPRJ-ABCD-EFGH-JKLM, sin caracteres que se confunden (0/O, 1/I)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newLicenseKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `NPRJ-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

export function normalizeKey(raw: string): string {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^NPRJ/, '').replace(/(.{4})(?=.)/g, '$1-').replace(/^/, 'NPRJ-');
}

export function maskEmail(email?: string | null): string {
  if (!email) return '';
  const [user, domain] = email.split('@');
  if (!domain) return '';
  return `${user.slice(0, 1)}***@${domain}`;
}
