import { Modal, Notice } from "obsidian";
import type MediaLensPlugin from "../main";
import { formatTimestamp, isVideoReady } from "../utils/video-sync";
import { renderSyncTransport, type SyncTransportResult } from "./sync-transport";

interface SplitViewConfig {
	name: string;
	frameRate: number;
	video: HTMLVideoElement;
}

type CaptureCallback = (vidA: HTMLVideoElement, vidB: HTMLVideoElement, splitBlob?: Blob) => void;

function log(msg: string, ...args: unknown[]) {
	console.debug(`[Media Lens][SplitView] ${msg}`, ...args);
}

function logError(msg: string, ...args: unknown[]) {
	console.error(`[Media Lens][SplitView] ${msg}`, ...args);
}

export class SplitViewModal extends Modal {
	private configA: SplitViewConfig;
	private configB: SplitViewConfig;
	private onCapture: CaptureCallback;
	private vidA: HTMLVideoElement;
	private vidB: HTMLVideoElement;
	private transport: SyncTransportResult | null = null;
	private splitPosition = 50;
	private documentListeners: Array<{ type: string; handler: EventListener }> = [];
	/** Original parent elements — videos are returned here on close */
	private vidAParent: HTMLElement | null = null;
	private vidBParent: HTMLElement | null = null;

	constructor(
		plugin: MediaLensPlugin,
		configA: SplitViewConfig,
		configB: SplitViewConfig,
		onCapture: CaptureCallback
	) {
		super(plugin.app);
		this.configA = configA;
		this.configB = configB;
		this.vidA = configA.video;
		this.vidB = configB.video;
		this.onCapture = onCapture;
	}

	onOpen() {
		log("onOpen: transferring video elements");
		const { contentEl, modalEl } = this;
		modalEl.addClass("media-lens-wipe-modal");
		contentEl.empty();

		// Remember original parents so we can return videos on close
		this.vidAParent = this.vidA.parentElement;
		this.vidBParent = this.vidB.parentElement;

		this.renderSplitView(contentEl);
		this.renderTransport(contentEl);
		log("onOpen: complete — videos transferred, no reload needed");
	}

	onClose() {
		log("onClose: returning video elements to sidebar");
		if (this.transport) this.transport.stopDrift();
		for (const { type, handler } of this.documentListeners) {
			document.removeEventListener(type, handler);
		}
		this.documentListeners = [];

		// Strip split view CSS classes before returning
		this.vidA.removeClass("media-lens-wipe-video", "media-lens-wipe-video-a");
		this.vidB.removeClass("media-lens-wipe-video", "media-lens-wipe-video-b");
		this.vidA.setCssProps({ "--wipe-clip": "" });

		// Return videos to their original sidebar parents
		if (this.vidAParent) this.vidAParent.appendChild(this.vidA);
		if (this.vidBParent) this.vidBParent.appendChild(this.vidB);

		this.contentEl.empty();
		log("onClose: done");
	}

	private addDocListener(type: string, handler: EventListener, options?: AddEventListenerOptions) {
		document.addEventListener(type, handler, options);
		this.documentListeners.push({ type, handler });
	}

	private renderSplitView(parent: HTMLElement) {
		const viewport = parent.createDiv({ cls: "media-lens-wipe-viewport" });

		// Transfer video B (bottom layer) from sidebar into viewport
		this.vidB.addClass("media-lens-wipe-video", "media-lens-wipe-video-b");
		this.vidB.controls = false;
		viewport.appendChild(this.vidB);

		// Transfer video A (top layer, clipped) from sidebar into viewport
		this.vidA.addClass("media-lens-wipe-video", "media-lens-wipe-video-a");
		this.vidA.controls = false;
		viewport.appendChild(this.vidA);

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

		log("renderTransport: building controls");
		const fps = this.configA.frameRate;

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

		log("renderTransport: complete");
	}

	private async captureSplitComposite(vidA: HTMLVideoElement, vidB: HTMLVideoElement) {
		log(`captureSplitComposite: vidA ready=${isVideoReady(vidA)} vidB ready=${isVideoReady(vidB)} wipePos=${this.splitPosition.toFixed(1)}`);
		if (!isVideoReady(vidA) || !isVideoReady(vidB)) {
			new Notice("Video not ready for capture");
			logError("captureSplitComposite: video not ready");
			return;
		}
		const w = Math.max(vidA.videoWidth, vidB.videoWidth);
		const h = Math.max(vidA.videoHeight, vidB.videoHeight);
		const splitX = Math.round(w * (this.splitPosition / 100));
		log(`captureSplitComposite: canvas ${w}x${h}, splitX=${splitX} (A=${vidA.videoWidth}x${vidA.videoHeight}, B=${vidB.videoWidth}x${vidB.videoHeight})`);

		const canvas = document.createElement("canvas");
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			logError("captureSplitComposite: failed to get 2d context");
			return;
		}

		// Draw B scaled to canvas size
		ctx.drawImage(vidB, 0, 0, w, h);

		// Draw A clipped to left of divider, scaled to canvas size
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
	configA: SplitViewConfig,
	configB: SplitViewConfig,
	onCapture: CaptureCallback
) {
	log(`openSplitViewModal: A="${configA.name}" B="${configB.name}"`);
	new SplitViewModal(plugin, configA, configB, onCapture).open();
}
