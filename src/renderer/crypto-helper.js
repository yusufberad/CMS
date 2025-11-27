// Basit şifreleme helper'ı (PIN based)
class CryptoHelper {
  // PIN ile veriyi şifrele
  static encrypt(data, pin) {
    try {
      const jsonStr = JSON.stringify(data);
      const encrypted = btoa(
        unescape(encodeURIComponent(jsonStr + "||" + pin))
      );
      return encrypted;
    } catch (error) {
      console.error("Encryption error:", error);
      return null;
    }
  }

  // PIN ile veriyi çöz
  static decrypt(encrypted, pin) {
    try {
      const decoded = decodeURIComponent(escape(atob(encrypted)));
      const parts = decoded.split("||");

      if (parts.length !== 2) {
        return null;
      }

      const [jsonStr, storedPin] = parts;

      // PIN kontrolü
      if (storedPin !== pin) {
        return null;
      }

      return JSON.parse(jsonStr);
    } catch (error) {
      console.error("Decryption error:", error);
      return null;
    }
  }

  // Hash oluştur (comparison için)
  static hash(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }
}
