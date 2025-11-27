/**
 * Electron IPC Streaming Upload Örneği
 * Main Process - Backend
 */

const { app, BrowserWindow, ipcMain } = require("electron");
const S3StreamUploader = require("../src/services/s3-stream-uploader");
const fs = require("fs");

let mainWindow;
let uploader;

// S3 Uploader'ı başlat
function initializeUploader() {
  uploader = new S3StreamUploader({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: "us-east-1",
  });
}

// ==========================================
// IPC Handlers - Streaming Upload
// ==========================================

/**
 * Dosyadan streaming upload
 */
ipcMain.handle(
  "stream-upload-file",
  async (event, { filePath, bucket, key }) => {
    const uploadId = require("crypto").randomUUID();

    try {
      const result = await uploader.uploadFromFile(
        filePath,
        bucket,
        key,
        (progress) => {
          // Renderer'a progress gönder
          mainWindow.webContents.send("upload-progress", {
            uploadId,
            ...progress,
          });
        }
      );

      return { success: true, uploadId, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
);

/**
 * IPC streaming upload başlat
 * Frontend'den chunk'lar gelecek
 */
ipcMain.handle(
  "start-streaming-upload",
  async (event, { bucket, key, fileSize }) => {
    const uploadId = require("crypto").randomUUID();

    try {
      const { uploadPromise } = uploader.startIPCUpload(
        uploadId,
        bucket,
        key,
        fileSize,
        (progress) => {
          mainWindow.webContents.send("upload-progress", {
            uploadId,
            ...progress,
          });
        }
      );

      // Upload tamamlandığında bildir
      uploadPromise
        .then((result) => {
          mainWindow.webContents.send("upload-complete", {
            uploadId,
            result,
          });
        })
        .catch((error) => {
          mainWindow.webContents.send("upload-error", {
            uploadId,
            error: error.message,
          });
        });

      return { success: true, uploadId };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
);

/**
 * Chunk gönder
 */
ipcMain.handle("send-chunk", async (event, { uploadId, chunk }) => {
  try {
    uploader.writeChunk(uploadId, chunk);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

/**
 * Upload'ı tamamla
 */
ipcMain.handle("finish-upload", async (event, { uploadId }) => {
  try {
    uploader.endUpload(uploadId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

/**
 * Upload'ı iptal et
 */
ipcMain.handle("abort-upload", async (event, { uploadId }) => {
  try {
    await uploader.abortUpload(uploadId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

/**
 * Upload'ı duraklat
 */
ipcMain.handle("pause-upload", async (event, { uploadId }) => {
  try {
    const resumeInfo = await uploader.pauseUpload(uploadId);
    return { success: true, resumeInfo };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

/**
 * Upload'ı devam ettir
 */
ipcMain.handle("resume-upload", async (event, { uploadId, filePath }) => {
  try {
    const result = await uploader.resumeUpload(
      uploadId,
      filePath,
      (progress) => {
        mainWindow.webContents.send("upload-progress", {
          uploadId,
          ...progress,
        });
      }
    );
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ==========================================
// App Lifecycle
// ==========================================

app.whenReady().then(() => {
  initializeUploader();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: __dirname + "/preload.js",
    },
  });

  mainWindow.loadFile("index.html");
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
