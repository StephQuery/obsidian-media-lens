import { ItemView, Notice, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import type MediaLensPlugin from "../main";
import {
	formatSize,
	getAcceptString,
	getCategory,
	getCategoryLabel,
	getMimeType,
} from "../utils/media";
import type { MediaCategory } from "../utils/media";
import { parseBuffer } from "../parsers/media-info-parser";
import { normalizeTracks } from "../parsers/track-normalizer";
import type { MetadataSection } from "../parsers/types";
import { generateSingleNote, generateComparisonNote, generateNoteName } from "../notes/note-generator";
import { saveNote, copyExternalFileToVault } from "../notes/note-writer";

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
	private syncEnabled = false;
	private primaryVideo: HTMLVideoElement | null = null;
	private compareVideo: HTMLVideoElement | null = null;
	private syncing = false; // guard against infinite loops

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
		this.primaryVideo = null;
		this.compareVideo = null;
		const container = this.contentEl;
		container.empty();
		container.addClass("media-lens-container");

		this.renderDropZone(container, "primary");
		if (this.primaryFile) {
			this.renderPreview(container, this.primaryFile, "primary");
		}
		this.renderDropZone(container, "compare");
		if (this.compareFile) {
			this.renderPreview(container, this.compareFile, "compare");
		}

		if (this.primaryVideo && this.compareVideo) {
			this.renderSyncToggle(container);
		}

		if (this.primaryFile) {
			this.renderSaveButton(container);
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

	private renderPreview(parent: HTMLElement, file: LoadedFile, slot: "primary" | "compare") {
		const wrapper = parent.createDiv({ cls: "media-lens-preview" });
		const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
		const mime = getMimeType(ext, file.category);

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
				const video = wrapper.createEl("video", {
					cls: "media-lens-preview-video",
					attr: { src: url, controls: "true", preload: "metadata" },
				});
				if (slot === "primary") this.primaryVideo = video;
				else this.compareVideo = video;
				this.attachSyncListeners(video, slot);
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


	private renderSaveButton(parent: HTMLElement) {
		const wrapper = parent.createDiv({ cls: "media-lens-save-bar" });
		const label = this.compareFile ? "Save comparison" : "Save to note";
		const btn = wrapper.createEl("button", {
			text: label,
			cls: "media-lens-btn media-lens-btn-save",
		});
		btn.addEventListener("click", () => {
			void this.handleSave();
		});
	}

	private renderSyncToggle(parent: HTMLElement) {
		const wrapper = parent.createDiv({ cls: "media-lens-sync-bar" });
		const btn = wrapper.createEl("button", {
			cls: `media-lens-btn media-lens-btn-sync${this.syncEnabled ? " media-lens-btn-sync--active" : ""}`,
		});
		const iconEl = btn.createSpan();
		setIcon(iconEl, "link");
		btn.createSpan({ text: this.syncEnabled ? "Synced" : "Sync playback" });

		btn.addEventListener("click", () => {
			this.syncEnabled = !this.syncEnabled;
			btn.toggleClass("media-lens-btn-sync--active", this.syncEnabled);
			const label = btn.querySelector("span:last-child");
			if (label) label.textContent = this.syncEnabled ? "Synced" : "Sync playback";

			if (this.syncEnabled && this.primaryVideo && this.compareVideo) {
				this.compareVideo.currentTime = this.primaryVideo.currentTime;
				if (!this.primaryVideo.paused) {
					void this.compareVideo.play();
				}
			}
		});
	}

	private attachSyncListeners(video: HTMLVideoElement, slot: "primary" | "compare") {
		const getOther = () => slot === "primary" ? this.compareVideo : this.primaryVideo;

		video.addEventListener("play", () => {
			if (!this.syncEnabled || this.syncing) return;
			const other = getOther();
			if (other) {
				this.syncing = true;
				void other.play().finally(() => { this.syncing = false; });
			}
		});

		video.addEventListener("pause", () => {
			if (!this.syncEnabled || this.syncing) return;
			const other = getOther();
			if (other) {
				this.syncing = true;
				other.pause();
				this.syncing = false;
			}
		});

		video.addEventListener("seeked", () => {
			if (!this.syncEnabled || this.syncing) return;
			const other = getOther();
			if (other) {
				this.syncing = true;
				other.currentTime = video.currentTime;
				this.syncing = false;
			}
		});
	}

	async handleSave() {
		if (!this.primaryFile) return;

		const settings = this.plugin.settings;
		const assetsDir = settings.externalAssetsDirectory;

		try {
			// Copy external files into vault so embeds work
			let primaryPath = this.primaryFile.name;
			if (this.primaryFile.source === "external") {
				primaryPath = await copyExternalFileToVault(
					this.app, this.primaryFile.buffer, this.primaryFile.name, settings
				);
			}

			let content: string;
			let noteName: string;

			if (this.compareFile) {
				let comparePath = this.compareFile.name;
				if (this.compareFile.source === "external") {
					comparePath = await copyExternalFileToVault(
						this.app, this.compareFile.buffer, this.compareFile.name, settings
					);
				}

				content = generateComparisonNote(
					{ name: this.primaryFile.name, source: this.primaryFile.source, category: this.primaryFile.category, vaultPath: primaryPath },
					{ name: this.compareFile.name, source: this.compareFile.source, category: this.compareFile.category, vaultPath: comparePath },
					this.primaryFile.sections,
					this.compareFile.sections,
					assetsDir
				);
				noteName = generateNoteName(this.primaryFile.name, this.compareFile.name);
			} else {
				content = generateSingleNote(
					{ name: this.primaryFile.name, source: this.primaryFile.source, category: this.primaryFile.category, vaultPath: primaryPath },
					this.primaryFile.sections,
					assetsDir
				);
				noteName = generateNoteName(this.primaryFile.name);
			}

			const file = await saveNote(this.app, content, noteName, settings);
			await this.app.workspace.getLeaf("tab").openFile(file);
			new Notice("Saved inspection note");
		} catch (err) {
			console.error("Media Lens: save error", err);
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`Failed to save note: ${msg}`);
		}
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
			new Notice(`Unsupported file type: ${name.split(".").pop() ?? "unknown"}`);
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
			const msg = err instanceof Error ? err.message : "Unknown error";
			if (msg.includes("WASM")) {
				new Notice("Failed to load media parser. Try reloading the plugin.");
			} else {
				new Notice(`Failed to parse "${name}": ${msg}`);
			}
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
