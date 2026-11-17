// Configuración de la lista de espera.
// Mientras supabaseUrl y supabaseAnonKey estén vacíos, el formulario funciona
// en modo demostración: muestra la confirmación pero no guarda el email.
// La clave "anon" de Supabase es pública por diseño; la seguridad la dan las
// políticas RLS de la tabla (solo permitir INSERT, nunca SELECT).
window.MALABAR_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  table: 'waitlist'
};
