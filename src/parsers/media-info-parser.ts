import type { MediaInfoResult, ReadChunkFunc } from "mediainfo.js";

interface MediaInfoInstance {
	analyzeData(size: number, readChunk: ReadChunkFunc): Promise<MediaInfoResult>;
	close(): void;
}

let instance: MediaInfoInstance | null = null;
let initFailed = false;

async function getInstance(wasmUrl: string): Promise<MediaInfoInstance> {
	if (instance) return instance;
	if (initFailed) throw new Error("MediaInfo WASM failed to load previously. Reload the plugin to retry.");

	try {
		const { mediaInfoFactory } = await import("mediainfo.js");

		const mi = await (mediaInfoFactory as (opts: {
			format: "object";
			locateFile: () => string;
		}) => Promise<MediaInfoInstance>)({
			format: "object",
			locateFile: () => wasmUrl,
		});

		instance = mi;
		return mi;
	} catch (err) {
		initFailed = true;
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to initialize MediaInfo WASM module: ${msg}`);
	}
}

/**
 * Parse a media file buffer using mediainfo.js.
 * @param buffer The file contents as an ArrayBuffer
 * @param wasmUrl Absolute URL to MediaInfoModule.wasm
 */
export async function parseBuffer(
	buffer: ArrayBuffer,
	wasmUrl: string
): Promise<MediaInfoResult> {
	const mi = await getInstance(wasmUrl);

	return await mi.analyzeData(
		buffer.byteLength,
		(chunkSize: number, offset: number) =>
			new Uint8Array(buffer.slice(offset, offset + chunkSize))
	);
}

export function closeParser() {
	if (instance) {
		instance.close();
		instance = null;
	}
	initFailed = false;
}
