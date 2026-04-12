export function formatTimestamp(seconds: number): string {
	if (!isFinite(seconds) || seconds < 0) return "0:00.000";
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	const ms = Math.floor((seconds % 1) * 1000);
	return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

export function isVideoReady(video: HTMLVideoElement): boolean {
	return video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
}

export interface DriftController {
	start(): void;
	stop(): void;
}

/**
 * Event-driven drift correction. Listens to vidA's `timeupdate` (~4Hz from
 * the browser) and snaps vidB to match when drift exceeds a threshold.
 * No RAF loop, no playbackRate changes — just a periodic hard seek when needed.
 */
export function createDriftController(
	vidA: HTMLVideoElement,
	vidB: HTMLVideoElement,
	frameDuration: number
): DriftController {
	// Snap threshold: drift must exceed this many frames to trigger correction.
	// Too low → constant seeking / stutter. Too high → visible desync.
	const threshold = frameDuration * 3;

	const onTimeUpdate = () => {
		if (vidB.paused || vidB.ended) return;
		// Don't correct while either video is buffering
		if (vidA.readyState < 3 || vidB.readyState < 3) return;

		const drift = vidB.currentTime - vidA.currentTime;
		if (Math.abs(drift) > threshold) {
			vidB.currentTime = vidA.currentTime;
		}
	};

	return {
		start() {
			vidA.addEventListener("timeupdate", onTimeUpdate);
		},
		stop() {
			vidA.removeEventListener("timeupdate", onTimeUpdate);
		},
	};
}
