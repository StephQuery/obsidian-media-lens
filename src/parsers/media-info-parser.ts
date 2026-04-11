import type { MediaInfoResult, ReadChunkFunc } from "mediainfo.js";

interface MediaInfoInstance {
	analyzeData(size: number, readChunk: ReadChunkFunc): Promise<MediaInfoResult>;
	close(): void;
}

let instance: MediaInfoInstance | null = null;

async function getInstance(wasmUrl: string): Promise<MediaInfoInstance> {
	if (instance) return instance;

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
}

/**
 * Parse a media file buffer using mediainfo.js.
 * @param buffer The file contents as an ArrayBuffer
 * @param wasmUrl Absolute URL to MediaInfoModule.wasm (use app.vault.adapter.getResourcePath())
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
}
