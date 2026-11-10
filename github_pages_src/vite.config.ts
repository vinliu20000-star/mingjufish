import { defineConfig } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root,
  base:"/mingjufish/",
  build:{outDir:resolve(root,"../docs"),emptyOutDir:true,rollupOptions:{input:{admin:resolve(root,"index.html"),clock:resolve(root,"clock/index.html"),qr:resolve(root,"qr/index.html")}}},
});

