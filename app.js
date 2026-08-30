(function () {
  "use strict";

  const initialMarkdown = `# MarkdownLiveEditへようこそ

> 左側で書くと、右側のプレビューがすぐに更新されます。入力本文はブラウザ外へ保存・送信されず、外部画像も初期状態では読み込まれません。

## できること

- **太字**、*斜体*、~~取り消し線~~などの書式
- [リンク](https://commonmark.org/)や表、引用、コードブロック
- [x] リアルタイムプレビュー
- [ ] Markdownをコピーして任意の場所に保存

## 入力のヒント

| 操作 | キー |
| --- | --- |
| 字下げ | \`Tab\` |
| 太字 | \`Ctrl + B\` |
| 検索 | \`Ctrl + F\` |
| 置換 | \`Ctrl + H\` |
| 書式ヒント | \`Ctrl + Shift + H\` |
| エディタから移動 | \`Esc\` → \`Tab\` |

\`Alt + ↑ / ↓\` で行を移動し、\`Shift + Alt + ↓\` で行を複製できます。「書式ヒント」を表示すると、同じ操作をボタンでも行えます。

\`\`\`javascript
const message = "書いた瞬間、かたちになる。";
console.log(message);
\`\`\`
`;

  const editor = document.querySelector("#markdown-input");
  const preview = document.querySelector("#markdown-preview");
  const previewScroll = document.querySelector("#preview-scroll");
  const lineNumberContent = document.querySelector("#line-number-content");
  const cursorStatus = document.querySelector("#cursor-status");
  const documentStatus = document.querySelector("#document-status");
  const validationStatus = document.querySelector("#validation-status");
  const validationAnnouncement = document.querySelector("#validation-announcement");
  const problemSummary = document.querySelector("#problem-summary");
  const problemList = document.querySelector("#problem-list");
  const problemsPanel = document.querySelector("#problems-panel");
  const renderTime = document.querySelector("#render-time");
  const syncScrollButton = document.querySelector("#sync-scroll");
  const themeToggle = document.querySelector("#theme-toggle");
  const toast = document.querySelector("#toast");
  const searchPanel = document.querySelector("#search-panel");
  const searchInput = document.querySelector("#search-input");
  const searchCount = document.querySelector("#search-count");
  const replaceRow = document.querySelector("#replace-row");
  const replaceInput = document.querySelector("#replace-input");
  const shortcutDialog = document.querySelector("#shortcut-dialog");
  const onboardingDialog = document.querySelector("#onboarding-dialog");
  const onboardingTitle = document.querySelector("#onboarding-title");
  const onboardingProgress = document.querySelector("#onboarding-progress");
  const onboardingBack = document.querySelector("#onboarding-back");
  const onboardingNext = document.querySelector("#onboarding-next");
  const onboardingSteps = Array.from(document.querySelectorAll("[data-onboarding-step]"));
  const remoteImagesToggle = document.querySelector("#remote-images-toggle");
  const formatToolbar = document.querySelector("#format-toolbar");
  const formatToolbarToggle = document.querySelector("#format-toolbar-toggle");
  const editorSearchToggle = document.querySelector("#editor-search-toggle");
  const moveLineUpButton = document.querySelector("#move-line-up");
  const moveLineDownButton = document.querySelector("#move-line-down");
  const duplicateLineButton = document.querySelector("#duplicate-line");
  const formatButtons = Array.from(document.querySelectorAll("[data-format]"));

  let currentIssues = [];
  let sanitizedHtml = "";
  let renderTimer = 0;
  let toastTimer = 0;
  let allowRemoteImages = false;
  let hasUserEdits = false;
  let dependencyErrorShown = false;
  let syncScroll = true;
  let lastValidationMessage = "";
  let searchMatches = [];
  let activeSearchIndex = -1;
  let onboardingStepIndex = 0;
  let onboardingSeenInSession = false;
  let onboardingReturnFocus = editor;
  let formatToolbarVisible = false;
  let editorTabEscapeArmed = false;

  const onboardingStorageKey = "markdownliveedit.onboarding.seen.v1";
  const formatToolbarStorageKey = "markdownliveedit.formatToolbar.visible.v1";
  const themeStorageKey = "markdownliveedit.theme.v1";

  const allowedTags = [
    "a", "p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "ul", "ol", "li",
    "strong", "em", "del", "br", "hr", "pre", "code", "table", "thead", "tbody", "tr",
    "th", "td", "img", "details", "summary", "kbd", "sup", "sub", "input",
    "section", "dl", "dt", "dd"
  ];
  const allowedAttributes = [
    "href", "src", "alt", "title", "width", "height", "start", "colspan", "rowspan",
    "align", "class", "type", "checked", "disabled", "md-src", "id", "aria-label", "role"
  ];

  function classifyUrl(value, image) {
    const url = String(value || "").trim().replace(/[\u0000-\u001F\u007F]/g, "");
    if (!url) return { safe: false, remote: false };

    const scheme = url.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
    if (scheme) {
      const allowed = image ? ["http", "https"] : ["http", "https", "mailto", "tel"];
      return { safe: allowed.includes(scheme), remote: ["http", "https"].includes(scheme) };
    }

    if (url.startsWith("//")) return { safe: true, remote: true };
    return { safe: true, remote: false };
  }

  function neutralizeImageSources(html) {
    return html.replace(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, (tag) => tag.replace(
      /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i,
      (_match, doubleQuoted, singleQuoted, unquoted) => {
        const value = doubleQuoted ?? singleQuoted ?? unquoted ?? "";
        return `md-src="${value.replace(/"/g, "&quot;").replace(/</g, "&lt;")}"`;
      }
    ));
  }

  function sanitizeHtml(html) {
    if (!window.DOMPurify) return "";

    const neutralizedHtml = neutralizeImageSources(html);
    const fragment = window.DOMPurify.sanitize(neutralizedHtml, {
      RETURN_DOM_FRAGMENT: true,
      ALLOWED_TAGS: allowedTags,
      ALLOWED_ATTR: allowedAttributes,
      ALLOW_DATA_ATTR: false,
      SANITIZE_DOM: true,
      FORBID_TAGS: ["svg", "math", "style", "form", "iframe", "object", "embed"],
      FORBID_ATTR: ["style", "name"]
    });

    Array.from(fragment.querySelectorAll("a")).forEach((link) => {
      const href = link.getAttribute("href");
      const classification = classifyUrl(href, false);
      if (!classification.safe) {
        link.removeAttribute("href");
      } else if (classification.remote) {
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
      }
    });

    Array.from(fragment.querySelectorAll("img")).forEach((image) => {
      const src = image.getAttribute("md-src") || image.getAttribute("src");
      image.removeAttribute("md-src");
      image.removeAttribute("src");
      const classification = classifyUrl(src, true);
      if (!classification.safe) {
        image.removeAttribute("src");
        return;
      }

      if (classification.remote && !allowRemoteImages) {
        const alt = image.getAttribute("alt") || "代替テキストなし";
        const placeholder = document.createElement("span");
        const title = document.createElement("strong");
        const description = document.createElement("span");
        placeholder.className = "blocked-image";
        placeholder.setAttribute("role", "img");
        placeholder.setAttribute("aria-label", `外部画像を遮断しました。${alt}`);
        title.textContent = "外部画像を遮断しました";
        description.textContent = alt;
        placeholder.append(title, description);
        image.replaceWith(placeholder);
        return;
      }

      image.setAttribute("src", src);
      image.setAttribute("loading", "lazy");
      image.setAttribute("decoding", "async");
      image.setAttribute("referrerpolicy", "no-referrer");
    });

    Array.from(fragment.querySelectorAll('input[type="checkbox"]')).forEach((input) => {
      input.setAttribute("disabled", "");
    });

    Array.from(fragment.querySelectorAll("[id]")).forEach((element) => {
      if (!/^md-footnote-(?:ref-)?\d+(?:-\d+)?$/i.test(element.id)) element.removeAttribute("id");
    });

    Array.from(fragment.querySelectorAll("[class]")).forEach((element) => {
      const safeClasses = element.className
        .split(/\s+/)
        .filter((name) => /^(?:language-[a-z0-9_+-]+|task-list|task-list-item|blocked-image|md-definition-list|md-footnotes|md-footnote-ref|md-footnote-backref|md-alert|md-alert-(?:note|tip|important|warning|caution)|md-alert-title)$/i.test(name));
      if (safeClasses.length) element.className = safeClasses.join(" ");
      else element.removeAttribute("class");
    });

    const template = document.createElement("template");
    template.content.append(fragment);
    return template.innerHTML;
  }

  function issue(severity, line, column, message, length = 1) {
    return { severity, line, column, message, length };
  }

  function findClosingParenthesis(line, start) {
    let depth = 0;
    let escaped = false;
    for (let index = start; index < line.length; index += 1) {
      const character = line[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === "(") depth += 1;
      if (character === ")") {
        depth -= 1;
        if (depth === 0) return index;
      }
    }
    return -1;
  }

  function lintMarkdown(source) {
    const lines = source.split("\n");
    const issues = [];
    let fence = null;
    let htmlComment = null;
    let previousHeadingLevel = 0;
    let h1Count = 0;

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);

      if (fence) {
        const closing = new RegExp(`^ {0,3}${fence.character}{${fence.length},}\\s*$`);
        if (closing.test(line)) fence = null;
        return;
      }

      if (fenceMatch) {
        const token = fenceMatch[1];
        const info = fenceMatch[2];
        fence = { character: token[0], length: token.length, line: lineNumber };
        if (token[0] === "`" && info.includes("`")) {
          issues.push(issue("error", lineNumber, token.length + 1, "コードブロックの言語名にバッククォートは使用できません。"));
        }
        return;
      }

      const badHeading = line.match(/^ {0,3}(#{1,6})([^\s#].*)$/);
      if (badHeading) {
        issues.push(issue("error", lineNumber, badHeading[1].length + 1, "見出し記号 # の後に半角スペースが必要です。"));
      }

      const excessiveHeading = line.match(/^ {0,3}(#{7,})\s+/);
      if (excessiveHeading) {
        issues.push(issue("warning", lineNumber, 1, "見出しは # 6個までです。通常の文章として表示されます。", excessiveHeading[1].length));
      }

      const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        const level = heading[1].length;
        if (level === 1) {
          h1Count += 1;
          if (h1Count > 1) issues.push(issue("warning", lineNumber, 1, "文書内の見出し1は1つにすると構造が伝わりやすくなります。"));
        }
        if (previousHeadingLevel && level > previousHeadingLevel + 1) {
          issues.push(issue("warning", lineNumber, 1, `見出しレベルが ${previousHeadingLevel} から ${level} に飛んでいます。`));
        }
        previousHeadingLevel = level;
      }

      const malformedList = line.match(/^\s*(?:[-+]\S|\d+[.)]\S)/);
      if (malformedList) {
        const marker = line.match(/^\s*(?:[-+]|\d+[.)])/);
        const column = marker ? marker[0].length + 1 : 1;
        issues.push(issue("warning", lineNumber, column, "リスト記号の後に半角スペースを入れるとリストとして表示されます。"));
      }

      let linkStart = line.indexOf("](");
      while (linkStart !== -1) {
        if (findClosingParenthesis(line, linkStart + 1) === -1) {
          issues.push(issue("error", lineNumber, linkStart + 1, "リンクまたは画像の閉じ括弧 ) がありません。", 2));
          break;
        }
        linkStart = line.indexOf("](", linkStart + 2);
      }

      const emptyAlt = /!\[\]\(/g;
      let emptyAltMatch = emptyAlt.exec(line);
      while (emptyAltMatch) {
        issues.push(issue("warning", lineNumber, emptyAltMatch.index + 1, "画像に代替テキストを入力してください。", 3));
        emptyAltMatch = emptyAlt.exec(line);
      }

      const imageTags = line.matchAll(/<img\b[^>]*>/gi);
      for (const imageTag of imageTags) {
        if (!/\balt\s*=\s*(["']).*?\1/i.test(imageTag[0])) {
          issues.push(issue("warning", lineNumber, (imageTag.index || 0) + 1, "img要素にalt属性がありません。"));
        }
      }

      let cursor = 0;
      while (cursor < line.length) {
        const openIndex = line.indexOf("<!--", cursor);
        const closeIndex = line.indexOf("-->", cursor);
        if (htmlComment === null && closeIndex !== -1 && (openIndex === -1 || closeIndex < openIndex)) {
          issues.push(issue("error", lineNumber, closeIndex + 1, "開始されていないHTMLコメントの閉じ記号です。", 3));
          cursor = closeIndex + 3;
        } else if (htmlComment === null && openIndex !== -1) {
          const sameLineClose = line.indexOf("-->", openIndex + 4);
          if (sameLineClose === -1) {
            htmlComment = { line: lineNumber, column: openIndex + 1 };
            break;
          }
          cursor = sameLineClose + 3;
        } else if (htmlComment !== null) {
          const end = line.indexOf("-->", cursor);
          if (end !== -1) {
            htmlComment = null;
            cursor = end + 3;
          } else break;
        } else break;
      }
    });

    if (fence) {
      issues.push(issue("error", fence.line, 1, "コードブロックが閉じられていません。末尾に同じフェンスを追加してください。", fence.length));
    }
    if (htmlComment) {
      issues.push(issue("error", htmlComment.line, htmlComment.column, "HTMLコメントが閉じられていません。末尾に --> を追加してください。", 4));
    }

    return issues.sort((left, right) => left.line - right.line || left.column - right.column);
  }

  function renderMarkdown() {
    clearTimeout(renderTimer);
    renderTimer = 0;
    const source = editor.value;
    currentIssues = lintMarkdown(source);

    if (window.marked && typeof window.marked.parse === "function" && window.DOMPurify) {
      const renderer = window.MarkdownExtensions && typeof window.MarkdownExtensions.render === "function"
        ? window.MarkdownExtensions.render
        : (markdown, marked) => marked.parse(markdown, { gfm: true, breaks: true });
      const rawHtml = renderer(source, window.marked);
      sanitizedHtml = sanitizeHtml(rawHtml);
      preview.innerHTML = sanitizedHtml || '<p class="problem-empty">入力すると、ここにプレビューが表示されます。</p>';
      if (sanitizedHtml && window.MarkdownExtensions && typeof window.MarkdownExtensions.decorate === "function") {
        window.MarkdownExtensions.decorate(preview);
        sanitizedHtml = preview.innerHTML;
      }
    } else {
      sanitizedHtml = "";
      preview.textContent = source;
      if (!dependencyErrorShown) {
        showToast("安全なMarkdown解析機能を読み込めませんでした。");
        dependencyErrorShown = true;
      }
    }

    renderIssues();
    renderGutter();
    updateStatus();
    renderTime.textContent = new Intl.DateTimeFormat("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date());
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderMarkdown, 120);
  }

  function renderGutter() {
    const lineCount = editor.value.split("\n").length;
    const activeLine = getCursorPosition().line;
    const severityByLine = new Map();
    currentIssues.forEach((item) => {
      const current = severityByLine.get(item.line);
      if (!current || item.severity === "error") severityByLine.set(item.line, item.severity);
    });

    const fragment = document.createDocumentFragment();
    for (let line = 1; line <= lineCount; line += 1) {
      const marker = document.createElement("span");
      marker.textContent = line;
      if (line === activeLine) marker.classList.add("is-active");
      const severity = severityByLine.get(line);
      if (severity) marker.classList.add(`has-${severity}`);
      fragment.appendChild(marker);
    }
    lineNumberContent.replaceChildren(fragment);
    syncGutterScroll();
  }

  function renderIssues() {
    const errors = currentIssues.filter((item) => item.severity === "error").length;
    const warnings = currentIssues.filter((item) => item.severity === "warning").length;
    problemList.replaceChildren();
    validationStatus.classList.remove("has-error", "has-warning");

    if (!currentIssues.length) {
      const empty = document.createElement("p");
      empty.className = "problem-empty";
      empty.textContent = "Markdownの構造上の修正候補は見つかりませんでした。";
      problemList.appendChild(empty);
      problemSummary.textContent = "修正候補はありません";
      validationStatus.innerHTML = '<span aria-hidden="true">✓</span> 修正候補なし';
    } else {
      currentIssues.forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `problem-item ${item.severity}`;
        button.setAttribute("role", "listitem");
        button.innerHTML = `<span class="severity" aria-hidden="true">${item.severity === "error" ? "×" : "!"}</span><span>${escapeText(item.message)}</span><span class="problem-location">${item.line}行 ${item.column}列</span>`;
        button.setAttribute("aria-label", `${item.severity === "error" ? "エラー" : "注意"}、${item.message}、${item.line}行${item.column}列へ移動`);
        button.addEventListener("click", () => jumpToIssue(item));
        problemList.appendChild(button);
      });
      problemSummary.textContent = `エラー ${errors}件、注意 ${warnings}件`;
      validationStatus.innerHTML = `<span aria-hidden="true">${errors ? "×" : "!"}</span> ${errors ? `${errors} エラー` : `${warnings} 注意`}`;
      validationStatus.classList.add(errors ? "has-error" : "has-warning");
    }

    const message = currentIssues.length
      ? `Markdown簡易チェック結果。エラー${errors}件、注意${warnings}件。`
      : "Markdown簡易チェック結果。修正候補はありません。";
    if (message !== lastValidationMessage) {
      validationAnnouncement.textContent = message;
      lastValidationMessage = message;
    }
  }

  function escapeText(text) {
    return text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function getCursorPosition(position = editor.selectionStart) {
    const before = editor.value.slice(0, position);
    const lines = before.split("\n");
    return { line: lines.length, column: lines.at(-1).length + 1 };
  }

  function getLineOffset(line, column = 1) {
    const lines = editor.value.split("\n");
    let offset = 0;
    for (let index = 0; index < line - 1; index += 1) offset += lines[index].length + 1;
    return Math.min(offset + column - 1, editor.value.length);
  }

  function jumpToIssue(item) {
    const start = getLineOffset(item.line, item.column);
    editor.focus();
    editor.setSelectionRange(start, Math.min(start + item.length, editor.value.length));
    const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight) || 24;
    editor.scrollTop = Math.max(0, (item.line - 3) * lineHeight);
    updateStatus();
    renderGutter();
  }

  function updateCursorStatus() {
    const cursor = getCursorPosition();
    cursorStatus.textContent = `行 ${cursor.line}、列 ${cursor.column}`;
  }

  function updateActiveLine() {
    lineNumberContent.querySelector(".is-active")?.classList.remove("is-active");
    const activeLine = getCursorPosition().line;
    lineNumberContent.children[activeLine - 1]?.classList.add("is-active");
  }

  function updateStatus() {
    const lineCount = editor.value.split("\n").length;
    let wordCount = 0;
    if ("Segmenter" in Intl) {
      const segmenter = new Intl.Segmenter("ja", { granularity: "word" });
      wordCount = Array.from(segmenter.segment(editor.value)).filter((segment) => segment.isWordLike).length;
    } else {
      wordCount = editor.value.trim() ? editor.value.trim().split(/\s+/).length : 0;
    }
    updateCursorStatus();
    documentStatus.textContent = `${lineCount}行 · ${editor.value.length.toLocaleString("ja-JP")}文字 · ${wordCount.toLocaleString("ja-JP")}語`;
  }

  function syncGutterScroll() {
    lineNumberContent.style.transform = `translateY(${-editor.scrollTop}px)`;
  }

  function replaceRange(start, end, replacement, selectionStart, selectionEnd = selectionStart) {
    const scrollTop = editor.scrollTop;
    editor.value = editor.value.slice(0, start) + replacement + editor.value.slice(end);
    editor.setSelectionRange(selectionStart, selectionEnd);
    editor.scrollTop = scrollTop;
    hasUserEdits = editor.value !== initialMarkdown;
    scheduleRender();
  }

  function countMarkerRun(text, marker, fromStart) {
    let count = 0;
    if (fromStart) {
      while (text[count] === marker) count += 1;
      return count;
    }
    while (text[text.length - count - 1] === marker) count += 1;
    return count;
  }

  function selectedUsesWrapper(selected, before, after) {
    if (selected.length < before.length + after.length || !selected.startsWith(before) || !selected.endsWith(after)) return false;
    if (before === "*" && after === "*") {
      return countMarkerRun(selected, "*", true) % 2 === 1 && countMarkerRun(selected, "*", false) % 2 === 1;
    }
    if (before === "**" && after === "**") {
      return countMarkerRun(selected, "*", true) >= 2 && countMarkerRun(selected, "*", false) >= 2;
    }
    if (before === "`" && after === "`") {
      return countMarkerRun(selected, "`", true) === 1 && countMarkerRun(selected, "`", false) === 1;
    }
    return true;
  }

  function adjacentUsesWrapper(value, start, end, before, after) {
    if (start < before.length || value.slice(start - before.length, start) !== before || value.slice(end, end + after.length) !== after) return false;
    if ((before === "*" || before === "**") && before === after) {
      const left = countMarkerRun(value.slice(0, start), "*", false);
      const right = countMarkerRun(value.slice(end), "*", true);
      return before === "*" ? left % 2 === 1 && right % 2 === 1 : left >= 2 && right >= 2;
    }
    if (before === "`" && after === "`") {
      return countMarkerRun(value.slice(0, start), "`", false) === 1 && countMarkerRun(value.slice(end), "`", true) === 1;
    }
    return true;
  }

  function getWrapMatch(before, after) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = editor.value.slice(start, end);
    if (selectedUsesWrapper(selected, before, after)) {
      return {
        start,
        end,
        content: selected.slice(before.length, selected.length - after.length)
      };
    }
    if (adjacentUsesWrapper(editor.value, start, end, before, after)) {
      return {
        start: start - before.length,
        end: end + after.length,
        content: selected
      };
    }
    return null;
  }

  function wrapSelection(before, after, placeholder) {
    const match = getWrapMatch(before, after);
    if (match) {
      replaceRange(match.start, match.end, match.content, match.start, match.start + match.content.length);
      editor.focus();
      return;
    }

    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = editor.value.slice(start, end);
    const content = selected || placeholder;
    const replacement = `${before}${content}${after}`;
    if (selected) replaceRange(start, end, replacement, start, start + replacement.length);
    else replaceRange(start, end, replacement, start + before.length, start + before.length + content.length);
    editor.focus();
  }

  function getSelectedLineBlock() {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const lineStart = editor.value.lastIndexOf("\n", start - 1) + 1;
    let lineEnd = editor.value.indexOf("\n", end);
    if (lineEnd === -1) lineEnd = editor.value.length;
    return { lineStart, lineEnd, block: editor.value.slice(lineStart, lineEnd) };
  }

  function selectedLinesUsePrefix(pattern) {
    return getSelectedLineBlock().block.split("\n").every((line) => pattern.test(line));
  }

  function toggleSelectedLinePrefix(prefix, pattern) {
    const { lineStart, lineEnd, block } = getSelectedLineBlock();
    const lines = block.split("\n");
    const removePrefix = lines.every((line) => pattern.test(line));
    const replacement = lines.map((line) => {
      if (removePrefix) return line.replace(pattern, "");
      return pattern.test(line) ? line : `${prefix}${line}`;
    }).join("\n");
    replaceRange(lineStart, lineEnd, replacement, lineStart, lineStart + replacement.length);
    editor.focus();
  }

  function insertHeading() {
    const start = editor.selectionStart;
    const lineStart = editor.value.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = editor.value.indexOf("\n", start) === -1 ? editor.value.length : editor.value.indexOf("\n", start);
    const line = editor.value.slice(lineStart, lineEnd);
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    const isHeadingTwo = headingMatch?.[1].length === 2;
    const content = headingMatch?.[2] || line || "見出し";
    const replacement = isHeadingTwo ? content : `## ${content}`;
    const selectionOffset = isHeadingTwo ? 0 : 3;
    replaceRange(lineStart, lineEnd, replacement, lineStart + selectionOffset, lineStart + replacement.length);
    editor.focus();
  }

  function getLinkMatch() {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = editor.value.slice(start, end);
    const selectedLink = selected.match(/^\[([^\]]*)\]\(([^)\n]+)\)$/);
    if (selectedLink) return { start, end, content: selectedLink[1] };

    if (start > 0 && editor.value[start - 1] === "[") {
      const suffix = editor.value.slice(end).match(/^\]\(([^)\n]+)\)/);
      if (suffix) return { start: start - 1, end: end + suffix[0].length, content: selected };
    }
    return null;
  }

  function toggleLink() {
    const match = getLinkMatch();
    if (match) {
      replaceRange(match.start, match.end, match.content, match.start, match.start + match.content.length);
      editor.focus();
      return;
    }
    wrapSelection("[", "](https://example.com)", "リンクテキスト");
  }

  function currentLineIsHeadingTwo() {
    const { block } = getSelectedLineBlock();
    return block.split("\n").every((line) => /^##\s+/.test(line));
  }

  function isFormatActive(action) {
    const checks = {
      heading: currentLineIsHeadingTwo,
      bold: () => Boolean(getWrapMatch("**", "**")),
      italic: () => Boolean(getWrapMatch("*", "*")),
      strike: () => Boolean(getWrapMatch("~~", "~~")),
      link: () => Boolean(getLinkMatch()),
      quote: () => selectedLinesUsePrefix(/^> /),
      code: () => Boolean(getWrapMatch("`", "`")),
      codeblock: () => Boolean(getWrapMatch("```\n", "\n```")),
      list: () => selectedLinesUsePrefix(/^- /),
      check: () => selectedLinesUsePrefix(/^- \[[ xX]\] /)
    };
    return checks[action] ? checks[action]() : false;
  }

  function updateFormatButtonStates() {
    formatButtons.forEach((button) => {
      const active = isFormatActive(button.dataset.format);
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function applyFormat(action) {
    const actions = {
      heading: insertHeading,
      bold: () => wrapSelection("**", "**", "太字"),
      italic: () => wrapSelection("*", "*", "斜体"),
      strike: () => wrapSelection("~~", "~~", "取り消し線"),
      link: toggleLink,
      quote: () => toggleSelectedLinePrefix("> ", /^> /),
      code: () => wrapSelection("`", "`", "code"),
      codeblock: () => wrapSelection("```\n", "\n```", "code"),
      list: () => toggleSelectedLinePrefix("- ", /^- /),
      check: () => toggleSelectedLinePrefix("- [ ] ", /^- \[[ xX]\] /)
    };
    if (!actions[action]) return;
    actions[action]();
    updateFormatButtonStates();
  }

  function indentSelection(outdent) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    if (start === end && !outdent) {
      replaceRange(start, end, "  ", start + 2);
      return;
    }

    const lineStart = editor.value.lastIndexOf("\n", start - 1) + 1;
    let lineEnd = editor.value.indexOf("\n", end);
    if (lineEnd === -1) lineEnd = editor.value.length;
    const block = editor.value.slice(lineStart, lineEnd);
    const lines = block.split("\n");
    let deltaBeforeStart = 0;
    const replacement = lines.map((line, index) => {
      if (outdent) {
        const match = line.match(/^( {1,2}|\t)/);
        if (index === 0 && match) deltaBeforeStart -= match[0].length;
        return match ? line.slice(match[0].length) : line;
      }
      if (index === 0) deltaBeforeStart += 2;
      return `  ${line}`;
    }).join("\n");
    const totalDelta = replacement.length - block.length;
    replaceRange(
      lineStart,
      lineEnd,
      replacement,
      Math.max(lineStart, start + deltaBeforeStart),
      Math.max(lineStart, end + totalDelta)
    );
  }

  function continueList(event) {
    const cursor = editor.selectionStart;
    if (editor.selectionStart !== editor.selectionEnd) return false;
    const lineStart = editor.value.lastIndexOf("\n", cursor - 1) + 1;
    const beforeCursor = editor.value.slice(lineStart, cursor);
    const match = beforeCursor.match(/^(\s*)([-+*]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/);
    if (!match) return false;

    event.preventDefault();
    const [, indent, marker, checkbox = "", content] = match;
    if (!content.trim()) {
      replaceRange(lineStart, cursor, "", lineStart);
      return true;
    }
    let nextMarker = marker;
    const ordered = marker.match(/^(\d+)([.)])$/);
    if (ordered) nextMarker = `${Number(ordered[1]) + 1}${ordered[2]}`;
    const nextCheckbox = checkbox ? "[ ] " : "";
    const insertion = `\n${indent}${nextMarker} ${nextCheckbox}`;
    replaceRange(cursor, cursor, insertion, cursor + insertion.length);
    return true;
  }

  function toggleComment() {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = editor.value.slice(start, end);
    if (selected.startsWith("<!--") && selected.endsWith("-->")) {
      const replacement = selected.slice(4, -3).replace(/^\s|\s$/g, "");
      replaceRange(start, end, replacement, start, start + replacement.length);
    } else {
      wrapSelection("<!-- ", " -->", "コメント");
    }
  }

  function currentLineBounds() {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const blockStart = editor.value.lastIndexOf("\n", start - 1) + 1;
    let blockEnd = editor.value.indexOf("\n", end);
    if (blockEnd === -1) blockEnd = editor.value.length;
    return { start, end, blockStart, blockEnd };
  }

  function moveLines(direction) {
    const bounds = currentLineBounds();
    const block = editor.value.slice(bounds.blockStart, bounds.blockEnd);
    if (direction < 0) {
      if (bounds.blockStart === 0) return;
      const previousEnd = bounds.blockStart - 1;
      const previousStart = editor.value.lastIndexOf("\n", previousEnd - 1) + 1;
      const previous = editor.value.slice(previousStart, previousEnd);
      const replacement = `${block}\n${previous}`;
      replaceRange(previousStart, bounds.blockEnd, replacement, previousStart + (bounds.start - bounds.blockStart), previousStart + (bounds.end - bounds.blockStart));
    } else {
      if (bounds.blockEnd === editor.value.length) return;
      const nextStart = bounds.blockEnd + 1;
      let nextEnd = editor.value.indexOf("\n", nextStart);
      if (nextEnd === -1) nextEnd = editor.value.length;
      const next = editor.value.slice(nextStart, nextEnd);
      const replacement = `${next}\n${block}`;
      const offset = next.length + 1;
      replaceRange(bounds.blockStart, nextEnd, replacement, bounds.blockStart + offset + (bounds.start - bounds.blockStart), bounds.blockStart + offset + (bounds.end - bounds.blockStart));
    }
  }

  function duplicateLines() {
    const bounds = currentLineBounds();
    const block = editor.value.slice(bounds.blockStart, bounds.blockEnd);
    const insertion = `\n${block}`;
    replaceRange(bounds.blockEnd, bounds.blockEnd, insertion, bounds.start + insertion.length, bounds.end + insertion.length);
  }

  function handlePairs(event) {
    const pairs = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`" };
    const closing = new Set(Object.values(pairs));
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const next = editor.value[end];

    if (closing.has(event.key) && next === event.key && start === end) {
      event.preventDefault();
      editor.setSelectionRange(start + 1, start + 1);
      updateCursorStatus();
      return true;
    }
    if (pairs[event.key] && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const selected = editor.value.slice(start, end);
      const replacement = `${event.key}${selected}${pairs[event.key]}`;
      replaceRange(start, end, replacement, start + 1, start + 1 + selected.length);
      return true;
    }
    if (event.key === "Backspace" && start === end && start > 0) {
      const previous = editor.value[start - 1];
      if (pairs[previous] === next) {
        event.preventDefault();
        replaceRange(start - 1, start + 1, "", start - 1);
        return true;
      }
    }
    return false;
  }

  function openSearch(showReplace = false) {
    searchPanel.hidden = false;
    replaceRow.hidden = !showReplace;
    editorSearchToggle.setAttribute("aria-expanded", "true");
    const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd);
    if (selected && !selected.includes("\n")) searchInput.value = selected;
    refreshSearch();
    searchInput.focus();
    searchInput.select();
  }

  function closeSearch() {
    searchPanel.hidden = true;
    editorSearchToggle.setAttribute("aria-expanded", "false");
    editor.focus();
  }

  function refreshSearch() {
    const query = searchInput.value;
    searchMatches = [];
    activeSearchIndex = -1;
    if (query) {
      const haystack = editor.value.toLocaleLowerCase("ja");
      const needle = query.toLocaleLowerCase("ja");
      let index = haystack.indexOf(needle);
      while (index !== -1) {
        searchMatches.push(index);
        index = haystack.indexOf(needle, index + Math.max(1, needle.length));
      }
    }
    searchCount.textContent = searchMatches.length ? `0 / ${searchMatches.length}` : "0 / 0";
  }

  function findNext(direction = 1) {
    refreshSearch();
    if (!searchMatches.length) return;
    const cursor = editor.selectionStart;
    if (direction > 0) {
      activeSearchIndex = searchMatches.findIndex((position) => position >= cursor);
      if (activeSearchIndex === -1) activeSearchIndex = 0;
    } else {
      activeSearchIndex = searchMatches.findLastIndex((position) => position < cursor);
      if (activeSearchIndex === -1) activeSearchIndex = searchMatches.length - 1;
    }
    const start = searchMatches[activeSearchIndex];
    editor.focus();
    editor.setSelectionRange(start, start + searchInput.value.length);
    searchCount.textContent = `${activeSearchIndex + 1} / ${searchMatches.length}`;
    searchInput.focus();
  }

  function replaceOne() {
    const query = searchInput.value;
    if (!query) return;
    const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd);
    if (selected.toLocaleLowerCase("ja") !== query.toLocaleLowerCase("ja")) {
      findNext(1);
      return;
    }
    const start = editor.selectionStart;
    replaceRange(start, editor.selectionEnd, replaceInput.value, start + replaceInput.value.length);
    refreshSearch();
    findNext(1);
  }

  function replaceAll() {
    const query = searchInput.value;
    if (!query) return;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expression = new RegExp(escaped, "giu");
    const matches = editor.value.match(expression) || [];
    if (!matches.length) return;
    editor.value = editor.value.replace(expression, () => replaceInput.value);
    hasUserEdits = editor.value !== initialMarkdown;
    scheduleRender();
    refreshSearch();
    showToast(`${matches.length}件を置換しました。`);
  }

  async function copyText(text, button, successMessage) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const helper = document.createElement("textarea");
        helper.value = text;
        helper.setAttribute("readonly", "");
        helper.className = "sr-only";
        document.body.appendChild(helper);
        helper.select();
        const copied = document.execCommand("copy");
        helper.remove();
        if (!copied) throw new Error("copy failed");
      }
      button.classList.add("is-copied");
      showToast(successMessage);
      setTimeout(() => button.classList.remove("is-copied"), 1400);
    } catch (_error) {
      showToast("コピーできませんでした。選択して手動でコピーしてください。");
    }
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2400);
  }

  function readStoredTheme() {
    try {
      const storedTheme = window.localStorage.getItem(themeStorageKey);
      return storedTheme === "dark" ? "dark" : "light";
    } catch (_error) {
      return "light";
    }
  }

  function setDisplayTheme(theme, { persist = true } = {}) {
    const dark = theme === "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    themeToggle.setAttribute("aria-pressed", String(dark));
    themeToggle.setAttribute("aria-label", dark ? "ライトモードに切り替え" : "ダークモードに切り替え");

    if (persist) {
      try {
        window.localStorage.setItem(themeStorageKey, dark ? "dark" : "light");
      } catch (_error) {
        // Storage may be unavailable in a private or restricted browser context.
      }
    }
  }

  function readFormatToolbarVisibility() {
    try {
      return window.localStorage.getItem(formatToolbarStorageKey) === "true";
    } catch (_error) {
      return false;
    }
  }

  function setFormatToolbarVisibility(visible, { persist = true, announce = true } = {}) {
    const returnFocusToEditor = !visible && formatToolbar.contains(document.activeElement);
    formatToolbarVisible = visible;
    formatToolbar.hidden = !visible;
    formatToolbarToggle.classList.toggle("is-active", visible);
    formatToolbarToggle.setAttribute("aria-pressed", String(visible));
    formatToolbarToggle.setAttribute("aria-label", visible ? "書式ヒントを非表示にする" : "書式ヒントを表示する");
    if (persist) {
      try {
        window.localStorage.setItem(formatToolbarStorageKey, String(visible));
      } catch (_error) {
        // Storage may be unavailable in a private or restricted browser context.
      }
    }
    if (visible) updateFormatButtonStates();
    if (returnFocusToEditor) editor.focus({ preventScroll: true });
    if (announce) showToast(visible
      ? "書式ヒントを表示しました。Ctrl/⌘ + Shift + Hでもう一度切り替えられます。"
      : "書式ヒントを非表示にしました。");
  }

  function toggleFormatToolbarVisibility() {
    setFormatToolbarVisibility(!formatToolbarVisible);
  }

  function hasSeenOnboarding() {
    if (onboardingSeenInSession) return true;
    try {
      return window.localStorage.getItem(onboardingStorageKey) === "true";
    } catch (_error) {
      return false;
    }
  }

  function markOnboardingSeen() {
    onboardingSeenInSession = true;
    try {
      window.localStorage.setItem(onboardingStorageKey, "true");
    } catch (_error) {
      // Storage may be unavailable in a private or restricted browser context.
    }
  }

  function renderOnboardingStep(moveFocus = false) {
    onboardingSteps.forEach((step, index) => {
      step.hidden = index !== onboardingStepIndex;
    });
    onboardingProgress.textContent = `${onboardingStepIndex + 1} / ${onboardingSteps.length}`;
    onboardingBack.disabled = onboardingStepIndex === 0;
    onboardingNext.textContent = onboardingStepIndex === onboardingSteps.length - 1 ? "使い始める" : "次へ";
    if (moveFocus) onboardingSteps[onboardingStepIndex].querySelector("h3")?.focus();
  }

  function openOnboarding(returnFocusTarget = editor) {
    onboardingReturnFocus = returnFocusTarget;
    onboardingStepIndex = 0;
    renderOnboardingStep();
    if (typeof onboardingDialog.showModal === "function") onboardingDialog.showModal();
    else onboardingDialog.setAttribute("open", "");
    onboardingTitle.focus();
  }

  function closeOnboarding() {
    markOnboardingSeen();
    if (typeof onboardingDialog.close === "function") onboardingDialog.close();
    else onboardingDialog.removeAttribute("open");
    onboardingReturnFocus?.focus({ preventScroll: true });
  }

  editor.addEventListener("input", () => {
    hasUserEdits = editor.value !== initialMarkdown;
    scheduleRender();
    updateFormatButtonStates();
  });
  editor.addEventListener("scroll", () => {
    syncGutterScroll();
    if (syncScroll) {
      const editorRange = Math.max(1, editor.scrollHeight - editor.clientHeight);
      const previewRange = Math.max(0, previewScroll.scrollHeight - previewScroll.clientHeight);
      previewScroll.scrollTop = (editor.scrollTop / editorRange) * previewRange;
    }
  });
  ["click", "keyup", "select"].forEach((eventName) => editor.addEventListener(eventName, () => {
    updateCursorStatus();
    updateActiveLine();
    updateFormatButtonStates();
  }));

  editor.addEventListener("keydown", (event) => {
    const key = event.key.toLocaleLowerCase("en-US");
    const primary = (event.ctrlKey || event.metaKey)
      && !(event.ctrlKey && event.metaKey);
    const exactPrimary = primary
      && !event.shiftKey
      && !event.altKey;
    const exactPrimaryShift = primary
      && event.shiftKey
      && !event.altKey;

    if (event.key === "Escape" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      editorTabEscapeArmed = true;
      showToast("次のTabまたはShift + Tabでエディタから移動できます。");
      return;
    }
    if (event.key === "Tab") {
      if (editorTabEscapeArmed) {
        editorTabEscapeArmed = false;
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      indentSelection(event.shiftKey);
      return;
    }

    editorTabEscapeArmed = false;

    if (exactPrimaryShift && key === "h") {
      event.preventDefault();
      toggleFormatToolbarVisibility();
      return;
    }
    if (exactPrimary && key === "f") {
      event.preventDefault();
      openSearch(false);
      return;
    }
    if (exactPrimary && key === "h") {
      event.preventDefault();
      openSearch(true);
      return;
    }
    if (exactPrimary && key === "b") {
      event.preventDefault();
      applyFormat("bold");
      return;
    }
    if (exactPrimary && key === "i") {
      event.preventDefault();
      applyFormat("italic");
      return;
    }
    if (exactPrimary && key === "k") {
      event.preventDefault();
      applyFormat("link");
      return;
    }
    if (exactPrimary && key === "/") {
      event.preventDefault();
      toggleComment();
      return;
    }
    if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.key === "ArrowDown") {
      event.preventDefault();
      duplicateLines();
      return;
    }
    if (event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey
      && ["ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      moveLines(event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (event.key === "Enter" && continueList(event)) return;
    handlePairs(event);
  });

  editor.addEventListener("blur", () => {
    editorTabEscapeArmed = false;
  });

  formatButtons.forEach((button) => {
    button.addEventListener("click", () => applyFormat(button.dataset.format));
  });

  formatToolbarToggle.addEventListener("click", toggleFormatToolbarVisibility);
  editorSearchToggle.addEventListener("click", () => openSearch(true));
  moveLineUpButton.addEventListener("click", () => {
    moveLines(-1);
    editor.focus({ preventScroll: true });
  });
  moveLineDownButton.addEventListener("click", () => {
    moveLines(1);
    editor.focus({ preventScroll: true });
  });
  duplicateLineButton.addEventListener("click", () => {
    duplicateLines();
    editor.focus({ preventScroll: true });
  });

  syncScrollButton.addEventListener("click", () => {
    syncScroll = !syncScroll;
    syncScrollButton.classList.toggle("is-active", syncScroll);
    syncScrollButton.setAttribute("aria-pressed", String(syncScroll));
    syncScrollButton.setAttribute("aria-label", syncScroll ? "プレビューとのスクロール同期を解除" : "プレビューとのスクロール同期を有効化");
    showToast(syncScroll ? "スクロール同期を有効にしました。" : "スクロール同期を解除しました。");
  });

  remoteImagesToggle.addEventListener("click", () => {
    allowRemoteImages = !allowRemoteImages;
    remoteImagesToggle.setAttribute("aria-pressed", String(allowRemoteImages));
    remoteImagesToggle.setAttribute("aria-label", allowRemoteImages ? "外部画像の読み込みを遮断" : "外部画像の読み込みを許可");
    remoteImagesToggle.textContent = allowRemoteImages ? "外部画像：許可中" : "外部画像：遮断中";
    renderMarkdown();
    showToast(allowRemoteImages
      ? "外部画像を許可しました。画像の接続先に通信情報が伝わる場合があります。"
      : "外部画像を遮断しました。");
  });

  themeToggle.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    setDisplayTheme(nextTheme);
  });

  document.querySelector("#copy-markdown").addEventListener("click", (event) => {
    copyText(editor.value, event.currentTarget, "Markdownをコピーしました。");
  });
  document.querySelector("#copy-html").addEventListener("click", (event) => {
    copyText(sanitizedHtml, event.currentTarget, "安全なHTMLをコピーしました。");
  });

  validationStatus.addEventListener("click", () => {
    problemsPanel.open = true;
    problemsPanel.querySelector("summary").focus();
  });

  document.querySelector("#shortcut-help").addEventListener("click", () => {
    if (typeof shortcutDialog.showModal === "function") shortcutDialog.showModal();
    else shortcutDialog.setAttribute("open", "");
  });

  document.querySelector("#tutorial-help").addEventListener("click", (event) => {
    openOnboarding(event.currentTarget);
  });
  document.querySelector("#onboarding-skip").addEventListener("click", closeOnboarding);
  onboardingBack.addEventListener("click", () => {
    onboardingStepIndex = Math.max(0, onboardingStepIndex - 1);
    renderOnboardingStep(true);
  });
  onboardingNext.addEventListener("click", () => {
    if (onboardingStepIndex < onboardingSteps.length - 1) {
      onboardingStepIndex += 1;
      renderOnboardingStep(true);
      return;
    }
    closeOnboarding();
  });
  onboardingDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeOnboarding();
  });

  searchInput.addEventListener("input", refreshSearch);
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      findNext(event.shiftKey ? -1 : 1);
    }
    if (event.key === "Escape") closeSearch();
  });
  replaceInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      replaceOne();
    }
    if (event.key === "Escape") closeSearch();
  });
  document.querySelector("#find-previous").addEventListener("click", () => findNext(-1));
  document.querySelector("#find-next").addEventListener("click", () => findNext(1));
  document.querySelector("#close-search").addEventListener("click", closeSearch);
  document.querySelector("#replace-one").addEventListener("click", replaceOne);
  document.querySelector("#replace-all").addEventListener("click", replaceAll);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !searchPanel.hidden) closeSearch();
  });

  window.addEventListener("beforeunload", (event) => {
    if (!hasUserEdits) return;
    event.preventDefault();
    event.returnValue = "";
  });

  setDisplayTheme(readStoredTheme(), { persist: false });
  editor.value = initialMarkdown;
  editor.setSelectionRange(0, 0);
  editor.scrollTop = 0;
  setFormatToolbarVisibility(readFormatToolbarVisibility(), { persist: false, announce: false });
  renderMarkdown();
  updateFormatButtonStates();
  if (hasSeenOnboarding()) editor.focus({ preventScroll: true });
  else openOnboarding(editor);
})();
