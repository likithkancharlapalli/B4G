import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_ANON_KEY?.trim();

if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY in backend/.env");
  process.exit(1);
}

const supabase = createClient(url, key);
const { error } = await supabase.auth.getSession();

if (error) {
  console.error("Supabase connection failed:", error.message);
  process.exit(1);
}

console.log("Supabase OK —", url);
