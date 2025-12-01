const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Window kontrolleri
  minimizeWindow: () => ipcRenderer.send("window-minimize"),
  maximizeWindow: () => ipcRenderer.send("window-maximize"),
  closeWindow: () => ipcRenderer.send("window-close"),

  // FTP işlemleri
  ftpConnect: (config) => ipcRenderer.invoke("ftp-connect", config),
  ftpDisconnect: () => ipcRenderer.invoke("ftp-disconnect"),
  ftpList: (remotePath) => ipcRenderer.invoke("ftp-list", remotePath),
  ftpGetFolderSize: (remotePath) =>
    ipcRenderer.invoke("ftp-get-folder-size", remotePath),
  ftpUpload: (data) => ipcRenderer.invoke("ftp-upload", data),
  ftpDownload: (data) => ipcRenderer.invoke("ftp-download", data),
  ftpDelete: (remotePath) => ipcRenderer.invoke("ftp-delete", remotePath),
  ftpMkdir: (remotePath) => ipcRenderer.invoke("ftp-mkdir", remotePath),

  // S3 işlemleri
  s3Connect: (config) => ipcRenderer.invoke("s3-connect", config),
  s3Disconnect: () => ipcRenderer.invoke("s3-disconnect"),
  s3ListBuckets: () => ipcRenderer.invoke("s3-list-buckets"),
  s3CreateBucket: (bucketName) =>
    ipcRenderer.invoke("s3-create-bucket", bucketName),
  s3List: (data) => ipcRenderer.invoke("s3-list", data),
  s3GetFolderSize: (data) =>
    ipcRenderer.invoke("s3-get-folder-size", data),
  s3Upload: (data) => ipcRenderer.invoke("s3-upload", data),
  s3Download: (data) => ipcRenderer.invoke("s3-download", data),
  s3Delete: (data) => ipcRenderer.invoke("s3-delete", data),
  s3Mkdir: (data) => ipcRenderer.invoke("s3-mkdir", data),
  s3Move: (data) => ipcRenderer.invoke("s3-move", data),
  ftpMove: (data) => ipcRenderer.invoke("ftp-move", data),
  s3GenerateShareLink: (data) =>
    ipcRenderer.invoke("s3-generate-share-link", data),
  s3GetTags: (data) => ipcRenderer.invoke("s3-get-tags", data),
  s3PutTags: (data) => ipcRenderer.invoke("s3-put-tags", data),
  s3DeleteTags: (data) => ipcRenderer.invoke("s3-delete-tags", data),

  // Dosya dialogları
  showOpenDialog: (options) => ipcRenderer.invoke("show-open-dialog", options),
  showSaveDialog: (options) => ipcRenderer.invoke("show-save-dialog", options),
  getFileInfo: (filePath) => ipcRenderer.invoke("get-file-info", filePath),

  // Resim ve video önizleme
  getImagePreview: (data) => ipcRenderer.invoke("get-image-preview", data),
  getVideoPreview: (data) => ipcRenderer.invoke("get-video-preview", data),
  cleanupVideo: (videoId) => ipcRenderer.invoke("cleanup-video", videoId),

  getPlatform: () => process.platform,

  // Progress olayları
  onUploadProgress: (callback) =>
    ipcRenderer.on("upload-progress", (event, progress) => callback(progress)),
  onDownloadProgress: (callback) =>
    ipcRenderer.on("download-progress", (event, progress) =>
      callback(progress)
    ),

  // Olay dinleyicilerini kaldır
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
