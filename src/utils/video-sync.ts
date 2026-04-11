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

	const loop = () => {
		if (!active || vidA.paused || vidA.ended) {
			raf = null;
			active = false;
			vidB.playbackRate = 1;
			return;
		}

		if (!vidB.ended && !vidB.paused) {
			const drift = vidB.currentTime - vidA.currentTime;
			if (Math.abs(drift) > 1) {
				vidB.currentTime = vidA.currentTime;
				vidB.playbackRate = 1;
			} else if (Math.abs(drift) > frameDuration) {
				vidB.playbackRate = drift > 0 ? 0.95 : 1.05;
			} else {
				vidB.playbackRate = 1;
			}
		}

		raf = requestAnimationFrame(loop);
	};

	return {
		start() {
			if (!active) {
				active = true;
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
