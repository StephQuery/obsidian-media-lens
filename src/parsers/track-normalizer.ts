import type { Track, MediaInfoResult } from "mediainfo.js";
import type { MetadataSection, MetadataField } from "./types";
import { formatSize } from "../utils/media";

function str(v: unknown): string {
	return String(v);
}

function field(key: string, value: unknown): MetadataField | null {
	if (value === undefined || value === null || value === "") return null;
	return { key, value: str(value) };
}

function formatDuration(seconds: number): string {
	if (!isFinite(seconds) || seconds < 0) return "0:00";
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
	return `${m}:${String(s).padStart(2, "0")}`;
}

function formatBitrate(bps: number): string {
	if (!isFinite(bps) || bps <= 0) return "0 bps";
	if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
	if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} kbps`;
	return `${bps} bps`;
}

function normalizeGeneral(track: Track): MetadataSection {
	const t = track as unknown as Record<string, unknown>;
	const fields = [
		field("Format", t.Format),
		field("Format version", t.Format_Version),
		field("File size", t.FileSize != null ? formatSize(Number(t.FileSize)) : undefined),
		field("Duration", t.Duration != null ? formatDuration(Number(t.Duration)) : undefined),
		field("Overall bitrate", t.OverallBitRate != null ? formatBitrate(Number(t.OverallBitRate)) : undefined),
		field("Overall bitrate mode", t.OverallBitRate_Mode),
		field("Frame rate", t.FrameRate ? str(t.FrameRate) + " fps" : undefined),
		field("Encoded date", t.Encoded_Date),
		field("Tagged date", t.Tagged_Date),
		field("Writing application", t.Encoded_Application),
		field("Writing library", t.Encoded_Library),
		field("Title", t.Title),
		field("Album", t.Album),
		field("Performer", t.Performer),
		field("Track name", t.Track),
		field("Genre", t.Genre),
		field("Recorded date", t.Recorded_Date),
	].filter((f): f is MetadataField => f !== null);

	return { id: "general", name: "General", fields, defaultExpanded: true };
}

function normalizeVideo(track: Track, index: number): MetadataSection {
	const t = track as unknown as Record<string, unknown>;
	const name = index > 0 ? `Video #${index + 1}` : "Video";
	const fields = [
		field("Codec", t.Format),
		field("Codec profile", t.Format_Profile),
		field("Codec level", t.Format_Level),
		field("Codec settings", t.Format_Settings),
		field("Resolution", t.Width && t.Height ? str(t.Width) + "x" + str(t.Height) : undefined),
		field("Display aspect ratio", t.DisplayAspectRatio_String || t.DisplayAspectRatio),
		field("Frame rate", t.FrameRate ? str(t.FrameRate) + " fps" : undefined),
		field("Frame rate mode", t.FrameRate_Mode),
		field("Bitrate", t.BitRate != null ? formatBitrate(Number(t.BitRate)) : undefined),
		field("Bitrate mode", t.BitRate_Mode),
		field("Bit depth", t.BitDepth ? str(t.BitDepth) + " bit" : undefined),
		field("Color space", t.ColorSpace),
		field("Chroma subsampling", t.ChromaSubsampling),
		field("Color primaries", t.colour_primaries),
		field("Transfer characteristics", t.transfer_characteristics),
		field("Matrix coefficients", t.matrix_coefficients),
		field("HDR format", t.HDR_Format),
		field("Scan type", t.ScanType),
		field("Stream size", t.StreamSize != null ? formatSize(Number(t.StreamSize)) : undefined),
	].filter((f): f is MetadataField => f !== null);

	return { id: `video-${index}`, name, fields, defaultExpanded: true };
}

function normalizeAudio(track: Track, index: number): MetadataSection {
	const t = track as unknown as Record<string, unknown>;
	const name = index > 0 ? `Audio #${index + 1}` : "Audio";
	const fields = [
		field("Codec", t.Format),
		field("Codec profile", t.Format_Profile),
		field("Format settings", t.Format_Settings),
		field("Duration", t.Duration != null ? formatDuration(Number(t.Duration)) : undefined),
		field("Bitrate", t.BitRate != null ? formatBitrate(Number(t.BitRate)) : undefined),
		field("Bitrate mode", t.BitRate_Mode),
		field("Channels", t.Channels ? str(t.Channels) : undefined),
		field("Channel layout", t.ChannelLayout),
		field("Sampling rate", t.SamplingRate ? str(t.SamplingRate) + " Hz" : undefined),
		field("Bit depth", t.BitDepth ? str(t.BitDepth) + " bit" : undefined),
		field("Compression mode", t.Compression_Mode),
		field("Language", t.Language_String || t.Language),
		field("Stream size", t.StreamSize != null ? formatSize(Number(t.StreamSize)) : undefined),
		field("Title", t.Title),
	].filter((f): f is MetadataField => f !== null);

	return { id: `audio-${index}`, name, fields, defaultExpanded: true };
}

function normalizeText(track: Track, index: number): MetadataSection {
	const t = track as unknown as Record<string, unknown>;
	const name = index > 0 ? `Text #${index + 1}` : "Text";
	const fields = [
		field("Format", t.Format),
		field("Codec", t.CodecID),
		field("Language", t.Language_String || t.Language),
		field("Title", t.Title),
		field("Duration", t.Duration != null ? formatDuration(Number(t.Duration)) : undefined),
		field("Element count", t.ElementCount),
	].filter((f): f is MetadataField => f !== null);

	return { id: `text-${index}`, name, fields, defaultExpanded: false };
}

function normalizeImage(track: Track, index: number): MetadataSection {
	const t = track as unknown as Record<string, unknown>;
	const name = index > 0 ? `Image #${index + 1}` : "Image";
	const fields = [
		field("Format", t.Format),
		field("Resolution", t.Width && t.Height ? str(t.Width) + "x" + str(t.Height) : undefined),
		field("Bit depth", t.BitDepth ? str(t.BitDepth) + " bit" : undefined),
		field("Color space", t.ColorSpace),
		field("Compression", t.Compression_Mode),
	].filter((f): f is MetadataField => f !== null);

	return { id: `image-${index}`, name, fields, defaultExpanded: true };
}

export function normalizeTracks(result: MediaInfoResult): MetadataSection[] {
	const sections: MetadataSection[] = [];
	let videoIdx = 0, audioIdx = 0, textIdx = 0, imageIdx = 0;

	const tracks = result.media?.track ?? [];
	for (const track of tracks) {
		switch (track["@type"]) {
			case "General":
				sections.push(normalizeGeneral(track));
				break;
			case "Video":
				sections.push(normalizeVideo(track, videoIdx++));
				break;
			case "Audio":
				sections.push(normalizeAudio(track, audioIdx++));
				break;
			case "Text":
				sections.push(normalizeText(track, textIdx++));
				break;
			case "Image":
				sections.push(normalizeImage(track, imageIdx++));
				break;
		}
	}

	return sections;
}
