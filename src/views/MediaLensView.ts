import { ItemView, normalizePath, Notice, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import type MediaLensPlugin from "../main";
import {
	formatSize,
	getAcceptString,
	getCategory,
	getCategoryLabel,
	getMimeType,
	MAX_FILE_SIZE,
} from "../utils/media";
import type { MediaCategory } from "../utils/media";
import { parseBuffer } from "../parsers/media-info-parser";
import { normalizeTracks } from "../parsers/track-normalizer";
import type { MetadataSection } from "../parsers/types";
import { generateSingleNote, generateComparisonNote, generateNoteName } from "../notes/note-generator";
import type { NoteCapture } from "../notes/note-generator";
import { saveNote, copyExternalFileToVault, saveCaptureToVault } from "../notes/note-writer";
import { openSplitViewModal } from "./SplitViewModal";
import { formatTimestamp, isVideoReady } from "../utils/video-sync";
import { renderSyncTransport } from "./sync-transport";

export const VIEW_TYPE_MEDIA_LENS = "media-lens-view";

const TEMP_DIR = ".media-lens-temp";

interface LoadedFile {
	name: string;
	path: string;
	size: number;
	source: "vault" | "external";
	buffer: ArrayBuffer;
	category: MediaCategory;
	sections: MetadataSection[];
	fileRef?: File;
	mediaUrl?: string;
	tempVaultPath?: string;
}

export class MediaLensView extends ItemView {
	plugin: MediaLensPlugin;
	primaryFile: LoadedFile | null = null;
	compareFile: LoadedFile | null = null;
	private captureStripUrls: string[] = [];
	private docListeners: Array<{ type: string; handler: EventListener }> = [];
	private syncEnabled = false;
	private primaryVideo: HTMLVideoElement | null = null;
	private compareVideo: HTMLVideoElement | null = null;
	private driftCleanup: (() => void) | null = null;
	private primaryAbort: AbortController | null = null;
	private compareAbort: AbortController | null = null;
	private captures: Array<{ slot: "primary" | "compare" | "split-view"; timestamp: number; blob: Blob; label: string }> = [];
	private captureStripEl: HTMLElement | null = null;

	// Persistent zone containers — created once in onOpen, selectively rebuilt
	private primaryZone: HTMLElement | null = null;
	private compareZone: HTMLElement | null = null;
	private transportZone: HTMLElement | null = null;
	private actionZone: HTMLElement | null = null;
	private captureZone: HTMLElement | null = null;
	private metadataZone: HTMLElement | null = null;
	private prevState: { primaryName: string | null; compareName: string | null; syncEnabled: boolean } | null = null;

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
		const container = this.contentEl;
		container.addClass("media-lens-container");
		this.primaryZone = container.createDiv({ cls: "media-lens-zone" });
		this.compareZone = container.createDiv({ cls: "media-lens-zone" });
		this.transportZone = container.createDiv({ cls: "media-lens-zone" });
		this.actionZone = container.createDiv({ cls: "media-lens-zone" });
		this.captureZone = container.createDiv({ cls: "media-lens-zone" });
		this.metadataZone = container.createDiv({ cls: "media-lens-zone" });
		await super.onOpen();
		this.render();
	}

	async onClose() {
		if (this.driftCleanup) {
			this.driftCleanup();
			this.driftCleanup = null;
		}
		this.primaryAbort?.abort();
		this.compareAbort?.abort();
		this.primaryAbort = null;
		this.compareAbort = null;
		this.removeDocListeners();
		this.revokeFileMediaUrl(this.primaryFile);
		this.revokeFileMediaUrl(this.compareFile);
		await this.removeTempFile(this.primaryFile);
		await this.removeTempFile(this.compareFile);
		this.revokeCaptureUrls();
		this.contentEl.empty();
	}

	private log(msg: string, ...args: unknown[]) {
		console.debug(`[Media Lens] ${msg}`, ...args);
	}

	private logError(msg: string, ...args: unknown[]) {
		console.error(`[Media Lens] ${msg}`, ...args);
	}

	private revokeCaptureUrls() {
		for (const url of this.captureStripUrls) URL.revokeObjectURL(url);
		this.captureStripUrls = [];
	}

	private revokeFileMediaUrl(file: LoadedFile | null) {
		if (!file?.mediaUrl) return;
		this.log(`revokeFileMediaUrl: revoking mediaUrl for "${file.name}" (source=${file.source})`);
		if (file.mediaUrl.startsWith("blob:")) {
			URL.revokeObjectURL(file.mediaUrl);
		}
		file.mediaUrl = undefined;
	}

	private addDocListener(type: string, handler: EventListener) {
		document.addEventListener(type, handler);
		this.docListeners.push({ type, handler });
	}

	private removeDocListeners() {
		for (const { type, handler } of this.docListeners) {
			document.removeEventListener(type, handler);
		}
		this.docListeners = [];
	}

	private async getMediaUrl(file: LoadedFile, mimeType: string): Promise<string> {
		if (file.mediaUrl) {
			this.log(`getMediaUrl: reusing cached URL for "${file.name}" → ${file.mediaUrl.slice(0, 60)}…`);
			return file.mediaUrl;
		}
		let url: string;
		let method: string;
		if (file.source === "vault") {
			url = this.app.vault.adapter.getResourcePath(normalizePath(file.path));
			method = "vault resourcePath";
		} else if (file.category === "video" || file.category === "audio") {
			// Video/audio blob URLs don't support range requests in Electron's app:// origin.
			// Write to a temp vault file and use Obsidian's native resource path.
			const tempPath = await this.writeTempFile(file);
			url = this.app.vault.adapter.getResourcePath(normalizePath(tempPath));
			file.tempVaultPath = tempPath;
			method = `temp vault file → resourcePath (${tempPath})`;
		} else {
			// Images and subtitles work fine with blob URLs
			url = URL.createObjectURL(new Blob([file.buffer], { type: mimeType }));
			method = "blob objectURL";
		}
		file.mediaUrl = url;
		this.log(`getMediaUrl: created URL for "${file.name}" via ${method} → ${url.slice(0, 120)}…`);
		return url;
	}

	private async writeTempFile(file: LoadedFile): Promise<string> {
		const tempDir = normalizePath(TEMP_DIR);
		if (!this.app.vault.getAbstractFileByPath(tempDir)) {
			this.log(`writeTempFile: creating temp directory "${tempDir}"`);
			try {
				await this.app.vault.createFolder(tempDir);
			} catch {
				// Folder may already exist from a race or prior run
			}
		}
		const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
		const tempPath = normalizePath(`${TEMP_DIR}/${id}.${ext}`);
		this.log(`writeTempFile: writing "${file.name}" (${file.buffer.byteLength} bytes) → "${tempPath}"`);
		await this.app.vault.createBinary(tempPath, file.buffer);
		this.log(`writeTempFile: write complete`);
		return tempPath;
	}

	private async removeTempFile(file: LoadedFile | null) {
		if (!file?.tempVaultPath) return;
		const path = file.tempVaultPath;
		file.tempVaultPath = undefined;
		try {
			const abstractFile = this.app.vault.getAbstractFileByPath(path);
			if (abstractFile) {
				this.log(`removeTempFile: deleting "${path}"`);
				await this.app.fileManager.trashFile(abstractFile);
			}
		} catch (err) {
			this.logError(`removeTempFile: failed to delete "${path}"`, err);
		}
	}

	clearPrimary() {
		this.revokeFileMediaUrl(this.primaryFile);
		this.revokeFileMediaUrl(this.compareFile);
		void this.removeTempFile(this.primaryFile);
		void this.removeTempFile(this.compareFile);
		this.primaryFile = null;
		this.compareFile = null;
		this.syncEnabled = false;
		this.captures = [];
		this.render();
	}

	clearCompare() {
		this.revokeFileMediaUrl(this.compareFile);
		void this.removeTempFile(this.compareFile);
		this.compareFile = null;
		this.captures = [];
		this.render();
	}

	clearAll() {
		this.revokeFileMediaUrl(this.primaryFile);
		this.revokeFileMediaUrl(this.compareFile);
		void this.removeTempFile(this.primaryFile);
		void this.removeTempFile(this.compareFile);
		this.primaryFile = null;
		this.compareFile = null;
		this.syncEnabled = false;
		this.captures = [];
		this.render();
	}

	private render() {
		const prev = this.prevState;
		const curr = {
			primaryName: this.primaryFile?.name ?? null,
			compareName: this.compareFile?.name ?? null,
			syncEnabled: this.syncEnabled,
		};
		this.log(`render: primary="${curr.primaryName ?? "none"}" compare="${curr.compareName ?? "none"}" sync=${curr.syncEnabled}`);

		const firstRender = prev === null;
		const primaryChanged = firstRender || prev.primaryName !== curr.primaryName;
		const compareChanged = firstRender || prev.compareName !== curr.compareName;
		const syncChanged = firstRender || prev.syncEnabled !== curr.syncEnabled;

		// Rebuild video zones when their file or sync state changed.
		// Compare zone also rebuilds when primary changes (drop zone depends on primary state).
		const pendingZones: Promise<void>[] = [];
		if (primaryChanged || syncChanged) {
			pendingZones.push(this.rebuildPrimaryZone());
		}
		if (compareChanged || primaryChanged || syncChanged) {
			pendingZones.push(this.rebuildCompareZone());
		}

		// Lightweight zones rebuild synchronously first, then again after
		// async video zones complete (so video refs are available for buttons).
		this.rebuildTransportZone();
		this.rebuildActionZone();
		this.rebuildCaptureZone();
		this.rebuildMetadataZone();

		if (pendingZones.length > 0) {
			void Promise.all(pendingZones).then(() => {
				this.rebuildTransportZone();
				this.rebuildActionZone();
			});
		}

		// Update synced CSS class
		this.contentEl.toggleClass("media-lens--synced",
			this.syncEnabled && this.primaryFile !== null && this.compareFile !== null);

		this.prevState = curr;
	}

	private async rebuildPrimaryZone() {
		if (!this.primaryZone) return;
		this.log("rebuildPrimaryZone");
		this.primaryAbort?.abort();
		this.primaryAbort = new AbortController();
		this.primaryVideo = null;
		this.primaryZone.empty();

		const synced = this.syncEnabled && this.primaryFile !== null && this.compareFile !== null;
		if (synced && this.primaryFile && this.compareFile) {
			// Synced mode: combined header, no individual file headers
			this.renderSyncedHeader(this.primaryZone, this.primaryFile, this.compareFile);
		} else {
			this.renderDropZone(this.primaryZone, "primary");
		}
		if (this.primaryFile) {
			await this.renderPreview(this.primaryZone, this.primaryFile, "primary");
		}
	}

	private async rebuildCompareZone() {
		if (!this.compareZone) return;
		this.log("rebuildCompareZone");
		this.compareAbort?.abort();
		this.compareAbort = new AbortController();
		this.compareVideo = null;
		this.compareZone.empty();

		const synced = this.syncEnabled && this.primaryFile !== null && this.compareFile !== null;
		if (!synced) {
			// Only show individual drop zone / file header in non-synced mode
			this.renderDropZone(this.compareZone, "compare");
		}
		if (this.compareFile) {
			await this.renderPreview(this.compareZone, this.compareFile, "compare");
		}
	}

	private rebuildTransportZone() {
		if (!this.transportZone) return;
		this.removeDocListeners();
		if (this.driftCleanup) {
			this.driftCleanup();
			this.driftCleanup = null;
		}
		this.transportZone.empty();

		if (this.primaryVideo && this.compareVideo && this.syncEnabled) {
			this.transportZone.createEl("hr", { cls: "media-lens-divider" });
			this.renderUnifiedTransport(this.transportZone);
		}
	}

	private rebuildActionZone() {
		if (!this.actionZone) return;
		this.actionZone.empty();

		if (!this.primaryFile) return;

		this.actionZone.createEl("hr", { cls: "media-lens-divider" });
		const actionRow = this.actionZone.createDiv({ cls: "media-lens-action-row" });
		if (this.primaryVideo && this.compareVideo) {
			this.renderSyncToggle(actionRow);
		}
		if (this.primaryFile.category === "video" && !this.syncEnabled) {
			this.renderCaptureButton(actionRow);
		}
		if (this.primaryFile && this.compareFile && this.primaryFile.category === "video") {
			this.renderSplitViewButton(actionRow);
		}
		this.renderSaveButton(actionRow);
	}

	private rebuildCaptureZone() {
		if (!this.captureZone) return;
		this.captureZone.empty();
		if (this.primaryFile) {
			this.renderCaptureStrip(this.captureZone);
		}
	}

	private rebuildMetadataZone() {
		if (!this.metadataZone) return;
		this.metadataZone.empty();

		if (this.primaryFile && this.compareFile) {
			this.renderComparison(this.metadataZone, this.primaryFile, this.compareFile);
		} else if (this.primaryFile) {
			this.renderSections(this.metadataZone, this.primaryFile.sections);
		} else {
			const hint = this.metadataZone.createDiv({ cls: "media-lens-hint" });
			hint.createEl("span", {
				text: "Supports images, video, audio, and subtitles",
			});
		}
	}

	private renderSyncedHeader(parent: HTMLElement, fileA: LoadedFile, fileB: LoadedFile) {
		const header = parent.createDiv({ cls: "media-lens-synced-header" });

		const labels = header.createDiv({ cls: "media-lens-synced-labels" });
		const labelA = labels.createDiv({ cls: "media-lens-synced-label" });
		labelA.createEl("span", { text: "A", cls: "media-lens-synced-badge" });
		labelA.createEl("span", { text: fileA.name, cls: "media-lens-synced-name" });
		labelA.createEl("span", { text: formatSize(fileA.size), cls: "media-lens-synced-size" });

		const labelB = labels.createDiv({ cls: "media-lens-synced-label" });
		labelB.createEl("span", { text: "B", cls: "media-lens-synced-badge" });
		labelB.createEl("span", { text: fileB.name, cls: "media-lens-synced-name" });
		labelB.createEl("span", { text: formatSize(fileB.size), cls: "media-lens-synced-size" });

		const unsyncBtn = header.createEl("button", {
			cls: "media-lens-btn-clear",
			attr: { "aria-label": "Exit synced comparison" },
		});
		setIcon(unsyncBtn, "x");
		unsyncBtn.addEventListener("click", () => {
			this.syncEnabled = false;
			this.render();
		});
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
		setIcon(iconEl, isPrimary ? "upload" : "plus");

		let label: string;
		if (isPrimary) {
			label = "Add a file to inspect";
		} else if (this.primaryFile) {
			const typeLabel = getCategoryLabel(this.primaryFile.category);
			label = `Add another ${typeLabel} to compare`;
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

	private async renderPreview(parent: HTMLElement, file: LoadedFile, slot: "primary" | "compare") {
		const wrapper = parent.createDiv({ cls: "media-lens-preview" });
		const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
		const mime = getMimeType(ext, file.category);

		switch (file.category) {
			case "image": {
				const imgMime = ext === "svg" ? "image/svg+xml" : mime;
				const url = await this.getMediaUrl(file, imgMime);
				const img = wrapper.createEl("img", {
					cls: "media-lens-preview-img",
					attr: { src: url, alt: file.name },
				});
				img.addEventListener("error", () => {
					wrapper.empty();
					wrapper.createEl("span", { text: "Preview unavailable", cls: "media-lens-muted" });
				}, { once: true });
				break;
			}
			case "video": {
				const url = await this.getMediaUrl(file, mime);
				const synced = this.syncEnabled && this.primaryFile !== null && this.compareFile !== null;
				this.log(`renderPreview[${slot}]: "${file.name}" synced=${synced} url=${url.slice(0, 120)}`);
				const video = wrapper.createEl("video", {
					cls: "media-lens-preview-video",
					attr: { src: url },
				});
				video.controls = !synced;
				video.muted = true;
				const signal = (slot === "primary" ? this.primaryAbort : this.compareAbort)?.signal;
				video.addEventListener("loadstart", () => this.log(`video[${slot}]: loadstart`), { signal });
				video.addEventListener("loadedmetadata", () => this.log(`video[${slot}]: loadedmetadata (${video.videoWidth}x${video.videoHeight}, ${video.duration.toFixed(1)}s)`), { signal });
				video.addEventListener("loadeddata", () => this.log(`video[${slot}]: loadeddata (readyState=${video.readyState})`), { signal });
				video.addEventListener("canplay", () => this.log(`video[${slot}]: canplay`), { signal });
				video.addEventListener("canplaythrough", () => this.log(`video[${slot}]: canplaythrough`), { signal });
				video.addEventListener("playing", () => this.log(`video[${slot}]: playing`), { signal });
				video.addEventListener("stalled", () => this.log(`video[${slot}]: stalled (readyState=${video.readyState})`), { signal });
				video.addEventListener("waiting", () => this.log(`video[${slot}]: waiting (readyState=${video.readyState})`), { signal });
				video.addEventListener("suspend", () => this.log(`video[${slot}]: suspend`), { signal });
				video.addEventListener("error", () => {
					const err = video.error;
					const msg = err ? `code=${err.code} "${err.message}"` : "unknown";
					this.logError(`video[${slot}]: error — ${msg}`);
					new Notice(`Video error: ${msg}`);
				}, { signal });
				if (slot === "primary") {
					this.primaryVideo = video;
				} else {
					this.compareVideo = video;
				}
				break;
			}
			case "audio": {
				const url = await this.getMediaUrl(file, mime);
				wrapper.createEl("audio", {
					cls: "media-lens-preview-audio",
					attr: { src: url, controls: "true", preload: "auto" },
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


	private renderCaptureButton(parent: HTMLElement) {
		const btn = parent.createEl("button", {
			cls: "media-lens-btn media-lens-btn-save",
		});
		const iconEl = btn.createSpan();
		setIcon(iconEl, "camera");
		const label = btn.createSpan({ text: "Capture" });

		btn.addEventListener("click", () => {
			btn.disabled = true;
			label.textContent = "Capturing...";
			const done = () => {
				btn.disabled = false;
				label.textContent = "Capture";
			};
			if (this.primaryVideo && this.compareVideo) {
				void this.captureSyncedFrames(this.primaryVideo, this.compareVideo).finally(done);
			} else if (this.primaryVideo) {
				void this.captureFrame(this.primaryVideo, "primary").finally(done);
			} else {
				done();
			}
		});
	}

	private renderSplitViewButton(parent: HTMLElement) {
		if (!this.primaryFile || !this.compareFile) return;
		const fileA = this.primaryFile;
		const fileB = this.compareFile;

		const btn = parent.createEl("button", {
			cls: "media-lens-btn media-lens-btn-save",
		});
		const iconEl = btn.createSpan();
		setIcon(iconEl, "columns-2");
		const label = btn.createSpan({ text: "Split view" });

		btn.addEventListener("click", () => {
			if (!this.primaryVideo || !this.compareVideo) return;
			this.log(`splitViewButton: clicked, A="${fileA.name}" B="${fileB.name}"`);
			// Pause sidebar playback before opening split view modal
			if (!this.primaryVideo.paused) this.primaryVideo.pause();
			if (!this.compareVideo.paused) this.compareVideo.pause();
			btn.disabled = true;
			label.textContent = "Opening...";
			const vidA = this.primaryVideo;
			const vidB = this.compareVideo;
			requestAnimationFrame(() => {
				openSplitViewModal(
				this.plugin,
				{ name: fileA.name, frameRate: this.getFrameRate(fileA), video: vidA },
				{ name: fileB.name, frameRate: this.getFrameRate(fileB), video: vidB },
				(capturedVidA, capturedVidB, splitBlob) => {
					if (splitBlob) {
						const time = capturedVidA.currentTime;
						const timeLabel = formatTimestamp(time);
						this.captures.push({ slot: "split-view", timestamp: time, blob: splitBlob, label: timeLabel });
						this.updateCaptureStrip();
					}
					void this.captureFrame(capturedVidA, "primary");
					void this.captureFrame(capturedVidB, "compare");
				}
			);
			btn.disabled = false;
			label.textContent = "Split view";
			});
		});
	}

	private renderSaveButton(parent: HTMLElement) {
		const btn = parent.createEl("button", {
			cls: "media-lens-btn media-lens-btn-save",
		});
		const iconEl = btn.createSpan();
		setIcon(iconEl, "save");
		const label = btn.createSpan({ text: "Save as note" });
		btn.addEventListener("click", () => {
			btn.disabled = true;
			label.textContent = "Saving...";
			void this.handleSave().finally(() => {
				btn.disabled = false;
				label.textContent = "Save as note";
			});
		});
	}

	private renderSyncToggle(parent: HTMLElement) {
		const btn = parent.createEl("button", {
			cls: `media-lens-btn media-lens-btn-save${this.syncEnabled ? " media-lens-btn-sync--active" : ""}`,
		});
		const iconEl = btn.createSpan();
		setIcon(iconEl, this.syncEnabled ? "unlink" : "link");
		const label = btn.createSpan({ text: this.syncEnabled ? "Unsync playback" : "Sync playback" });

		btn.addEventListener("click", () => {
			this.log(`syncToggle: clicked, current=${this.syncEnabled}, switching to ${!this.syncEnabled}`);
			btn.disabled = true;
			label.textContent = this.syncEnabled ? "Unsyncing..." : "Syncing...";
			setTimeout(() => {
				this.syncEnabled = !this.syncEnabled;
				this.render();
			}, 50);
		});
	}

	private renderUnifiedTransport(parent: HTMLElement) {
		const vidA = this.primaryVideo;
		const vidB = this.compareVideo;
		if (!vidA || !vidB || !this.primaryFile) {
			this.logError("renderUnifiedTransport: missing video refs or primaryFile");
			return;
		}
		this.log("renderUnifiedTransport: building synced transport");

		const fps = this.getFrameRate(this.primaryFile);
		const result = renderSyncTransport(parent, vidA, vidB, fps, {
			addDocListener: (type, handler) => this.addDocListener(type, handler),
			log: (msg) => this.log(msg),
			logError: (msg, ...args) => this.logError(msg, ...args),
			onCapture: () => {
				if (this.syncEnabled && this.primaryVideo && this.compareVideo) {
					void this.captureSyncedFrames(this.primaryVideo, this.compareVideo);
				} else if (this.primaryVideo) {
					void this.captureFrame(this.primaryVideo, "primary");
				}
			},
		});
		this.driftCleanup = result.stopDrift;
	}



	private getSubtitleText(file: LoadedFile): string | undefined {
		if (file.category !== "subtitle") return undefined;
		try {
			return new TextDecoder().decode(file.buffer);
		} catch {
			return undefined;
		}
	}

	private getFrameRate(file: LoadedFile): number {
		for (const section of file.sections) {
			for (const field of section.fields) {
				if (field.key === "Frame rate") {
					const num = parseFloat(field.value);
					if (!isNaN(num) && num > 0) return num;
				}
			}
		}
		return 30; // fallback
	}

	private waitForSeek(video: HTMLVideoElement): Promise<void> {
		return new Promise((resolve) => {
			if (video.seeking) {
				video.addEventListener("seeked", () => resolve(), { once: true });
			} else {
				resolve();
			}
		});
	}

	private async captureSyncedFrames(vidA: HTMLVideoElement, vidB: HTMLVideoElement) {
		this.log(`captureSyncedFrames: vidA.paused=${vidA.paused} t=${vidA.currentTime.toFixed(3)}`);
		const wasPaused = vidA.paused;
		if (!wasPaused) {
			vidA.pause();
			vidB.pause();
		}

		// Align both to the exact same time
		const t = vidA.currentTime;
		vidA.currentTime = t;
		vidB.currentTime = t;
		await Promise.all([this.waitForSeek(vidA), this.waitForSeek(vidB)]);

		// Capture both at the aligned frame
		await this.captureFrame(vidA, "primary");
		await this.captureFrame(vidB, "compare");

		// Resume if was playing
		if (!wasPaused) {
			Promise.all([vidA.play(), vidB.play()]).catch(() => { /* playback blocked */ });
		}
	}

	private async captureFrame(video: HTMLVideoElement, slot: "primary" | "compare") {
		this.log(`captureFrame[${slot}]: ready=${isVideoReady(video)} t=${video.currentTime.toFixed(3)} ${video.videoWidth}x${video.videoHeight}`);
		if (!isVideoReady(video)) {
			this.logError(`captureFrame[${slot}]: video not ready (readyState=${video.readyState}, videoWidth=${video.videoWidth})`);
			new Notice("Video not ready for capture");
			return;
		}
		const canvas = document.createElement("canvas");
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.drawImage(video, 0, 0);

		const blob = await new Promise<Blob | null>((resolve) => {
			canvas.toBlob(resolve, "image/png");
		});
		if (!blob) return;

		const time = video.currentTime;
		const label = formatTimestamp(time);
		this.captures.push({ slot, timestamp: time, blob, label });
		this.updateCaptureStrip();
		new Notice(`Frame captured at ${label}`);
	}



	private renderCaptureStrip(parent: HTMLElement) {
		const strip = parent.createDiv({ cls: "media-lens-capture-strip" });
		this.captureStripEl = strip;
		this.fillCaptureStrip(strip);
	}

	private fillCaptureStrip(strip: HTMLElement) {
		// Revoke old capture thumbnail URLs
		for (const url of this.captureStripUrls) URL.revokeObjectURL(url);
		this.captureStripUrls = [];

		strip.empty();

		if (this.captures.length === 0) {
			strip.addClass("media-lens-hidden");
			return;
		}
		strip.removeClass("media-lens-hidden");

		strip.createEl("span", { text: "Captured frames", cls: "media-lens-capture-label" });
		const list = strip.createDiv({ cls: "media-lens-capture-list" });

		this.captures.forEach((cap, idx) => {
			const item = list.createDiv({ cls: "media-lens-capture-item" });

			const url = URL.createObjectURL(cap.blob);
			this.captureStripUrls.push(url);
			item.createEl("img", {
				cls: "media-lens-capture-thumb",
				attr: { src: url, alt: cap.label },
			});

			const info = item.createDiv({ cls: "media-lens-capture-info" });
			let nameText: string;
			if (cap.slot === "split-view") {
				nameText = "A|B: Split view comparison";
			} else {
				const file = cap.slot === "primary" ? this.primaryFile : this.compareFile;
				const playerLabel = this.compareFile ? (cap.slot === "primary" ? "A" : "B") : "";
				nameText = playerLabel ? `${playerLabel}: ${file?.name ?? cap.slot}` : (file?.name ?? cap.slot);
			}
			info.createEl("span", { text: nameText, cls: "media-lens-capture-filename" });
			info.createEl("span", { text: `@ ${cap.label}`, cls: "media-lens-capture-time" });

			const removeBtn = item.createEl("button", {
				cls: "media-lens-btn-clear",
				attr: { "aria-label": "Remove capture" },
			});
			setIcon(removeBtn, "x");
			removeBtn.addEventListener("click", () => {
				this.captures.splice(idx, 1);
				this.updateCaptureStrip();
			});
		});
	}

	private updateCaptureStrip() {
		if (this.captureStripEl) {
			this.fillCaptureStrip(this.captureStripEl);
		}
	}

	async handleSave() {
		this.log(`handleSave: primary="${this.primaryFile?.name ?? "none"}" compare="${this.compareFile?.name ?? "none"}" captures=${this.captures.length}`);
		if (!this.primaryFile) return;

		const settings = this.plugin.settings;
		const assetsDir = settings.externalAssetsDirectory;
		const noteName = this.compareFile
			? generateNoteName(this.primaryFile.name, this.compareFile.name)
			: generateNoteName(this.primaryFile.name);

		try {
			// Save captured frames to vault
			const savedCaptures: NoteCapture[] = [];
			for (const cap of this.captures) {
				let baseName: string;
				let fileName: string;
				let player: "A" | "B" | "A|B" | undefined;

				if (cap.slot === "split-view") {
					baseName = "split-view";
					fileName = "Split view comparison";
					player = "A|B";
				} else {
					const file = cap.slot === "primary" ? this.primaryFile : this.compareFile;
					baseName = (file?.name ?? cap.slot).replace(/\.[^.]+$/, "");
					fileName = file?.name ?? cap.slot;
					player = this.compareFile ? (cap.slot === "primary" ? "A" : "B") : undefined;
				}

				const capFileName = `${baseName}_${cap.label.replace(/[:.]/g, "-")}.png`;
				const vaultPath = await saveCaptureToVault(this.app, cap.blob, capFileName, settings);
				savedCaptures.push({ vaultPath, label: cap.label, fileName, player });
			}

			// Copy external files into vault so embeds work
			let primaryPath = this.primaryFile.path;
			if (this.primaryFile.source === "external") {
				primaryPath = await copyExternalFileToVault(
					this.app, this.primaryFile.buffer, this.primaryFile.name, settings
				);
			}

			let content: string;

			if (this.compareFile) {
				let comparePath = this.compareFile.path;
				if (this.compareFile.source === "external") {
					comparePath = await copyExternalFileToVault(
						this.app, this.compareFile.buffer, this.compareFile.name, settings
					);
				}

				content = generateComparisonNote(
					{ name: this.primaryFile.name, source: this.primaryFile.source, category: this.primaryFile.category, vaultPath: primaryPath, textContent: this.getSubtitleText(this.primaryFile) },
					{ name: this.compareFile.name, source: this.compareFile.source, category: this.compareFile.category, vaultPath: comparePath, textContent: this.getSubtitleText(this.compareFile) },
					this.primaryFile.sections,
					this.compareFile.sections,
					assetsDir,
					savedCaptures
				);
			} else {
				content = generateSingleNote(
					{ name: this.primaryFile.name, source: this.primaryFile.source, category: this.primaryFile.category, vaultPath: primaryPath, textContent: this.getSubtitleText(this.primaryFile) },
					this.primaryFile.sections,
					assetsDir,
					savedCaptures
				);
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

			const defaultExpanded = (sA?.defaultExpanded ?? true) || (sB?.defaultExpanded ?? true);

			const wrapper = parent.createDiv({ cls: "media-lens-section" });
			const header = wrapper.createDiv({ cls: "media-lens-section-header" });
			const chevron = header.createSpan({ cls: "media-lens-section-chevron" });
			setIcon(chevron, "chevron-down");
			header.createSpan({ text: sectionName });

			const body = wrapper.createDiv({ cls: "media-lens-section-body" });

			if (!defaultExpanded) {
				body.addClass("media-lens-section-body--collapsed");
				chevron.addClass("media-lens-section-chevron--collapsed");
			}

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
		this.log(`handleDrop: slot=${slot}, files=${e.dataTransfer?.files?.length ?? 0}, text="${e.dataTransfer?.getData("text/plain") ?? ""}"`);
		const droppedFile = e.dataTransfer?.files?.[0];
		if (droppedFile) {
			this.log(`handleDrop: external file "${droppedFile.name}" size=${droppedFile.size} type="${droppedFile.type}"`);
			if (droppedFile.size > MAX_FILE_SIZE) {
				new Notice(`File too large (${formatSize(droppedFile.size)}). Maximum is ${formatSize(MAX_FILE_SIZE)}.`);
				return;
			}
			await this.loadFile(droppedFile.name, droppedFile.name, await droppedFile.arrayBuffer(), "external", slot, droppedFile);
			return;
		}

		const path = e.dataTransfer?.getData("text/plain");
		if (path) {
			const abstractFile = this.app.vault.getAbstractFileByPath(path);
			this.log(`handleDrop: vault path="${path}" found=${abstractFile instanceof TFile}`);
			if (abstractFile instanceof TFile) {
				if (abstractFile.stat.size > MAX_FILE_SIZE) {
					new Notice(`File too large (${formatSize(abstractFile.stat.size)}). Maximum is ${formatSize(MAX_FILE_SIZE)}.`);
					return;
				}
				const buffer = await this.app.vault.readBinary(abstractFile);
				this.log(`handleDrop: vault read complete, buffer.byteLength=${buffer.byteLength}`);
				await this.loadFile(abstractFile.name, abstractFile.path, buffer, "vault", slot);
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
			if (file && file.size > MAX_FILE_SIZE) {
				new Notice(`File too large (${formatSize(file.size)}). Maximum is ${formatSize(MAX_FILE_SIZE)}.`);
			} else if (file) {
				void this.loadFile(file.name, file.name, file.arrayBuffer(), "external", slot, file);
			}
			cleanup();
		});

		window.addEventListener("focus", cleanup, { once: true });

		document.body.appendChild(input);
		input.click();
	}

	private async loadFile(
		name: string,
		path: string,
		bufferOrPromise: ArrayBuffer | Promise<ArrayBuffer>,
		source: "vault" | "external",
		slot: "primary" | "compare",
		fileRef?: File
	) {
		const category = getCategory(name);
		if (!category) {
			const dotIdx = name.lastIndexOf(".");
			const ext = dotIdx > 0 ? name.slice(dotIdx + 1) : "(no extension)";
			new Notice(`Unsupported file type: ${ext}`);
			return;
		}

		if (slot === "compare" && this.primaryFile && category !== this.primaryFile.category) {
			const expected = getCategoryLabel(this.primaryFile.category);
			new Notice(`Cannot compare: expected ${expected}, got ${getCategoryLabel(category)}`);
			return;
		}

		try {
			this.log(`loadFile: "${name}" slot=${slot} source=${source} category=${category} hasFileRef=${!!fileRef}`);
			const buffer = await bufferOrPromise;
			this.log(`loadFile: "${name}" buffer ready, byteLength=${buffer.byteLength}`);
			const wasmUrl = this.plugin.getWasmUrl();
			const result = await parseBuffer(buffer, wasmUrl);
			this.log(`loadFile: "${name}" parse complete, buffer.byteLength after parse=${buffer.byteLength}`);
			const sections = normalizeTracks(result);
			this.log(`loadFile: "${name}" sections=${sections.length}`);

			const file: LoadedFile = { name, path, size: buffer.byteLength, source, buffer, category, sections, fileRef };

			// Pre-create the media URL so render doesn't block on I/O
			if (category === "video" || category === "audio") {
				const ext = name.split(".").pop()?.toLowerCase() ?? "";
				const mime = getMimeType(ext, category);
				await this.getMediaUrl(file, mime);
			}

			this.log(`loadFile: "${name}" calling setFile`);
			this.setFile(slot, file);
		} catch (err) {
			this.logError(`loadFile: "${name}" parse error`, err);
			const msg = err instanceof Error ? err.message : "Unknown error";
			if (msg.includes("WASM")) {
				new Notice("Failed to load media parser. Try reloading the plugin.");
			} else {
				new Notice(`Failed to parse "${name}": ${msg}`);
			}
		}
	}

	private setFile(slot: "primary" | "compare", file: LoadedFile) {
		this.log(`setFile: slot=${slot} file="${file.name}" primaryMediaUrl="${this.primaryFile?.mediaUrl?.slice(0, 40) ?? "none"}"`);
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
		this.log(`setFile: about to render. primary="${this.primaryFile?.name ?? "none"}" (mediaUrl=${!!this.primaryFile?.mediaUrl}) compare="${this.compareFile?.name ?? "none"}" (mediaUrl=${!!this.compareFile?.mediaUrl})`);
		this.render();
	}
}
