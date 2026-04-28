const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Store = require('electron-store');

const store = new Store({ name: 'jobs-data' });

const DEFAULT_JOBS = [
    {
        'Töö Nr': 'W26001',
        'Valmis': false,
        'Valmis kpv': '',
        'Tegevuse sisestaja nimi': '',
        'Detaili/koostu nimetus või joonise Nr': '',
        'Kommentaar(tooriku/detaili seis, muu oluline info)': '',
        'Otsuse/Tegevuse vastutaja': '',
        'Tooriku saabumise kuupäev EE': '',
        ' EE vajaduse kuupäev (koostamiseks valmis kujul)': '',
        'Meeldetuletus  X päeva ennem': '',
        'Töötluse algus': '',
        'Alustatud': false,
        'Alustamise kpv': '',
        'EE töötluse lõpp': '',
        'Töötlus Lõpetatud': false,
        'Töötlus allhankes': false,
        'Täitmise koht': '',
        'EE kuupäev tarne': '',
        'TE kuupäev tarne': '',
        'Info sisestamise kuupäev': new Date().toISOString().split('T')[0]
    }
];

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

ipcMain.handle('load-data', () => {
    const saved = store.get('jobs', null);
    if (saved && Array.isArray(saved) && saved.length > 0) {
        return saved;
    }
    store.set('jobs', DEFAULT_JOBS);
    return DEFAULT_JOBS;
});

ipcMain.handle('save-data', (event, data) => {
    store.set('jobs', data);
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    app.quit();
});