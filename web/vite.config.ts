import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // basicSsl = ใบรับรอง HTTPS แบบ self-signed ตอน dev
    // จำเป็นเพราะมือถือเปิดกล้อง (getUserMedia) ได้เฉพาะบน HTTPS/localhost
    basicSsl(),
    // PWA = ติดตั้งเป็นแอปได้ + ทำงานออฟไลน์ (cache โมเดล/wasm หลังโหลดครั้งแรก)
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "AI Health Cam",
        short_name: "Health Cam",
        description:
          "ตรวจสุขภาพจากเว็บแคม ประมวลผลในเครื่อง 100% — หัวใจ ความเครียด อารมณ์ อายุ ท่านั่ง ฯลฯ",
        lang: "th",
        theme_color: "#0891b2",
        background_color: "#f8fafc",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg}"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // ไฟล์ใหญ่ (โมเดล/wasm/เสียง) cache ตอนใช้จริงครั้งแรก (CacheFirst) -> ออฟไลน์ได้
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              /\/(models|wasm|face-api-models)\//.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "ml-models",
              expiration: { maxEntries: 40 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.endsWith(".wav"),
            handler: "CacheFirst",
            options: { cacheName: "audio", cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
  server: { host: true }, // host:true = เปิดจากมือถือในวง LAN เดียวกันได้
});
