import { useState, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import Pica from 'pica';
import { RotateCw, X, Check, AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils';

interface PhotoCropModalProps {
  imageSrc: string; // data URI of the original image
  onSave: (dataUri: string) => void;
  onCancel: () => void;
}

const MAX_SIZE = 1500;
const WARN_BYTES = 1_000_000; // 1 MB base64 threshold

// Turn the react-easy-crop pixel area into a canvas blob via pica.
async function cropAndResize(
  imageSrc: string,
  pixelCrop: Area,
  rotation: number,
): Promise<string> {
  const img = await loadImage(imageSrc);

  // Draw the original image onto a canvas, rotated if needed.
  const srcCanvas = document.createElement('canvas');
  const rad = (rotation * Math.PI) / 180;
  const sinR = Math.abs(Math.sin(rad));
  const cosR = Math.abs(Math.cos(rad));
  srcCanvas.width = Math.round(img.width * cosR + img.height * sinR);
  srcCanvas.height = Math.round(img.width * sinR + img.height * cosR);
  const srcCtx = srcCanvas.getContext('2d')!;
  srcCtx.translate(srcCanvas.width / 2, srcCanvas.height / 2);
  srcCtx.rotate(rad);
  srcCtx.drawImage(img, -img.width / 2, -img.height / 2);

  // Extract the cropped region.
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = pixelCrop.width;
  cropCanvas.height = pixelCrop.height;
  const cropCtx = cropCanvas.getContext('2d')!;
  cropCtx.drawImage(srcCanvas, pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height, 0, 0, pixelCrop.width, pixelCrop.height);

  // Downscale if needed, using pica for high-quality output.
  const outW = Math.min(pixelCrop.width, MAX_SIZE);
  const outH = Math.min(pixelCrop.height, MAX_SIZE);
  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;

  if (outW < pixelCrop.width || outH < pixelCrop.height) {
    const pica = new Pica();
    await pica.resize(cropCanvas, outCanvas, { quality: 3 });
  } else {
    const outCtx = outCanvas.getContext('2d')!;
    outCtx.drawImage(cropCanvas, 0, 0, outW, outH);
  }

  // Export as JPEG @ 85%.
  return new Promise<string>((resolve, reject) => {
    outCanvas.toBlob(
      (blob) => {
        if (!blob) { reject(new Error('toBlob failed')); return; }
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      },
      'image/jpeg',
      0.85,
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function base64ByteSize(dataUri: string): number {
  const b64 = dataUri.split(',')[1] ?? '';
  return Math.ceil((b64.length * 3) / 4);
}

export default function PhotoCropModal({ imageSrc, onSave, onCancel }: PhotoCropModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewBytes, setPreviewBytes] = useState<number>(0);
  const [processing, setProcessing] = useState(false);
  const [step, setStep] = useState<'crop' | 'preview'>('crop');

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  const handleRotate = () => setRotation((r) => (r + 90) % 360);

  const handlePreview = async () => {
    if (!croppedAreaPixels) return;
    setProcessing(true);
    try {
      const uri = await cropAndResize(imageSrc, croppedAreaPixels, rotation);
      setPreview(uri);
      setPreviewBytes(base64ByteSize(uri));
      setStep('preview');
    } finally {
      setProcessing(false);
    }
  };

  const handleSave = () => {
    if (preview) onSave(preview);
  };

  const oversized = previewBytes > WARN_BYTES;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">
            {step === 'crop' ? 'Crop photo' : 'Preview'}
          </h2>
          <button onClick={onCancel} className="rounded p-1 hover:bg-muted text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        {step === 'crop' ? (
          <>
            <div className="relative h-80 bg-black">
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                rotation={rotation}
                aspect={1}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
                style={{ containerStyle: { background: '#000' } }}
              />
            </div>

            <div className="px-4 py-3 space-y-3">
              {/* Zoom slider */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-8">Zoom</span>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.01}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="flex-1 accent-primary"
                />
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={handleRotate}
                  className="flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted"
                >
                  <RotateCw className="h-3.5 w-3.5" /> Rotate 90°
                </button>
                <button
                  onClick={handlePreview}
                  disabled={processing}
                  className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {processing ? 'Processing…' : 'Continue'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="p-4 space-y-4">
            {preview && (
              <img
                src={preview}
                alt="Cropped preview"
                className="mx-auto h-48 w-48 rounded-full object-cover border-2 border-border"
              />
            )}

            <p className="text-center text-sm text-muted-foreground">
              Final size: {(previewBytes / 1024).toFixed(0)} KB
            </p>

            {oversized && (
              <div className={cn('flex items-start gap-2 rounded-md p-3 text-sm', 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400')}>
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>This photo is over 1 MB. Large photos may slow down contact loading.</span>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setStep('crop')}
                className="rounded-md border border-input px-4 py-1.5 text-sm hover:bg-muted"
              >
                Back
              </button>
              <button
                onClick={handleSave}
                className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Check className="h-3.5 w-3.5" /> Use this photo
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
