import React, { useRef, useEffect, useState } from 'react';
import './SignaturePad.css';

const SignaturePad = ({ onConfirm, onCancel }) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    
    // Set canvas size based on wrapper size
    const resizeCanvas = () => {
      const wrapper = canvas.parentElement;
      if (!wrapper) return;
      
      const rect = wrapper.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      // Set canvas pixel resolution to account for DPR while keeping CSS size
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      // Reset transform to map CSS pixels to canvas pixels
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Set drawing style (in CSS pixels now)
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    };

    // Initial resize with a small delay to ensure DOM is ready
    setTimeout(resizeCanvas, 0);
    
    // Resize on window resize
    window.addEventListener('resize', resizeCanvas);
    
    // Use ResizeObserver to watch wrapper size changes
    const resizeObserver = new ResizeObserver(resizeCanvas);
    if (canvas.parentElement) {
      resizeObserver.observe(canvas.parentElement);
    }

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      resizeObserver.disconnect();
    };
  }, []);

  const getCoordinates = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();

    // Coordinates are in CSS pixels; because we set ctx.setTransform(dpr,0,0,dpr,0,0)
    // drawing uses CSS pixel coordinates directly
    const clientX = e.touches && e.touches.length > 0 ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches && e.touches.length > 0 ? e.touches[0].clientY : e.clientY;

    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  const startDrawing = (e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const coords = getCoordinates(e);
    
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
    setIsDrawing(true);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const coords = getCoordinates(e);
    
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
    setHasSignature(true);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const eraseSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  // Enhance: remove background, auto-crop to strokes and scale to standard size
  const enhanceSignature = (canvas) => {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const img = ctx.getImageData(0, 0, width, height);
    const data = img.data;

    let minX = width, minY = height, maxX = 0, maxY = 0;
    let found = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        const brightness = (r + g + b) / 3;
        if (a > 10 && brightness < 240) {
          found = true;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (!found) {
      return canvas.toDataURL('image/png');
    }

    const padding = 8;
    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(width - 1, maxX + padding);
    maxY = Math.min(height - 1, maxY + padding);

    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    const cropCtx = cropCanvas.getContext('2d');

    // Build transparent image where stroke darkness becomes alpha
    const cropImg = cropCtx.createImageData(cropW, cropH);
    for (let y = 0; y < cropH; y++) {
      for (let x = 0; x < cropW; x++) {
        const srcI = ((y + minY) * width + (x + minX)) * 4;
        const r = data[srcI], g = data[srcI + 1], b = data[srcI + 2], a = data[srcI + 3];
        const brightness = (r + g + b) / 3;
        const alpha = Math.round(Math.max(0, Math.min(255, ((255 - brightness) / 255) * a)));
        const dstI = (y * cropW + x) * 4;
        cropImg.data[dstI] = 0;
        cropImg.data[dstI + 1] = 0;
        cropImg.data[dstI + 2] = 0;
        cropImg.data[dstI + 3] = alpha;
      }
    }
    cropCtx.putImageData(cropImg, 0, 0);

    // Rotate according to device orientation so 'bottom' label aligns
    let screenAngle = 0;
    try {
      screenAngle = (window.screen && window.screen.orientation && typeof window.screen.orientation.angle === 'number')
        ? window.screen.orientation.angle
        : (typeof window.orientation === 'number' ? window.orientation : 0);
    } catch (e) {
      screenAngle = 0;
    }

    // Helper to rotate a canvas by degrees (clockwise)
    const rotateCanvasBy = (srcCanvas, degrees) => {
      const radians = (degrees * Math.PI) / 180;
      const sin = Math.abs(Math.sin(radians));
      const cos = Math.abs(Math.cos(radians));
      const newWidth = Math.round(srcCanvas.height * sin + srcCanvas.width * cos);
      const newHeight = Math.round(srcCanvas.height * cos + srcCanvas.width * sin);
      const newCanvas = document.createElement('canvas');
      newCanvas.width = newWidth;
      newCanvas.height = newHeight;
      const ctx = newCanvas.getContext('2d');
      ctx.translate(newWidth / 2, newHeight / 2);
      ctx.rotate(radians);
      ctx.drawImage(srcCanvas, -srcCanvas.width / 2, -srcCanvas.height / 2);
      return newCanvas;
    };

    let sourceCanvas = cropCanvas;
    if (screenAngle && screenAngle !== 0) {
      // rotate the crop so that UI 'bottom' becomes bottom in saved image
      sourceCanvas = rotateCanvasBy(cropCanvas, -screenAngle);
    }

    // Ensure final source is landscape (width >= height), if not rotate 90 degrees
    if (sourceCanvas.width < sourceCanvas.height) {
      sourceCanvas = rotateCanvasBy(sourceCanvas, 90);
    }

    // Scale to standard size while preserving aspect ratio (final oriented landscape)
    const targetW = 800;
    const targetH = 200;
    const outCanvas = document.createElement('canvas');
    outCanvas.width = targetW;
    outCanvas.height = targetH;
    const outCtx = outCanvas.getContext('2d');
    outCtx.clearRect(0, 0, targetW, targetH);

    const scale = Math.min(targetW / sourceCanvas.width, targetH / sourceCanvas.height);
    const drawW = Math.round(sourceCanvas.width * scale);
    const drawH = Math.round(sourceCanvas.height * scale);
    const dx = Math.round((targetW - drawW) / 2);
    const dy = Math.round((targetH - drawH) / 2);
    outCtx.imageSmoothingEnabled = true;
    outCtx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, dx, dy, drawW, drawH);

    return outCanvas.toDataURL('image/png');
  };

  const handleDone = () => {
    if (!hasSignature) {
      alert('Please provide your signature before confirming.');
      return;
    }

    const canvas = canvasRef.current;
    const enhanced = enhanceSignature(canvas);
    onConfirm(enhanced);
  };

  return (
    <div className="signature-pad-container">
      <div className="signature-header">
        <h2>Please Sign Below</h2>
        <p>Draw your signature on the screen</p>
      </div>
      
      <div className="signature-canvas-wrapper">
        <canvas
          ref={canvasRef}
          className="signature-canvas"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
        {/* <div className="signature-guide">This side is the <strong>bottom</strong></div> */}
        
      </div>
      <div className="signature-guide-right">This side is the <strong>bottom</strong></div>
      
      <div className="signature-controls" style={{ display: 'flex', visibility: 'visible', opacity: 1 }}>
        <button className="btn-erase" onClick={eraseSignature} style={{ display: 'block', visibility: 'visible', opacity: 1 }}>
          Erase
        </button>
        <button className="btn-done" onClick={handleDone} disabled={!hasSignature} style={{ display: 'block', visibility: 'visible', opacity: 1 }}>
          Done
        </button>
      </div>
    </div>
  );
};

export default SignaturePad;

