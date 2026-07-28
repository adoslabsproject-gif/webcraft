/// <reference types="vite/client" />

/// Build id injected by vite.config.ts `define` (git hash · timestamp).
/// Also declared in @webcraft/core's vite-env.d.ts; this copy makes the
/// desktop tsconfig program (include: src/** only) see it when core
/// sources are pulled in through imports.
declare const __BUILD_ID__: string | undefined;
