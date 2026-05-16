import type { MediaInfoResult, ReadChunkFunc } from "mediainfo.js";
// @ts-ignore - .wasm imported as data URL by esbuild
import wasmDataUrl from "mediainfo.js/MediaInfoModule.wasm";

interface MediaInfoInstance {
	analyzeData(size: number, readChunk: ReadChunkFunc): Promise<MediaInfoResult>;
	close(): void;
}

let instance: MediaInfoInstance | null = null;
let initPromise: Promise<MediaInfoInstance> | null = null;
let initFailed = false;

async function getInstance(): Promise<MediaInfoInstance> {
	if (instance) return instance;
	if (initFailed) throw new Error("MediaInfo WASM failed to load previously. Reload the plugin to retry.");
	if (initPromise) return initPromise;

	initPromise = (async () => {
		try {
			const { mediaInfoFactory } = await import("mediainfo.js");

			const mi = await (mediaInfoFactory as (opts: {
				format: "object";
				locateFile: () => string;
			}) => Promise<MediaInfoInstance>)({
				format: "object",
				locateFile: () => wasmDataUrl,
			});

			instance = mi;
			return mi;
		} catch (err) {
			initFailed = true;
			const msg = err instanceof Error ? err.message : String(err);
			throw new Error(`Failed to initialize MediaInfo WASM module: ${msg}`);
		} finally {
			initPromise = null;
		}
	})();

	return initPromise;
}

/**
 * Parse a media file buffer using mediainfo.js.
 * @param buffer The file contents as an ArrayBuffer
 */
export async function parseBuffer(
	buffer: ArrayBuffer
): Promise<MediaInfoResult> {
	const mi = await getInstance();

	return await mi.analyzeData(
		buffer.byteLength,
		(chunkSize: number, offset: number) =>
			new Uint8Array(buffer, offset, chunkSize)
	);
}

export function closeParser(): void {
	if (instance) {
		instance.close();
		instance = null;
	}
	initPromise = null;
	initFailed = false;
}
