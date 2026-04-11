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

export async function saveNote(
	app: App,
	content: string,
	noteName: string,
	settings: MediaLensSettings
): Promise<TFile> {
	await ensureDirectory(app, settings.saveNotesDirectory);
	const path = normalizePath(`${settings.saveNotesDirectory}/${noteName}.md`);

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
	const path = normalizePath(`${settings.externalAssetsDirectory}/${fileName}`);

	if (!app.vault.getAbstractFileByPath(path)) {
		try {
			await app.vault.createBinary(path, buffer);
		} catch (err) {
			throw new Error(`Could not copy file "${fileName}" to vault: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	return path;
}
