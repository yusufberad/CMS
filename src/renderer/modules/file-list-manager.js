// ============================================
// File List Manager - Handles file list rendering and operations
// ============================================

class FileListManager {
  constructor(app) {
    this.app = app;
  }

  renderFileList() {
    const container = document.getElementById("file-list");
    const filesToRender = this.getFilteredAndSortedFiles();

    if (filesToRender.length === 0) {
      const message = this.app.searchQuery
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
      return;
    }

    container.innerHTML = filesToRender
      .map((file, index) => this.renderFileItem(file, index))
      .join("");

    this.bindFileItemEvents(container);
  }

  renderFileItem(file, index) {
    const iconSvg = file.type === "directory"
      ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

    return `
      <div class="file-item" data-name="${file.name}" data-type="${file.type}" data-key="${file.key || ""}" style="animation-delay: ${index * 0.02}s">
        <div class="file-name">
          <div class="file-icon ${file.type}">${iconSvg}</div>
          <span>${file.name}</span>
        </div>
        <div class="file-size">${file.size && file.size > 0 ? this.formatSize(file.size) : "-"}</div>
        <div class="file-date">${file.modifiedAt ? this.formatDate(file.modifiedAt) : "-"}</div>
        <div class="file-type">${file.type === "directory" ? "Klasör" : this.getFileType(file.name)}</div>
        <div class="file-actions">
          <button class="file-action-trigger" title="İşlemler">⋮</button>
        </div>
      </div>
    `;
  }

  bindFileItemEvents(container) {
    container.querySelectorAll(".file-item").forEach((item) => {
      item.addEventListener("click", () => this.selectFile(item));
      item.addEventListener("dblclick", () => this.handleDoubleClick(item));
    });
  }

  selectFile(item) {
    document.querySelectorAll(".file-item").forEach((el) => el.classList.remove("selected"));
    item.classList.add("selected");
    this.app.selectedFile = {
      name: item.dataset.name,
      type: item.dataset.type,
      key: item.dataset.key,
    };
  }

  handleDoubleClick(item) {
    if (item.dataset.type === "directory") {
      this.navigateToFolder(item.dataset.name);
    }
  }

  navigateToFolder(folderName) {
    if (this.app.currentPath) {
      this.app.currentPath += `${folderName}/`;
    } else {
      this.app.currentPath = `${folderName}/`;
    }
    this.app.s3.loadFiles();
  }

  updateBreadcrumb() {
    const breadcrumb = document.getElementById("breadcrumb");
    const parts = this.app.currentPath.split("/").filter(Boolean);

    let html = '<span class="breadcrumb-item" data-path="">Ana Dizin</span>';
    
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join("/") + "/";
      html += ` / <span class="breadcrumb-item" data-path="${path}">${part}</span>`;
    });

    breadcrumb.innerHTML = html;

    breadcrumb.querySelectorAll(".breadcrumb-item").forEach((item) => {
      item.addEventListener("click", () => {
        this.app.currentPath = item.dataset.path;
        this.app.s3.loadFiles();
      });
    });
  }

  getFilteredAndSortedFiles() {
    let filtered = [...this.app.files];

    if (this.app.searchQuery) {
      const query = this.app.searchQuery.toLowerCase();
      filtered = filtered.filter((file) =>
        file.name.toLowerCase().includes(query)
      );
    }

    filtered.sort((a, b) => this.compareFiles(a, b));
    return filtered;
  }

  compareFiles(a, b) {
    if (a.type === "directory" && b.type !== "directory") return -1;
    if (a.type !== "directory" && b.type === "directory") return 1;

    const aVal = this.getSortValue(a, this.app.sortBy);
    const bVal = this.getSortValue(b, this.app.sortBy);

    if (aVal < bVal) return this.app.sortDirection === "asc" ? -1 : 1;
    if (aVal > bVal) return this.app.sortDirection === "asc" ? 1 : -1;
    return 0;
  }

  getSortValue(file, key) {
    switch (key) {
      case "name": return file.name.toLowerCase();
      case "size": return file.size || 0;
      case "date": return file.modifiedAt ? new Date(file.modifiedAt).getTime() : 0;
      case "type": return file.type;
      default: return file.name;
    }
  }

  updateFolderSizes() {
    // Placeholder for folder size calculation
    // Would call S3 getFolderSize for each directory
  }

  clearFileList() {
    const container = document.getElementById("file-list");
    container.innerHTML = `
      <div class="empty-state">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
          <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
        </svg>
        <p>Dosyaları görüntülemek için sunucuya bağlanın</p>
      </div>
    `;
  }

  formatSize(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  formatDate(date) {
    return new Date(date).toLocaleDateString("tr-TR");
  }

  getFileType(filename) {
    const ext = filename.split(".").pop().toLowerCase();
    const types = {
      jpg: "Resim", jpeg: "Resim", png: "Resim", gif: "Resim",
      mp4: "Video", avi: "Video", mkv: "Video",
      pdf: "PDF", doc: "Belge", docx: "Belge",
      zip: "Arşiv", rar: "Arşiv",
    };
    return types[ext] || "Dosya";
  }
}
