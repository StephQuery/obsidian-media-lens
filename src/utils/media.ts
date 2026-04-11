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
