import { App, PluginSettingTab, Setting } from "obsidian";
import type MediaLensPlugin from "./main";

export interface MediaLensSettings {
	saveNotesDirectory: string;
	externalAssetsDirectory: string;
}

export const DEFAULT_SETTINGS: MediaLensSettings = {
	saveNotesDirectory: "media-lens",
	externalAssetsDirectory: "media-lens/assets",
};

export class MediaLensSettingTab extends PluginSettingTab {
	plugin: MediaLensPlugin;

	constructor(app: App, plugin: MediaLensPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Save notes directory")
			.setDesc("The vault folder where inspection notes are saved")
			.addText((text) =>
				text
		.setPlaceholder("media-lens")
					.setValue(this.plugin.settings.saveNotesDirectory)
					.onChange(async (value) => {
						this.plugin.settings.saveNotesDirectory = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("External file assets directory")
			.setDesc(
				"Vault folder where external files are copied when saving a note"
			)
			.addText((text) =>
				text
		.setPlaceholder("media-lens/assets")
					.setValue(this.plugin.settings.externalAssetsDirectory)
					.onChange(async (value) => {
						this.plugin.settings.externalAssetsDirectory = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
