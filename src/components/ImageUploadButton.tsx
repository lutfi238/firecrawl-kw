import { useRef, useCallback } from "react";
import { ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];

interface ImageUploadButtonProps {
  images: string[];
  onAdd: (dataUrls: string[]) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
}

export function ImageUploadButton({ images, onAdd, onRemove, disabled }: ImageUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const results: string[] = [];

    for (const file of Array.from(files)) {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        console.warn(`Rejected file type: ${file.type}`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        console.warn(`File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB (max 4MB)`);
        continue;
      }
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      results.push(dataUrl);
    }

    if (results.length > 0) onAdd(results);
    if (inputRef.current) inputRef.current.value = "";
  }, [onAdd]);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        disabled={disabled}
      />
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="shrink-0 text-muted-foreground hover:text-foreground h-8 w-8"
        title="Attach image"
      >
        <ImagePlus className="h-4 w-4" />
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
