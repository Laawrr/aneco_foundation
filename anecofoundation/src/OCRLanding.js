import React, { useEffect, useRef, useState } from 'react';
import './OCRLanding.css';
import { createWorker } from 'tesseract.js';
import ImageCropper from './components/ImageCropper';
import SignaturePad from './components/SignaturePad';

const SCANNER_NAME_STORAGE_KEY = 'anecoScannerName';

// HELPER: Convert "O" to "0", "l" to "1", etc. for numeric fields
const cleanOCRNumber = (str) => {
  if (!str) return '';
  return str.replace(/O|o|D|Q/g, '0')
            .replace(/I|l|\||\]/g, '1')
            .replace(/Z/g, '2')
            .replace(/S/g, '5')
            .replace(/B/g, '8')
            .replace(/[^\d.]/g, ''); // Strip everything that isn't a digit or dot
};

// HELPER: Convert OCR date string to YYYY-MM-DD for HTML input
const formatDateForInput = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return ''; // Invalid date
  return date.toISOString().split('T')[0];
};

const isFebruary2026 = (dateString) => {
  if (!dateString) return false;

  // Prefer strict yyyy-mm-dd parsing for consistency with input[type="date"].
  const isoMatch = String(dateString).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (year !== 2026 || month !== 2) return false;
    return day >= 1 && day <= 29;
  }

  const parsed = new Date(dateString);
  if (isNaN(parsed.getTime())) return false;
  return parsed.getFullYear() === 2026 && parsed.getMonth() === 1;
};

// HELPER: Pre-process image (Grayscale + High Contrast) to help Tesseract
const preprocessImage = (originalCanvas) => {
  const width = originalCanvas.width;
  const height = originalCanvas.height;
  const processedCanvas = document.createElement('canvas');
  processedCanvas.width = width;
  processedCanvas.height = height;
  const ctx = processedCanvas.getContext('2d');
  
  // Draw original
  ctx.drawImage(originalCanvas, 0, 0);
  
  // Get pixel data
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Contrast factor (increase to boost text darkness)
  const contrast = 60; // range 0-255
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

  for (let i = 0; i < data.length; i += 4) {
    // Convert to Grayscale (Luma formula)
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;

    // Apply Contrast
    let newValue = factor * (gray - 128) + 128;

    // Clamp to 0-255
    newValue = Math.max(0, Math.min(255, newValue));

    data[i] = newValue;     // R
    data[i + 1] = newValue; // G
    data[i + 2] = newValue; // B
  }

  ctx.putImageData(imageData, 0, 0);
  return processedCanvas;
};

// Parser function to extract structured data from OCR text
const parseOCRText = (text) => {
  const data = {};
  console.log("Raw OCR Text:", text);

  // 1. Transaction Ref
  // CHANGED: We now capture specifically digits, but allow common OCR errors (O, I, l) inside the number.
  // We STOP capturing if we hit a space followed by letters.
  const transMatch = text.match(/Trans[a-z]*\s*Ref[a-z]*\s*[:\.-]?\s*([0-9OIlZSB]{15,})/i);
  
  if (transMatch) {
    let cleanedRef = cleanOCRNumber(transMatch[1]);
    
    // SAFETY: If it's longer than 18 digits, it's almost certainly noise. 
    // If your refs are ALWAYS exactly 15 digits, change 20 to 15.
    if (cleanedRef.length > 20) {
      cleanedRef = cleanedRef.substring(0, 15); 
    }
    
    data.transactionRef = cleanedRef;
  }

  // 2. Account Number & Customer Name (Updated to allow hyphens in names)
  // Added \- inside the character class for name
  const accountMatch = text.match(/(B\s*\d[\d\s]*)\s*\/\s*([A-Z,\s\-\/]+?)(?:\n|$)/i);
  if (accountMatch) {
     const rawAcc = accountMatch[1].replace(/\s/g, '');
     data.accountNumber = 'B' + cleanOCRNumber(rawAcc.substring(1)); 
     data.customerName = accountMatch[2].trim();
  } else {
    // Fallback
    const accountOnly = text.match(/\b(B\s*[\d\sOIl]{12,})\b/i);
    if (accountOnly) {
       const rawAcc = accountOnly[1].replace(/\s/g, '');
       data.accountNumber = 'B' + cleanOCRNumber(rawAcc.substring(1));
    }
  }

  // 3. Date
  const dateMatch = text.match(
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})/i
  );
  if (dateMatch) {
    data.date = `${dateMatch[1]} ${dateMatch[2]}, ${dateMatch[3]}`;
  } else {
    const shortDate = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (shortDate) data.date = shortDate[1];
  }

  // 4. Electricity Bill
  const billMatch = text.match(/(?:Electricity|Current)\s*Bill\s*[:\.-]?\s*([P\p{Sc}]?\s*[\d,]+\.?\d*)/iu);
  if (billMatch) {
     data.electricityBill = billMatch[1].replace(/[^\d.]/g, '');
  }

  // 5. Amount Due fallback
  const dueMatch = text.match(/Amount\s*Due\s*[:\.-]?\s*([P\p{Sc}]?\s*[\d,]+\.?\d*)/iu);
  if (dueMatch) {
    data.amountDue = dueMatch[1].replace(/[^\d.]/g, '');
  }

  if (!data.electricityBill && data.amountDue) {
    data.electricityBill = data.amountDue;
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
  const captureContainerRef = useRef(null);
  const guideFrameRef = useRef(null);
  const userMenuRef = useRef(null);
  
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
  const [rotateView, setRotateView] = useState(0);
  const [facingMode, setFacingMode] = useState('environment');
  const [showCropper, setShowCropper] = useState(false);
  const [cropData, setCropData] = useState(null);
  const [editableVerifiedData, setEditableVerifiedData] = useState(null);
  const [scannerName, setScannerName] = useState(() => localStorage.getItem(SCANNER_NAME_STORAGE_KEY) || '');
  const [scannerNameInput, setScannerNameInput] = useState(() => localStorage.getItem(SCANNER_NAME_STORAGE_KEY) || '');
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [signatureData, setSignatureData] = useState(null);
  const workerRef = useRef(null);
  const hasScannerIdentity = Boolean(scannerName.trim());

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
    return () => {
      mounted = false;
      stopCamera();
      if (workerRef.current) workerRef.current.terminate();
    };
  }, []);

  useEffect(() => {
    if (!hasScannerIdentity || mode !== 'capture') {
      stopCamera();
      return;
    }

    let active = true;
    (async () => {
      stopCamera();
      if (!active) return;
      await startCamera();
    })();

    return () => {
      active = false;
      stopCamera();
    };
  }, [hasScannerIdentity, mode, facingMode]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setShowUserMenu(false);
      }
    };

    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showUserMenu]);

  const startCamera = async () => {
    try {
      setCameraError(null);
      const constraints = {
        video: {
          facingMode: { ideal: facingMode },
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
      const videoRect = video.getBoundingClientRect();
      const frameRect = guideFrameRef.current?.getBoundingClientRect();

      let sourceX;
      let sourceY;
      let sourceWidth;
      let sourceHeight;

      // Strict capture: map the guide frame (what user sees) to actual video pixels.
      if (frameRect && video.videoWidth && video.videoHeight && videoRect.width && videoRect.height) {
        const scale = Math.max(
          videoRect.width / video.videoWidth,
          videoRect.height / video.videoHeight
        );
        const renderedVideoWidth = video.videoWidth * scale;
        const renderedVideoHeight = video.videoHeight * scale;
        const renderOffsetX = (videoRect.width - renderedVideoWidth) / 2;
        const renderOffsetY = (videoRect.height - renderedVideoHeight) / 2;

        const frameLeftInVideo = frameRect.left - videoRect.left;
        const frameTopInVideo = frameRect.top - videoRect.top;
        const frameRightInVideo = frameLeftInVideo + frameRect.width;
        const frameBottomInVideo = frameTopInVideo + frameRect.height;

        const rawSourceLeft = (frameLeftInVideo - renderOffsetX) / scale;
        const rawSourceTop = (frameTopInVideo - renderOffsetY) / scale;
        const rawSourceRight = (frameRightInVideo - renderOffsetX) / scale;
        const rawSourceBottom = (frameBottomInVideo - renderOffsetY) / scale;

        const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
        const left = clamp(rawSourceLeft, 0, video.videoWidth);
        const top = clamp(rawSourceTop, 0, video.videoHeight);
        const right = clamp(rawSourceRight, 0, video.videoWidth);
        const bottom = clamp(rawSourceBottom, 0, video.videoHeight);

        sourceX = left;
        sourceY = top;
        sourceWidth = Math.max(1, right - left);
        sourceHeight = Math.max(1, bottom - top);
      } else {
        // Fallback to previous centered crop if frame bounds are unavailable.
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);

        const guideWidth = canvas.width * 0.96;
        const guideHeight = guideWidth / 0.58;
        const guideX = (canvas.width - guideWidth) / 2;
        const guideY = (canvas.height - guideHeight) / 2;

        sourceX = guideX;
        sourceY = guideY;
        sourceWidth = guideWidth;
        sourceHeight = guideHeight;
      }

      const croppedCanvas = document.createElement('canvas');
      croppedCanvas.width = Math.max(1, Math.round(sourceWidth));
      croppedCanvas.height = Math.max(1, Math.round(sourceHeight));
      const croppedCtx = croppedCanvas.getContext('2d');
      
      croppedCtx.drawImage(
        video,
        sourceX, sourceY, sourceWidth, sourceHeight,
        0, 0, croppedCanvas.width, croppedCanvas.height
      );
      
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

  const rotateLiveView = () => setRotateView(prev => (prev + 90) % 360);
  const toggleCamera = () => {
    setFacingMode(prev => prev === 'environment' ? 'user' : 'environment');
  };
  const handleCropImage = () => setShowCropper(true);
  const applyCrop = (croppedImageData) => {
    setCapturedImage(croppedImageData);
    setShowCropper(false);
    setCropData(null);
  };
  const cancelCrop = () => {
    setShowCropper(false);
    setCropData(null);
  };
  const openFilePicker = () => fileInputRef.current?.click();

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

  const processImage = async () => {
    if (!capturedImage || !workerRef.current) {
      showToast('❌ No image to process');
      return;
    }

    setMode('processing');
    setStatus('Analyzing...');
    setProgress(10);
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

          const processedCanvas = preprocessImage(canvas);
          setProgress(30);

          const { data: { text: t } } = await workerRef.current.recognize(processedCanvas);
          setProgress(70);

          setRawText(t);
          const parsed = parseOCRText(t);
          setParsedData(parsed);
          setEditableVerifiedData({
            transactionRef: parsed.transactionRef || '',
            date: formatDateForInput(parsed.date) || '',
            electricityBill: parsed.electricityBill || '',
            customerName: parsed.customerName || '',
            accountNumber: parsed.accountNumber || ''
          });

          const missingFields = [];
          if (!parsed.transactionRef) missingFields.push('Transaction Ref');
          if (!parsed.accountNumber) missingFields.push('Account Number');
          if (!parsed.customerName) missingFields.push('Customer Name');
          if (!parsed.electricityBill) missingFields.push('Electricity Bill');
          if (!parsed.date) missingFields.push('Date');

          if (missingFields.length > 0) {
            showToast(`⚠️ Review required: missing ${missingFields.join(', ')}`);
          }

          setModalType('success');

          setMode('preview');
          setStatus('Ready');
          setProgress(100);
        } catch (err) {
          console.error(err);
          setModalType('error');
          setErrorMessage('Processing failed internally');
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

  const handleSaveClick = () => {
    if (!editableVerifiedData) return;

    const countDigits = (str) => (str ? (str.match(/\d/g) || []).length : 0);
    const required = [
      { field: 'transactionRef', label: 'Transaction Reference' },
      { field: 'date', label: 'Date' },
      { field: 'customerName', label: 'Customer Name' },
      { field: 'accountNumber', label: 'Account Number' },
      { field: 'electricityBill', label: 'Amount (Bill)' }
    ];

    for (const item of required) {
      if (!editableVerifiedData[item.field] || editableVerifiedData[item.field].toString().trim() === '') {
        showToast(`❌ ${item.label} is required`);
        return;
      }
    }

    if (countDigits(editableVerifiedData.transactionRef) < 15) {
      showToast('❌ Transaction reference must have at least 15 digits');
      return;
    }

    if (!isFebruary2026(editableVerifiedData.date)) {
      showToast('❌ Only dates within February 2026 are allowed');
      return;
    }

    const amountValue = parseFloat(String(editableVerifiedData.electricityBill).replace(/,/g, '').trim());
    if (isNaN(amountValue) || amountValue < 10) {
      showToast('❌ Bill amount seems invalid');
      return;
    }

    // Show signature pad instead of directly saving
    setShowSignaturePad(true);
  };

  const handleSignatureConfirm = async (signature) => {
    setSignatureData(signature);
    setShowSignaturePad(false);
    await saveToDatabase(signature);
  };

  const handleSignatureCancel = () => {
    setShowSignaturePad(false);
  };

  const saveToDatabase = async (signature = null) => {
    if (!editableVerifiedData) return;

    setStatus('Saving...');
    try {
      const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

      try {
        const checkRes = await fetch(`${API_BASE}/api/check-transaction/${editableVerifiedData.transactionRef}`);
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          if (checkData.exists) {
            showToast('❌ Transaction reference already exists in database');
            setStatus('Ready');
            return;
          }
        }
      } catch (err) {
        console.warn('Duplicate check skipped:', err);
      }

      const dataToSave = {
        transactionRef: editableVerifiedData.transactionRef.trim(),
        date: editableVerifiedData.date,
        electricityBill: String(editableVerifiedData.electricityBill).replace(/,/g, '').trim(),
        customerName: editableVerifiedData.customerName.trim(),
        accountNumber: editableVerifiedData.accountNumber.trim(),
        scannerName: scannerName.trim(),
        signature: signature || signatureData || null
      };

      const res = await fetch(`${API_BASE}/api/ocr-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataToSave)
      });
      if (res.ok) {
        showToast('✅ Saved successfully');
        setModalType(null);
        setEditableVerifiedData(null);
        setSignatureData(null);
        resetCapture();
      } else {
        showToast(`❌ Failed to save: ${res.status}`);
      }
    } catch (err) {
      showToast('❌ Network error');
    }
    setStatus('Ready');
  };

  const resetCapture = () => {
    setCapturedImage(null);
    setParsedData(null);
    setEditableVerifiedData(null);
    setRawText('');
    setModalType(null);
    setSignatureData(null);
    setShowSignaturePad(false);
    setMode('capture');
  };

  const handleScannerNameSubmit = (event) => {
    event.preventDefault();
    const normalized = scannerNameInput.trim();
    if (!normalized) {
      showToast('❌ Please enter your name');
      return;
    }

    localStorage.setItem(SCANNER_NAME_STORAGE_KEY, normalized);
    setScannerName(normalized);
    setShowUserMenu(false);
    resetCapture();
  };

  const handleQuitScanner = () => {
    localStorage.removeItem(SCANNER_NAME_STORAGE_KEY);
    setScannerName('');
    setScannerNameInput('');
    setShowUserMenu(false);
    setShowCropper(false);
    setModalType(null);
    setCapturedImage(null);
    setParsedData(null);
    setEditableVerifiedData(null);
    setRawText('');
    setMode('capture');
    stopCamera();
  };

  const handleVerifiedFieldChange = (field, value) => {
    // Restrict transactionRef to numbers only
    if (field === 'transactionRef') {
      value = value.replace(/[^\d]/g, '');
    }
    // Restrict electricityBill to numbers and decimal point only
    if (field === 'electricityBill') {
      // Allow numbers and one decimal point
      value = value.replace(/[^\d.]/g, '');
      // Ensure only one decimal point
      const parts = value.split('.');
      if (parts.length > 2) {
        value = parts[0] + '.' + parts.slice(1).join('');
      }
    }
    
    setEditableVerifiedData((prev) => ({
      ...(prev || {}),
      [field]: value
    }));
  };

  const autoResizeTextarea = (event) => {
    const el = event.target;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(() => {
    if (modalType !== 'success') return;
    const textareas = document.querySelectorAll('.data-item textarea.value');
    textareas.forEach((el) => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    });
  }, [modalType, editableVerifiedData]);

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
      <div className="toolbar toolbar-top">
        <h1>Aneco Foundation</h1>
        {hasScannerIdentity && (
          <div className="scanner-user-menu" ref={userMenuRef}>
            <button
              type="button"
              className="scanner-menu-btn"
              onClick={() => setShowUserMenu((prev) => !prev)}
              aria-label="Scanner options"
            >
              ☰
            </button>
            {showUserMenu && (
              <div className="scanner-user-dropdown">
                <div className="scanner-user-name">Scanner: {scannerName}</div>
                <button type="button" className="scanner-quit-btn" onClick={handleQuitScanner}>
                  Quit
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {!hasScannerIdentity ? (
        <div className="scanner-name-gate">
          <form className="scanner-name-card" onSubmit={handleScannerNameSubmit}>
            <h2>Scanner Setup</h2>
            <p>Enter your name before scanning. This browser will remember it.</p>
            <input
              type="text"
              value={scannerNameInput}
              onChange={(e) => setScannerNameInput(e.target.value)}
              placeholder="Enter your full name"
              className="scanner-name-input"
              autoFocus
            />
            <button type="submit" className="scanner-name-btn">
              Continue to Scanner
            </button>
          </form>
        </div>
      ) : (
        <>
      {mode === 'capture' && (
        // LIGHTER THEME: Added light-mode class and inline background styles
        <div ref={captureContainerRef} className="capture-container light-mode" style={{ background: '#f0f2f5' }}>
          {cameraError ? (
            <div className="error-state" style={{ color: '#333' }}>
              <p className="error-text">{cameraError}</p>
              <button className="btn-retry" onClick={startCamera}>🔄 Retry Camera</button>
              <button className="btn-file" onClick={() => fileInputRef.current?.click()}>📁 Choose File</button>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} style={{ display: 'none' }} />
            </div>
          ) : (
            <>
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted 
                className="camera-feed" 
                style={{ 
                  transform: `rotate(${rotateView}deg) ${facingMode === 'user' ? 'scaleX(-1)' : ''}`,
                  background: '#f0f2f5' // Light background for video area
                }} 
              />
              {/* DOCUMENT OVERLAY: Lighter style */}
              <div className="document-overlay" style={{ background: 'rgba(255,255,255,0.1)' }}>
                 {/* Explicitly override the dark pseudo-element mask from CSS */}
                <style>{`
                  .document-overlay::after { background: radial-gradient(ellipse at center, transparent 0%, rgba(255, 255, 255, 0.5) 100%) !important; }
                  .instruction-text { background: rgba(255, 255, 255, 0.8) !important; color: #333 !important; border: 1px solid #ccc !important; }
                  .hint-text { background: rgba(255, 255, 255, 0.6) !important; color: #555 !important; }
                  .document-frame { border-color: #ffffff !important; background: rgba(37, 99, 235, 0.05) !important; box-shadow: 0 0 0 1000px rgba(255,255,255,0.6) !important; }
                `}</style>
                <div ref={guideFrameRef} className="document-frame">
                  <div className="corner corner-tl" style={{ borderColor: '#2563eb' }}></div>
                  <div className="corner corner-tr" style={{ borderColor: '#2563eb' }}></div>
                  <div className="corner corner-bl" style={{ borderColor: '#2563eb' }}></div>
                  <div className="corner corner-br" style={{ borderColor: '#2563eb' }}></div>
                </div>
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
              <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }}></div></div>
            </div>
          )}
          <img src={capturedImage} alt="Document" className="preview-image" />
          {mode === 'preview' && (
            <button className="btn-circle btn-rotate-preview" onClick={rotateCapturedPreview} title="Rotate">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5L3 7L5 9M15 5L17 7L15 9M15 15L17 17L15 19M5 15L3 17L5 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M10 2C6 2 3 5 3 9M10 18C14 18 17 15 17 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          )}
        </div>
      )}

      {modalType === 'success' && editableVerifiedData && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header success-header">✅ Document Verified</div>
            <div className="modal-body">
              <div className="data-grid">
                <div className="data-item">
                  <span className="label">Ref:</span>
                  <textarea
                    className="value"
                    value={editableVerifiedData.transactionRef || ''}
                    rows={1}
                    onChange={(e) => {
                      handleVerifiedFieldChange('transactionRef', e.target.value);
                      autoResizeTextarea(e);
                    }}
                    onInput={autoResizeTextarea}
                    placeholder="Enter transaction reference"
                  />
                </div>
                <div className="data-item">
                  <span className="label">Date:</span>
                  <input
                    type="date"
                    className="value"
                    value={editableVerifiedData.date || ''}
                    onChange={(e) => handleVerifiedFieldChange('date', e.target.value)}
                  />
                </div>
                <div className="data-item">
                  <span className="label">Amount:</span>
                  <textarea
                    className="value"
                    value={editableVerifiedData.electricityBill || ''}
                    rows={1}
                    onChange={(e) => {
                      handleVerifiedFieldChange('electricityBill', e.target.value);
                      autoResizeTextarea(e);
                    }}
                    onInput={autoResizeTextarea}
                    placeholder="Enter bill amount"
                  />
                </div>
                <div className="data-item">
                  <span className="label">Name:</span>
                  <textarea
                    className="value"
                    value={editableVerifiedData.customerName || ''}
                    rows={1}
                    onChange={(e) => {
                      handleVerifiedFieldChange('customerName', e.target.value);
                      autoResizeTextarea(e);
                    }}
                    onInput={autoResizeTextarea}
                    placeholder="Enter customer name"
                  />
                </div>
                <div className="data-item">
                  <span className="label">Account Number:</span>
                  <textarea
                    className="value"
                    value={editableVerifiedData.accountNumber || ''}
                    rows={1}
                    onChange={(e) => {
                      handleVerifiedFieldChange('accountNumber', e.target.value);
                      autoResizeTextarea(e);
                    }}
                    onInput={autoResizeTextarea}
                    placeholder="Enter account number"
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={resetCapture}>Cancel</button>
              <button className="btn-primary" onClick={handleSaveClick}>Save ✓</button>
            </div>
          </div>
        </div>
      )}

      {modalType === 'error' && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header error-header">❌ Validation Failed</div>
            <div className="modal-body"><p className="error-message">{errorMessage}</p></div>
            <div className="modal-footer"><button className="btn-primary" onClick={resetCapture}>Retry</button></div>
          </div>
        </div>
      )}

      {modalType === 'duplicate' && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header duplicate-header">🔴 Duplicate Found</div>
            <div className="modal-body"><p className="error-message">{errorMessage}</p></div>
            <div className="modal-footer"><button className="btn-primary" onClick={resetCapture}>Scan New</button></div>
          </div>
        </div>
      )}

      <div className="toolbar toolbar-bottom">
        {mode === 'capture' && (
          <div className="bottom-actions">
            <button className="btn-circle btn-upload" onClick={openFilePicker}><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="6" y="5" width="8" height="11" stroke="currentColor" strokeWidth="1.5" fill="none" rx="1"/><path d="M8 8h4M8 11h4M8 14h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button>
            <button className="btn-circle btn-rotate" onClick={rotateLiveView}><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5L3 7L5 9M15 5L17 7L15 9M15 15L17 17L15 19M5 15L3 17L5 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M10 2C6 2 3 5 3 9M10 18C14 18 17 15 17 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button>
            <button className="btn-circle btn-confirm" onClick={captureFrame} disabled={!cameraActive}><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" fill="none"/><circle cx="12" cy="12" r="5" fill="currentColor"/></svg></button>
            <button className="btn-circle btn-flip" onClick={toggleCamera}><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 7C3 5.34315 4.34315 4 6 4H14C15.6569 4 17 5.34315 17 7V13C17 14.6569 15.6569 16 14 16H6C4.34315 16 3 14.6569 3 13V7Z" stroke="currentColor" strokeWidth="1.5"/><circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M13 7.5L15 7.5M13 12.5L15 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} style={{ display: 'none' }} />
          </div>
        )}
        {mode === 'preview' && (
          <div className="preview-actions"><div className="preview-buttons"><button className="btn-secondary" onClick={resetCapture}>Retake</button><button className="btn-secondary" onClick={handleCropImage}>Crop</button><button className="btn-primary" onClick={processImage}>Process Document</button></div></div>
        )}
      </div>
      </>
      )}

      {showCropper && capturedImage && (
        <div className="modal-overlay">
          <div className="modal-card cropper-modal">
            <div className="modal-header">✂️ Crop Image</div>
            <div className="modal-body cropper-body">
              <ImageCropper image={capturedImage} onCropComplete={applyCrop} onCancel={cancelCrop} />
            </div>
          </div>
        </div>
      )}

      {showSignaturePad && (
        <SignaturePad 
          onConfirm={handleSignatureConfirm} 
          onCancel={handleSignatureCancel} 
        />
      )}

      {toast && <div className="toast">{toast}</div>}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
}

export default OCRLanding;