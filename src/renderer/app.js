// ============================================
// Heysem Cloud Manager - Main App (Modular)
// ============================================

class CloudFileManager {
  constructor() {
    // State
    this.connectionType = "s3";
    this.isConnected = false;
    this.currentPath = "/";
    this.selectedFile = null;
    this.currentBucket = null;
    this.files = [];
    this.searchQuery = "";
    this.sortBy = "name";
    this.sortDirection = "asc";
    this.pendingConnection = null;
    this.lastPreviewImageUrl = null;
    this.isTransferPaused = false; // Initialize pause state

    // Platform detection
    this.platform = (window.electronAPI?.getPlatform?.() || "browser");
    this.isMac = this.platform === "darwin";
    if (this.isMac) {
      document.body.classList.add("is-macos");
    }

    // Initialize modules
    this.ui = new UIManager(this);
    this.s3 = new S3Manager(this);
    this.fileList = new FileListManager(this);

    this.init();
  }

  init() {
    this.ui.initTheme();
    this.bindEvents();
    this.setupProgressListeners();
    this.showQuickLogin(); // Show saved connections on startup
  }

  bindEvents() {
    // Titlebar controls
    document.getElementById("titlebar-minimize")?.addEventListener("click", () => {
      window.electronAPI.minimizeWindow();
    });

    document.getElementById("titlebar-maximize")?.addEventListener("click", () => {
      window.electronAPI.maximizeWindow();
    });

    document.getElementById("titlebar-close")?.addEventListener("click", () => {
      window.electronAPI.closeWindow();
    });

    // S3 Connect
    document.getElementById("s3-connect-btn")?.addEventListener("click", () => {
      if (this.isConnected) {
        this.s3.disconnect();
      } else {
        this.s3.connect();
      }
    });

    // Toolbar buttons
    document.getElementById("btn-upload")?.addEventListener("click", () => this.uploadFile());
    document.getElementById("btn-download")?.addEventListener("click", () => this.downloadFile());
    document.getElementById("btn-new-folder")?.addEventListener("click", () => this.ui.showNewFolderModal());
    document.getElementById("btn-refresh")?.addEventListener("click", () => this.refreshFileList());

    // Search  
    const searchInput = document.getElementById("file-search-input");
    searchInput?.addEventListener("input", (e) => {
      this.searchQuery = e.target.value;
      this.fileList.renderFileList();
    });

    // Bucket selection
    document.getElementById("bucket-list")?.addEventListener("change", (e) => {
      this.currentBucket = e.target.value;
      this.currentPath = "";
      if (this.currentBucket) {
        this.s3.loadFiles();
      }
    });

    // New bucket button
    document.getElementById("btn-new-bucket")?.addEventListener("click", () => {
      this.ui.showNewBucketModal();
    });

    // Modal events
    document.querySelectorAll(".modal-overlay, .modal-close, .modal-cancel").forEach((el) => {
      el.addEventListener("click", () => this.ui.closeModals());
    });

    // Create folder/bucket buttons
    document.getElementById("create-folder-btn")?.addEventListener("click", () => this.s3.createFolder());
    document.getElementById("create-bucket-btn")?.addEventListener("click", () => this.s3.createBucket());

    // Enter key handlers
    document.getElementById("new-folder-name")?.addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.s3.createFolder();
    });

    document.getElementById("new-bucket-name")?.addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.s3.createBucket();
    });

    // Sort headers
    document.querySelectorAll(".sortable").forEach((header) => {
      header.addEventListener("click", () => {
        const sortKey = header.dataset.sortKey;
        if (this.sortBy === sortKey) {
          this.sortDirection = this.sortDirection === "asc" ? "desc" : "asc";
        } else {
          this.sortBy = sortKey;
          this.sortDirection = "asc";
        }
        this.fileList.renderFileList();
      });
    });

    // PIN modal events
    document.getElementById("save-pin-btn")?.addEventListener("click", () => this.savePinAndConnect());
    document.getElementById("unlock-btn")?.addEventListener("click", () => this.unlockConnection());

    document.getElementById("new-pin")?.addEventListener("keypress", (e) => {
      if (e.key === "Enter") document.getElementById("confirm-pin")?.focus();
    });

    document.getElementById("confirm-pin")?.addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.savePinAndConnect();
    });

    document.getElementById("enter-pin")?.addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.unlockConnection();
    });

    // Quick login
    document.getElementById("skip-quick-login")?.addEventListener("click", () => {
      this.ui.closeModals();
    });

    // Transfer panel toggle
    const transferBtn = document.getElementById("btn-transfers");
    if (transferBtn) {
      transferBtn.addEventListener("click", () => {
        console.log("Transfer button clicked");
        this.toggleTransferPanel();
      });
    } else {
      console.error("Transfer button not found!");
    }

    document.getElementById("btn-close-transfers")?.addEventListener("click", () => {
      console.log("Close transfer button clicked");
      this.toggleTransferPanel();
    });

    // ESC key to close panels
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const transferPanel = document.getElementById("transfer-panel");
        if (transferPanel && !transferPanel.classList.contains("hidden")) {
          this.toggleTransferPanel();
        }
        this.ui.closeModals();
      }
    });

    // Transfer tabs
    document.getElementById("tab-uploads")?.addEventListener("click", (e) => {
      this.switchTransferTab("uploads");
    });

    document.getElementById("tab-downloads")?.addEventListener("click", (e) => {
      this.switchTransferTab("downloads");
    });

    // Progress control buttons
    const pauseBtn = document.getElementById("btn-pause-upload");
    const cancelBtn = document.getElementById("btn-cancel-upload");
    if (pauseBtn) {
      pauseBtn.addEventListener("click", () => {
        console.log("Pause button clicked");
        this.pauseTransfer();
      });
    }
    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
        console.log("Cancel button clicked");
        this.cancelTransfer();
      });
    }
  }

  setupProgressListeners() {
    window.electronAPI.onUploadProgress((progress) => {
      this.ui.updateProgress(progress, "upload");
    });

    window.electronAPI.onDownloadProgress((progress) => {
      this.ui.updateProgress(progress, "download");
    });
  }

  async uploadFile() {
    if (!this.isConnected || !this.currentBucket) {
      this.ui.showToast("Önce bir bucket seçin!", "error");
      return;
    }

    try {
      const result = await window.electronAPI.showOpenDialog({
        properties: ["openFile", "multiSelections"],
      });

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return;
      }

      for (const localPath of result.filePaths) {
        const fileName = localPath.split(/[\\/]/).pop();
        const key = this.currentPath ? `${this.currentPath}${fileName}` : fileName;

        const uploadResult = await window.electronAPI.s3Upload({
          localPath,
          bucket: this.currentBucket,
          key,
        });

        if (uploadResult.success) {
          this.ui.showToast(`${fileName} yüklendi!`, "success");
        } else {
          if (this.isTransferPaused) {
            console.log("Upload paused");
          } else {
            this.ui.showToast(`${fileName} yüklenemedi: ${uploadResult.message}`, "error");
          }
        }
      }

      await this.s3.loadFiles();
      if (!this.isTransferPaused) {
        this.ui.hideProgress();
      }
    } catch (error) {
      this.ui.showToast(`Yükleme hatası: ${error.message}`, "error");
    }
  }

  async downloadFile() {
    if (!this.selectedFile || this.selectedFile.type === "directory") {
      this.ui.showToast("Bir dosya seçin!", "error");
      return;
    }

    try {
      const result = await window.electronAPI.showSaveDialog({
        defaultPath: this.selectedFile.name,
      });

      if (result.canceled || !result.filePath) {
        return;
      }

      const downloadResult = await window.electronAPI.s3Download({
        bucket: this.currentBucket,
        key: this.selectedFile.key,
        localPath: result.filePath,
      });

      if (downloadResult.success) {
        this.ui.showToast("Dosya indirildi!", "success");
        this.ui.hideProgress();
      } else {
        if (this.isTransferPaused) {
          console.log("Download paused");
        } else {
          this.ui.showToast(downloadResult.message, "error");
          this.ui.hideProgress();
        }
      }
    } catch (error) {
      this.ui.showToast(`İndirme hatası: ${error.message}`, "error");
    }
  }

  refreshFileList() {
    if (this.isConnected && this.currentBucket) {
      this.s3.loadFiles();
    }
  }

  // ============================================
  // PIN & Quick Login Methods
  // ============================================

  showQuickLogin() {
    const saved = localStorage.getItem("saved_connections");
    if (!saved) return;

    try {
      const connections = JSON.parse(saved);
      if (connections.length === 0) return;

      const modal = document.getElementById("modal-quick-login");
      const list = document.getElementById("saved-connections-list");

      list.innerHTML = connections
        .map(
          (conn) => `
        <div class="saved-connection-item" data-connection-id="${conn.id}">
          <div class="saved-connection-icon">
            ${conn.type === "s3" ? "☁️" : "🖥️"}
          </div>
          <div class="saved-connection-info">
            <div class="saved-connection-name">${conn.name}</div>
            <div class="saved-connection-meta">
              <span class="saved-connection-type ${conn.type}">${conn.type.toUpperCase()}</span>
              <span>${new Date(conn.createdAt).toLocaleDateString("tr-TR")}</span>
            </div>
          </div>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
      `
        )
        .join("");

      list.querySelectorAll(".saved-connection-item").forEach((item) => {
        item.addEventListener("click", () => {
          const connectionId = item.dataset.connectionId;
          const connection = connections.find((c) => c.id === connectionId);
          if (connection) {
            this.quickConnectWithPin(connection);
          }
        });
      });

      modal.classList.remove("hidden");
    } catch (e) {
      console.error("Quick login error:", e);
    }
  }

  async quickConnectWithPin(connection) {
    this.connectionType = connection.type;
    document.getElementById("modal-quick-login").classList.add("hidden");

    this.pendingConnection = {
      type: connection.type,
      connectionId: connection.id,
      autoConnect: true,
    };
    this.showPinModal(connection.name);
  }

  findSavedConnection(type, identifier) {
    const saved = localStorage.getItem("saved_connections");
    if (!saved) return null;

    try {
      const connections = JSON.parse(saved);
      return connections.find(
        (c) => c.type === type && c.identifier === identifier
      );
    } catch (e) {
      return null;
    }
  }

  showSetPinModal() {
    document.getElementById("modal-set-pin").classList.remove("hidden");
    document.getElementById("new-pin").value = "";
    document.getElementById("confirm-pin").value = "";
    document.getElementById("new-pin").focus();
  }

  showPinModal(connectionName) {
    document.getElementById("modal-enter-pin").classList.remove("hidden");
    document.getElementById("saved-connection-name").textContent = connectionName;
    document.getElementById("enter-pin").value = "";
    const pinError = document.getElementById("pin-error");
    if (pinError) pinError.classList.add("hidden");
    document.getElementById("enter-pin").focus();
  }

  async savePinAndConnect() {
    const pin = document.getElementById("new-pin").value;
    const confirmPin = document.getElementById("confirm-pin").value;

    if (!pin || pin.length < 4) {
      this.ui.showToast("PIN en az 4 haneli olmalı", "error");
      return;
    }

    if (pin !== confirmPin) {
      this.ui.showToast("PIN'ler eşleşmiyor", "error");
      return;
    }

    if (!this.pendingConnection) {
      this.ui.showToast("Bağlantı bilgisi bulunamadı", "error");
      return;
    }

    // Encrypt and save
    const encrypted = CryptoHelper.encrypt(this.pendingConnection.config, pin);
    if (!encrypted) {
      this.ui.showToast("Şifreleme hatası", "error");
      return;
    }

    const saved = localStorage.getItem("saved_connections");
    const connections = saved ? JSON.parse(saved) : [];

    const identifier =
      this.pendingConnection.type === "s3"
        ? this.pendingConnection.config.endpoint || "aws-s3"
        : this.pendingConnection.config.host;

    connections.push({
      id: Date.now().toString(),
      type: this.pendingConnection.type,
      name: this.pendingConnection.name,
      identifier,
      encrypted,
      createdAt: new Date().toISOString(),
    });

    localStorage.setItem("saved_connections", JSON.stringify(connections));
    this.ui.showToast("✅ Bağlantı PIN ile kaydedildi!", "success");
    this.ui.closeModals();
    this.pendingConnection = null;
  }

  async unlockConnection() {
    const pin = document.getElementById("enter-pin").value;

    if (!pin) {
      this.ui.showToast("PIN giriniz", "error");
      return;
    }

    if (!this.pendingConnection) {
      this.ui.showToast("Bağlantı bilgisi bulunamadı", "error");
      return;
    }

    const saved = localStorage.getItem("saved_connections");
    if (!saved) {
      this.ui.showToast("Kayıtlı bağlantı bulunamadı", "error");
      return;
    }

    const connections = JSON.parse(saved);
    const connection = connections.find(
      (c) => c.id === this.pendingConnection.connectionId
    );

    if (!connection) {
      this.ui.showToast("Bağlantı bulunamadı", "error");
      return;
    }

    // Decrypt config
    const config = CryptoHelper.decrypt(connection.encrypted, pin);

    if (!config) {
      const pinError = document.getElementById("pin-error");
      if (pinError) pinError.classList.remove("hidden");
      document.getElementById("enter-pin").value = "";
      document.getElementById("enter-pin").focus();
      setTimeout(() => {
        if (pinError) pinError.classList.add("hidden");
      }, 2000);
      return;
    }

    this.ui.closeModals();

    const isAutoConnect = this.pendingConnection.autoConnect;

    if (connection.type === "s3") {
      document.getElementById("s3-access-key").value = config.accessKeyId;
      document.getElementById("s3-secret-key").value = config.secretAccessKey;
      document.getElementById("s3-region").value = config.region;
      document.getElementById("s3-endpoint").value = config.endpoint || "";
      document.getElementById("s3-remember").checked = false;

      if (isAutoConnect) {
        await this.s3.performConnect(config);
        this.ui.showToast("🚀 Hızlı giriş başarılı!", "success");
      } else {
        this.ui.showToast("Form bilgileri dolduruldu", "success");
      }
    }

    this.pendingConnection = null;
  }

  // ============================================
  // Transfer Control Methods
  // ============================================

  async pauseTransfer() {
    console.log("pauseTransfer called, current pause state:", this.isTransferPaused);
    
    if (this.isTransferPaused) {
      // Resume
      console.log("Resuming transfer");
      await this.resumeTransfer();
    } else {
      // Pause
      console.log("Pausing transfer");
      try {
        const result = await window.electronAPI.pauseTransfer({
          connectionType: this.connectionType,
        });
        
        console.log("Pause transfer API result:", JSON.stringify(result, null, 2));
        
        if (result && result.success) {
          this.isTransferPaused = true;
          this.updatePauseButton(true);
          this.ui.showToast("Transfer duraklatıldı", "info");
          console.log("Transfer paused successfully");
        } else {
          console.warn("Pause failed, result:", JSON.stringify(result, null, 2));
          this.ui.showToast("Transfer duraklatılamadı: " + (result?.message || "Bilinmeyen hata"), "error");
        }
      } catch (error) {
        console.error("Pause transfer error:", error);
        this.ui.showToast("Transfer duraklatılamadı: " + error.message, "error");
      }
    }
  }

  async resumeTransfer() {
    console.log("resumeTransfer called");
    try {
      const result = await window.electronAPI.resumeTransfer({
        connectionType: this.connectionType,
      });
      
      if (result && result.success) {
        this.isTransferPaused = false;
        this.updatePauseButton(false);
        this.ui.showToast("Transfer devam ediyor", "success");
      } else {
        this.ui.showToast("Transfer devam ettirilemedi", "error");
      }
    } catch (error) {
      console.error("Resume transfer error:", error);
      this.ui.showToast("Transfer devam ettirilemedi: " + error.message, "error");
    }
  }

  async cancelTransfer() {
    console.log("cancelTransfer called");
    try {
      await window.electronAPI.cancelAllTransfers();
      this.isTransferPaused = false;
      this.updatePauseButton(false);
      this.ui.showToast("Transfer iptal edildi", "info");
      this.ui.hideProgress();
    } catch (error) {
      console.error("Cancel transfer error:", error);
      this.ui.showToast("Transfer iptal edilemedi: " + error.message, "error");
    }
  }

  updatePauseButton(isPaused) {
    const pauseBtn = document.getElementById("btn-pause-upload");
    if (pauseBtn) {
      const icon = pauseBtn.querySelector("svg");
      const text = pauseBtn.querySelector("span");
      
      if (isPaused) {
        // Resume state
        pauseBtn.title = "Devam Ettir";
        if (text) text.textContent = "Devam Ettir";
        // Change icon to play
        if (icon) {
          icon.innerHTML = `
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          `;
        }
      } else {
        // Pause state  
        pauseBtn.title = "Duraklat";
        if (text) text.textContent = "Duraklat";
        // Change icon to pause
        if (icon) {
          icon.innerHTML = `
            <rect x="6" y="4" width="4" height="16"></rect>
            <rect x="14" y="4" width="4" height="16"></rect>
          `;
        }
      }
    }
  }

  toggleTransferPanel() {
    const panel = document.getElementById("transfer-panel");
    console.log("toggleTransferPanel called, panel:", panel);
    if (panel) {
      panel.classList.toggle("hidden");
      console.log("Panel classes:", panel.className);
    } else {
      console.error("Transfer panel element not found!");
    }
  }

  switchTransferTab(tabName) {
    const uploadTab = document.getElementById("tab-uploads");
    const downloadTab = document.getElementById("tab-downloads");
    const uploadList = document.getElementById("uploads-list");
    const downloadList = document.getElementById("downloads-list");

    if (tabName === "uploads") {
      uploadTab?.classList.add("active");
      downloadTab?.classList.remove("active");
      uploadList?.classList.remove("hidden");
      downloadList?.classList.add("hidden");
    } else {
      uploadTab?.classList.remove("active");
      downloadTab?.classList.add("active");
      uploadList?.classList.add("hidden");
      downloadList?.classList.remove("hidden");
    }
  }
}

// Initialize app when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  window.app = new CloudFileManager();
});
