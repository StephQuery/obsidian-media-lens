import { ItemView, Notice, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import type MediaLensPlugin from "../main";
import {
	formatSize,
	getAcceptString,
	getCategory,
	getCategoryLabel,
} from "../utils/media";
import type { MediaCategory } from "../utils/media";
import { parseBuffer } from "../parsers/media-info-parser";
import { normalizeTracks } from "../parsers/track-normalizer";
import type { MetadataSection } from "../parsers/types";

export const VIEW_TYPE_MEDIA_LENS = "media-lens-view";

interface LoadedFile {
	name: string;
	size: number;
	source: "vault" | "external";
	buffer: ArrayBuffer;
	category: MediaCategory;
	sections: MetadataSection[];
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

		if (this.primaryFile && this.compareFile) {
			this.renderComparison(container, this.primaryFile, this.compareFile);
		} else if (this.primaryFile) {
			this.renderSections(container, this.primaryFile.sections);
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
			const typeLabel = getCategoryLabel(this.primaryFile.category);
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
			text: formatSize(file.size),
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

	private renderSections(parent: HTMLElement, sections: MetadataSection[]) {
		for (const section of sections) {
			if (section.fields.length === 0) continue;

			const wrapper = parent.createDiv({ cls: "media-lens-section" });
			const header = wrapper.createDiv({ cls: "media-lens-section-header" });

			const chevron = header.createSpan({ cls: "media-lens-section-chevron" });
			setIcon(chevron, "chevron-down");

			header.createSpan({ text: section.name });

			const body = wrapper.createDiv({ cls: "media-lens-section-body" });

			if (!section.defaultExpanded) {
				body.addClass("media-lens-section-body--collapsed");
				chevron.addClass("media-lens-section-chevron--collapsed");
			}

			header.addEventListener("click", () => {
				body.toggleClass("media-lens-section-body--collapsed",
					!body.hasClass("media-lens-section-body--collapsed"));
				chevron.toggleClass("media-lens-section-chevron--collapsed",
					body.hasClass("media-lens-section-body--collapsed"));
			});

			for (const field of section.fields) {
				const row = body.createDiv({ cls: "media-lens-field" });
				row.createSpan({ text: field.key, cls: "media-lens-field-key" });
				row.createSpan({ text: field.value, cls: "media-lens-field-value" });
			}
		}
	}

	private async handleDrop(e: DragEvent, slot: "primary" | "compare") {
		const droppedFile = e.dataTransfer?.files?.[0];
		if (droppedFile) {
			await this.loadFile(droppedFile.name, await droppedFile.arrayBuffer(), "external", slot);
			return;
		}

		const path = e.dataTransfer?.getData("text/plain");
		if (path) {
			const abstractFile = this.app.vault.getAbstractFileByPath(path);
			if (abstractFile instanceof TFile) {
				const buffer = await this.app.vault.readBinary(abstractFile);
				await this.loadFile(abstractFile.name, buffer, "vault", slot);
			}
		}
	}

	private browseFiles(slot: "primary" | "compare") {
		const primaryCategory = this.primaryFile?.category ?? null;
		const accept = slot === "compare" && primaryCategory
			? getAcceptString(primaryCategory)
			: getAcceptString(null);
		const input = document.createElement("input");
		input.type = "file";
		input.accept = accept;
		input.classList.add("media-lens-hidden");

		const cleanup = () => { input.remove(); };

		input.addEventListener("change", () => {
			const file = input.files?.[0];
			if (file) {
				void this.loadFile(file.name, file.arrayBuffer(), "external", slot);
			}
			cleanup();
		});

		window.addEventListener("focus", cleanup, { once: true });

		document.body.appendChild(input);
		input.click();
	}

	private async loadFile(
		name: string,
		bufferOrPromise: ArrayBuffer | Promise<ArrayBuffer>,
		source: "vault" | "external",
		slot: "primary" | "compare"
	) {
		const category = getCategory(name);
		if (!category) {
			new Notice("Unsupported file type");
			return;
		}

		try {
			const buffer = await bufferOrPromise;
			const wasmUrl = this.plugin.getWasmUrl();
			const result = await parseBuffer(buffer, wasmUrl);
			const sections = normalizeTracks(result);
			this.setFile(slot, { name, size: buffer.byteLength, source, buffer, category, sections });
		} catch (err) {
			console.error("Media Lens: parse error", err);
			new Notice("Failed to read file metadata");
		}
	}

	private setFile(slot: "primary" | "compare", file: LoadedFile) {
		if (slot === "compare" && this.primaryFile) {
			if (file.category !== this.primaryFile.category) {
				const expected = getCategoryLabel(this.primaryFile.category);
				new Notice(`Cannot compare: expected ${expected}, got ${getCategoryLabel(file.category)}`);
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
}
