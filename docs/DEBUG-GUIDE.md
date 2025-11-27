# Transfer Debug Sistemi - Kullanım Rehberi

## 🐛 Debug Sistemi Nedir?

"Hazırlanıyor" aşamasında uzun süre kalma sorununu tespit etmek için timestamp bazlı debug sistemi eklendi. Her transfer işleminin tüm aşamalarını milisaniye hassasiyetiyle takip eder.

## 📊 İzlenen Aşamalar

### 1. TRANSFER_CREATED
- **Ne zaman:** Transfer işlemi başladığında
- **Bilgiler:** Dosya yolu, transfer tipi (upload/download), bağlantı tipi

### 2. FILE_INFO_START
- **Ne zaman:** Dosya bilgileri okunmaya başlandığında
- **Bilgiler:** Yok (başlangıç timestamp'i)

### 3. FILE_INFO_END
- **Ne zaman:** Dosya bilgileri okunduktan sonra
- **Bilgiler:** Dosya adı, dosya boyutu

### 4. IPC_CALL_START
- **Ne zaman:** Main process'e IPC çağrısı yapılmadan önce
- **Bilgiler:** Çağrılan method (ftpUpload, s3Upload, vb.)

### 5. IPC_CALL_END
- **Ne zaman:** IPC çağrısı tamamlandıktan sonra
- **Bilgiler:** Yok (süre hesaplanır)

### 6. FIRST_PROGRESS
- **Ne zaman:** İlk progress callback geldiğinde (transfer başladığında)
- **Bilgiler:** İlk yüklenen/indirilen byte, yüzde

### 7. PROGRESS_UPDATE
- **Ne zaman:** Transfer devam ederken (rastgele örnekleme ile)
- **Bilgiler:** Anlık yüzde, byte, total

### 8. COMPLETED / FAILED
- **Ne zaman:** Transfer tamamlandığında veya hata aldığında
- **Bilgiler:** Hata mesajı (eğer failed ise)

## 🚀 Kullanım

### Konsol Output'u

Debug sistemi otomatik olarak **AÇIK** durumda. Her transfer için konsola renkli loglar basar:

```javascript
[abc12345] TRANSFER_CREATED
  ⏱️  Başlangıçtan: 0ms
  ⏱️  Önceki aşamadan: 0ms
  📄 Dosya: video.mp4

[abc12345] FILE_INFO_START
  ⏱️  Başlangıçtan: 2ms
  ⏱️  Önceki aşamadan: 2ms

[abc12345] FILE_INFO_END
  ⏱️  Başlangıçtan: 45ms
  ⏱️  Önceki aşamadan: 43ms
  📦 Boyut: 125.5 MB

[abc12345] IPC_CALL_START
  ⏱️  Başlangıçtan: 48ms
  ⏱️  Önceki aşamadan: 3ms

[abc12345] FIRST_PROGRESS
  ⏱️  Başlangıçtan: 3250ms  👈 "Hazırlanıyor" süresi
  ⏱️  Önceki aşamadan: 3202ms
```

### Yavaş Başlangıç Uyarısı

Eğer **"Hazırlanıyor" süresi 3 saniyeden uzunsa** otomatik uyarı verilir:

```
⚠️ YAVAŞ BAŞLANGIÇ TESPİT EDİLDİ!
  "Hazırlanıyor" süresi: 5240ms
  Transfer ID: abc12345
  İnceleme önerisi: IPC gecikme veya dosya okuma sorunu olabilir
```

### Transfer Özet Raporu

Her transfer tamamlandığında detaylı özet yazdırılır:

```
📊 TRANSFER DEBUG ÖZET [abc12345]

⏱️ Toplam Süre: 15420ms (15.42s)

  📄 Dosya bilgisi okuma: 43ms
  📦 Hazırlanıyor süresi: 3202ms ⚠️ YAVAŞ!
  🔌 IPC çağrı süresi: 15370ms

📋 Tüm Aşamalar:
  1. TRANSFER_CREATED (+0ms)
  2. FILE_INFO_START (+2ms)
  3. FILE_INFO_END (+43ms)
  4. IPC_CALL_START (+3ms)
  5. FIRST_PROGRESS (+3202ms)
  6. PROGRESS_UPDATE (+1500ms)
  7. PROGRESS_UPDATE (+1800ms)
  8. COMPLETED (+8870ms)
```

## 🎮 Kontrol Komutları

### Debug Modunu Aç/Kapa

Konsola yazın:

```javascript
app.toggleDebug()
```

Output:
```
Debug modu: AÇIK ✅
// veya
Debug modu: KAPALI ❌
```

### Mevcut Debug Verilerini Görüntüle

```javascript
console.table(Array.from(app.debugTimestamps.values()))
```

### Belirli Bir Transfer'i İncele

```javascript
const transferId = 'upload-1234567890-abc';
const debug = app.debugTimestamps.get(transferId);
console.log('Transfer detayları:', debug);
```

## 🔍 Sorun Tespiti

### 1. Dosya Okuma Yavaş

**Belirti:**
```
FILE_INFO_START → FILE_INFO_END: 2000ms+
```

**Sebep:** Büyük dosya veya yavaş disk

**Çözüm:** Normal, endişelenmeyin

---

### 2. "Hazırlanıyor" Süresi Uzun

**Belirti:**
```
IPC_CALL_START → FIRST_PROGRESS: 3000ms+
```

**Olası Sebepler:**
1. **Network latency** (S3/FTP sunucuya bağlanma)
2. **Dosya stream oluşturma** (büyük dosyalar için normal)
3. **IPC gecikme** (main process yoğun)
4. **S3 multipart initialization** (büyük dosyalar)

**Çözüm:**
- S3 için: `partSize` ve `queueSize` optimize et
- FTP için: Buffer boyutunu kontrol et
- Main process'te uzun işlem varsa iyileştir

---

### 3. İlk Progress Geç Geliyor

**Belirti:**
```
FIRST_PROGRESS hiç gelmiyor veya çok geç geliyor
```

**Olası Sebepler:**
1. Progress callback çağrılmıyor
2. Chunk boyutu çok büyük
3. Stream başlamıyor

**Çözüm:**
- `onProgress` callback'lerini kontrol et
- Chunk boyutunu küçült
- Stream'in başladığını doğrula

---

### 4. Transfer Takılı Kaldı

**Belirti:**
```
PROGRESS_UPDATE durup başka log gelmiyor
```

**Olası Sebepler:**
1. Network koptu
2. Stream durdu
3. Main process takıldı

**Çözüm:**
- Network bağlantısını kontrol et
- Main process loglarına bak
- Timeout mekanizması ekle

## 📈 Beklenen Süreler

### Normal Durum

| Aşama | Beklenen Süre | Uyarı Eşiği |
|-------|---------------|-------------|
| Dosya okuma | < 100ms | 1000ms |
| IPC çağrı | < 50ms | 500ms |
| **Hazırlanıyor** | < 1000ms | **3000ms** |
| İlk progress | < 2000ms | 5000ms |

### Büyük Dosyalar (1GB+)

| Aşama | Beklenen Süre |
|-------|---------------|
| Dosya okuma | 100-500ms |
| Hazırlanıyor | 2000-5000ms (S3 multipart init) |
| İlk progress | 3000-8000ms |

## 🛠️ Örnek Debug Senaryoları

### Senaryo 1: Normal Upload (Hızlı)

```
[upload-001] TRANSFER_CREATED      (+0ms)
[upload-001] FILE_INFO_START       (+2ms)
[upload-001] FILE_INFO_END         (+35ms)
[upload-001] IPC_CALL_START        (+3ms)
[upload-001] FIRST_PROGRESS        (+850ms)  ✅ OK
[upload-001] COMPLETED             (+5200ms)

Toplam: 5.2 saniye ✅
```

### Senaryo 2: Yavaş Başlangıç (Sorunlu)

```
[upload-002] TRANSFER_CREATED      (+0ms)
[upload-002] FILE_INFO_START       (+2ms)
[upload-002] FILE_INFO_END         (+40ms)
[upload-002] IPC_CALL_START        (+3ms)
[upload-002] FIRST_PROGRESS        (+5800ms)  ⚠️ YAVAŞ!
[upload-002] COMPLETED             (+18000ms)

⚠️ YAVAŞ BAŞLANGIÇ TESPİT EDİLDİ!
Hazırlanıyor süresi: 5800ms

Toplam: 18 saniye ⚠️
```

**Analiz:** IPC_CALL_START → FIRST_PROGRESS arası 5.8 saniye. 
**Sebep:** S3 multipart initialization veya network latency
**Çözüm:** `partSize` artır, `queueSize` optimize et

### Senaryo 3: Dosya Okuma Sorunu

```
[upload-003] TRANSFER_CREATED      (+0ms)
[upload-003] FILE_INFO_START       (+2ms)
[upload-003] FILE_INFO_END         (+3200ms)  ⚠️
[upload-003] IPC_CALL_START        (+5ms)
[upload-003] FIRST_PROGRESS        (+500ms)
[upload-003] COMPLETED             (+8000ms)

Toplam: 11.2 saniye
```

**Analiz:** FILE_INFO_START → FILE_INFO_END arası 3.2 saniye
**Sebep:** Yavaş disk veya çok büyük dosya
**Çözüm:** Normal (disk I/O), optimizasyon gerekmez

## 💡 İpuçları

1. **Her zaman konsolu açık tutun** - Debug logları otomatik gelir
2. **Yavaş başlangıç uyarılarına dikkat edin** - Otomatik tespit edilir
3. **Özet raporları inceleyin** - Her transfer sonunda yazdırılır
4. **Karşılaştırma yapın** - Farklı dosya boyutlarında zamanları karşılaştırın
5. **Main process loglarını da kontrol edin** - IPC sorunları için

## 🔧 Advanced: Custom Debug

Kendi debug noktanız eklemek için:

```javascript
// app.js içinde
this.debugLog(transferId, 'CUSTOM_STAGE', {
  myData: 'some value',
  timestamp: Date.now(),
});
```

Konsola renkli log olarak çıkar.

## 📞 Destek

Debug sistemi sorunları otomatik tespit eder ve konsola bildirir. Eğer:
- "Hazırlanıyor" süresi 3+ saniye
- Transfer hiç başlamıyor
- Beklenmedik gecikmeler var

Konsol çıktısını kaydedin ve analiz edin.


