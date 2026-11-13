import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  // 本番ビルドで .env（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）が読めないと、
  // 接続先が placeholder.supabase.co のまま公開されてスタッフログインが全滅する。
  // .env のないフォルダ（クラウドやworktree等）でのビルドはここで止める。
  if (command === "build") {
    const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
    const missing = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"].filter((k) => !env[k]);
    if (missing.length) {
      throw new Error(
        `${missing.join(" / ")} が未設定です。.env があるフォルダでビルドしてください（このまま公開するとログインできなくなります）。`
      );
    }
  }

  return {
    plugins: [react()],
    // base "./" — GitHub Pages のサブパス（/kiosk/）配信でもアセットが解決できるよう相対パスにする
    base: "./",
    // host: true — 受付機は同じWi-Fi内のiPadから http://<PCのIP>:5175 で開くため、
    // localhost以外からの接続も受け付ける
    server: { port: 5175, host: true },
  };
});
