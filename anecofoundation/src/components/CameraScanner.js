import React, { useRef, useEffect, useState } from 'react';
import './CameraScanner.css';

// Polyfill for older browsers - ensure mediaDevices exists
if (typeof navigator !== 'undefined') {
  if (navigator.mediaDevices === undefined) {
    navigator.mediaDevices = {};
  }

  // Only add polyfill if getUserMedia doesn't exist and we have legacy support
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

  // Detect if we're on a mobile device
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    // Only restart camera if it was already started (user clicked start)
    if (cameraStarted && streamRef.current) {
      startCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode]);

  // Helper function to get getUserMedia with fallback for older browsers
  function getUserMediaHelper(constraints) {
    // Try modern API first
    if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
      return navigator.mediaDevices.getUserMedia(constraints);
    }
    
    // Try legacy APIs
    const legacyGetUserMedia = navigator.getUserMedia || 
                               navigator.webkitGetUserMedia || 
                               navigator.mozGetUserMedia || 
                               navigator.msGetUserMedia;
    
    if (legacyGetUserMedia) {
      return new Promise((resolve, reject) => {
        legacyGetUserMedia.call(navigator, constraints, resolve, reject);
      });
    }
    
    // If we have the polyfill, use it
    if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
      return navigator.mediaDevices.getUserMedia(constraints);
    }
    
    return Promise.reject(new Error('getUserMedia is not supported in this browser'));
  }

  async function startCamera() {
    setIsLoading(true);
    setError(null);
    
    console.log('Starting camera...');
    console.log('Browser:', navigator.userAgent);
    console.log('Has mediaDevices:', !!navigator.mediaDevices);
    console.log('Has getUserMedia:', !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia));

    // Check if we're in a browser environment
    if (typeof navigator === 'undefined') {
      setError('This feature requires a browser environment.');
      setIsLoading(false);
      return;
    }

    // Check if getUserMedia is available (check all possible APIs)
    const hasModernAPI = !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
    const hasLegacyAPI = !!(navigator.getUserMedia || 
                            navigator.webkitGetUserMedia || 
                            navigator.mozGetUserMedia || 
                            navigator.msGetUserMedia);
    const hasGetUserMedia = hasModernAPI || hasLegacyAPI;

    if (!hasGetUserMedia) {
      // Provide helpful error message based on what we detected
      const browserInfo = navigator.userAgent || 'Unknown browser';
      const protocol = window.location ? window.location.protocol : 'unknown';
      const hostname = window.location ? window.location.hostname : 'unknown';
      
      let errorMsg = 'Camera access is not supported in this browser. ';
      errorMsg += `\n\nBrowser: ${browserInfo}`;
      errorMsg += `\nProtocol: ${protocol}`;
      errorMsg += `\nHostname: ${hostname}`;
      
      // Check if it's a secure context issue
      if (protocol !== 'https:' && hostname !== 'localhost' && hostname !== '127.0.0.1') {
        errorMsg += '\n\n⚠️ Note: Camera access requires HTTPS or localhost.';
      }
      
      errorMsg += '\n\nPlease try:\n';
      errorMsg += '1. Using a modern browser (Chrome, Firefox, Safari, Edge)\n';
      errorMsg += '2. Accessing via HTTPS or localhost\n';
      errorMsg += '3. Checking browser permissions';
      
      setError(errorMsg);
      setIsLoading(false);
      return;
    }

    // Check if we're in a secure context (HTTPS or localhost) - warn but don't block
    const isSecureContext = window.isSecureContext !== false && (
                            window.location.protocol === 'https:' || 
                            window.location.hostname === 'localhost' || 
                            window.location.hostname === '127.0.0.1' ||
                            window.location.hostname.match(/^192\.168\./) ||
                            window.location.hostname.match(/^10\./) ||
                            window.location.hostname.match(/^172\.(1[6-9]|2[0-9]|3[01])\./));

    // Don't block, but we'll let the browser handle the security check
    // Some browsers allow camera on HTTP for local development

    // Stop existing stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStream(null);
    }
    
    try {
      // For mobile Chrome, use simplest constraints first
      let constraints = { video: true, audio: false };
      
      // Try facingMode only if we're not on mobile (mobile Chrome sometimes has issues)
      if (!isMobile && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        constraints = {
          video: { facingMode: facingMode },
          audio: false
        };
      }

      // Try to get media stream
      let s;
      let errorToShow = null;
      
      try {
        console.log('Requesting camera with constraints:', constraints);
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          s = await navigator.mediaDevices.getUserMedia(constraints);
        } else {
          s = await getUserMediaHelper(constraints);
        }
        console.log('Camera stream obtained successfully');
      } catch (firstError) {
        errorToShow = firstError;
        console.log('First attempt failed:', firstError.name, firstError.message);
        
        // Try with simplest possible constraints
        if (constraints.video && (constraints.video.facingMode || typeof constraints.video === 'object')) {
          try {
            console.log('Trying fallback with video: true');
            const fallbackConstraints = { video: true, audio: false };
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
              s = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
            } else {
              s = await getUserMediaHelper(fallbackConstraints);
            }
            console.log('Fallback succeeded');
            errorToShow = null;
          } catch (secondError) {
            console.log('Fallback also failed:', secondError.name, secondError.message);
            errorToShow = secondError;
          }
        }
      }
      
      if (!s) {
        throw errorToShow || new Error('Failed to access camera');
      }
      
      console.log('Stream tracks:', s.getTracks().length);
      streamRef.current = s;
      setStream(s);
      setCameraStarted(true);
      
      // Wait a bit for React to render the video element
      await new Promise(resolve => setTimeout(resolve, 100));
      
      if (videoRef.current) {
        console.log('Setting up video element for mobile Chrome...');
        const video = videoRef.current;
        
        // CRITICAL for mobile Chrome: Set all attributes BEFORE assigning stream
        video.setAttribute('playsinline', 'true');
        video.setAttribute('webkit-playsinline', 'true');
        video.setAttribute('muted', 'true');
        video.setAttribute('autoplay', 'true');
        video.muted = true;
        video.playsInline = true;
        video.autoplay = true;
        video.controls = false;
        
        // Ensure video is visible (mobile Chrome needs this)
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'cover';
        video.style.display = 'block';
        // Apply the selected preview filter to the video element so the user sees the final look
        video.style.filter = getCssFilter(filter);
        
        // Assign stream
        if ('srcObject' in video) {
          console.log('Using srcObject (modern API)');
          video.srcObject = s;
        } else {
          console.log('Using src (legacy API)');
          video.src = window.URL.createObjectURL(s);
        }
        
        // Mobile Chrome specific: Wait for loadedmetadata before playing
        const playVideo = async () => {
          try {
            console.log('Video readyState:', video.readyState);
            if (video.readyState >= 2) {
              console.log('Video ready, attempting to play...');
              await video.play();
              console.log('✅ Video playing successfully!');
            } else {
              console.log('Waiting for video to be ready...');
            }
          } catch (err) {
            console.error('Video play error:', err.name, err.message);
            // Retry after a delay for mobile Chrome
            setTimeout(async () => {
              try {
                await video.play();
                console.log('✅ Video playing after retry!');
              } catch (retryErr) {
                console.error('Retry play failed:', retryErr);
              }
            }, 300);
          }
        };
        
        // Set up event listeners for mobile Chrome
        video.onloadedmetadata = () => {
          console.log('✅ Video metadata loaded');
          playVideo();
        };
        
        video.oncanplay = () => {
          console.log('✅ Video can play');
          playVideo();
        };
        
        video.onloadeddata = () => {
          console.log('✅ Video data loaded');
          playVideo();
        };
        
        // Try playing immediately if already ready
        if (video.readyState >= 2) {
          console.log('Video already ready, playing immediately');
          playVideo();
        } else {
          // Force load for mobile Chrome
          video.load();
        }
      } else {
        console.error('❌ Video ref is null! Camera started but video element not found.');
        setError('Video element not found. Please refresh the page.');
      }
    } catch (e) {
      console.error('Camera error:', e);
      console.error('Error name:', e.name);
      console.error('Error message:', e.message);
      console.error('Error stack:', e.stack);
      
      let errorMessage = 'Failed to access camera. ';
      
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        errorMessage = '❌ Camera permission denied. Please allow camera access in your browser settings and try again.';
      } else if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
        errorMessage = '❌ No camera found on this device.';
      } else if (e.name === 'NotReadableError' || e.name === 'TrackStartError') {
        errorMessage = '❌ Camera is already in use by another application. Please close other apps using the camera.';
      } else if (e.name === 'OverconstrainedError' || e.name === 'ConstraintNotSatisfiedError') {
        errorMessage = '⚠️ Camera does not support the requested settings. Trying with default settings...';
        // Try one more time with video: true
        setTimeout(() => {
          startCamera();
        }, 500);
        return;
      } else if (e.name === 'SecurityError') {
        errorMessage = '🔒 Camera access blocked. Please use HTTPS or localhost. Current URL: ' + window.location.href;
      } else if (e.message && e.message.includes('not supported')) {
        errorMessage = '❌ ' + e.message;
      } else {
        errorMessage = '❌ ' + (e.message || 'Unknown error occurred.') + ' (Error: ' + e.name + ')';
      }
      
      setError(errorMessage);
      setCameraStarted(false);
    } finally {
      setIsLoading(false);
    }
  }

  function handleStartCamera() {
    startCamera();
  }

  // Keep the preview video element in sync with the selected filter
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.style.filter = getCssFilter(filter);
    }
  }, [filter]);

  function toggleFacing() {
    setFacingMode((m) => (m === 'user' ? 'environment' : 'user'));
  }

  // Return a CSS filter string that approximates the canvas filter for both preview and capture
  function getCssFilter(name) {
    if (name === 'grayscale') return 'grayscale(100%)';
    if (name === 'contrast') return 'contrast(140%) saturate(105%)';
    return 'none';
  }

  function applyFilterToCanvas(ctx, w, h) {
    if (filter === 'none') return;

    // Prefer using ctx.filter if supported by the browser since it matches CSS filters exactly.
    // If ctx.filter is available we assume the image was already drawn using that filter during capture.
    // This function keeps a pixel-manipulation fallback for older browsers.
    const supportsCanvasFilter = typeof ctx.filter !== 'undefined';
    if (supportsCanvasFilter) return; // nothing to do; drawImage used ctx.filter already

    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    if (filter === 'grayscale') {
      for (let i = 0; i < d.length; i += 4) {
        const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    }
    if (filter === 'contrast') {
      // Use a milder contrast factor to approximate CSS contrast(140%) visually
      const contrastAmount = 40; // approx -> CSS contrast(140%)
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
    const w = video.videoWidth;
    const h = video.videoHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    // If canvas supports ctx.filter, draw using the same CSS filter so preview == captured image.
    const cssFilter = getCssFilter(filter);
    if (typeof ctx.filter !== 'undefined') {
      ctx.save();
      ctx.filter = cssFilter;
      ctx.drawImage(video, 0, 0, w, h);
      ctx.filter = 'none';
      ctx.restore();
    } else {
      // Fallback: draw raw then apply pixel manipulation as before
      ctx.drawImage(video, 0, 0, w, h);
      applyFilterToCanvas(ctx, w, h);
    }

    const data = canvas.toDataURL('image/jpeg', 0.92);
    setCaptured(data);
    
    // Convert data URL to Blob and call onCapture callback if provided
    if (onCapture) {
      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], `scan_${Date.now()}.jpg`, { type: 'image/jpeg' });
          onCapture(file);
        }
      }, 'image/jpeg', 0.92);
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
