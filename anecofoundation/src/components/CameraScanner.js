import React, { useRef, useEffect, useState } from 'react';
import './CameraScanner.css';

// Polyfill for older browsers - ensure mediaDevices exists
if (typeof navigator !== 'undefined') {
  if (navigator.mediaDevices === undefined) {
    navigator.mediaDevices = {};
  }

  if (navigator.mediaDevices.getUserMedia === undefined) {
    const legacyGetUserMedia = navigator.getUserMedia || 
                               navigator.webkitGetUserMedia || 
                               navigator.mozGetUserMedia || 
                               navigator.msGetUserMedia;
    
    if (legacyGetUserMedia) {
      navigator.mediaDevices.getUserMedia = function(constraints) {
        return new Promise((resolve, reject) => {
          legacyGetUserMedia.call(navigator, constraints, resolve, reject);
        });
      };
    }
  }
}

export default function CameraScanner({ onCapture }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [facingMode, setFacingMode] = useState('environment');
  const [captured, setCaptured] = useState(null);
  const [filter, setFilter] = useState('none');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [cameraStarted, setCameraStarted] = useState(false);

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (cameraStarted && streamRef.current) {
      startCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode]);

  function getUserMediaHelper(constraints) {
    if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
      return navigator.mediaDevices.getUserMedia(constraints);
    }
    
    const legacyGetUserMedia = navigator.getUserMedia || 
                               navigator.webkitGetUserMedia || 
                               navigator.mozGetUserMedia || 
                               navigator.msGetUserMedia;
    
    if (legacyGetUserMedia) {
      return new Promise((resolve, reject) => {
        legacyGetUserMedia.call(navigator, constraints, resolve, reject);
      });
    }
    
    if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
      return navigator.mediaDevices.getUserMedia(constraints);
    }
    
    return Promise.reject(new Error('getUserMedia is not supported in this browser'));
  }

  async function startCamera() {
    setIsLoading(true);
    setError(null);
    
    if (typeof navigator === 'undefined') {
      setError('This feature requires a browser environment.');
      setIsLoading(false);
      return;
    }

    const hasModernAPI = !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
    const hasLegacyAPI = !!(navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia);
    const hasGetUserMedia = hasModernAPI || hasLegacyAPI;

    if (!hasGetUserMedia) {
      setError('Camera access is not supported in this browser.');
      setIsLoading(false);
      return;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStream(null);
    }
    
    try {
      // OPTIMIZATION: Request a reasonable resolution (HD) instead of 4K
      // This prevents the browser from giving us a massive stream that slows everything down
      let constraints = { 
        video: { 
          facingMode: facingMode,
          width: { ideal: 1280 }, // Request 720p/HD range
          height: { ideal: 720 }
        }, 
        audio: false 
      };
      
      if (isMobile) {
        // Mobile browsers handle resolution automatically usually, but we prefer 'environment'
        constraints = { video: { facingMode: facingMode }, audio: false };
      }

      let s;
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          s = await navigator.mediaDevices.getUserMedia(constraints);
        } else {
          s = await getUserMediaHelper(constraints);
        }
      } catch (firstError) {
        // Fallback to simple video: true if constraints fail
        const fallbackConstraints = { video: true, audio: false };
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          s = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
        } else {
          s = await getUserMediaHelper(fallbackConstraints);
        }
      }
      
      if (!s) throw new Error('Failed to access camera');
      
      streamRef.current = s;
      setStream(s);
      setCameraStarted(true);
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      if (videoRef.current) {
        const video = videoRef.current;
        video.setAttribute('playsinline', 'true');
        video.setAttribute('webkit-playsinline', 'true');
        video.setAttribute('muted', 'true');
        video.setAttribute('autoplay', 'true');
        video.muted = true;
        video.playsInline = true;
        video.autoplay = true;
        video.controls = false;
        
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'cover';
        video.style.display = 'block';
        video.style.filter = getCssFilter(filter);
        
        if ('srcObject' in video) {
          video.srcObject = s;
        } else {
          video.src = window.URL.createObjectURL(s);
        }
        
        const playVideo = async () => {
          try {
            if (video.readyState >= 2) {
              await video.play();
            }
          } catch (err) {
            setTimeout(async () => {
              try { await video.play(); } catch (retryErr) {}
            }, 300);
          }
        };
        
        video.onloadedmetadata = playVideo;
        video.oncanplay = playVideo;
        
        if (video.readyState >= 2) playVideo();
        else video.load();
      }
    } catch (e) {
      setError('Failed to access camera: ' + (e.message || e.name));
      setCameraStarted(false);
    } finally {
      setIsLoading(false);
    }
  }

  function handleStartCamera() {
    startCamera();
  }

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.style.filter = getCssFilter(filter);
    }
  }, [filter]);

  function toggleFacing() {
    setFacingMode((m) => (m === 'user' ? 'environment' : 'user'));
  }

  function getCssFilter(name) {
    if (name === 'grayscale') return 'grayscale(100%)';
    if (name === 'contrast') return 'contrast(140%) saturate(105%)';
    return 'none';
  }

  function applyFilterToCanvas(ctx, w, h) {
    if (filter === 'none') return;
    const supportsCanvasFilter = typeof ctx.filter !== 'undefined';
    if (supportsCanvasFilter) return; 

    // Manual pixel manipulation (Only runs on the resized small canvas now -> FAST)
    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    
    if (filter === 'grayscale') {
      for (let i = 0; i < d.length; i += 4) {
        const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    }
    if (filter === 'contrast') {
      const contrastAmount = 40; 
      const factor = (259 * (contrastAmount + 255)) / (255 * (259 - contrastAmount));
      for (let i = 0; i < d.length; i += 4) {
        d[i] = factor * (d[i] - 128) + 128;
        d[i + 1] = factor * (d[i + 1] - 128) + 128;
        d[i + 2] = factor * (d[i + 2] - 128) + 128;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  function capture() {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    // OPTIMIZATION: Downscale image immediately
    // High-res images are the #1 cause of slow OCR.
    // 1024px is plenty for text recognition and significantly faster to process.
    const MAX_WIDTH = 1024;
    let w = video.videoWidth;
    let h = video.videoHeight;
    
    if (w > MAX_WIDTH) {
      const scale = MAX_WIDTH / w;
      w = MAX_WIDTH;
      h = h * scale;
    }

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    // Use native canvas filter if supported (much faster than JS loop)
    const cssFilter = getCssFilter(filter);
    if (typeof ctx.filter !== 'undefined' && ctx.filter !== undefined) {
      ctx.save();
      ctx.filter = cssFilter;
      // Draw resized image directly
      ctx.drawImage(video, 0, 0, w, h);
      ctx.filter = 'none';
      ctx.restore();
    } else {
      // Fallback for older browsers
      ctx.drawImage(video, 0, 0, w, h);
      // This will now run much faster because w/h are smaller
      applyFilterToCanvas(ctx, w, h);
    }

    // Use 0.8 quality - good balance of speed vs quality for OCR
    const data = canvas.toDataURL('image/jpeg', 0.8);
    setCaptured(data);
    
    if (onCapture) {
      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], `scan_${Date.now()}.jpg`, { type: 'image/jpeg' });
          onCapture(file);
        }
      }, 'image/jpeg', 0.8);
    }
  }

  function downloadCaptured() {
    if (!captured) return;
    const a = document.createElement('a');
    a.href = captured;
    a.download = `scan_${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function clearCapture() {
    setCaptured(null);
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStream(null);
      setCameraStarted(false);
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    }
  }

  return (
    <div className="scanner-shell">
      <div className="scanner-canvas-area">
        {!captured && cameraStarted && (
          <video
            ref={videoRef}
            className="scanner-video"
            playsInline
            webkit-playsinline="true"
            muted
            autoPlay
            controls={false}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block'
            }}
          />
        )}

        {captured && (
          <img alt="captured" src={captured} className="preview" />
        )}

        {!cameraStarted && !captured && !isLoading && (
          <div className="camera-placeholder">
            <div className="camera-icon">📷</div>
            <p>Click "Start Camera" to begin scanning</p>
          </div>
        )}

        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {cameraStarted && !captured && (
          <div className="guided-overlay">
            <div className="corner top-left" />
            <div className="corner top-right" />
            <div className="corner bottom-left" />
            <div className="corner bottom-right" />
          </div>
        )}

        {isLoading && <div className="loading">Starting camera…</div>}
        
        {error && (
          <div className="error-message">
            <p>{error}</p>
            <button className="btn btn-small" onClick={handleStartCamera}>Try Again</button>
          </div>
        )}
      </div>

      <div className="controls">
        <div className="brand">
          <img src="/logo.png" alt="Aneco Logo" style={{width:44,height:44,objectFit:'contain'}} />
          <h1>AnecoScanner</h1>
          <p>Place document inside the corners and press Capture.</p>
        </div>

        {!cameraStarted && !error && (
          <div className="row">
            <button className="btn" onClick={handleStartCamera} disabled={isLoading}>
              Start Camera
            </button>
          </div>
        )}

        {cameraStarted && (
          <>
            <div className="row">
              <button className="btn" onClick={capture} disabled={isLoading || !!captured}>
                Capture
              </button>
              <button className="btn secondary" onClick={toggleFacing} disabled={isLoading || !!captured}>
                Toggle Camera
              </button>
              <button className="btn ghost" onClick={stopCamera} disabled={isLoading}>
                Stop Camera
              </button>
            </div>
          </>
        )}

        {captured && (
          <div className="row">
            <button className="btn ghost" onClick={clearCapture}>
              Retake
            </button>
          </div>
        )}

        <div className="filters">
          <label style={{fontSize:12,color:'#3D45AA',display:'block',marginBottom:'6px'}}>Filter</label>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="none">None</option>
            <option value="grayscale">Grayscale</option>
            <option value="contrast">Enhanced Contrast</option>
          </select>
        </div>

        <div className="row">
          <button className="btn" onClick={downloadCaptured} disabled={!captured}>
            Send Scan
          </button>
          <a className="btn secondary" href="#" onClick={(e)=>{e.preventDefault(); if(captured) window.open(captured, '_blank');}}>
            Open
          </a>
        </div>

        <div style={{marginTop:6,fontSize:12,color:'#3D45AA',textAlign:'center'}}>
          Tip: Position document inside the corners and press Capture.
        </div>
      </div>
    </div>
  );
}