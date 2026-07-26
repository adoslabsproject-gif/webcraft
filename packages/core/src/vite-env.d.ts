/// <reference types="vite/client" />

declare module '@xterm/xterm/css/xterm.css';
declare module '*.css';

/// Injected by the desktop app's vite config (define) — git hash + build
/// time, surfaced in the StatusBar. Falls back to 'dev' when a host does
/// not define it (tests, storybook).
declare const __BUILD_ID__: string | undefined;
