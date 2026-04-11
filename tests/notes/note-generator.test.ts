import { describe, it, expect, vi } from "vitest";
import {
	generateSingleNote,
	generateComparisonNote,
	generateNoteName,
} from "../../src/notes/note-generator";
import type { MetadataSection } from "../../src/parsers/types";

const testSections: MetadataSection[] = [
	{
		id: "general",
		name: "General",
		defaultExpanded: true,
		fields: [
			{ key: "Format", value: "MPEG-4" },
			{ key: "Duration", value: "2:34" },
		],
	},
	{
		id: "video-0",
		name: "Video",
		defaultExpanded: true,
		fields: [
			{ key: "Codec", value: "AVC" },
			{ key: "Resolution", value: "1920x1080" },
			{ key: "Bitrate", value: "8.0 Mbps" },
		],
	},
];

describe("generateSingleNote", () => {
	it("includes YAML frontmatter", () => {
		const note = generateSingleNote(
			{ name: "clip.mp4", source: "vault", category: "video", vaultPath: "assets/clip.mp4" },
			testSections,
			"media-lens/assets"
		);
		expect(note).toContain("---");
		expect(note).toContain("media_lens: true");
		expect(note).toContain('file: "clip.mp4"');
		expect(note).toContain("type: video");
		expect(note).toContain("inspected:");
	});

	it("embeds vault file with vault path", () => {
		const note = generateSingleNote(
			{ name: "clip.mp4", source: "vault", category: "video", vaultPath: "assets/clip.mp4" },
			testSections,
			"media-lens/assets"
		);
		expect(note).toContain("![[assets/clip.mp4]]");
	});

	it("embeds external file with assets path", () => {
		const note = generateSingleNote(
			{ name: "clip.mp4", source: "external", category: "video" },
			testSections,
			"media-lens/assets"
		);
		expect(note).toContain("![[media-lens/assets/clip.mp4]]");
	});

	it("renders metadata table with all fields", () => {
		const note = generateSingleNote(
			{ name: "clip.mp4", source: "vault", category: "video", vaultPath: "clip.mp4" },
			testSections,
			"media-lens/assets"
		);
		expect(note).toContain("| Field | Value |");
		expect(note).toContain("| Format | MPEG-4 |");
		expect(note).toContain("| Codec | AVC |");
		expect(note).toContain("| Resolution | 1920x1080 |");
		expect(note).toContain("| Bitrate | 8.0 Mbps |");
	});
});

describe("generateComparisonNote", () => {
	const sectionsB: MetadataSection[] = [
		{
			id: "general",
			name: "General",
			defaultExpanded: true,
			fields: [
				{ key: "Format", value: "MPEG-4" },
				{ key: "Duration", value: "2:34" },
			],
		},
		{
			id: "video-0",
			name: "Video",
			defaultExpanded: true,
			fields: [
				{ key: "Codec", value: "HEVC" },
				{ key: "Resolution", value: "1920x1080" },
				{ key: "Bitrate", value: "4.0 Mbps" },
			],
		},
	];

	it("includes comparison frontmatter", () => {
		const note = generateComparisonNote(
			{ name: "original.mp4", source: "vault", category: "video", vaultPath: "original.mp4" },
			{ name: "compressed.mp4", source: "vault", category: "video", vaultPath: "compressed.mp4" },
			testSections, sectionsB, "media-lens/assets"
		);
		expect(note).toContain("comparison: true");
		expect(note).toContain('file_a: "original.mp4"');
		expect(note).toContain('file_b: "compressed.mp4"');
	});

	it("embeds both files", () => {
		const note = generateComparisonNote(
			{ name: "original.mp4", source: "vault", category: "video", vaultPath: "original.mp4" },
			{ name: "compressed.mp4", source: "vault", category: "video", vaultPath: "compressed.mp4" },
			testSections, sectionsB, "media-lens/assets"
		);
		expect(note).toContain("![[original.mp4]]");
		expect(note).toContain("![[compressed.mp4]]");
	});

	it("renders three-column comparison table", () => {
		const note = generateComparisonNote(
			{ name: "a.mp4", source: "vault", category: "video", vaultPath: "a.mp4" },
			{ name: "b.mp4", source: "vault", category: "video", vaultPath: "b.mp4" },
			testSections, sectionsB, "media-lens/assets"
		);
		expect(note).toContain("| Field | a.mp4 | b.mp4 |");
	});

	it("bolds differing values", () => {
		const note = generateComparisonNote(
			{ name: "a.mp4", source: "vault", category: "video", vaultPath: "a.mp4" },
			{ name: "b.mp4", source: "vault", category: "video", vaultPath: "b.mp4" },
			testSections, sectionsB, "media-lens/assets"
		);
		expect(note).toContain("| Codec | **AVC** | **HEVC** |");
		expect(note).toContain("| Bitrate | **8.0 Mbps** | **4.0 Mbps** |");
	});

	it("does not bold matching values", () => {
		const note = generateComparisonNote(
			{ name: "a.mp4", source: "vault", category: "video", vaultPath: "a.mp4" },
			{ name: "b.mp4", source: "vault", category: "video", vaultPath: "b.mp4" },
			testSections, sectionsB, "media-lens/assets"
		);
		expect(note).toContain("| Format | MPEG-4 | MPEG-4 |");
		expect(note).toContain("| Resolution | 1920x1080 | 1920x1080 |");
	});
});

describe("generateNoteName", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-04-10T14:30:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("generates single file name with timestamp", () => {
		const name = generateNoteName("clip.mp4");
		expect(name).toBe("clip_2026-04-10T14-30");
	});

	it("generates comparison name with both files", () => {
		const name = generateNoteName("original.mp4", "compressed.mp4");
		expect(name).toBe("original-vs-compressed_2026-04-10T14-30");
	});

	it("strips file extension from name", () => {
		const name = generateNoteName("my.video.file.mkv");
		expect(name).toBe("my.video.file_2026-04-10T14-30");
	});
});
