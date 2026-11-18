/*
 * The scanner's own live camera (the browser's camera API, which the Android WebView has too).
 *
 * Two things come out of it, and they are deliberately not the same picture:
 *
 * - The live view is a modest video (about 1.5 megapixels). The WebView copies every frame of
 *   it through the CPU, so a 4K view stutters on a phone; this size stays smooth and is plenty
 *   to aim with.
 * - The photo is a still taken through the same track (`ImageCapture.takePhoto`), which makes
 *   the camera stop the video for a moment and shoot at its photo resolution, with the noise
 *   reduction and sharpening of a real photo. That is the difference between text that can be
 *   read and text that cannot. Where a still cannot be taken, the frame on screen is the photo.
 *
 * Both keep what the system camera app loses with the phone lying flat over a sheet: the picture
 * is the way it was on screen, and the light can stay on while aiming.
 */

/**
 * Live view asked for; the camera gives the closest size it has. 4:3 like the photos, so the
 * still shows what the view showed.
 */
const VIEW_LONG = 1440;
const VIEW_SHORT = 1080;
const VIEW_FPS = 30;
/** Longest side asked of a still: the page of the PDF gains nothing beyond it. */
const PHOTO_LONG = 4096;
/** A still that takes longer than this is given up (the frame on screen is used instead). */
const PHOTO_TIMEOUT_MS = 6000;

/** Not in the DOM typings yet: the torch, and keeping the camera from rescaling its frames. */
type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };
type TorchConstraints = MediaTrackConstraintSet & { torch?: boolean };
type ViewConstraints = MediaTrackConstraints & { resizeMode?: "none" | "crop-and-scale" };

/** The part of the Image Capture API used here (not in the DOM typings either). */
interface PhotoRange {
  max?: number;
}
interface PhotoSettings {
  imageWidth?: number;
  imageHeight?: number;
}
interface StillCamera {
  getPhotoCapabilities(): Promise<{ imageWidth?: PhotoRange; imageHeight?: PhotoRange }>;
  takePhoto(settings?: PhotoSettings): Promise<Blob>;
}
type StillCameraClass = new (track: MediaStreamTrack) => StillCamera;

/** Opens the back camera. Rejects when there is none or the user says no. */
export async function openCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera API not available");
  const video: ViewConstraints = {
    facingMode: { ideal: "environment" },
    width: { ideal: VIEW_LONG },
    height: { ideal: VIEW_SHORT },
    frameRate: { ideal: VIEW_FPS },
    // A size the camera has, as it is: otherwise it may shoot far larger frames and shrink each one.
    resizeMode: "none",
  };
  return navigator.mediaDevices.getUserMedia({ audio: false, video });
}

export function closeCamera(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/** Whether the camera has a light that can stay on. */
export function hasTorch(stream: MediaStream): boolean {
  const track = stream.getVideoTracks()[0];
  const capabilities: TorchCapabilities | undefined = track?.getCapabilities?.();
  return capabilities?.torch === true;
}

export async function setTorch(stream: MediaStream, on: boolean): Promise<void> {
  const constraint: TorchConstraints = { torch: on };
  await stream.getVideoTracks()[0]?.applyConstraints({ advanced: [constraint] });
}

/**
 * The frame the video is showing. Taking it costs next to nothing (no pixels are read or
 * compressed here): the scan worker does the rest.
 */
export async function grabFrame(video: HTMLVideoElement): Promise<ImageBitmap> {
  const { videoWidth: width, videoHeight: height } = video;
  if (width === 0 || height === 0) throw new Error("The camera has no picture yet");
  try {
    return await createImageBitmap(video);
  } catch {
    // WebViews that cannot make a bitmap straight from a video.
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d")!.drawImage(video, 0, 0, width, height);
    return canvas.transferToImageBitmap();
  }
}

interface Still {
  camera: StillCamera;
  /** The photo size to ask for, once the camera has told which ones it has. */
  settings: Promise<PhotoSettings | null>;
}

const stills = new WeakMap<MediaStreamTrack, Still | null>();

/**
 * The largest photo the camera takes, within PHOTO_LONG. Without a size the browser shoots at
 * the size of the video, which is no better than a frame: null then.
 *
 * The photo must show what the live view shows. A size more elongated than the video is cut out
 * of a narrower strip of the sensor, so in that case the video's proportions are asked for
 * (the camera gives the closest size it has).
 */
async function photoSettings(camera: StillCamera, track: MediaStreamTrack): Promise<PhotoSettings | null> {
  try {
    const { imageWidth, imageHeight } = await camera.getPhotoCapabilities();
    const width = imageWidth?.max ?? 0;
    const height = imageHeight?.max ?? 0;
    if (width <= 0 || height <= 0) return null;
    const long = Math.min(PHOTO_LONG, Math.max(width, height));
    let short = (long * Math.min(width, height)) / Math.max(width, height);
    const view = track.getSettings();
    if (view.width && view.height) {
      const viewShort = (long * Math.min(view.width, view.height)) / Math.max(view.width, view.height);
      if (viewShort > short * 1.03) short = viewShort;
    }
    return width >= height ? { imageWidth: long, imageHeight: Math.round(short) } : { imageWidth: Math.round(short), imageHeight: long };
  } catch {
    return null;
  }
}

function stillOf(stream: MediaStream): Still | null {
  const track = stream.getVideoTracks()[0];
  if (!track) return null;
  let still = stills.get(track);
  if (still === undefined) {
    const StillCameraOf = (globalThis as { ImageCapture?: StillCameraClass }).ImageCapture;
    try {
      const camera = StillCameraOf ? new StillCameraOf(track) : null;
      still = camera ? { camera, settings: photoSettings(camera, track) } : null;
    } catch {
      still = null;
    }
    stills.set(track, still);
  }
  return still;
}

/** Asks the camera which photos it takes, ahead of the first one (so the shutter does not wait for it). */
export function prepareStill(stream: MediaStream): void {
  stillOf(stream);
}

/**
 * A still photo at the camera's photo resolution, as an encoded image. The video stops while it
 * is taken (about a second). Null when the camera cannot take one here, fails or takes too long:
 * the caller falls back on the frame it grabbed.
 */
export async function takeStill(stream: MediaStream): Promise<Uint8Array | null> {
  const still = stillOf(stream);
  if (!still) return null;
  try {
    const settings = await still.settings;
    if (!settings) return null;
    const timeout = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), PHOTO_TIMEOUT_MS));
    const blob = await Promise.race([still.camera.takePhoto(settings), timeout]);
    if (!blob || blob.size === 0) return null;
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}
