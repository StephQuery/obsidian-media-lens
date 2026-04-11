import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import type MediaLensPlugin from "../main";

export const VIEW_TYPE_MEDIA_LENS = "media-lens-view";

interface LoadedFile {
	name: string;
	size: number;
	source: "vault" | "external";
	buffer: ArrayBuffer;
}

export class MediaLensView extends ItemView {
	plugin: MediaLensPlugin;
	primaryFile: LoadedFile | null = null;
	compareFile: LoadedFile | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: MediaLensPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_MEDIA_LENS;
	}

	getDisplayText(): string {
		return "Media Lens";
	}

	getIcon(): string {
		return "film";
	}

	async onOpen() {
		this.render();
	}

	async onClose() {
		this.contentEl.empty();
	}

	clearPrimary() {
		this.primaryFile = null;
		this.render();
	}

	clearCompare() {
		this.compareFile = null;
		this.render();
	}

	clearAll() {
		this.primaryFile = null;
		this.compareFile = null;
		this.render();
	}

	private render() {
		const container = this.contentEl;
		container.empty();
		container.addClass("media-lens-container");

		this.renderDropZone(container, "primary");
		if (this.primaryFile) {
			this.renderDropZone(container, "compare");
		}

		if (this.primaryFile) {
			this.renderMetadata(container);
		} else {
			const hint = container.createDiv({ cls: "media-lens-hint" });
			hint.createEl("span", {
				text: "Supports images, video, audio, and subtitles",
			});
		}
	}

	private renderDropZone(
		parent: HTMLElement,
		slot: "primary" | "compare"
	) {
		const file = slot === "primary" ? this.primaryFile : this.compareFile;

		if (file) {
			this.renderFileHeader(parent, file, slot);
			return;
		}

		const zone = parent.createDiv({ cls: "media-lens-drop-zone" });
		const isPrimary = slot === "primary";

		const icon = zone.createDiv({ cls: "media-lens-drop-icon" });
		icon.innerHTML = isPrimary ? this.uploadIcon() : this.diffIcon();

		zone.createEl("span", {
			text: isPrimary ? "Drop a file to inspect" : "Drop a file to compare",
			cls: "media-lens-drop-label",
		});

		const actions = zone.createDiv({ cls: "media-lens-drop-actions" });

		const browseBtn = actions.createEl("button", {
			text: "Browse vault",
			cls: "media-lens-btn media-lens-btn-secondary",
		});
		browseBtn.addEventListener("click", () => this.browseVault(slot));

		const activeBtn = actions.createEl("button", {
			text: "Active file",
			cls: "media-lens-btn media-lens-btn-secondary",
		});
		activeBtn.addEventListener("click", () => this.loadActiveFile(slot));

		// Drag-and-drop
		zone.addEventListener("dragover", (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			zone.addClass("media-lens-drop-zone--over");
		});

		zone.addEventListener("dragleave", (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			zone.removeClass("media-lens-drop-zone--over");
		});

		zone.addEventListener("drop", async (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			zone.removeClass("media-lens-drop-zone--over");
			await this.handleDrop(e, slot);
		});
	}

	private renderFileHeader(
		parent: HTMLElement,
		file: LoadedFile,
		slot: "primary" | "compare"
	) {
		const header = parent.createDiv({ cls: "media-lens-file-header" });

		const info = header.createDiv({ cls: "media-lens-file-info" });
		info.createEl("span", {
			text: file.name,
			cls: "media-lens-file-name",
		});
		info.createEl("span", {
			text: this.formatSize(file.size),
			cls: "media-lens-file-size",
		});

		const clearBtn = header.createEl("button", {
			cls: "media-lens-btn-clear",
			attr: { "aria-label": "Remove file" },
		});
		clearBtn.innerHTML = this.closeIcon();
		clearBtn.addEventListener("click", () => {
			if (slot === "primary") this.clearPrimary();
			else this.clearCompare();
		});
	}

	private renderMetadata(parent: HTMLElement) {
		const section = parent.createDiv({ cls: "media-lens-metadata" });
		section.createEl("p", {
			text: "Metadata parsing coming soon...",
			cls: "media-lens-muted",
		});
	}

	private async handleDrop(e: DragEvent, slot: "primary" | "compare") {
		// External files from OS
		const droppedFile = e.dataTransfer?.files?.[0];
		if (droppedFile) {
			const buffer = await droppedFile.arrayBuffer();
			this.setFile(slot, {
				name: droppedFile.name,
				size: buffer.byteLength,
				source: "external",
				buffer,
			});
			return;
		}

		// Vault files (internal Obsidian drag)
		const path = e.dataTransfer?.getData("text/plain");
		if (path) {
			await this.loadVaultFile(path, slot);
		}
	}

	private async browseVault(slot: "primary" | "compare") {
		const files = this.app.vault.getFiles();
		const mediaFiles = files.filter((f) => this.isSupportedExtension(f.extension));

		if (mediaFiles.length === 0) {
			return;
		}

		// Use Obsidian's built-in fuzzy suggest modal
		const { FuzzySuggestModal } = await import("obsidian");

		const modal = new (class extends FuzzySuggestModal<TFile> {
			getItems() {
				return mediaFiles;
			}
			getItemText(item: TFile) {
				return item.path;
			}
			async onChooseItem(item: TFile) {
				await self.loadVaultFile(item.path, slot);
			}
		})(this.app);

		const self = this;
		modal.open();
	}

	private async loadActiveFile(slot: "primary" | "compare") {
		const file = this.app.workspace.getActiveFile();
		if (file) {
			await this.loadVaultFile(file.path, slot);
		}
	}

	private async loadVaultFile(path: string, slot: "primary" | "compare") {
		const abstractFile = this.app.vault.getAbstractFileByPath(path);
		if (!(abstractFile instanceof TFile)) return;

		const buffer = await this.app.vault.readBinary(abstractFile);
		this.setFile(slot, {
			name: abstractFile.name,
			size: buffer.byteLength,
			source: "vault",
			buffer,
		});
	}

	private setFile(slot: "primary" | "compare", file: LoadedFile) {
		if (slot === "primary") {
			this.primaryFile = file;
		} else {
			this.compareFile = file;
		}
		this.render();
	}

	private isSupportedExtension(ext: string): boolean {
		const supported = new Set([
			"jpg", "jpeg", "png", "gif", "webp", "tif", "tiff", "bmp", "svg",
			"mp4", "m4v", "mkv", "avi", "mov", "webm",
			"mp3", "flac", "wav", "aac", "m4a", "ogg", "oga",
			"srt", "vtt", "ass", "ssa",
		]);
		return supported.has(ext.toLowerCase());
	}

	private formatSize(bytes: number): string {
		if (bytes === 0) return "0 B";
		const units = ["B", "KB", "MB", "GB"];
		const i = Math.floor(Math.log(bytes) / Math.log(1024));
		return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + " " + units[i];
	}

	// Inline SVG icons (Lucide-style, 18px)
	private uploadIcon(): string {
		return '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';
	}

	private diffIcon(): string {
		return '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="12" y1="4" x2="12" y2="20"/></svg>';
	}

	private closeIcon(): string {
		return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
	}
}
