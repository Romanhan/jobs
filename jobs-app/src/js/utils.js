import { COLUMNS, DATE_COLS } from './config.js';

export function formatDate(dateStr) {
    if (!dateStr) return '';
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(dateStr)) return dateStr;
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return parts[2] + '.' + parts[1] + '.' + parts[0];
}

export function parseDate(dateStr) {
    if (!dateStr) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    const parts = dateStr.split('.');
    if (parts.length !== 3) return dateStr;
    return parts[2] + '-' + parts[1] + '-' + parts[0];
}

export function convertSaabunudDates(jobsArr) {
    let count = 0;
    jobsArr.forEach(job => {
        const val = job['Tooriku saabumise kuupäev EE'];
        if (val && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
            const parts = val.split('-');
            job['Tooriku saabumise kuupäev EE'] = parts[2] + '.' + parts[1] + '.' + parts[0];
            count++;
        }
    });
    return count;
}

export function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"' && line[i + 1] === '"') {
                current += '"';
                i++;
            } else if (ch === '"') {
                inQuotes = false;
            } else {
                current += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ';') {
                result.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
    }
    result.push(current);
    return result;
}

export function fixColumnKeys(data) {
    if (!Array.isArray(data)) return data;
    return data.map(job => {
        const fixed = {};
        Object.keys(job).forEach(key => {
            let newKey = key.trim();
            fixed[newKey] = job[key];
        });
        return fixed;
    });
}

export function autoGrowTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
}

export function autoSave(jobsArr) {
    try {
        localStorage.setItem('jobsData', JSON.stringify(jobsArr));
    } catch (e) {}
}