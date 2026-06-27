import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  // basicSsl = ใบรับรอง HTTPS แบบ self-signed ตอน dev
  // จำเป็นเพราะมือถือเปิดกล้อง (getUserMedia) ได้เฉพาะบน HTTPS/localhost
  plugins: [react(), tailwindcss(), basicSsl()],
  server: { host: true }, // host:true = เปิดจากมือถือในวง LAN เดียวกันได้
});
