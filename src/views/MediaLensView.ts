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
import type { NoteCapture } from "../notes/note-generator";
import { saveNote, copyExternalFileToVault, saveCaptureToVault } from "../notes/note-writer";

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
	private driftRafCleanup: (() => void) | null = null;
	private captures: Array<{ slot: "primary" | "compare"; timestamp: number; blob: Blob; label: string }> = [];
	private captureStripEl: HTMLElement | null = null;

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
		if (this.driftRafCleanup) {
			this.driftRafCleanup();
			this.driftRafCleanup = null;
		}
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
		if (this.driftRafCleanup) {
			this.driftRafCleanup();
			this.driftRafCleanup = null;
		}
		this.primaryVideo = null;
		this.compareVideo = null;
		const container = this.contentEl;
		container.empty();
		container.addClass("media-lens-container");

		if (this.syncEnabled && this.primaryFile && this.compareFile) {
			this.renderSyncedHeader(container, this.primaryFile, this.compareFile);
			const videoStack = container.createDiv({ cls: "media-lens-synced-stack" });
			this.renderPreview(videoStack, this.primaryFile, "primary");
			this.renderPreview(videoStack, this.compareFile, "compare");
		} else {
			this.renderDropZone(container, "primary");
			if (this.primaryFile) {
				this.renderPreview(container, this.primaryFile, "primary");
			}
			this.renderDropZone(container, "compare");
			if (this.compareFile) {
				this.renderPreview(container, this.compareFile, "compare");
			}
		}

		if (this.primaryFile) {
			container.createEl("hr", { cls: "media-lens-divider" });

			const actionsBar = container.createDiv({ cls: "media-lens-actions" });

			if (this.primaryVideo && this.compareVideo) {
				if (this.syncEnabled) {
					this.renderUnifiedTransport(actionsBar);
				} else {
					this.renderSyncToggle(actionsBar);
				}
			}

			this.renderCaptureStrip(actionsBar);
			this.renderSaveButton(actionsBar);
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
			attr: { "aria-label": "Exit comparison" },
		});
		setIcon(unsyncBtn, "x");
		unsyncBtn.addEventListener("click", () => {
			this.clearAll();
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
				const hideControls = this.syncEnabled && this.primaryFile !== null && this.compareFile !== null;
				const videoAttrs: Record<string, string> = { src: url, preload: "metadata" };
				if (!hideControls) videoAttrs.controls = "true";
				const video = wrapper.createEl("video", {
					cls: "media-lens-preview-video",
					attr: videoAttrs,
				});
				if (slot === "primary") this.primaryVideo = video;
				else this.compareVideo = video;
				if (hideControls) {
					this.renderMuteButton(wrapper, video);
				} else {
					this.renderFrameStepControls(wrapper, video, file, slot);
				}
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


	private renderMuteButton(parent: HTMLElement, video: HTMLVideoElement) {
		const btn = parent.createEl("button", {
			cls: "media-lens-btn-mute",
			attr: { "aria-label": "Toggle mute" },
		});
		const iconEl = btn.createSpan();
		const updateIcon = () => {
			iconEl.empty();
			setIcon(iconEl, video.muted ? "volume-x" : "volume-2");
		};
		updateIcon();
		btn.addEventListener("click", () => {
			video.muted = !video.muted;
			updateIcon();
		});
	}

	private renderSaveButton(parent: HTMLElement) {
		const wrapper = parent.createDiv({ cls: "media-lens-save-bar" });
		const label = "Save as note";
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
			this.syncEnabled = true;
			this.render();
		});
	}

	private renderUnifiedTransport(parent: HTMLElement) {
		const vidA = this.primaryVideo;
		const vidB = this.compareVideo;
		if (!vidA || !vidB || !this.primaryFile) return;

		const fps = this.getFrameRate(this.primaryFile);
		const frameDuration = 1 / fps;
		const driftThreshold = frameDuration / 2; // correct if drift exceeds half a frame

		// Drift correction loop — runs during playback
		let driftRaf: number | null = null;
		const correctDrift = () => {
			if (!vidA.paused && !vidB.paused) {
				const drift = vidA.currentTime - vidB.currentTime;
				if (Math.abs(drift) > driftThreshold) {
					vidB.currentTime = vidA.currentTime;
				}
			}
			driftRaf = requestAnimationFrame(correctDrift);
		};

		const startDriftCorrection = () => {
			if (driftRaf === null) {
				driftRaf = requestAnimationFrame(correctDrift);
			}
		};
		const stopDriftCorrection = () => {
			if (driftRaf !== null) {
				cancelAnimationFrame(driftRaf);
				driftRaf = null;
			}
		};

		vidA.addEventListener("play", startDriftCorrection);
		vidA.addEventListener("pause", stopDriftCorrection);
		vidA.addEventListener("ended", stopDriftCorrection);
		this.driftRafCleanup = stopDriftCorrection;

		const bar = parent.createDiv({ cls: "media-lens-transport" });

		// Unsync button
		const unsyncBtn = bar.createEl("button", {
			cls: "media-lens-btn media-lens-btn-sync media-lens-btn-sync--active",
			attr: { "aria-label": "Unsync playback" },
		});
		const unsyncIcon = unsyncBtn.createSpan();
		setIcon(unsyncIcon, "link");
		unsyncBtn.createSpan({ text: "Synced" });
		unsyncBtn.addEventListener("click", () => {
			this.syncEnabled = false;
			this.render();
		});

		// Seek bar
		const seekRow = bar.createDiv({ cls: "media-lens-transport-seek" });
		const timeLabel = seekRow.createSpan({ cls: "media-lens-transport-time" });
		const seekInput = seekRow.createEl("input", {
			cls: "media-lens-transport-range",
			attr: { type: "range", min: "0", step: "0.001", value: "0" },
		});
		const durationLabel = seekRow.createSpan({ cls: "media-lens-transport-time" });

		const updateDuration = () => {
			const dur = vidA.duration || 0;
			seekInput.max = String(dur);
			durationLabel.textContent = this.formatTimestamp(dur);
		};
		vidA.addEventListener("loadedmetadata", updateDuration);
		updateDuration();

		let scrubbing = false;
		let wasPlaying = false;
		let rafId: number | null = null;
		let scrubTarget: number | null = null;

		const updateTime = () => {
			if (scrubbing) return;
			seekInput.value = String(vidA.currentTime);
			timeLabel.textContent = this.formatTimestamp(vidA.currentTime);
		};
		vidA.addEventListener("timeupdate", updateTime);
		updateTime();

		const applyScrub = () => {
			rafId = null;
			if (scrubTarget === null) return;
			const t = scrubTarget;
			scrubTarget = null;
			vidA.currentTime = t;
			vidB.currentTime = t;
			timeLabel.textContent = this.formatTimestamp(t);
		};

		const startScrub = () => {
			scrubbing = true;
			wasPlaying = !vidA.paused;
			vidA.pause();
			vidB.pause();
		};
		seekInput.addEventListener("mousedown", startScrub);
		seekInput.addEventListener("touchstart", startScrub);

		seekInput.addEventListener("input", () => {
			scrubTarget = parseFloat(seekInput.value);
			timeLabel.textContent = this.formatTimestamp(scrubTarget);
			if (rafId === null) {
				rafId = requestAnimationFrame(applyScrub);
			}
		});

		const endScrub = () => {
			if (!scrubbing) return;
			scrubbing = false;
			if (rafId !== null) {
				cancelAnimationFrame(rafId);
				rafId = null;
			}
			scrubTarget = null;
			const t = parseFloat(seekInput.value);
			vidA.currentTime = t;
			vidB.currentTime = t;
			if (wasPlaying) {
				void Promise.all([vidA.play(), vidB.play()]);
			}
		};
		seekInput.addEventListener("mouseup", endScrub);
		seekInput.addEventListener("touchend", endScrub);

		// Controls row: frame back, play/pause, frame forward, capture
		const controls = bar.createDiv({ cls: "media-lens-transport-controls" });

		const frameBack = controls.createEl("button", {
			cls: "media-lens-btn media-lens-btn-secondary media-lens-frame-btn",
			attr: { "aria-label": "Previous frame" },
		});
		const fbIcon = frameBack.createSpan();
		setIcon(fbIcon, "chevron-left");
		frameBack.createSpan({ text: "Frame" });

		const playPauseBtn = controls.createEl("button", {
			cls: "media-lens-btn media-lens-btn-secondary",
			attr: { "aria-label": "Play or pause" },
		});
		const ppIcon = playPauseBtn.createSpan();
		setIcon(ppIcon, "play");

		const frameFwd = controls.createEl("button", {
			cls: "media-lens-btn media-lens-btn-secondary media-lens-frame-btn",
			attr: { "aria-label": "Next frame" },
		});
		frameFwd.createSpan({ text: "Frame" });
		const ffIcon = frameFwd.createSpan();
		setIcon(ffIcon, "chevron-right");

		const captureBtn = controls.createEl("button", {
			cls: "media-lens-btn media-lens-btn-secondary media-lens-frame-btn",
			attr: { "aria-label": "Capture frames" },
		});
		const capIcon = captureBtn.createSpan();
		setIcon(capIcon, "camera");

		controls.createSpan({ text: `${fps} fps`, cls: "media-lens-frame-fps" });

		// Play/pause logic
		const updatePlayIcon = () => {
			ppIcon.empty();
			setIcon(ppIcon, vidA.paused ? "play" : "pause");
		};
		vidA.addEventListener("play", updatePlayIcon);
		vidA.addEventListener("pause", updatePlayIcon);

		playPauseBtn.addEventListener("click", () => {
			if (vidA.paused) {
				vidB.currentTime = vidA.currentTime;
				void Promise.all([vidA.play(), vidB.play()]);
			} else {
				vidA.pause();
				vidB.pause();
				vidB.currentTime = vidA.currentTime;
			}
		});

		// Frame stepping
		const step = (delta: number) => {
			vidA.pause();
			vidB.pause();
			const t = Math.max(0, vidA.currentTime + delta);
			vidA.currentTime = t;
			vidB.currentTime = t;
		};
		frameBack.addEventListener("click", () => step(-frameDuration));
		frameFwd.addEventListener("click", () => step(frameDuration));

		// Capture both frames at the exact same time
		captureBtn.addEventListener("click", () => {
			void this.captureSyncedFrames(vidA, vidB);
		});
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

	private renderFrameStepControls(
		parent: HTMLElement,
		video: HTMLVideoElement,
		file: LoadedFile,
		slot: "primary" | "compare"
	) {
		const fps = this.getFrameRate(file);
		const frameDuration = 1 / fps;

		const bar = parent.createDiv({ cls: "media-lens-frame-step" });

		const backBtn = bar.createEl("button", {
			cls: "media-lens-btn media-lens-btn-secondary media-lens-frame-btn",
			attr: { "aria-label": "Previous frame" },
		});
		const backIcon = backBtn.createSpan();
		setIcon(backIcon, "chevron-left");
		backBtn.createSpan({ text: "Frame" });

		bar.createSpan({
			text: `${fps} fps`,
			cls: "media-lens-frame-fps",
		});

		const fwdBtn = bar.createEl("button", {
			cls: "media-lens-btn media-lens-btn-secondary media-lens-frame-btn",
			attr: { "aria-label": "Next frame" },
		});
		fwdBtn.createSpan({ text: "Frame" });
		const fwdIcon = fwdBtn.createSpan();
		setIcon(fwdIcon, "chevron-right");

		const step = (delta: number) => {
			video.currentTime = Math.max(0, video.currentTime + delta);
		};

		const captureBtn = bar.createEl("button", {
			cls: "media-lens-btn media-lens-btn-secondary media-lens-frame-btn",
			attr: { "aria-label": "Capture frame" },
		});
		const captureIcon = captureBtn.createSpan();
		setIcon(captureIcon, "camera");

		backBtn.addEventListener("click", () => step(-frameDuration));
		fwdBtn.addEventListener("click", () => step(frameDuration));
		captureBtn.addEventListener("click", () => {
			void this.captureFrame(video, slot);
		});

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
	}

	private async captureFrame(video: HTMLVideoElement, slot: "primary" | "compare") {
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
		const label = this.formatTimestamp(time);
		this.captures.push({ slot, timestamp: time, blob, label });
		this.updateCaptureStrip();
	}

	private formatTimestamp(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		const ms = Math.floor((seconds % 1) * 1000);
		return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
	}

	private renderCaptureStrip(parent: HTMLElement) {
		const strip = parent.createDiv({ cls: "media-lens-capture-strip" });
		this.captureStripEl = strip;
		this.fillCaptureStrip(strip);
	}

	private fillCaptureStrip(strip: HTMLElement) {
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
			this.objectUrls.push(url);
			item.createEl("img", {
				cls: "media-lens-capture-thumb",
				attr: { src: url, alt: cap.label },
			});

			const info = item.createDiv({ cls: "media-lens-capture-info" });
			const file = cap.slot === "primary" ? this.primaryFile : this.compareFile;
			const playerLabel = this.compareFile ? (cap.slot === "primary" ? "A" : "B") : "";
			const nameText = playerLabel ? `${playerLabel}: ${file?.name ?? cap.slot}` : (file?.name ?? cap.slot);
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
				const file = cap.slot === "primary" ? this.primaryFile : this.compareFile;
				const baseName = (file?.name ?? cap.slot).replace(/\.[^.]+$/, "");
				const capFileName = `${baseName}_${cap.label.replace(/[:.]/g, "-")}.png`;
				const vaultPath = await saveCaptureToVault(this.app, cap.blob, capFileName, settings);
				const player = this.compareFile ? (cap.slot === "primary" ? "A" as const : "B" as const) : undefined;
				savedCaptures.push({ vaultPath, label: cap.label, fileName: file?.name ?? cap.slot, player });
			}

			// Copy external files into vault so embeds work (only if no captures)
			let primaryPath = this.primaryFile.name;
			if (this.primaryFile.source === "external") {
				primaryPath = await copyExternalFileToVault(
					this.app, this.primaryFile.buffer, this.primaryFile.name, settings
				);
			}

			let content: string;

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
					assetsDir,
					savedCaptures
				);
			} else {
				content = generateSingleNote(
					{ name: this.primaryFile.name, source: this.primaryFile.source, category: this.primaryFile.category, vaultPath: primaryPath },
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
