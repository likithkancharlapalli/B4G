import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const supabase = createClient(url ?? "", key ?? "");

/** Resolves true when the project URL and anon/publishable key accept a session probe. */
export async function verifySupabaseConnection(): Promise<boolean> {
  if (!url || !key) return false;
  const { error } = await supabase.auth.getSession();
  return !error;
}
