import React, { useEffect, useRef, useState } from 'react';
import './OCRLanding.css';
import { createWorker } from 'tesseract.js';

function OCRLanding() {
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [text, setText] = useState('');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Idle');
  const workerRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setStatus('Loading OCR worker...');
      const worker = createWorker({
        logger: m => {
          if (!mounted) return;
          if (m.status === 'recognizing text' && typeof m.progress === 'number') {
            setProgress(Math.round(m.progress * 100));
            setStatus('Recognizing text');
          }
        }
      });
      await worker.load();
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
    try {
      const { data: { text: t } } = await workerRef.current.recognize(image);
      setText(t);
      setStatus('Done');
      setProgress(100);
    } catch (err) {
      setStatus('Error');
      setText(String(err));
    }
  };

  return (
    <div className="ocr-landing">
      <div className="ocr-panel">
        <h1>OCR Landing Page</h1>
        <p className="subtitle">Upload an image and extract text client-side powered by <strong>Tesseract.js</strong>.</p>

        <div className="controls">
          <input id="fileInput" type="file" accept="image/*" onChange={handleFile} />
          <button onClick={doOCR} className="btn" disabled={!image || status === 'Loading OCR worker...'}>Run OCR</button>
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

        <div className="result">
          <h2>Extracted Text</h2>
          <textarea readOnly value={text} />
        </div>

        <div className="notes">
          <p>Tip: For better results, use clear images and crop tightly around the text.</p>
        </div>
      </div>
    </div>
  );
}

export default OCRLanding;
