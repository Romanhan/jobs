export const COLUMNS = [
    'Töö Nr', 'Valmis', 'Valmis kpv',
    'Detaili/koostu nimetus või joonise Nr', 'Kommentaar(tooriku/detaili seis, muu oluline info)',
    'Otsuse/Tegevuse vastutaja', 'Tooriku saabumise kuupäev EE',
    'EE vajaduse kuupäev (koostamiseks valmis kujul)', 'Meeldetuletus X päeva ennem',
    'Töötluse algus', 'Alustatud', 'Alustamise kpv', 'EE töötluse lõpp',
    'Töötlus Lõpetatud', 'Töötlus allhankes', 'Täitmise koht',
    'EE kuupäev tarne', 'TE kuupäev tarne', 'Info sisestamise kuupäev',
    'Tegevuse sisestaja nimi'
];

// Short header labels and full-name tooltips live in i18n.js (columnLabel/columnTitle).

// export const COLUMN_WIDTHS = {
//     'Töö Nr': 80, 'Valmis': 45, 'Valmis kpv': 85, 'Tegevuse sisestaja nimi': 70,
//     'Detaili/koostu nimetus või joonise Nr': 120, 'Kommentaar(tooriku/detaili seis, muu oluline info)': 200,
//     'Otsuse/Tegevuse vastutaja': 70, 'Tooriku saabumise kuupäev EE': 70,
//     'EE vajaduse kuupäev (koostamiseks valmis kujul)': 90, 'Meeldetuletus X päeva ennem': 60,
//     'Töötluse algus': 80, 'Alustatud': 55, 'Alustamise kpv': 85,
//     'EE töötluse lõpp': 80, 'Töötlus Lõpetatud': 70, 'Töötlus allhankes': 70,
//     'Täitmise koht': 90, 'EE kuupäev tarne': 80, 'TE kuupäev tarne': 80,
//     'Info sisestamise kuupäev': 90
// };

export const DATE_COLS = ['Valmis kpv', 'Info sisestamise kuupäev',
    'EE vajaduse kuupäev (koostamiseks valmis kujul)', 'Töötluse algus',
    'Alustamise kpv', 'EE töötluse lõpp', 'EE kuupäev tarne', 'TE kuupäev tarne'];

export const CHECKBOX_COLS = ['Valmis', 'Alustatud', 'Töötlus Lõpetatud', 'Töötlus allhankes'];
export const HIDDEN_COLS = ['Valmis kpv', 'Alustamise kpv', 'Meeldetuletus X päeva ennem'];
export const COLUMN_WRAP = [];

export const STICKY_COLS = ['Töö Nr', 'Valmis', 'Detaili/koostu nimetus või joonise Nr'];

export const FORM_FIELDS = [
    { col: 'Töö Nr', required: true, labelKey: 'form.jobNr', width: 120, line: 1 },
    { col: 'Detaili/koostu nimetus või joonise Nr', labelKey: 'form.detail', width: 120, line: 1 },
    { col: 'Kommentaar(tooriku/detaili seis, muu oluline info)', labelKey: 'form.comment', width: 146, line: 1 },
    { col: 'Tooriku saabumise kuupäev EE', labelKey: 'form.arrival', isDate: true, width: 120, line: 2 },
    { col: 'EE vajaduse kuupäev (koostamiseks valmis kujul)', labelKey: 'form.need', isDate: true, width: 120, line: 2 },
    { col: 'Täitmise koht', labelKey: 'form.location', width: 120, line: 3 },
    { col: 'Tegevuse sisestaja nimi', labelKey: 'form.enteredBy', width: 120, line: 3 }
];

export const DEADLINE_WARNING_DAYS = 7;