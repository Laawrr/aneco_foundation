import React, { useState, useRef, useEffect } from 'react';
import './ImageCropper.css';

const ImageCropper = ({ image, onCropComplete, onCancel }) => {
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  const [crop, setCrop] = useState({ x: 10, y: 10, width: 80, height: 80 }); // percentages
  const [isDragging, setIsDragging] = useState(false);
  const [dragHandle, setDragHandle] = useState(null); // 'move', 'nw', 'ne', 'sw', 'se'
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImageSize({ width: img.width, height: img.height });
    };
    img.src = image;
  }, [image]);

  const getMousePosition = (e) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: ((clientX - rect.left) / rect.width) * 100,
      y: ((clientY - rect.top) / rect.height) * 100
    };
  };

  const handleMouseDown = (e, handle) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = getMousePosition(e);
    setStartPos(pos);
    setIsDragging(true);
    setDragHandle(handle);
  };

  const handleMouseMove = (e) => {
    if (!isDragging || !containerRef.current) return;
    e.preventDefault();

    const pos = getMousePosition(e);

    setCrop(prev => {
      let newCrop = { ...prev };
      const minSize = 10; // minimum 10% size

      if (dragHandle === 'move') {
        // Move the entire crop area
        const dx = pos.x - startPos.x;
        const dy = pos.y - startPos.y;
        newCrop.x = Math.max(0, Math.min(100 - prev.width, prev.x + dx));
        newCrop.y = Math.max(0, Math.min(100 - prev.height, prev.y + dy));
        setStartPos(pos);
      } else if (dragHandle === 'nw') {
        const maxX = prev.x + prev.width - minSize;
        const maxY = prev.y + prev.height - minSize;
        const newX = Math.max(0, Math.min(pos.x, maxX));
        const newY = Math.max(0, Math.min(pos.y, maxY));
        newCrop.width = prev.width + (prev.x - newX);
        newCrop.height = prev.height + (prev.y - newY);
        newCrop.x = newX;
        newCrop.y = newY;
      } else if (dragHandle === 'ne') {
        const maxY = prev.y + prev.height - minSize;
        const newWidth = Math.max(minSize, Math.min(100 - prev.x, pos.x - prev.x));
        const newY = Math.max(0, Math.min(pos.y, maxY));
        newCrop.width = newWidth;
        newCrop.height = prev.height + (prev.y - newY);
        newCrop.y = newY;
      } else if (dragHandle === 'sw') {
        const maxX = prev.x + prev.width - minSize;
        const newX = Math.max(0, Math.min(pos.x, maxX));
        const newHeight = Math.max(minSize, Math.min(100 - prev.y, pos.y - prev.y));
        newCrop.width = prev.width + (prev.x - newX);
        newCrop.height = newHeight;
        newCrop.x = newX;
      } else if (dragHandle === 'se') {
        newCrop.width = Math.max(minSize, Math.min(100 - prev.x, pos.x - prev.x));
        newCrop.height = Math.max(minSize, Math.min(100 - prev.y, pos.y - prev.y));
      }

      return newCrop;
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setDragHandle(null);
  };

  useEffect(() => {
    if (isDragging) {
      const handleMove = (e) => handleMouseMove(e);
      const handleEnd = () => handleMouseUp();
      
      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleEnd);
      document.addEventListener('touchmove', handleMove, { passive: false });
      document.addEventListener('touchend', handleEnd);
      
      return () => {
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleEnd);
        document.removeEventListener('touchmove', handleMove);
        document.removeEventListener('touchend', handleEnd);
      };
    }
  }, [isDragging, dragHandle, startPos]);

  const handleCrop = () => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scaleX = img.width / 100;
      const scaleY = img.height / 100;
      
      canvas.width = crop.width * scaleX;
      canvas.height = crop.height * scaleY;
      
      const ctx = canvas.getContext('2d');
      ctx.drawImage(
        img,
        crop.x * scaleX,
        crop.y * scaleY,
        crop.width * scaleX,
        crop.height * scaleY,
        0,
        0,
        canvas.width,
        canvas.height
      );

      const croppedImage = canvas.toDataURL('image/jpeg', 0.9);
      onCropComplete(croppedImage);
    };
    img.src = image;
  };

  return (
    <div className="image-cropper">
      <div className="cropper-wrapper">
        <div className="cropper-container" ref={containerRef}>
          <img 
            ref={imageRef}
            src={image} 
            alt="Crop preview" 
            className="cropper-image"
            draggable={false}
          />
          <div
            className="crop-overlay"
            style={{
              left: `${crop.x}%`,
              top: `${crop.y}%`,
              width: `${crop.width}%`,
              height: `${crop.height}%`
            }}
          >
            <div
              className="crop-area"
              onMouseDown={(e) => handleMouseDown(e, 'move')}
              onTouchStart={(e) => handleMouseDown(e, 'move')}
            >
              {/* Corner handles */}
              <div
                className="crop-handle corner-nw"
                onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'nw'); }}
                onTouchStart={(e) => { e.stopPropagation(); handleMouseDown(e, 'nw'); }}
              />
              <div
                className="crop-handle corner-ne"
                onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'ne'); }}
                onTouchStart={(e) => { e.stopPropagation(); handleMouseDown(e, 'ne'); }}
              />
              <div
                className="crop-handle corner-sw"
                onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'sw'); }}
                onTouchStart={(e) => { e.stopPropagation(); handleMouseDown(e, 'sw'); }}
              />
              <div
                className="crop-handle corner-se"
                onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'se'); }}
                onTouchStart={(e) => { e.stopPropagation(); handleMouseDown(e, 'se'); }}
              />
            </div>
          </div>
        </div>
      </div>
      <div className="cropper-actions">
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" onClick={handleCrop}>Apply Crop</button>
      </div>
    </div>
  );
};

export default ImageCropper;
