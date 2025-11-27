/**
 * Preload Script - IPC Bridge
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("streamingAPI", {
  // Dosyadan direkt upload
  uploadFile: (filePath, bucket, key) =>
    ipcRenderer.invoke("stream-upload-file", { filePath, bucket, key }),

  // Chunk bazlı streaming
  startUpload: (bucket, key, fileSize) =>
    ipcRenderer.invoke("start-streaming-upload", { bucket, key, fileSize }),

  sendChunk: (uploadId, chunk) =>
    ipcRenderer.invoke("send-chunk", { uploadId, chunk }),

  finishUpload: (uploadId) => ipcRenderer.invoke("finish-upload", { uploadId }),

  abortUpload: (uploadId) => ipcRenderer.invoke("abort-upload", { uploadId }),

  pauseUpload: (uploadId) => ipcRenderer.invoke("pause-upload", { uploadId }),

  resumeUpload: (uploadId, filePath) =>
    ipcRenderer.invoke("resume-upload", { uploadId, filePath }),

  // Progress listeners
  onProgress: (callback) => {
    ipcRenderer.on("upload-progress", (event, data) => callback(data));
  },

  onComplete: (callback) => {
    ipcRenderer.on("upload-complete", (event, data) => callback(data));
  },

  onError: (callback) => {
    ipcRenderer.on("upload-error", (event, data) => callback(data));
  },
});
