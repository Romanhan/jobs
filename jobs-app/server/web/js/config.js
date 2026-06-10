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

export const COLUMN_LABELS = {
    'Kommentaar(tooriku/detaili seis, muu oluline info)': 'Kommentaar',
    'Detaili/koostu nimetus või joonise Nr': 'Detail/koostu',
    'EE vajaduse kuupäev (koostamiseks valmis kujul)': 'EE vajadus',
    'Meeldetuletus X päeva ennem': 'Meeldetuletus',
    'Tegevuse sisestaja nimi': 'Sisestaja',
    'Otsuse/Tegevuse vastutaja': 'Vastutaja',
    'Tooriku saabumise kuupäev EE': 'Saabunud',
    'Valmis kpv': 'Valmis',
    'Alustamise kpv': 'Alustamine',
    'Töötluse algus': 'Töötlus algus',
    'EE töötluse lõpp': 'EE lõpp',
    'Info sisestamise kuupäev': 'Sisestatud',
    'EE kuupäev tarne': 'EE tarne',
    'TE kuupäev tarne': 'TE tarne',
    'Töötlus Lõpetatud': 'Lõpetatud',
    'Töötlus allhankes': 'Allhankes'
};

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
    { col: 'Töö Nr', required: true, label: 'Töö Nr', width: 120, line: 1 },
    { col: 'Detaili/koostu nimetus või joonise Nr', label: 'Detail/koostu', width: 120, line: 1 },
    { col: 'Kommentaar(tooriku/detaili seis, muu oluline info)', label: 'Kommentaar', width: 146, line: 1 },
    { col: 'Tooriku saabumise kuupäev EE', label: 'Saabumine', isDate: true, width: 120, line: 2 },
    { col: 'EE vajaduse kuupäev (koostamiseks valmis kujul)', label: 'Vajadus', isDate: true, width: 120, line: 2 },
    { col: 'Täitmise koht', label: 'Koht', width: 120, line: 3 },
    { col: 'Tegevuse sisestaja nimi', label: 'Sisestaja', width: 120, line: 3 }
];

export const DEADLINE_WARNING_DAYS = 7;