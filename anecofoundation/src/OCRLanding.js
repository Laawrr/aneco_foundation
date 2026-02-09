import React, { useEffect, useRef, useState } from 'react';
import './OCRLanding.css';
import { createWorker } from 'tesseract.js';

// Parser function to extract structured data from OCR text
const parseOCRText = (text) => {
  const data = {};

  // Transaction Reference
  const transactionMatch = text.match(/Transaction\s*Ref\s*[:-]?\s*(\d+)/i);
  if (transactionMatch) {
    data.transactionRef = transactionMatch[1].trim();
  }

  // Account Number and Customer Name
  const accountMatch = text.match(/(B\d+)\s*\/\s*([A-Z,\s]+?)(?:\n|$)/i);
  if (accountMatch) {
    data.accountNumber = accountMatch[1].trim();
    data.customerName = accountMatch[2].trim();
  } else {
    const accountOnly = text.match(/\b(B\d{12,})\b/i);
    if (accountOnly) {
      data.accountNumber = accountOnly[1].trim();
    }
  }

  // Date (Long format)
  const dateMatch = text.match(
    /Date\s*[:-]?\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i
  );
  if (dateMatch) {
    data.date = `${dateMatch[1]} ${dateMatch[2]}, ${dateMatch[3]}`;
  } else {
    // Date (MM/DD/YYYY)
    const dateMatch2 = text.match(/Date\s*[:-]?\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (dateMatch2) {
      data.date = dateMatch2[1];
    }
  }

  // Electricity Bill
  const electricityMatch = text.match(
    /Electricity\s*Bill\s*[:-]?\s*([\d,]+\.?\d*)/i
  );
  if (electricityMatch) {
    data.electricityBill = electricityMatch[1].trim();
  }

  // Amount Due
  const totalMatch = text.match(
    /Amount\s*Due\s*[:-]?\s*([\d,]+\.?\d*)/i
  );
  if (totalMatch) {
    data.amountDue = totalMatch[1].trim();
  }

  // Total Sales
  const salesMatch = text.match(
    /Total\s*Sales\s*[:-]?\s*([\d,]+\.?\d*)/i
  );
  if (salesMatch) {
    data.totalSales = salesMatch[1].trim();
  }

  // Company Name
  const companyMatch = text.match(
    /AGUSAN\s+DEL\s+NORTE\s+ELECTRIC\s+COOPERATIVE,?\s*INC\.?/i
  );
  if (companyMatch) {
    data.company = companyMatch[0].trim();
  } else {
    const companyMatch2 = text.match(
      /([A-Z][A-Z\s&]+ELECTRIC[A-Z\s,]+INC)/i
    );
    if (companyMatch2) {
      data.company = companyMatch2[1].trim();
    }
  }

  return data;
};

// Image rotation helper
const rotateCanvas = (canvas, degrees) => {
  const radians = (degrees * Math.PI) / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  const newWidth = canvas.height * sin + canvas.width * cos;
  const newHeight = canvas.height * cos + canvas.width * sin;
  const newCanvas = document.createElement('canvas');
  newCanvas.width = newWidth;
  newCanvas.height = newHeight;
  const ctx = newCanvas.getContext('2d');
  ctx.translate(newWidth / 2, newHeight / 2);
  ctx.rotate(radians);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return newCanvas;
};

function OCRLanding() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const streamRef = useRef(null);
  
  const [mode, setMode] = useState('capture');
  const [capturedImage, setCapturedImage] = useState(null);
  const [parsedData, setParsedData] = useState(null);
  const [rawText, setRawText] = useState('');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Ready');
  const [modalType, setModalType] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [toast, setToast] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [rotateView, setRotateView] = useState(0); // degrees to rotate live video for user
  const workerRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    
    (async () => {
      try {
        setStatus('Loading OCR worker...');
        const worker = await createWorker({
          logger: m => {
            if (!mounted) return;
            if (m.status === 'recognizing text' && typeof m.progress === 'number') {
              setProgress(Math.round(m.progress * 100));
            }
          }
        });
        await worker.loadLanguage('eng');
        await worker.initialize('eng');
        if (!mounted) {
          await worker.terminate();
          return;
        }
        workerRef.current = worker;
        setStatus('Ready');
      } catch (err) {
        if (mounted) setStatus('OCR Error');
      }
    })();

    startCamera();

    return () => {
      mounted = false;
      stopCamera();
      if (workerRef.current) workerRef.current.terminate();
    };
  }, []);

  const startCamera = async () => {
    try {
      setCameraError(null);
      const constraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          setCameraActive(true);
          setStatus('Ready');
        };
      }
    } catch (err) {
      setCameraError('Camera access denied. Please enable camera permissions.');
      setStatus('Camera Error');
      showToast('❌ ' + err.message);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current || !cameraActive) return;
    
    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      // Draw full video frame to canvas
      // If user rotated the view for easier framing, take that into account by drawing the video normally
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      
      // Calculate guide frame position and size relative to video
      // Guide is 96% width, centered, with aspect-ratio 0.58
      const guideWidth = canvas.width * 0.96;
      const guideHeight = guideWidth / 0.58;  // aspect-ratio = width/height = 0.58
      const guideX = (canvas.width - guideWidth) / 2;  // center horizontally
      const guideY = (canvas.height - guideHeight) / 2;  // center vertically
      
      // Create a new canvas with only the guide area
      const croppedCanvas = document.createElement('canvas');
      croppedCanvas.width = guideWidth;
      croppedCanvas.height = guideHeight;
      const croppedCtx = croppedCanvas.getContext('2d');
      
      // Copy only the guide region from the original canvas
      croppedCtx.drawImage(
        canvas,
        guideX, guideY, guideWidth, guideHeight,  // source rect
        0, 0, guideWidth, guideHeight              // dest rect
      );
      
      // Normalize orientation: prefer using device/screen orientation when available
      let finalCanvas = croppedCanvas;
      try {
        let desiredRotation = 0;
        const screenAngle = (window.screen && window.screen.orientation && typeof window.screen.orientation.angle === 'number')
          ? window.screen.orientation.angle
          : (typeof window.orientation === 'number' ? window.orientation : null);

        if (screenAngle !== null) {
          if (screenAngle === 90) desiredRotation = -90;
          else if (screenAngle === 270) desiredRotation = 90;
          else if (screenAngle === 180) desiredRotation = 180;
        } else if (croppedCanvas.width > croppedCanvas.height) {
          desiredRotation = 90;
        }

        if (desiredRotation !== 0) {
          finalCanvas = rotateCanvas(croppedCanvas, desiredRotation);
        }
      } catch (e) {
        if (croppedCanvas.width > croppedCanvas.height) {
          finalCanvas = rotateCanvas(croppedCanvas, 90);
        }
      }

      const imageData = finalCanvas.toDataURL('image/jpeg', 0.9);
      setCapturedImage(imageData);
      stopCamera();
      setMode('preview');
    } catch (err) {
      showToast('❌ Failed to capture image');
    }
  };

  // Allow rotating the live preview (for user's framing convenience)
  const rotateLiveView = () => {
    setRotateView(prev => (prev + 90) % 360);
  };

  // Rotate the captured image in preview before processing/saving
  const rotateCapturedPreview = async () => {
    if (!capturedImage) return;
    const img = new Image();
    img.onload = () => {
      const tmp = document.createElement('canvas');
      tmp.width = img.width;
      tmp.height = img.height;
      const ctx = tmp.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const rotated = rotateCanvas(tmp, 90);
      setCapturedImage(rotated.toDataURL('image/jpeg', 0.9));
    };
    img.src = capturedImage;
  };

  // Trigger file input (visible upload button)
  const openFilePicker = () => fileInputRef.current?.click();


  const processImage = async () => {
    if (!capturedImage || !workerRef.current) {
      showToast('❌ No image to process');
      return;
    }

    setMode('processing');
    setStatus('Analyzing document...');
    setProgress(0);
    setModalType(null);

    try {
      const img = new Image();
      img.onload = async () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);

          const { data: { text: t } } = await workerRef.current.recognize(canvas);
          setRawText(t);
          alert(t);
          const parsed = parseOCRText(t);
          setParsedData(parsed);

          let isValid = true;
          let issue = '';

          if (!parsed.transactionRef) {
            isValid = false;
            issue = '❌ Transaction reference not found';
          } else {
            // Require at least 15 digits in the transaction reference
            const digitCount = (parsed.transactionRef.match(/\d/g) || []).length;
            if (digitCount < 15) {
              isValid = false;
              issue = '❌ Transaction reference must contain at least 15 digits';
            }
          }

          if (isValid && !parsed.accountNumber) {
            isValid = false;
            issue = '❌ Account number not found';
          }

          if (isValid && parsed.electricityBill) {
            const billAmount = parseFloat(parsed.electricityBill.replace(/,/g, ''));
            if (billAmount < 50) {
              isValid = false;
              issue = `⚠️ Bill (₱${parsed.electricityBill}) is less than ₱50`;
            }
          }

          if (isValid && parsed.transactionRef) {
            try {
              const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';
              console.log('[ocr] Checking duplicate transaction at', `${API_BASE}/api/check-transaction/${parsed.transactionRef}`);
              const res = await fetch(`${API_BASE}/api/check-transaction/${parsed.transactionRef}`);
              if (!res.ok) {
                console.error('[api] check-transaction non-OK response', res.status, await res.text());
              } else {
                const data = await res.json();
                console.log('[api] check-transaction result:', data);
                if (data.exists) {
                  setModalType('duplicate');
                  setErrorMessage(`Transaction already exists`);
                  setMode('preview');
                  setStatus('Ready');
                  return;
                }
              }
            } catch (err) {
              console.error('[api] Duplicate check failed:', err.message || err);
              showToast('⚠️ Could not verify duplicate transaction (network error).');
            }

            setModalType('success');
          } else {
            setModalType('error');
            setErrorMessage(issue);
          }

          setMode('preview');
          setStatus('Ready');
          setProgress(100);
        } catch (err) {
          setModalType('error');
          setErrorMessage(`Processing error`);
          setMode('preview');
          setStatus('Ready');
        }
      };
      img.src = capturedImage;
    } catch (err) {
      setModalType('error');
      setErrorMessage(`Error: ${String(err)}`);
      setMode('preview');
      setStatus('Ready');
    }
  };

  const saveToDatabase = async () => {
    if (!parsedData) {
      showToast('❌ No data to save');
      return;
    }

    setStatus('Saving...');
    try {
      const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';
      console.log('[ocr] Saving to database at', `${API_BASE}/api/ocr-data`);
      const res = await fetch(`${API_BASE}/api/ocr-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsedData)
      });

      if (res.ok) {
        const data = await res.json();
        console.log('[api] save-ocr-data success:', data);
        showToast('✅ Saved successfully');
        setModalType(null);
        resetCapture();
      } else {
        const text = await res.text().catch(() => '');
        console.error('[api] save-ocr-data failed', res.status, text);
        showToast(`❌ Failed to save: ${res.status}`);
      }
    } catch (err) {
      console.error('[api] save-ocr-data network error:', err.message || err);
      showToast(`❌ Network error: ${err && err.message ? err.message : 'Failed to fetch'}`);
    }
    setStatus('Ready');
  };

  const resetCapture = () => {
    setCapturedImage(null);
    setParsedData(null);
    setRawText('');
    setModalType(null);
    setMode('capture');
    startCamera();
  };

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(''), 3000);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setCapturedImage(event.target.result);
        setMode('preview');
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="ocr-scanner">
      {/* Top Toolbar */}
      <div className="toolbar toolbar-top">
        <button className="toolbar-back" onClick={() => window.history.back()} title="Back">←</button>
        <h1>Aneco Document Scanner</h1>
      </div>

      {/* Main Content */}
      {mode === 'capture' && (
        <div className="capture-container">
          {cameraError ? (
            <div className="error-state">
              <p className="error-text">{cameraError}</p>
              <button className="btn-retry" onClick={startCamera}>🔄 Retry Camera</button>
              <button className="btn-file" onClick={() => fileInputRef.current?.click()}>📁 Choose File</button>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} style={{ display: 'none' }} />
            </div>
          ) : (
            <>
              <video ref={videoRef} autoPlay playsInline muted className="camera-feed" style={{ transform: `rotate(${rotateView}deg)` }} />
              <div className="document-overlay">
                <p className="instruction-text">Position document within the frame</p>
                <div className="document-frame">
                  <div className="corner corner-tl"></div>
                  <div className="corner corner-tr"></div>
                  <div className="corner corner-bl"></div>
                  <div className="corner corner-br"></div>
                </div>
                <p className="hint-text">Ensure text is clear and readable</p>
              </div>
            </>
          )}
        </div>
      )}

      {mode !== 'capture' && capturedImage && (
        <div className="preview-container">
          {mode === 'processing' && (
            <div className="processing-overlay">
              <div className="spinner"></div>
              <p className="processing-text">Analyzing...</p>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }}></div>
              </div>
            </div>
          )}
          <img src={capturedImage} alt="Document" className="preview-image" />
        </div>
      )}

      {/* Success Modal */}
      {modalType === 'success' && parsedData && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header success-header">✅ Document Verified</div>
            <div className="modal-body">
              <div className="data-grid">
                {parsedData.transactionRef && <div className="data-item"><span className="label">Ref:</span><span className="value">{parsedData.transactionRef}</span></div>}
                {parsedData.accountNumber && <div className="data-item"><span className="label">Account:</span><span className="value">{parsedData.accountNumber}</span></div>}
                {parsedData.customerName && <div className="data-item"><span className="label">Name:</span><span className="value">{parsedData.customerName}</span></div>}
                {parsedData.electricityBill && <div className="data-item"><span className="label">Bill:</span><span className="value">₱{parsedData.electricityBill}</span></div>}
                {parsedData.date && <div className="data-item"><span className="label">Date:</span><span className="value">{parsedData.date}</span></div>}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={resetCapture}>Cancel</button>
              <button className="btn-primary" onClick={saveToDatabase}>Save ✓</button>
            </div>
          </div>
        </div>
      )}

      {/* Error Modal */}
      {modalType === 'error' && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header error-header">❌ Validation Failed</div>
            <div className="modal-body">
              <p className="error-message">{errorMessage}</p>
            </div>
            <div className="modal-footer">
              <button className="btn-primary" onClick={resetCapture}>Retry</button>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate Modal */}
      {modalType === 'duplicate' && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header duplicate-header">🔴 Duplicate Found</div>
            <div className="modal-body">
              <p className="error-message">{errorMessage}</p>
            </div>
            <div className="modal-footer">
              <button className="btn-primary" onClick={resetCapture}>Scan New</button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Toolbar */}
      <div className="toolbar toolbar-bottom">
        {mode === 'capture' && (
          <div className="bottom-actions">
            <button className="btn-circle btn-upload" onClick={openFilePicker} title="Upload">
              📁
            </button>
            <button className="btn-circle btn-rotate" onClick={rotateLiveView} title="Rotate view">
              ↻
            </button>
            <button className="btn-circle btn-confirm" onClick={captureFrame} disabled={!cameraActive} title="Capture">
              ✅
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} style={{ display: 'none' }} />
          </div>
        )}

        {mode === 'preview' && (
          <div className="preview-actions">
            <button className="btn-circle btn-rotate" onClick={rotateCapturedPreview} title="Rotate image">↻</button>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button className="btn-secondary" onClick={resetCapture}>↺ Retake</button>
              <button className="btn-primary" onClick={processImage}>🔍 Process</button>
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}

      {/* Hidden Canvas */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
}

export default OCRLanding;