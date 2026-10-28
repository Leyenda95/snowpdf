import type { PDFDocumentProxy } from "pdfjs-dist";

/**
 * Minimal implementation of the pdf.js link service interface used by AnnotationLayer.
 * Internal links navigate inside the workspace; external links are only opened after the
 * user confirms (nothing is fetched automatically).
 */
export class SnowLinkService {
  externalLinkEnabled = true;
  isInPresentationMode = false;
  eventBus = null;

  constructor(
    private readonly pdf: PDFDocumentProxy,
    private readonly goToSourcePage: (sourceIndex: number) => void,
    private readonly openExternal: (url: string) => void,
  ) {}

  get pagesCount(): number {
    return this.pdf.numPages;
  }

  addLinkAttributes(link: HTMLAnchorElement, url: string): void {
    link.href = url;
    link.title = url;
    link.rel = "noopener noreferrer nofollow";
    link.onclick = (event) => {
      event.preventDefault();
      this.openExternal(url);
      return false;
    };
  }

  getDestinationHash(): string {
    return "#";
  }

  getAnchorUrl(): string {
    return "#";
  }

  async goToDestination(dest: string | unknown[]): Promise<void> {
    const explicit = typeof dest === "string" ? await this.pdf.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || explicit.length === 0) return;
    const target = explicit[0];
    const index =
      typeof target === "number" ? target : await this.pdf.getPageIndex(target as Parameters<PDFDocumentProxy["getPageIndex"]>[0]);
    this.goToSourcePage(index);
  }

  goToPage(pageNumber: number): void {
    this.goToSourcePage(pageNumber - 1);
  }

  setHash(): void {}
  executeNamedAction(): void {}
  executeSetOCGState(): void {}
  navigateTo(): void {}
}
