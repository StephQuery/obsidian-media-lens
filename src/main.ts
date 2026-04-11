import { normalizePath, Plugin, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, MediaLensSettingTab } from "./settings";
import { MediaLensView, VIEW_TYPE_MEDIA_LENS } from "./views/MediaLensView";
import { closeParser } from "./parsers/media-info-parser";
import type { MediaLensSettings } from "./settings";

export default class MediaLensPlugin extends Plugin {
	settings: MediaLensSettings;

	getWasmUrl(): string {
		const dir = this.manifest.dir ?? "";
		const wasmPath = normalizePath(`${dir}/MediaInfoModule.wasm`);
		return this.app.vault.adapter.getResourcePath(wasmPath);
	}

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_MEDIA_LENS,
			(leaf) => new MediaLensView(leaf, this)
		);

		this.addRibbonIcon("film", "Open media lens", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "show-panel",
			name: "Show panel",
			callback: () => {
				void this.activateView();
			},
		});

		this.addCommand({
			id: "clear-panel",
			name: "Clear panel",
			callback: () => {
				const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_MEDIA_LENS)[0];
				if (leaf?.view instanceof MediaLensView) {
					leaf.view.clearAll();
				}
			},
		});

		this.addCommand({
			id: "save-inspection",
			name: "Save inspection to note",
			callback: () => {
				const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_MEDIA_LENS)[0];
				if (leaf?.view instanceof MediaLensView) {
					void leaf.view.handleSave();
				}
			},
		});

		this.addSettingTab(new MediaLensSettingTab(this.app, this));
	}

	onunload() {
		closeParser();
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null =
			workspace.getLeavesOfType(VIEW_TYPE_MEDIA_LENS)[0] ?? null;

		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				await rightLeaf.setViewState({
					type: VIEW_TYPE_MEDIA_LENS,
					active: true,
				});
				leaf = rightLeaf;
			}
		}

		if (leaf) {
			await workspace.revealLeaf(leaf);
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<MediaLensSettings> | null
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
