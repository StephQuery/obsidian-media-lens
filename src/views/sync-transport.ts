import { setIcon } from "obsidian";
import { createDriftController, formatTimestamp } from "../utils/video-sync";

export interface SyncTransportCallbacks {
	addDocListener(type: string, handler: EventListener): void;
	log(msg: string): void;
	logError(msg: string, ...args: unknown[]): void;
	onCapture?: () => void;
}

export interface SyncTransportResult {
	container: HTMLElement;
	/** Call to stop the drift controller */
	stopDrift: () => void;
	/** All transport buttons (for disabling during loading) */
	buttons: HTMLButtonElement[];
	/** The seek input element */
	seekInput: HTMLInputElement;
	/** The mute button container row */
	muteRow: HTMLElement;
	/** The controls row (for appending extra buttons like capture) */
	controlsRow: HTMLElement;
}

/**
 * Renders a unified transport bar for synced dual-video playback.
 * Used by both the sidebar sync view and the split view modal.
 */
export function renderSyncTransport(
	parent: HTMLElement,
	vidA: HTMLVideoElement,
	vidB: HTMLVideoElement,
	fps: number,
	callbacks: SyncTransportCallbacks
): SyncTransportResult {
	const frameDuration = 1 / fps;
	const drift = createDriftController(vidA, vidB, frameDuration);

	vidA.addEventListener("play", () => {
		vidB.currentTime = vidA.currentTime;
		vidB.playbackRate = 1;
		drift.start();
	});
	vidA.addEventListener("pause", () => drift.stop());
	vidA.addEventListener("ended", () => drift.stop());

	const bar = parent.createDiv({ cls: "media-lens-transport" });

	// Seek bar
	const seekRow = bar.createDiv({ cls: "media-lens-transport-seek" });
	const timeLabel = seekRow.createSpan({ cls: "media-lens-transport-time" });
	const seekInput = seekRow.createEl("input", {
		cls: "media-lens-transport-range",
		attr: { type: "range", min: "0", step: "0.001", value: "0" },
	});
	const durationLabel = seekRow.createSpan({ cls: "media-lens-transport-time" });

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

	// Scrub logic
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
			vidB.currentTime = vidA.currentTime;
			Promise.all([vidA.play(), vidB.play()]).catch(() => { /* playback blocked */ });
			drift.start();
		}
	};
	callbacks.addDocListener("mouseup", endScrub);
	callbacks.addDocListener("touchend", endScrub);

	// Controls row
	const controls = bar.createDiv({ cls: "media-lens-transport-controls" });

	const makeBtn = (icon: string, label: string): HTMLButtonElement => {
		const btn = controls.createEl("button", {
			cls: "media-lens-btn media-lens-btn-secondary media-lens-frame-btn",
			attr: { "aria-label": label },
		});
		const el = btn.createSpan();
		setIcon(el, icon);
		return btn;
	};

	const skipBack = makeBtn("rewind", "Back 5 seconds");
	const frameBack = makeBtn("chevron-left", "Previous frame");
	const stopBtn = makeBtn("square", "Stop");
	const playPauseBtn = makeBtn("play", "Play or pause");
	const ppIcon = playPauseBtn.querySelector("span") as HTMLElement;
	const frameFwd = makeBtn("chevron-right", "Next frame");
	const skipFwd = makeBtn("fast-forward", "Forward 5 seconds");

	controls.createDiv({ cls: "media-lens-transport-sep" });

	// Mute buttons
	const muteRow = controls.createDiv({ cls: "media-lens-transport-mute-group" });
	renderMuteButton(muteRow, vidA, "A");
	renderMuteButton(muteRow, vidB, "B");

	// Capture button
	controls.createDiv({ cls: "media-lens-transport-sep" });
	const captureBtn = makeBtn("camera", "Capture frame");
	if (callbacks.onCapture) {
		const handler = callbacks.onCapture;
		captureBtn.addEventListener("click", () => handler());
	} else {
		captureBtn.addClass("media-lens-hidden");
	}

	const allButtons = [skipBack, frameBack, stopBtn, playPauseBtn, frameFwd, skipFwd, captureBtn];

	// Play/pause
	const updatePlayIcon = () => {
		ppIcon.empty();
		setIcon(ppIcon, vidA.paused ? "play" : "pause");
	};
	vidA.addEventListener("play", updatePlayIcon);
	vidA.addEventListener("pause", updatePlayIcon);

	playPauseBtn.addEventListener("click", () => {
		callbacks.log(`transport: play/pause clicked (paused=${vidA.paused})`);
		if (vidA.paused) {
			vidB.currentTime = vidA.currentTime;
			Promise.all([vidA.play(), vidB.play()]).then(() => {
				callbacks.log("transport: both playing");
			}).catch((err) => {
				callbacks.logError("transport: play failed", err);
			});
			drift.start();
		} else {
			drift.stop();
			vidA.pause();
			vidB.pause();
			vidB.currentTime = vidA.currentTime;
		}
	});

	// Stop
	stopBtn.addEventListener("click", () => {
		drift.stop();
		vidA.pause();
		vidB.pause();
		vidA.currentTime = 0;
		vidB.currentTime = 0;
	});

	// Frame stepping & skip
	const step = (delta: number) => {
		drift.stop();
		vidA.pause();
		vidB.pause();
		const t = Math.max(0, vidA.currentTime + delta);
		vidA.currentTime = t;
		vidB.currentTime = t;
	};
	skipBack.addEventListener("click", () => step(-5));
	frameBack.addEventListener("click", () => step(-frameDuration));
	frameFwd.addEventListener("click", () => step(frameDuration));
	skipFwd.addEventListener("click", () => step(5));

	return {
		container: bar,
		stopDrift: () => drift.stop(),
		buttons: allButtons,
		seekInput,
		muteRow,
		controlsRow: controls,
	};
}

function renderMuteButton(parent: HTMLElement, video: HTMLVideoElement, label: string) {
	const btn = parent.createEl("button", {
		cls: "media-lens-btn-mute",
		attr: { "aria-label": `Mute ${label}` },
	});
	const iconEl = btn.createSpan();
	btn.createSpan({ text: label, cls: "media-lens-mute-label" });
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
