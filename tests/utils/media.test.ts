import { describe, it, expect } from "vitest";
import {
	getCategory,
	isSupportedExtension,
	getCategoryLabel,
	formatSize,
	getAcceptString,
	getMimeType,
} from "../../src/utils/media";

describe("getCategory", () => {
	it("identifies image files", () => {
		expect(getCategory("photo.jpg")).toBe("image");
		expect(getCategory("photo.jpeg")).toBe("image");
		expect(getCategory("photo.png")).toBe("image");
		expect(getCategory("photo.gif")).toBe("image");
		expect(getCategory("photo.webp")).toBe("image");
		expect(getCategory("photo.tif")).toBe("image");
		expect(getCategory("photo.tiff")).toBe("image");
		expect(getCategory("photo.bmp")).toBe("image");
		expect(getCategory("photo.svg")).toBe("image");
	});

	it("identifies video files", () => {
		expect(getCategory("clip.mp4")).toBe("video");
		expect(getCategory("clip.m4v")).toBe("video");
		expect(getCategory("clip.mkv")).toBe("video");
		expect(getCategory("clip.avi")).toBe("video");
		expect(getCategory("clip.mov")).toBe("video");
		expect(getCategory("clip.webm")).toBe("video");
	});

	it("identifies audio files", () => {
		expect(getCategory("song.mp3")).toBe("audio");
		expect(getCategory("song.flac")).toBe("audio");
		expect(getCategory("song.wav")).toBe("audio");
		expect(getCategory("song.aac")).toBe("audio");
		expect(getCategory("song.m4a")).toBe("audio");
		expect(getCategory("song.ogg")).toBe("audio");
		expect(getCategory("song.oga")).toBe("audio");
	});

	it("identifies subtitle files", () => {
		expect(getCategory("subs.srt")).toBe("subtitle");
		expect(getCategory("subs.vtt")).toBe("subtitle");
		expect(getCategory("subs.ass")).toBe("subtitle");
		expect(getCategory("subs.ssa")).toBe("subtitle");
	});

	it("returns null for unsupported files", () => {
		expect(getCategory("notes.md")).toBeNull();
		expect(getCategory("data.json")).toBeNull();
		expect(getCategory("script.js")).toBeNull();
		expect(getCategory("noextension")).toBeNull();
	});

	it("is case-insensitive", () => {
		expect(getCategory("photo.JPG")).toBe("image");
		expect(getCategory("clip.MP4")).toBe("video");
		expect(getCategory("song.FLAC")).toBe("audio");
	});

	it("handles files with multiple dots", () => {
		expect(getCategory("my.vacation.photo.jpg")).toBe("image");
		expect(getCategory("file.backup.mp4")).toBe("video");
	});
});

describe("isSupportedExtension", () => {
	it("returns true for supported extensions", () => {
		expect(isSupportedExtension("jpg")).toBe(true);
		expect(isSupportedExtension("mp4")).toBe(true);
		expect(isSupportedExtension("mp3")).toBe(true);
		expect(isSupportedExtension("srt")).toBe(true);
	});

	it("returns false for unsupported extensions", () => {
		expect(isSupportedExtension("md")).toBe(false);
		expect(isSupportedExtension("json")).toBe(false);
		expect(isSupportedExtension("txt")).toBe(false);
	});
});

describe("getCategoryLabel", () => {
	it("returns human-readable labels", () => {
		expect(getCategoryLabel("image")).toBe("image");
		expect(getCategoryLabel("video")).toBe("video");
		expect(getCategoryLabel("audio")).toBe("audio file");
		expect(getCategoryLabel("subtitle")).toBe("subtitle file");
	});
});

describe("formatSize", () => {
	it("formats zero bytes", () => {
		expect(formatSize(0)).toBe("0 B");
	});

	it("formats bytes", () => {
		expect(formatSize(500)).toBe("500 B");
	});

	it("formats kilobytes", () => {
		expect(formatSize(1024)).toBe("1.0 KB");
		expect(formatSize(1536)).toBe("1.5 KB");
	});

	it("formats megabytes", () => {
		expect(formatSize(1048576)).toBe("1.0 MB");
		expect(formatSize(3355443)).toBe("3.2 MB");
	});

	it("formats gigabytes", () => {
		expect(formatSize(1073741824)).toBe("1.0 GB");
	});
});

describe("getAcceptString", () => {
	it("returns all media types when category is null", () => {
		const accept = getAcceptString(null);
		expect(accept).toContain("image/*");
		expect(accept).toContain("video/*");
		expect(accept).toContain("audio/*");
		expect(accept).toContain(".srt");
	});

	it("returns image accept string", () => {
		const accept = getAcceptString("image");
		expect(accept).toContain("image/*");
		expect(accept).not.toContain("video/*");
		expect(accept).not.toContain("audio/*");
	});

	it("returns video accept string", () => {
		const accept = getAcceptString("video");
		expect(accept).toContain("video/*");
		expect(accept).toContain(".mkv");
		expect(accept).not.toContain("image/*");
	});

	it("returns audio accept string", () => {
		const accept = getAcceptString("audio");
		expect(accept).toContain("audio/*");
		expect(accept).not.toContain("video/*");
	});

	it("returns subtitle accept string", () => {
		const accept = getAcceptString("subtitle");
		expect(accept).toContain(".srt");
		expect(accept).toContain(".vtt");
		expect(accept).toContain(".ass");
		expect(accept).toContain(".ssa");
		expect(accept).not.toContain("image/*");
	});
});

describe("getMimeType", () => {
	it("returns correct MIME for common image formats", () => {
		expect(getMimeType("jpg", "image")).toBe("image/jpeg");
		expect(getMimeType("jpeg", "image")).toBe("image/jpeg");
		expect(getMimeType("png", "image")).toBe("image/png");
		expect(getMimeType("gif", "image")).toBe("image/gif");
		expect(getMimeType("webp", "image")).toBe("image/webp");
		expect(getMimeType("svg", "image")).toBe("image/svg+xml");
	});

	it("returns correct MIME for video formats", () => {
		expect(getMimeType("mp4", "video")).toBe("video/mp4");
		expect(getMimeType("mov", "video")).toBe("video/quicktime");
		expect(getMimeType("mkv", "video")).toBe("video/x-matroska");
		expect(getMimeType("webm", "video")).toBe("video/webm");
	});

	it("returns correct MIME for audio formats", () => {
		expect(getMimeType("mp3", "audio")).toBe("audio/mpeg");
		expect(getMimeType("flac", "audio")).toBe("audio/flac");
		expect(getMimeType("wav", "audio")).toBe("audio/wav");
		expect(getMimeType("ogg", "audio")).toBe("audio/ogg");
		expect(getMimeType("m4a", "audio")).toBe("audio/mp4");
	});

	it("falls back to category default for unknown extensions", () => {
		expect(getMimeType("xyz", "image")).toBe("image/png");
		expect(getMimeType("xyz", "video")).toBe("video/mp4");
		expect(getMimeType("xyz", "audio")).toBe("audio/mpeg");
		expect(getMimeType("xyz", "subtitle")).toBe("text/plain");
	});
});
