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
 * Drift correction using RAF for accuracy + timeupdate as fallback.
 * Snaps vidB to vidA when drift exceeds 1 frame. No playbackRate changes.
 * RAF loop only runs while active (playing) — zero cost when paused.
 */
export function createDriftController(
	vidA: HTMLVideoElement,
	vidB: HTMLVideoElement,
	frameDuration: number
): DriftController {
	const threshold = frameDuration;
	let active = false;
	let rafId: number | null = null;

	const correct = () => {
		if (vidB.paused || vidB.ended) return;
		if (vidA.readyState < 3 || vidB.readyState < 3) return;

		const drift = vidB.currentTime - vidA.currentTime;
		if (Math.abs(drift) > threshold) {
			vidB.currentTime = vidA.currentTime;
		}
	};

	const loop = () => {
		if (!active) { rafId = null; return; }
		correct();
		rafId = requestAnimationFrame(loop);
	};

	return {
		start() {
			if (active) return;
			active = true;
			rafId = requestAnimationFrame(loop);
		},
		stop() {
			if (!active) return;
			active = false;
			if (rafId !== null) {
				cancelAnimationFrame(rafId);
				rafId = null;
			}
		},
	};
}
