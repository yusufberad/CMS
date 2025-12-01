const ftp = require("basic-ftp");
const fs = require("fs");
const path = require("path");

class FTPService {
  constructor() {
    this.client = new ftp.Client();
    this.client.ftp.verbose = false;
  }

  async connect(config) {
    const { host, port = 21, user, password, secure = false } = config;

    await this.client.access({
      host,
      port: parseInt(port),
      user,
      password,
      secure,
      secureOptions: secure ? { rejectUnauthorized: false } : undefined,
    });

    return true;
  }

  async disconnect() {
    this.client.close();
  }

  async list(remotePath = "/") {
    const files = await this.client.list(remotePath);

    return files.map((file) => ({
      name: file.name,
      type: file.type === 2 ? "directory" : "file",
      size: file.size,
      modifiedAt: file.modifiedAt || file.rawModifiedAt,
      permissions: file.permissions || {},
      // FTP list sonuçlarında klasör boyutu genelde gelmez, bu yüzden 0 bırakıyoruz.
      // İleride istenirse recursive hesaplama ile güncellenebilir.
      isDirectory: file.type === 2,
    }));
  }

  // Klasör boyutunu recursive olarak hesapla
  async getFolderSize(remotePath = "/") {
    const normalizedPath =
      !remotePath || remotePath === "" ? "/" : remotePath;

    const entries = await this.client.list(normalizedPath);
    let totalSize = 0;

    for (const entry of entries) {
      const entryPath =
        normalizedPath === "/"
          ? `/${entry.name}`
          : `${normalizedPath.replace(/\/$/, "")}/${entry.name}`;

      if (entry.type === 2) {
        // Klasör
        totalSize += await this.getFolderSize(entryPath);
      } else {
        // Dosya
        totalSize += entry.size || 0;
      }
    }

    return totalSize;
  }

  async upload(localPath, remotePath, onProgress) {
    const fileSize = fs.statSync(localPath).size;
    let uploaded = 0;
    let lastProgressTime = 0;
    const progressThrottle = 50; // 50ms throttle - smooth progress updates

    this.client.trackProgress((info) => {
      const now = Date.now();

      if (info.bytes > 0) {
        uploaded = info.bytes;
        const percentage = Math.round((uploaded / fileSize) * 100);

        // Throttle progress updates - sadece yeterli zaman geçtiyse güncelle
        if (
          onProgress &&
          (now - lastProgressTime >= progressThrottle || uploaded === fileSize)
        ) {
          onProgress({
            percentage,
            uploaded,
            total: fileSize,
            fileName: path.basename(localPath),
          });
          lastProgressTime = now;
        }
      }
    });

    try {
      // Stream ile kesintisiz upload
      const readStream = fs.createReadStream(localPath, {
        highWaterMark: 64 * 1024 * 1024, // 64MB buffer - Google Drive tarzı kesintisiz akış
      });

      await this.client.uploadFrom(readStream, remotePath);
    } finally {
      this.client.trackProgress();
    }
  }

  async download(remotePath, localPath, onProgress) {
    // İlk önce dosya boyutunu öğren
    const files = await this.client.list(path.dirname(remotePath));
    const fileName = path.basename(remotePath);
    const fileInfo = files.find((f) => f.name === fileName);
    const fileSize = fileInfo ? fileInfo.size : 0;

    let downloaded = 0;
    let lastProgressTime = 0;
    const progressThrottle = 50; // 50ms throttle - smooth progress

    this.client.trackProgress((info) => {
      const now = Date.now();

      if (info.bytes > 0) {
        downloaded = info.bytes;
        const percentage =
          fileSize > 0 ? Math.round((downloaded / fileSize) * 100) : 0;

        // Throttle progress updates
        if (
          onProgress &&
          (now - lastProgressTime >= progressThrottle ||
            downloaded === fileSize)
        ) {
          onProgress({
            percentage,
            downloaded,
            total: fileSize,
            fileName,
          });
          lastProgressTime = now;
        }
      }
    });

    try {
      // Hedef klasörü oluştur
      const dir = path.dirname(localPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Stream ile kesintisiz download - büyük buffer
      const writeStream = fs.createWriteStream(localPath, {
        highWaterMark: 64 * 1024 * 1024, // 64MB buffer
      });

      await this.client.downloadTo(writeStream, remotePath);
    } finally {
      this.client.trackProgress();
    }
  }

  async delete(remotePath) {
    try {
      // Önce dosya mı klasör mü kontrol et
      const parentDir = path.dirname(remotePath);
      const fileName = path.basename(remotePath);
      const files = await this.client.list(parentDir);
      const file = files.find((f) => f.name === fileName);

      if (file && file.type === 2) {
        // Klasör
        await this.client.removeDir(remotePath);
      } else {
        // Dosya
        await this.client.remove(remotePath);
      }
    } catch (error) {
      throw new Error(`Silme hatası: ${error.message}`);
    }
  }

  async mkdir(remotePath) {
    await this.client.ensureDir(remotePath);
  }

  async rename(oldPath, newPath) {
    await this.client.rename(oldPath, newPath);
  }

  async pwd() {
    return await this.client.pwd();
  }
}

module.exports = FTPService;
