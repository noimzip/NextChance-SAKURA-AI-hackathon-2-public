/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SAKURA_AI_API_KEY: string;
  readonly VITE_SAKURA_AI_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
