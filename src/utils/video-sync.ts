export function formatTimestamp(seconds: number): string {
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

export function createDriftController(
	vidA: HTMLVideoElement,
	vidB: HTMLVideoElement,
	frameDuration: number
): DriftController {
	let raf: number | null = null;
	let active = false;
	let frameCount = 0;

	const loop = () => {
		if (!active || vidA.paused || vidA.ended) {
			raf = null;
			active = false;
			vidB.playbackRate = 1;
			return;
		}

		frameCount++;

		// Only check drift every 5th frame to reduce CPU
		if (frameCount % 5 === 0 && !vidB.ended && !vidB.paused) {
			// Skip corrections when either video is buffering (readyState < 3 = HAVE_FUTURE_DATA)
			if (vidA.readyState < 3 || vidB.readyState < 3) {
				vidB.playbackRate = 1;
			} else {
				const drift = vidB.currentTime - vidA.currentTime;
				if (Math.abs(drift) > 3) {
					// Large drift — hard seek
					vidB.currentTime = vidA.currentTime;
					vidB.playbackRate = 1;
				} else if (Math.abs(drift) > frameDuration * 3) {
					// Moderate drift — gentle rate adjustment
					vidB.playbackRate = drift > 0 ? 0.97 : 1.03;
				} else {
					vidB.playbackRate = 1;
				}
			}
		}

		raf = requestAnimationFrame(loop);
	};

	return {
		start() {
			if (!active) {
				active = true;
				frameCount = 0;
				raf = requestAnimationFrame(loop);
			}
		},
		stop() {
			active = false;
			if (raf !== null) {
				cancelAnimationFrame(raf);
				raf = null;
			}
			vidB.playbackRate = 1;
		},
	};
}
