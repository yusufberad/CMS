/**
 * Renderer Process - Frontend
 * Streaming Upload Kullanım Örnekleri
 */

// ==========================================
// Örnek 1: Basit Dosya Upload
// ==========================================

async function simpleFileUpload(filePath) {
  const result = await window.streamingAPI.uploadFile(
    filePath,
    "my-bucket",
    "videos/output.mp4"
  );

  console.log("Upload result:", result);
}

// ==========================================
// Örnek 2: Chunk Bazlı Streaming (Tarayıcı File)
// ==========================================

async function streamFileInChunks(file) {
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks

  // Upload başlat
  const { uploadId } = await window.streamingAPI.startUpload(
    "my-bucket",
    `uploads/${file.name}`,
    file.size
  );

  console.log("Upload started:", uploadId);

  // Progress listener
  window.streamingAPI.onProgress((data) => {
    if (data.uploadId === uploadId) {
      console.log(`Progress: ${data.percentage}%`);
      updateProgressBar(data.percentage);
    }
  });

  // Chunk'ları oku ve gönder
  let offset = 0;
  while (offset < file.size) {
    const chunk = file.slice(offset, offset + CHUNK_SIZE);
    const arrayBuffer = await chunk.arrayBuffer();

    await window.streamingAPI.sendChunk(uploadId, arrayBuffer);

    offset += CHUNK_SIZE;
  }

  // Upload'ı tamamla
  await window.streamingAPI.finishUpload(uploadId);

  // Complete listener
  window.streamingAPI.onComplete((data) => {
    if (data.uploadId === uploadId) {
      console.log("Upload complete!", data.result);
    }
  });
}

// ==========================================
// Örnek 3: MediaRecorder Stream (Webcam)
// ==========================================

class WebcamStreamer {
  constructor() {
    this.uploadId = null;
    this.mediaRecorder = null;
  }

  async start(bucket, key) {
    // Webcam stream al
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });

    // Upload başlat (boyut bilinmiyor - 0)
    const result = await window.streamingAPI.startUpload(bucket, key, 0);
    this.uploadId = result.uploadId;

    // MediaRecorder - chunk'ları direkt S3'e gönder
    this.mediaRecorder = new MediaRecorder(stream, {
      mimeType: "video/webm",
    });

    this.mediaRecorder.ondataavailable = async (event) => {
      if (event.data.size > 0 && this.uploadId) {
        const arrayBuffer = await event.data.arrayBuffer();
        await window.streamingAPI.sendChunk(this.uploadId, arrayBuffer);
      }
    };

    // Her 5 saniyede chunk gönder
    this.mediaRecorder.start(5000);

    console.log("Recording started, streaming to S3...");
  }

  async stop() {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }

    if (this.uploadId) {
      await window.streamingAPI.finishUpload(this.uploadId);
      console.log("Upload finished");
    }
  }
}

// Kullanım:
// const streamer = new WebcamStreamer();
// await streamer.start('my-bucket', 'recordings/video.webm');
// ... kayıt devam ediyor ...
// await streamer.stop();

// ==========================================
// Örnek 4: Resume Özelliği ile Upload
// ==========================================

class ResumableUploader {
  constructor(file, bucket, key) {
    this.file = file;
    this.bucket = bucket;
    this.key = key;
    this.uploadId = null;
    this.isPaused = false;
    this.offset = 0;
  }

  async start() {
    const result = await window.streamingAPI.startUpload(
      this.bucket,
      this.key,
      this.file.size
    );
    this.uploadId = result.uploadId;

    window.streamingAPI.onProgress((data) => {
      if (data.uploadId === this.uploadId) {
        this.offset = data.uploaded;
        console.log(`Progress: ${data.percentage}%`);
      }
    });

    await this._streamChunks();
  }

  async pause() {
    this.isPaused = true;
    if (this.uploadId) {
      const result = await window.streamingAPI.pauseUpload(this.uploadId);
      console.log("Upload paused:", result.resumeInfo);
      return result.resumeInfo;
    }
  }

  async resume(filePath) {
    if (!this.uploadId) return;

    this.isPaused = false;
    const result = await window.streamingAPI.resumeUpload(
      this.uploadId,
      filePath
    );
    console.log("Upload resumed:", result);
  }

  async _streamChunks() {
    const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
    let offset = 0;

    while (offset < this.file.size && !this.isPaused) {
      const chunk = this.file.slice(offset, offset + CHUNK_SIZE);
      const arrayBuffer = await chunk.arrayBuffer();

      await window.streamingAPI.sendChunk(this.uploadId, arrayBuffer);

      offset += CHUNK_SIZE;
    }

    if (!this.isPaused) {
      await window.streamingAPI.finishUpload(this.uploadId);
    }
  }
}

// Kullanım:
// const uploader = new ResumableUploader(file, 'my-bucket', 'uploads/large-file.zip');
// await uploader.start();
//
// // İnternet kesildi veya pause
// await uploader.pause();
//
// // Devam et
// await uploader.resume('/path/to/file');

// ==========================================
// Örnek 5: Drag & Drop ile Streaming Upload
// ==========================================

function initializeDragDrop() {
  const dropZone = document.getElementById("drop-zone");

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
  });

  dropZone.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");

    const files = Array.from(e.dataTransfer.files);

    for (const file of files) {
      console.log(`Streaming upload: ${file.name}`);
      await streamFileInChunks(file);
    }
  });
}

// Progress bar güncelleme
function updateProgressBar(percentage) {
  const progressBar = document.getElementById("progress-bar");
  const progressText = document.getElementById("progress-text");

  progressBar.style.width = `${percentage}%`;
  progressText.textContent = `${percentage}%`;
}

// ==========================================
// HTML Örneği
// ==========================================

/*
<!DOCTYPE html>
<html>
<head>
  <title>S3 Streaming Upload</title>
  <style>
    #drop-zone {
      width: 400px;
      height: 200px;
      border: 2px dashed #ccc;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 20px;
    }
    
    #drop-zone.drag-over {
      border-color: #2563eb;
      background: #eff6ff;
    }
    
    #progress-bar {
      width: 0%;
      height: 30px;
      background: #2563eb;
      transition: width 0.3s;
    }
  </style>
</head>
<body>
  <div id="drop-zone">
    Dosyaları buraya sürükleyin
  </div>
  
  <div style="margin: 20px;">
    <div style="width: 400px; background: #e5e7eb; border-radius: 5px;">
      <div id="progress-bar"></div>
    </div>
    <div id="progress-text">0%</div>
  </div>

  <script src="renderer-streaming.js"></script>
  <script>
    initializeDragDrop();
  </script>
</body>
</html>
*/
