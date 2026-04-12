import { Modal, normalizePath, Notice, setIcon } from "obsidian";
import type MediaLensPlugin from "../main";
import { createDriftController, formatTimestamp, isVideoReady, type DriftController } from "../utils/video-sync";
import type { MediaCategory } from "../utils/media";

const TEMP_DIR = ".media-lens-temp";

interface WipeFile {
	name: string;
	buffer: ArrayBuffer;
	category: MediaCategory;
	frameRate: number;
	fileRef?: File;
	/** Pre-existing media URL from the sidebar (avoids re-writing temp files) */
	mediaUrl?: string;
	tempVaultPath?: string;
}

type CaptureCallback = (vidA: HTMLVideoElement, vidB: HTMLVideoElement, wipeBlob?: Blob) => void;

function log(msg: string, ...args: unknown[]) {
	console.log(`[Media Lens][Wipe] ${msg}`, ...args);
}

function logError(msg: string, ...args: unknown[]) {
	console.error(`[Media Lens][Wipe] ${msg}`, ...args);
}

function attachVideoLogging(video: HTMLVideoElement, label: string) {
	video.addEventListener("loadstart", () => log(`video[${label}]: loadstart`));
	video.addEventListener("loadedmetadata", () => log(`video[${label}]: loadedmetadata (${video.videoWidth}x${video.videoHeight}, ${video.duration.toFixed(1)}s)`));
	video.addEventListener("loadeddata", () => log(`video[${label}]: loadeddata (readyState=${video.readyState})`));
	video.addEventListener("canplay", () => log(`video[${label}]: canplay`));
	video.addEventListener("canplaythrough", () => log(`video[${label}]: canplaythrough`));
	video.addEventListener("playing", () => log(`video[${label}]: playing`));
	video.addEventListener("pause", () => log(`video[${label}]: pause`));
	video.addEventListener("stalled", () => log(`video[${label}]: stalled (readyState=${video.readyState})`));
	video.addEventListener("waiting", () => log(`video[${label}]: waiting (readyState=${video.readyState}, currentTime=${video.currentTime.toFixed(1)})`));
	video.addEventListener("seeked", () => log(`video[${label}]: seeked (currentTime=${video.currentTime.toFixed(3)})`));
	video.addEventListener("error", () => {
		const err = video.error;
		const msg = err ? `code=${err.code} "${err.message}"` : "unknown";
		logError(`video[${label}]: error — ${msg}`);
		new Notice(`Wipe video error (${label}): ${msg}`);
	});
}

export class WipeModal extends Modal {
	private fileA: WipeFile;
	private fileB: WipeFile;
	private onCapture: CaptureCallback;
	private vidA: HTMLVideoElement | null = null;
	private vidB: HTMLVideoElement | null = null;
	private objectUrls: string[] = [];
	private driftController: DriftController | null = null;
	private wipePosition = 50;
	private documentListeners: Array<{ type: string; handler: EventListener }> = [];
	private ownedTempPaths = new Set<string>();

	constructor(
		plugin: MediaLensPlugin,
		fileA: WipeFile,
		fileB: WipeFile,
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

		await this.renderWipeView(contentEl);
		this.renderTransport(contentEl);
		log("onOpen: complete");
	}

	onClose() {
		log("onClose: cleaning up");
		if (this.driftController) this.driftController.stop();
		for (const { type, handler } of this.documentListeners) {
			document.removeEventListener(type, handler);
		}
		this.documentListeners = [];
		for (const url of this.objectUrls) {
			if (url.startsWith("blob:")) URL.revokeObjectURL(url);
		}
		this.objectUrls = [];
		// Only remove temp files the modal created (not pre-existing sidebar ones)
		if (this.ownedTempPaths.has(this.fileA.tempVaultPath ?? "")) void this.removeTempFile(this.fileA);
		if (this.ownedTempPaths.has(this.fileB.tempVaultPath ?? "")) void this.removeTempFile(this.fileB);
		this.contentEl.empty();
		log("onClose: done");
	}

	private addDocListener(type: string, handler: EventListener, options?: AddEventListenerOptions) {
		document.addEventListener(type, handler, options);
		this.documentListeners.push({ type, handler });
	}

	private async getMediaUrl(file: WipeFile): Promise<string> {
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

	private async writeTempFile(file: WipeFile): Promise<string> {
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

	private async removeTempFile(file: WipeFile) {
		if (!file.tempVaultPath) return;
		const path = file.tempVaultPath;
		file.tempVaultPath = undefined;
		try {
			const abstractFile = this.app.vault.getAbstractFileByPath(path);
			if (abstractFile) {
				log(`removeTempFile: deleting "${path}"`);
				await this.app.vault.delete(abstractFile);
			}
		} catch (err) {
			logError(`removeTempFile: failed to delete "${path}"`, err);
		}
	}

	private async renderWipeView(parent: HTMLElement) {
		const viewport = parent.createDiv({ cls: "media-lens-wipe-viewport" });

		log(`renderWipeView: preparing URLs for A="${this.fileA.name}" B="${this.fileB.name}"`);
		const [urlA, urlB] = await Promise.all([
			this.getMediaUrl(this.fileA),
			this.getMediaUrl(this.fileB),
		]);

		// Video B (bottom layer)
		log(`renderWipeView: creating video B, url=${urlB.slice(0, 80)}…`);
		this.vidB = viewport.createEl("video", {
			cls: "media-lens-wipe-video media-lens-wipe-video-b",
		});
		this.vidB.muted = true;
		this.vidB.preload = "auto";
		attachVideoLogging(this.vidB, "B");
		this.vidB.src = urlB;

		// Video A (top layer, clipped)
		log(`renderWipeView: creating video A, url=${urlA.slice(0, 80)}…`);
		this.vidA = viewport.createEl("video", {
			cls: "media-lens-wipe-video media-lens-wipe-video-a",
		});
		this.vidA.muted = true;
		this.vidA.preload = "auto";
		attachVideoLogging(this.vidA, "A");
		this.vidA.src = urlA;

		// Divider
		const divider = viewport.createDiv({ cls: "media-lens-wipe-divider" });

		// Labels
		const labelA = viewport.createDiv({ cls: "media-lens-wipe-label media-lens-wipe-label-a" });
		labelA.createSpan({ text: "A" });
		const labelB = viewport.createDiv({ cls: "media-lens-wipe-label media-lens-wipe-label-b" });
		labelB.createSpan({ text: "B" });

		// Wipe drag — update CSS variables that drive clip-path and divider position
		let dragging = false;

		const updateWipe = (pct: number) => {
			const clamped = Math.max(0, Math.min(100, pct));
			this.wipePosition = clamped;
			if (this.vidA) {
				this.vidA.setCssProps({ "--wipe-clip": `inset(0 ${100 - clamped}% 0 0)` });
			}
			divider.setCssProps({ "--wipe-pos": `${clamped}%` });
			labelA.setCssProps({ "--wipe-label-a": `${100 - clamped + 2}%` });
			labelB.setCssProps({ "--wipe-label-b": `${clamped + 2}%` });
		};

		updateWipe(50);

		let wipePending = false;
		let wipeLatest = 50;
		const onMove = (clientX: number) => {
			if (!dragging) return;
			const rect = viewport.getBoundingClientRect();
			wipeLatest = ((clientX - rect.left) / rect.width) * 100;
			if (!wipePending) {
				wipePending = true;
				requestAnimationFrame(() => {
					wipePending = false;
					updateWipe(wipeLatest);
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

		log("renderWipeView: complete");
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
		const frameDuration = 1 / fps;

		const transport = parent.createDiv({ cls: "media-lens-wipe-transport" });

		// Seek row
		const seekRow = transport.createDiv({ cls: "media-lens-wipe-seek" });
		const timeLabel = seekRow.createSpan({ cls: "media-lens-wipe-time" });
		const seekInput = seekRow.createEl("input", {
			cls: "media-lens-wipe-range",
			attr: { type: "range", min: "0", step: "0.001", value: "0" },
		});
		const durationLabel = seekRow.createSpan({ cls: "media-lens-wipe-time" });

		const updateDuration = () => {
			const durA = vidA.duration || 0;
			const durB = vidB.duration || 0;
			const maxDur = Math.max(durA, durB);
			seekInput.max = String(maxDur);
			if (durA > 0 && durB > 0 && Math.abs(durA - durB) > 0.5) {
				durationLabel.textContent = `A ${formatTimestamp(durA)} / B ${formatTimestamp(durB)}`;
			} else {
				durationLabel.textContent = formatTimestamp(maxDur);
			}
			log(`renderTransport: duration updated (A=${durA.toFixed(1)}s, B=${durB.toFixed(1)}s)`);
		};
		vidA.addEventListener("loadedmetadata", updateDuration);
		vidB.addEventListener("loadedmetadata", updateDuration);
		updateDuration();

		// Scrub logic (rAF throttled, videos paused during scrub)
		let scrubbing = false;
		let wasPlaying = false;
		let rafId: number | null = null;
		let scrubTarget: number | null = null;

		const updateTime = () => {
			if (scrubbing) return;
			seekInput.value = String(vidA.currentTime);
			timeLabel.textContent = formatTimestamp(vidA.currentTime);
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
			timeLabel.textContent = formatTimestamp(t);
		};

		const startScrub = () => {
			scrubbing = true;
			wasPlaying = !vidA.paused;
			vidA.pause();
			vidB.pause();
			log("transport: scrub started");
		};
		seekInput.addEventListener("mousedown", startScrub);
		seekInput.addEventListener("touchstart", startScrub);

		seekInput.addEventListener("input", () => {
			scrubTarget = parseFloat(seekInput.value);
			timeLabel.textContent = formatTimestamp(scrubTarget);
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
			log(`transport: scrub ended at ${t.toFixed(3)}s`);
			if (wasPlaying) {
				this.syncPlay(vidA, vidB);
			}
		};
		this.addDocListener("mouseup", endScrub);
		this.addDocListener("touchend", endScrub);

		// Mute row
		const muteRow = transport.createDiv({ cls: "media-lens-wipe-mute-row" });
		this.renderMuteBtn(muteRow, vidA, "Mute A");
		this.renderMuteBtn(muteRow, vidB, "Mute B");

		// Controls row
		const controls = transport.createDiv({ cls: "media-lens-wipe-controls" });

		const skipBack = this.makeBtn(controls, "rewind", "Back 10 seconds");
		const frameBack = this.makeBtn(controls, "chevron-left", "Previous frame");
		const playPause = this.makeBtn(controls, "play", "Play or pause");
		const ppIcon = playPause.querySelector("span") as HTMLElement;
		const frameFwd = this.makeBtn(controls, "chevron-right", "Next frame");
		const skipFwd = this.makeBtn(controls, "fast-forward", "Forward 10 seconds");

		const captureBtn = this.makeBtn(controls, "camera", "Capture frames");

		const updatePlayIcon = () => {
			if (ppIcon) {
				ppIcon.empty();
				setIcon(ppIcon, vidA.paused ? "play" : "pause");
			}
		};
		vidA.addEventListener("play", updatePlayIcon);
		vidA.addEventListener("pause", updatePlayIcon);

		// Play/pause
		playPause.addEventListener("click", () => {
			log(`transport: play/pause clicked (paused=${vidA.paused})`);
			if (vidA.paused) {
				this.syncPlay(vidA, vidB);
			} else {
				this.syncPause(vidA, vidB);
			}
		});

		// Frame step
		const step = (delta: number) => {
			this.syncPause(vidA, vidB);
			const t = Math.max(0, vidA.currentTime + delta);
			vidA.currentTime = t;
			vidB.currentTime = t;
			log(`transport: step delta=${delta.toFixed(4)} → t=${t.toFixed(3)}`);
		};

		frameBack.addEventListener("click", () => step(-frameDuration));
		frameFwd.addEventListener("click", () => step(frameDuration));
		skipBack.addEventListener("click", () => step(-10));
		skipFwd.addEventListener("click", () => step(10));

		// Capture
		captureBtn.addEventListener("click", () => {
			log("transport: capture clicked");
			captureBtn.disabled = true;
			void (async () => {
				this.syncPause(vidA, vidB);
				await Promise.all([
					new Promise<void>(r => { if (!vidA.seeking) r(); else vidA.addEventListener("seeked", () => r(), { once: true }); }),
					new Promise<void>(r => { if (!vidB.seeking) r(); else vidB.addEventListener("seeked", () => r(), { once: true }); }),
				]);
				await this.captureWipeComposite(vidA, vidB);
			})().finally(() => {
				captureBtn.disabled = false;
			});
		});

		log("renderTransport: complete");
	}

	private async syncPlay(vidA: HTMLVideoElement, vidB: HTMLVideoElement) {
		log(`syncPlay: aligning B to A (t=${vidA.currentTime.toFixed(3)}), waiting for buffer...`);
		vidB.currentTime = vidA.currentTime;
		vidB.playbackRate = 1;

		// Wait for both videos to have enough data before starting
		await Promise.all([
			this.waitForReadyState(vidA, 3, "A"),
			this.waitForReadyState(vidB, 3, "B"),
		]);

		log("syncPlay: both buffered, starting playback");
		try {
			await Promise.all([vidA.play(), vidB.play()]);
			log("syncPlay: both videos playing");
		} catch (err) {
			logError("syncPlay: play failed", err);
		}

		if (!this.driftController) {
			this.driftController = createDriftController(vidA, vidB, 1 / this.fileA.frameRate);
		}
		this.driftController.start();
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

	private syncPause(vidA: HTMLVideoElement, vidB: HTMLVideoElement) {
		log("syncPause");
		if (this.driftController) this.driftController.stop();
		vidA.pause();
		vidB.pause();
		vidB.playbackRate = 1;
		vidB.currentTime = vidA.currentTime;
	}

	private async captureWipeComposite(vidA: HTMLVideoElement, vidB: HTMLVideoElement) {
		log(`captureWipeComposite: vidA ready=${isVideoReady(vidA)} vidB ready=${isVideoReady(vidB)} wipePos=${this.wipePosition.toFixed(1)}`);
		if (!isVideoReady(vidA) || !isVideoReady(vidB)) {
			new Notice("Video not ready for capture");
			logError("captureWipeComposite: video not ready");
			return;
		}
		const w = vidA.videoWidth;
		const h = vidA.videoHeight;
		const splitX = Math.round(w * (this.wipePosition / 100));
		log(`captureWipeComposite: canvas ${w}x${h}, splitX=${splitX}`);

		const canvas = document.createElement("canvas");
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			logError("captureWipeComposite: failed to get 2d context");
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
			logError("captureWipeComposite: toBlob returned null");
			new Notice("Failed to capture wipe frame");
			return;
		}

		log(`captureWipeComposite: captured ${blob.size} bytes`);
		this.onCapture(vidA, vidB, blob);
		new Notice(`Wipe frame captured at ${formatTimestamp(vidA.currentTime)}`);
	}


	private makeBtn(parent: HTMLElement, icon: string, label: string): HTMLButtonElement {
		const btn = parent.createEl("button", {
			cls: "media-lens-wipe-btn",
			attr: { "aria-label": label },
		});
		const iconEl = btn.createSpan();
		setIcon(iconEl, icon);
		return btn;
	}

	private renderMuteBtn(parent: HTMLElement, video: HTMLVideoElement, label: string) {
		const btn = parent.createEl("button", {
			cls: "media-lens-wipe-btn media-lens-wipe-mute-btn",
			attr: { "aria-label": label },
		});
		const iconEl = btn.createSpan();
		btn.createSpan({ text: label });
		const update = () => {
			iconEl.empty();
			setIcon(iconEl, video.muted ? "volume-x" : "volume-2");
		};
		update();
		btn.addEventListener("click", () => {
			video.muted = !video.muted;
			log(`mute toggle: ${label} → muted=${video.muted}`);
			update();
		});
	}
}

export function openWipeModal(
	plugin: MediaLensPlugin,
	fileA: { name: string; buffer: ArrayBuffer; category: MediaCategory; frameRate: number; fileRef?: File; mediaUrl?: string },
	fileB: { name: string; buffer: ArrayBuffer; category: MediaCategory; frameRate: number; fileRef?: File; mediaUrl?: string },
	onCapture: CaptureCallback
) {
	log(`openWipeModal: A="${fileA.name}" (${fileA.buffer.byteLength} bytes) B="${fileB.name}" (${fileB.buffer.byteLength} bytes)`);
	new WipeModal(plugin, fileA, fileB, onCapture).open();
}
