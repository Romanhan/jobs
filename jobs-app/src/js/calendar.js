import { formatDate } from './utils.js';

let calendarPopup = null;
let calendarCallback = null;
let calendarCurrentYear = null;
let calendarCurrentMonth = null;
let calendarSelectedDate = null;

let calendarCellTd = null;
let calendarRowIndex = null;
let calendarColName = null;
let ignoreNextClick = false;

export function positionCalendarPopup(anchorEl) {
    const popup = document.getElementById('calendar-popup');
    if (!popup) return;
    const rect = anchorEl.getBoundingClientRect();
    const calW = 240;
    const calH = 280;
    const gap = 4;
    let left = rect.left + window.scrollX;
    let top = rect.bottom + gap + window.scrollY;
    if (rect.bottom + calH > window.innerHeight) {
        top = rect.top - calH - gap + window.scrollY;
    }
    if (rect.left + calW > window.innerWidth) {
        left = rect.right - calW + window.scrollX;
    }
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
}

export function openDateCalendar(inputEl, currentValue, callback) {
    closeCalendarPopup();
    calendarPopup = inputEl;
    calendarCallback = callback;

    const today = new Date();
    let year = today.getFullYear();
    let month = today.getMonth();

    const formattedValue = formatDate(currentValue || '');
    if (formattedValue && /^\d{2}\.\d{2}\.\d{4}$/.test(formattedValue)) {
        const parts = formattedValue.split('.');
        year = parseInt(parts[2]);
        month = parseInt(parts[1]) - 1;
    }

    calendarCurrentYear = year;
    calendarCurrentMonth = month;
    calendarSelectedDate = formattedValue;
    
    const popup = document.createElement('div');
    popup.className = 'calendar-popup active';
    popup.id = 'calendar-popup';

    document.body.appendChild(popup);
    positionCalendarPopup(inputEl);
    renderCalendar();
    
    document.addEventListener('click', handleCalendarClickOutside);
}

export function closeCalendarPopup() {
    const popup = document.getElementById('calendar-popup');
    if (popup) {
        popup.remove();
    }
    document.removeEventListener('click', handleCalendarClickOutside);
    calendarPopup = null;
    calendarCallback = null;
    calendarCellTd = null;
    calendarRowIndex = null;
    calendarColName = null;
    calendarEditingInput = null;
    ignoreNextClick = false;
}

function handleCalendarClickOutside(e) {
    if (ignoreNextClick) {
        ignoreNextClick = false;
        return;
    }
    const popup = document.getElementById('calendar-popup');
    if (popup && (calendarCellTd || calendarPopup)) {
        if (!popup.contains(e.target)) {
            closeCalendarPopup();
            if (editingCell && editingCell.isDate) {
                finishEditing();
            }
        }
    }
}

let editingCell = null;
let finishEditing = null;

export function setEditingCellState(getter, setter) {
    editingCell = getter;
    finishEditing = setter;
}

export function renderCalendar() {
    const popup = document.getElementById('calendar-popup');
    if (!popup) return;
    
    const monthNames = ['Jaanuar', 'Veebruar', 'Märts', 'Aprill', 'Mai', 'Juuni', 'Juuli', 'August', 'September', 'Oktoober', 'November', 'Detsember'];
    
    let html = '<div class="calendar-header">';
    html += '<button class="calendar-header-btn" onclick="event.stopPropagation();changeMonth(-1)">◀</button>';
    html += '<span class="calendar-month-year">' + monthNames[calendarCurrentMonth] + ' ' + calendarCurrentYear + '</span>';
    html += '<button class="calendar-header-btn" onclick="event.stopPropagation();changeMonth(1)">▶</button>';
    html += '</div>';
    
    html += '<div class="calendar-weekdays">';
    const weekdays = ['E', 'K', 'T', 'N', 'R', 'L', 'P'];
    weekdays.forEach(day => {
        html += '<span class="calendar-weekday">' + day + '</span>';
    });
    html += '</div>';
    
    html += '<div class="calendar-days">';
    
    const firstDay = new Date(calendarCurrentYear, calendarCurrentMonth, 1);
    const lastDay = new Date(calendarCurrentYear, calendarCurrentMonth + 1, 0);
    
    let startDay = firstDay.getDay() - 1;
    if (startDay < 0) startDay = 6;
    
    const today = new Date();
    const todayStr = String(today.getDate()).padStart(2, '0') + '.' + String(today.getMonth() + 1).padStart(2, '0') + '.' + today.getFullYear();
    
    for (let i = 0; i < startDay; i++) {
        const prevDate = new Date(calendarCurrentYear, calendarCurrentMonth, -startDay + i + 1);
        const day = prevDate.getDate();
        const dayStr = String(day).padStart(2, '0') + '.' + String(prevDate.getMonth() + 1).padStart(2, '0') + '.' + prevDate.getFullYear();
        const isSelected = dayStr === calendarSelectedDate;
        const isToday = dayStr === todayStr;
        html += '<span class="calendar-day other-month' + (isSelected ? ' selected' : '') + (isToday ? ' today' : '') + '" data-date="' + dayStr + '" onclick="event.stopPropagation();selectDateCalendar(\'' + dayStr + '\')">' + day + '</span>';
    }
    
    for (let day = 1; day <= lastDay.getDate(); day++) {
        const dayStr = String(day).padStart(2, '0') + '.' + String(calendarCurrentMonth + 1).padStart(2, '0') + '.' + calendarCurrentYear;
        const isSelected = dayStr === calendarSelectedDate;
        const isToday = dayStr === todayStr;
        html += '<span class="calendar-day' + (isSelected ? ' selected' : '') + (isToday ? ' today' : '') + '" data-date="' + dayStr + '" onclick="event.stopPropagation();selectDateCalendar(\'' + dayStr + '\')">' + day + '</span>';
    }
    
    const totalCells = startDay + lastDay.getDate();
    const remainingCells = 42 - totalCells;
    for (let day = 1; day <= remainingCells; day++) {
        const nextDate = new Date(calendarCurrentYear, calendarCurrentMonth + 1, day);
        const dayStr = String(day).padStart(2, '0') + '.' + String(nextDate.getMonth() + 1).padStart(2, '0') + '.' + nextDate.getFullYear();
        const isSelected = dayStr === calendarSelectedDate;
        const isToday = dayStr === todayStr;
        html += '<span class="calendar-day other-month' + (isSelected ? ' selected' : '') + (isToday ? ' today' : '') + '" data-date="' + dayStr + '" onclick="event.stopPropagation();selectDateCalendar(\'' + dayStr + '\')">' + day + '</span>';
    }
    
    html += '</div>';
    html += '<button class="calendar-today-btn" onclick="event.stopPropagation();selectTodayCalendar()">Täna</button>';
    
    popup.innerHTML = html;
}

export function changeMonth(delta) {
    calendarCurrentMonth += delta;
    if (calendarCurrentMonth > 11) {
        calendarCurrentMonth = 0;
        calendarCurrentYear++;
    } else if (calendarCurrentMonth < 0) {
        calendarCurrentMonth = 11;
        calendarCurrentYear--;
    }
    renderCalendar();
}

export function selectDateCalendar(dateStr) {
    if (calendarRowIndex !== null && calendarColName) {
        selectDateCalendarDirect(dateStr);
    } else if (calendarCallback) {
        calendarCallback({ value: dateStr });
    }
    closeCalendarPopup();
}

export function selectTodayCalendar() {
    const today = new Date();
    const dayStr = String(today.getDate()).padStart(2, '0') + '.' + String(today.getMonth() + 1).padStart(2, '0') + '.' + today.getFullYear();
    if (calendarRowIndex !== null && calendarColName) {
        selectDateCalendarDirect(dayStr);
    } else {
        selectDateCalendar(dayStr);
    }
}

export function openDateCalendarDirect(td, index, col, currentValue) {
    closeCalendarPopup();
    calendarCellTd = td;
    calendarRowIndex = index;
    calendarColName = col;
    
    let calendarInput = document.querySelector('.floating-editor textarea');
    if (!calendarInput) {
        calendarInput = td.querySelector('textarea');
    }
    if (calendarInput) {
        calendarEditingInput = calendarInput;
    }

    const today = new Date();
    let year = today.getFullYear();
    let month = today.getMonth();

    const formattedValue = formatDate(currentValue || '');
    if (formattedValue && /^\d{2}\.\d{2}\.\d{4}$/.test(formattedValue)) {
        const parts = formattedValue.split('.');
        year = parseInt(parts[2]);
        month = parseInt(parts[1]) - 1;
    }

    calendarCurrentYear = year;
    calendarCurrentMonth = month;
    calendarSelectedDate = formattedValue;
    
    const popup = document.createElement('div');
    popup.className = 'calendar-popup active';
    popup.id = 'calendar-popup';

    document.body.appendChild(popup);
    positionCalendarPopup(td);
    renderCalendar();
    
    document.addEventListener('click', handleCalendarClickOutside);
    ignoreNextClick = true;
}

let selectDateCalendarDirectCallback = null;
let calendarEditingInput = null;
let onDateSelectedInEdit = null;

export function setSelectDateCallback(cb) {
    selectDateCalendarDirectCallback = cb;
}

export function setOnDateSelectedInEdit(cb) {
    onDateSelectedInEdit = cb;
}

export function selectDateCalendarDirect(dateStr) {
    if (calendarEditingInput) {
        calendarEditingInput.value = dateStr;
        if (onDateSelectedInEdit) {
            onDateSelectedInEdit(calendarEditingInput, dateStr);
        }
        calendarEditingInput = null;
    } else if (calendarRowIndex !== null && calendarColName) {
        if (selectDateCalendarDirectCallback) {
            selectDateCalendarDirectCallback(calendarRowIndex, calendarColName, dateStr);
        }
    }
    closeCalendarPopup();
}

window.selectTodayCalendar = selectTodayCalendar;
window.changeMonth = changeMonth;
window.selectDateCalendar = selectDateCalendar;