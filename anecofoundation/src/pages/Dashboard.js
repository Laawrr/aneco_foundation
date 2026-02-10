import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import './Dashboard.css';

export default function Dashboard() {
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showMobileExportSubmenu, setShowMobileExportSubmenu] = useState(false);
  // Table rows are fully dynamic; start empty and fill from the API.
  // Each row may have an 'id' when it exists in the database.
  const [tableData, setTableData] = useState([]);
  // Track ids that should be deleted when saving.
  const [deletedIds, setDeletedIds] = useState([]);
  // Track authentication status to prevent flash of content
  const [isAuthenticated, setIsAuthenticated] = useState(null);
  // Search/filter query
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();
  const tableRef = useRef(null);
  const exportMenuRef = useRef(null);
  const mobileMenuRef = useRef(null);
  const pdfRef = useRef(null);

  // Check authentication immediately and redirect if not authenticated
  useEffect(() => {
    const authed = localStorage.getItem('adminAuthed') === 'true';
    if (!authed) {
      localStorage.removeItem('adminAuthed');
      navigate('/login', { replace: true });
      return;
    }
    setIsAuthenticated(true);
  }, [navigate]);

  // Close export menu and mobile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target)) {
        setShowExportMenu(false);
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target)) {
        setShowMobileMenu(false);
      }
    };

    if (showExportMenu || showMobileMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showExportMenu, showMobileMenu]);

  // Auto-close export submenu when mobile menu closes
  useEffect(() => {
    if (!showMobileMenu) {
      setShowMobileExportSubmenu(false);
    }
  }, [showMobileMenu]);

  // Fetch data for the dashboard table
  const fetchDashboardData = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/ocr-data?limit=100`);
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
    // Only fetch data if authenticated
    if (!isAuthenticated) return;

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
  }, [isEditMode, isAuthenticated]);

  const handleCellChange = (rowToUpdate, columnKey, value) => {
    setTableData((prev) => {
      const newData = [...prev];
      // Find the original index of the row
      const originalIndex = newData.findIndex((row) => {
        // Match by id if available, otherwise match by all fields
        if (rowToUpdate.id && row.id) {
          return row.id === rowToUpdate.id;
        }
        return (
          row.accountNumber === rowToUpdate.accountNumber &&
          row.accountName === rowToUpdate.accountName &&
          row.referenceNo === rowToUpdate.referenceNo &&
          row.amount === rowToUpdate.amount
        );
      });
      
      if (originalIndex !== -1) {
        newData[originalIndex][columnKey] = value;
      }
      return newData;
    });
  };

  const handleSave = async () => {
    try {
      // Delete rows that were removed in the UI
      await Promise.all(
        deletedIds.map((id) =>
          fetch(`${API_BASE_URL}/api/ocr-data/${id}`, {
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
          fetch(`${API_BASE_URL}/api/ocr-data`, {
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
          fetch(`${API_BASE_URL}/api/ocr-data/${row.id}`, {
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

  const deleteRow = (rowToDelete) => {
    setTableData((prev) => {
      // Find the original index of the row
      const originalIndex = prev.findIndex((row) => {
        // Match by id if available, otherwise match by all fields
        if (rowToDelete.id && row.id) {
          return row.id === rowToDelete.id;
        }
        return (
          row.accountNumber === rowToDelete.accountNumber &&
          row.accountName === rowToDelete.accountName &&
          row.referenceNo === rowToDelete.referenceNo &&
          row.amount === rowToDelete.amount
        );
      });
      
      if (originalIndex === -1) return prev;
      
      const row = prev[originalIndex];
      if (row && row.id) {
        setDeletedIds((ids) => [...ids, row.id]);
      }
      return prev.filter((_, index) => index !== originalIndex);
    });
  };

  // Filter table data based on search query
  const filteredTableData = tableData.filter((row) => {
    if (!searchQuery.trim()) return true;
    
    const query = searchQuery.toLowerCase().trim();
    const accountNumber = (row.accountNumber || '').toLowerCase();
    const accountName = (row.accountName || '').toLowerCase();
    const referenceNo = (row.referenceNo || '').toLowerCase();
    const amount = (row.amount || '').toLowerCase();
    
    return (
      accountNumber.includes(query) ||
      accountName.includes(query) ||
      referenceNo.includes(query) ||
      amount.includes(query)
    );
  });

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

      // Hide search container before export
      const searchContainer = content.querySelector('.no-export');
      if (searchContainer) {
        searchContainer.style.display = 'none';
      }

      const options = {
        margin: [15, 15, 15, 15],
        filename: 'dashboard_export.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' },
      };

      html2pdf().set(options).from(content).save().then(() => {
        // Restore search container visibility after export
        if (searchContainer) {
          searchContainer.style.display = 'block';
        }
      });
      setShowExportMenu(false);
    } catch (error) {
      alert('Please install html2pdf package: npm install html2pdf.js');
    }
  };

  // Don't render anything until authentication is verified
  // This prevents flash of content before redirect
  if (isAuthenticated === null) {
    return null;
  }

  // If not authenticated, return null (redirect will happen)
  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        {/* Desktop Logout Button */}
        <Link
          to="/login"
          className="logout-btn desktop-logout"
          onClick={() => {
            localStorage.removeItem('adminAuthed');
          }}
        >
          Logout
        </Link>

        {/* Mobile Hamburger Menu */}
        <div className="mobile-menu-container" ref={mobileMenuRef}>
          <button
            className="mobile-menu-btn"
            onClick={() => setShowMobileMenu(!showMobileMenu)}
            aria-label="Menu"
          >
            <span className="burger-line"></span>
            <span className="burger-line"></span>
            <span className="burger-line"></span>
          </button>
          {showMobileMenu && (
            <div className="mobile-menu-dropdown">
              {!isEditMode ? (
                <>
                  <button
                    className="mobile-menu-item mobile-menu-button"
                    onClick={() => {
                      setIsEditMode(true);
                      setShowMobileMenu(false);
                    }}
                  >
                    Edit
                  </button>
                  <div className="mobile-menu-divider"></div>
                  <button
                    className="mobile-menu-item mobile-menu-button"
                    onClick={() => {
                      setShowMobileExportSubmenu(!showMobileExportSubmenu);
                    }}
                  >
                    Export {showMobileExportSubmenu ? '▼' : '▶'}
                  </button>
                  {showMobileExportSubmenu && (
                    <div className="mobile-export-submenu">
                      <button
                        className="mobile-menu-item mobile-menu-button"
                        onClick={() => {
                          exportToExcel();
                          setShowMobileExportSubmenu(false);
                          setShowMobileMenu(false);
                        }}
                      >
                        📊 Export as Excel
                      </button>
                      <button
                        className="mobile-menu-item mobile-menu-button"
                        onClick={() => {
                          exportToPDF();
                          setShowMobileExportSubmenu(false);
                          setShowMobileMenu(false);
                        }}
                      >
                        📄 Export as PDF
                      </button>
                    </div>
                  )}
                  <div className="mobile-menu-divider"></div>
                </>
              ) : (
                <>
                  <button
                    className="mobile-menu-item mobile-menu-button mobile-menu-save"
                    onClick={() => {
                      handleSave();
                      setShowMobileMenu(false);
                    }}
                  >
                    Save
                  </button>
                  <button
                    className="mobile-menu-item mobile-menu-button mobile-menu-cancel"
                    onClick={() => {
                      handleCancel();
                      setShowMobileMenu(false);
                    }}
                  >
                    Cancel
                  </button>
                  <div className="mobile-menu-divider"></div>
                </>
              )}
              <Link
                to="/login"
                className="mobile-menu-item mobile-menu-logout"
                onClick={() => {
                  localStorage.removeItem('adminAuthed');
                  setShowMobileMenu(false);
                }}
              >
                Logout
              </Link>
            </div>
          )}
        </div>
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

            {/* Search Container - Above table, hidden in PDF export */}
            <div className="search-container no-export">
              <input
                type="text"
                className="search-input"
                placeholder="Search by account number, name, reference, or amount..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  className="search-clear-btn"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Desktop Table View */}
            <div className="table-wrapper">
              <table className="dashboard-table desktop-table" ref={tableRef}>
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
                  {filteredTableData.length === 0 ? (
                    <tr>
                      <td colSpan={isEditMode ? 6 : 5} style={{ textAlign: 'center', padding: '20px' }}>
                        {searchQuery ? 'No results found' : 'No data available'}
                      </td>
                    </tr>
                  ) : (
                    filteredTableData.map((row, index) => (
                      <tr key={index}>
                        <td>
                          {index + 1}
                        </td>
                      <td>
                        {isEditMode ? (
                          <input
                            type="text"
                            value={row.accountNumber}
                            onChange={(e) => handleCellChange(row, 'accountNumber', e.target.value)}
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
                            onChange={(e) => handleCellChange(row, 'accountName', e.target.value)}
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
                            onChange={(e) => handleCellChange(row, 'referenceNo', e.target.value)}
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
                            onChange={(e) => handleCellChange(row, 'amount', e.target.value)}
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
                            onClick={() => deleteRow(row)}
                          >
                            ✕
                          </button>
                        </td>
                      )}
                    </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="mobile-cards">
              {filteredTableData.length === 0 ? (
                <div className="mobile-card">
                  <div className="mobile-card-body" style={{ textAlign: 'center', padding: '40px 20px' }}>
                    <div className="mobile-field-value">
                      {searchQuery ? 'No results found' : 'No data available'}
                    </div>
                  </div>
                </div>
              ) : (
                filteredTableData.map((row, index) => (
                <div key={index} className="mobile-card">
                  <div className="mobile-card-header">
                    <span className="mobile-card-number">#{index + 1}</span>
                    {isEditMode && (
                      <button
                        type="button"
                        className="mobile-delete-btn"
                        onClick={() => deleteRow(row)}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <div className="mobile-card-body">
                    <div className="mobile-field">
                      <label>ACCOUNT NUMBER</label>
                      {isEditMode ? (
                        <input
                          type="text"
                          value={row.accountNumber}
                          onChange={(e) => handleCellChange(row, 'accountNumber', e.target.value)}
                          className="mobile-cell-input"
                          placeholder="Enter account number"
                        />
                      ) : (
                        <div className="mobile-field-value">{row.accountNumber || '-'}</div>
                      )}
                    </div>
                    <div className="mobile-field">
                      <label>ACCOUNT NAME</label>
                      {isEditMode ? (
                        <input
                          type="text"
                          value={row.accountName}
                          onChange={(e) => handleCellChange(row, 'accountName', e.target.value)}
                          className="mobile-cell-input"
                          placeholder="Enter account name"
                        />
                      ) : (
                        <div className="mobile-field-value">{row.accountName || '-'}</div>
                      )}
                    </div>
                    <div className="mobile-field">
                      <label>REFERENCE NO.</label>
                      {isEditMode ? (
                        <input
                          type="text"
                          value={row.referenceNo}
                          onChange={(e) => handleCellChange(row, 'referenceNo', e.target.value)}
                          className="mobile-cell-input"
                          placeholder="Enter reference number"
                        />
                      ) : (
                        <div className="mobile-field-value">{row.referenceNo || '-'}</div>
                      )}
                    </div>
                    <div className="mobile-field">
                      <label>AMOUNT</label>
                      {isEditMode ? (
                        <input
                          type="text"
                          value={row.amount}
                          onChange={(e) => handleCellChange(row, 'amount', e.target.value)}
                          className="mobile-cell-input"
                          placeholder="Enter amount"
                        />
                      ) : (
                        <div className="mobile-field-value">{row.amount || '-'}</div>
                      )}
                    </div>
                  </div>
                </div>
                ))
              )}
            </div>

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
