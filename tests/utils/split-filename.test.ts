import { describe, it, expect } from "vitest";
import { splitFileName } from "../../src/utils/media";

describe("splitFileName", () => {
	it("splits standard filename", () => {
		expect(splitFileName("clip.mp4")).toEqual({ baseName: "clip", ext: ".mp4" });
	});

	it("splits filename with multiple dots", () => {
		expect(splitFileName("my.video.file.mkv")).toEqual({ baseName: "my.video.file", ext: ".mkv" });
	});

	it("handles no extension", () => {
		expect(splitFileName("noext")).toEqual({ baseName: "noext", ext: "" });
	});

	it("handles dotfile (leading dot)", () => {
		expect(splitFileName(".hidden")).toEqual({ baseName: ".hidden", ext: "" });
	});

	it("handles empty string", () => {
		expect(splitFileName("")).toEqual({ baseName: "", ext: "" });
	});

	it("splits PNG capture filename", () => {
		expect(splitFileName("clip_1-23-456.png")).toEqual({ baseName: "clip_1-23-456", ext: ".png" });
	});
});
