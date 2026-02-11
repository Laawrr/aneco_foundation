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
      canvas.width = rect.width;
      canvas.height = rect.height;
      
      // Set drawing style
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
    
    if (e.touches && e.touches.length > 0) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top
      };
    }
    
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
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

  const handleDone = () => {
    if (!hasSignature) {
      alert('Please provide your signature before confirming.');
      return;
    }
    
    const canvas = canvasRef.current;
    const signatureData = canvas.toDataURL('image/png');
    onConfirm(signatureData);
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
      </div>
      
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

