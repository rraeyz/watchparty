import { loadEnvFile } from "node:process";
import fs from "node:fs";

try {
  loadEnvFile();
} catch (e) {
  console.log(e);
}

// These are only used by the dev server. In production SSL_CRT_FILE/SSL_KEY_FILE
// point at the host's certificates, which aren't present during the build, so
// missing files must not fail the build.
function devServerHttps() {
  const { SSL_CRT_FILE, SSL_KEY_FILE } = process.env;
  if (!SSL_CRT_FILE || !SSL_KEY_FILE) {
    return null;
  }
  try {
    return {
      key: fs.readFileSync(SSL_KEY_FILE),
      cert: fs.readFileSync(SSL_CRT_FILE),
    };
  } catch {
    return null;
  }
}

export default {
  build: {
    outDir: "build",
    // sourcemap: true,
  },
  server: {
    https: devServerHttps(),
    allowedHosts: true,
  },
};
