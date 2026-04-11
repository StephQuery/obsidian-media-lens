import { normalizePath, type App, type TFile } from "obsidian";
import type { MediaLensSettings } from "../settings";

async function ensureDirectory(app: App, path: string): Promise<void> {
	const normalized = normalizePath(path);
	const existing = app.vault.getAbstractFileByPath(normalized);
	if (!existing) {
		try {
			await app.vault.createFolder(normalized);
		} catch (err) {
			throw new Error(`Could not create directory "${normalized}": ${err instanceof Error ? err.message : String(err)}`);
		}
	}
}

function findAvailablePath(app: App, dir: string, baseName: string, ext: string): string {
	let path = normalizePath(`${dir}/${baseName}${ext}`);
	if (!app.vault.getAbstractFileByPath(path)) return path;

	let i = 2;
	while (app.vault.getAbstractFileByPath(path)) {
		path = normalizePath(`${dir}/${baseName} (${i})${ext}`);
		i++;
	}
	return path;
}

function splitFileName(fileName: string): { baseName: string; ext: string } {
	const dotIdx = fileName.lastIndexOf(".");
	if (dotIdx <= 0) return { baseName: fileName, ext: "" };
	return { baseName: fileName.slice(0, dotIdx), ext: fileName.slice(dotIdx) };
}

export async function saveNote(
	app: App,
	content: string,
	noteName: string,
	settings: MediaLensSettings
): Promise<TFile> {
	await ensureDirectory(app, settings.saveNotesDirectory);
	const path = findAvailablePath(app, settings.saveNotesDirectory, noteName, ".md");

	try {
		return await app.vault.create(path, content);
	} catch (err) {
		throw new Error(`Could not save note "${path}": ${err instanceof Error ? err.message : String(err)}`);
	}
}

export async function copyExternalFileToVault(
	app: App,
	buffer: ArrayBuffer,
	fileName: string,
	settings: MediaLensSettings
): Promise<string> {
	await ensureDirectory(app, settings.externalAssetsDirectory);
	const { baseName, ext } = splitFileName(fileName);
	const path = findAvailablePath(app, settings.externalAssetsDirectory, baseName, ext);

	try {
		await app.vault.createBinary(path, buffer);
	} catch (err) {
		throw new Error(`Could not copy file "${fileName}" to vault: ${err instanceof Error ? err.message : String(err)}`);
	}

	return path;
}

export async function saveCaptureToVault(
	app: App,
	blob: Blob,
	fileName: string,
	settings: MediaLensSettings
): Promise<string> {
	await ensureDirectory(app, settings.externalAssetsDirectory);
	const { baseName, ext } = splitFileName(fileName);
	const path = findAvailablePath(app, settings.externalAssetsDirectory, baseName, ext);

	try {
		const buffer = await blob.arrayBuffer();
		await app.vault.createBinary(path, buffer);
	} catch (err) {
		throw new Error(`Could not save capture "${fileName}": ${err instanceof Error ? err.message : String(err)}`);
	}

	return path;
}
