const path = require('path');
const os = require('os');
const fs = require('fs');
const resizeImg = require('resize-img');
const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron');
const { spawn } = require('child_process');
const { parseResizeRequest } = require('./lib/resize-request');

const isDev = process.env.NODE_ENV !== 'production';
const isMac = process.platform === 'darwin';

let mainWindow;
let aboutWindow;

// Main Window
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: isDev ? 1000 : 500,
    height: 600,
    icon: `${__dirname}/assets/icons/Icon_256x256.png`,
    resizable: isDev,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Show devtools automatically if in development
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

    // mainWindow.loadURL(`file://${__dirname}/renderer/index.html`);
   mainWindow.loadFile(path.join(__dirname, './renderer/index.html'));
}

// About Window
function createAboutWindow() {
  aboutWindow = new BrowserWindow({
    width: 300,
    height: 300,
    title: 'About Electron',
    icon: `${__dirname}/assets/icons/Icon_256x256.png`,
  });

   aboutWindow.loadFile(path.join(__dirname, './renderer/about.html'));
}

// When the app is ready, create the window
app.on('ready', () => {
  createMainWindow();

  const mainMenu = Menu.buildFromTemplate(menu);
  Menu.setApplicationMenu(mainMenu);

  // Remove variable from memory
  mainWindow.on('closed', () => (mainWindow = null));
});

// Menu template
const menu = [
  ...(isMac
    ? [
        {
          label: app.name,
          submenu: [
            {
              label: 'About',
              click: createAboutWindow,
            },
          ],
        },
      ]
    : []),
  {
    role: 'fileMenu',
  },
  ...(!isMac
    ? [
        {
          label: 'Help',
          submenu: [
            {
              label: 'About',
              click: createAboutWindow,
            },
          ],
        },
      ]
    : []),
  // {
  //   label: 'File',
  //   submenu: [
  //     {
  //       label: 'Quit',
  //       click: () => app.quit(),
  //       accelerator: 'CmdOrCtrl+W',
  //     },
  //   ],
  // },
  ...(isDev
    ? [
        {
          label: 'Developer',
          submenu: [
            { role: 'reload' },
            { role: 'forcereload' },
            { type: 'separator' },
            { role: 'toggledevtools' },
          ],
        },
      ]
    : []),
];

// La page peut disparaître pendant une opération asynchrone (#1).
function sendIfAlive(sender, channel, ...args) {
  if (!sender.isDestroyed()) sender.send(channel, ...args);
}

const IMAGE_FILTERS = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif'] }];
// Image choisie par l'utilisateur dans la boîte de dialogue du main, par page.
// La page ne fournit jamais de chemin : elle ne peut pas faire lire un autre fichier (#3).
const chosenImages = new WeakMap();

ipcMain.handle('image:choose', async (e) => {
  const parent = BrowserWindow.fromWebContents(e.sender);
  const options = { properties: ['openFile'], filters: IMAGE_FILTERS };
  const { canceled, filePaths } = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  if (canceled || !filePaths[0]) return null;
  chosenImages.set(e.sender, filePaths[0]);
  return { name: path.basename(filePaths[0]) };
});

// Respond to the resize image event
ipcMain.on('image:resize', (e, request) => {
  const imgPath = chosenImages.get(e.sender);
  const size = parseResizeRequest(request);
  if (!imgPath || !size) {
    console.log('image:resize refusé : aucune image choisie ou dimensions invalides');
    return;
  }
  const dest = path.join(os.homedir(), 'imageresizer');
  resizeImage(e.sender, { imgPath, ...size, dest });
});

// Respond to the scan wifi event
ipcMain.on('scan:wifi', (e) => {
  console.log('scan:wifi');
  // execute un fichier python ; tué si la page disparaît avant la fin
  const pyprog = spawn('python', ['./renderer/python/scanWifi.py']);
  const stop = () => pyprog.kill();
  e.sender.once('destroyed', stop);
  pyprog.on('error', (err) => console.log(`scan:wifi : ${err.message}`));
  pyprog.on('close', () => e.sender.removeListener('destroyed', stop));
  pyprog.stdout.on('data', (data) => {
    console.log(data.toString());
    sendIfAlive(e.sender, 'scan:wifi', data.toString());
  });
});

// Resize and save image
async function resizeImage(sender, { imgPath, height, width, dest }) {
  try {
    // Resize image
    const newPath = await resizeImg(fs.readFileSync(imgPath), { width, height });

    // Get filename
    const filename = path.basename(imgPath);

    // Create destination folder if it doesn't exist
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest);
    }

    // Write the file to the destination folder
    fs.writeFileSync(path.join(dest, filename), newPath);

    // Send success to renderer
    sendIfAlive(sender, 'image:done');

    // Open the folder in the file explorer
    shell.openPath(dest);
  } catch (err) {
    console.log(err);
  }
}

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

// Open a window if none are open (macOS)
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
