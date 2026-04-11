import { ItemView, Notice, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import type MediaLensPlugin from "../main";

export const VIEW_TYPE_MEDIA_LENS = "media-lens-view";

type MediaCategory = "image" | "video" | "audio" | "subtitle";

interface LoadedFile {
	name: string;
	size: number;
	source: "vault" | "external";
	buffer: ArrayBuffer;
	category: MediaCategory;
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
		return "Media lens";
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
		this.renderDropZone(container, "compare");

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

		const isPrimary = slot === "primary";
		const disabled = !isPrimary && !this.primaryFile;

		const zone = parent.createDiv({
			cls: `media-lens-drop-zone${disabled ? " media-lens-drop-zone--disabled" : ""}`,
		});

		const iconEl = zone.createDiv({ cls: "media-lens-drop-icon" });
		setIcon(iconEl, isPrimary ? "upload" : "columns-2");

		let label: string;
		if (isPrimary) {
			label = "Drop a file to inspect";
		} else if (this.primaryFile) {
			const typeLabel = this.getCategoryLabel(this.primaryFile.category);
			label = `Drop another ${typeLabel} to compare`;
		} else {
			label = "Add a file above to compare";
		}

		zone.createEl("span", {
			text: label,
			cls: "media-lens-drop-label",
		});

		if (!disabled) {
			const actions = zone.createDiv({ cls: "media-lens-drop-actions" });

			const browseBtn = actions.createEl("button", {
				text: "Browse files",
				cls: "media-lens-btn media-lens-btn-secondary",
			});
			browseBtn.addEventListener("click", () => {
				this.browseFiles(slot);
			});

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

			zone.addEventListener("drop", (e: DragEvent) => {
				e.preventDefault();
				e.stopPropagation();
				zone.removeClass("media-lens-drop-zone--over");
				void this.handleDrop(e, slot);
			});
		}
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
		setIcon(clearBtn, "x");
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
		const droppedFile = e.dataTransfer?.files?.[0];
		if (droppedFile) {
			const category = this.getCategory(droppedFile.name);
			if (!category) {
				new Notice("Unsupported file type");
				return;
			}
			const buffer = await droppedFile.arrayBuffer();
			this.setFile(slot, {
				name: droppedFile.name,
				size: buffer.byteLength,
				source: "external",
				buffer,
				category,
			});
			return;
		}

		const path = e.dataTransfer?.getData("text/plain");
		if (path) {
			await this.loadVaultFile(path, slot);
		}
	}

	private browseFiles(slot: "primary" | "compare") {
		const accept = this.getAcceptString(slot);
		const input = document.createElement("input");
		input.type = "file";
		input.accept = accept;
		input.addClass("media-lens-hidden");

		input.addEventListener("change", () => {
			const file = input.files?.[0];
			if (file) {
				void this.loadExternalFile(file, slot);
			}
			input.remove();
		});

		document.body.appendChild(input);
		input.click();
	}

	private getAcceptString(slot: "primary" | "compare"): string {
		if (slot === "compare" && this.primaryFile) {
			const accepts: Record<MediaCategory, string> = {
				image: "image/*,.tif,.tiff,.bmp,.svg",
				video: "video/*,.mkv",
				audio: "audio/*,.flac,.ogg,.oga",
				subtitle: ".srt,.vtt,.ass,.ssa",
			};
			return accepts[this.primaryFile.category];
		}
		return "image/*,video/*,audio/*,.mkv,.flac,.ogg,.oga,.srt,.vtt,.ass,.ssa,.tif,.tiff,.bmp,.svg";
	}

	private async loadExternalFile(file: File, slot: "primary" | "compare") {
		const category = this.getCategory(file.name);
		if (!category) {
			new Notice("Unsupported file type");
			return;
		}
		const buffer = await file.arrayBuffer();
		this.setFile(slot, {
			name: file.name,
			size: buffer.byteLength,
			source: "external",
			buffer,
			category,
		});
	}

	private async loadVaultFile(path: string, slot: "primary" | "compare") {
		const abstractFile = this.app.vault.getAbstractFileByPath(path);
		if (!(abstractFile instanceof TFile)) return;

		const category = this.getCategory(abstractFile.name);
		if (!category) {
			new Notice("Unsupported file type");
			return;
		}

		const buffer = await this.app.vault.readBinary(abstractFile);
		this.setFile(slot, {
			name: abstractFile.name,
			size: buffer.byteLength,
			source: "vault",
			buffer,
			category,
		});
	}

	private setFile(slot: "primary" | "compare", file: LoadedFile) {
		if (slot === "compare" && this.primaryFile) {
			if (file.category !== this.primaryFile.category) {
				const expected = this.getCategoryLabel(this.primaryFile.category);
				new Notice(`Cannot compare: expected ${expected}, got ${this.getCategoryLabel(file.category)}`);
				return;
			}
		}

		if (slot === "primary") {
			this.primaryFile = file;
			if (this.compareFile && this.compareFile.category !== file.category) {
				this.compareFile = null;
			}
		} else {
			this.compareFile = file;
		}
		this.render();
	}

	private getCategory(filename: string): MediaCategory | null {
		const ext = filename.split(".").pop()?.toLowerCase() ?? "";
		const imageExts = new Set(["jpg", "jpeg", "png", "gif", "webp", "tif", "tiff", "bmp", "svg"]);
		const videoExts = new Set(["mp4", "m4v", "mkv", "avi", "mov", "webm"]);
		const audioExts = new Set(["mp3", "flac", "wav", "aac", "m4a", "ogg", "oga"]);
		const subtitleExts = new Set(["srt", "vtt", "ass", "ssa"]);

		if (imageExts.has(ext)) return "image";
		if (videoExts.has(ext)) return "video";
		if (audioExts.has(ext)) return "audio";
		if (subtitleExts.has(ext)) return "subtitle";
		return null;
	}

	private isSupportedExtension(ext: string): boolean {
		return this.getCategory("file." + ext) !== null;
	}

	private getCategoryLabel(category: MediaCategory): string {
		const labels: Record<MediaCategory, string> = {
			image: "image",
			video: "video",
			audio: "audio file",
			subtitle: "subtitle file",
		};
		return labels[category];
	}

	private formatSize(bytes: number): string {
		if (bytes === 0) return "0 B";
		const units = ["B", "KB", "MB", "GB"];
		const i = Math.floor(Math.log(bytes) / Math.log(1024));
		return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + " " + units[i];
	}
}
