import { ACCEPTED_IMAGE_TYPES, MAX_PHOTO_BYTES, MAX_PHOTOS } from "@/lib/core/boundry/recipe";

const MAX_EDGE_PX = 1568;
const JPEG_QUALITY = 0.8;
const MB = 1024 * 1024;

const isAcceptedType = (file: File): boolean =>
  ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number]);

// Validate the originals against the shared boundary constants, returning readable Polish errors.
export const validateFiles = (files: File[]): string[] => {
  const countErrors = [
    files.length === 0 ? "Wybierz co najmniej jedno zdjęcie." : null,
    files.length > MAX_PHOTOS ? `Możesz przesłać maksymalnie ${MAX_PHOTOS} zdjęć.` : null,
  ].filter((error): error is string => error !== null);

  const fileErrors = files.flatMap((file) => {
    if (!isAcceptedType(file)) return [`„${file.name}” ma nieobsługiwany format (dozwolone: JPEG, PNG, WebP).`];
    if (file.size > MAX_PHOTO_BYTES) return [`„${file.name}” przekracza ${MAX_PHOTO_BYTES / MB} MB.`];
    return [];
  });

  return [...countErrors, ...fileErrors];
};

// Downscale to a max edge of 1568 px via canvas → JPEG. Vision models downscale anyway; this cuts
// upload size and LLM latency. Falls back to the original file if the canvas path is unavailable.
export const prepareForUpload = async (file: File): Promise<File> => {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return file;
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
  });
  if (!blob) return file;

  const name = `${file.name.replace(/\.[^.]+$/, "")}.jpg`;
  return new File([blob], name, { type: "image/jpeg" });
};
