import { normalizePath, type App, type TFile } from "obsidian";
import type { MediaLensSettings } from "../settings";

async function ensureDirectory(app: App, path: string): Promise<void> {
	const normalized = normalizePath(path);
	if (!app.vault.getAbstractFileByPath(normalized)) {
		await app.vault.createFolder(normalized);
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
	return await app.vault.create(path, content);
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
		await app.vault.createBinary(path, buffer);
	}

	return path;
}
