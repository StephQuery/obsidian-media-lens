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
	private objectUrls: string[] = [];

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
		this.revokeObjectUrls();
		this.contentEl.empty();
	}

	private revokeObjectUrls() {
		for (const url of this.objectUrls) {
			URL.revokeObjectURL(url);
		}
		this.objectUrls = [];
	}

	private createObjectUrl(buffer: ArrayBuffer, mimeType: string): string {
		const url = URL.createObjectURL(new Blob([buffer], { type: mimeType }));
		this.objectUrls.push(url);
		return url;
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
		this.revokeObjectUrls();
		const container = this.contentEl;
		container.empty();
		container.addClass("media-lens-container");

		this.renderDropZone(container, "primary");
		if (this.primaryFile) {
			this.renderPreview(container, this.primaryFile);
		}
		this.renderDropZone(container, "compare");
		if (this.compareFile) {
			this.renderPreview(container, this.compareFile);
		}

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

	private renderPreview(parent: HTMLElement, file: LoadedFile) {
		const wrapper = parent.createDiv({ cls: "media-lens-preview" });
		const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
		const mime = this.getMimeType(ext, file.category);

		switch (file.category) {
			case "image": {
				if (ext === "svg") {
					const url = this.createObjectUrl(file.buffer, "image/svg+xml");
					const img = wrapper.createEl("img", {
						cls: "media-lens-preview-img",
						attr: { src: url, alt: file.name },
					});
					img.addEventListener("error", () => {
						wrapper.empty();
						wrapper.createEl("span", { text: "Preview unavailable", cls: "media-lens-muted" });
					});
				} else {
					const url = this.createObjectUrl(file.buffer, mime);
					const img = wrapper.createEl("img", {
						cls: "media-lens-preview-img",
						attr: { src: url, alt: file.name },
					});
					img.addEventListener("error", () => {
						wrapper.empty();
						wrapper.createEl("span", { text: "Preview unavailable", cls: "media-lens-muted" });
					});
				}
				break;
			}
			case "video": {
				const url = this.createObjectUrl(file.buffer, mime);
				wrapper.createEl("video", {
					cls: "media-lens-preview-video",
					attr: { src: url, controls: "true", preload: "metadata" },
				});
				break;
			}
			case "audio": {
				const url = this.createObjectUrl(file.buffer, mime);
				wrapper.createEl("audio", {
					cls: "media-lens-preview-audio",
					attr: { src: url, controls: "true", preload: "metadata" },
				});
				break;
			}
			case "subtitle": {
				// Show first few lines of subtitle text
				try {
					const text = new TextDecoder().decode(file.buffer);
					const preview = text.slice(0, 500) + (text.length > 500 ? "\n..." : "");
					wrapper.createEl("pre", {
						text: preview,
						cls: "media-lens-preview-text",
					});
				} catch {
					wrapper.createEl("span", { text: "Preview unavailable", cls: "media-lens-muted" });
				}
				break;
			}
		}
	}

	private getMimeType(ext: string, category: MediaCategory): string {
		const mimeMap: Record<string, string> = {
			jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
			gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
			tif: "image/tiff", tiff: "image/tiff", svg: "image/svg+xml",
			mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime",
			mkv: "video/x-matroska", avi: "video/x-msvideo", webm: "video/webm",
			mp3: "audio/mpeg", flac: "audio/flac", wav: "audio/wav",
			aac: "audio/aac", m4a: "audio/mp4", ogg: "audio/ogg", oga: "audio/ogg",
		};
		const fallback: Record<MediaCategory, string> = {
			image: "image/png", video: "video/mp4", audio: "audio/mpeg", subtitle: "text/plain",
		};
		return mimeMap[ext] ?? fallback[category];
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

	private renderComparison(parent: HTMLElement, a: LoadedFile, b: LoadedFile) {
		const allSectionIds = new Map<string, { nameA?: string; nameB?: string }>();

		for (const s of a.sections) {
			allSectionIds.set(s.id, { nameA: s.name });
		}
		for (const s of b.sections) {
			const existing = allSectionIds.get(s.id);
			if (existing) {
				existing.nameB = s.name;
			} else {
				allSectionIds.set(s.id, { nameB: s.name });
			}
		}

		const sectionsA = new Map(a.sections.map(s => [s.id, s]));
		const sectionsB = new Map(b.sections.map(s => [s.id, s]));

		for (const [id, names] of allSectionIds) {
			const sA = sectionsA.get(id);
			const sB = sectionsB.get(id);
			const sectionName = names.nameA ?? names.nameB ?? id;

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

			const wrapper = parent.createDiv({ cls: "media-lens-section" });
			const header = wrapper.createDiv({ cls: "media-lens-section-header" });
			const chevron = header.createSpan({ cls: "media-lens-section-chevron" });
			setIcon(chevron, "chevron-down");
			header.createSpan({ text: sectionName });

			const body = wrapper.createDiv({ cls: "media-lens-section-body" });

			// Column headers
			const headerRow = body.createDiv({ cls: "media-lens-compare-row media-lens-compare-header" });
			headerRow.createSpan({ text: "Field", cls: "media-lens-compare-key" });
			headerRow.createSpan({ text: a.name, cls: "media-lens-compare-val" });
			headerRow.createSpan({ text: b.name, cls: "media-lens-compare-val" });

			for (const key of allKeys) {
				const valA = fieldsA.get(key) ?? "—";
				const valB = fieldsB.get(key) ?? "—";
				const isDiff = valA !== valB;

				const row = body.createDiv({
					cls: `media-lens-compare-row${isDiff ? " media-lens-compare-row--diff" : ""}`,
				});
				row.createSpan({ text: key, cls: "media-lens-compare-key" });
				row.createSpan({ text: valA, cls: "media-lens-compare-val" });
				row.createSpan({ text: valB, cls: "media-lens-compare-val" });
			}

			header.addEventListener("click", () => {
				body.toggleClass("media-lens-section-body--collapsed",
					!body.hasClass("media-lens-section-body--collapsed"));
				chevron.toggleClass("media-lens-section-chevron--collapsed",
					body.hasClass("media-lens-section-body--collapsed"));
			});
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
