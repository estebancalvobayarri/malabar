-- Correo de bienvenida de la lista de espera y registro de envíos.
-- PENDIENTE DE APLICAR en Supabase (requiere confirmación del propietario).
create extension if not exists pg_net with schema extensions;

alter table public.waitlist add column if not exists welcome_sent_at timestamptz;
alter table public.licenses add column if not exists email_sent_at timestamptz;

-- Al apuntarse alguien a la lista de espera, avisa a la función «welcome».
-- Solo se envía el id: la función lee el email de la tabla y lo envía una única vez.
create or replace function public.notify_waitlist_welcome()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform net.http_post(
    url := 'https://owgnozgnkqllqpwlcedm.supabase.co/functions/v1/welcome',
    body := jsonb_build_object('id', new.id),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return new;
exception when others then
  return new; -- nunca impedir que alguien se apunte por un fallo del correo
end;
$$;

drop trigger if exists waitlist_welcome on public.waitlist;
create trigger waitlist_welcome
after insert on public.waitlist
for each row execute function public.notify_waitlist_welcome();
