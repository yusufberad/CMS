// ============================================
// UI Manager - Handles all UI interactions
// ============================================

class UIManager {
  constructor(app) {
    this.app = app;
    this.theme = "light";
    this.themeStorageKey = "heysem_cloud_theme";
  }

  // Tema başlat
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
      toggleInput.addEventListener("change", (e) => {
        console.log("Theme toggle clicked:", e.target.checked);
        this.setTheme(e.target.checked ? "dark" : "light");
      });
      console.log("Theme toggle initialized, current theme:", this.theme);
    } else {
      console.warn("Theme toggle input not found!");
    }
  }

  setTheme(theme) {
    console.log("setTheme called with:", theme);
    this.theme = theme;
    this.applyTheme(theme);
    try {
      localStorage.setItem(this.themeStorageKey, theme);
      console.log("Theme saved to localStorage:", theme);
    } catch (error) {
      console.warn("Theme save failed:", error);
    }
  }

  applyTheme(theme) {
    console.log("applyTheme called with:", theme);
    console.log("Body classes before:", document.body.className);
    if (theme === "dark") {
      document.body.classList.add("dark-theme");
    } else {
      document.body.classList.remove("dark-theme");
    }
    console.log("Body classes after:", document.body.className);
  }

  // Toast mesajları
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

    toast.querySelector(".toast-close").addEventListener("click", () => {
      toast.remove();
    });

    setTimeout(() => {
      toast.style.animation = "fadeIn 0.3s ease reverse";
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // Modal yönetimi
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

  closeModals() {
    const videoElement = document.getElementById("preview-video");
    if (videoElement) {
      videoElement.removeEventListener("canplay", videoElement._canplayHandler);
      videoElement.removeEventListener("error", videoElement._errorHandler);

      if (!videoElement.paused) {
        videoElement.pause();
      }
      const videoId = videoElement.dataset.videoId;
      videoElement.src = "";
      videoElement.load();

      if (videoId) {
        window.electronAPI.cleanupVideo(videoId);
        delete videoElement.dataset.videoId;
      }
    }

    if (this.app.lastPreviewImageUrl) {
      try {
        URL.revokeObjectURL(this.app.lastPreviewImageUrl);
      } catch (e) {
        console.warn("Preview image URL revoke error:", e);
      }
      this.app.lastPreviewImageUrl = null;
    }

    document.querySelectorAll(".modal").forEach((modal) => {
      modal.classList.add("hidden");
    });
  }

  // Toolbar yönetimi
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

  // Bağlantı durumu
  updateConnectionStatus(connected, type) {
    const status = document.getElementById("connection-status");
    const indicator = status.querySelector(".status-indicator");
    const text = status.querySelector("span");

    indicator.classList.toggle("connected", connected);
    text.textContent = connected
      ? `${type.toUpperCase()} bağlandı`
      : "Bağlı değil";
  }

  // Progress bar animasyonları
  updateProgress(progress, type) {
    const container = document.getElementById("progress-container");
    const fill = document.getElementById("progress-fill");
    const filenameEl = document.getElementById("progress-filename");
    const percentEl = document.getElementById("progress-percent");
    const sizeEl = document.getElementById("progress-size");

    container.classList.remove("hidden");
    
    filenameEl.textContent = progress.fileName || "Dosya";
    percentEl.textContent = `${progress.percentage || 0}%`;
    fill.style.width = `${progress.percentage || 0}%`;
    
    if (progress.uploaded && progress.total) {
      sizeEl.textContent = `${this.formatSize(progress.uploaded)} / ${this.formatSize(progress.total)}`;
    }
  }

  hideProgress() {
    const container = document.getElementById("progress-container");
    container.classList.add("hidden");
  }

  formatSize(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }
}
