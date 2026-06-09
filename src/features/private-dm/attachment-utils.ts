import { convertFileSrc } from "@tauri-apps/api/core";

const ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;
const THUMBNAIL_MAX_EDGE = 320;

export function isViewableMedia(mime: string): boolean {
  return (
    mime.startsWith("image/") ||
    mime.startsWith("video/") ||
    mime.startsWith("audio/")
  );
}

export function isStreamableMedia(mime: string): boolean {
  return mime.startsWith("video/") || mime.startsWith("audio/");
}

/** Source URL for a fully-downloaded attachment served from disk. */
export function localFileSrc(path: string): string {
  return convertFileSrc(path);
}

/**
 * Source URL for the moshmedia:// streaming protocol. Used while a video or
 * audio attachment is still downloading so playback can start immediately.
 */
export function streamingMediaSrc(
  kind: "dm" | "group" | "channel",
  host: string,
  attachmentId: string,
): string {
  // Tauri exposes a custom scheme on Windows as http://<scheme>.localhost.
  return `http://moshmedia.localhost/${kind}/${encodeURIComponent(
    host,
  )}/${encodeURIComponent(attachmentId)}`;
}

/** Reads a File into the base64 string the Tauri attachment commands expect. */
export async function readFileAsBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const stride = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += stride) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + stride));
  }
  return btoa(binary);
}

function canvasToBase64(canvas: HTMLCanvasElement): string | undefined {
  const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : undefined;
}

function scaledSize(width: number, height: number): { w: number; h: number } {
  const scale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(width, height, 1));
  return {
    w: Math.max(1, Math.round(width * scale)),
    h: Math.max(1, Math.round(height * scale)),
  };
}

async function imageThumbnail(file: File): Promise<string | undefined> {
  try {
    const bitmap = await createImageBitmap(file);
    const { w, h } = scaledSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext("2d");
    if (!context) {
      return undefined;
    }
    context.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    return canvasToBase64(canvas);
  } catch {
    return undefined;
  }
}

function videoThumbnail(file: File): Promise<string | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "metadata";
    let settled = false;
    const finish = (result?: string) => {
      if (settled) {
        return;
      }
      settled = true;
      URL.revokeObjectURL(url);
      resolve(result);
    };
    video.onerror = () => finish(undefined);
    video.onloadeddata = () => {
      try {
        video.currentTime = Math.min(1, (video.duration || 2) * 0.1);
      } catch {
        finish(undefined);
      }
    };
    video.onseeked = () => {
      try {
        const { w, h } = scaledSize(video.videoWidth, video.videoHeight);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const context = canvas.getContext("2d");
        if (!context) {
          finish(undefined);
          return;
        }
        context.drawImage(video, 0, 0, w, h);
        finish(canvasToBase64(canvas));
      } catch {
        finish(undefined);
      }
    };
    video.src = url;
    window.setTimeout(() => finish(undefined), 6000);
  });
}

/**
 * Renders a JPEG preview frame for an image or video file and returns it as
 * base64 (no data: prefix). Resolves to undefined for other file types or on
 * any decode failure; a missing thumbnail is never fatal.
 */
export async function createThumbnail(file: File): Promise<string | undefined> {
  if (file.type.startsWith("image/")) {
    return imageThumbnail(file);
  }
  if (file.type.startsWith("video/")) {
    return videoThumbnail(file);
  }
  return undefined;
}

export function isAttachmentTooLarge(file: File): boolean {
  return file.size > ATTACHMENT_MAX_BYTES;
}

export function formatBytes(total: number): string {
  if (total < 1024) {
    return `${total} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = total / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
