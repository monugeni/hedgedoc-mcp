(function () {
  var DOWNLOAD_BASE_URL = window.__MCP_DOWNLOAD_BASE_URL__;

  if (!DOWNLOAD_BASE_URL) {
    return;
  }

  var RESERVED_SEGMENTS = new Set([
    "",
    "new",
    "login",
    "logout",
    "history",
    "features",
    "me",
    "status",
  ]);

  function normalizeBaseUrl(url) {
    return String(url).replace(/\/+$/, "");
  }

  function getNoteIdFromPublishLink() {
    var publishLink = document.querySelector("a.ui-publish[href]:not([href='#'])");
    if (!publishLink) {
      return null;
    }

    try {
      var href = new URL(publishLink.getAttribute("href"), window.location.href);
      var segments = href.pathname.split("/").filter(Boolean);
      return segments.length > 0 ? decodeURIComponent(segments[segments.length - 1]) : null;
    } catch (_err) {
      return null;
    }
  }

  function getNoteIdFromPath() {
    var segments = window.location.pathname.split("/").filter(Boolean);
    if (segments.length === 0) {
      return null;
    }

    if (segments[0] === "s" && segments[1]) {
      return decodeURIComponent(segments[1]);
    }

    if (RESERVED_SEGMENTS.has(segments[0])) {
      return null;
    }

    return decodeURIComponent(segments[0]);
  }

  function getCurrentNoteId() {
    return getNoteIdFromPublishLink() || getNoteIdFromPath();
  }

  function buildDownloadUrl(noteId, format) {
    return normalizeBaseUrl(DOWNLOAD_BASE_URL) + "/notes/" + encodeURIComponent(noteId) + "/download/" + format;
  }

  function createMenuItem(format, label, iconClass, noteId) {
    var item = document.createElement("li");
    item.setAttribute("role", "presentation");
    item.className = "mcp-download-item mcp-download-" + format;

    var link = document.createElement("a");
    link.setAttribute("role", "menuitem");
    link.setAttribute("tabindex", "-1");
    link.setAttribute("target", "_self");
    link.href = buildDownloadUrl(noteId, format);

    var icon = document.createElement("i");
    icon.className = "fa " + iconClass + " fa-fw";
    link.appendChild(icon);
    link.appendChild(document.createTextNode(" " + label));

    item.appendChild(link);
    return item;
  }

  function injectDownloads() {
    var noteId = getCurrentNoteId();
    if (!noteId) {
      return false;
    }

    var anchors = document.querySelectorAll("a.ui-download-markdown");
    if (anchors.length === 0) {
      return false;
    }

    anchors.forEach(function (anchor) {
      var menu = anchor.closest("ul.dropdown-menu");
      var markdownItem = anchor.closest("li");
      if (!menu || !markdownItem) {
        return;
      }

      if (menu.querySelector(".mcp-download-item")) {
        menu.querySelectorAll(".mcp-download-item a").forEach(function (link) {
          link.href = buildDownloadUrl(noteId, link.parentElement.classList.contains("mcp-download-pdf") ? "pdf" : "docx");
        });
        return;
      }

      markdownItem.insertAdjacentElement("afterend", createMenuItem("docx", "DOCX", "fa-file-word-o", noteId));
      markdownItem.nextElementSibling.insertAdjacentElement("afterend", createMenuItem("pdf", "PDF", "fa-file-pdf-o", noteId));
    });

    return true;
  }

  function start() {
    if (injectDownloads()) {
      return;
    }

    var attempts = 0;
    var timer = window.setInterval(function () {
      attempts += 1;
      if (injectDownloads() || attempts >= 20) {
        window.clearInterval(timer);
      }
    }, 500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
