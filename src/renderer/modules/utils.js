// ============================================
// Utils - Helper functions
// ============================================

class Utils {
  static formatSize(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  static formatDate(date)  {
    return new Date(date).toLocaleDateString("tr-TR");
  }

  static normalizeSearchText(text) {
    if (!text) return "";
    const map = {
      ç: "c", Ç: "c",
      ğ: "g", Ğ: "g",
      ı: "i", I: "i", İ: "i",
      ö: "o", Ö: "o",
      ş: "s", Ş: "s",
      ü: "u", Ü: "u",
    };
    return text
      .split("")
      .map((ch) => map[ch] || ch)
      .join("")
      .toLowerCase();
  }

  static getFileType(filename) {
    const ext = filename.split(".").pop().toLowerCase();
    const types = {
      jpg: "Resim", jpeg: "Resim", png: "Resim", gif: "Resim", webp: "Resim",
      mp4: "Video", avi: "Video", mkv: "Video", webm: "Video",
      pdf: "PDF",
      doc: "Belge", docx: "Belge", txt: "Belge",
      zip: "Arşiv", rar: "Arşiv", "7z": "Arşiv",
    };
    return types[ext] || "Dosya";
  }

  static isImageFile(filename) {
    const ext = filename.split(".").pop().toLowerCase();
    return ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext);
  }

  static isVideoFile(filename) {
    const ext = filename.split(".").pop().toLowerCase();
    return ["mp4", "webm", "ogg", "ogv", "avi", "mov", "mkv"].includes(ext);
  }
}
