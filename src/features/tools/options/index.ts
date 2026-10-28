import type { ToolModule } from "../types";
import type { BatchToolId } from "../registry";
import { compressTool } from "./compress";
import { cropTool } from "./crop";
import { imagesToPdfTool } from "./imagesToPdf";
import { flattenTool, repairTool } from "./maintenance";
import { mergeTool } from "./merge";
import { metadataTool } from "./metadata";
import { pageNumbersTool } from "./pageNumbers";
import { pdfToImagesTool } from "./pdfToImages";
import { rotateTool } from "./rotate";
import { protectTool } from "./security";
import { splitTool } from "./split";
import { watermarkTool } from "./watermark";

// Each module is typed with its own options; the page only handles them opaquely.
export const TOOL_MODULES: Record<BatchToolId, ToolModule<any>> = {
  merge: mergeTool,
  split: splitTool,
  rotate: rotateTool,
  compress: compressTool,
  repair: repairTool,
  flatten: flattenTool,
  "images-to-pdf": imagesToPdfTool,
  "pdf-to-images": pdfToImagesTool,
  watermark: watermarkTool,
  "page-numbers": pageNumbersTool,
  crop: cropTool,
  metadata: metadataTool,
  protect: protectTool,
};
