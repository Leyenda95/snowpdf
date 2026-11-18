import { useMemo, useRef, useState } from "react";
import { HOME_TOOLS, matchesHomeQuery, type HomeToolEntry } from "./homeTools";

/** Search state and launcher shared by the desktop sidebar and the phone's inline tools list. */
export function useHomeTools() {
  const [query, setQuery] = useState("");
  const results = useMemo(() => HOME_TOOLS.filter((entry) => matchesHomeQuery(entry, query)), [query]);
  const groups = useMemo(() => [...new Set(results.map((entry) => entry.group))], [results]);
  // Ignore clicks while a tool is still opening (file picker, loading the PDF).
  const busy = useRef(false);

  const open = async (entry: HomeToolEntry) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await entry.run();
    } finally {
      busy.current = false;
    }
  };

  return { query, setQuery, results, groups, open };
}
