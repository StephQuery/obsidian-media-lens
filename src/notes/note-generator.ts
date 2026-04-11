import type { MetadataSection } from "../parsers/types";

interface NoteFile {
	name: string;
	source: "vault" | "external";
	category: string;
	vaultPath?: string;
}

export interface NoteCapture {
	vaultPath: string;
	label: string;
	fileName: string;
	player?: "A" | "B";
}

function timestamp(): string {
	return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
}

function buildSections(sections: MetadataSection[]): string {
	const parts: string[] = [];
	for (const section of sections) {
		if (section.fields.length === 0) continue;
		parts.push(`### ${section.name}`);
		parts.push("");
		parts.push("| Field | Value |");
		parts.push("|-------|-------|");
		for (const field of section.fields) {
			parts.push(`| ${field.key} | ${field.value} |`);
		}
		parts.push("");
	}
	return parts.join("\n");
}

function buildComparisonSections(
	sectionsA: MetadataSection[],
	sectionsB: MetadataSection[],
	nameA: string,
	nameB: string
): string {
	const allSectionIds = new Map<string, string>();
	for (const s of sectionsA) allSectionIds.set(s.id, s.name);
	for (const s of sectionsB) {
		if (!allSectionIds.has(s.id)) allSectionIds.set(s.id, s.name);
	}

	const mapA = new Map(sectionsA.map(s => [s.id, s]));
	const mapB = new Map(sectionsB.map(s => [s.id, s]));
	const parts: string[] = [];

	for (const [id, sectionName] of allSectionIds) {
		const sA = mapA.get(id);
		const sB = mapB.get(id);

		const allKeys: string[] = [];
		const seen = new Set<string>();
		for (const f of sA?.fields ?? []) {
			if (!seen.has(f.key)) { allKeys.push(f.key); seen.add(f.key); }
		}
		for (const f of sB?.fields ?? []) {
			if (!seen.has(f.key)) { allKeys.push(f.key); seen.add(f.key); }
		}

		if (allKeys.length === 0) continue;

		const fieldsA = new Map((sA?.fields ?? []).map(f => [f.key, f.value]));
		const fieldsB = new Map((sB?.fields ?? []).map(f => [f.key, f.value]));

		parts.push(`### ${sectionName}`);
		parts.push("");
		parts.push(`| Field | ${nameA} | ${nameB} |`);
		parts.push("|-------|-------|-------|");

		for (const key of allKeys) {
			const valA = fieldsA.get(key) ?? "—";
			const valB = fieldsB.get(key) ?? "—";
			const isDiff = valA !== valB;
			if (isDiff) {
				parts.push(`| ${key} | **${valA}** | **${valB}** |`);
			} else {
				parts.push(`| ${key} | ${valA} | ${valB} |`);
			}
		}
		parts.push("");
	}

	return parts.join("\n");
}

function embedPath(file: NoteFile, assetsDir: string): string {
	if (file.source === "vault" && file.vaultPath) {
		return file.vaultPath;
	}
	return `${assetsDir}/${file.name}`;
}

function buildCaptures(captures: NoteCapture[]): string {
	if (captures.length === 0) return "";
	const lines = ["### Captured Frames", ""];
	for (const cap of captures) {
		const prefix = cap.player ? `${cap.player}: ` : "";
		lines.push(`**${prefix}${cap.fileName}** @ ${cap.label}`);
		lines.push("");
		lines.push(`![[${cap.vaultPath}]]`);
		lines.push("");
	}
	return lines.join("\n");
}

export function generateSingleNote(
	file: NoteFile,
	sections: MetadataSection[],
	assetsDir: string,
	captures: NoteCapture[] = []
): string {
	const path = embedPath(file, assetsDir);
	const lines = [
		`**${file.name}**`,
		"",
		`![[${path}]]`,
		"",
	];
	if (captures.length > 0) {
		lines.push(buildCaptures(captures), "");
	}
	lines.push(buildSections(sections), "");
	return lines.join("\n");
}

export function generateComparisonNote(
	fileA: NoteFile,
	fileB: NoteFile,
	sectionsA: MetadataSection[],
	sectionsB: MetadataSection[],
	assetsDir: string,
	captures: NoteCapture[] = []
): string {
	const pathA = embedPath(fileA, assetsDir);
	const pathB = embedPath(fileB, assetsDir);
	const lines: string[] = [
		`**${fileA.name}**`, "",
		`![[${pathA}]]`, "",
		"---", "",
		`**${fileB.name}**`, "",
		`![[${pathB}]]`, "",
	];
	if (captures.length > 0) {
		lines.push("---", "", buildCaptures(captures), "");
	}
	lines.push("---", "");

	lines.push(buildComparisonSections(sectionsA, sectionsB, fileA.name, fileB.name), "");
	return lines.join("\n");
}

export function generateNoteName(fileName: string, compareFileName?: string): string {
	const base = fileName.replace(/\.[^.]+$/, "");
	if (compareFileName) {
		const compareBase = compareFileName.replace(/\.[^.]+$/, "");
		return `${base}-vs-${compareBase}_${timestamp()}`;
	}
	return `${base}_${timestamp()}`;
}
