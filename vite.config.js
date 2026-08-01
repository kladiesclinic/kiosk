import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // base "./" — GitHub Pages のサブパス（/kiosk/）配信でもアセットが解決できるよう相対パスにする
  base: "./",
  // host: true — 受付機は同じWi-Fi内のiPadから http://<PCのIP>:5175 で開くため、
  // localhost以外からの接続も受け付ける
  server: { port: 5175, host: true },
});
