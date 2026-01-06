import { supabase } from "./client";

export async function requireAuth() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}
