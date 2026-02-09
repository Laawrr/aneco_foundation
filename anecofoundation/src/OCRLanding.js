import React, { useEffect, useRef, useState } from 'react';
import './OCRLanding.css';
import { createWorker } from 'tesseract.js';

// Parser function to extract structured data from OCR text
const parseOCRText = (text) => {
  const data = {};
  
  // Extract Transaction Ref
  const transactionMatch = text.match(/Transaction\s*Ref\s*[:\-]?\s*(\d+)/i);
  if (transactionMatch) data.transactionRef = transactionMatch[1].trim();

  // Extract Account Number - look for pattern "B" followed by digits, then "/" and customer name
  const accountMatch = text.match(/(B\d+)\s*\/\s*([A-Z,\s]+?)(?:\n|$)/i);
  if (accountMatch) {
    data.accountNumber = accountMatch[1].trim();
    data.customerName = accountMatch[2].trim();
  } else {
    // Fallback: try to find just the account number
    const accountOnly = text.match(/\b(B\d{12,})\b/i);
    if (accountOnly) data.accountNumber = accountOnly[1].trim();
  }

  // Extract Date (look for "Date:" followed by a date pattern)
  const dateMatch = text.match(/Date\s*[:\-]?\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i);
  if (dateMatch) {
    data.date = `${dateMatch[1]} ${dateMatch[2]}, ${dateMatch[3]}`;
  } else {
    // Alternative date format MM/DD/YYYY
    const dateMatch2 = text.match(/Date\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (dateMatch2) data.date = dateMatch2[1];
  }

  // Extract Electricity Bill Amount (main charge)
  const electricityMatch = text.match(/Electricity\s*Bill\s*[:\-]?\s*([\d,]+\.?\d*)/i);
  if (electricityMatch) data.electricityBill = electricityMatch[1].trim();

  // Extract Total Amount Due
  const totalMatch = text.match(/Amount\s*Due\s*[:\-]?\s*([\d,]+\.?\d*)/i);
  if (totalMatch) data.amountDue = totalMatch[1].trim();

  // Extract Total Sales
  const salesMatch = text.match(/Total\s*Sales\s*[:\-]?\s*([\d,]+\.?\d*)/i);
  if (salesMatch) data.totalSales = salesMatch[1].trim();

  // Extract company name (clean version without OCR noise)
  const companyMatch = text.match(/AGUSAN\s+DEL\s+NORTE\s+ELECTRIC\s+COOPERATIVE,?\s*INC\.?/i);
  if (companyMatch) {
    data.company = companyMatch[0].trim();
  } else {
    // Fallback pattern
    const companyMatch2 = text.match(/([A-Z][A-Z\s&]+ELECTRIC[A-Z\s,]+INC)/i);
    if (companyMatch2) data.company = companyMatch2[1].trim();
  }

  return data;
};

function OCRLanding() {
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [text, setText] = useState('');
  const [parsedData, setParsedData] = useState(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Idle');
  const [saveStatus, setSaveStatus] = useState('');
  const [showWarning, setShowWarning] = useState(false);
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
  const workerRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setStatus('Loading OCR worker...');
      const worker = await createWorker({
        logger: m => {
          if (!mounted) return;
          if (m.status === 'recognizing text' && typeof m.progress === 'number') {
            setProgress(Math.round(m.progress * 100));
            setStatus('Recognizing text');
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
    })();
    return () => { mounted = false; if (workerRef.current) workerRef.current.terminate(); };
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
          console.error('Error checking transaction:', err);
        }
      }
      
      setStatus('Done');
      setProgress(100);
    } catch (err) {
      setStatus('Error');
      setText(String(err));
    }
  };

  const saveToDatabase = async () => {
    if (!parsedData) {
      setSaveStatus('No data to save');
      return;
    }
    setSaveStatus('Saving...');
    try {
      const res = await fetch('http://localhost:3001/api/ocr-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsedData)
      });
      if (res.ok) {
        setSaveStatus('✅ Data saved to database');
      } else {
        setSaveStatus('❌ Failed to save');
      }
    } catch (err) {
      setSaveStatus('❌ Error: ' + String(err));
    }
  };

  return (
    <div className="ocr-landing">
      <div className="ocr-panel">
        <h1>OCR Data Extractor</h1>
        <p className="subtitle">Upload invoice or account images to extract structured data like account number, account name, and more.</p>

        <div className="controls">
          <input id="fileInput" type="file" accept="image/*" onChange={handleFile} />
          <button onClick={doOCR} className="btn" disabled={!image || status === 'Loading OCR worker...'}>Run OCR & Parse</button>
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
              <div className="modal-body">
                <p>The electricity bill amount is less than ₱50.</p>
                <p>Please verify the extracted data is correct before saving.</p>
                {parsedData && parsedData.electricityBill && (
                  <p className="amount-highlight">Detected Amount: <strong>₱{parsedData.electricityBill}</strong></p>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn" onClick={() => setShowWarning(false)}>OK, I Understand</button>
              </div>
            </div>
          </div>
        )}

        {/* Duplicate Transaction Warning Modal */}
        {showDuplicateWarning && (
          <div className="modal-overlay" onClick={() => setShowDuplicateWarning(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>🔴 Duplicate Transaction Detected</h2>
                <button className="modal-close" onClick={() => setShowDuplicateWarning(false)}>&times;</button>
              </div>
              <div className="modal-body">
                <p>This transaction reference number already exists in the database.</p>
                {parsedData && parsedData.transactionRef && (
                  <p className="duplicate-highlight">Transaction Ref: <strong>{parsedData.transactionRef}</strong></p>
                )}
                <p>⚠️ Saving this record will create a duplicate entry. Please verify if this is intentional.</p>
              </div>
              <div className="modal-footer">
                <button className="btn" onClick={() => setShowDuplicateWarning(false)}>OK, I Understand</button>
              </div>
            </div>
          </div>
        )}

        {/* Parsed Data Table */}
        {parsedData && Object.keys(parsedData).length > 0 && (
          <div className="result">
            <h2>Extracted Data</h2>
            <table className="data-table">
              <tbody>
                {Object.entries(parsedData).map(([key, value]) => (
                  <tr key={key}>
                    <td className="field-label">{formatFieldName(key)}</td>
                    <td className="field-value">{value || 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={saveToDatabase} className="btn btn-save">Save to Database</button>
            {saveStatus && <p className="save-status">{saveStatus}</p>}
          </div>
        )}

        {/* Raw Extracted Text */}
        <div className="result">
          <h2>Raw Extracted Text</h2>
          <textarea readOnly value={text} />
        </div>

        <div className="notes">
          <p>✨ Tip: For best results, upload clear images with good contrast. The system automatically extracts fields like Account Number, Account Name, Date, and Amount.</p>
        </div>
      </div>
    </div>
  );
}

const formatFieldName = (key) => {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();
};

export default OCRLanding;
