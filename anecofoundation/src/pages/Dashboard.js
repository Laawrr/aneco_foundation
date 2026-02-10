import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './Dashboard.css';

export default function Dashboard() {
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  // Table rows are fully dynamic; start empty and fill from the API.
  // Each row may have an 'id' when it exists in the database.
  const [tableData, setTableData] = useState([]);
  // Track ids that should be deleted when saving.
  const [deletedIds, setDeletedIds] = useState([]);
  const navigate = useNavigate();
  const tableRef = useRef(null);
  const exportMenuRef = useRef(null);
  const pdfRef = useRef(null);

  // Redirect to login if not authenticated
  useEffect(() => {
    const authed = localStorage.getItem('adminAuthed') === 'true';
    if (!authed) {
      localStorage.removeItem('adminAuthed');
      navigate('/login');
    }
  }, [navigate]);

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

  // Fetch data for the dashboard table
  const fetchDashboardData = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/ocr-data?limit=100');
      const json = await res.json();

      if (!json || json.ok === false || !Array.isArray(json.data)) {
        console.warn('Unexpected /api/ocr-data response shape', json);
        return;
      }

      const rows = json.data;

      const mapped = rows.map((row) => ({
        id: row.id,
        accountNumber: row.accountNumber || '',
        accountName: row.customerName || '',
        referenceNo: row.transactionRef || '',
        // Show electricity_bill in the AMOUNT column
        amount:
          row.electricityBill !== null && row.electricityBill !== undefined
            ? String(row.electricityBill)
            : '',
      }));

      setTableData(mapped);
      setDeletedIds([]);
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
    }
  };

  useEffect(() => {
    // Initial load
    fetchDashboardData();

    // Poll in the background to keep table up to date
    const intervalId = setInterval(() => {
      // Don't override user edits while in edit mode
      if (!isEditMode) {
        fetchDashboardData();
      }
    }, 5000); // 5 seconds

    return () => clearInterval(intervalId);
  }, [isEditMode]);

  const handleCellChange = (rowIndex, columnKey, value) => {
    const newData = [...tableData];
    newData[rowIndex][columnKey] = value;
    setTableData(newData);
  };

  const handleSave = async () => {
    try {
      // Delete rows that were removed in the UI
      await Promise.all(
        deletedIds.map((id) =>
          fetch(`http://localhost:3001/api/ocr-data/${id}`, {
            method: 'DELETE',
          })
        )
      );

      // Separate rows that need to be created vs updated
      const rowsToCreate = tableData.filter(
        (row) =>
          !row.id &&
          (row.accountNumber || row.accountName || row.referenceNo || row.amount)
      );

      const rowsToUpdate = tableData.filter((row) => row.id);

      // Create new rows
      await Promise.all(
        rowsToCreate.map((row) =>
          fetch('http://localhost:3001/api/ocr-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              transactionRef: row.referenceNo || null,
              accountNumber: row.accountNumber || null,
              customerName: row.accountName || null,
              company: null,
              date: null,
              electricityBill: row.amount || null,
              amountDue: null,
              totalSales: null,
            }),
          })
        )
      );

      // Update existing rows
      await Promise.all(
        rowsToUpdate.map((row) =>
          fetch(`http://localhost:3001/api/ocr-data/${row.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              transactionRef: row.referenceNo || null,
              accountNumber: row.accountNumber || null,
              customerName: row.accountName || null,
              company: null,
              date: null,
              electricityBill: row.amount || null,
              amountDue: null,
              totalSales: null,
            }),
          })
        )
      );

      // Refresh data from server so ids/ordering are correct
      await fetchDashboardData();
      setIsEditMode(false);
    } catch (err) {
      console.error('Failed to save dashboard changes:', err);
      // Stay in edit mode if save failed
    }
  };

  const handleCancel = () => {
    // Just leave the current data as-is and exit edit mode
    setIsEditMode(false);
  };

  const addRow = () => {
    setTableData((prev) => [
      ...prev,
      { id: null, accountNumber: '', accountName: '', referenceNo: '', amount: '' },
    ]);
  };

  const deleteRow = (rowIndex) => {
    setTableData((prev) => {
      const row = prev[rowIndex];
      if (row && row.id) {
        setDeletedIds((ids) => [...ids, row.id]);
      }
      return prev.filter((_, index) => index !== rowIndex);
    });
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
        <Link
          to="/login"
          className="logout-btn"
          onClick={() => {
            localStorage.removeItem('adminAuthed');
          }}
        >
          Logout
        </Link>
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
                      {index + 1}
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
