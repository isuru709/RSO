import { useRef, useState, useCallback, useEffect } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, Check, X } from 'lucide-react';

interface ImageCropModalProps {
  file: File;
  /** 1 for square/avatar, 16/9 for landscape, 4/3 etc. */
  aspectRatio?: number;
  /** Whether the crop area should be circular (for avatars) */
  circular?: boolean;
  /** Max output dimension in px (largest side). Default 800 */
  maxOutputSize?: number;
  onCrop: (base64: string, filename: string) => void;
  onCancel: () => void;
}

export function ImageCropModal({
  file,
  aspectRatio = 1,
  circular = false,
  maxOutputSize = 800,
  onCrop,
  onCancel,
}: ImageCropModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [cropSize, setCropSize] = useState({ w: 280, h: 280 });

  // Load image from file
  useEffect(() => {
    const reader = new FileReader();
    reader.onloadend = () => setImageSrc(reader.result as string);
    reader.readAsDataURL(file);
  }, [file]);

  // Create Image element when src loads
  useEffect(() => {
    if (!imageSrc) return;
    const img = new Image();
    img.onload = () => {
      setImage(img);
      // Reset zoom/offset
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    img.src = imageSrc;
  }, [imageSrc]);

  // Calculate crop area size based on container and aspect ratio
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const maxW = rect.width - 40; // 20px padding each side
      const maxH = rect.height - 40;
      let w: number, h: number;

      if (aspectRatio >= 1) {
        w = Math.min(maxW, 360);
        h = w / aspectRatio;
        if (h > maxH) {
          h = maxH;
          w = h * aspectRatio;
        }
      } else {
        h = Math.min(maxH, 360);
        w = h * aspectRatio;
        if (w > maxW) {
          w = maxW;
          h = w / aspectRatio;
        }
      }
      setCropSize({ w, h });
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [aspectRatio]);

  // Draw the canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !image) return;

    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Calculate image drawing params
    const scale = Math.max(
      cropSize.w / image.width,
      cropSize.h / image.height
    ) * zoom;

    const imgW = image.width * scale;
    const imgH = image.height * scale;
    const imgX = (canvas.width - imgW) / 2 + offset.x;
    const imgY = (canvas.height - imgH) / 2 + offset.y;

    // Draw image
    ctx.drawImage(image, imgX, imgY, imgW, imgH);

    // Draw dark overlay with crop hole
    const cropX = (canvas.width - cropSize.w) / 2;
    const cropY = (canvas.height - cropSize.h) / 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Cut out crop area
    ctx.globalCompositeOperation = 'destination-out';
    if (circular) {
      ctx.beginPath();
      ctx.ellipse(
        cropX + cropSize.w / 2,
        cropY + cropSize.h / 2,
        cropSize.w / 2,
        cropSize.h / 2,
        0, 0, Math.PI * 2
      );
      ctx.fill();
    } else {
      ctx.fillRect(cropX, cropY, cropSize.w, cropSize.h);
    }
    ctx.globalCompositeOperation = 'source-over';

    // Draw crop border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 2;
    if (circular) {
      ctx.beginPath();
      ctx.ellipse(
        cropX + cropSize.w / 2,
        cropY + cropSize.h / 2,
        cropSize.w / 2,
        cropSize.h / 2,
        0, 0, Math.PI * 2
      );
      ctx.stroke();
    } else {
      ctx.strokeRect(cropX, cropY, cropSize.w, cropSize.h);
      // Grid lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cropX + cropSize.w / 3, cropY);
      ctx.lineTo(cropX + cropSize.w / 3, cropY + cropSize.h);
      ctx.moveTo(cropX + (cropSize.w * 2) / 3, cropY);
      ctx.lineTo(cropX + (cropSize.w * 2) / 3, cropY + cropSize.h);
      ctx.moveTo(cropX, cropY + cropSize.h / 3);
      ctx.lineTo(cropX + cropSize.w, cropY + cropSize.h / 3);
      ctx.moveTo(cropX, cropY + (cropSize.h * 2) / 3);
      ctx.lineTo(cropX + cropSize.w, cropY + (cropSize.h * 2) / 3);
      ctx.stroke();
    }

    // Re-draw image only in crop area (on top of overlay)
    ctx.save();
    if (circular) {
      ctx.beginPath();
      ctx.ellipse(
        cropX + cropSize.w / 2,
        cropY + cropSize.h / 2,
        cropSize.w / 2,
        cropSize.h / 2,
        0, 0, Math.PI * 2
      );
      ctx.clip();
    } else {
      ctx.beginPath();
      ctx.rect(cropX, cropY, cropSize.w, cropSize.h);
      ctx.clip();
    }
    ctx.drawImage(image, imgX, imgY, imgW, imgH);
    ctx.restore();
  }, [image, zoom, offset, cropSize, circular]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Pointer events for drag
  const handlePointerDown = (e: React.PointerEvent) => {
    setDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handlePointerUp = () => {
    setDragging(false);
  };

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    setZoom(z => Math.max(0.5, Math.min(3, z + delta)));
  };

  // Export cropped image
  const handleCrop = () => {
    if (!image) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Calculate the crop region in image coordinates
    const scale = Math.max(
      cropSize.w / image.width,
      cropSize.h / image.height
    ) * zoom;

    const imgW = image.width * scale;
    const imgH = image.height * scale;
    const imgX = (canvas.width - imgW) / 2 + offset.x;
    const imgY = (canvas.height - imgH) / 2 + offset.y;

    const cropX = (canvas.width - cropSize.w) / 2;
    const cropY = (canvas.height - cropSize.h) / 2;

    // Source coordinates in image space
    const sx = (cropX - imgX) / scale;
    const sy = (cropY - imgY) / scale;
    const sw = cropSize.w / scale;
    const sh = cropSize.h / scale;

    // Output canvas
    let outW = sw;
    let outH = sh;
    if (outW > maxOutputSize || outH > maxOutputSize) {
      const ratio = Math.min(maxOutputSize / outW, maxOutputSize / outH);
      outW *= ratio;
      outH *= ratio;
    }

    const outCanvas = document.createElement('canvas');
    outCanvas.width = Math.round(outW);
    outCanvas.height = Math.round(outH);
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) return;

    if (circular) {
      outCtx.beginPath();
      outCtx.ellipse(outW / 2, outH / 2, outW / 2, outH / 2, 0, 0, Math.PI * 2);
      outCtx.clip();
    }

    outCtx.drawImage(
      image,
      Math.max(0, sx), Math.max(0, sy),
      Math.min(sw, image.width - sx), Math.min(sh, image.height - sy),
      sx < 0 ? (-sx / sw) * outW : 0,
      sy < 0 ? (-sy / sh) * outH : 0,
      Math.min(sw, image.width - Math.max(0, sx)) / sw * outW,
      Math.min(sh, image.height - Math.max(0, sy)) / sh * outH
    );

    const base64 = outCanvas.toDataURL('image/jpeg', 0.85);
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const outName = file.name.replace(/\.[^.]+$/, '') + '_cropped.' + ext;
    onCrop(base64, outName);
  };

  const handleReset = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  return (
    <>
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        zIndex: 9998, backdropFilter: 'blur(4px)',
      }} onClick={onCancel} />
      <div style={{
        position: 'fixed',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 'min(95vw, 560px)',
        maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
        background: 'var(--color-bg-card, #1e1e2e)',
        borderRadius: 'var(--radius-lg, 12px)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        overflow: 'hidden',
        zIndex: 9999,
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: 'var(--space-4) var(--space-5)',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}>
          <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700 }}>
            Adjust & Crop Image
          </h3>
          <button
            onClick={onCancel}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-muted)', padding: 4,
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Canvas area — fills remaining space */}
        <div
          ref={containerRef}
          style={{
            position: 'relative',
            width: '100%',
            flex: '1 1 0',
            minHeight: 200,
            background: '#111',
            cursor: dragging ? 'grabbing' : 'grab',
            touchAction: 'none',
            userSelect: 'none',
            overflow: 'hidden',
          }}
        >
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: '100%', display: 'block' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
          />
          {!image && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'rgba(255,255,255,0.5)', fontSize: 'var(--font-size-sm)',
            }}>
              Loading image...
            </div>
          )}
        </div>

        {/* Controls — always visible at bottom */}
        <div style={{
          padding: 'var(--space-3) var(--space-5)',
          borderTop: '1px solid var(--color-border)',
          display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
          flexShrink: 0,
        }}>
          {/* Zoom slider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <ZoomOut size={16} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
            <input
              type="range"
              min="0.5"
              max="3"
              step="0.01"
              value={zoom}
              onChange={e => setZoom(parseFloat(e.target.value))}
              style={{
                flex: 1, accentColor: 'var(--color-primary)',
                height: 6, cursor: 'pointer',
              }}
            />
            <ZoomIn size={16} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
            <span style={{
              fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)',
              minWidth: 40, textAlign: 'right',
            }}>
              {Math.round(zoom * 100)}%
            </span>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={handleReset} type="button">
              <RotateCcw size={14} /> Reset
            </button>
            <button className="btn btn-secondary" onClick={onCancel} type="button">
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleCrop} type="button">
              <Check size={16} /> Crop & Use
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
