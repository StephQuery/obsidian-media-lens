import { describe, it, expect } from "vitest";
import { formatTimestamp, isVideoReady } from "../../src/utils/video-sync";

describe("formatTimestamp", () => {
	it("formats zero", () => {
		expect(formatTimestamp(0)).toBe("0:00.000");
	});

	it("formats seconds with milliseconds", () => {
		expect(formatTimestamp(5.123)).toBe("0:05.123");
	});

	it("formats minutes and seconds", () => {
		expect(formatTimestamp(65.5)).toBe("1:05.500");
	});

	it("formats over an hour", () => {
		expect(formatTimestamp(3661.5)).toBe("61:01.500");
	});

	it("pads seconds to two digits", () => {
		expect(formatTimestamp(3.1)).toBe("0:03.100");
	});

	it("pads milliseconds to three digits", () => {
		expect(formatTimestamp(10.05)).toBe("0:10.050");
	});

	it("handles NaN", () => {
		expect(formatTimestamp(NaN)).toBe("0:00.000");
	});

	it("handles Infinity", () => {
		expect(formatTimestamp(Infinity)).toBe("0:00.000");
	});

	it("handles negative values", () => {
		expect(formatTimestamp(-5)).toBe("0:00.000");
	});
});

describe("isVideoReady", () => {
	function mockVideo(readyState: number, videoWidth: number, videoHeight: number) {
		return { readyState, videoWidth, videoHeight } as HTMLVideoElement;
	}

	it("returns true when readyState >= 2 and dimensions are positive", () => {
		expect(isVideoReady(mockVideo(2, 1920, 1080))).toBe(true);
		expect(isVideoReady(mockVideo(4, 1920, 1080))).toBe(true);
	});

	it("returns false when readyState < 2", () => {
		expect(isVideoReady(mockVideo(0, 1920, 1080))).toBe(false);
		expect(isVideoReady(mockVideo(1, 1920, 1080))).toBe(false);
	});

	it("returns false when videoWidth is 0", () => {
		expect(isVideoReady(mockVideo(4, 0, 1080))).toBe(false);
	});

	it("returns false when videoHeight is 0", () => {
		expect(isVideoReady(mockVideo(4, 1920, 0))).toBe(false);
	});
});
