import { useRef, type ChangeEvent } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Upload, Camera, X } from "lucide-react";

interface ImageUploadProps {
  onImageSelect: (file: File, previewUrl: string) => void;
  selectedImage: string | null;
  onClear: () => void;
  className?: string;
}

export function ImageUpload({
  onImageSelect,
  selectedImage,
  onClear,
  className,
}: ImageUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("image/")) {
      const previewUrl = URL.createObjectURL(file);
      onImageSelect(file, previewUrl);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) {
      const previewUrl = URL.createObjectURL(file);
      onImageSelect(file, previewUrl);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  if (selectedImage) {
    return (
      <div className={cn("relative", className)}>
        <img
          src={selectedImage}
          alt="選択された画像"
          className="w-full h-auto max-h-64 object-contain rounded-lg border"
        />
        <Button
          variant="destructive"
          size="icon"
          className="absolute top-2 right-2 h-8 w-8"
          onClick={onClear}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-300",
        "hover:border-blue-400 hover:bg-gradient-to-br hover:from-blue-50/50 hover:to-indigo-50/50",
        "group",
        className,
      )}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onClick={() => fileInputRef.current?.click()}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="absolute -inset-3 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 opacity-0 group-hover:opacity-100 blur-md transition-opacity duration-300" />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 group-hover:from-blue-200 group-hover:to-indigo-200 transition-colors duration-300">
            <Camera className="h-8 w-8 text-blue-500" />
          </div>
        </div>
        <div>
          <p className="font-semibold text-sm text-foreground">クリックまたはドラッグ&ドロップ</p>
          <p className="text-xs text-muted-foreground mt-1">
            カバンの中身や持ち物の写真をアップロード
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Upload className="h-4 w-4" />
          <span>JPG、PNG形式に対応</span>
        </div>
      </div>
    </div>
  );
}
