import { describe, it, expect } from "vitest";
import { formatTimestamp } from "../../src/utils/video-sync";

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
});
