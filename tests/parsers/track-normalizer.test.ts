import { describe, it, expect } from "vitest";
import { normalizeTracks } from "../../src/parsers/track-normalizer";
import type { MediaInfoResult } from "mediainfo.js";

function makeResult(tracks: Record<string, unknown>[]): MediaInfoResult {
	return {
		media: { track: tracks },
		creatingLibrary: { name: "test", version: "0", url: "", compiledDate: "" },
	} as unknown as MediaInfoResult;
}

describe("normalizeTracks", () => {
	it("returns empty array for empty result", () => {
		const result = makeResult([]);
		expect(normalizeTracks(result)).toEqual([]);
	});

	it("handles missing media property", () => {
		const result = { creatingLibrary: {} } as unknown as MediaInfoResult;
		expect(normalizeTracks(result)).toEqual([]);
	});

	it("normalizes a General track", () => {
		const result = makeResult([{
			"@type": "General",
			Format: "MPEG-4",
			Duration: 154.5,
			OverallBitRate: 12_000_000,
			FileSize: 52428800,
		}]);
		const sections = normalizeTracks(result);
		expect(sections).toHaveLength(1);
		expect(sections[0].id).toBe("general");
		expect(sections[0].name).toBe("General");
		expect(sections[0].defaultExpanded).toBe(true);

		const fields = Object.fromEntries(sections[0].fields.map(f => [f.key, f.value]));
		expect(fields["Format"]).toBe("MPEG-4");
		expect(fields["Duration"]).toBe("2:34");
		expect(fields["Overall bitrate"]).toBe("12.0 Mbps");
		expect(fields["File size"]).toBe("50.0 MB");
	});

	it("normalizes a Video track", () => {
		const result = makeResult([{
			"@type": "Video",
			Format: "AVC",
			Format_Profile: "High@L4.1",
			Width: 1920,
			Height: 1080,
			FrameRate: 29.97,
			BitRate: 8_000_000,
			BitDepth: 8,
		}]);
		const sections = normalizeTracks(result);
		expect(sections).toHaveLength(1);
		expect(sections[0].id).toBe("video-0");
		expect(sections[0].name).toBe("Video");

		const fields = Object.fromEntries(sections[0].fields.map(f => [f.key, f.value]));
		expect(fields["Codec"]).toBe("AVC");
		expect(fields["Codec profile"]).toBe("High@L4.1");
		expect(fields["Resolution"]).toBe("1920x1080");
		expect(fields["Frame rate"]).toBe("29.97 fps");
		expect(fields["Bitrate"]).toBe("8.0 Mbps");
		expect(fields["Bit depth"]).toBe("8 bit");
	});

	it("normalizes an Audio track", () => {
		const result = makeResult([{
			"@type": "Audio",
			Format: "AAC",
			BitRate: 128000,
			Channels: 2,
			SamplingRate: 48000,
			ChannelLayout: "L R",
		}]);
		const sections = normalizeTracks(result);
		expect(sections).toHaveLength(1);
		expect(sections[0].id).toBe("audio-0");

		const fields = Object.fromEntries(sections[0].fields.map(f => [f.key, f.value]));
		expect(fields["Codec"]).toBe("AAC");
		expect(fields["Bitrate"]).toBe("128 kbps");
		expect(fields["Channels"]).toBe("2");
		expect(fields["Sampling rate"]).toBe("48000 Hz");
		expect(fields["Channel layout"]).toBe("L R");
	});

	it("normalizes a Text track", () => {
		const result = makeResult([{
			"@type": "Text",
			Format: "SRT",
			Language_String: "English",
		}]);
		const sections = normalizeTracks(result);
		expect(sections).toHaveLength(1);
		expect(sections[0].id).toBe("text-0");
		expect(sections[0].defaultExpanded).toBe(false);
	});

	it("normalizes an Image track", () => {
		const result = makeResult([{
			"@type": "Image",
			Format: "JPEG",
			Width: 4032,
			Height: 3024,
			BitDepth: 8,
		}]);
		const sections = normalizeTracks(result);
		expect(sections).toHaveLength(1);
		expect(sections[0].id).toBe("image-0");

		const fields = Object.fromEntries(sections[0].fields.map(f => [f.key, f.value]));
		expect(fields["Resolution"]).toBe("4032x3024");
	});

	it("handles multiple tracks with correct numbering", () => {
		const result = makeResult([
			{ "@type": "General", Format: "MPEG-4" },
			{ "@type": "Video", Format: "AVC", Width: 1920, Height: 1080 },
			{ "@type": "Audio", Format: "AAC", Channels: 2 },
			{ "@type": "Audio", Format: "AC-3", Channels: 6 },
		]);
		const sections = normalizeTracks(result);
		expect(sections).toHaveLength(4);
		expect(sections[0].name).toBe("General");
		expect(sections[1].name).toBe("Video");
		expect(sections[2].name).toBe("Audio");
		expect(sections[3].name).toBe("Audio #2");
	});

	it("skips fields with undefined or empty values", () => {
		const result = makeResult([{
			"@type": "Video",
			Format: "AVC",
			Width: undefined,
			Height: undefined,
			HDR_Format: "",
		}]);
		const sections = normalizeTracks(result);
		const keys = sections[0].fields.map(f => f.key);
		expect(keys).toContain("Codec");
		expect(keys).not.toContain("Resolution");
		expect(keys).not.toContain("HDR format");
	});

	it("ignores unknown track types", () => {
		const result = makeResult([
			{ "@type": "Menu" },
			{ "@type": "Other" },
		]);
		expect(normalizeTracks(result)).toEqual([]);
	});
});
