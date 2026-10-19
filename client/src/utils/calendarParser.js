// src/utils/calendarParser.js — Parse session calendars from Excel (.xlsx, .xls, .csv) and Word (.docx) files.
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';

// Month names lookup for textual dates like "November 3, 2026" or "3 Nov 2026"
const MONTH_MAP = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/**
 * Normalizes a date value into YYYY-MM-DD format.
 * Accepts:
 * - ISO string: '2026-11-03' or '2026/11/03'
 * - US/UK format: '11/03/2026' or '03-11-2026'
 * - Natural language: 'Nov 3, 2026', '3 November 2026', 'November 3 2026'
 * - JS Date object
 * - Excel serial date numbers (e.g. 45600)
 */
export function normalizeDate(value) {
  if (!value && value !== 0) return null;

  // If already a JS Date
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // If Excel serial number (typically between 30000 and 70000 for modern dates)
  if (typeof value === 'number' && value > 25000 && value < 90000) {
    // Excel epoch offset (accounts for 1900 leap year bug in Excel)
    const utcDays = Math.floor(value - 25569);
    const date = new Date(utcDays * 86400 * 1000);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const str = String(value).trim();
  if (!str) return null;

  // 1. Check YYYY-MM-DD or YYYY/MM/DD
  const ymd = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (ymd) {
    const y = ymd[1];
    const m = ymd[2].padStart(2, '0');
    const d = ymd[3].padStart(2, '0');
    if (isValidYMD(y, m, d)) return `${y}-${m}-${d}`;
  }

  // 2. Natural language: "Nov 3, 2026" or "November 3 2026" or "3rd November 2026"
  const textDate1 = str.match(/([a-zA-Z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
  if (textDate1) {
    const month = MONTH_MAP[textDate1[1].toLowerCase()];
    if (month) {
      const y = textDate1[3];
      const m = String(month).padStart(2, '0');
      const d = textDate1[2].padStart(2, '0');
      if (isValidYMD(y, m, d)) return `${y}-${m}-${d}`;
    }
  }

  const textDate2 = str.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-zA-Z]+),?\s+(\d{4})/);
  if (textDate2) {
    const month = MONTH_MAP[textDate2[2].toLowerCase()];
    if (month) {
      const y = textDate2[3];
      const m = String(month).padStart(2, '0');
      const d = textDate2[1].padStart(2, '0');
      if (isValidYMD(y, m, d)) return `${y}-${m}-${d}`;
    }
  }

  // 3. MM/DD/YYYY or DD/MM/YYYY
  const parts = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (parts) {
    const p1 = parseInt(parts[1], 10);
    const p2 = parseInt(parts[2], 10);
    const y = parts[3];

    // If first part > 12, it must be DD/MM/YYYY
    if (p1 > 12 && p2 <= 12) {
      const d = String(p1).padStart(2, '0');
      const m = String(p2).padStart(2, '0');
      if (isValidYMD(y, m, d)) return `${y}-${m}-${d}`;
    }
    // Default to MM/DD/YYYY standard unless p2 > 12
    if (p2 > 12 && p1 <= 12) {
      const m = String(p1).padStart(2, '0');
      const d = String(p2).padStart(2, '0');
      if (isValidYMD(y, m, d)) return `${y}-${m}-${d}`;
    }
    // Ambiguous: assume YYYY-MM-DD ordering (MM/DD/YYYY)
    const m = String(p1).padStart(2, '0');
    const d = String(p2).padStart(2, '0');
    if (isValidYMD(y, m, d)) return `${y}-${m}-${d}`;
  }

  // Fallback to Date.parse
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    if (isValidYMD(y, m, d) && y >= 2000 && y <= 2100) {
      return `${y}-${m}-${d}`;
    }
  }

  return null;
}

function isValidYMD(y, m, d) {
  const year = parseInt(y, 10);
  const month = parseInt(m, 10);
  const day = parseInt(d, 10);
  if (year < 2000 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  return true;
}

/**
 * Normalizes a time value into 24-hour HH:mm format.
 * Accepts:
 * - '10:00'
 * - '10:00 AM', '2:30 PM', '2pm', '14:30'
 * - Excel fraction decimal (e.g. 0.416666667 -> 10:00)
 */
export function normalizeTime(value) {
  if (!value && value !== 0) return null;

  // Handle Excel fraction of a day for time
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const totalSeconds = Math.round(value * 86400);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  const str = String(value).trim().toLowerCase();
  if (!str) return null;

  // Check 12-hour format e.g. "10:00 am", "2:30 pm", "2 pm", "12:00pm"
  const m12 = str.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const m = m12[2] ? parseInt(m12[2], 10) : 0;
    const meridian = m12[3].toLowerCase();

    if (h < 1 || h > 12 || m < 0 || m > 59) return null;
    if (meridian === 'pm' && h < 12) h += 12;
    if (meridian === 'am' && h === 12) h = 0;

    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // Check 24-hour format e.g. "10:00", "14:30", "09:00:00"
  const m24 = str.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (m24) {
    const h = m24[1].padStart(2, '0');
    const m = m24[2].padStart(2, '0');
    return `${h}:${m}`;
  }

  // Time embedded in string like "starts at 10:00 AM" or "10:00 - 12:00"
  const embedded12 = str.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (embedded12) {
    let h = parseInt(embedded12[1], 10);
    const m = embedded12[2] ? parseInt(embedded12[2], 10) : 0;
    const meridian = embedded12[3].toLowerCase();
    if (h >= 1 && h <= 12 && m >= 0 && m <= 59) {
      if (meridian === 'pm' && h < 12) h += 12;
      if (meridian === 'am' && h === 12) h = 0;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }

  const embedded24 = str.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (embedded24) {
    return `${embedded24[1].padStart(2, '0')}:${embedded24[2].padStart(2, '0')}`;
  }

  return null;
}

/**
 * Parses an Excel or CSV file (ArrayBuffer or binary string) using SheetJS.
 */
export function parseSpreadsheet(data) {
  const workbook = XLSX.read(data, {
    type: 'array',
    cellDates: true,
    cellText: true,
  });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('Spreadsheet contains no sheets.');
  }

  const worksheet = workbook.Sheets[firstSheetName];
  // Convert sheet to row arrays (header: 1 returns 2D array of raw values)
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

  if (!rows || rows.length === 0) {
    throw new Error('Spreadsheet appears to be empty.');
  }

  return extractSessionsFromRows(rows);
}

/**
 * Parses a Microsoft Word document (.docx) ArrayBuffer using Mammoth.
 */
export async function parseWordDocument(arrayBuffer) {
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const html = result.value;

  if (!html || !html.trim()) {
    throw new Error('Word document contains no readable text or tables.');
  }

  // Use DOMParser in the browser to inspect tables and paragraphs
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const rows = [];

  // 1. Check for tables first (the primary way schedules are put in Word)
  const tables = doc.querySelectorAll('table');
  if (tables.length > 0) {
    tables.forEach((table) => {
      const trList = table.querySelectorAll('tr');
      trList.forEach((tr) => {
        const cells = Array.from(tr.querySelectorAll('th, td')).map((cell) =>
          cell.textContent.trim()
        );
        if (cells.length > 0) rows.push(cells);
      });
    });
  }

  // 2. Also check paragraphs if no tables or to find bulleted session dates
  if (rows.length === 0) {
    const paragraphs = doc.querySelectorAll('p, li');
    paragraphs.forEach((p) => {
      const text = p.textContent.trim();
      if (text) rows.push([text]);
    });
  }

  if (rows.length === 0) {
    throw new Error('No tables or paragraph data could be found in the Word document.');
  }

  return extractSessionsFromRows(rows);
}

/**
 * Scans 2D row data (from spreadsheet or docx table) to identify date and time columns,
 * or extracts date and time from single text entries.
 */
export function extractSessionsFromRows(rows) {
  const sessions = [];
  const warnings = [];

  if (rows.length === 0) {
    return { sessions, warnings };
  }

  // Try to find header row index and column indices
  let dateCol = -1;
  let timeCol = -1;
  let headerRowIndex = -1;

  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const val = String(row[c] || '').toLowerCase().trim();
      if (dateCol === -1 && /^(session\s*)?date|day|session\s*day$/i.test(val)) {
        dateCol = c;
        headerRowIndex = r;
      }
      if (timeCol === -1 && /^(start\s*)?time|session\s*time|starts?$/i.test(val)) {
        timeCol = c;
        headerRowIndex = r;
      }
    }
    if (dateCol !== -1 && timeCol !== -1) break;
  }

  const startRow = headerRowIndex !== -1 ? headerRowIndex + 1 : 0;

  for (let r = startRow; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    // Check if entire row is empty
    if (row.every((cell) => cell === '' || cell == null)) continue;

    let date = null;
    let time = null;

    // Case A: We have mapped date and time columns
    if (dateCol !== -1 && timeCol !== -1) {
      date = normalizeDate(row[dateCol]);
      time = normalizeTime(row[timeCol]);

      // If time column was empty, check if date cell contained datetime
      if (date && !time) {
        time = normalizeTime(row[dateCol]);
      }
    }

    // Case B: Scan cells across the row if not mapped or if mapped column had no match
    if (!date || !time) {
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (!date) {
          const d = normalizeDate(cell);
          if (d) {
            date = d;
            continue;
          }
        }
        if (!time) {
          const t = normalizeTime(cell);
          if (t) {
            time = t;
            continue;
          }
        }
      }
    }

    // Case C: Single string in the row containing both date and time (e.g., from Word paragraph)
    if ((!date || !time) && row.length === 1) {
      const fullText = String(row[0]);
      if (!date) date = normalizeDate(fullText);
      if (!time) time = normalizeTime(fullText);
    }

    if (date && time) {
      // Avoid duplicate date+time entries
      if (!sessions.some((s) => s.date === date && s.startTime === time)) {
        sessions.push({ date, startTime: time });
      }
    } else if (date && !time) {
      warnings.push(`Row ${r + 1}: Found date ${date} but could not detect a start time.`);
    } else if (!date && time) {
      warnings.push(`Row ${r + 1}: Found time ${time} but could not detect a valid date.`);
    }
  }

  // Sort sessions chronologically
  sessions.sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));

  return { sessions, warnings };
}

/**
 * Universal file parser for Excel (.xlsx, .xls, .csv) and Word (.docx).
 */
export async function parseCalendarFile(file) {
  const extension = file.name.split('.').pop().toLowerCase();

  const isExcel = ['xlsx', 'xls', 'csv'].includes(extension);
  const isWord = ['docx'].includes(extension);

  if (!isExcel && !isWord) {
    throw new Error(
      `Unsupported file type: .${extension}. Please upload an Excel file (.xlsx, .xls, .csv) or Word document (.docx).`
    );
  }

  const arrayBuffer = await file.arrayBuffer();

  if (isExcel) {
    const { sessions, warnings } = parseSpreadsheet(arrayBuffer);
    return {
      fileName: file.name,
      fileType: extension.toUpperCase(),
      sessions,
      warnings,
      total: sessions.length,
    };
  }

  if (isWord) {
    const { sessions, warnings } = await parseWordDocument(arrayBuffer);
    return {
      fileName: file.name,
      fileType: 'DOCX',
      sessions,
      warnings,
      total: sessions.length,
    };
  }
}

/**
 * Generates and triggers download of a sample calendar template spreadsheet (.xlsx).
 */
export function downloadCalendarTemplate() {
  const sampleData = [
    ['Date', 'Start Time', 'Topic / Notes'],
    ['2026-11-03', '10:00', 'Cohort Orientation'],
    ['2026-11-10', '14:30', 'Resume & Profile Workshop'],
    ['2026-11-17', '10:00', 'Mentorship Check-in'],
    ['2026-11-24', '11:00', 'Midterm Project Review'],
  ];

  const ws = XLSX.utils.aoa_to_sheet(sampleData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Calendar');
  XLSX.writeFile(wb, 'remindme-calendar-template.xlsx');
}
