// ============================================
// S3 Manager - Handles S3 operations
// ============================================

class S3Manager {
  constructor(app) {
    this.app = app;
  }

  // S3 Bağlantısı
  async connect() {
    if (this.app.isConnected) {
      await this.disconnect();
      return;
    }

    const accessKey = document.getElementById("s3-access-key").value.trim();
    const secretKey = document.getElementById("s3-secret-key").value.trim();
    const region = document.getElementById("s3-region").value;
    const endpoint = document.getElementById("s3-endpoint").value.trim();
    const remember = document.getElementById("s3-remember").checked;

    if (!accessKey || !secretKey) {
      this.app.ui.showToast("Access Key ve Secret Key gerekli!", "error");
      return;
    }

    const config = {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
      region,
      ...(endpoint && { endpoint }),
    };

    if (remember) {
      this.app.pendingConnection = {
        type: "s3",
        config,
        name: `S3 - ${region}${endpoint ? ` (${endpoint})` : ""}`,
      };
      this.app.showSetPinModal();
      return;
    }

    await this.performConnect(config);
  }

  async performConnect(config) {
    const btn = document.getElementById("s3-connect-btn");
    btn.classList.add("loading");
    btn.disabled = true;

    try {
      const result = await window.electronAPI.s3Connect(config);

      if (result.success) {
        this.app.isConnected = true;
        this.app.ui.updateConnectionStatus(true, "s3");
        this.app.ui.enableToolbar();
        this.app.ui.showToast("S3 bağlantısı başarılı!", "success");

        this.disableConnectionForm();
        this.updateConnectButton(true);

        await this.loadBuckets();
        document.getElementById("bucket-selector").classList.remove("hidden");
      } else {
        this.app.ui.showToast(result.message, "error");
      }
    } catch (error) {
      this.app.ui.showToast(`Bağlantı hatası: ${error.message}`, "error");
    } finally {
      btn.classList.remove("loading");
      btn.disabled = false;
    }
  }

  async disconnect() {
    await window.electronAPI.s3Disconnect();
    this.app.isConnected = false;
    this.app.currentPath = "/";
    this.app.currentBucket = null;
    this.app.files = [];
    this.app.selectedFile = null;

    this.app.ui.updateConnectionStatus(false, "s3");
    this.app.ui.disableToolbar();
    this.app.fileList.clearFileList();
    this.enableConnectionForm();
    this.updateConnectButton(false);

    document.getElementById("bucket-selector").classList.add("hidden");
    document.getElementById("bucket-list").innerHTML =
      '<option value="">Bucket seçin...</option>';

    this.app.ui.showToast("Bağlantı kesildi", "info");
  }

  async loadBuckets() {
    try {
      const result = await window.electronAPI.s3ListBuckets();

      if (result.success) {
        const select = document.getElementById("bucket-list");
        select.innerHTML = '<option value="">Bucket seçin...</option>';

        result.buckets.forEach((bucket) => {
          const option = document.createElement("option");
          option.value = bucket.name;
          option.textContent = bucket.name;
          select.appendChild(option);
        });
      } else {
        this.app.ui.showToast(result.message, "error");
      }
    } catch (error) {
      this.app.ui.showToast(`Bucket listesi alınamadı: ${error.message}`, "error");
    }
  }

  async loadFiles() {
    if (!this.app.currentBucket) return;

    try {
      const result = await window.electronAPI.s3List({
        bucket: this.app.currentBucket,
        prefix: this.app.currentPath,
      });

      if (result.success) {
        this.app.files = result.files;
        this.app.fileList.renderFileList();
        this.app.fileList.updateFolderSizes();
        this.app.fileList.updateBreadcrumb();
      } else {
        this.app.ui.showToast(result.message, "error");
      }
    } catch (error) {
      this.app.ui.showToast(`Dosya listesi alınamadı: ${error.message}`, "error");
    }
  }

  async createBucket() {
    const name = document.getElementById("new-bucket-name").value.trim();

    if (!name) {
      this.app.ui.showToast("Bucket adı gerekli!", "error");
      return;
    }

    try {
      const result = await window.electronAPI.s3CreateBucket(name);
      if (result.success) {
        this.app.ui.showToast("Bucket oluşturuldu!", "success");
        this.app.ui.closeModals();
        await this.loadBuckets();
      } else {
        this.app.ui.showToast(result.message, "error");
      }
    } catch (error) {
      this.app.ui.showToast(`Bucket oluşturulamadı: ${error.message}`, "error");
    }
  }

  async createFolder() {
    const name = document.getElementById("new-folder-name").value.trim();

    if (!name) {
      this.app.ui.showToast("Klasör adı gerekli!", "error");
      return;
    }

    if (!this.app.currentBucket) {
      this.app.ui.showToast("Önce bir bucket seçin!", "error");
      return;
    }

    const key = this.app.currentPath ? `${this.app.currentPath}${name}/` : `${name}/`;

    try {
      const result = await window.electronAPI.s3Mkdir({
        bucket: this.app.currentBucket,
        key,
      });

      if (result.success) {
        this.app.ui.showToast("Klasör oluşturuldu!", "success");
        this.app.ui.closeModals();
        await this.loadFiles();
      } else {
        this.app.ui.showToast(result.message, "error");
      }
    } catch (error) {
      this.app.ui.showToast(`Klasör oluşturulamadı: ${error.message}`, "error");
    }
  }

  disableConnectionForm() {
    document.getElementById("s3-access-key").disabled = true;
    document.getElementById("s3-secret-key").disabled = true;
    document.getElementById("s3-region").disabled = true;
    document.getElementById("s3-endpoint").disabled = true;
  }

  enableConnectionForm() {
    document.getElementById("s3-access-key").disabled = false;
    document.getElementById("s3-secret-key").disabled = false;
    document.getElementById("s3-region").disabled = false;
    document.getElementById("s3-endpoint").disabled = false;
  }

  updateConnectButton(isConnected) {
    const btn = document.getElementById("s3-connect-btn");
    const btnText = btn.querySelector(".btn-text");

    if (isConnected) {
      btnText.textContent = "Bağlantıyı Kes";
      btn.style.background = "linear-gradient(135deg, #ff4757, #ff6348)";
    } else {
      btnText.textContent = "Bağlan";
      btn.style.background =
        "linear-gradient(135deg, var(--primary), var(--primary-dark))";
    }
  }
}
