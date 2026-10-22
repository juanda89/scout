import { describe, expect, it } from "vitest";
import { followerBands } from "./discovery.js";

describe("followerBands", () => {
  it("cubre todo el rango de arriba hacia abajo, sin huecos", () => {
    const b = followerBands(200_000, 500_000, 4);
    expect(b).toHaveLength(4);
    expect(b[0][1]).toBe(500_000);
    expect(b[3][0]).toBe(200_000);
    for (let i = 1; i < b.length; i++) expect(b[i][1]).toBe(b[i - 1][0]);
  });
  it("tolera rangos abiertos", () => {
    const b = followerBands(null, null, 3);
    expect(b[2][0]).toBe(1000);
    expect(b[0][1]).toBe(10_000_000);
  });
});
