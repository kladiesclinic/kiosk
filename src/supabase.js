import { createClient } from "@supabase/supabase-js";

// 本体アプリ（keicuri-prototype）と同じSupabaseプロジェクト（ステージング）を使う。
// セッション保存キーは受付機専用に分けておく — 同じブラウザで管理画面等を
// 開いてもお互いのログインを消さないため。
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured) {
  console.warn("Supabase未設定です。.env の VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY を確認してください。");
}

export const supabase = createClient(url || "https://placeholder.supabase.co", anonKey || "placeholder-anon-key", {
  auth: { storageKey: "keicuri-kiosk-auth" },
});
