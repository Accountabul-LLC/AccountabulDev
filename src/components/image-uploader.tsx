import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  type MediaBucket,
  removeImage,
  uploadImage,
  useMediaUrl,
  validateImage,
} from "@/lib/media";

type Props = {
  label: string;
  hint?: string;
  bucket: MediaBucket;
  businessId: string | null;
  folder: string;
  value: string | null;
  onChange: (path: string | null) => void | Promise<void>;
  /** Square preview for logos, wide preview for covers. */
  shape?: "square" | "wide";
  disabled?: boolean;
};

export function ImageUploader({
  label,
  hint,
  bucket,
  businessId,
  folder,
  value,
  onChange,
  shape = "wide",
  disabled,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const previewUrl = useMediaUrl(bucket, value);

  async function handleFile(file: File) {
    const problem = validateImage(file);
    if (problem) {
      toast.error(problem);
      return;
    }
    if (!businessId) {
      toast.error("Save your business details first, then add images.");
      return;
    }
    setBusy(true);
    try {
      const previous = value;
      const path = await uploadImage({ bucket, businessId, folder, file });
      try {
        await onChange(path);
      } catch (error) {
        await removeImage(bucket, path);
        throw error;
      }
      if (previous) await removeImage(bucket, previous);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <div
        className={cn(
          "relative flex items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-secondary/40",
          shape === "square" ? "size-32" : "aspect-[3/1] w-full",
        )}
      >
        {previewUrl ? (
          <img src={previewUrl} alt={label} className="size-full object-cover" />
        ) : (
          <span className="px-3 text-center text-xs text-muted-foreground">
            {busy ? "Uploading…" : "No image yet"}
          </span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label={label}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || disabled}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? "Uploading…" : value ? "Replace image" : "Upload from your computer"}
        </Button>
        {value ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy || disabled}
            onClick={async () => {
              setBusy(true);
              try {
                await onChange(null);
                await removeImage(bucket, value);
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Image removal failed.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Remove
          </Button>
        ) : null}
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
