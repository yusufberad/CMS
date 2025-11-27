// ============================================
// Heysem Cloud Manager - Renderer Script
// ============================================

class CloudFileManager {
  constructor() {
    this.connectionType = "ftp";
    this.isConnected = false;
    this.currentPath = "/";
    this.selectedFile = null;
    this.currentBucket = null;
    this.files = [];
    this.pendingConnection = null; // PIN onayı bekleyen bağlantı
    this.currentTags = []; // Mevcut tag'ler
    this.transfers = { active: [], completed: [] }; // Transfer yöneticisi
    this.transferIdCounter = 0;
    this.lastProgressUpdate = { time: 0, bytes: 0 };
    this.speedHistory = [];
    this.searchQuery = "";
    this.sortBy = "name";
    this.sortDirection = "asc";
    this.dragCounter = 0;
    this.dropOverlay = null;
    this.theme = "light";
    this.themeStorageKey = "heysem_cloud_theme";
    this.progressAnimation = {
      displayedPercent: 0,
      targetPercent: 0,
      displayedBytes: 0,
      targetBytes: 0,
      totalBytes: 0,
      displayedSpeed: 0,
      targetSpeed: 0,
      frame: null,
      lastFrame: 0,
      fileName: "",
      etaText: "Tahminleniyor...",
    };
    this.platform =
      (window.electronAPI && window.electronAPI.getPlatform
        ? window.electronAPI.getPlatform()
        : undefined) || "browser";
    this.isMac = this.platform === "darwin";

    if (this.isMac) {
      document.body.classList.add("is-macos");
    } else {
      document.body.classList.remove("is-macos");
    }

    // Debug timestamps
    this.debugTimestamps = new Map();
    this.enableDebug = false; // Debug modunu aç/kapa
    this.activeActionMenu = null;
    this.boundActionMenuOutsideClick =
      this.handleActionMenuOutsideClick.bind(this);

    this.init();
  }

  init() {
    this.initTheme();
    this.bindEvents();
    this.setupDragAndDrop();
    this.setupProgressListeners();
    this.showQuickLogin();
  }

  bindEvents() {
    // Titlebar kontrolleri
    document
      .getElementById("titlebar-minimize")
      .addEventListener("click", () => {
        window.electronAPI.minimizeWindow();
      });

    document
      .getElementById("titlebar-maximize")
      .addEventListener("click", () => {
        window.electronAPI.maximizeWindow();
      });

    document.getElementById("titlebar-close").addEventListener("click", () => {
      window.electronAPI.closeWindow();
    });

    // Bağlantı türü seçimi
    document.querySelectorAll(".conn-btn").forEach((btn) => {
      btn.addEventListener("click", (e) =>
        this.switchConnectionType(e.target.closest(".conn-btn").dataset.type)
      );
    });

    // FTP Bağlan
    document
      .getElementById("ftp-connect-btn")
      .addEventListener("click", () => this.connectFTP());

    // S3 Bağlan
    document
      .getElementById("s3-connect-btn")
      .addEventListener("click", () => this.connectS3());

    // Toolbar butonları
    document
      .getElementById("btn-upload")
      .addEventListener("click", () => this.uploadFile());
    document
      .getElementById("btn-download")
      .addEventListener("click", () => this.downloadFile());
    document
      .getElementById("btn-new-folder")
      ?.addEventListener("click", () => this.showNewFolderModal());
    document
      .getElementById("btn-tags")
      .addEventListener("click", () => this.showTagsModal());
    document
      .getElementById("btn-refresh")
      .addEventListener("click", () => this.refreshFileList());
    document
      .getElementById("btn-open-shared-link")
      .addEventListener("click", () => this.showSharedLinkModal());

    const searchInput = document.getElementById("file-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", (event) =>
        this.handleSearchInput(event.target.value)
      );
    }

    // Bucket seçimi
    document.getElementById("bucket-list").addEventListener("change", (e) => {
      this.currentBucket = e.target.value;
      this.currentPath = "";
      if (this.currentBucket) {
        this.loadS3Files();
      }
    });

    // Yeni bucket
    const newBucketBtn = document.getElementById("btn-new-bucket");
    if (newBucketBtn) {
      newBucketBtn.addEventListener("click", () => this.showNewBucketModal());
    }

    // Modal olayları
    document
      .querySelectorAll(".modal-overlay, .modal-close, .modal-cancel")
      .forEach((el) => {
        el.addEventListener("click", () => this.closeModals());
      });

    const deleteBtn = document.getElementById("btn-delete");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", () => this.deleteFile());
    }

    document
      .getElementById("create-folder-btn")
      .addEventListener("click", () => this.createFolder());
    document
      .getElementById("create-bucket-btn")
      .addEventListener("click", () => this.createBucket());
    document
      .getElementById("open-shared-link-btn")
      .addEventListener("click", () => this.openSharedLink());

    // Enter tuşu ile klasör oluştur
    document
      .getElementById("new-folder-name")
      .addEventListener("keypress", (e) => {
        if (e.key === "Enter") this.createFolder();
      });

    // Enter tuşu ile bucket oluştur
    document
      .getElementById("new-bucket-name")
      .addEventListener("keypress", (e) => {
        if (e.key === "Enter") this.createBucket();
      });

    // PIN modal olayları
    document
      .getElementById("save-pin-btn")
      .addEventListener("click", () => this.savePinAndConnect());
    document
      .getElementById("unlock-btn")
      .addEventListener("click", () => this.unlockConnection());

    document.getElementById("new-pin").addEventListener("keypress", (e) => {
      if (e.key === "Enter") document.getElementById("confirm-pin").focus();
    });

    document.getElementById("confirm-pin").addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.savePinAndConnect();
    });

    document.getElementById("enter-pin").addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.unlockConnection();
    });

    document.getElementById("shared-link-input").addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.openSharedLink();
    });

    const copyShareBtn = document.getElementById("copy-share-link-btn");
    if (copyShareBtn) {
      copyShareBtn.addEventListener("click", () => this.copyShareLink());
    }

    document.querySelectorAll(".sortable").forEach((header) => {
      header.addEventListener("click", () =>
        this.handleSortInteraction(header.dataset.sortKey)
      );
      header.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.handleSortInteraction(header.dataset.sortKey);
        }
      });
    });

    // Quick login modal
    document
      .getElementById("skip-quick-login")
      .addEventListener("click", () => {
        this.closeModals();
      });

    // Tag modal olayları
    document
      .getElementById("add-tag-btn")
      .addEventListener("click", () => this.addTag());
    document
      .getElementById("save-tags-btn")
      .addEventListener("click", () => this.saveTags());

    document.getElementById("tag-key").addEventListener("keypress", (e) => {
      if (e.key === "Enter") document.getElementById("tag-value").focus();
    });

    document.getElementById("tag-value").addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.addTag();
    });

    // Preset tag'ler
    document.querySelectorAll(".preset-tag").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.getElementById("tag-key").value = btn.dataset.key;
        document.getElementById("tag-value").value = btn.dataset.value;
        this.addTag();
      });
    });

    // Transfer panel
    document
      .getElementById("btn-transfers")
      .addEventListener("click", () => this.toggleTransferPanel());
    document
      .getElementById("close-transfers")
      .addEventListener("click", () => this.toggleTransferPanel());
    document
      .getElementById("clear-completed")
      .addEventListener("click", () => this.clearCompleted());

    document.querySelectorAll(".transfer-tab").forEach((tab) => {
      tab.addEventListener("click", () =>
        this.switchTransferTab(tab.dataset.tab)
      );
    });

    // Dosya listesi çift tıklama
    document.getElementById("file-list").addEventListener("dblclick", (e) => {
      const fileItem = e.target.closest(".file-item");
      if (fileItem) {
        if (fileItem.dataset.type === "directory") {
          this.navigateToFolder(fileItem.dataset.name);
        } else {
          // Dosya ise resim mi video mu kontrol et
          const fileName = fileItem.dataset.name;
          if (this.isImageFile(fileName)) {
            this.showImagePreview(fileItem);
          } else if (this.isVideoFile(fileName)) {
            this.showVideoPreview(fileItem);
          }
        }
      }
    });
  }

  setupProgressListeners() {
    window.electronAPI.onUploadProgress((progress) => {
      this.updateProgress(progress, "upload");
      this.updateTransferProgress(progress.fileName, progress);
    });

    window.electronAPI.onDownloadProgress((progress) => {
      this.updateProgress(progress, "download");
      this.updateTransferProgress(progress.fileName, progress);
    });
  }

  switchConnectionType(type) {
    // Eğer bağlıysa tip değişikliğine izin verme
    if (this.isConnected) {
      this.showToast("Tip değiştirmek için önce bağlantıyı kesin", "error");
      return;
    }

    this.connectionType = type;

    // Butonları güncelle
    document.querySelectorAll(".conn-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.type === type);
    });

    // Formları göster/gizle
    document
      .getElementById("ftp-form")
      .classList.toggle("hidden", type !== "ftp");
    document
      .getElementById("s3-form")
      .classList.toggle("hidden", type !== "s3");
  }

  async disconnect() {
    if (this.connectionType === "ftp") {
      await window.electronAPI.ftpDisconnect();
    } else {
      await window.electronAPI.s3Disconnect();
    }

    this.isConnected = false;
    this.currentPath = "/";
    this.currentBucket = null;
    this.files = [];
    this.selectedFile = null;

    this.updateConnectionStatus(false);
    this.disableToolbar();
    this.clearFileList();
    this.enableConnectionForm(this.connectionType);
    this.updateConnectButton(this.connectionType, false);

    document.getElementById("bucket-selector").classList.add("hidden");
    document.getElementById("bucket-list").innerHTML =
      '<option value="">Bucket seçin...</option>';

    this.hideDropOverlay();
    this.dragCounter = 0;

    this.showToast("Bağlantı kesildi", "info");
  }

  updateConnectionStatus(connected) {
    const status = document.getElementById("connection-status");
    const indicator = status.querySelector(".status-indicator");
    const text = status.querySelector("span");

    indicator.classList.toggle("connected", connected);
    text.textContent = connected
      ? `${this.connectionType.toUpperCase()} bağlandı`
      : "Bağlı değil";
  }

  enableToolbar() {
    document.querySelectorAll(".toolbar-btn").forEach((btn) => {
      btn.disabled = false;
    });
  }

  disableToolbar() {
    document.querySelectorAll(".toolbar-btn").forEach((btn) => {
      btn.disabled = true;
    });
    document.getElementById("btn-download").disabled = true;
    const deleteBtn = document.getElementById("btn-delete");
    if (deleteBtn) {
      deleteBtn.disabled = true;
    }
  }

  disableConnectionForm(type) {
    if (type === "ftp") {
      document.getElementById("ftp-host").disabled = true;
      document.getElementById("ftp-port").disabled = true;
      document.getElementById("ftp-user").disabled = true;
      document.getElementById("ftp-password").disabled = true;
      document.getElementById("ftp-secure").disabled = true;
    } else {
      document.getElementById("s3-access-key").disabled = true;
      document.getElementById("s3-secret-key").disabled = true;
      document.getElementById("s3-region").disabled = true;
      document.getElementById("s3-endpoint").disabled = true;
    }
  }

  enableConnectionForm(type) {
    if (type === "ftp") {
      document.getElementById("ftp-host").disabled = false;
      document.getElementById("ftp-port").disabled = false;
      document.getElementById("ftp-user").disabled = false;
      document.getElementById("ftp-password").disabled = false;
      document.getElementById("ftp-secure").disabled = false;
    } else {
      document.getElementById("s3-access-key").disabled = false;
      document.getElementById("s3-secret-key").disabled = false;
      document.getElementById("s3-region").disabled = false;
      document.getElementById("s3-endpoint").disabled = false;
    }
  }

  updateConnectButton(type, isConnected) {
    const btn = document.getElementById(
      type === "ftp" ? "ftp-connect-btn" : "s3-connect-btn"
    );
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
        this.showToast(result.message, "error");
      }
    } catch (error) {
      this.showToast(`Bucket listesi alınamadı: ${error.message}`, "error");
    }
  }

  async loadFTPFiles() {
    try {
      const result = await window.electronAPI.ftpList(this.currentPath);

      if (result.success) {
        this.files = result.files;
        this.renderFileList();
        this.updateBreadcrumb();
      } else {
        this.showToast(result.message, "error");
      }
    } catch (error) {
      this.showToast(`Dosya listesi alınamadı: ${error.message}`, "error");
    }
  }

  async loadS3Files() {
    if (!this.currentBucket) return;

    try {
      const result = await window.electronAPI.s3List({
        bucket: this.currentBucket,
        prefix: this.currentPath,
      });

      if (result.success) {
        this.files = result.files;
        this.renderFileList();
        this.updateBreadcrumb();
      } else {
        this.showToast(result.message, "error");
      }
    } catch (error) {
      this.showToast(`Dosya listesi alınamadı: ${error.message}`, "error");
    }
  }

  renderFileList() {
    const container = document.getElementById("file-list");

    const filesToRender = this.getFilteredAndSortedFiles();

    if (filesToRender.length === 0) {
      const message = this.searchQuery
        ? "Arama kriterlerine uygun dosya bulunamadı"
        : "Bu klasör boş";
      container.innerHTML = `
        <div class="empty-state">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          <p>${message}</p>
        </div>
      `;
      this.updateSortIndicators();
      return;
    }

    container.innerHTML = filesToRender
      .map(
        (file, index) => `
      <div class="file-item" data-name="${file.name}" data-type="${
          file.type
        }" data-key="${file.key || ""}" style="animation-delay: ${
          index * 0.02
        }s">
        <div class="file-name">
          <div class="file-icon ${file.type}">
            ${
              file.type === "directory"
                ? `
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
            `
                : `
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
            `
            }
          </div>
          <span>${file.name}</span>
        </div>
        <div class="file-size">${
          file.type === "directory" ? "-" : this.formatSize(file.size)
        }</div>
        <div class="file-date">${
          file.modifiedAt ? this.formatDate(file.modifiedAt) : "-"
        }</div>
        <div class="file-type">${
          file.type === "directory" ? "Klasör" : this.getFileType(file.name)
        }</div>
        <div class="file-actions">
          <button class="file-action-trigger" title="İşlemler" aria-label="Dosya işlemleri">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="5" r="1.5"/>
              <circle cx="12" cy="12" r="1.5"/>
              <circle cx="12" cy="19" r="1.5"/>
            </svg>
          </button>
          <div class="file-action-menu">
            <button class="file-action-btn share" data-action="share">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="6" cy="12" r="3"/>
                <circle cx="18" cy="6" r="3"/>
                <circle cx="18" cy="18" r="3"/>
                <line x1="8.59" y1="10.51" x2="15.42" y2="7.49"/>
                <line x1="8.59" y1="13.49" x2="15.42" y2="16.51"/>
              </svg>
              <span>Paylaş</span>
            </button>
            <button class="file-action-btn delete" data-action="delete">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M10 11v6"/>
                <path d="M14 11v6"/>
                <path d="M5 6l1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14"/>
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
              <span>Sil</span>
            </button>
          </div>
        </div>
      </div>
    `
      )
      .join("");

    // Dosya seçimi olayları
    container.querySelectorAll(".file-item").forEach((item) => {
      item.addEventListener("click", (e) => this.selectFile(item));
    });

    this.bindFileActions(container);
    this.updateSortIndicators();
  }

  getFilteredAndSortedFiles() {
    if (!Array.isArray(this.files)) return [];

    const query = this.searchQuery.trim().toLowerCase();
    const filtered = query
      ? this.files.filter((file) =>
          file.name.toLowerCase().includes(query)
        )
      : [...this.files];

    return filtered.sort((a, b) => this.compareFiles(a, b));
  }

  compareFiles(a, b) {
    const direction = this.sortDirection === "asc" ? 1 : -1;
    const sortKey = this.sortBy;

    if (sortKey === "name") {
      if (a.type === "directory" && b.type !== "directory") return -1;
      if (a.type !== "directory" && b.type === "directory") return 1;
      return (
        a.name.localeCompare(b.name, "tr", { sensitivity: "base" }) * direction
      );
    }

    const valueA = this.getSortValue(a, sortKey);
    const valueB = this.getSortValue(b, sortKey);

    if (valueA < valueB) return -1 * direction;
    if (valueA > valueB) return 1 * direction;

    return (
      a.name.localeCompare(b.name, "tr", { sensitivity: "base" }) * direction
    );
  }

  getSortValue(file, key) {
    switch (key) {
      case "size":
        return file.type === "directory" ? 0 : file.size || 0;
      case "date":
        return file.modifiedAt ? new Date(file.modifiedAt).getTime() : 0;
      case "type":
        return `${file.type}-${this.getFileType(file.name).toLowerCase()}`;
      default:
        return file.name.toLowerCase();
    }
  }

  handleSearchInput(value) {
    this.searchQuery = value ?? "";
    this.renderFileList();
  }

  handleSortInteraction(sortKey) {
    if (!sortKey) return;
    if (this.sortBy === sortKey) {
      this.sortDirection = this.sortDirection === "asc" ? "desc" : "asc";
    } else {
      this.sortBy = sortKey;
      this.sortDirection = "asc";
    }
    this.renderFileList();
  }

  updateSortIndicators() {
    document.querySelectorAll(".sortable").forEach((header) => {
      const key = header.dataset.sortKey;
      const isActive = key === this.sortBy;
      header.classList.toggle("active", isActive);
      const indicator = header.querySelector(".sort-indicator");
      if (indicator) {
        indicator.dataset.direction = isActive ? this.sortDirection : "";
      }
    });
  }

  bindFileActions(container) {
    container.querySelectorAll(".file-action-trigger").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        this.toggleFileActionMenu(btn);
      });
    });

    container.querySelectorAll(".file-action-btn").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const action = btn.dataset.action;
        const fileItem = btn.closest(".file-item");
        this.closeAllActionMenus();

        if (!fileItem) return;
        this.selectFile(fileItem);

        if (action === "delete") {
          this.deleteFile();
        } else if (action === "share") {
          this.shareSelectedFile();
        }
      });
    });
  }

  setupDragAndDrop() {
    this.dropOverlay = document.getElementById("drop-overlay");
    if (!this.dropOverlay) return;

    const preventDefaults = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
      document.addEventListener(eventName, preventDefaults, false);
    });

    document.addEventListener(
      "dragenter",
      (event) => {
        if (!this.isConnected) return;
        const hasFiles = Array.from(event.dataTransfer?.types || []).includes(
          "Files"
        );
        if (!hasFiles) return;
        this.dragCounter += 1;
        this.showDropOverlay();
      },
      false
    );

    document.addEventListener(
      "dragover",
      (event) => {
        if (!this.isConnected) return;
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "copy";
        }
      },
      false
    );

    document.addEventListener(
      "dragleave",
      () => {
        this.dragCounter = Math.max(0, this.dragCounter - 1);
        if (this.dragCounter === 0) {
          this.hideDropOverlay();
        }
      },
      false
    );

    document.addEventListener(
      "drop",
      async (event) => {
        this.dragCounter = 0;
        this.hideDropOverlay();

        const files = Array.from(event.dataTransfer?.files || []);
        if (!files.length) return;

        const paths = files.map((file) => file.path).filter(Boolean);
        if (!paths.length) {
          this.showToast("Bırakılan dosyalar okunamadı", "error");
          return;
        }

        await this.uploadSelectedFiles(paths);
      },
      false
    );
  }

  showDropOverlay() {
    if (!this.dropOverlay) return;
    this.dropOverlay.classList.remove("hidden");
    this.dropOverlay.classList.add("show");
  }

  hideDropOverlay() {
    if (!this.dropOverlay) return;
    this.dropOverlay.classList.remove("show");
    this.dropOverlay.classList.add("hidden");
  }

  toggleFileActionMenu(button) {
    const menu = button.nextElementSibling;
    if (!menu) return;

    const isOpen = menu.classList.contains("open");
    this.closeAllActionMenus();

    if (!isOpen) {
      menu.classList.add("open");
      this.activeActionMenu = menu;
      document.addEventListener("click", this.boundActionMenuOutsideClick);
    }
  }

  closeAllActionMenus() {
    document
      .querySelectorAll(".file-action-menu.open")
      .forEach((menu) => menu.classList.remove("open"));

    this.activeActionMenu = null;
    document.removeEventListener("click", this.boundActionMenuOutsideClick);
  }

  handleActionMenuOutsideClick(event) {
    if (!event.target.closest(".file-actions")) {
      this.closeAllActionMenus();
    }
  }

  selectFile(item) {
    // Önceki seçimi kaldır
    document.querySelectorAll(".file-item.selected").forEach((el) => {
      el.classList.remove("selected");
    });

    // Yeni seçimi uygula
    item.classList.add("selected");
    this.selectedFile = {
      name: item.dataset.name,
      type: item.dataset.type,
      key: item.dataset.key,
    };

    // İndir ve Sil butonlarını etkinleştir (sadece dosyalar için indir)
    document.getElementById("btn-download").disabled =
      this.selectedFile.type === "directory";
    const deleteBtn = document.getElementById("btn-delete");
    if (deleteBtn) {
      deleteBtn.disabled = false;
    }

    // Tag butonu - sadece S3 ve dosyalar için
    const isS3File =
      this.connectionType === "s3" && this.selectedFile.type === "file";
    document.getElementById("btn-tags").disabled = !isS3File;
  }

  navigateToFolder(folderName) {
    if (this.connectionType === "ftp") {
      this.currentPath =
        this.currentPath === "/"
          ? `/${folderName}`
          : `${this.currentPath}/${folderName}`;
      this.loadFTPFiles();
    } else {
      this.currentPath = this.currentPath
        ? `${this.currentPath}${folderName}/`
        : `${folderName}/`;
      this.loadS3Files();
    }

    this.selectedFile = null;
    document.getElementById("btn-download").disabled = true;
    const deleteBtn = document.getElementById("btn-delete");
    if (deleteBtn) {
      deleteBtn.disabled = true;
    }
  }

  updateBreadcrumb() {
    const container = document.getElementById("breadcrumb");
    let pathParts = [];

    if (this.connectionType === "s3" && this.currentBucket) {
      pathParts.push({ name: this.currentBucket, path: "" });
    } else {
      pathParts.push({ name: "Ana Dizin", path: "/" });
    }

    if (this.currentPath && this.currentPath !== "/") {
      const parts = this.currentPath.split("/").filter((p) => p);
      let currentPath = this.connectionType === "ftp" ? "" : "";

      parts.forEach((part) => {
        currentPath += this.connectionType === "ftp" ? `/${part}` : `${part}/`;
        pathParts.push({ name: part, path: currentPath });
      });
    }

    container.innerHTML = pathParts
      .map(
        (part, index) => `
      ${index > 0 ? '<span class="breadcrumb-separator">/</span>' : ""}
      <span class="breadcrumb-item" data-path="${part.path}">${part.name}</span>
    `
      )
      .join("");

    // Breadcrumb tıklama olayları
    container.querySelectorAll(".breadcrumb-item").forEach((item) => {
      item.addEventListener("click", () => {
        this.currentPath = item.dataset.path;
        this.selectedFile = null;
        this.refreshFileList();
      });
    });
  }

  async uploadFile() {
    const result = await window.electronAPI.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      title: "Yüklenecek dosyaları seçin",
    });

    if (result.canceled || !result.filePaths.length) return;

    await this.uploadSelectedFiles(result.filePaths);
  }

  async uploadSelectedFiles(filePaths = []) {
    const paths = (filePaths || []).filter(Boolean);
    if (!paths.length) return;

    if (!this.isConnected) {
      this.showToast("Dosya yüklemek için önce bağlanın", "error");
      return;
    }

    this.showProgress();

    for (const localPath of paths) {
      // Transfer ID oluştur (debug için)
      const transferId = `upload-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      // DEBUG: Transfer başlangıcı
      this.debugLog(transferId, "TRANSFER_CREATED", {
        path: localPath,
        type: "upload",
        connectionType: this.connectionType,
      });

      // DEBUG: Dosya bilgisi okuma başlangıcı
      this.debugLog(transferId, "FILE_INFO_START");
      const fileInfo = await window.electronAPI.getFileInfo(localPath);
      this.debugLog(transferId, "FILE_INFO_END", {
        fileName: fileInfo.info?.name,
        size: fileInfo.info?.size,
      });

      if (!fileInfo.success) continue;

      // Transfer kaydı oluştur
      const transferRecord = this.addTransfer(
        fileInfo.info.name,
        "upload",
        fileInfo.info.size
      );
      transferRecord.debugId = transferId; // Debug ID'yi kaydet

      // Büyük dosyalar için hazırlanıyor mesajı
      if (fileInfo.info.size > 50 * 1024 * 1024) {
        // 50MB+
        this.showToast("📦 Büyük dosya hazırlanıyor...", "info");
      }

      try {
        if (this.connectionType === "ftp") {
          const remotePath =
            this.currentPath === "/"
              ? `/${fileInfo.info.name}`
              : `${this.currentPath}/${fileInfo.info.name}`;

          // DEBUG: IPC çağrısı başlangıcı
          this.debugLog(transferId, "IPC_CALL_START", { method: "ftpUpload" });
          const uploadResult = await window.electronAPI.ftpUpload({
            localPath,
            remotePath,
          });
          this.debugLog(transferId, "IPC_CALL_END");

          if (uploadResult.success) {
            this.debugLog(transferId, "COMPLETED");
            this.showToast(`${fileInfo.info.name} yüklendi!`, "success");
            this.completeTransfer(fileInfo.info.name, true);
          } else {
            this.debugLog(transferId, "FAILED", {
              error: uploadResult.message,
            });
            this.showToast(uploadResult.message, "error");
            this.completeTransfer(fileInfo.info.name, false);
          }
        } else {
          const key = this.currentPath
            ? `${this.currentPath}${fileInfo.info.name}`
            : fileInfo.info.name;

          // DEBUG: IPC çağrısı başlangıcı
          this.debugLog(transferId, "IPC_CALL_START", { method: "s3Upload" });
          const uploadResult = await window.electronAPI.s3Upload({
            localPath,
            bucket: this.currentBucket,
            key,
          });
          this.debugLog(transferId, "IPC_CALL_END");

          if (uploadResult.success) {
            this.debugLog(transferId, "COMPLETED");
            this.showToast(`${fileInfo.info.name} S3'e yüklendi!`, "success");
            this.completeTransfer(fileInfo.info.name, true);
          } else {
            this.debugLog(transferId, "FAILED", {
              error: uploadResult.message,
            });
            this.showToast(uploadResult.message, "error");
            this.completeTransfer(fileInfo.info.name, false);
          }
        }
      } catch (error) {
        this.debugLog(transferId, "FAILED", { error: error.message });
        this.showToast(`Yükleme hatası: ${error.message}`, "error");
        this.completeTransfer(fileInfo.info.name, false);
      }
    }

    this.hideProgress();
    this.refreshFileList();
  }

  async downloadFile() {
    if (!this.selectedFile || this.selectedFile.type === "directory") return;

    // Transfer ID oluştur (debug için)
    const transferId = `download-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    // DEBUG: Transfer başlangıcı
    this.debugLog(transferId, "TRANSFER_CREATED", {
      fileName: this.selectedFile.name,
      type: "download",
      connectionType: this.connectionType,
    });

    const result = await window.electronAPI.showSaveDialog({
      title: "Kaydet",
      defaultPath: this.selectedFile.name,
    });

    if (result.canceled || !result.filePath) return;

    this.showProgress();

    // Transfer kaydı oluştur
    const fileItem = this.files.find((f) => f.name === this.selectedFile.name);
    const fileSize = fileItem ? fileItem.size : 0;
    const transferRecord = this.addTransfer(
      this.selectedFile.name,
      "download",
      fileSize
    );
    transferRecord.debugId = transferId; // Debug ID'yi kaydet

    this.debugLog(transferId, "FILE_INFO_END", {
      fileName: this.selectedFile.name,
      size: fileSize,
    });

    try {
      if (this.connectionType === "ftp") {
        const remotePath =
          this.currentPath === "/"
            ? `/${this.selectedFile.name}`
            : `${this.currentPath}/${this.selectedFile.name}`;

        // DEBUG: IPC çağrısı başlangıcı
        this.debugLog(transferId, "IPC_CALL_START", { method: "ftpDownload" });
        const downloadResult = await window.electronAPI.ftpDownload({
          remotePath,
          localPath: result.filePath,
        });
        this.debugLog(transferId, "IPC_CALL_END");

        if (downloadResult.success) {
          this.debugLog(transferId, "COMPLETED");
          this.showToast("Dosya indirildi!", "success");
          this.completeTransfer(this.selectedFile.name, true);
        } else {
          this.debugLog(transferId, "FAILED", {
            error: downloadResult.message,
          });
          this.showToast(downloadResult.message, "error");
          this.completeTransfer(this.selectedFile.name, false);
        }
      } else {
        // DEBUG: IPC çağrısı başlangıcı
        this.debugLog(transferId, "IPC_CALL_START", { method: "s3Download" });
        const downloadResult = await window.electronAPI.s3Download({
          bucket: this.currentBucket,
          key: this.selectedFile.key,
          localPath: result.filePath,
        });
        this.debugLog(transferId, "IPC_CALL_END");

        if (downloadResult.success) {
          this.debugLog(transferId, "COMPLETED");
          this.showToast("Dosya indirildi!", "success");
          this.completeTransfer(this.selectedFile.name, true);
        } else {
          this.debugLog(transferId, "FAILED", {
            error: downloadResult.message,
          });
          this.showToast(downloadResult.message, "error");
          this.completeTransfer(this.selectedFile.name, false);
        }
      }
    } catch (error) {
      this.debugLog(transferId, "FAILED", { error: error.message });
      this.showToast(`İndirme hatası: ${error.message}`, "error");
      this.completeTransfer(this.selectedFile.name, false);
    }

    this.hideProgress();
  }

  showNewFolderModal() {
    document.getElementById("modal-new-folder").classList.remove("hidden");
    document.getElementById("new-folder-name").value = "";
    document.getElementById("new-folder-name").focus();
  }

  showNewBucketModal() {
    document.getElementById("modal-new-bucket").classList.remove("hidden");
    document.getElementById("new-bucket-name").value = "";
    document.getElementById("new-bucket-name").focus();
  }

  showSharedLinkModal() {
    const modal = document.getElementById("modal-shared-link");
    if (!modal) return;
    const input = document.getElementById("shared-link-input");
    if (input) input.value = "";
    modal.classList.remove("hidden");
    setTimeout(() => input?.focus(), 50);
  }

  openSharedLink() {
    const input = document.getElementById("shared-link-input");
    if (!input) return;
    const url = input.value.trim();

    if (!url) {
      this.showToast("Lütfen geçerli bir URL girin", "error");
      return;
    }

    try {
      new URL(url);
    } catch (error) {
      this.showToast("URL formatı geçersiz", "error");
      return;
    }

    const type = this.detectSharedLinkType(url);
    if (type === "unknown") {
      this.showToast("Bu link için önizleme desteklenmiyor", "error");
      return;
    }

    const fileName = this.getFileNameFromUrl(url);
    this.closeModals();
    this.openSharedPreview(type, url, fileName);
  }

  async shareSelectedFile() {
    if (!this.selectedFile || this.selectedFile.type !== "file") {
      this.showToast("Paylaşmak için bir dosya seçin", "error");
      return;
    }

    if (this.connectionType !== "s3") {
      this.showToast("Paylaşım sadece S3 dosyaları için destekleniyor", "error");
      return;
    }

    if (!this.currentBucket) {
      this.showToast("Lütfen bir bucket seçin", "error");
      return;
    }

    try {
      const result = await window.electronAPI.s3GenerateShareLink({
        bucket: this.currentBucket,
        key: this.selectedFile.key,
        expiresIn: 3600, // 1 saat
      });

      if (result.success && result.url) {
        this.showShareLinkResult(result.url);
      } else {
        this.showToast(result.message || "Paylaşım linki oluşturulamadı", "error");
      }
    } catch (error) {
      this.showToast(`Paylaşım hatası: ${error.message}`, "error");
    }
  }

  detectSharedLinkType(url) {
    const cleanUrl = url.split("?")[0].split("#")[0];
    const hasExtension = cleanUrl.includes(".");
    const extension = hasExtension
      ? cleanUrl.split(".").pop().toLowerCase()
      : "";

    if (extension && this.isImageFile(`preview.${extension}`)) {
      return "image";
    }

    if (extension && this.isVideoFile(`preview.${extension}`)) {
      return "video";
    }

    if (["pdf", "txt", "html", "htm"].includes(extension)) {
      return "document";
    }

    return "unknown";
  }

  getFileNameFromUrl(url) {
    try {
      const { pathname } = new URL(url);
      const segments = pathname.split("/").filter(Boolean);
      const rawName = segments.length
        ? decodeURIComponent(segments[segments.length - 1])
        : "";
      return rawName || "Paylaşılan içerik";
    } catch (error) {
      return "Paylaşılan içerik";
    }
  }

  openSharedPreview(type, url, fileName) {
    const modal = document.getElementById("modal-shared-preview");
    if (!modal) return;

    const loader = modal.querySelector(".shared-preview-loader");
    const image = document.getElementById("shared-preview-image");
    const video = document.getElementById("shared-preview-video");
    const frame = document.getElementById("shared-preview-frame");
    const unsupported = document.querySelector(".shared-preview-unsupported");

    if (!loader || !image || !video || !frame || !unsupported) return;

    this.resetSharedPreview();

    document.getElementById("shared-preview-title").textContent =
      fileName || "Paylaşılan içerik";

    loader.style.display = "flex";
    unsupported.classList.add("hidden");
    image.style.display = "none";
    video.style.display = "none";
    frame.style.display = "none";

    const showError = (message) => {
      loader.style.display = "none";
      unsupported.classList.remove("hidden");
      if (message) {
        this.showToast(message, "error");
      }
    };

    modal.classList.remove("hidden");

    if (type === "image") {
      image.onload = () => {
        loader.style.display = "none";
        image.style.display = "block";
      };
      image.onerror = () => showError("Görsel yüklenemedi veya erişilemedi");
      image.src = url;
      return;
    }

    if (type === "video") {
      video.onloadeddata = () => {
        loader.style.display = "none";
        video.style.display = "block";
      };
      video.onerror = () => showError("Video yüklenemedi veya erişilemedi");
      video.src = url;
      video.load();
      return;
    }

    if (type === "document") {
      frame.onload = () => {
        loader.style.display = "none";
        frame.style.display = "block";
      };
      frame.onerror = () =>
        showError("İçerik görüntülenemedi veya erişilemedi");
      frame.src = url;
      return;
    }

    showError("Bu link için önizleme desteklenmiyor");
  }

  showShareLinkResult(url) {
    const modal = document.getElementById("modal-share-result");
    const output = document.getElementById("share-link-output");
    if (!modal || !output) return;

    output.value = url;
    modal.classList.remove("hidden");
    output.focus();
    output.select();
  }

  async copyShareLink() {
    const output = document.getElementById("share-link-output");
    if (!output || !output.value) {
      this.showToast("Kopyalanacak link bulunamadı", "error");
      return;
    }

    try {
      await navigator.clipboard.writeText(output.value);
      this.showToast("Link panoya kopyalandı!", "success");
    } catch (error) {
      output.select();
      const successful = document.execCommand
        ? document.execCommand("copy")
        : false;
      if (successful) {
        this.showToast("Link panoya kopyalandı!", "success");
      } else {
        this.showToast("Kopyalama başarısız oldu", "error");
      }
    }
  }

  resetSharedPreview() {
    const image = document.getElementById("shared-preview-image");
    const video = document.getElementById("shared-preview-video");
    const frame = document.getElementById("shared-preview-frame");
    const loader = document.querySelector(".shared-preview-loader");
    const unsupported = document.querySelector(".shared-preview-unsupported");

    if (image) {
      image.onload = null;
      image.onerror = null;
      image.src = "";
      image.style.display = "none";
    }

    if (video) {
      video.onloadeddata = null;
      video.onerror = null;
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.style.display = "none";
    }

    if (frame) {
      frame.onload = null;
      frame.onerror = null;
      frame.src = "";
      frame.style.display = "none";
    }

    if (loader) {
      loader.style.display = "flex";
    }

    if (unsupported) {
      unsupported.classList.add("hidden");
    }
  }

  closeModals() {
    // Video varsa durdur ve temizle
    const videoElement = document.getElementById("preview-video");
    if (videoElement) {
      // Tüm event listener'ları temizle
      videoElement.removeEventListener("canplay", videoElement._canplayHandler);
      videoElement.removeEventListener("error", videoElement._errorHandler);

      if (!videoElement.paused) {
        videoElement.pause();
      }
      const videoId = videoElement.dataset.videoId;
      videoElement.src = "";
      videoElement.load(); // Reset

      if (videoId) {
        window.electronAPI.cleanupVideo(videoId);
        delete videoElement.dataset.videoId;
      }
    }

    this.resetSharedPreview();

    document.querySelectorAll(".modal").forEach((modal) => {
      modal.classList.add("hidden");
    });
  }

  async createFolder() {
    const folderName = document.getElementById("new-folder-name").value.trim();

    if (!folderName) {
      this.showToast("Lütfen bir klasör adı girin", "error");
      return;
    }

    try {
      if (this.connectionType === "ftp") {
        const remotePath =
          this.currentPath === "/"
            ? `/${folderName}`
            : `${this.currentPath}/${folderName}`;

        const result = await window.electronAPI.ftpMkdir(remotePath);

        if (result.success) {
          this.showToast("Klasör oluşturuldu!", "success");
          this.closeModals();
          this.refreshFileList();
        } else {
          this.showToast(result.message, "error");
        }
      } else {
        // S3'te klasör kavramı yok, boş bir obje oluşturuyoruz
        this.showToast("S3'te klasörler otomatik olarak oluşturulur", "info");
        this.closeModals();
      }
    } catch (error) {
      this.showToast(`Klasör oluşturma hatası: ${error.message}`, "error");
    }
  }

  async createBucket() {
    const bucketName = document
      .getElementById("new-bucket-name")
      .value.trim()
      .toLowerCase();

    if (!bucketName) {
      this.showToast("Lütfen bir bucket adı girin", "error");
      return;
    }

    // Bucket adı kontrolü (S3 kuralları)
    const bucketRegex = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
    if (
      !bucketRegex.test(bucketName) ||
      bucketName.length < 3 ||
      bucketName.length > 63
    ) {
      this.showToast(
        "Geçersiz bucket adı. 3-63 karakter, küçük harf, rakam ve tire kullanın.",
        "error"
      );
      return;
    }

    try {
      const result = await window.electronAPI.s3CreateBucket(bucketName);

      if (result.success) {
        this.showToast("Bucket oluşturuldu!", "success");
        this.closeModals();
        await this.loadBuckets();
        // Yeni bucket'ı seç
        document.getElementById("bucket-list").value = bucketName;
        this.currentBucket = bucketName;
        this.currentPath = "";
        this.loadS3Files();
      } else {
        this.showToast(result.message, "error");
      }
    } catch (error) {
      this.showToast(`Bucket oluşturma hatası: ${error.message}`, "error");
    }
  }

  async deleteFile() {
    if (!this.selectedFile) return;

    const confirmed = confirm(
      `"${this.selectedFile.name}" silinecek. Emin misiniz?`
    );
    if (!confirmed) return;

    try {
      if (this.connectionType === "ftp") {
        const remotePath =
          this.currentPath === "/"
            ? `/${this.selectedFile.name}`
            : `${this.currentPath}/${this.selectedFile.name}`;

        const result = await window.electronAPI.ftpDelete(remotePath);

        if (result.success) {
          this.showToast("Dosya silindi!", "success");
          this.refreshFileList();
        } else {
          this.showToast(result.message, "error");
        }
      } else {
        const result = await window.electronAPI.s3Delete({
          bucket: this.currentBucket,
          key: this.selectedFile.key,
        });

        if (result.success) {
          this.showToast("Dosya silindi!", "success");
          this.refreshFileList();
        } else {
          this.showToast(result.message, "error");
        }
      }
    } catch (error) {
      this.showToast(`Silme hatası: ${error.message}`, "error");
    }

    this.selectedFile = null;
    document.getElementById("btn-download").disabled = true;
    const deleteBtn = document.getElementById("btn-delete");
    if (deleteBtn) {
      deleteBtn.disabled = true;
    }
  }

  refreshFileList() {
    if (this.connectionType === "ftp") {
      this.loadFTPFiles();
    } else if (this.currentBucket) {
      this.loadS3Files();
    }
  }

  // Tag Yönetimi (S3)
  async showTagsModal() {
    if (
      !this.selectedFile ||
      this.selectedFile.type === "directory" ||
      this.connectionType !== "s3"
    ) {
      this.showToast("Sadece S3 dosyaları için tag kullanılabilir", "error");
      return;
    }

    document.getElementById("modal-manage-tags").classList.remove("hidden");
    document.getElementById("tag-file-name").textContent =
      this.selectedFile.name;
    document.getElementById("tag-key").value = "";
    document.getElementById("tag-value").value = "";

    // Mevcut tag'leri yükle
    await this.loadFileTags();
  }

  async loadFileTags() {
    try {
      const result = await window.electronAPI.s3GetTags({
        bucket: this.currentBucket,
        key: this.selectedFile.key,
      });

      if (result.success) {
        this.currentTags = result.tags;
        this.renderTags();
      } else {
        this.showToast(result.message, "error");
      }
    } catch (error) {
      this.showToast(`Tag yükleme hatası: ${error.message}`, "error");
    }
  }

  renderTags() {
    const container = document.getElementById("current-tags");

    if (this.currentTags.length === 0) {
      container.innerHTML = "";
      return;
    }

    container.innerHTML = this.currentTags
      .map(
        (tag) => `
      <div class="tag-item">
        <span class="tag-key">${tag.Key}:</span>
        <span class="tag-value">${tag.Value}</span>
        <button class="tag-remove" data-key="${tag.Key}">×</button>
      </div>
    `
      )
      .join("");

    // Remove butonlarına event listener ekle
    container.querySelectorAll(".tag-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.key;
        this.currentTags = this.currentTags.filter((t) => t.Key !== key);
        this.renderTags();
      });
    });
  }

  addTag() {
    const key = document.getElementById("tag-key").value.trim();
    const value = document.getElementById("tag-value").value.trim();

    if (!key || !value) {
      this.showToast("Anahtar ve değer boş olamaz", "error");
      return;
    }

    // S3 tag limiti: 10
    if (this.currentTags.length >= 10) {
      this.showToast("Maksimum 10 tag ekleyebilirsiniz", "error");
      return;
    }

    // Aynı key varsa güncelle
    const existingIndex = this.currentTags.findIndex((t) => t.Key === key);
    if (existingIndex !== -1) {
      this.currentTags[existingIndex].Value = value;
    } else {
      this.currentTags.push({ Key: key, Value: value });
    }

    this.renderTags();
    document.getElementById("tag-key").value = "";
    document.getElementById("tag-value").value = "";
    document.getElementById("tag-key").focus();
  }

  async saveTags() {
    if (!this.selectedFile) return;

    try {
      const result = await window.electronAPI.s3PutTags({
        bucket: this.currentBucket,
        key: this.selectedFile.key,
        tags: this.currentTags,
      });

      if (result.success) {
        this.showToast("Tag'ler kaydedildi! ✅", "success");
        this.closeModals();
        this.refreshFileList();
      } else {
        this.showToast(result.message, "error");
      }
    } catch (error) {
      this.showToast(`Tag kaydetme hatası: ${error.message}`, "error");
    }
  }

  clearFileList() {
    document.getElementById("file-list").innerHTML = `
      <div class="empty-state">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
          <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>
        </svg>
        <p>Dosyaları görüntülemek için sunucuya bağlanın</p>
      </div>
    `;
    this.updateBreadcrumb();
  }

  showProgress() {
    this.resetSpeedCalculation();
    this.resetProgressAnimation();
    document.getElementById("progress-container").classList.remove("hidden");
  }

  hideProgress() {
    setTimeout(() => {
      document.getElementById("progress-container").classList.add("hidden");
      document.getElementById("progress-fill").style.width = "0%";
      this.resetSpeedCalculation();
      this.resetProgressAnimation();
    }, 500);
  }

  updateProgress(progress, type) {
    const size = type === "upload" ? progress.uploaded : progress.downloaded;
    const speed = this.calculateSpeed(size);

    this.progressAnimation.fileName = progress.fileName;
    this.progressAnimation.targetPercent = progress.percentage;
    this.progressAnimation.targetBytes = size;
    this.progressAnimation.totalBytes = progress.total;
    this.progressAnimation.targetSpeed = speed;

    this.startProgressAnimation();
  }

  calculateSpeed(currentBytes) {
    const now = Date.now();

    // İlk güncelleme veya 100ms'den kısa sürede gelen güncellemeleri atla
    if (
      this.lastProgressUpdate.time === 0 ||
      now - this.lastProgressUpdate.time < 100
    ) {
      if (this.lastProgressUpdate.time === 0) {
        this.lastProgressUpdate = { time: now, bytes: currentBytes };
      }
      return this.speedHistory.length > 0
        ? this.speedHistory[this.speedHistory.length - 1]
        : 0;
    }

    // Hız hesapla (bytes/second)
    const timeDiff = (now - this.lastProgressUpdate.time) / 1000; // saniyeye çevir
    const bytesDiff = currentBytes - this.lastProgressUpdate.bytes;
    const speed = bytesDiff / timeDiff;

    // Son 5 hız ölçümünün ortalamasını al (daha düzgün görünüm için)
    this.speedHistory.push(speed);
    if (this.speedHistory.length > 5) {
      this.speedHistory.shift();
    }

    const avgSpeed =
      this.speedHistory.reduce((a, b) => a + b, 0) / this.speedHistory.length;

    // Güncel değerleri kaydet
    this.lastProgressUpdate = { time: now, bytes: currentBytes };

    return Math.max(0, avgSpeed);
  }

  resetSpeedCalculation() {
    this.lastProgressUpdate = { time: 0, bytes: 0 };
    this.speedHistory = [];
    document.getElementById("progress-speed").textContent = "0 KB/s";
  }
  resetProgressAnimation() {
    this.stopProgressAnimation();
    this.progressAnimation.displayedPercent = 0;
    this.progressAnimation.targetPercent = 0;
    this.progressAnimation.displayedBytes = 0;
    this.progressAnimation.targetBytes = 0;
    this.progressAnimation.totalBytes = 0;
    this.progressAnimation.displayedSpeed = 0;
    this.progressAnimation.targetSpeed = 0;
    this.progressAnimation.lastFrame = 0;
    this.progressAnimation.fileName = "";
    this.progressAnimation.etaText = "Tahminleniyor...";
    document.getElementById("progress-filename").textContent = "";
    document.getElementById("progress-percent").textContent = "0%";
    document.getElementById("progress-size").textContent = "0 KB / 0 KB";
    document.getElementById("progress-speed").textContent = "0 KB/s";
    document.getElementById("progress-eta").textContent = "Tahminleniyor...";
  }

  startProgressAnimation() {
    if (this.progressAnimation.frame) return;
    this.progressAnimation.frame = requestAnimationFrame(() =>
      this.animateProgressFrame()
    );
  }

  stopProgressAnimation() {
    if (this.progressAnimation.frame) {
      cancelAnimationFrame(this.progressAnimation.frame);
      this.progressAnimation.frame = null;
    }
  }

  animateProgressFrame() {
    const state = this.progressAnimation;
    const now = performance.now();
    if (!state.lastFrame) {
      state.lastFrame = now;
    }
    const delta = Math.min(1, (now - state.lastFrame) / 1000);
    state.lastFrame = now;
    const easing = 0.18 + delta * 0.2;

    state.displayedPercent = this.lerp(
      state.displayedPercent,
      state.targetPercent,
      easing
    );
    state.displayedBytes = this.lerp(
      state.displayedBytes,
      state.targetBytes,
      easing
    );
    state.displayedSpeed = this.lerp(
      state.displayedSpeed,
      state.targetSpeed,
      easing
    );

    this.updateProgressDom(state);

    const percentClose =
      Math.abs(state.displayedPercent - state.targetPercent) < 0.2;
    const bytesClose =
      Math.abs(state.displayedBytes - state.targetBytes) < 1024;
    const speedClose =
      Math.abs(state.displayedSpeed - state.targetSpeed) < 512;

    if (percentClose && bytesClose && speedClose) {
      this.stopProgressAnimation();
    } else {
      state.frame = requestAnimationFrame(() => this.animateProgressFrame());
    }
  }

  updateProgressDom(state) {
    document.getElementById("progress-filename").textContent =
      state.fileName || "";

    document.getElementById("progress-percent").textContent = `${Math.min(
      100,
      Math.max(0, state.displayedPercent)
    ).toFixed(1)}%`;
    document.getElementById("progress-fill").style.width = `${Math.min(
      100,
      Math.max(0, state.displayedPercent)
    )}%`;

    document.getElementById("progress-size").textContent = `${this.formatSize(
      state.displayedBytes
    )} / ${this.formatSize(state.totalBytes)}`;

    const speedText = `${this.formatSize(Math.max(0, state.displayedSpeed))}/s`;
    document.getElementById("progress-speed").textContent = speedText;

    const remaining = Math.max(0, state.totalBytes - state.displayedBytes);
    const etaSeconds =
      state.displayedSpeed > 1 ? remaining / state.displayedSpeed : null;
    const etaText = etaSeconds
      ? this.formatEta(etaSeconds)
      : "Tahminleniyor...";
    document.getElementById("progress-eta").textContent = etaText;
  }

  // ==========================================
  // DEBUG TIMESTAMP SİSTEMİ
  // ==========================================

  debugLog(transferId, stage, data = {}) {
    if (!this.enableDebug) return;

    const timestamp = Date.now();

    if (!this.debugTimestamps.has(transferId)) {
      this.debugTimestamps.set(transferId, {
        id: transferId,
        stages: [],
        startTime: timestamp,
      });
    }

    const debug = this.debugTimestamps.get(transferId);
    const elapsedFromStart = timestamp - debug.startTime;
    const elapsedFromPrevious =
      debug.stages.length > 0
        ? timestamp - debug.stages[debug.stages.length - 1].timestamp
        : 0;

    const stageData = {
      stage,
      timestamp,
      elapsedFromStart,
      elapsedFromPrevious,
      ...data,
    };

    debug.stages.push(stageData);

    // Konsola renkli log
    const color = this.getDebugColor(stage);
    console.log(
      `%c[${transferId.substring(0, 8)}] ${stage}`,
      `color: ${color}; font-weight: bold;`,
      `\n  ⏱️  Başlangıçtan: ${elapsedFromStart}ms`,
      `\n  ⏱️  Önceki aşamadan: ${elapsedFromPrevious}ms`,
      data.size ? `\n  📦 Boyut: ${this.formatSize(data.size)}` : "",
      data.fileName ? `\n  📄 Dosya: ${data.fileName}` : ""
    );

    // "Hazırlanıyor" süresi çok uzunsa uyar
    if (stage === "FIRST_PROGRESS" || stage === "TRANSFER_START") {
      const prepTime = elapsedFromStart;
      if (prepTime > 3000) {
        console.warn(
          `%c⚠️ YAVAŞ BAŞLANGIÇ TESPIT EDİLDİ!`,
          "color: red; font-weight: bold; font-size: 14px;",
          `\n  "Hazırlanıyor" süresi: ${prepTime}ms`,
          `\n  Transfer ID: ${transferId}`,
          "\n  İnceleme önerisi: IPC gecikme veya dosya okuma sorunu olabilir"
        );
      }
    }

    // Transfer tamamlandığında özet yazdır
    if (stage === "COMPLETED" || stage === "FAILED") {
      this.printDebugSummary(transferId);
    }
  }

  getDebugColor(stage) {
    const colors = {
      TRANSFER_CREATED: "#2563eb",
      FILE_INFO_START: "#8b5cf6",
      FILE_INFO_END: "#8b5cf6",
      IPC_CALL_START: "#f59e0b",
      IPC_CALL_END: "#10b981",
      FIRST_PROGRESS: "#22c55e",
      TRANSFER_START: "#22c55e",
      PROGRESS_UPDATE: "#3b82f6",
      COMPLETED: "#16a34a",
      FAILED: "#dc2626",
    };
    return colors[stage] || "#6b7280";
  }

  printDebugSummary(transferId) {
    const debug = this.debugTimestamps.get(transferId);
    if (!debug) return;

    console.group(
      `%c📊 TRANSFER DEBUG ÖZET [${transferId.substring(0, 8)}]`,
      "color: #8b5cf6; font-weight: bold; font-size: 14px;"
    );

    // Toplam süre
    const totalTime =
      debug.stages[debug.stages.length - 1].timestamp - debug.startTime;
    console.log(
      `%c⏱️ Toplam Süre: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`,
      "font-weight: bold;"
    );

    // Kritik aşama süreleri
    const fileInfoStart = debug.stages.find(
      (s) => s.stage === "FILE_INFO_START"
    );
    const fileInfoEnd = debug.stages.find((s) => s.stage === "FILE_INFO_END");
    const ipcStart = debug.stages.find((s) => s.stage === "IPC_CALL_START");
    const ipcEnd = debug.stages.find((s) => s.stage === "IPC_CALL_END");
    const firstProgress = debug.stages.find(
      (s) => s.stage === "FIRST_PROGRESS"
    );

    if (fileInfoStart && fileInfoEnd) {
      const fileInfoTime = fileInfoEnd.timestamp - fileInfoStart.timestamp;
      console.log(`  📄 Dosya bilgisi okuma: ${fileInfoTime}ms`);
    }

    if (ipcStart && firstProgress) {
      const prepTime = firstProgress.timestamp - ipcStart.timestamp;
      console.log(
        `  📦 Hazırlanıyor süresi: ${prepTime}ms ${
          prepTime > 3000 ? "⚠️ YAVAŞ!" : "✅"
        }`
      );
    }

    if (ipcStart && ipcEnd) {
      const ipcTime = ipcEnd.timestamp - ipcStart.timestamp;
      console.log(`  🔌 IPC çağrı süresi: ${ipcTime}ms`);
    }

    // Tüm aşamalar
    console.group("📋 Tüm Aşamalar:");
    debug.stages.forEach((stage, index) => {
      console.log(
        `  ${index + 1}. ${stage.stage} (+${stage.elapsedFromPrevious}ms)`
      );
    });
    console.groupEnd();

    console.groupEnd();

    // Debug verisini sil (memory cleanup)
    setTimeout(() => {
      this.debugTimestamps.delete(transferId);
    }, 5000);
  }

  // Debug modunu aç/kapa
  toggleDebug() {
    this.enableDebug = !this.enableDebug;
    console.log(
      `%cDebug modu: ${this.enableDebug ? "AÇIK ✅" : "KAPALI ❌"}`,
      "font-size: 14px; font-weight: bold;"
    );
  }

  showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;

    const icons = {
      success:
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
      error:
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    };

    toast.innerHTML = `
      <div class="toast-icon">${icons[type]}</div>
      <span class="toast-message">${message}</span>
      <button class="toast-close">&times;</button>
    `;

    container.appendChild(toast);

    // Kapatma butonu
    toast.querySelector(".toast-close").addEventListener("click", () => {
      toast.remove();
    });

    // Otomatik kaldır
    setTimeout(() => {
      toast.style.animation = "fadeIn 0.3s ease reverse";
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  isImageFile(filename) {
    const imageExtensions = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"];
    const ext = filename.split(".").pop().toLowerCase();
    return imageExtensions.includes(ext);
  }

  isVideoFile(filename) {
    const videoExtensions = [
      "mp4",
      "webm",
      "ogg",
      "ogv",
      "avi",
      "mov",
      "wmv",
      "flv",
      "mkv",
      "m4v",
    ];
    const ext = filename.split(".").pop().toLowerCase();
    return videoExtensions.includes(ext);
  }

  async showImagePreview(fileItem) {
    const fileName = fileItem.dataset.name;
    const modal = document.getElementById("modal-image-preview");
    const img = document.getElementById("preview-image");
    const loader = modal.querySelector(".image-loader");

    // Modal'ı aç
    modal.classList.remove("hidden");
    document.getElementById("preview-image-name").textContent = fileName;

    // Loader'ı göster, resmi gizle
    loader.style.display = "flex";
    img.style.display = "none";
    img.src = "";

    try {
      const params = {
        type: this.connectionType,
      };

      if (this.connectionType === "ftp") {
        params.remotePath =
          this.currentPath === "/"
            ? `/${fileName}`
            : `${this.currentPath}/${fileName}`;
      } else {
        params.bucket = this.currentBucket;
        params.key = fileItem.dataset.key;
      }

      console.log("Preview params:", params);
      const result = await window.electronAPI.getImagePreview(params);
      console.log(
        "Preview result:",
        result.success ? "Success" : result.message
      );

      if (result.success) {
        // Base64 veriyi temizle (boşluk/yeni satır karakterlerini kaldır)
        const cleanData = result.data.replace(/\s/g, "");
        const dataUrl = `data:${result.mimeType};base64,${cleanData}`;

        img.onload = () => {
          console.log("Image loaded successfully");
          loader.style.display = "none";
          img.style.display = "block";
        };

        img.onerror = (e) => {
          console.error("Image load error:", e);
          loader.style.display = "none";
          this.showToast(
            "Resim formatı desteklenmiyor veya dosya bozuk",
            "error"
          );
          setTimeout(() => this.closeModals(), 2000);
        };

        img.src = dataUrl;
      } else {
        loader.style.display = "none";
        this.showToast(result.message || "Resim yüklenemedi", "error");
        setTimeout(() => this.closeModals(), 2000);
      }
    } catch (error) {
      console.error("Preview error:", error);
      loader.style.display = "none";
      this.showToast(`Önizleme hatası: ${error.message}`, "error");
      setTimeout(() => this.closeModals(), 2000);
    }
  }

  async showVideoPreview(fileItem) {
    const fileName = fileItem.dataset.name;
    const modal = document.getElementById("modal-video-preview");
    const video = document.getElementById("preview-video");
    const loader = modal.querySelector(".video-loader");

    // DEBUG: Başlangıç zamanı
    const debugStart = Date.now();
    const debugLog = (stage) => {
      console.log(
        `%c[VIDEO-DEBUG] ${stage} +${Date.now() - debugStart}ms`,
        "color: #f59e0b; font-weight: bold;"
      );
    };

    debugLog("BAŞLADI");

    // Modal'ı aç
    modal.classList.remove("hidden");
    document.getElementById("preview-video-name").textContent = fileName;

    // Loader'ı göster, videoyu gizle
    loader.style.display = "flex";
    video.style.display = "none";
    video.src = "";

    debugLog("MODAL_AÇILDI");

    try {
      const params = {
        type: this.connectionType,
      };

      if (this.connectionType === "ftp") {
        params.remotePath =
          this.currentPath === "/"
            ? `/${fileName}`
            : `${this.currentPath}/${fileName}`;
      } else {
        params.bucket = this.currentBucket;
        params.key = fileItem.dataset.key;
      }

      debugLog("IPC_ÇAĞRI_BAŞLIYOR");
      const result = await window.electronAPI.getVideoPreview(params);
      debugLog("IPC_ÇAĞRI_BİTTİ - " + (result.success ? "Başarılı" : "Hata"));

      if (result.success) {
        debugLog("URL: " + result.streamUrl.substring(0, 50) + "...");
      }

      if (result.success) {
        // Video ID'yi kaydet (cleanup için)
        const videoId = result.streamUrl.split("/").pop().split("?")[0];
        video.dataset.videoId = result.isDirect ? null : videoId;

        let hasLoaded = false;

        // Timeout ile zorla göster (3 saniye sonra)
        let forceShowTimeout;

        // Video yüklendiğinde
        const onLoaded = (event) => {
          if (!hasLoaded) {
            hasLoaded = true;
            clearTimeout(forceShowTimeout);
            debugLog(`VIDEO_LOADED (${event?.type || "unknown"})`);
            loader.style.display = "none";
            video.style.display = "block";

            // Event listener'ları temizle
            video.removeEventListener("loadedmetadata", onLoaded);
            video.removeEventListener("loadeddata", onLoaded);
            video.removeEventListener("canplay", onLoaded);
            video.removeEventListener("progress", onProgress);
            video.removeEventListener("error", onError);
          }
        };

        // Progress eventi - buffer durumunu izle
        const onProgress = () => {
          if (video.buffered.length > 0) {
            const buffered = video.buffered.end(0);
            debugLog(`BUFFER: ${buffered.toFixed(2)}s`);
          }
        };

        forceShowTimeout = setTimeout(() => {
          if (!hasLoaded) {
            hasLoaded = true;
            debugLog("TIMEOUT_ZORLA_GÖSTERİLDİ");
            loader.style.display = "none";
            video.style.display = "block";
            video.removeEventListener("loadedmetadata", onLoaded);
            video.removeEventListener("loadeddata", onLoaded);
            video.removeEventListener("canplay", onLoaded);
            video.removeEventListener("progress", onProgress);
            video.removeEventListener("error", onError);
          }
        }, 1500); // 1.5 saniye max bekleme

        // Hata durumunda
        const onError = (e) => {
          if (!hasLoaded) {
            hasLoaded = true;
            clearTimeout(forceShowTimeout);
            console.error("Video load error:", e, video.error);
            loader.style.display = "none";

            // Detaylı hata mesajı
            let errorMsg = "Video yüklenemedi";
            if (video.error) {
              switch (video.error.code) {
                case 1:
                  errorMsg = "Video yükleme iptal edildi";
                  break;
                case 2:
                  errorMsg = "Ağ hatası, video indirilemedi";
                  break;
                case 3:
                  errorMsg = "Video decode edilemedi";
                  break;
                case 4:
                  errorMsg = "Video formatı desteklenmiyor";
                  break;
              }
            }

            this.showToast(errorMsg, "error");
            setTimeout(() => this.closeModals(), 2000);

            // Event listener'ları temizle
            video.removeEventListener("loadedmetadata", onLoaded);
            video.removeEventListener("loadeddata", onLoaded);
            video.removeEventListener("canplay", onLoaded);
            video.removeEventListener("progress", onProgress);
            video.removeEventListener("error", onError);
          }
        };

        // Tüm event'leri dinle - hangisi önce gelirse
        video.addEventListener("loadedmetadata", onLoaded);
        video.addEventListener("loadeddata", onLoaded);
        video.addEventListener("canplay", onLoaded);
        video.addEventListener("progress", onProgress);
        video.addEventListener("error", onError);

        debugLog("EVENT_LİSTENERLAR_EKLENDİ");

        // CORS ayarı - MinIO/S3 için gerekli
        video.crossOrigin = "anonymous";

        // Videoyu başlat
        video.src = result.streamUrl;
        debugLog("VIDEO_SRC_AYARLANDI");

        video.load();
        debugLog("VIDEO_LOAD_ÇAĞRILDI");

        // Muted autoplay ile hızlı başlat (tarayıcı politikası için)
        video.muted = true;
        video
          .play()
          .then(() => {
            debugLog("AUTOPLAY_BAŞARILI");
            video.pause();
            video.muted = false;
            video.currentTime = 0;
          })
          .catch((err) => {
            debugLog("AUTOPLAY_BAŞARISIZ: " + err.message);
            video.muted = false;
          });

        // Bilgilendirme toast
        if (result.isDirect) {
          this.showToast("S3 direkt stream başladı ⚡", "info");
        } else {
          this.showToast("Progressive download başladı 📥", "info");
        }
      } else {
        loader.style.display = "none";
        this.showToast(result.message || "Video yüklenemedi", "error");
        setTimeout(() => this.closeModals(), 2000);
      }
    } catch (error) {
      console.error("Video preview error:", error);
      loader.style.display = "none";
      this.showToast(`Video önizleme hatası: ${error.message}`, "error");
      setTimeout(() => this.closeModals(), 2000);
    }
  }

  // PIN ve Kayıtlı Bağlantılar
  showQuickLogin() {
    const saved = localStorage.getItem("saved_connections");
    if (!saved) return;

    try {
      const connections = JSON.parse(saved);
      if (connections.length === 0) return;

      // Quick login modal'ı göster
      const modal = document.getElementById("modal-quick-login");
      const list = document.getElementById("saved-connections-list");

      list.innerHTML = connections
        .map(
          (conn) => `
        <div class="saved-connection-item" data-connection-id="${conn.id}">
          <div class="saved-connection-icon">
            ${conn.type === "ftp" ? "🖥️" : "☁️"}
          </div>
          <div class="saved-connection-info">
            <div class="saved-connection-name">${conn.name}</div>
            <div class="saved-connection-meta">
              <span class="saved-connection-type ${
                conn.type
              }">${conn.type.toUpperCase()}</span>
              <span>${new Date(conn.createdAt).toLocaleDateString(
                "tr-TR"
              )}</span>
            </div>
          </div>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
      `
        )
        .join("");

      // Click handler'ları ekle
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
    // Connection type'ı ayarla
    this.connectionType = connection.type;
    document.querySelectorAll(".conn-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.type === connection.type);
    });
    document
      .getElementById("ftp-form")
      .classList.toggle("hidden", connection.type !== "ftp");
    document
      .getElementById("s3-form")
      .classList.toggle("hidden", connection.type !== "s3");

    // Quick login modal'ı kapat
    document.getElementById("modal-quick-login").classList.add("hidden");

    // PIN modal'ını göster
    this.pendingConnection = {
      type: connection.type,
      connectionId: connection.id,
      autoConnect: true, // Otomatik bağlan flag'i
    };
    this.showPinModal(connection.name);
  }

  async connectFTP() {
    const btn = document.getElementById("ftp-connect-btn");

    // Eğer bağlıysa, disconnect yap
    if (this.isConnected && this.connectionType === "ftp") {
      await this.disconnect();
      return;
    }

    const host = document.getElementById("ftp-host").value;
    const rememberMe = document.getElementById("ftp-remember").checked;

    // Eğer "Beni Hatırla" işaretliyse ve kayıtlı bağlantı varsa
    if (rememberMe && host) {
      const savedConn = this.findSavedConnection("ftp", host);
      if (savedConn) {
        // PIN iste
        this.pendingConnection = { type: "ftp", connectionId: savedConn.id };
        this.showPinModal(savedConn.name);
        return;
      }
    }

    const config = {
      host,
      port: document.getElementById("ftp-port").value,
      user: document.getElementById("ftp-user").value,
      password: document.getElementById("ftp-password").value,
      secure: document.getElementById("ftp-secure").value === "true",
    };

    if (!config.host || !config.user || !config.password) {
      this.showToast("Lütfen tüm alanları doldurun", "error");
      return;
    }

    btn.classList.add("loading");

    try {
      const result = await window.electronAPI.ftpConnect(config);

      if (result.success) {
        this.isConnected = true;
        this.updateConnectionStatus(true);
        this.enableToolbar();
        this.disableConnectionForm("ftp");
        this.updateConnectButton("ftp", true);
        this.showToast(result.message, "success");
        this.loadFTPFiles();

        // "Beni Hatırla" işaretliyse ve ilk bağlantıysa
        if (rememberMe && !this.findSavedConnection("ftp", host)) {
          this.pendingConnection = {
            type: "ftp",
            config,
            name: `${config.user}@${config.host}`,
          };
          this.showSetPinModal();
        }
      } else {
        this.showToast(result.message, "error");
      }
    } catch (error) {
      this.showToast(`Bağlantı hatası: ${error.message}`, "error");
    } finally {
      btn.classList.remove("loading");
    }
  }

  async connectS3() {
    const btn = document.getElementById("s3-connect-btn");

    // Eğer bağlıysa, disconnect yap
    if (this.isConnected && this.connectionType === "s3") {
      await this.disconnect();
      return;
    }

    const accessKeyId = document.getElementById("s3-access-key").value;
    const endpoint = document.getElementById("s3-endpoint").value;
    const rememberMe = document.getElementById("s3-remember").checked;
    const identifier = endpoint || "aws-s3";

    // Eğer "Beni Hatırla" işaretliyse ve kayıtlı bağlantı varsa
    if (rememberMe && accessKeyId) {
      const savedConn = this.findSavedConnection("s3", identifier);
      if (savedConn) {
        // PIN iste
        this.pendingConnection = { type: "s3", connectionId: savedConn.id };
        this.showPinModal(savedConn.name);
        return;
      }
    }

    const config = {
      accessKeyId,
      secretAccessKey: document.getElementById("s3-secret-key").value,
      region: document.getElementById("s3-region").value,
      endpoint: endpoint || undefined,
    };

    if (!config.accessKeyId || !config.secretAccessKey) {
      this.showToast(
        "Lütfen Access Key ve Secret Key alanlarını doldurun",
        "error"
      );
      return;
    }

    btn.classList.add("loading");

    try {
      const result = await window.electronAPI.s3Connect(config);

      if (result.success) {
        this.isConnected = true;
        this.updateConnectionStatus(true);
        this.enableToolbar();
        this.disableConnectionForm("s3");
        this.updateConnectButton("s3", true);
        this.showToast(result.message, "success");
        await this.loadBuckets();
        document.getElementById("bucket-selector").classList.remove("hidden");

        // "Beni Hatırla" işaretliyse ve ilk bağlantıysa
        if (rememberMe && !this.findSavedConnection("s3", identifier)) {
          this.pendingConnection = {
            type: "s3",
            config,
            name: endpoint ? `S3: ${endpoint}` : `S3: ${config.region}`,
          };
          this.showSetPinModal();
        }
      } else {
        this.showToast(result.message, "error");
      }
    } catch (error) {
      this.showToast(`Bağlantı hatası: ${error.message}`, "error");
    } finally {
      btn.classList.remove("loading");
    }
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
    document.getElementById("saved-connection-name").textContent =
      connectionName;
    document.getElementById("enter-pin").value = "";
    document.getElementById("pin-error").classList.add("hidden");
    document.getElementById("enter-pin").focus();
  }

  async savePinAndConnect() {
    const pin = document.getElementById("new-pin").value;
    const confirmPin = document.getElementById("confirm-pin").value;

    if (!pin || pin.length < 4) {
      this.showToast("PIN en az 4 haneli olmalı", "error");
      return;
    }

    if (pin !== confirmPin) {
      this.showToast("PIN'ler eşleşmiyor", "error");
      return;
    }

    if (!this.pendingConnection) {
      this.showToast("Bağlantı bilgisi bulunamadı", "error");
      return;
    }

    // Şifrele ve kaydet
    const encrypted = CryptoHelper.encrypt(this.pendingConnection.config, pin);
    if (!encrypted) {
      this.showToast("Şifreleme hatası", "error");
      return;
    }

    const saved = localStorage.getItem("saved_connections");
    const connections = saved ? JSON.parse(saved) : [];

    const identifier =
      this.pendingConnection.type === "ftp"
        ? this.pendingConnection.config.host
        : this.pendingConnection.config.endpoint || "aws-s3";

    connections.push({
      id: Date.now().toString(),
      type: this.pendingConnection.type,
      name: this.pendingConnection.name,
      identifier,
      encrypted,
      createdAt: new Date().toISOString(),
    });

    localStorage.setItem("saved_connections", JSON.stringify(connections));
    this.showToast("✅ Bağlantı PIN ile kaydedildi!", "success");
    this.closeModals();
    this.pendingConnection = null;
  }

  async unlockConnection() {
    const pin = document.getElementById("enter-pin").value;

    if (!pin) {
      this.showToast("PIN giriniz", "error");
      return;
    }

    if (!this.pendingConnection) {
      this.showToast("Bağlantı bilgisi bulunamadı", "error");
      return;
    }

    const saved = localStorage.getItem("saved_connections");
    if (!saved) {
      this.showToast("Kayıtlı bağlantı bulunamadı", "error");
      return;
    }

    const connections = JSON.parse(saved);
    const connection = connections.find(
      (c) => c.id === this.pendingConnection.connectionId
    );

    if (!connection) {
      this.showToast("Bağlantı bulunamadı", "error");
      return;
    }

    // Şifreyi çöz
    const config = CryptoHelper.decrypt(connection.encrypted, pin);

    if (!config) {
      document.getElementById("pin-error").classList.remove("hidden");
      document.getElementById("enter-pin").value = "";
      document.getElementById("enter-pin").focus();
      setTimeout(() => {
        document.getElementById("pin-error").classList.add("hidden");
      }, 2000);
      return;
    }

    // Modal'ı kapat
    this.closeModals();

    const isAutoConnect = this.pendingConnection.autoConnect;

    // Form alanlarını doldur
    if (connection.type === "ftp") {
      document.getElementById("ftp-host").value = config.host;
      document.getElementById("ftp-port").value = config.port;
      document.getElementById("ftp-user").value = config.user;
      document.getElementById("ftp-password").value = config.password;
      document.getElementById("ftp-secure").value = config.secure.toString();
      document.getElementById("ftp-remember").checked = false;

      // Eğer autoConnect true ise otomatik bağlan
      if (isAutoConnect) {
        const btn = document.getElementById("ftp-connect-btn");
        btn.classList.add("loading");

        try {
          const result = await window.electronAPI.ftpConnect(config);

          if (result.success) {
            this.isConnected = true;
            this.updateConnectionStatus(true);
            this.enableToolbar();
            this.disableConnectionForm("ftp");
            this.updateConnectButton("ftp", true);
            this.showToast("🚀 Hızlı giriş başarılı!", "success");
            this.loadFTPFiles();
          } else {
            this.showToast(result.message, "error");
          }
        } catch (error) {
          this.showToast(`Bağlantı hatası: ${error.message}`, "error");
        } finally {
          btn.classList.remove("loading");
        }
      } else {
        this.showToast("Form bilgileri dolduruldu", "success");
      }
    } else {
      document.getElementById("s3-access-key").value = config.accessKeyId;
      document.getElementById("s3-secret-key").value = config.secretAccessKey;
      document.getElementById("s3-region").value = config.region;
      document.getElementById("s3-endpoint").value = config.endpoint || "";
      document.getElementById("s3-remember").checked = false;

      // Eğer autoConnect true ise otomatik bağlan
      if (isAutoConnect) {
        const btn = document.getElementById("s3-connect-btn");
        btn.classList.add("loading");

        try {
          const result = await window.electronAPI.s3Connect(config);

          if (result.success) {
            this.isConnected = true;
            this.updateConnectionStatus(true);
            this.enableToolbar();
            this.disableConnectionForm("s3");
            this.updateConnectButton("s3", true);
            this.showToast("🚀 Hızlı giriş başarılı!", "success");
            await this.loadBuckets();
            document
              .getElementById("bucket-selector")
              .classList.remove("hidden");
          } else {
            this.showToast(result.message, "error");
          }
        } catch (error) {
          this.showToast(`Bağlantı hatası: ${error.message}`, "error");
        } finally {
          btn.classList.remove("loading");
        }
      } else {
        this.showToast("Form bilgileri dolduruldu", "success");
      }
    }

    this.pendingConnection = null;
  }

  // Yardımcı fonksiyonlar
  formatSize(bytes) {
    if (!bytes || bytes === 0) return "0 B";
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  }

  formatDate(date) {
    if (!date) return "-";
    const d = new Date(date);
    return d.toLocaleDateString("tr-TR", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  formatEta(seconds) {
    if (!seconds || !isFinite(seconds) || seconds <= 0) {
      return "Tahminleniyor...";
    }
    const totalSeconds = Math.round(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    if (hours > 0) {
      return `${hours} sa ${minutes} dk kaldı`;
    }

    if (minutes > 0) {
      return `${minutes} dk ${secs.toString().padStart(2, "0")} sn kaldı`;
    }

    return `${secs} sn kaldı`;
  }

  lerp(start, end, factor) {
    const clamped = Math.min(Math.max(factor, 0), 1);
    return start + (end - start) * clamped;
  }

  initTheme() {
    let storedTheme = null;
    try {
      storedTheme = localStorage.getItem(this.themeStorageKey);
    } catch (error) {
      storedTheme = null;
    }

    if (storedTheme === "dark" || storedTheme === "light") {
      this.theme = storedTheme;
    } else if (window.matchMedia) {
      this.theme = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }

    this.applyTheme(this.theme);

    const toggleInput = document.getElementById("theme-toggle-input");
    if (toggleInput) {
      toggleInput.checked = this.theme === "dark";
      toggleInput.addEventListener("change", () =>
        this.setTheme(toggleInput.checked ? "dark" : "light")
      );
    }
  }

  setTheme(theme) {
    if (theme !== "dark" && theme !== "light") return;
    this.theme = theme;
    this.applyTheme(theme);
    try {
      localStorage.setItem(this.themeStorageKey, theme);
    } catch (error) {
      // storage not available
    }
  }

  applyTheme(theme) {
    document.body.dataset.theme = theme;
    const toggleInput = document.getElementById("theme-toggle-input");
    if (toggleInput) {
      toggleInput.checked = theme === "dark";
    }
  }

  // Transfer Yöneticisi
  toggleTransferPanel() {
    const panel = document.getElementById("transfer-panel");
    panel.classList.toggle("hidden");
  }

  switchTransferTab(tab) {
    document.querySelectorAll(".transfer-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.tab === tab);
    });

    document.querySelectorAll(".transfer-tab-content").forEach((content) => {
      content.classList.toggle("hidden", content.id !== `${tab}-transfers`);
    });
  }

  addTransfer(fileName, type, size = 0) {
    const id = ++this.transferIdCounter;
    const transfer = {
      id,
      fileName,
      type, // 'upload' or 'download'
      size,
      progress: 0,
      status: "active", // 'active', 'completed', 'failed'
      startTime: new Date(),
      lastUpdate: { time: Date.now(), bytes: 0 },
      speedHistory: [],
      speed: 0,
      debugId: null, // Debug ID için
    };

    this.transfers.active.push(transfer);
    this.renderTransfers();
    this.updateTransferBadge();
    return transfer; // Transfer objesini döndür (id yerine)
  }

  updateTransferProgress(fileName, progress) {
    const transfer = this.transfers.active.find((t) => t.fileName === fileName);
    if (transfer) {
      transfer.progress = progress.percentage || 0;
      const currentBytes = progress.uploaded || progress.downloaded || 0;
      transfer.uploaded = currentBytes;
      transfer.total = progress.total || 0;

      // DEBUG: İlk progress geldiğinde log
      if (!transfer.started && progress.percentage > 0) {
        transfer.started = true;
        if (transfer.debugId) {
          this.debugLog(transfer.debugId, "FIRST_PROGRESS", {
            percentage: progress.percentage,
            bytes: currentBytes,
          });
        }
        console.log(`Transfer started: ${fileName}`);
      }

      // DEBUG: Progress güncellemesi (throttled)
      if (transfer.debugId && currentBytes > 0 && Math.random() < 0.1) {
        this.debugLog(transfer.debugId, "PROGRESS_UPDATE", {
          percentage: progress.percentage,
          bytes: currentBytes,
          total: progress.total,
        });
      }

      // Hız hesaplama
      const now = Date.now();
      if (transfer.lastUpdate && now - transfer.lastUpdate.time >= 100) {
        const timeDiff = (now - transfer.lastUpdate.time) / 1000;
        const bytesDiff = currentBytes - transfer.lastUpdate.bytes;
        const speed = bytesDiff / timeDiff;

        transfer.speedHistory = transfer.speedHistory || [];
        transfer.speedHistory.push(speed);
        if (transfer.speedHistory.length > 5) {
          transfer.speedHistory.shift();
        }

        transfer.speed =
          transfer.speedHistory.reduce((a, b) => a + b, 0) /
          transfer.speedHistory.length;
        transfer.lastUpdate = { time: now, bytes: currentBytes };
      } else if (!transfer.lastUpdate) {
        transfer.lastUpdate = { time: now, bytes: currentBytes };
      }

      this.renderTransfers();
    }
  }

  completeTransfer(fileName, success = true) {
    const index = this.transfers.active.findIndex(
      (t) => t.fileName === fileName
    );
    if (index !== -1) {
      const transfer = this.transfers.active.splice(index, 1)[0];
      transfer.status = success ? "completed" : "failed";
      transfer.endTime = new Date();
      this.transfers.completed.push(transfer);
      this.renderTransfers();
      this.updateTransferBadge();
    }
  }

  renderTransfers() {
    // Aktif aktarımlar
    const activeContainer = document.getElementById("active-transfers");
    if (this.transfers.active.length === 0) {
      activeContainer.innerHTML = `
        <div class="empty-transfers">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <polyline points="19 12 12 19 5 12"/>
          </svg>
          <p>Aktif aktarım yok</p>
        </div>
      `;
    } else {
      activeContainer.innerHTML = this.transfers.active
        .map((t) => this.renderTransferItem(t))
        .join("");
    }

    // Tamamlanan aktarımlar
    const completedContainer = document.getElementById("completed-transfers");
    if (this.transfers.completed.length === 0) {
      completedContainer.innerHTML = `
        <div class="empty-transfers">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <p>Tamamlanan aktarım yok</p>
        </div>
      `;
    } else {
      completedContainer.innerHTML = this.transfers.completed
        .map((t) => this.renderTransferItem(t))
        .join("");
    }

    // Sayaçları güncelle
    document.getElementById("active-count").textContent =
      this.transfers.active.length;
    document.getElementById("completed-count").textContent =
      this.transfers.completed.length;
  }

  renderTransferItem(transfer) {
    const typeIcon = transfer.type === "upload" ? "⬆️" : "⬇️";
    const statusClass =
      transfer.status === "completed"
        ? "completed"
        : transfer.status === "failed"
        ? "failed"
        : "";
    const isActive = transfer.status === "active";
    const isStarted = transfer.started || transfer.progress > 0;

    return `
      <div class="transfer-item ${statusClass}" data-id="${transfer.id}">
        <div class="transfer-item-header">
          <div class="transfer-item-info">
            <div class="transfer-item-name">${transfer.fileName}</div>
            <div class="transfer-item-meta">
              <span class="transfer-type ${transfer.type}">${typeIcon} ${
      transfer.type === "upload" ? "Yükleme" : "İndirme"
    }</span>
              ${
                isActive && !isStarted
                  ? "<span>🔄 S3'e bağlanıyor...</span>"
                  : ""
              }
              ${
                transfer.status === "completed"
                  ? "<span>✅ Tamamlandı</span>"
                  : ""
              }
              ${transfer.status === "failed" ? "<span>❌ Başarısız</span>" : ""}
            </div>
          </div>
        </div>
        ${
          isActive
            ? `
          <div class="transfer-progress-bar">
            <div class="transfer-progress-fill" style="width: ${
              transfer.progress || 0
            }%"></div>
          </div>
          <div class="transfer-progress-text">
            <span>${transfer.progress || 0}%</span>
            <span>${this.formatSize(
              transfer.uploaded || 0
            )} / ${this.formatSize(transfer.total || 0)}</span>
          </div>
          ${
            transfer.speed > 0
              ? `
          <div class="transfer-speed">
            <span>${this.formatSize(transfer.speed)}/s</span>
          </div>
          `
              : ""
          }
        `
            : ""
        }
      </div>
    `;
  }

  updateTransferBadge() {
    const badge = document.getElementById("transfer-count");
    const count = this.transfers.active.length;

    if (count > 0) {
      badge.textContent = count;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  clearCompleted() {
    this.transfers.completed = [];
    this.renderTransfers();
    this.showToast("Tamamlanan aktarımlar temizlendi", "info");
  }

  getFileType(filename) {
    const ext = filename.split(".").pop().toLowerCase();
    const types = {
      // Resimler
      jpg: "Resim",
      jpeg: "Resim",
      png: "Resim",
      gif: "Resim",
      webp: "Resim",
      svg: "Resim",
      // Dökümanlar
      pdf: "PDF",
      doc: "Word",
      docx: "Word",
      xls: "Excel",
      xlsx: "Excel",
      ppt: "PowerPoint",
      pptx: "PowerPoint",
      // Kod
      js: "JavaScript",
      ts: "TypeScript",
      py: "Python",
      html: "HTML",
      css: "CSS",
      json: "JSON",
      // Arşiv
      zip: "Arşiv",
      rar: "Arşiv",
      "7z": "Arşiv",
      tar: "Arşiv",
      gz: "Arşiv",
      // Medya
      mp3: "Ses",
      wav: "Ses",
      mp4: "Video",
      avi: "Video",
      mkv: "Video",
      webm: "Video",
      mov: "Video",
      wmv: "Video",
      flv: "Video",
      m4v: "Video",
      // Diğer
      txt: "Metin",
      md: "Markdown",
      exe: "Program",
    };
    return types[ext] || "Dosya";
  }
}

// Uygulamayı başlat
document.addEventListener("DOMContentLoaded", () => {
  new CloudFileManager();
});
