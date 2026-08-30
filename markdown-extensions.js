(function () {
  "use strict";

  const ALERT_TYPES = {
    NOTE: { label: "注記" },
    TIP: { label: "ヒント" },
    IMPORTANT: { label: "重要" },
    WARNING: { label: "警告" },
    CAUTION: { label: "注意" }
  };

  let lastAbbreviations = [];

  function markFencedLines(lines) {
    const protectedLines = new Array(lines.length).fill(false);
    let fence = null;

    lines.forEach((line, index) => {
      const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (!fence && match) {
        fence = { character: match[1][0], length: match[1].length };
        protectedLines[index] = true;
        return;
      }
      if (!fence) return;

      protectedLines[index] = true;
      const closing = line.match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) fence = null;
    });

    return protectedLines;
  }

  function replaceOutsideCodeSpans(line, transform) {
    let output = "";
    let cursor = 0;
    const codeSpan = /(`+)([\s\S]*?)\1/g;
    let match;

    while ((match = codeSpan.exec(line)) !== null) {
      output += transform(line.slice(cursor, match.index));
      output += match[0];
      cursor = match.index + match[0].length;
    }

    return output + transform(line.slice(cursor));
  }

  function extractAbbreviations(lines, protectedLines) {
    const abbreviations = [];

    lines.forEach((line, index) => {
      if (protectedLines[index]) return;
      const definition = line.match(/^\s{0,3}\*\[([^\]\n]+)\]:\s+(.+)\s*$/);
      if (!definition) return;
      abbreviations.push({ term: definition[1], title: definition[2] });
      lines[index] = "";
    });

    return abbreviations;
  }

  function extractFootnotes(lines, protectedLines) {
    const footnotes = new Map();

    for (let index = 0; index < lines.length; index += 1) {
      if (protectedLines[index]) continue;
      const footnote = lines[index].match(/^\s{0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$/);
      if (!footnote) continue;

      const footnoteLines = [footnote[2]];
      let end = index + 1;
      while (end < lines.length && !protectedLines[end]) {
        const continuation = lines[end].match(/^(?: {2,}|\t)(.*)$/);
        if (continuation) {
          footnoteLines.push(continuation[1]);
          end += 1;
          continue;
        }
        if (lines[end].trim() === "" && end + 1 < lines.length && /^(?: {2,}|\t)/.test(lines[end + 1])) {
          footnoteLines.push("");
          end += 1;
          continue;
        }
        break;
      }

      footnotes.set(footnote[1], footnoteLines.join("\n").trim());
      for (let remove = index; remove < end; remove += 1) lines[remove] = "";
      index = end - 1;
    }

    return footnotes;
  }

  function addFootnoteReferences(lines, protectedLines, footnotes) {
    const order = new Map();

    function replaceReferences(value) {
      return replaceOutsideCodeSpans(value, (segment) => segment.replace(/\[\^([^\]\s]+)\]/g, (whole, label) => {
        if (!footnotes.has(label)) return whole;
        if (!order.has(label)) order.set(label, { number: order.size + 1, references: 0 });
        const item = order.get(label);
        item.references += 1;
        const suffix = item.references > 1 ? `-${item.references}` : "";
        return `<sup class="md-footnote-ref"><a id="md-footnote-ref-${item.number}${suffix}" href="#md-footnote-${item.number}" aria-label="脚注 ${item.number}">[${item.number}]</a></sup>`;
      }));
    }

    lines.forEach((line, index) => {
      if (!protectedLines[index] && line) lines[index] = replaceReferences(line);
    });

    return { order, replaceReferences };
  }

  function convertDefinitionLists(lines, protectedLines, marked) {
    for (let index = 0; index < lines.length; index += 1) {
      if (protectedLines[index] || !lines[index].trim()) continue;
      if (/^\s{0,3}(?:#{1,6}\s|>|[-+*]\s|\d+[.)]\s|<)/.test(lines[index])) continue;

      let definitionStart = index + 1;
      if (definitionStart < lines.length && lines[definitionStart].trim() === "") definitionStart += 1;
      if (definitionStart >= lines.length || protectedLines[definitionStart]) continue;
      if (!/^\s{0,3}[:~]\s+/.test(lines[definitionStart])) continue;

      const definitions = [];
      let cursor = definitionStart;
      while (cursor < lines.length && !protectedLines[cursor]) {
        const definition = lines[cursor].match(/^\s{0,3}[:~]\s+(.+)$/);
        if (definition) {
          definitions.push(definition[1]);
          cursor += 1;
          continue;
        }
        const continuation = lines[cursor].match(/^(?: {2,}|\t)(.+)$/);
        if (continuation && definitions.length) {
          definitions[definitions.length - 1] += `\n${continuation[1]}`;
          cursor += 1;
          continue;
        }
        if (lines[cursor].trim() === "" && cursor + 1 < lines.length && /^\s{0,3}[:~]\s+/.test(lines[cursor + 1])) {
          cursor += 1;
          continue;
        }
        break;
      }

      const term = marked.parseInline(lines[index].trim(), { gfm: true });
      const items = definitions
        .map((definition) => `<dd>${marked.parseInline(definition, { gfm: true })}</dd>`)
        .join("\n");
      lines[index] = `\n<dl class="md-definition-list">\n<dt>${term}</dt>\n${items}\n</dl>\n`;
      for (let remove = index + 1; remove < cursor; remove += 1) lines[remove] = "";
      index = cursor - 1;
    }
  }

  function convertAlerts(lines, protectedLines, marked) {
    for (let index = 0; index < lines.length; index += 1) {
      if (protectedLines[index]) continue;
      const start = lines[index].match(/^\s{0,3}>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i);
      if (!start) continue;

      const type = start[1].toUpperCase();
      const body = [];
      let end = index + 1;
      while (end < lines.length && !protectedLines[end]) {
        const quoted = lines[end].match(/^\s{0,3}>\s?(.*)$/);
        if (!quoted) break;
        body.push(quoted[1]);
        end += 1;
      }

      const information = ALERT_TYPES[type];
      const inner = marked.parse(body.join("\n"), { gfm: true, breaks: true });
      lines[index] = `\n<blockquote class="md-alert md-alert-${type.toLowerCase()}" role="note" aria-label="${information.label}">\n<p class="md-alert-title">${information.label}</p>\n${inner}\n</blockquote>\n`;
      for (let remove = index + 1; remove < end; remove += 1) lines[remove] = "";
      index = end - 1;
    }
  }

  function appendFootnotes(lines, footnotes, referenceState, marked) {
    if (!referenceState.order.size) return;
    const items = [];

    referenceState.order.forEach((item, label) => {
      const content = referenceState.replaceReferences(footnotes.get(label));
      const rendered = marked.parse(content, { gfm: true, breaks: true }).trim();
      items.push(`<li id="md-footnote-${item.number}">${rendered}<a class="md-footnote-backref" href="#md-footnote-ref-${item.number}" aria-label="脚注 ${item.number} の参照位置へ戻る">↩</a></li>`);
    });

    lines.push("", `<section class="md-footnotes" aria-label="脚注">\n<hr>\n<ol>\n${items.join("\n")}\n</ol>\n</section>`);
  }

  function render(source, marked) {
    const lines = String(source).replace(/\r\n?/g, "\n").split("\n");
    const protectedLines = markFencedLines(lines);
    lastAbbreviations = extractAbbreviations(lines, protectedLines);
    const footnotes = extractFootnotes(lines, protectedLines);
    const referenceState = addFootnoteReferences(lines, protectedLines, footnotes);

    convertDefinitionLists(lines, protectedLines, marked);
    convertAlerts(lines, protectedLines, marked);
    appendFootnotes(lines, footnotes, referenceState, marked);

    return marked.parse(lines.join("\n"), { gfm: true, breaks: true });
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function decorateAbbreviations(root, abbreviations) {
    const terms = abbreviations
      .filter((item) => item.term)
      .sort((left, right) => right.term.length - left.term.length);
    if (!terms.length) return;

    const definitions = new Map(terms.map((item) => [item.term, item.title]));
    const pattern = terms.map((item) => escapeRegExp(item.term)).join("|");
    const matcher = new RegExp("(^|[^\\p{L}\\p{N}_])(" + pattern + ")(?![\\p{L}\\p{N}_])", "gu");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];

    while (walker.nextNode()) {
      const parent = walker.currentNode.parentElement;
      if (!parent || parent.closest("pre, code, a, abbr, .katex")) continue;
      if (matcher.test(walker.currentNode.nodeValue)) nodes.push(walker.currentNode);
      matcher.lastIndex = 0;
    }

    nodes.forEach((node) => {
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      node.nodeValue.replace(matcher, (whole, prefix, term, offset) => {
        fragment.append(document.createTextNode(node.nodeValue.slice(cursor, offset + prefix.length)));
        const abbreviation = document.createElement("abbr");
        abbreviation.title = definitions.get(term);
        abbreviation.setAttribute("aria-label", term + "、" + definitions.get(term));
        abbreviation.textContent = term;
        fragment.append(abbreviation);
        cursor = offset + whole.length;
        return whole;
      });
      fragment.append(document.createTextNode(node.nodeValue.slice(cursor)));
      node.replaceWith(fragment);
      matcher.lastIndex = 0;
    });
  }

  function normalizePandocInlineMath(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];

    while (walker.nextNode()) {
      const parent = walker.currentNode.parentElement;
      if (!parent || parent.closest("pre, code, .katex")) continue;
      nodes.push(walker.currentNode);
    }

    nodes.forEach((node) => {
      node.nodeValue = node.nodeValue.replace(
        /(^|[^\\$])\$([^\s$](?:[^$\n]*[^\s$])?)\$(?!\d)/g,
        "$1\\($2\\)"
      );
    });
  }

  function decorate(root) {
    if (typeof window.renderMathInElement === "function") {
      normalizePandocInlineMath(root);
      window.renderMathInElement(root, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\(", right: "\\)", display: false }
        ],
        ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
        throwOnError: false,
        trust: false,
        strict: "warn"
      });
    }
    decorateAbbreviations(root, lastAbbreviations);
  }

  window.MarkdownExtensions = { render, decorate };
})();
