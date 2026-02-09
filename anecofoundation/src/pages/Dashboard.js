import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import './Dashboard.css';

export default function Dashboard() {
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [tableData, setTableData] = useState(
    Array(7)
      .fill(null)
      .map(() => ({
        no: '',
        accountNumber: '',
        accountName: '',
        referenceNo: '',
        amount: '',
      }))
  );
  const tableRef = useRef(null);
  const exportMenuRef = useRef(null);
  const pdfRef = useRef(null);

  // Close export menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target)) {
        setShowExportMenu(false);
      }
    };

    if (showExportMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showExportMenu]);

  const handleCellChange = (rowIndex, columnKey, value) => {
    const newData = [...tableData];
    newData[rowIndex][columnKey] = value;
    setTableData(newData);
  };

  const handleSave = () => {
    setIsEditMode(false);
  };

  const handleCancel = () => {
    setIsEditMode(false);
    setTableData(Array(7).fill(null).map(() => ({ no: '', accountNumber: '', accountName: '', referenceNo: '', amount: '' })));
  };

  const addRow = () => {
    setTableData((prev) => [
      ...prev,
      { no: '', accountNumber: '', accountName: '', referenceNo: '', amount: '' },
    ]);
  };

  const deleteRow = (rowIndex) => {
    setTableData((prev) => prev.filter((_, index) => index !== rowIndex));
  };

  const exportToExcel = () => {
    try {
      const XLSX = require('xlsx');
      const table = tableRef.current;
      const workbook = XLSX.utils.table_to_book(table);
      XLSX.writeFile(workbook, 'dashboard_export.xlsx');
      setShowExportMenu(false);
    } catch (error) {
      alert('Please install xlsx package: npm install xlsx');
    }
  };

  const exportToPDF = () => {
    try {
      const html2pdf = require('html2pdf.js');
      const content = pdfRef.current;

      if (!content) return;

      const options = {
        margin: [15, 15, 15, 15],
        filename: 'dashboard_export.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' },
      };

      html2pdf().set(options).from(content).save();
      setShowExportMenu(false);
    } catch (error) {
      alert('Please install html2pdf package: npm install html2pdf.js');
    }
  };

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <Link to="/login" className="logout-btn">Logout</Link>
      </header>
    
      <main className="dashboard-main">
        <div className="dashboard-card">
          <div className="card-header">
            <h1></h1>
            <div className="button-group">
              {!isEditMode ? (
                <button className="btn-edit" onClick={() => setIsEditMode(true)}>Edit</button>
              ) : (
                <div className="edit-buttons-group">
                  <button className="btn-save" onClick={handleSave}>Save</button>
                  <button className="btn-cancel" onClick={handleCancel}>Cancel</button>
                </div>
              )}
              {!isEditMode && (
                <div className="export-container" ref={exportMenuRef}>
                  <button 
                    className="btn-export" 
                    onClick={() => setShowExportMenu(!showExportMenu)}
                  >
                    Export
                  </button>
                  {showExportMenu && (
                    <div className="export-menu">
                      <button onClick={exportToExcel} className="export-option">📊 Export as Excel</button>
                      <button onClick={exportToPDF} className="export-option">📄 Export as PDF</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* PDF + Visible Content Wrapper */}
          <div ref={pdfRef} className="pdf-content-wrapper">
            <div className="pdf-header">
              <div className="pdf-logo-section">
                <div className="pdf-logo-circle">
                  <img
                    src="/aneco2.png"
                    alt="ANECO logo"
                    className="pdf-logo-img"
                  />
                </div>
              </div>
              <div className="pdf-header-center">
                <div className="pdf-company-name">AGUSAN DEL NORTE ELECTRIC COOPERATIVE, INC.</div>
                <div className="pdf-company-address">Km. 2, J.C. Aquino Avenue, Butuan City</div>
                <div className="pdf-event-title">GIVING OF GROCERY ITEMS TO MEMBER-CONSUMERS</div>
                <div className="pdf-event-detail">DURING 49TH ANNIVERSARY 2026</div>
              </div>
              <div className="pdf-date">
                {new Date()
                  .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
                  .replace(/\s/g, '-')}
              </div>
            </div>

            <table className="dashboard-table" ref={tableRef}>
              <thead>
                <tr>
                  <th>NO.</th>
                  <th>ACCOUNT NUMBER</th>
                  <th>ACCOUNT NAME</th>
                  <th>REFERENCE NO.</th>
                  <th>AMOUNT</th>
                  {isEditMode && <th style={{ width: '60px' }}></th>}
                </tr>
              </thead>
              <tbody>
                {tableData.map((row, index) => (
                  <tr key={index}>
                    <td>
                      {isEditMode ? (
                        <input
                          type="text"
                          value={row.no}
                          onChange={(e) => handleCellChange(index, 'no', e.target.value)}
                          className="cell-input"
                        />
                      ) : (
                        row.no
                      )}
                    </td>
                    <td>
                      {isEditMode ? (
                        <input
                          type="text"
                          value={row.accountNumber}
                          onChange={(e) => handleCellChange(index, 'accountNumber', e.target.value)}
                          className="cell-input"
                        />
                      ) : (
                        row.accountNumber
                      )}
                    </td>
                    <td>
                      {isEditMode ? (
                        <input
                          type="text"
                          value={row.accountName}
                          onChange={(e) => handleCellChange(index, 'accountName', e.target.value)}
                          className="cell-input"
                        />
                      ) : (
                        row.accountName
                      )}
                    </td>
                    <td>
                      {isEditMode ? (
                        <input
                          type="text"
                          value={row.referenceNo}
                          onChange={(e) => handleCellChange(index, 'referenceNo', e.target.value)}
                          className="cell-input"
                        />
                      ) : (
                        row.referenceNo
                      )}
                    </td>
                    <td>
                      {isEditMode ? (
                        <input
                          type="text"
                          value={row.amount}
                          onChange={(e) => handleCellChange(index, 'amount', e.target.value)}
                          className="cell-input"
                        />
                      ) : (
                        row.amount
                      )}
                    </td>
                    {isEditMode && (
                      <td>
                        <button
                          type="button"
                          className="row-delete-btn"
                          onClick={() => deleteRow(index)}
                        >
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            {isEditMode && (
              <div className="table-actions">
                <button type="button" className="row-add-btn" onClick={addRow}>
                  + Add Row
                </button>
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="dashboard-footer">
        Copyright © 2016 ANECO, INC.
      </footer>
    </div>
  );
}
