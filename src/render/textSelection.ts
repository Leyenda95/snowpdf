import { normalizeUnicode } from "pdfjs-dist";
import { joinSelectedLines, type SelectedLine } from "./textJoin";

const layers = new Map<HTMLDivElement, HTMLDivElement>();
let globalAC: AbortController | null = null;

function reset(end: HTMLDivElement, layer: HTMLDivElement): void {
  layer.append(end);
  end.style.width = "";
  end.style.height = "";
  end.style.userSelect = "";
  layer.classList.remove("selecting");
}

function resetAll(): void {
  layers.forEach(reset);
}

/** Wires selection helpers into a rendered pdf.js text layer div. Returns a cleanup function. */
export function attachTextSelection(textLayerDiv: HTMLDivElement): () => void {
  const end = document.createElement("div");
  end.className = "endOfContent";
  textLayerDiv.append(end);
  const onMouseDown = () => textLayerDiv.classList.add("selecting");
  textLayerDiv.addEventListener("mousedown", onMouseDown);
  layers.set(textLayerDiv, end);
  enableGlobalListeners();
  return () => {
    textLayerDiv.removeEventListener("mousedown", onMouseDown);
    layers.delete(textLayerDiv);
    end.remove();
    textLayerDiv.classList.remove("selecting");
    if (layers.size === 0) {
      globalAC?.abort();
      globalAC = null;
    }
  };
}

function enableGlobalListeners(): void {
  if (globalAC) return;
  globalAC = new AbortController();
  const { signal } = globalAC;
  let isPointerDown = false;
  document.addEventListener("pointerdown", () => void (isPointerDown = true), { signal });
  document.addEventListener(
    "pointerup",
    () => {
      isPointerDown = false;
      resetAll();
    },
    { signal },
  );
  window.addEventListener(
    "blur",
    () => {
      isPointerDown = false;
      resetAll();
    },
    { signal },
  );
  document.addEventListener(
    "keyup",
    () => {
      if (!isPointerDown) resetAll();
    },
    { signal },
  );

  let isFirefoxOrModernChromium: boolean | undefined;
  let prevRange: Range | undefined;
  document.addEventListener(
    "selectionchange",
    () => {
      const selection = document.getSelection();
      if (!selection || selection.rangeCount === 0) {
        resetAll();
        return;
      }
      const active = new Set<HTMLDivElement>();
      for (let i = 0; i < selection.rangeCount; i++) {
        const range = selection.getRangeAt(i);
        for (const div of layers.keys()) {
          if (!active.has(div) && range.intersectsNode(div)) active.add(div);
        }
      }
      for (const [div, endDiv] of layers) {
        if (active.has(div)) div.classList.add("selecting");
        else reset(endDiv, div);
      }
      if (isFirefoxOrModernChromium === undefined) {
        const firstLayer = layers.keys().next().value;
        if (!firstLayer) return;
        isFirefoxOrModernChromium = getComputedStyle(firstLayer).getPropertyValue("-moz-user-select") === "none";
        if (!isFirefoxOrModernChromium) {
          const uaData = (navigator as Navigator & { userAgentData?: { brands: { brand: string; version: string }[] } }).userAgentData;
          const version = uaData
            ? uaData.brands.find(({ brand }) => brand === "Chromium")?.version
            : /\bChrome\/(\d+)\b/.exec(navigator.userAgent)?.[1];
          isFirefoxOrModernChromium = !!version && parseInt(version, 10) >= 148;
        }
      }
      if (isFirefoxOrModernChromium) return;

      const range = selection.getRangeAt(0);
      const modifyStart =
        !!prevRange &&
        (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 ||
          range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
      let anchor: Node | null = modifyStart ? range.startContainer : range.endContainer;
      if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
      if (anchor instanceof Element && anchor.classList.contains("highlight")) anchor = anchor.parentNode;
      if (!anchor) return;
      if (!modifyStart && range.endOffset === 0) {
        do {
          while (!anchor.previousSibling) {
            if (!anchor.parentNode) return;
            anchor = anchor.parentNode;
          }
          anchor = anchor.previousSibling;
        } while (!anchor.childNodes.length);
      }
      const parentTextLayer = anchor.parentElement?.closest<HTMLDivElement>(".textLayer");
      const endDiv = parentTextLayer ? layers.get(parentTextLayer) : undefined;
      if (parentTextLayer && endDiv && anchor.parentElement) {
        endDiv.style.width = parentTextLayer.style.width;
        endDiv.style.height = parentTextLayer.style.height;
        endDiv.style.userSelect = "text";
        anchor.parentElement.insertBefore(endDiv, modifyStart ? anchor : anchor.nextSibling);
      }
      prevRange = range.cloneRange();
    },
    { signal },
  );

  document.addEventListener("copy", onCopy, { signal });
}

interface LineBuilder {
  text: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  hasRect: boolean;
}

function newLine(): LineBuilder {
  return { text: "", left: 0, right: 0, top: 0, bottom: 0, hasRect: false };
}

function toReadingFrame(l: LineBuilder, rotation: number, group: number): SelectedLine {
  const { left, right, top, bottom, text } = l;
  switch (rotation) {
    case 90:
      return { text, inlineStart: top, inlineEnd: bottom, blockStart: -right, blockEnd: -left, group };
    case 180:
      return { text, inlineStart: -right, inlineEnd: -left, blockStart: -bottom, blockEnd: -top, group };
    case 270:
      return { text, inlineStart: -bottom, inlineEnd: -top, blockStart: left, blockEnd: right, group };
    default:
      return { text, inlineStart: left, inlineEnd: right, blockStart: top, blockEnd: bottom, group };
  }
}

function spanText(span: Element, range: Range): string {
  const full = span.textContent ?? "";
  let from = 0;
  let to = full.length;
  const { startContainer, endContainer } = range;
  if (span.contains(startContainer)) {
    from = startContainer.nodeType === Node.TEXT_NODE ? Math.min(range.startOffset, full.length) : range.startOffset > 0 ? full.length : 0;
  }
  if (span.contains(endContainer)) {
    to = endContainer.nodeType === Node.TEXT_NODE ? Math.min(range.endOffset, full.length) : range.endOffset > 0 ? full.length : 0;
  }
  return from < to ? full.slice(from, to) : "";
}

function onCopy(event: ClipboardEvent): void {
  const active = document.activeElement;
  if (active?.matches('input, textarea, [contenteditable=""], [contenteditable="true"]')) return;
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);

  const hit = [...layers.keys()]
    .filter((div) => range.intersectsNode(div))
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  if (hit.length === 0) return;

  const lines: SelectedLine[] = [];
  hit.forEach((div, group) => {
    const rotation = ((parseInt(div.dataset.mainRotation ?? "0", 10) % 360) + 360) % 360;
    let cur = newLine();
    const close = () => {
      if (cur.text) lines.push(toReadingFrame(cur, rotation, group));
      cur = newLine();
    };
    for (const node of div.querySelectorAll('span[role="presentation"], br')) {
      if (!range.intersectsNode(node)) continue;
      if (node.tagName === "BR") {
        close();
        continue;
      }
      const text = spanText(node, range);
      if (!text) continue;
      cur.text += text;
      const r = node.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (cur.hasRect) {
        cur.left = Math.min(cur.left, r.left);
        cur.right = Math.max(cur.right, r.right);
        cur.top = Math.min(cur.top, r.top);
        cur.bottom = Math.max(cur.bottom, r.bottom);
      } else {
        cur.left = r.left;
        cur.right = r.right;
        cur.top = r.top;
        cur.bottom = r.bottom;
        cur.hasRect = true;
      }
    }
    close();
  });

  const text = normalizeUnicode(joinSelectedLines(lines)).replace(/\u0000/g, "");
  if (!text) return;
  event.clipboardData?.setData("text/plain", text);
  event.preventDefault();
}
