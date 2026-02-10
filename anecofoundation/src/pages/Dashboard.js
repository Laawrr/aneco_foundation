import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import './Dashboard.css';

export default function Dashboard() {
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showMobileExportSubmenu, setShowMobileExportSubmenu] = useState(false);
  const [pdfFormat, setPdfFormat] = useState('a4'); // Default to A4
  const [showFormatMenu, setShowFormatMenu] = useState(false);
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
        setShowFormatMenu(false);
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target)) {
        setShowMobileMenu(false);
        setShowMobileExportSubmenu(false);
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
    // Validate amount field to only allow numbers and decimal point
    if (columnKey === 'amount') {
      // Only allow numbers, single decimal point, and empty string
      // Regex: allows digits with optional single decimal point (e.g., "123", "123.45", ".5")
      // Prevents letters, multiple decimal points, and other special characters
      const numberRegex = /^(\d+\.?\d*|\.\d+|)$/;
      if (value !== '' && !numberRegex.test(value)) {
        return; // Don't update if invalid
      }
      // Additional check: prevent multiple decimal points
      const decimalCount = (value.match(/\./g) || []).length;
      if (decimalCount > 1) {
        return; // Don't update if more than one decimal point
      }
    }
    
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

  const exportToPDF = async () => {
    try {
      const { jsPDF } = require('jspdf');
      require('jspdf-autotable');
      
      // Create new PDF document with selected format
      // Supported formats: 'a4', 'letter', 'legal', 'a3', 'a5', 'tabloid'
      const formatMap = {
        'a4': 'a4',
        'letter': [216, 279], // Letter size in mm (8.5" x 11")
        'legal': [216, 330], // Philippine Legal size in mm (8.5" x 13")
        'a3': 'a3',
        'a5': 'a5',
        'tabloid': [279, 432] // Tabloid size in mm (11" x 17")
      };
      
      const selectedFormat = formatMap[pdfFormat] || 'a4';
      
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: selectedFormat,
        compress: true
      });

      // Get page dimensions (adaptive to any page size)
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      
      // Use percentage-based margins and sizing for better adaptability
      // These will scale proportionally when printed on different paper sizes
      const margin = Math.max(10, pageWidth * 0.05); // 5% margin, minimum 10mm
      const logoSize = Math.min(25, pageWidth * 0.08); // Adaptive logo size (8% of page width, max 25mm)
      
      // Set PDF properties for better print scaling
      doc.setProperties({
        title: 'Dashboard Export',
        subject: 'ANECO Foundation Report',
        author: 'ANECO',
        keywords: 'dashboard, report, export',
        creator: 'ANECO Dashboard'
      });
      
      // Get header information
      const currentDate = new Date()
        .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
        .replace(/\s/g, '-');

      // Load logo image asynchronously
      const loadLogo = () => {
        return new Promise((resolve) => {
          const logo = new Image();
          logo.crossOrigin = 'anonymous';
          logo.src = '/aneco2.png';
          
          logo.onload = () => {
            try {
              // Calculate logo dimensions maintaining aspect ratio
              const imgAspectRatio = logo.height / logo.width;
              const imgWidth = logoSize;
              const imgHeight = logoSize * imgAspectRatio;
              
              // Add logo in top-left corner
              doc.addImage(logo, 'PNG', margin, margin, imgWidth, imgHeight);
              resolve({ imgHeight, logo, imgWidth });
            } catch (err) {
              console.warn('Could not add logo:', err);
              resolve({ imgHeight: 0, logo: null, imgWidth: 0 });
            }
          };
          
          logo.onerror = () => {
            console.warn('Logo image failed to load');
            resolve({ imgHeight: 0, logo: null, imgWidth: 0 });
          };
          
          // Timeout after 3 seconds
          setTimeout(() => resolve({ imgHeight: 0, logo: null, imgWidth: 0 }), 3000);
        }); 
      };

      // Wait for logo to load
      const { imgHeight, logo: loadedLogo, imgWidth: logoWidth } = await loadLogo();
      
      // Adaptive font sizes based on page width
      const baseFontSize = Math.max(8, Math.min(14, pageWidth * 0.04));
      const titleFontSize = Math.max(10, Math.min(16, pageWidth * 0.045));
      const headerFontSize = Math.max(9, Math.min(14, pageWidth * 0.042));
      
      // Calculate header row Y position (align logo, company name, and date horizontally)
      const headerRowY = margin + (imgHeight > 0 ? imgHeight / 2 : titleFontSize / 2);
      
      // Date (right aligned, horizontally aligned with logo and company name)
      doc.setFontSize(baseFontSize);
      doc.setFont(undefined, 'bold');
      doc.text(currentDate, pageWidth - margin, headerRowY, { align: 'right' });
      
      // Company name with address, event title and detail (centered, horizontally aligned with logo and date)
      doc.setFontSize(titleFontSize);
      doc.setFont(undefined, 'bold');
      const companyName = 'AGUSAN DEL NORTE ELECTRIC COOPERATIVE, INC.';
      const companyAddress = 'Km. 2, J.C. Aquino Avenue, Butuan City';
      const eventTitle = 'GIVING OF GROCERY ITEMS TO MEMBER-CONSUMERS';
      const eventDetail = 'DURING 49TH ANNIVERSARY 2026';
      
      // Draw company name, address, event title, and event detail together, centered
      let currentY = headerRowY;
      doc.text(companyName, pageWidth / 2, currentY, { align: 'center', maxWidth: pageWidth - (margin * 2) });
      currentY += titleFontSize * 0.6;
      
      doc.setFontSize(baseFontSize);
      doc.text(companyAddress, pageWidth / 2, currentY, { align: 'center', maxWidth: pageWidth - (margin * 2) });
      currentY += baseFontSize * 0.8;
      // Add break line after company address
      currentY += baseFontSize * 0.5; // Extra spacing for line break
      
      doc.setFontSize(headerFontSize);
      doc.setFont(undefined, 'bold');
      doc.text(eventTitle, pageWidth / 2, currentY, { align: 'center', maxWidth: pageWidth - (margin * 2) });
      currentY += headerFontSize * 0.7;
      
      doc.setFontSize(headerFontSize);
      doc.text(eventDetail, pageWidth / 2, currentY, { align: 'center', maxWidth: pageWidth - (margin * 2) });
      
      // Calculate starting Y position for content below header row (minimize gap)
      let yPos = currentY + headerFontSize * 0.5; // Minimal spacing after event detail

      // Prepare table data
      const tableBody = filteredTableData.map((row, index) => [
        String(index + 1),
        row.accountNumber || '',
        row.accountName || '',
        row.referenceNo || '',
        row.amount || ''
      ]);

      // Calculate table column widths (adaptive to page width - percentage-based)
      // All measurements are relative to page width for scalability across different paper sizes
      const availableWidth = pageWidth - (margin * 2);
      const tableFontSize = Math.max(7, Math.min(10, pageWidth * 0.025)); // 2.5% of page width
      
      // Adaptive column widths (percentages of available width)
      const columnWidths = {
        0: availableWidth * 0.08,  // NO. - 8%
        1: availableWidth * 0.22, // ACCOUNT NUMBER - 22%
        2: availableWidth * 0.30, // ACCOUNT NAME - 30%
        3: availableWidth * 0.22, // REFERENCE NO. - 22%
        4: availableWidth * 0.18  // AMOUNT - 18%
      };

      // Add table using autoTable
      doc.autoTable({
        head: [['NO.', 'ACCOUNT NUMBER', 'ACCOUNT NAME', 'REFERENCE NO.', 'AMOUNT']],
        body: tableBody,
        startY: yPos,
        margin: { left: margin, right: margin, top: yPos },
        styles: {
          fontSize: tableFontSize,
          cellPadding: Math.max(1.5, tableFontSize * 0.3),
          overflow: 'linebreak',
          cellWidth: 'auto',
          lineWidth: 0.5,
          lineColor: [102, 102, 102],
          textColor: [0, 0, 0]
        },
        headStyles: {
          fillColor: [255, 255, 255],
          textColor: [0, 0, 0],
          fontStyle: 'bold',
          fontSize: tableFontSize,
          halign: 'center',
          lineWidth: 0.5,
          lineColor: [102, 102, 102]
        },
        bodyStyles: {
          textColor: [0, 0, 0],
          fontSize: tableFontSize,
          halign: 'center',
          lineWidth: 0.5,
          lineColor: [102, 102, 102]
        },
        columnStyles: {
          0: { cellWidth: columnWidths[0], halign: 'center' },
          1: { cellWidth: columnWidths[1], halign: 'center' },
          2: { cellWidth: columnWidths[2], halign: 'center' },
          3: { cellWidth: columnWidths[3], halign: 'center' },
          4: { cellWidth: columnWidths[4], halign: 'center' }
        },
        alternateRowStyles: {
          fillColor: [255, 255, 255]
        },
        tableWidth: availableWidth,
        showHead: 'everyPage',
        rowPageBreak: 'avoid', // Prevent rows from breaking across pages
        didDrawPage: function (data) {
          // Add header on each page (logo, company name, date - all horizontally aligned)
          if (data.pageNumber > 1) {
            const pageY = margin;
            const headerRowY = margin + (imgHeight > 0 ? imgHeight / 2 : titleFontSize / 2);
            
            // Logo on subsequent pages
            if (loadedLogo) {
              try {
                doc.addImage(loadedLogo, 'PNG', margin, pageY, logoWidth, imgHeight);
              } catch (err) {
                // Ignore errors on subsequent pages
              }
            }
            
            // Company name with address, event title and detail on subsequent pages (horizontally aligned with logo and date)
            // Use same font sizes as first page for consistency
            let subsequentY = headerRowY;
            doc.setFontSize(titleFontSize);
            doc.setFont(undefined, 'bold');
            doc.text(companyName, pageWidth / 2, subsequentY, { align: 'center', maxWidth: pageWidth - (margin * 2) });
            subsequentY += titleFontSize * 0.6;
            
            doc.setFontSize(baseFontSize);
            doc.text(companyAddress, pageWidth / 2, subsequentY, { align: 'center', maxWidth: pageWidth - (margin * 2) });
            subsequentY += baseFontSize * 0.8;
            // Add break line after company address
            subsequentY += baseFontSize * 0.5; // Extra spacing for line break
            
            doc.setFontSize(headerFontSize);
            doc.setFont(undefined, 'bold');
            doc.text(eventTitle, pageWidth / 2, subsequentY, { align: 'center', maxWidth: pageWidth - (margin * 2) });
            subsequentY += headerFontSize * 0.7;
            
            doc.setFontSize(headerFontSize);
            doc.text(eventDetail, pageWidth / 2, subsequentY, { align: 'center', maxWidth: pageWidth - (margin * 2) });
            
            // Date on subsequent pages (horizontally aligned with logo and company name)
            doc.setFontSize(baseFontSize);
            doc.setFont(undefined, 'bold');
            doc.text(currentDate, pageWidth - margin, headerRowY, { align: 'right' });
          }
        }
      });

      // Save the PDF
      doc.save('dashboard_export.pdf');
      setShowExportMenu(false);
    } catch (error) {
      console.error('Failed to export PDF:', error);
      alert('Please install jspdf and jspdf-autotable packages: npm install jspdf jspdf-autotable');
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
                      <div className="mobile-menu-item" style={{ padding: 0 }}>
                        <div style={{ padding: '8px 40px', fontSize: '12px', color: '#666', fontWeight: 600 }}>
                          PDF Paper Size:
                        </div>
                      <button
                        className="mobile-menu-item mobile-menu-button"
                          onClick={() => { setPdfFormat('a4'); exportToPDF(); setShowMobileExportSubmenu(false); setShowMobileMenu(false); }}
                          style={{ fontWeight: pdfFormat === 'a4' ? 'bold' : 'normal' }}
                        >
                          📄 A4 {pdfFormat === 'a4' ? '✓' : ''}
                        </button>
                        <button
                          className="mobile-menu-item mobile-menu-button"
                          onClick={() => { setPdfFormat('letter'); exportToPDF(); setShowMobileExportSubmenu(false); setShowMobileMenu(false); }}
                          style={{ fontWeight: pdfFormat === 'letter' ? 'bold' : 'normal' }}
                        >
                          📄 Letter {pdfFormat === 'letter' ? '✓' : ''}
                        </button>
                        <button
                          className="mobile-menu-item mobile-menu-button"
                          onClick={() => { setPdfFormat('legal'); exportToPDF(); setShowMobileExportSubmenu(false); setShowMobileMenu(false); }}
                          style={{ fontWeight: pdfFormat === 'legal' ? 'bold' : 'normal' }}
                        >
                          📄 Legal (PH) {pdfFormat === 'legal' ? '✓' : ''}
                        </button>
                        <button
                          className="mobile-menu-item mobile-menu-button"
                          onClick={() => { setPdfFormat('a3'); exportToPDF(); setShowMobileExportSubmenu(false); setShowMobileMenu(false); }}
                          style={{ fontWeight: pdfFormat === 'a3' ? 'bold' : 'normal' }}
                        >
                          📄 A3 {pdfFormat === 'a3' ? '✓' : ''}
                        </button>
                        <button
                          className="mobile-menu-item mobile-menu-button"
                          onClick={() => { setPdfFormat('a5'); exportToPDF(); setShowMobileExportSubmenu(false); setShowMobileMenu(false); }}
                          style={{ fontWeight: pdfFormat === 'a5' ? 'bold' : 'normal' }}
                        >
                          📄 A5 {pdfFormat === 'a5' ? '✓' : ''}
                      </button>
                      </div>
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
            <h1 className="sr-only"></h1>
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
                    onClick={() => {
                      setShowExportMenu(!showExportMenu);
                      setShowFormatMenu(false);
                    }}
                  >
                    Export
                  </button>
                  {showExportMenu && (
                    <div className="export-menu">
                      <button onClick={exportToExcel} className="export-option">📊 Export as Excel</button>
                      <div className="export-option" style={{ padding: 0 }}>
                        <button 
                          onClick={() => setShowFormatMenu(!showFormatMenu)} 
                          className="export-option"
                          style={{ width: '100%', textAlign: 'left', padding: '14px 20px' }}
                        >
                          📄 Export as PDF {showFormatMenu ? '▼' : '▶'}
                        </button>
                        {showFormatMenu && (
                          <div className="pdf-format-submenu">
                            <div className="pdf-format-label">Paper Size:</div>
                            <button 
                              onClick={() => { setPdfFormat('a4'); exportToPDF(); setShowExportMenu(false); setShowFormatMenu(false); }} 
                              className="format-option"
                              style={{ fontWeight: pdfFormat === 'a4' ? 'bold' : 'normal' }}
                            >
                              A4 {pdfFormat === 'a4' ? '✓' : ''}
                            </button>
                            <button 
                              onClick={() => { setPdfFormat('letter'); exportToPDF(); setShowExportMenu(false); setShowFormatMenu(false); }} 
                              className="format-option"
                              style={{ fontWeight: pdfFormat === 'letter' ? 'bold' : 'normal' }}
                            >
                              Letter (US) {pdfFormat === 'letter' ? '✓' : ''}
                            </button>
                            <button 
                              onClick={() => { setPdfFormat('legal'); exportToPDF(); setShowExportMenu(false); setShowFormatMenu(false); }} 
                              className="format-option"
                              style={{ fontWeight: pdfFormat === 'legal' ? 'bold' : 'normal' }}
                            >
                              Legal (PH) {pdfFormat === 'legal' ? '✓' : ''}
                            </button>
                            <button 
                              onClick={() => { setPdfFormat('a3'); exportToPDF(); setShowExportMenu(false); setShowFormatMenu(false); }} 
                              className="format-option"
                              style={{ fontWeight: pdfFormat === 'a3' ? 'bold' : 'normal' }}
                            >
                              A3 {pdfFormat === 'a3' ? '✓' : ''}
                            </button>
                            <button 
                              onClick={() => { setPdfFormat('a5'); exportToPDF(); setShowExportMenu(false); setShowFormatMenu(false); }} 
                              className="format-option"
                              style={{ fontWeight: pdfFormat === 'a5' ? 'bold' : 'normal' }}
                            >
                              A5 {pdfFormat === 'a5' ? '✓' : ''}
                            </button>
                            <button 
                              onClick={() => { setPdfFormat('tabloid'); exportToPDF(); setShowExportMenu(false); setShowFormatMenu(false); }} 
                              className="format-option"
                              style={{ fontWeight: pdfFormat === 'tabloid' ? 'bold' : 'normal' }}
                            >
                              Tabloid {pdfFormat === 'tabloid' ? '✓' : ''}
                            </button>
                    </div>
                  )}
                      </div>
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
