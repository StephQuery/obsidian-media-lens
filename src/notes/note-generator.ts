import type { MetadataSection } from "../parsers/types";

interface NoteFile {
	name: string;
	source: "vault" | "external";
	category: string;
	vaultPath?: string;
}

function timestamp(): string {
	return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
}

function buildTable(sections: MetadataSection[]): string {
	const lines: string[] = ["| Field | Value |", "|-------|-------|"];
	for (const section of sections) {
		for (const field of section.fields) {
			lines.push(`| ${field.key} | ${field.value} |`);
		}
	}
	return lines.join("\n");
}

function buildComparisonTable(
	sectionsA: MetadataSection[],
	sectionsB: MetadataSection[],
	nameA: string,
	nameB: string
): string {
	const lines: string[] = [
		`| Field | ${nameA} | ${nameB} |`,
		"|-------|-------|-------|",
	];

	const allSectionIds = new Map<string, true>();
	for (const s of sectionsA) allSectionIds.set(s.id, true);
	for (const s of sectionsB) allSectionIds.set(s.id, true);

	const mapA = new Map(sectionsA.map(s => [s.id, s]));
	const mapB = new Map(sectionsB.map(s => [s.id, s]));

	for (const id of allSectionIds.keys()) {
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

		const fieldsA = new Map((sA?.fields ?? []).map(f => [f.key, f.value]));
		const fieldsB = new Map((sB?.fields ?? []).map(f => [f.key, f.value]));

		for (const key of allKeys) {
			const valA = fieldsA.get(key) ?? "—";
			const valB = fieldsB.get(key) ?? "—";
			const isDiff = valA !== valB;
			if (isDiff) {
				lines.push(`| ${key} | **${valA}** | **${valB}** |`);
			} else {
				lines.push(`| ${key} | ${valA} | ${valB} |`);
			}
		}
	}

	return lines.join("\n");
}

function embedPath(file: NoteFile, assetsDir: string): string {
	if (file.source === "vault" && file.vaultPath) {
		return file.vaultPath;
	}
	return `${assetsDir}/${file.name}`;
}

export function generateSingleNote(
	file: NoteFile,
	sections: MetadataSection[],
	assetsDir: string
): string {
	const path = embedPath(file, assetsDir);
	const lines = [
		"---",
		"media_lens: true",
		`file: "${file.name}"`,
		`type: ${file.category}`,
		`inspected: ${new Date().toISOString()}`,
		"---",
		"",
		`![[${path}]]`,
		"",
		buildTable(sections),
		"",
	];
	return lines.join("\n");
}

export function generateComparisonNote(
	fileA: NoteFile,
	fileB: NoteFile,
	sectionsA: MetadataSection[],
	sectionsB: MetadataSection[],
	assetsDir: string
): string {
	const pathA = embedPath(fileA, assetsDir);
	const pathB = embedPath(fileB, assetsDir);
	const lines = [
		"---",
		"media_lens: true",
		"comparison: true",
		`file_a: "${fileA.name}"`,
		`file_b: "${fileB.name}"`,
		`inspected: ${new Date().toISOString()}`,
		"---",
		"",
		`![[${pathA}]]`,
		`![[${pathB}]]`,
		"",
		buildComparisonTable(sectionsA, sectionsB, fileA.name, fileB.name),
		"",
	];
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
