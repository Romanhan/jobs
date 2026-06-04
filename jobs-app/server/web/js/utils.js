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
    return parts[2] + '-' + parts[1].padStart(2, '0') + '-' + parts[0].padStart(2, '0');
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

export function parseCSVLines(raw) {
    const lines = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (ch === '"') {
            if (inQuotes && raw[i + 1] === '"') {
                current += '"';
                i++;
            } else if (!inQuotes) {
                const isBoundary = i === 0 || raw[i - 1] === ';' || raw[i - 1] === '\n' || raw[i - 1] === '\r';
                if (isBoundary) inQuotes = true;
                current += '"';
            } else {
                inQuotes = false;
                current += '"';
            }
        } else if (ch === '\n' && !inQuotes) {
            if (current.trim()) lines.push(current);
            current = '';
        } else if (ch === '\r' && !inQuotes) {
        } else {
            current += ch;
        }
    }
    if (current.trim()) lines.push(current);
    return lines;
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
            if (ch === '"' && current.length === 0) {
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

export function renderMarkdown(text) {
    if (text === undefined || text === null) return '';
    let html = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/!!(.+?)!!/g, '<span class="text-important">$1</span>');
    html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');
    return html;
}

export function wrapSelection(textarea, wrapper) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.substring(start, end);
    if (selected) {
        const wl = wrapper.length;
        if (selected.startsWith(wrapper) && selected.endsWith(wrapper)) {
            const inner = selected.substring(wl, selected.length - wl);
            textarea.value = text.substring(0, start) + inner + text.substring(end);
            textarea.selectionStart = start;
            textarea.selectionEnd = start + inner.length;
        } else {
            textarea.value = text.substring(0, start) + wrapper + selected + wrapper + text.substring(end);
            textarea.selectionStart = start + wl;
            textarea.selectionEnd = end + wl;
        }
    } else {
        textarea.value = text.substring(0, start) + wrapper + wrapper + text.substring(end);
        textarea.selectionStart = start + wrapper.length;
        textarea.selectionEnd = start + wrapper.length;
    }
    textarea.focus();
}

export function autoGrowTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
}

