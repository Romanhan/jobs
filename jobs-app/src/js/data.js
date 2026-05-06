import { COLUMNS, DATE_COLS } from './config.js';
import { convertSaabunudDates, parseCSVLine, fixColumnKeys, autoSave as doAutoSave } from './utils.js';

export let jobs = [];

export function setJobs(newJobs) {
    jobs = newJobs;
}

export function getJobs() {
    return jobs;
}

export function loadData() {
    const saved = localStorage.getItem('jobsData');
    if (saved) {
        try {
            jobs = JSON.parse(saved);
            const firstJob = jobs[0] || {};
            const hasLeadingSpaces = Object.keys(firstJob).some(k => k !== k.trim());
            if (hasLeadingSpaces) {
                jobs = fixColumnKeys(jobs);
                const count = convertSaabunudDates(jobs);
                autoSave(jobs);
                return { status: 'fixed', count, jobs };
            } else {
                const count = convertSaabunudDates(jobs);
                if (count > 0) autoSave(jobs);
                return { status: 'loaded', count: jobs.length, jobs };
            }
        } catch (e) {
            jobs = [];
            return { status: 'error', count: 0, jobs };
        }
    }
    return null;
}

export async function loadFromFileLegacy() {
    try {
        const res = await fetch('jobs_data.json');
        const data = await res.json();
        jobs = fixColumnKeys(data);
        convertSaabunudDates(jobs);
        autoSave(jobs);
        return { status: 'legacy', count: jobs.length, jobs };
    } catch (e) {
        return null;
    }
}

export function autoSave() {
    doAutoSave(jobs);
}

export function addJob(job) {
    jobs.push(job);
    autoSave(jobs);
}

let columnWidths = {};
let hiddenColumns = {};

export function loadColumnWidths() {
    columnWidths = {};
    const saved = localStorage.getItem('jobsColumnWidths');
    if (saved) { try { columnWidths = JSON.parse(saved); } catch (e) { columnWidths = {}; } }
}

export function saveColumnWidths() {
    localStorage.setItem('jobsColumnWidths', JSON.stringify(columnWidths));
}

export function getColumnWidths() {
    return columnWidths;
}

export function setColumnWidth(col, width) {
    columnWidths[col] = width;
}

export function loadHiddenColumns() {
    hiddenColumns = {};
    const saved = localStorage.getItem('jobsHiddenColumns');
    if (saved) { try { hiddenColumns = JSON.parse(saved); } catch (e) { hiddenColumns = {}; } }
}

export function saveHiddenColumns() {
    localStorage.setItem('jobsHiddenColumns', JSON.stringify(hiddenColumns));
}

export function getHiddenColumns() {
    return hiddenColumns;
}

export function setHiddenColumn(col, hidden) {
    hiddenColumns[col] = hidden;
}

export function saveCSV() {
    const headerRow = COLUMNS.join(';');
    const rows = jobs.map(job => {
        return COLUMNS.map(col => {
            let val = job[col] !== undefined ? job[col] : '';
            if (val === true) val = 'TRUE';
            else if (val === false) val = 'FALSE';
            else if (typeof val === 'string') {
                if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
                    const p = val.split('-');
                    val = p[2] + '.' + p[1] + '.' + p[0];
                }
            }
            val = String(val).replace(/"/g, '""');
            if (val.includes(';') || val.includes('"') || val.includes('\n')) {
                val = '"' + val + '"';
            }
            return val;
        }).join(';');
    });
    const csv = [headerRow, ...rows].join('\n');
    const bom = '\uFEFF';
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'jobs_data.csv';
    a.click();
    URL.revokeObjectURL(url);
}

export function loadFromFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                let raw = e.target.result;
                raw = raw.replace(/^\uFEFF/, '');
                const lines = raw.split(/\r?\n/).filter(l => l.trim());
                if (lines.length < 1) throw new Error('Tühi fail');
                
                const headerLine = lines[0];
                const headers = parseCSVLine(headerLine);
                
                const colMap = {};
                const usedIndices = new Set();
                
                headers.forEach((h, i) => {
                    const key = h.trim().replace(/^"|"$/g, '');
                    const normKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
                    const found = COLUMNS.find(c => {
                        const normC = c.toLowerCase().replace(/[^a-z0-9]/g, '');
                        return normC === normKey;
                    });
                    if (found) {
                        colMap[found] = i;
                        usedIndices.add(i);
                    }
                });
                
                let posIdx = 0;
                COLUMNS.forEach(col => {
                    if (colMap[col] === undefined) {
                        while (usedIndices.has(posIdx) && posIdx < headers.length) posIdx++;
                        if (posIdx < headers.length) {
                            colMap[col] = posIdx;
                            usedIndices.add(posIdx);
                        }
                        posIdx++;
                    }
                });
                
                const newJobs = [];
                for (let i = 1; i < lines.length; i++) {
                    const values = parseCSVLine(lines[i]);
                    const job = {};
                    COLUMNS.forEach(col => {
                        const idx = colMap[col];
                        let val = (idx !== undefined && values[idx] !== undefined) ? values[idx] : '';
                        val = val.replace(/^"|"$/g, '').replace(/""/g, '"');
                        
                        if (col === 'Valmis' || col === 'Alustatud' || col === 'Töötlus Lõpetatud' || col === 'Töötlus allhankes') {
                            if (val.toUpperCase() === 'TRUE') val = true;
                            else if (val.toUpperCase() === 'FALSE') val = false;
                            else val = false;
                        } else if (DATE_COLS.includes(col) && val) {
                            const m = val.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
                            if (m) {
                                val = m[3] + '-' + m[2] + '-' + m[1];
                            }
                        }
                        job[col] = val;
                    });
                    if (job['Töö Nr']) newJobs.push(job);
                }
                
                jobs = newJobs;
                autoSave(jobs);
                resolve({ count: jobs.length, jobs });
            } catch (err) {
                reject(err);
            }
        };
        reader.readAsText(file, 'Windows-1252');
    });
}