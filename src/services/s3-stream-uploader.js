const { S3Client } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const fs = require("fs");
const { PassThrough } = require("stream");
const crypto = require("crypto");

/**
 * S3 Streaming Uploader - Google Drive tarzı kesintisiz upload
 * Resume desteği + IPC entegrasyonu
 */
class S3StreamUploader {
  constructor(config) {
    const {
      accessKeyId,
      secretAccessKey,
      region = "us-east-1",
      endpoint,
    } = config;

    this.s3Client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
      ...(endpoint && { endpoint, forcePathStyle: true }),
    });

    this.activeUploads = new Map();
    this.resumeData = new Map();
  }

  /**
   * Dosyadan streaming upload
   * @param {string} filePath - Yerel dosya yolu
   * @param {string} bucket - S3 bucket
   * @param {string} key - S3 key
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<object>} Upload result
   */
  async uploadFromFile(filePath, bucket, key, onProgress) {
    const uploadId = crypto.randomUUID();
    const fileSize = fs.statSync(filePath).size;

    // Kesintisiz stream - RAM'e yüklenmez
    const fileStream = fs.createReadStream(filePath, {
      highWaterMark: 64 * 1024 * 1024, // 64MB buffer - Google Drive tarzı
    });

    return this._createUpload(
      uploadId,
      bucket,
      key,
      fileStream,
      fileSize,
      onProgress
    );
  }

  /**
   * IPC üzerinden streaming upload başlat
   * Frontend'den chunk'lar gelecek
   */
  startIPCUpload(uploadId, bucket, key, estimatedSize, onProgress) {
    const passThrough = new PassThrough({
      highWaterMark: 32 * 1024 * 1024, // 32MB buffer
    });

    const uploadPromise = this._createUpload(
      uploadId,
      bucket,
      key,
      passThrough,
      estimatedSize,
      onProgress
    );

    // Stream'i kaydet - chunk'lar buraya yazılacak
    this.activeUploads.get(uploadId).stream = passThrough;

    return { uploadId, uploadPromise };
  }

  /**
   * IPC'den gelen chunk'ı stream'e yaz
   */
  writeChunk(uploadId, chunk) {
    const uploadData = this.activeUploads.get(uploadId);
    if (!uploadData || !uploadData.stream) {
      throw new Error(`Upload not found: ${uploadId}`);
    }

    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    return uploadData.stream.write(buffer);
  }

  /**
   * Upload'ı tamamla (stream'i kapat)
   */
  endUpload(uploadId) {
    const uploadData = this.activeUploads.get(uploadId);
    if (uploadData && uploadData.stream) {
      uploadData.stream.end();
    }
  }

  /**
   * Upload'ı iptal et
   */
  async abortUpload(uploadId) {
    const uploadData = this.activeUploads.get(uploadId);
    if (!uploadData) return;

    try {
      await uploadData.upload.abort();
      if (uploadData.stream) {
        uploadData.stream.destroy();
      }
    } finally {
      this.activeUploads.delete(uploadId);
    }
  }

  /**
   * Upload'ı duraklat (resume için bilgileri kaydet)
   */
  async pauseUpload(uploadId) {
    const uploadData = this.activeUploads.get(uploadId);
    if (!uploadData) return;

    // Mevcut durumu kaydet
    const resumeInfo = {
      bucket: uploadData.bucket,
      key: uploadData.key,
      uploadId: uploadData.upload.uploadId, // S3 multipart upload ID
      uploadedBytes: uploadData.uploadedBytes || 0,
      timestamp: Date.now(),
    };

    this.resumeData.set(uploadId, resumeInfo);

    // Upload'ı durdur
    await this.abortUpload(uploadId);

    return resumeInfo;
  }

  /**
   * Upload'ı devam ettir (resume)
   */
  async resumeUpload(uploadId, filePath, onProgress) {
    const resumeInfo = this.resumeData.get(uploadId);
    if (!resumeInfo) {
      throw new Error("Resume bilgisi bulunamadı");
    }

    const fileSize = fs.statSync(filePath).size;
    const startByte = resumeInfo.uploadedBytes;

    // Kaldığı yerden okumaya başla
    const fileStream = fs.createReadStream(filePath, {
      start: startByte,
      highWaterMark: 64 * 1024 * 1024,
    });

    // Yeni upload oluştur
    const result = await this._createUpload(
      uploadId,
      resumeInfo.bucket,
      resumeInfo.key,
      fileStream,
      fileSize - startByte,
      (progress) => {
        // Progress'e başlangıç byte'ını ekle
        if (onProgress) {
          onProgress({
            ...progress,
            uploaded: progress.uploaded + startByte,
            total: fileSize,
          });
        }
      }
    );

    this.resumeData.delete(uploadId);
    return result;
  }

  /**
   * Internal: Upload oluştur ve başlat
   */
  async _createUpload(uploadId, bucket, key, stream, totalSize, onProgress) {
    // Dosya boyutuna göre optimal ayarlar
    let partSize, queueSize;

    if (totalSize < 50 * 1024 * 1024) {
      // < 50MB
      partSize = 10 * 1024 * 1024; // 10MB
      queueSize = 2;
    } else if (totalSize < 500 * 1024 * 1024) {
      // 50-500MB
      partSize = 50 * 1024 * 1024; // 50MB
      queueSize = 4;
    } else if (totalSize < 2 * 1024 * 1024 * 1024) {
      // 500MB-2GB
      partSize = 100 * 1024 * 1024; // 100MB
      queueSize = 6;
    } else {
      // 2GB+
      partSize = 100 * 1024 * 1024;
      queueSize = 8;
    }

    const upload = new Upload({
      client: this.s3Client,
      params: {
        Bucket: bucket,
        Key: key,
        Body: stream,
        // Checksum hesaplamayı devre dışı bırak (streaming ile uyumsuz)
      },
      queueSize,
      partSize,
      leavePartsOnError: false,
      // Checksum hesaplamayı devre dışı bırak
      requestChecksumCalculation: false,
    });

    // Upload bilgilerini kaydet
    this.activeUploads.set(uploadId, {
      upload,
      bucket,
      key,
      startTime: Date.now(),
      uploadedBytes: 0,
    });

    // Progress tracking - throttled
    let lastProgressTime = 0;
    const progressThrottle = 100; // 100ms

    upload.on("httpUploadProgress", (progress) => {
      const now = Date.now();
      const uploadData = this.activeUploads.get(uploadId);

      if (uploadData) {
        uploadData.uploadedBytes = progress.loaded || 0;
      }

      // Throttled progress callback
      if (
        onProgress &&
        (now - lastProgressTime >= progressThrottle ||
          progress.loaded === totalSize)
      ) {
        const percentage =
          totalSize > 0 ? Math.round((progress.loaded / totalSize) * 100) : 0;

        onProgress({
          percentage,
          uploaded: progress.loaded || 0,
          total: totalSize,
          uploadId,
        });

        lastProgressTime = now;
      }
    });

    try {
      const result = await upload.done();
      this.activeUploads.delete(uploadId);
      return result;
    } catch (error) {
      // Hata durumunda resume için bilgileri sakla
      const uploadData = this.activeUploads.get(uploadId);
      if (uploadData) {
        this.resumeData.set(uploadId, {
          bucket,
          key,
          uploadId: upload.uploadId,
          uploadedBytes: uploadData.uploadedBytes,
          timestamp: Date.now(),
        });
      }
      this.activeUploads.delete(uploadId);
      throw error;
    }
  }

  /**
   * Aktif upload'ları listele
   */
  getActiveUploads() {
    return Array.from(this.activeUploads.entries()).map(([id, data]) => ({
      uploadId: id,
      bucket: data.bucket,
      key: data.key,
      uploadedBytes: data.uploadedBytes,
      startTime: data.startTime,
    }));
  }

  /**
   * Resume edilebilir upload'ları listele
   */
  getResumableUploads() {
    return Array.from(this.resumeData.entries()).map(([id, info]) => ({
      uploadId: id,
      ...info,
    }));
  }
}

module.exports = S3StreamUploader;
