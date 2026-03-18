/**
 * Client-side image preprocessing: resize + compress before base64 encoding.
 * Targets ~512KB output for vision API compatibility.
 */

const MAX_DIMENSION = 1536; // max width or height
const JPEG_QUALITY = 0.8;
const TARGET_OUTPUT_BYTES = 512 * 1024; // 512KB target

export interface ProcessedImage {
  dataUrl: string;
  originalSize: number;
  processedSize: number;
  width: number;
  height: number;
}

/**
 * Thumbnail for chat history display (much smaller than vision payload).
 */
export async function createThumbnail(dataUrl: string, maxDim = 200): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.6));
    };
    img.onerror = () => resolve(dataUrl); // fallback
    img.src = dataUrl;
  });
}

/**
 * Preprocess an image for vision API:
 * - Downscale to MAX_DIMENSION
 * - Compress as JPEG (unless PNG with transparency needed)
 * - Re-compress if still too large
 */
export async function preprocessImage(file: File): Promise<ProcessedImage> {
  const originalSize = file.size;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Failed to decode image"));
      img.onload = () => {
        // Calculate scaled dimensions
        const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, w, h);

        // Try JPEG first (smaller), fall back to PNG for transparency
        const isPng = file.type === "image/png";
        let quality = JPEG_QUALITY;
        let dataUrl = canvas.toDataURL(isPng ? "image/png" : "image/jpeg", quality);

        // If still too large, re-compress with lower quality (JPEG only)
        if (!isPng) {
          let attempts = 0;
          while (dataUrl.length > TARGET_OUTPUT_BYTES * 1.37 && quality > 0.3 && attempts < 4) {
            quality -= 0.15;
            dataUrl = canvas.toDataURL("image/jpeg", quality);
            attempts++;
          }
        } else if (dataUrl.length > TARGET_OUTPUT_BYTES * 1.37) {
          // PNG too large — convert to JPEG
          dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
          let attempts = 0;
          while (dataUrl.length > TARGET_OUTPUT_BYTES * 1.37 && quality > 0.3 && attempts < 4) {
            quality -= 0.15;
            dataUrl = canvas.toDataURL("image/jpeg", quality);
            attempts++;
          }
        }

        // Approximate processed size from base64 length
        const processedSize = Math.round(dataUrl.length * 0.73); // base64 overhead ~37%

        resolve({ dataUrl, originalSize, processedSize, width: w, height: h });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/** Estimate base64 data URL size in bytes */
export function estimateBase64Size(dataUrl: string): number {
  return Math.round(dataUrl.length * 0.73);
}
