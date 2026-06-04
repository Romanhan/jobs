import { formatDate } from './utils.js';

let calendarPopup = null;
let calendarCallback = null;
let calendarCurrentYear = null;
let calendarCurrentMonth = null;
let calendarSelectedDate = null;

let calendarCellTd = null;
let calendarRowIndex = null;
let calendarColName = null;


export function positionCalendarPopup(anchorEl) {
    const popup = document.getElementById('calendar-popup');
    if (!popup) return;
    const rect = anchorEl.getBoundingClientRect();
    const calW = 240;
    const gapBelow = 4;
    const gapAbove = 5;
    let left = rect.left + window.scrollX;
    const calH = popup.offsetHeight || 280;
    let top = rect.bottom + gapBelow + window.scrollY;
    if (rect.bottom + calH > window.innerHeight) {
        top = rect.top - calH - gapAbove + window.scrollY;
    }
    if (rect.left + calW > window.innerWidth) {
        left = rect.right - calW + window.scrollX;
    }
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
}

export function openDateCalendar(inputEl, currentValue, callback, anchorEl) {
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
    renderCalendar();
    positionCalendarPopup(anchorEl || inputEl);
    
    setTimeout(() => {
        document.addEventListener('click', handleCalendarClickOutside);
    }, 0);
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
function handleCalendarClickOutside(e) {
    const popup = document.getElementById('calendar-popup');
    if (popup && (calendarCellTd || calendarPopup)) {
        if (e.target === calendarEditingInput || e.target === calendarPopup || e.target.closest?.('.calendar-edit-btn') || e.target.closest?.('.calendar-icon-btn')) {
            return;
        }
        if (!popup.contains(e.target)) {
            closeCalendarPopup();
            const cell = editingCellGetter ? editingCellGetter() : null;
            if (cell && cell.isDate) {
                finishEditing();
            }
        }
    }
}

let editingCellGetter = null;
let finishEditing = null;

export function setEditingCellState(getter, setter) {
    editingCellGetter = getter;
    finishEditing = setter;
}

export function renderCalendar() {
    const popup = document.getElementById('calendar-popup');
    if (!popup) return;
    
    const monthNames = ['Jaanuar', 'Veebruar', 'Märts', 'Aprill', 'Mai', 'Juuni', 'Juuli', 'August', 'September', 'Oktoober', 'November', 'Detsember'];
    
    let html = '<div class="calendar-header">';
    html += '<button class="calendar-header-btn" data-action="prev-month">◀</button>';
    html += '<span class="calendar-month-year">' + monthNames[calendarCurrentMonth] + ' ' + calendarCurrentYear + '</span>';
    html += '<button class="calendar-header-btn" data-action="next-month">▶</button>';
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
        html += '<span class="calendar-day other-month' + (isSelected ? ' selected' : '') + (isToday ? ' today' : '') + '" data-date="' + dayStr + '">' + day + '</span>';
    }
    
    for (let day = 1; day <= lastDay.getDate(); day++) {
        const dayStr = String(day).padStart(2, '0') + '.' + String(calendarCurrentMonth + 1).padStart(2, '0') + '.' + calendarCurrentYear;
        const isSelected = dayStr === calendarSelectedDate;
        const isToday = dayStr === todayStr;
        html += '<span class="calendar-day' + (isSelected ? ' selected' : '') + (isToday ? ' today' : '') + '" data-date="' + dayStr + '">' + day + '</span>';
    }
    
    const totalCells = startDay + lastDay.getDate();
    const remainingCells = 42 - totalCells;
    for (let day = 1; day <= remainingCells; day++) {
        const nextDate = new Date(calendarCurrentYear, calendarCurrentMonth + 1, day);
        const dayStr = String(day).padStart(2, '0') + '.' + String(nextDate.getMonth() + 1).padStart(2, '0') + '.' + nextDate.getFullYear();
        const isSelected = dayStr === calendarSelectedDate;
        const isToday = dayStr === todayStr;
        html += '<span class="calendar-day other-month' + (isSelected ? ' selected' : '') + (isToday ? ' today' : '') + '" data-date="' + dayStr + '">' + day + '</span>';
    }
    
    html += '</div>';
    html += '<button class="calendar-today-btn" data-action="today">Täna</button>';
    
    popup.innerHTML = html;

    popup.querySelector('[data-action="prev-month"]')?.addEventListener('click', e => {
        e.stopPropagation();
        changeMonth(-1);
    });
    popup.querySelector('[data-action="next-month"]')?.addEventListener('click', e => {
        e.stopPropagation();
        changeMonth(1);
    });
    popup.querySelector('[data-action="today"]')?.addEventListener('click', e => {
        e.stopPropagation();
        selectTodayCalendar();
    });
    popup.querySelectorAll('.calendar-day[data-date]').forEach(el => {
        el.addEventListener('click', e => {
            e.stopPropagation();
            selectDateCalendar(el.dataset.date);
        });
    });
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

export function openDateCalendarDirect(td, index, col, currentValue, anchorEl) {
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
    renderCalendar();
    positionCalendarPopup(anchorEl || td);
    
    setTimeout(() => {
        document.addEventListener('click', handleCalendarClickOutside);
    }, 0);
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
