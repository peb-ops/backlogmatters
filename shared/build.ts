// Replaced with the build time (milliseconds) by scripts/build.mjs, in both the server and the web client.
declare const __BUILD_ID__: string | undefined;

/** Identifies one build, so a page and a server from different builds can notice each other. "dev" when not built. */
export const BUILD_ID: string = typeof __BUILD_ID__ === 'undefined' ? 'dev' : __BUILD_ID__;

export const BUILD_HEADER = 'X-BM-Build';
