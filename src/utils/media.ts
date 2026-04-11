export type MediaCategory = "image" | "video" | "audio" | "subtitle";

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "tif", "tiff", "bmp", "svg"]);
const VIDEO_EXTS = new Set(["mp4", "m4v", "mkv", "avi", "mov", "webm"]);
const AUDIO_EXTS = new Set(["mp3", "flac", "wav", "aac", "m4a", "ogg", "oga"]);
const SUBTITLE_EXTS = new Set(["srt", "vtt", "ass", "ssa"]);

export function getCategory(filename: string): MediaCategory | null {
	const ext = filename.split(".").pop()?.toLowerCase() ?? "";
	if (IMAGE_EXTS.has(ext)) return "image";
	if (VIDEO_EXTS.has(ext)) return "video";
	if (AUDIO_EXTS.has(ext)) return "audio";
	if (SUBTITLE_EXTS.has(ext)) return "subtitle";
	return null;
}

export function isSupportedExtension(ext: string): boolean {
	return getCategory("file." + ext) !== null;
}

export function getCategoryLabel(category: MediaCategory): string {
	const labels: Record<MediaCategory, string> = {
		image: "image",
		video: "video",
		audio: "audio file",
		subtitle: "subtitle file",
	};
	return labels[category];
}

export function formatSize(bytes: number): string {
	if (bytes === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + " " + units[i];
}

export function getMimeType(ext: string, category: MediaCategory): string {
	const mimeMap: Record<string, string> = {
		jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
		gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
		tif: "image/tiff", tiff: "image/tiff", svg: "image/svg+xml",
		mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime",
		mkv: "video/x-matroska", avi: "video/x-msvideo", webm: "video/webm",
		mp3: "audio/mpeg", flac: "audio/flac", wav: "audio/wav",
		aac: "audio/aac", m4a: "audio/mp4", ogg: "audio/ogg", oga: "audio/ogg",
	};
	const fallback: Record<MediaCategory, string> = {
		image: "image/png", video: "video/mp4", audio: "audio/mpeg", subtitle: "text/plain",
	};
	return mimeMap[ext] ?? fallback[category];
}

export function getAcceptString(category: MediaCategory | null): string {
	if (category) {
		const accepts: Record<MediaCategory, string> = {
			image: "image/*,.tif,.tiff,.bmp,.svg",
			video: "video/*,.mkv",
			audio: "audio/*,.flac,.ogg,.oga",
			subtitle: ".srt,.vtt,.ass,.ssa",
		};
		return accepts[category];
	}
	return "image/*,video/*,audio/*,.mkv,.flac,.ogg,.oga,.srt,.vtt,.ass,.ssa,.tif,.tiff,.bmp,.svg";
}
