# Cloud File Manager

FTP ve Amazon S3 destekli modern masaüstü dosya yöneticisi uygulaması.

![Electron](https://img.shields.io/badge/Electron-28.0-47848F?logo=electron)
![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)
![License](https://img.shields.io/badge/License-MIT-blue)

## 🚀 Özellikler

### FTP Desteği

- FTP ve FTPS (güvenli) bağlantı
- Dosya yükleme ve indirme
- Klasör oluşturma ve silme
- İlerleme çubuğu ile transfer takibi

### Amazon S3 Desteği

- AWS S3 bucket'larına erişim
- Özel endpoint desteği (MinIO, DigitalOcean Spaces vb.)
- Çoklu bölge desteği
- Büyük dosya yükleme (multipart upload)

### Kullanıcı Arayüzü

- Modern koyu tema tasarımı
- Sürükle-bırak pencere kontrolü
- Gerçek zamanlı ilerleme göstergesi
- Toast bildirimleri
- Breadcrumb navigasyon

## 📦 Kurulum

### Gereksinimler

- Node.js 18 veya üzeri
- npm veya yarn

### Adımlar

1. Bağımlılıkları yükleyin:

```bash
npm install
```

2. Uygulamayı geliştirme modunda çalıştırın:

```bash
npm start
```

3. DevTools ile çalıştırma:

```bash
npm run dev
```

## 🏗️ Derleme

### Windows

```bash
npm run build:win
```

### macOS

```bash
npm run build:mac
```

### Linux

```bash
npm run build:linux
```

Derlenmiş dosyalar `dist` klasöründe oluşturulur.

## 📁 Proje Yapısı

```
cloud-file-manager/
├── src/
│   ├── main.js              # Electron ana işlem
│   ├── preload.js           # Preload script
│   ├── services/
│   │   ├── ftp-service.js   # FTP işlemleri
│   │   └── s3-service.js    # S3 işlemleri
│   └── renderer/
│       ├── index.html       # Ana HTML
│       ├── styles.css       # Stiller
│       └── app.js           # Renderer JavaScript
├── package.json
└── README.md
```

## 🔧 Kullanım

### FTP Bağlantısı

1. Sol panelden "FTP" sekmesini seçin
2. Sunucu bilgilerini girin:
   - Sunucu adresi (örn: ftp.example.com)
   - Port (varsayılan: 21)
   - Kullanıcı adı ve şifre
   - Güvenli bağlantı (FTPS) seçeneği
3. "Bağlan" butonuna tıklayın

### Amazon S3 Bağlantısı

1. Sol panelden "S3" sekmesini seçin
2. AWS kimlik bilgilerini girin:
   - Access Key ID
   - Secret Access Key
   - Bölge seçimi
   - (Opsiyonel) Özel endpoint
3. "Bağlan" butonuna tıklayın
4. Açılır menüden bucket seçin

### Dosya İşlemleri

- **Yükle**: Araç çubuğundaki "Yükle" butonuna tıklayın
- **İndir**: Dosya seçip "İndir" butonuna tıklayın
- **Sil**: Dosya/klasör seçip "Sil" butonuna tıklayın
- **Yeni Klasör**: "Yeni Klasör" butonuna tıklayın (FTP için)
- **Yenile**: Yenile butonuna tıklayın

## 🔒 Güvenlik Notları

- AWS kimlik bilgilerinizi güvenli tutun
- IAM kullanıcısı oluşturup minimum yetki verin
- FTPS (güvenli FTP) kullanmayı tercih edin
- Şifreleri düz metin olarak saklamayın

## 🛠️ Teknolojiler

- **Electron** - Masaüstü uygulama framework'ü
- **basic-ftp** - FTP istemci kütüphanesi
- **@aws-sdk/client-s3** - AWS S3 SDK
- **@aws-sdk/lib-storage** - Multipart upload desteği

## 📄 Lisans

MIT License - Detaylar için [LICENSE](LICENSE) dosyasına bakın.

## 🤝 Katkıda Bulunma

1. Fork yapın
2. Feature branch oluşturun (`git checkout -b feature/amazing-feature`)
3. Değişikliklerinizi commit edin (`git commit -m 'Add some amazing feature'`)
4. Branch'e push yapın (`git push origin feature/amazing-feature`)
5. Pull Request açın
