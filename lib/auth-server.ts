import { createClient } from "@/lib/supabase/server";

/**
 * Konteks autentikasi sisi server.
 * Selalu gunakan `auth.getUser()` (validasi server) — jangan percaya
 * state sesi dari browser saja.
 */
export async function getAuthContext() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { supabase, user: null };
  return { supabase, user: data.user };
}
