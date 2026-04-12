import { Modal, Notice, setIcon } from "obsidian";
import type MediaLensPlugin from "../main";
import { getMimeType } from "../utils/media";
import { createDriftController, formatTimestamp, isVideoReady, type DriftController } from "../utils/video-sync";
import type { MediaCategory } from "../utils/media";

interface WipeFile {
	name: string;
	buffer: ArrayBuffer;
	category: MediaCategory;
	frameRate: number;
}

type CaptureCallback = (vidA: HTMLVideoElement, vidB: HTMLVideoElement, wipeBlob?: Blob) => void;

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

	onOpen() {
		const { contentEl, modalEl } = this;
		modalEl.addClass("media-lens-wipe-modal");
		contentEl.empty();

		this.renderWipeView(contentEl);
		this.renderTransport(contentEl);
	}

	onClose() {
		if (this.driftController) this.driftController.stop();
		for (const { type, handler } of this.documentListeners) {
			document.removeEventListener(type, handler);
		}
		this.documentListeners = [];
		for (const url of this.objectUrls) URL.revokeObjectURL(url);
		this.objectUrls = [];
		this.contentEl.empty();
	}

	private addDocListener(type: string, handler: EventListener, options?: AddEventListenerOptions) {
		document.addEventListener(type, handler, options);
		this.documentListeners.push({ type, handler });
	}

	private createUrl(buffer: ArrayBuffer, ext: string, category: MediaCategory): string {
		const mime = getMimeType(ext, category);
		const url = URL.createObjectURL(new Blob([buffer], { type: mime }));
		this.objectUrls.push(url);
		return url;
	}

	private renderWipeView(parent: HTMLElement) {
		const viewport = parent.createDiv({ cls: "media-lens-wipe-viewport" });

		const extA = this.fileA.name.split(".").pop()?.toLowerCase() ?? "";
		const extB = this.fileB.name.split(".").pop()?.toLowerCase() ?? "";

		// Video B (bottom layer)
		this.vidB = viewport.createEl("video", {
			cls: "media-lens-wipe-video media-lens-wipe-video-b",
			attr: { src: this.createUrl(this.fileB.buffer, extB, this.fileB.category), preload: "auto" },
		});
		this.vidB.muted = true; // mute B by default to reduce decode overhead

		// Video A (top layer, clipped)
		this.vidA = viewport.createEl("video", {
			cls: "media-lens-wipe-video media-lens-wipe-video-a",
			attr: { src: this.createUrl(this.fileA.buffer, extA, this.fileA.category), preload: "auto" },
		});

		// Divider
		const divider = viewport.createDiv({ cls: "media-lens-wipe-divider" });

		// Labels
		const labelA = viewport.createDiv({ cls: "media-lens-wipe-label media-lens-wipe-label-a" });
		labelA.createSpan({ text: "A" });
		const labelB = viewport.createDiv({ cls: "media-lens-wipe-label media-lens-wipe-label-b" });
		labelB.createSpan({ text: "B" });

		// Wipe drag — update clip-path and divider position
		let dragging = false;
		let cachedRect: DOMRect | null = null;

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
			if (!dragging || !cachedRect) return;
			wipeLatest = ((clientX - cachedRect.left) / cachedRect.width) * 100;
			if (!wipePending) {
				wipePending = true;
				requestAnimationFrame(() => {
					wipePending = false;
					updateWipe(wipeLatest);
				});
			}
		};

		const startDrag = (clientX: number) => {
			dragging = true;
			cachedRect = viewport.getBoundingClientRect();
			onMove(clientX);
		};

		viewport.addEventListener("mousedown", (e) => startDrag(e.clientX));
		this.addDocListener("mousemove", (e) => onMove((e as MouseEvent).clientX));
		this.addDocListener("mouseup", () => { dragging = false; cachedRect = null; });

		viewport.addEventListener("touchstart", (e: TouchEvent) => {
			e.preventDefault();
			const touch = e.touches[0];
			if (touch) startDrag(touch.clientX);
		}, { passive: false });
		this.addDocListener("touchmove", (e) => {
			if (dragging) e.preventDefault();
			const touch = (e as TouchEvent).touches[0];
			if (touch) onMove(touch.clientX);
		}, { passive: false });
		this.addDocListener("touchend", () => { dragging = false; cachedRect = null; });
	}

	private renderTransport(parent: HTMLElement) {
		const vidA = this.vidA;
		const vidB = this.vidB;
		if (!vidA || !vidB) return;

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
		};

		frameBack.addEventListener("click", () => step(-frameDuration));
		frameFwd.addEventListener("click", () => step(frameDuration));
		skipBack.addEventListener("click", () => step(-10));
		skipFwd.addEventListener("click", () => step(10));

		// Capture — pause, align, wait for seek, then composite + individual frames
		captureBtn.addEventListener("click", () => {
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
	}

	private syncPlay(vidA: HTMLVideoElement, vidB: HTMLVideoElement) {
		vidB.currentTime = vidA.currentTime;
		vidB.playbackRate = 1;
		Promise.all([vidA.play(), vidB.play()]).catch(() => { /* playback blocked */ });

		if (!this.driftController) {
			this.driftController = createDriftController(vidA, vidB, 1 / this.fileA.frameRate);
		}
		this.driftController.start();
	}

	private syncPause(vidA: HTMLVideoElement, vidB: HTMLVideoElement) {
		if (this.driftController) this.driftController.stop();
		vidA.pause();
		vidB.pause();
		vidB.playbackRate = 1;
		vidB.currentTime = vidA.currentTime;
	}

	private async captureWipeComposite(vidA: HTMLVideoElement, vidB: HTMLVideoElement) {
		if (!isVideoReady(vidA) || !isVideoReady(vidB)) {
			new Notice("Video not ready for capture");
			return;
		}
		const w = vidA.videoWidth;
		const h = vidA.videoHeight;
		const splitX = Math.round(w * (this.wipePosition / 100));

		const canvas = document.createElement("canvas");
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

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
			new Notice("Failed to capture wipe frame");
			return;
		}

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
			update();
		});
	}
}

export function openWipeModal(
	plugin: MediaLensPlugin,
	fileA: { name: string; buffer: ArrayBuffer; category: MediaCategory; frameRate: number },
	fileB: { name: string; buffer: ArrayBuffer; category: MediaCategory; frameRate: number },
	onCapture: CaptureCallback
) {
	new WipeModal(plugin, fileA, fileB, onCapture).open();
}
