interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Minimal declarations for helpers injected by the WXT runtime during bundling. */
declare function defineBackground(init: () => void): { main: () => void };
declare function defineContentScript<T extends object>(cfg: T): T;
