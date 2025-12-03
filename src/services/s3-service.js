const {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  GetObjectTaggingCommand,
  PutObjectTaggingCommand,
  DeleteObjectTaggingCommand,
  CopyObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { Upload } = require("@aws-sdk/lib-storage");
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");

class S3Service {
  constructor(config) {
    const {
      accessKeyId,
      secretAccessKey,
      region = "us-east-1",
      endpoint,
    } = config;

    // Keep-alive agent - bağlantıları yeniden kullan
    const agent = new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 3000,
      maxSockets: 50, // Paralel bağlantı sayısı
      maxFreeSockets: 10, // Boşta bekleyen bağlantı sayısı
      timeout: 120000, // 2 dakika timeout
    });

    const clientConfig = {
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      // Optimized HTTP handler
      requestHandler: new NodeHttpHandler({
        httpsAgent: agent,
        connectionTimeout: 10000, // 10 saniye bağlantı timeout
        socketTimeout: 120000, // 2 dakika socket timeout
      }),
    };

    // Özel endpoint (MinIO, DigitalOcean Spaces vb. için)
    if (endpoint) {
      clientConfig.endpoint = endpoint;
      clientConfig.forcePathStyle = true;
      // MinIO için ek ayarlar
      clientConfig.tls = endpoint.startsWith("https");
      clientConfig.apiVersion = "2006-03-01";
    }

    this.client = new S3Client(clientConfig);
    this.region = region;

    // Aktif upload/download takibi (iptal için)
    this.activeUploads = new Map(); // key: fileName, value: { upload, controller, localPath, bucket, key, fileSize, uploadedBytes }
    this.activeDownloads = new Map(); // key: fileName, value: { controller, stream }
    
    // Duraklatılmış transferler (resume için)
    this.pausedUploads = new Map(); // key: fileName, value: { localPath, bucket, key, fileSize, uploadedBytes }
    this.pausedDownloads = new Map(); // key: fileName, value: { bucket, key, localPath, fileSize, downloadedBytes }

    // Connection warming flag
    this._connectionWarmed = false;
  }

  async testConnection() {
    try {
      await this.client.send(new ListBucketsCommand({}));
      return true;
    } catch (error) {
      throw new Error(`S3 bağlantı hatası: ${error.message}`);
    }
  }

  // Bağlantıyı "ısıtmak" için - ilk upload'dan önce çağrılabilir
  async warmupConnection(bucket) {
    try {
      // Bucket'a HEAD isteği at (çok hafif)
      await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
      return true;
    } catch (error) {
      // Hata olsa bile bağlantı kurulmuş olur
      return true;
    }
  }

  async listBuckets() {
    const response = await this.client.send(new ListBucketsCommand({}));
    return response.Buckets.map((bucket) => ({
      name: bucket.Name,
      creationDate: bucket.CreationDate,
    }));
  }

  async createBucket(bucketName) {
    const command = new CreateBucketCommand({
      Bucket: bucketName,
      // us-east-1 dışındaki bölgeler için LocationConstraint gerekli
      ...(this.region !== "us-east-1" && {
        CreateBucketConfiguration: {
          LocationConstraint: this.region,
        },
      }),
    });

    await this.client.send(command);
  }

  async listObjects(bucket, prefix = "") {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      Delimiter: "/",
    });

    const response = await this.client.send(command);
    const items = [];

    // Klasörler (CommonPrefixes)
    if (response.CommonPrefixes) {
      for (const prefix of response.CommonPrefixes) {
        const folderName = prefix.Prefix.replace(/\/$/, "").split("/").pop();
        items.push({
          name: folderName,
          key: prefix.Prefix,
          type: "directory",
          size: 0,
          modifiedAt: null,
        });
      }
    }

    // Dosyalar
    if (response.Contents) {
      for (const object of response.Contents) {
        // Prefix'in kendisini atla
        if (object.Key === prefix) continue;

        const fileName = object.Key.split("/").pop();
        if (fileName) {
          items.push({
            name: fileName,
            key: object.Key,
            type: "file",
            size: object.Size,
            modifiedAt: object.LastModified,
          });
        }
      }
    }

    return items;
  }

  // Belirli bir klasör/prefix altındaki tüm nesnelerin toplam boyutunu hesapla
  async getFolderSize(bucket, prefix = "") {
    let totalSize = 0;
    let continuationToken = undefined;

    // Prefix sonu her zaman "/" ile bitsin (klasör mantığı)
    const normalizedPrefix =
      prefix && !prefix.endsWith("/") ? `${prefix}/` : prefix || "";

    do {
      const command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: normalizedPrefix,
        ContinuationToken: continuationToken,
      });

      const response = await this.client.send(command);

      if (response.Contents) {
        for (const object of response.Contents) {
          // Klasörün kendisi (sadece prefix) ise atla
          if (object.Key === normalizedPrefix) continue;
          totalSize += object.Size || 0;
        }
      }

      continuationToken = response.IsTruncated
        ? response.NextContinuationToken
        : undefined;
    } while (continuationToken);

    return totalSize;
  }

  async upload(localPath, bucket, key, onProgress) {
    const uploadStartTime = Date.now();

    // İlk upload'ta bağlantıyı ısıt (TCP/SSL handshake önceden yapılır)
    if (!this._connectionWarmed) {
      await this.warmupConnection(bucket);
      this._connectionWarmed = true;
    }

    const fileSize = fs.statSync(localPath).size;
    const FIVE_MB = 5 * 1024 * 1024;

    if (fileSize <= FIVE_MB) {
      await this.uploadSmallObject({
        localPath,
        bucket,
        key,
        fileSize,
        onProgress,
      });
      return;
    }

    // ÖNEMLİ: Küçük buffer = Hızlı başlangıç (progress hemen gelir)
    // Büyük buffer = Yavaş başlangıç ama potansiyel olarak daha hızlı throughput
    // Dengeleme: 5MB buffer - çoğu durumda optimal
    const highWaterMark = Math.min(5 * 1024 * 1024, fileSize); // 5MB buffer
    const fileStream = fs.createReadStream(localPath, { highWaterMark });
    console.log(
      `[S3-DEBUG] Stream oluşturuldu (+${Date.now() - uploadStartTime}ms)`
    );

    // Part size - Küçük = hızlı başlangıç, Büyük = az overhead
    // AWS minimum: 5MB (son part hariç)
    let partSize;
    let queueSize;

    if (fileSize < 50 * 1024 * 1024) {
      // 5-50MB: 5MB chunks (minimum, hızlı progress gösterimi)
      partSize = 5 * 1024 * 1024;
      queueSize = 4;
    } else if (fileSize < 100 * 1024 * 1024) {
      // 50-100MB: 10MB chunks
      partSize = 10 * 1024 * 1024;
      queueSize = 4;
    } else if (fileSize < 500 * 1024 * 1024) {
      // 100-500MB: 20MB chunks
      partSize = 20 * 1024 * 1024;
      queueSize = 6;
    } else if (fileSize < 2 * 1024 * 1024 * 1024) {
      // 500MB-2GB: 50MB chunks
      partSize = 50 * 1024 * 1024;
      queueSize = 8;
    } else {
      // 2GB+: 100MB chunks, maksimum paralellik
      partSize = 100 * 1024 * 1024;
      queueSize = 10;
    }

    // İlk progress callback (başlangıç)
    if (onProgress) {
      onProgress({
        percentage: 0,
        uploaded: 0,
        total: fileSize,
        fileName: path.basename(localPath),
      });
    }

    console.log(
      `[S3-DEBUG] Upload nesnesi oluşturuluyor... partSize=${
        partSize / 1024 / 1024
      }MB, queue=${queueSize}`
    );
    const uploadCreateStart = Date.now();

    const abortController = new AbortController();

    const internalId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: bucket,
        Key: key,
        Body: fileStream,
        // Checksum hesaplamayı devre dışı bırak (streaming ile uyumsuz)
        // MinIO ve bazı S3-compatible servislerde sorun çıkarabiliyor
      },
      queueSize: queueSize, // Dinamik paralel upload
      partSize: partSize,
      leavePartsOnError: false, // Hata durumunda temizle
      // Checksum hesaplamayı devre dışı bırak
      requestChecksumCalculation: false,
      abortSignal: abortController.signal,
    });

    console.log(
      `[S3-DEBUG] Upload nesnesi oluşturuldu (+${
        Date.now() - uploadCreateStart
      }ms)`
    );

    const fileName = path.basename(localPath);
    let uploadedBytes = 0;

    // Aktif upload'lar listesine ekle
    this.activeUploads.set(fileName, {
      upload,
      abortController,
      localPath,
      bucket,
      key,
      fileSize,
      uploadedBytes: 0,
      internalId,
    });

    // Progress tracking - throttle ile daha smooth
    let lastProgressTime = 0;
    let firstProgressReceived = false;
    const progressThrottle = 50; // 50ms throttle (saniyede 20 güncelleme max)

    upload.on("httpUploadProgress", (progress) => {
      const now = Date.now();

      // Uploaded bytes'ı kaydet
      uploadedBytes = progress.loaded || 0;
      const uploadInfo = this.activeUploads.get(fileName);
      if (uploadInfo) {
        uploadInfo.uploadedBytes = uploadedBytes;
      }

      // İlk progress geldiğinde log
      if (!firstProgressReceived) {
        firstProgressReceived = true;
        console.log(
          `[S3-DEBUG] ⭐ İLK PROGRESS GELDİ! (+${now - uploadStartTime}ms)`
        );
        console.log(
          `[S3-DEBUG] İlk yüklenen: ${(
            uploadedBytes /
            1024 /
            1024
          ).toFixed(2)} MB`
        );
      }

      if (onProgress && progress.loaded !== undefined) {
        // Son güncelleme üzerinden yeterli zaman geçtiyse veya tamamlandıysa
        if (
          now - lastProgressTime >= progressThrottle ||
          progress.loaded === fileSize
        ) {
          const percentage = Math.round((progress.loaded / fileSize) * 100);
          onProgress({
            percentage: percentage || 0,
            uploaded: progress.loaded || 0,
            total: fileSize,
            fileName,
          });
          lastProgressTime = now;
        }
      }
    });

    console.log(
      `[S3-DEBUG] Upload.done() çağrılıyor... (+${
        Date.now() - uploadStartTime
      }ms)`
    );
    try {
      await upload.done();
      console.log(
        `[S3-DEBUG] ✅ Upload tamamlandı! Toplam: ${
          Date.now() - uploadStartTime
        }ms`
      );
      this.activeUploads.delete(fileName);
    } catch (error) {
      this.activeUploads.delete(fileName);
      throw error;
    }
  }

  async uploadSmallObject({ localPath, bucket, key, fileSize, onProgress }) {
    if (onProgress) {
      onProgress({
        percentage: 0,
        uploaded: 0,
        total: fileSize,
        fileName: path.basename(localPath),
      });
    }

    const stream = fs.createReadStream(localPath);
    if (onProgress) {
      let uploaded = 0;
      stream.on("data", (chunk) => {
        uploaded += chunk.length;
        const percentage = Math.round((uploaded / fileSize) * 100);
        onProgress({
          percentage,
          uploaded,
          total: fileSize,
          fileName: path.basename(localPath),
        });
      });
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: stream,
      })
    );
  }

  // Dosyayı indir
  async download(bucket, key, localPath, onProgress, options = {}) {
    const startByte = options.startByte || 0;
    
    // Önce dosya boyutunu al
    const headCommand = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const headResponse = await this.client.send(headCommand);
    const fileSize = headResponse.ContentLength;

    // Dosyayı indir
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: `bytes=${startByte}-`,
    });

    const abortController = new AbortController();
    const fileName = path.basename(key); // Dosya adını key olarak kullan

    const response = await this.client.send(command, {
      abortSignal: abortController.signal,
    });

    // Hedef klasörü oluştur
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Stream'i dosyaya yaz
    // startByte > 0 ise append modunda aç
    const writeStream = fs.createWriteStream(localPath, {
      highWaterMark: 64 * 1024 * 1024,
      flags: startByte > 0 ? 'a' : 'w',
    });

    // Aktif download'lar listesine ekle
    this.activeDownloads.set(fileName, {
      abortController,
      stream: writeStream,
      bucket,
      key,
      localPath,
      fileSize,
      downloadedBytes: startByte,
      startTime: Date.now()
    });

    let downloaded = startByte;
    let lastProgressTime = 0;
    const progressThrottle = 50;

    response.Body.on("data", (chunk) => {
      const now = Date.now();
      downloaded += chunk.length;

      // Map'teki bilgiyi güncelle
      const activeDownload = this.activeDownloads.get(fileName);
      if (activeDownload) {
        activeDownload.downloadedBytes = downloaded;
      }

      if (
        onProgress &&
        (now - lastProgressTime >= progressThrottle || downloaded === fileSize)
      ) {
        const percentage = Math.round((downloaded / fileSize) * 100);
        onProgress({
          percentage,
          downloaded,
          total: fileSize,
          fileName,
        });
        lastProgressTime = now;
      }
    });

    try {
      await pipeline(response.Body, writeStream);
    } finally {
      this.activeDownloads.delete(fileName);
    }
  }

  async delete(bucket, key) {
    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    await this.client.send(command);
  }

  async mkdir(bucket, key) {
    // S3'te klasör kavramı yok, ancak "folder marker" objesi oluşturabiliriz
    // Key'in sonuna "/" ekleyerek boş bir obje oluştururuz
    const folderKey = key.endsWith("/") ? key : `${key}/`;

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: folderKey,
      Body: "", // Boş içerik
    });

    await this.client.send(command);
  }

  async copyObject(sourceBucket, sourceKey, destBucket, destKey) {
    // S3'te move işlemi yok, copy + delete yapılır
    const copySource = `${sourceBucket}/${sourceKey}`;

    const command = new CopyObjectCommand({
      Bucket: destBucket,
      CopySource: copySource,
      Key: destKey,
    });

    await this.client.send(command);
  }

  async generateShareLink(bucket, key, expiresIn = 3600) {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    return getSignedUrl(this.client, command, { expiresIn });
  }

  async getObjectInfo(bucket, key) {
    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await this.client.send(command);
    return {
      size: response.ContentLength,
      contentType: response.ContentType,
      lastModified: response.LastModified,
      etag: response.ETag,
    };
  }

  async createBucket(bucketName) {
    const params = {
      Bucket: bucketName,
    };

    // us-east-1 dışındaki bölgeler için LocationConstraint gerekli
    if (this.region !== "us-east-1") {
      params.CreateBucketConfiguration = {
        LocationConstraint: this.region,
      };
    }

    const command = new CreateBucketCommand(params);
    await this.client.send(command);
  }

  async deleteBucket(bucketName) {
    const command = new DeleteBucketCommand({
      Bucket: bucketName,
    });
    await this.client.send(command);
  }

  async getObjectInfo(bucket, key) {
    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await this.client.send(command);
    return {
      size: response.ContentLength,
      contentType: response.ContentType,
      lastModified: response.LastModified,
      etag: response.ETag,
    };
  }

  async getSignedUrl(bucket, key, expiresIn = 3600) {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    // Pre-signed URL oluştur (direkt stream için)
    const url = await getSignedUrl(this.client, command, { expiresIn });
    return url;
  }

  // Tag işlemleri
  async getObjectTags(bucket, key) {
    const command = new GetObjectTaggingCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await this.client.send(command);
    return response.TagSet || [];
  }

  async putObjectTags(bucket, key, tags) {
    // tags format: [{ Key: 'name', Value: 'value' }]
    const command = new PutObjectTaggingCommand({
      Bucket: bucket,
      Key: key,
      Tagging: {
        TagSet: tags,
      },
    });

    await this.client.send(command);
  }

  async deleteObjectTags(bucket, key) {
    const command = new DeleteObjectTaggingCommand({
      Bucket: bucket,
      Key: key,
    });

    await this.client.send(command);
  }

  // Devam eden tüm upload/download işlemlerini iptal et
  async cancelAllTransfers() {
    console.log("[S3] Tüm transferler iptal ediliyor...");
    
    // Upload'lar
    for (const [id, entry] of this.activeUploads.entries()) {
      try {
        if (entry.upload && entry.upload.abort) {
          await entry.upload.abort();
        }
        if (entry.abortController) {
          entry.abortController.abort();
        }
      } catch (error) {
        console.error(`[S3] Upload iptal hatası:`, error);
      }
    }
    this.activeUploads.clear();

    // Download'lar
    for (const [id, entry] of this.activeDownloads.entries()) {
      try {
        if (entry.abortController) {
          entry.abortController.abort();
        }
        if (entry.stream) {
          entry.stream.destroy();
        }
        
        // Yarım kalan dosyayı sil
        if (entry.localPath && fs.existsSync(entry.localPath)) {
          try {
            fs.unlinkSync(entry.localPath);
            console.log(`[S3] İptal edilen dosya silindi: ${entry.localPath}`);
          } catch (err) {
            console.warn(`[S3] Dosya silinemedi: ${err.message}`);
          }
        }
      } catch (error) {
        console.error(`[S3] Download iptal hatası:`, error);
      }
    }
    this.activeDownloads.clear();
    
    // Paused transferleri de temizle
    this.pausedUploads.clear();
    this.pausedDownloads.clear();
  }

  // Klasör içindeki tüm videoları recursive olarak listele
  async listVideos(bucket, prefix = "") {
    const videoFiles = [];
    const videoExtensions = [
      ".mp4",
      ".webm",
      ".ogg",
      ".ogv",
      ".avi",
      ".mov",
      ".wmv",
      ".flv",
      ".mkv",
      ".m4v",
    ];

    // Prefix sonu her zaman "/" ile bitsin (klasör mantığı)
    const normalizedPrefix =
      prefix && !prefix.endsWith("/") ? `${prefix}/` : prefix || "";

    let continuationToken = undefined;

    do {
      const command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: normalizedPrefix,
        ContinuationToken: continuationToken,
      });

      const response = await this.client.send(command);

      if (response.Contents) {
        for (const object of response.Contents) {
          // Klasörün kendisi (sadece prefix) ise atla
          if (object.Key === normalizedPrefix) continue;

          // Video uzantısı kontrolü
          const ext = path.extname(object.Key).toLowerCase();
          if (videoExtensions.includes(ext)) {
            videoFiles.push({
              name: path.basename(object.Key),
              key: object.Key,
              size: object.Size || 0,
            });
          }
        }
      }

      continuationToken = response.IsTruncated
        ? response.NextContinuationToken
        : undefined;
    } while (continuationToken);

    return videoFiles;
  }

  // Transfer'ı duraklat (pause)
  pauseTransfer(fileName) {
    // Önce upload'lara bak
    const uploadInfo = this.activeUploads.get(fileName);
    if (uploadInfo) {
      try {
        uploadInfo.abortController.abort();

        this.pausedUploads.set(fileName, {
          localPath: uploadInfo.localPath,
          bucket: uploadInfo.bucket,
          key: uploadInfo.key,
          fileSize: uploadInfo.fileSize,
          uploadedBytes: uploadInfo.uploadedBytes,
        });

        this.activeUploads.delete(fileName);

        console.log(`[S3] Upload duraklatıldı: ${fileName}`);
        return { success: true, uploadedBytes: uploadInfo.uploadedBytes };
      } catch (error) {
        return { success: false, message: error.message };
      }
    }

    // Sonra download'lara bak
    const downloadInfo = this.activeDownloads.get(fileName);
    if (!downloadInfo) {
      return { success: false, message: "Aktif transfer bulunamadı" };
    }

    try {
      if (downloadInfo.abortController) {
        downloadInfo.abortController.abort();
      }
      if (downloadInfo.stream) {
        downloadInfo.stream.destroy();
      }

      this.pausedDownloads.set(fileName, {
        bucket: downloadInfo.bucket,
        key: downloadInfo.key,
        localPath: downloadInfo.localPath,
        downloadedBytes: downloadInfo.downloadedBytes || 0,
      });

      this.activeDownloads.delete(fileName);

      console.log(`[S3] Download duraklatıldı: ${fileName}, İndirilen: ${downloadInfo.downloadedBytes}`);
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  // Transfer'ı devam ettir (resume)
  async resumeTransfer(fileName, onProgress) {
    const pausedUpload = this.pausedUploads.get(fileName);
    const pausedDownload = this.pausedDownloads.get(fileName);

    if (!pausedUpload && !pausedDownload) {
      return { success: false, message: "Duraklatılmış transfer bulunamadı" };
    }

    try {
      console.log(`[S3] Transfer devam ettiriliyor: ${fileName}`);

      if (pausedUpload) {
        this.pausedUploads.delete(fileName);
        // Arka planda başlat (await etme)
        this.upload(
          pausedUpload.localPath,
          pausedUpload.bucket,
          pausedUpload.key,
          onProgress
        ).catch(err => {
          console.error(`[S3] Resume upload hatası (${fileName}):`, err);
        });
      } else if (pausedDownload) {
      this.pausedDownloads.delete(fileName);
      
      // Resume ederken diskteki dosya boyutunu kontrol et
      let startByte = 0;
      try {
        if (fs.existsSync(pausedDownload.localPath)) {
          const stats = fs.statSync(pausedDownload.localPath);
          startByte = stats.size;
          console.log(`[S3] Resume: Diskteki dosya boyutu: ${startByte} bytes`);
        }
      } catch (err) {
        console.warn("[S3] Resume: Dosya boyutu okunamadı, 0'dan başlanıyor", err);
      }

      // Arka planda başlat (await etme)
      this.download(
        pausedDownload.bucket,
        pausedDownload.key,
        pausedDownload.localPath,
        onProgress,
        { startByte: startByte }
      ).catch(err => {
        console.error(`[S3] Resume download hatası (${fileName}):`, err);
      });
    }

    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
}


  // Duraklatılmış transferleri listele
  getPausedTransfers() {
    return Array.from(this.pausedUploads.entries()).map(([fileName, info]) => ({
      fileName,
      ...info,
    }));
  }
}

module.exports = S3Service;

