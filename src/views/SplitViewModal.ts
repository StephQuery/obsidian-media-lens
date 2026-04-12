import { Modal, normalizePath, Notice } from "obsidian";
import type MediaLensPlugin from "../main";
import { formatTimestamp, isVideoReady } from "../utils/video-sync";
import type { MediaCategory } from "../utils/media";
import { renderSyncTransport, type SyncTransportResult } from "./sync-transport";

const TEMP_DIR = ".media-lens-temp";

interface SplitViewFile {
	name: string;
	buffer: ArrayBuffer;
	category: MediaCategory;
	frameRate: number;
	fileRef?: File;
	/** Pre-existing media URL from the sidebar (avoids re-writing temp files) */
	mediaUrl?: string;
	tempVaultPath?: string;
}

type CaptureCallback = (vidA: HTMLVideoElement, vidB: HTMLVideoElement, splitBlob?: Blob) => void;

function log(msg: string, ...args: unknown[]) {
	console.debug(`[Media Lens][SplitView] ${msg}`, ...args);
}

function logError(msg: string, ...args: unknown[]) {
	console.error(`[Media Lens][SplitView] ${msg}`, ...args);
}

function attachVideoLogging(video: HTMLVideoElement, label: string, signal: AbortSignal) {
	const opts = { signal };
	video.addEventListener("loadstart", () => log(`video[${label}]: loadstart`), opts);
	video.addEventListener("loadedmetadata", () => log(`video[${label}]: loadedmetadata (${video.videoWidth}x${video.videoHeight}, ${video.duration.toFixed(1)}s)`), opts);
	video.addEventListener("loadeddata", () => log(`video[${label}]: loadeddata (readyState=${video.readyState})`), opts);
	video.addEventListener("canplay", () => log(`video[${label}]: canplay`), opts);
	video.addEventListener("canplaythrough", () => log(`video[${label}]: canplaythrough`), opts);
	video.addEventListener("playing", () => log(`video[${label}]: playing`), opts);
	video.addEventListener("pause", () => log(`video[${label}]: pause`), opts);
	video.addEventListener("stalled", () => log(`video[${label}]: stalled (readyState=${video.readyState})`), opts);
	video.addEventListener("waiting", () => log(`video[${label}]: waiting (readyState=${video.readyState}, currentTime=${video.currentTime.toFixed(1)})`), opts);
	video.addEventListener("seeked", () => log(`video[${label}]: seeked (currentTime=${video.currentTime.toFixed(3)})`), opts);
	video.addEventListener("error", () => {
		const err = video.error;
		const msg = err ? `code=${err.code} "${err.message}"` : "unknown";
		logError(`video[${label}]: error — ${msg}`);
		new Notice(`Split view video error (${label}): ${msg}`);
	}, opts);
}

export class SplitViewModal extends Modal {
	private fileA: SplitViewFile;
	private fileB: SplitViewFile;
	private onCapture: CaptureCallback;
	private vidA: HTMLVideoElement | null = null;
	private vidB: HTMLVideoElement | null = null;
	private objectUrls: string[] = [];
	private transport: SyncTransportResult | null = null;
	private splitPosition = 50;
	private documentListeners: Array<{ type: string; handler: EventListener }> = [];
	private ownedTempPaths = new Set<string>();
	private videoAbort = new AbortController();
	private closed = false;

	constructor(
		plugin: MediaLensPlugin,
		fileA: SplitViewFile,
		fileB: SplitViewFile,
		onCapture: CaptureCallback
	) {
		super(plugin.app);
		this.fileA = fileA;
		this.fileB = fileB;
		this.onCapture = onCapture;
	}

	async onOpen() {
		log("onOpen: starting");
		const { contentEl, modalEl } = this;
		modalEl.addClass("media-lens-wipe-modal");
		contentEl.empty();

		await this.renderSplitView(contentEl);
		this.renderTransport(contentEl);
		log("onOpen: modal visible, buffering in background");
		// Don't block — show modal immediately with loading overlay,
		// controls enable once both videos are ready
		void this.waitForBothReady();
	}

	onClose() {
		log("onClose: cleaning up");
		this.closed = true;
		this.videoAbort.abort();
		if (this.transport) this.transport.stopDrift();
		for (const { type, handler } of this.documentListeners) {
			document.removeEventListener(type, handler);
		}
		this.documentListeners = [];
		for (const url of this.objectUrls) {
			if (url.startsWith("blob:")) URL.revokeObjectURL(url);
		}
		this.objectUrls = [];
		if (this.ownedTempPaths.has(this.fileA.tempVaultPath ?? "")) void this.removeTempFile(this.fileA);
		if (this.ownedTempPaths.has(this.fileB.tempVaultPath ?? "")) void this.removeTempFile(this.fileB);
		this.contentEl.empty();
		log("onClose: done");
	}

	private addDocListener(type: string, handler: EventListener, options?: AddEventListenerOptions) {
		document.addEventListener(type, handler, options);
		this.documentListeners.push({ type, handler });
	}

	private async getMediaUrl(file: SplitViewFile): Promise<string> {
		if (file.mediaUrl) {
			log(`getMediaUrl: reusing pre-existing URL for "${file.name}" → ${file.mediaUrl.slice(0, 80)}…`);
			return file.mediaUrl;
		}

		// Write to temp vault file for reliable app:// playback
		const tempPath = await this.writeTempFile(file);
		const url = this.app.vault.adapter.getResourcePath(normalizePath(tempPath));
		file.tempVaultPath = tempPath;
		file.mediaUrl = url;
		log(`getMediaUrl: "${file.name}" via temp vault → resourcePath (${tempPath}) → ${url.slice(0, 120)}…`);
		return url;
	}

	private async writeTempFile(file: SplitViewFile): Promise<string> {
		const tempDir = normalizePath(TEMP_DIR);
		if (!this.app.vault.getAbstractFileByPath(tempDir)) {
			log(`writeTempFile: creating temp directory "${tempDir}"`);
			try {
				await this.app.vault.createFolder(tempDir);
			} catch {
				// Folder may already exist
			}
		}
		const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
		const tempPath = normalizePath(`${TEMP_DIR}/${id}.${ext}`);
		log(`writeTempFile: writing "${file.name}" (${file.buffer.byteLength} bytes) → "${tempPath}"`);
		await this.app.vault.createBinary(tempPath, file.buffer);
		this.ownedTempPaths.add(tempPath);
		log(`writeTempFile: write complete`);
		return tempPath;
	}

	private async removeTempFile(file: SplitViewFile) {
		if (!file.tempVaultPath) return;
		const path = file.tempVaultPath;
		file.tempVaultPath = undefined;
		try {
			const abstractFile = this.app.vault.getAbstractFileByPath(path);
			if (abstractFile) {
				log(`removeTempFile: deleting "${path}"`);
				await this.app.fileManager.trashFile(abstractFile);
			}
		} catch (err) {
			logError(`removeTempFile: failed to delete "${path}"`, err);
		}
	}

	private loadingOverlay: HTMLElement | null = null;
	private transportButtons: HTMLButtonElement[] = [];
	private seekInput: HTMLInputElement | null = null;

	private async renderSplitView(parent: HTMLElement) {
		const viewport = parent.createDiv({ cls: "media-lens-wipe-viewport" });

		// Loading overlay — shown until both videos are ready
		this.loadingOverlay = viewport.createDiv({ cls: "media-lens-wipe-loading" });
		this.loadingOverlay.createEl("span", { text: "Loading…", cls: "media-lens-wipe-loading-text" });

		log(`renderSplitView: preparing URLs for A="${this.fileA.name}" B="${this.fileB.name}"`);
		const [urlA, urlB] = await Promise.all([
			this.getMediaUrl(this.fileA),
			this.getMediaUrl(this.fileB),
		]);
		if (this.closed) return;

		// Video B (bottom layer)
		log(`renderSplitView: creating video B, url=${urlB.slice(0, 80)}…`);
		this.vidB = viewport.createEl("video", {
			cls: "media-lens-wipe-video media-lens-wipe-video-b",
		});
		this.vidB.muted = true;
		this.vidB.preload = "auto";
		attachVideoLogging(this.vidB, "B", this.videoAbort.signal);
		this.vidB.src = urlB;

		// Video A (top layer, clipped)
		log(`renderSplitView: creating video A, url=${urlA.slice(0, 80)}…`);
		this.vidA = viewport.createEl("video", {
			cls: "media-lens-wipe-video media-lens-wipe-video-a",
		});
		this.vidA.muted = true;
		this.vidA.preload = "auto";
		attachVideoLogging(this.vidA, "A", this.videoAbort.signal);
		this.vidA.src = urlA;

		// Divider
		const divider = viewport.createDiv({ cls: "media-lens-wipe-divider" });

		// Labels
		const labelA = viewport.createDiv({ cls: "media-lens-wipe-label media-lens-wipe-label-a" });
		labelA.createSpan({ text: "A" });
		const labelB = viewport.createDiv({ cls: "media-lens-wipe-label media-lens-wipe-label-b" });
		labelB.createSpan({ text: "B" });

		// Split drag — update CSS variables that drive clip-path and divider position
		let dragging = false;

		const updateSplit = (pct: number) => {
			const clamped = Math.max(0, Math.min(100, pct));
			this.splitPosition = clamped;
			if (this.vidA) {
				this.vidA.setCssProps({ "--wipe-clip": `inset(0 ${100 - clamped}% 0 0)` });
			}
			divider.setCssProps({ "--wipe-pos": `${clamped}%` });
			labelA.setCssProps({ "--wipe-label-a": `${100 - clamped + 2}%` });
			labelB.setCssProps({ "--wipe-label-b": `${clamped + 2}%` });
		};

		updateSplit(50);

		let splitPending = false;
		let splitLatest = 50;
		const onMove = (clientX: number) => {
			if (!dragging) return;
			const rect = viewport.getBoundingClientRect();
			splitLatest = ((clientX - rect.left) / rect.width) * 100;
			if (!splitPending) {
				splitPending = true;
				requestAnimationFrame(() => {
					splitPending = false;
					updateSplit(splitLatest);
				});
			}
		};

		viewport.addEventListener("mousedown", (e) => {
			dragging = true;
			onMove(e.clientX);
		});
		this.addDocListener("mousemove", (e) => onMove((e as MouseEvent).clientX));
		this.addDocListener("mouseup", () => { dragging = false; });

		viewport.addEventListener("touchstart", (e: TouchEvent) => {
			dragging = true;
			e.preventDefault();
			const touch = e.touches[0];
			if (touch) onMove(touch.clientX);
		}, { passive: false });
		this.addDocListener("touchmove", (e) => {
			if (dragging) e.preventDefault();
			const touch = (e as TouchEvent).touches[0];
			if (touch) onMove(touch.clientX);
		}, { passive: false });
		this.addDocListener("touchend", () => { dragging = false; });

		log("renderSplitView: complete");
	}

	private renderTransport(parent: HTMLElement) {
		const vidA = this.vidA;
		const vidB = this.vidB;
		if (!vidA || !vidB) {
			logError("renderTransport: vidA or vidB is null, skipping transport");
			return;
		}

		log("renderTransport: building controls");
		const fps = this.fileA.frameRate;

		const wrapper = parent.createDiv({ cls: "media-lens-wipe-transport" });
		const result = renderSyncTransport(wrapper, vidA, vidB, fps, {
			addDocListener: (type, handler) => this.addDocListener(type, handler),
			log: (msg) => log(msg),
			logError: (msg, ...args) => logError(msg, ...args),
			onCapture: () => {
				log("transport: capture clicked");
				result.stopDrift();
				vidA.pause();
				vidB.pause();
				void (async () => {
					await Promise.all([
						new Promise<void>(r => { if (!vidA.seeking) r(); else vidA.addEventListener("seeked", () => r(), { once: true }); }),
						new Promise<void>(r => { if (!vidB.seeking) r(); else vidB.addEventListener("seeked", () => r(), { once: true }); }),
					]);
					await this.captureSplitComposite(vidA, vidB);
				})();
			},
		});
		this.transport = result;

		// Disable all transport until videos are loaded
		for (const btn of result.buttons) {
			btn.disabled = true;
		}
		result.seekInput.disabled = true;
		this.transportButtons = result.buttons;

		log("renderTransport: complete");
	}

	private async waitForBothReady() {
		if (!this.vidA || !this.vidB) return;
		await Promise.all([
			this.waitForReadyState(this.vidA, 4, "A"),
			this.waitForReadyState(this.vidB, 4, "B"),
		]);
		// Remove loading overlay
		if (this.loadingOverlay) {
			this.loadingOverlay.remove();
			this.loadingOverlay = null;
		}
		// Enable transport controls
		for (const btn of this.transportButtons) {
			btn.disabled = false;
		}
		if (this.transport) this.transport.seekInput.disabled = false;
		log("waitForBothReady: videos ready, UI enabled");
	}

	private waitForReadyState(video: HTMLVideoElement, minState: number, label: string): Promise<void> {
		if (video.readyState >= minState) return Promise.resolve();
		return new Promise((resolve) => {
			log(`waitForReadyState[${label}]: readyState=${video.readyState}, waiting for >=${minState}`);
			const check = () => {
				if (video.readyState >= minState) {
					log(`waitForReadyState[${label}]: ready (readyState=${video.readyState})`);
					resolve();
				}
			};
			video.addEventListener("canplay", check, { once: true });
			video.addEventListener("canplaythrough", check, { once: true });
		});
	}

	private async captureSplitComposite(vidA: HTMLVideoElement, vidB: HTMLVideoElement) {
		log(`captureSplitComposite: vidA ready=${isVideoReady(vidA)} vidB ready=${isVideoReady(vidB)} wipePos=${this.splitPosition.toFixed(1)}`);
		if (!isVideoReady(vidA) || !isVideoReady(vidB)) {
			new Notice("Video not ready for capture");
			logError("captureSplitComposite: video not ready");
			return;
		}
		const w = vidA.videoWidth;
		const h = vidA.videoHeight;
		const splitX = Math.round(w * (this.splitPosition / 100));
		log(`captureSplitComposite: canvas ${w}x${h}, splitX=${splitX}`);

		const canvas = document.createElement("canvas");
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			logError("captureSplitComposite: failed to get 2d context");
			return;
		}

		// Draw B full
		ctx.drawImage(vidB, 0, 0, w, h);

		// Draw A clipped to left of divider
		ctx.save();
		ctx.beginPath();
		ctx.rect(0, 0, splitX, h);
		ctx.clip();
		ctx.drawImage(vidA, 0, 0, w, h);
		ctx.restore();

		// Draw divider line
		ctx.strokeStyle = "white";
		ctx.lineWidth = 2;
		ctx.shadowColor = "rgba(0,0,0,0.5)";
		ctx.shadowBlur = 4;
		ctx.beginPath();
		ctx.moveTo(splitX, 0);
		ctx.lineTo(splitX, h);
		ctx.stroke();

		// Draw A/B labels
		ctx.shadowBlur = 0;
		ctx.font = "bold 14px sans-serif";
		ctx.fillStyle = "rgba(0,0,0,0.5)";
		ctx.fillRect(splitX - 30, 8, 22, 20);
		ctx.fillRect(splitX + 8, 8, 22, 20);
		ctx.fillStyle = "white";
		ctx.fillText("A", splitX - 24, 23);
		ctx.fillText("B", splitX + 14, 23);

		const blob = await new Promise<Blob | null>((resolve) => {
			canvas.toBlob(resolve, "image/png");
		});
		if (!blob) {
			logError("captureSplitComposite: toBlob returned null");
			new Notice("Failed to capture split view frame");
			return;
		}

		log(`captureSplitComposite: captured ${blob.size} bytes`);
		this.onCapture(vidA, vidB, blob);
		new Notice(`Split view frame captured at ${formatTimestamp(vidA.currentTime)}`);
	}


}

export function openSplitViewModal(
	plugin: MediaLensPlugin,
	fileA: { name: string; buffer: ArrayBuffer; category: MediaCategory; frameRate: number; fileRef?: File; mediaUrl?: string },
	fileB: { name: string; buffer: ArrayBuffer; category: MediaCategory; frameRate: number; fileRef?: File; mediaUrl?: string },
	onCapture: CaptureCallback
) {
	log(`openSplitViewModal: A="${fileA.name}" (${fileA.buffer.byteLength} bytes) B="${fileB.name}" (${fileB.buffer.byteLength} bytes)`);
	new SplitViewModal(plugin, fileA, fileB, onCapture).open();
}
