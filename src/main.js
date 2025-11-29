const { app, BrowserWindow, ipcMain, dialog, protocol } = require("electron");
const path = require("path");
const fs = require("fs");
const FTPService = require("./services/ftp-service");
const S3Service = require("./services/s3-service");
const http = require("http");

let mainWindow;
let ftpService = null;
let s3Service = null;
let videoStreamServer = null;
let currentVideoPath = null;
let videoDownloadProgress = new Map(); // track download progress
let activeStreams = new Map(); // track active video streams

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: "#0a0a0f",
    titleBarStyle: "hiddenInset",
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  // Geliştirme modunda DevTools aç (kapalı)
  // if (process.argv.includes("--enable-logging")) {
  //   mainWindow.webContents.openDevTools();
  // }
}

app.whenReady().then(() => {
  createWindow();
  startVideoStreamServer();
});

app.on("window-all-closed", () => {
  if (videoStreamServer) {
    videoStreamServer.close();
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Window kontrolleri
ipcMain.on("window-minimize", () => mainWindow.minimize());
ipcMain.on("window-maximize", () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});
ipcMain.on("window-close", () => mainWindow.close());

// FTP İşlemleri
ipcMain.handle("ftp-connect", async (event, config) => {
  try {
    ftpService = new FTPService();
    await ftpService.connect(config);
    return { success: true, message: "FTP bağlantısı başarılı!" };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle("ftp-disconnect", async () => {
  try {
    if (ftpService) {
      await ftpService.disconnect();
      ftpService = null;
    }
    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle("ftp-list", async (event, remotePath) => {
  try {
    if (!ftpService) throw new Error("FTP bağlantısı yok");
    const files = await ftpService.list(remotePath);
    return { success: true, files };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle("ftp-upload", async (event, { localPath, remotePath }) => {
  try {
    if (!ftpService) throw new Error("FTP bağlantısı yok");
    await ftpService.upload(localPath, remotePath, (progress) => {
      mainWindow.webContents.send("upload-progress", progress);
    });
    return { success: true, message: "Dosya yüklendi!" };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle("ftp-download", async (event, { remotePath, localPath }) => {
  try {
    if (!ftpService) throw new Error("FTP bağlantısı yok");
    await ftpService.download(remotePath, localPath, (progress) => {
      mainWindow.webContents.send("download-progress", progress);
    });
    return { success: true, message: "Dosya indirildi!" };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle("ftp-delete", async (event, remotePath) => {
  try {
    if (!ftpService) throw new Error("FTP bağlantısı yok");
    await ftpService.delete(remotePath);
    return { success: true, message: "Dosya silindi!" };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle("ftp-mkdir", async (event, remotePath) => {
  try {
    if (!ftpService) throw new Error("FTP bağlantısı yok");
    await ftpService.mkdir(remotePath);
    return { success: true, message: "Klasör oluşturuldu!" };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

// S3 İşlemleri
ipcMain.handle("s3-connect", async (event, config) => {
  try {
    s3Service = new S3Service(config);
    await s3Service.testConnection();
    return { success: true, message: "S3 bağlantısı başarılı!" };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle("s3-disconnect", async () => {
  s3Service = null;
  return { success: true };
});

ipcMain.handle("s3-list-buckets", async () => {
  try {
    if (!s3Service) throw new Error("S3 bağlantısı yok");
    const buckets = await s3Service.listBuckets();
    return { success: true, buckets };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle("s3-create-bucket", async (event, bucketName) => {
  try {
    if (!s3Service) throw new Error("S3 bağlantısı yok");
    await s3Service.createBucket(bucketName);
    return { success: true, message: "Bucket oluşturuldu!" };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle("s3-list", async (event, { bucket, prefix }) => {
  try {
    if (!s3Service) throw new Error("S3 bağlantısı yok");
    const files = await s3Service.listObjects(bucket, prefix);
    return { success: true, files };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle("s3-upload", async (event, { localPath, bucket, key }) => {
  try {
    if (!s3Service) throw new Error("S3 bağlantısı yok");
    await s3Service.upload(localPath, bucket, key, (progress) => {
      mainWindow.webContents.send("upload-progress", progress);
    });
    return { success: true, message: "Dosya S3'e yüklendi!" };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle("s3-download", async (event, { bucket, key, localPath }) => {
  try {
    if (!s3Service) throw new Error("S3 bağlantısı yok");
    await s3Service.download(bucket, key, localPath, (progress) => {
      mainWindow.webContents.send("download-progress", progress);
    });
    return { success: true, message: "Dosya indirildi!" };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle("s3-delete", async (event, { bucket, key }) => {
  try {
    if (!s3Service) throw new Error("S3 bağlantısı yok");
    await s3Service.delete(bucket, key);
    return { success: true, message: "Dosya silindi!" };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle("s3-mkdir", async (event, { bucket, key }) => {
  try {
    if (!s3Service) throw new Error("S3 bağlantısı yok");
    await s3Service.mkdir(bucket, key);
    return { success: true, message: "Klasör oluşturuldu!" };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle("s3-move", async (event, { bucket, sourceKey, destKey }) => {
  try {
    if (!s3Service) throw new Error("S3 bağlantısı yok");
    // S3'te move = copy + delete
    await s3Service.copyObject(bucket, sourceKey, bucket, destKey);
    await s3Service.delete(bucket, sourceKey);
    return { success: true, message: "Dosya taşındı!" };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle("ftp-move", async (event, { sourcePath, destPath }) => {
  try {
    if (!ftpService) throw new Error("FTP bağlantısı yok");
    await ftpService.rename(sourcePath, destPath);
    return { success: true, message: "Dosya taşındı!" };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle(
  "s3-generate-share-link",
  async (event, { bucket, key, expiresIn }) => {
    try {
      if (!s3Service) throw new Error("S3 bağlantısı yok");
      const url = await s3Service.generateShareLink(bucket, key, expiresIn);
      return { success: true, url };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
);

// S3 Tag işlemleri
ipcMain.handle("s3-get-tags", async (event, { bucket, key }) => {
  try {
    if (!s3Service) throw new Error("S3 bağlantısı yok");
    const tags = await s3Service.getObjectTags(bucket, key);
    return { success: true, tags };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle("s3-put-tags", async (event, { bucket, key, tags }) => {
  try {
    if (!s3Service) throw new Error("S3 bağlantısı yok");
    await s3Service.putObjectTags(bucket, key, tags);
    return { success: true, message: "Tag'ler kaydedildi!" };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle("s3-delete-tags", async (event, { bucket, key }) => {
  try {
    if (!s3Service) throw new Error("S3 bağlantısı yok");
    await s3Service.deleteObjectTags(bucket, key);
    return { success: true, message: "Tag'ler silindi!" };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

// Dosya Dialog
ipcMain.handle("show-open-dialog", async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result;
});

ipcMain.handle("show-save-dialog", async (event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, options);
  return result;
});

// Dosya bilgisi
ipcMain.handle("get-file-info", async (event, filePath) => {
  try {
    const stats = fs.statSync(filePath);
    return {
      success: true,
      info: {
        name: path.basename(filePath),
        size: stats.size,
        isDirectory: stats.isDirectory(),
        modified: stats.mtime,
      },
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

// Resim formatını magic bytes ile tespit et
function detectImageMimeType(buffer, fileName) {
  if (!buffer || buffer.length < 4) {
    return null;
  }

  // Magic bytes ile format tespiti
  const header = buffer.slice(0, 12);
  
  // JPEG: FF D8 FF
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return "image/jpeg";
  }
  
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) {
    return "image/png";
  }
  
  // GIF: 47 49 46 38 (GIF8)
  if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x38) {
    return "image/gif";
  }
  
  // BMP: 42 4D (BM)
  if (header[0] === 0x42 && header[1] === 0x4d) {
    return "image/bmp";
  }
  
  // WebP: RIFF...WEBP
  if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46) {
    const webpHeader = buffer.slice(8, 12);
    if (webpHeader[0] === 0x57 && webpHeader[1] === 0x45 && webpHeader[2] === 0x42 && webpHeader[3] === 0x50) {
      return "image/webp";
    }
  }
  
  // SVG: XML formatında başlar (<svg veya <?xml)
  const textStart = buffer.slice(0, Math.min(100, buffer.length)).toString("utf-8").trim();
  if (textStart.startsWith("<?xml") || textStart.startsWith("<svg")) {
    return "image/svg+xml";
  }
  
  // Eğer magic bytes ile tespit edilemezse, uzantıya bak
  const ext = path.extname(fileName).toLowerCase();
  const mimeTypes = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
  };
  
  return mimeTypes[ext] || null;
}

// Resim önizleme için geçici indirme
ipcMain.handle(
  "get-image-preview",
  async (event, { type, remotePath, bucket, key }) => {
    try {
      console.log("Preview request:", { type, remotePath, bucket, key });

      const tempDir = path.join(
        app.getPath("temp"),
        "cloud-file-manager-preview"
      );
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const fileName =
        type === "ftp" ? path.basename(remotePath) : path.basename(key);
      const tempPath = path.join(tempDir, `preview_${Date.now()}_${fileName}`);

      console.log("Downloading to:", tempPath);

      if (type === "ftp") {
        if (!ftpService) throw new Error("FTP bağlantısı yok");
        await ftpService.download(remotePath, tempPath, () => {});
      } else {
        if (!s3Service) throw new Error("S3 bağlantısı yok");
        await s3Service.download(bucket, key, tempPath, () => {});
      }

      console.log("Download completed, reading file...");

      // Dosyanın var olduğunu kontrol et
      if (!fs.existsSync(tempPath)) {
        throw new Error("İndirilen dosya bulunamadı");
      }

      // Dosya boyutunu kontrol et
      const stats = fs.statSync(tempPath);
      console.log("File size:", stats.size, "bytes");

      if (stats.size === 0) {
        fs.unlinkSync(tempPath);
        throw new Error("İndirilen dosya boş");
      }

      // Dosya formatını magic bytes ile tespit et
      const fileBuffer = fs.readFileSync(tempPath);
      const mimeType = detectImageMimeType(fileBuffer, fileName);
      
      if (!mimeType) {
        fs.unlinkSync(tempPath);
        throw new Error("Dosya formatı desteklenmiyor. Desteklenen formatlar: JPEG, PNG, GIF, WebP, BMP, SVG");
      }

      // Dosyayı base64 olarak oku
      const imageData = fileBuffer.toString("base64");

      // Geçici dosyayı sil
      try {
        fs.unlinkSync(tempPath);
      } catch (e) {
        console.warn("Temp file cleanup failed:", e.message);
      }

      console.log("Preview success:", fileName, mimeType);

      return {
        success: true,
        data: imageData,
        mimeType,
      };
    } catch (error) {
      console.error("Preview error:", error);
      return { success: false, message: error.message };
    }
  }
);

// Video önizleme için chunk-based streaming
ipcMain.handle(
  "get-video-preview",
  async (event, { type, remotePath, bucket, key }) => {
    const debugStart = Date.now();
    const debugLog = (stage) => console.log(`[VIDEO-MAIN] ${stage} +${Date.now() - debugStart}ms`);
    
    try {
      debugLog('IPC_BAŞLADI');
      console.log("Video preview request:", { type, remotePath, bucket, key });

      const fileName =
        type === "ftp" ? path.basename(remotePath) : path.basename(key);
      const videoId = `${Date.now()}_${fileName}`;

      // MIME type belirle
      const ext = path.extname(fileName).toLowerCase();
      const mimeTypes = {
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".ogg": "video/ogg",
        ".ogv": "video/ogg",
        ".avi": "video/x-msvideo",
        ".mov": "video/quicktime",
        ".wmv": "video/x-ms-wmv",
        ".flv": "video/x-flv",
        ".mkv": "video/x-matroska",
        ".m4v": "video/mp4",
      };
      const mimeType = mimeTypes[ext] || "video/mp4";

      if (type === "s3") {
        // S3 için pre-signed URL kullan (en hızlı yöntem)
        if (!s3Service) throw new Error("S3 bağlantısı yok");

        debugLog('S3_PRESIGNED_URL_OLUŞTURULUYOR');
        const signedUrl = await s3Service.getSignedUrl(bucket, key, 3600); // 1 saat geçerli
        debugLog('S3_PRESIGNED_URL_HAZIR');

        return {
          success: true,
          streamUrl: signedUrl,
          mimeType,
          fileName,
          isDirect: true, // Pre-signed URL kullanıldığını belirt
        };
      } else {
        // FTP için progressive download + stream
        if (!ftpService) throw new Error("FTP bağlantısı yok");

        const tempDir = path.join(
          app.getPath("temp"),
          "cloud-file-manager-preview"
        );
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }

        const tempPath = path.join(tempDir, videoId);

        // Stream bilgisini kaydet
        activeStreams.set(videoId, {
          tempPath,
          remotePath,
          downloading: true,
          bytesDownloaded: 0,
          totalSize: 0,
        });

        // Arka planda indir
        downloadVideoInBackground(remotePath, tempPath, videoId);

        console.log("FTP stream started:", videoId);

        return {
          success: true,
          streamUrl: `http://localhost:8888/video/${videoId}`,
          mimeType,
          fileName,
          isDirect: false,
        };
      }
    } catch (error) {
      console.error("Video preview error:", error);
      return { success: false, message: error.message };
    }
  }
);

// Arka planda video indir
async function downloadVideoInBackground(remotePath, tempPath, videoId) {
  try {
    // Boş dosya oluştur (streaming için gerekli)
    fs.writeFileSync(tempPath, "");

    const writeStream = fs.createWriteStream(tempPath, { flags: "w" });

    // FTP'den chunk chunk indir
    await ftpService.download(remotePath, tempPath, (progress) => {
      const streamInfo = activeStreams.get(videoId);
      if (streamInfo) {
        streamInfo.bytesDownloaded = progress.downloaded || 0;
        streamInfo.totalSize = progress.total || 0;
        console.log(
          `Download progress for ${videoId}: ${progress.percentage}%`
        );
      }
    });

    const streamInfo = activeStreams.get(videoId);
    if (streamInfo) {
      streamInfo.downloading = false;
      console.log(`Download completed for ${videoId}`);
    }
  } catch (error) {
    console.error(`Background download error for ${videoId}:`, error);
    const streamInfo = activeStreams.get(videoId);
    if (streamInfo) {
      streamInfo.downloading = false;
      streamInfo.error = error.message;
    }
  }
}

// Video temizleme
ipcMain.handle("cleanup-video", async (event, videoId) => {
  try {
    if (videoId && activeStreams.has(videoId)) {
      const streamInfo = activeStreams.get(videoId);
      if (streamInfo.tempPath && fs.existsSync(streamInfo.tempPath)) {
        try {
          fs.unlinkSync(streamInfo.tempPath);
          console.log("Video cleaned up:", videoId);
        } catch (e) {
          console.warn("Could not delete immediately, will retry:", e.message);
        }
      }
      activeStreams.delete(videoId);
    }

    // Legacy cleanup
    if (currentVideoPath && fs.existsSync(currentVideoPath)) {
      try {
        fs.unlinkSync(currentVideoPath);
      } catch (e) {
        console.warn("Legacy cleanup failed:", e.message);
      }
      currentVideoPath = null;
    }

    return { success: true };
  } catch (error) {
    console.error("Cleanup error:", error);
    return { success: false, message: error.message };
  }
});

// Video stream server (chunk-based)
function startVideoStreamServer() {
  videoStreamServer = http.createServer(async (req, res) => {
    if (req.url.startsWith("/video/")) {
      const videoId = path.basename(req.url);
      const streamInfo = activeStreams.get(videoId);

      if (!streamInfo) {
        res.writeHead(404);
        res.end("Video not found");
        return;
      }

      const videoFile = streamInfo.tempPath;

      // Video dosyası oluşturulana kadar bekle
      let waitCount = 0;
      while (!fs.existsSync(videoFile) && waitCount < 50) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        waitCount++;
      }

      if (!fs.existsSync(videoFile)) {
        res.writeHead(503);
        res.end("Video preparing...");
        return;
      }

      const stat = fs.statSync(videoFile);
      let fileSize = stat.size;

      // Eğer hala indirme devam ediyorsa, şu anki boyutu kullan
      if (streamInfo.downloading && streamInfo.totalSize > 0) {
        fileSize = streamInfo.totalSize;
      }

      const range = req.headers.range;

      if (range) {
        // Range request için (seeking)
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        let end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;

        // İndirme devam ediyorsa, sadece indirilen kısmı stream et
        if (streamInfo.downloading) {
          const availableBytes = stat.size;
          if (end >= availableBytes) {
            end = availableBytes - 1;
          }
        }

        // Geçerli range kontrolü
        if (start >= stat.size) {
          res.writeHead(416, {
            "Content-Range": `bytes */${fileSize}`,
          });
          res.end();
          return;
        }

        const chunksize = end - start + 1;
        const file = fs.createReadStream(videoFile, { start, end });

        const head = {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize,
          "Content-Type": "video/mp4",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache",
        };

        res.writeHead(206, head);
        file.pipe(res);

        file.on("error", (err) => {
          console.error("Stream error:", err);
          if (!res.headersSent) {
            res.writeHead(500);
          }
          res.end();
        });
      } else {
        // Normal request
        const head = {
          "Content-Length": fileSize,
          "Content-Type": "video/mp4",
          "Accept-Ranges": "bytes",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache",
        };
        res.writeHead(200, head);

        const stream = fs.createReadStream(videoFile);
        stream.pipe(res);

        stream.on("error", (err) => {
          console.error("Stream error:", err);
          if (!res.headersSent) {
            res.writeHead(500);
          }
          res.end();
        });
      }
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  videoStreamServer.listen(8888, () => {
    console.log("Chunk-based video stream server started on port 8888");
  });
}
