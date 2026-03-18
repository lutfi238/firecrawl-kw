import { useRef, useCallback, useState } from "react";
import { ImagePlus, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { preprocessImage, type ProcessedImage } from "@/lib/imageUtils";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB raw input
const MAX_IMAGES = 4;
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];

interface ImageUploadButtonProps {
  images: string[];
  onAdd: (dataUrls: string[]) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
}

export function ImageUploadButton({ images, onAdd, onRemove, disabled }: ImageUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) {
      toast.error(`Maximum ${MAX_IMAGES} images allowed`);
      return;
    }

    const fileArray = Array.from(files).slice(0, remaining);
    if (files.length > remaining) {
      toast.warning(`Only ${remaining} more image(s) can be added (max ${MAX_IMAGES})`);
    }

    // Validate types
    const validFiles: File[] = [];
    for (const file of fileArray) {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        toast.error(`Unsupported format: ${file.type.split("/")[1] || "unknown"}. Use PNG, JPEG, or WebP.`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`"${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max ${MAX_FILE_SIZE / 1024 / 1024}MB.`);
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length === 0) {
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setProcessing(true);
    const results: string[] = [];

    for (const file of validFiles) {
      try {
        const processed: ProcessedImage = await preprocessImage(file);
        const savedKb = Math.round((file.size - processed.processedSize) / 1024);
        if (savedKb > 100) {
          console.log(`[image] Compressed ${file.name}: ${(file.size / 1024).toFixed(0)}KB → ${(processed.processedSize / 1024).toFixed(0)}KB (saved ${savedKb}KB)`);
        }
        results.push(processed.dataUrl);
      } catch (err) {
        toast.error(`Failed to process "${file.name}": ${err instanceof Error ? err.message : "unknown error"}`);
      }
    }

    setProcessing(false);
    if (results.length > 0) onAdd(results);
    if (inputRef.current) inputRef.current.value = "";
  }, [onAdd, images.length]);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        disabled={disabled || processing}
      />
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || processing}
        className="shrink-0 text-muted-foreground hover:text-foreground h-8 w-8"
        title={processing ? "Processing…" : `Attach image (${images.length}/${MAX_IMAGES})`}
      >
        {processing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ImagePlus className="h-4 w-4" />
        )}
      </Button>

      {images.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 p-2 flex gap-2 overflow-x-auto scrollbar-cyber">
          {images.map((img, i) => (
            <div key={i} className="relative shrink-0 group">
              <img
                src={img}
                alt={`Upload ${i + 1}`}
                className="h-16 w-16 object-cover rounded-lg border border-primary/20"
              />
              <button
                onClick={() => onRemove(i)}
                className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3 text-destructive-foreground" />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
