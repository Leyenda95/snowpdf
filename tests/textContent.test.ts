import { describe, expect, it } from "vitest";
import { REDACT_PATTERNS, groupLines, searchRuns, searchRunsPattern, type TextRun } from "@/render/textContent";

function run(str: string, x: number, y: number, size = 12, dir: [number, number] = [1, 0]): TextRun {
  return { str, x, y, dx: dir[0], dy: dir[1], width: str.length * size * 0.5, size, fontName: "f1", family: "sans-serif" };
}

const pattern = (id: string) => REDACT_PATTERNS.find((p) => p.id === id)!.regex;

describe("text lines and search", () => {
  it("groups runs on the same baseline into one line, top to bottom", () => {
    const lines = groupLines([run("mundo", 100, 700), run("Hola", 60, 700), run("Segunda línea", 60, 680)]);
    expect(lines.map((l) => l.text)).toEqual(["Hola mundo", "Segunda línea"]);
    expect(lines[0].frame.rot).toBe(0);
  });

  it("keeps rotated text in its own line with its angle", () => {
    const lines = groupLines([run("Vertical", 300, 100, 12, [0, 1])]);
    expect(lines[0].frame.rot).toBe(90);
  });

  it("searches ignoring case and accents, across runs", () => {
    const runs = [run("Canción del", 60, 700), run("VERANO", 132, 700)];
    expect(searchRuns(runs, "cancion")).toHaveLength(1);
    expect(searchRuns(runs, "del verano")[0].frames).toHaveLength(2);
    expect(searchRuns(runs, "invierno")).toHaveLength(0);
  });

  it("finds Spanish sensitive data patterns", () => {
    const runs = [
      run("DNI 12345678Z, NIE X1234567L", 60, 700),
      run("IBAN ES91 2100 0418 4502 0005 1332", 60, 680),
      run("Escribe a ana.lopez@correo.es o llama al 612 345 678", 60, 660),
    ];
    expect(searchRunsPattern(runs, pattern("dni"))).toHaveLength(2);
    expect(searchRunsPattern(runs, pattern("iban"))).toHaveLength(1);
    expect(searchRunsPattern(runs, pattern("email"))[0].snippet).toContain("ana.lopez@correo.es");
    expect(searchRunsPattern(runs, pattern("phone"))).toHaveLength(1);
  });
});
