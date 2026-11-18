import { useEffect, useRef, type CSSProperties } from "react";
import type { Raster } from "@/pdf/inpaint";
import { paintRaster } from "./scanImage";

interface RasterCanvasProps {
  raster: Raster;
  className?: string;
  style?: CSSProperties;
}

/** A canvas showing an RGBA raster at its own pixel size; scale it with CSS. */
export function RasterCanvas({ raster, className, style }: RasterCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) paintRaster(ref.current, raster);
  }, [raster]);
  return <canvas ref={ref} aria-hidden className={className} style={style} />;
}
