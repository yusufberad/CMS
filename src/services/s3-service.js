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

    // Active uploads tracking (streaming için)
    this.activeUploads = new Map();

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

    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: bucket,
        Key: key,
        Body: fileStream,
      },
      queueSize: queueSize, // Dinamik paralel upload
      partSize: partSize,
      leavePartsOnError: false, // Hata durumunda temizle
    });

    console.log(
      `[S3-DEBUG] Upload nesnesi oluşturuldu (+${
        Date.now() - uploadCreateStart
      }ms)`
    );

    // Progress tracking - throttle ile daha smooth
    let lastProgressTime = 0;
    let firstProgressReceived = false;
    const progressThrottle = 50; // 50ms throttle (saniyede 20 güncelleme max)

    upload.on("httpUploadProgress", (progress) => {
      const now = Date.now();

      // İlk progress geldiğinde log
      if (!firstProgressReceived) {
        firstProgressReceived = true;
        console.log(
          `[S3-DEBUG] ⭐ İLK PROGRESS GELDİ! (+${now - uploadStartTime}ms)`
        );
        console.log(
          `[S3-DEBUG] İlk yüklenen: ${(
            (progress.loaded || 0) /
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
            fileName: path.basename(localPath),
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
    await upload.done();
    console.log(
      `[S3-DEBUG] ✅ Upload tamamlandı! Toplam: ${
        Date.now() - uploadStartTime
      }ms`
    );
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

  async download(bucket, key, localPath, onProgress) {
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
    });

    const response = await this.client.send(command);

    // Hedef klasörü oluştur
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Stream'i dosyaya yaz - büyük buffer ile kesintisiz akış
    const writeStream = fs.createWriteStream(localPath, {
      highWaterMark: 64 * 1024 * 1024, // 64MB buffer - Google Drive tarzı
    });

    let downloaded = 0;
    let lastProgressTime = 0;
    const progressThrottle = 50; // 50ms throttle

    response.Body.on("data", (chunk) => {
      const now = Date.now();
      downloaded += chunk.length;

      // Throttled progress updates - daha smooth
      if (
        onProgress &&
        (now - lastProgressTime >= progressThrottle || downloaded === fileSize)
      ) {
        const percentage = Math.round((downloaded / fileSize) * 100);
        onProgress({
          percentage,
          downloaded,
          total: fileSize,
          fileName: path.basename(key),
        });
        lastProgressTime = now;
      }
    });

    await pipeline(response.Body, writeStream);
  }

  async delete(bucket, key) {
    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
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
}

module.exports = S3Service;
