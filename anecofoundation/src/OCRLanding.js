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
  const [status, setStatus] = useState('Idle');
  const [saveStatus, setSaveStatus] = useState('');
  const [showWarning, setShowWarning] = useState(false);
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
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

  const handleFile = e => {
    const file = e.target.files[0];
    if (file) {
      setImage(file);
      setPreview(URL.createObjectURL(file));
      setText('');
      setProgress(0);
    }
  };

  const doOCR = async () => {
    if (!workerRef.current) return;
    if (!image) {
      setStatus('Select an image first');
      return;
    }
    setStatus('Recognizing text');
    setText('Recognizing...');
    setParsedData(null);
    setShowWarning(false);
    setShowDuplicateWarning(false);
    try {
      const { data: { text: t } } = await workerRef.current.recognize(image);
      setText(t);
      // Parse the extracted text
      const parsed = parseOCRText(t);
      setParsedData(parsed);
      
      // Check if electricity bill is less than 50
      if (parsed.electricityBill) {
        const billAmount = parseFloat(parsed.electricityBill.replace(/,/g, ''));
        if (billAmount < 50) {
          setShowWarning(true);
        }
      }

      // Check if transaction ref already exists in database
      if (parsed.transactionRef) {
        try {
          const res = await fetch(`http://localhost:3001/api/check-transaction/${parsed.transactionRef}`);
          const data = await res.json();
          if (data.exists) {
            setShowDuplicateWarning(true);
          }
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

  // Helper function to rotate image using canvas
  const rotateImageFile = (file, degrees) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');

          if (degrees === 90 || degrees === 270) {
            canvas.width = img.height;
            canvas.height = img.width;
          } else {
            canvas.width = img.width;
            canvas.height = img.height;
          }

          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.rotate((degrees * Math.PI) / 180);
          ctx.drawImage(img, -img.width / 2, -img.height / 2);

          canvas.toBlob((blob) => {
            resolve(blob);
          }, 'image/jpeg', 0.95);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
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

        <div className="status-row">
          <div className="status">Status: <strong>{status}</strong></div>
          <div className="progress">Progress: <strong>{progress}%</strong></div>
        </div>

        {preview && (
          <div className="preview">
            <img src={preview} alt="preview" />
          </div>
        )}

        {/* Warning Modal */}
        {showWarning && (
          <div className="modal-overlay" onClick={() => setShowWarning(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>⚠️ Low Electricity Bill Warning</h2>
                <button className="modal-close" onClick={() => setShowWarning(false)}>&times;</button>
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