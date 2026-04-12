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
	it("does not include frontmatter", () => {
		const note = generateSingleNote(
			{ name: "clip.mp4", source: "vault", category: "video", vaultPath: "assets/clip.mp4" },
			testSections,
			"media-lens/assets"
		);
		expect(note).not.toMatch(/^---/);
	});

	it("shows filename above embed", () => {
		const note = generateSingleNote(
			{ name: "clip.mp4", source: "vault", category: "video", vaultPath: "assets/clip.mp4" },
			testSections,
			"media-lens/assets"
		);
		expect(note).toContain("**clip.mp4**");
		const lines = note.split("\n");
		const nameIdx = lines.findIndex(l => l.includes("**clip.mp4**"));
		const embedIdx = lines.findIndex(l => l.includes("![["));
		expect(nameIdx).toBeLessThan(embedIdx);
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

	it("uses vaultPath for external file when provided (e.g. after rename)", () => {
		const note = generateSingleNote(
			{ name: "clip.mp4", source: "external", category: "video", vaultPath: "media-lens/assets/clip (2).mp4" },
			testSections,
			"media-lens/assets"
		);
		expect(note).toContain("![[media-lens/assets/clip (2).mp4]]");
	});

	it("renders metadata in sections with headers", () => {
		const note = generateSingleNote(
			{ name: "clip.mp4", source: "vault", category: "video", vaultPath: "clip.mp4" },
			testSections,
			"media-lens/assets"
		);
		expect(note).toContain("### General");
		expect(note).toContain("### Video");
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

	it("shows filenames above their embeds with divider between", () => {
		const note = generateComparisonNote(
			{ name: "original.mp4", source: "vault", category: "video", vaultPath: "original.mp4" },
			{ name: "compressed.mp4", source: "vault", category: "video", vaultPath: "compressed.mp4" },
			testSections, sectionsB, "media-lens/assets"
		);
		expect(note).toContain("**original.mp4**");
		expect(note).toContain("**compressed.mp4**");
		const lines = note.split("\n");
		const nameA = lines.findIndex(l => l.includes("**original.mp4**"));
		const embedA = lines.findIndex(l => l.includes("![[original.mp4]]"));
		const nameB = lines.findIndex(l => l.includes("**compressed.mp4**"));
		const embedB = lines.findIndex(l => l.includes("![[compressed.mp4]]"));
		// Names come before their embeds
		expect(nameA).toBeLessThan(embedA);
		expect(nameB).toBeLessThan(embedB);
		// Divider between the two files
		const dividerIdx = lines.findIndex((l, i) => i > embedA && l === "---");
		expect(dividerIdx).toBeGreaterThan(embedA);
		expect(dividerIdx).toBeLessThan(nameB);
	});

	it("renders comparison in sections with headers", () => {
		const note = generateComparisonNote(
			{ name: "a.mp4", source: "vault", category: "video", vaultPath: "a.mp4" },
			{ name: "b.mp4", source: "vault", category: "video", vaultPath: "b.mp4" },
			testSections, sectionsB, "media-lens/assets"
		);
		expect(note).toContain("### General");
		expect(note).toContain("### Video");
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

describe("generateSingleNote with captures", () => {
	const captures = [
		{ vaultPath: "media-lens/assets/clip_1-23-456.png", label: "1:23.456", fileName: "clip.mp4" },
	];

	it("includes video embed and captured frames", () => {
		const note = generateSingleNote(
			{ name: "clip.mp4", source: "vault", category: "video", vaultPath: "clip.mp4" },
			testSections,
			"media-lens/assets",
			captures
		);
		expect(note).toContain("![[clip.mp4]]");
		expect(note).toContain("### Captured Frames");
		expect(note).toContain("![[media-lens/assets/clip_1-23-456.png]]");
		expect(note).toContain("@ 1:23.456");
	});
});

describe("generateComparisonNote with captures", () => {
	const sectionsB: MetadataSection[] = [
		{ id: "general", name: "General", defaultExpanded: true, fields: [{ key: "Format", value: "MPEG-4" }] },
	];

	const captures = [
		{ vaultPath: "media-lens/assets/orig_1-23-456.png", label: "1:23.456", fileName: "original.mp4", player: "A" as const },
		{ vaultPath: "media-lens/assets/comp_1-23-456.png", label: "1:23.456", fileName: "compressed.mp4", player: "B" as const },
	];

	it("includes both video embeds and labeled captures", () => {
		const note = generateComparisonNote(
			{ name: "original.mp4", source: "vault", category: "video", vaultPath: "original.mp4" },
			{ name: "compressed.mp4", source: "vault", category: "video", vaultPath: "compressed.mp4" },
			testSections, sectionsB, "media-lens/assets", captures
		);
		expect(note).toContain("![[original.mp4]]");
		expect(note).toContain("![[compressed.mp4]]");
		expect(note).toContain("### Captured Frames");
		expect(note).toContain("**A: original.mp4** @ 1:23.456");
		expect(note).toContain("**B: compressed.mp4** @ 1:23.456");
	});

	it("labels split view captures as A|B", () => {
		const splitCaptures = [
			{ vaultPath: "media-lens/assets/split-view_1-23-456.png", label: "1:23.456", fileName: "Split view comparison", player: "A|B" as const },
			{ vaultPath: "media-lens/assets/orig_1-23-456.png", label: "1:23.456", fileName: "original.mp4", player: "A" as const },
			{ vaultPath: "media-lens/assets/comp_1-23-456.png", label: "1:23.456", fileName: "compressed.mp4", player: "B" as const },
		];
		const note = generateComparisonNote(
			{ name: "original.mp4", source: "vault", category: "video", vaultPath: "original.mp4" },
			{ name: "compressed.mp4", source: "vault", category: "video", vaultPath: "compressed.mp4" },
			testSections, sectionsB, "media-lens/assets", splitCaptures
		);
		expect(note).toContain("**A|B: Split view comparison** @ 1:23.456");
		expect(note).toContain("**A: original.mp4** @ 1:23.456");
		expect(note).toContain("**B: compressed.mp4** @ 1:23.456");
	});

	it("omits player label when no player specified", () => {
		const unlabeled = [
			{ vaultPath: "media-lens/assets/clip_1-23-456.png", label: "1:23.456", fileName: "clip.mp4" },
		];
		const note = generateSingleNote(
			{ name: "clip.mp4", source: "vault", category: "video", vaultPath: "clip.mp4" },
			testSections,
			"media-lens/assets",
			unlabeled
		);
		expect(note).toContain("**clip.mp4** @ 1:23.456");
		expect(note).not.toContain("A:");
		expect(note).not.toContain("B:");
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
