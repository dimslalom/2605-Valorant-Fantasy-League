// Self-hosted Rive wasm. The default loader fetches wasm from a CDN, which the
// Worker's CSP (connect-src 'self') blocks, so both files ship with the app.
// Import this only from lazily loaded routes: the wasm is about 2 MB raw.
import { RuntimeLoader } from '@rive-app/react-canvas';
import wasmUrl from '@rive-app/canvas/rive.wasm?url';
import fallbackWasmUrl from '@rive-app/canvas/rive_fallback.wasm?url';

RuntimeLoader.setWasmUrl(wasmUrl);
RuntimeLoader.setWasmFallbackUrl?.(fallbackWasmUrl);

export const riveReady = RuntimeLoader.awaitInstance().catch(() => null);
