import { describe, expect, it } from "vitest";
import { audienceInCountries } from "../src/scouting/geo.js";

describe("audienceInCountries", () => {
  it("suma los países objetivo (alpha-2 del brief contra alpha-3 de CreatorDB)", () => {
    expect(audienceInCountries({ COL: 80.5, USA: 10, MEX: 9.5 }, ["CO", "MX"])).toBe(90);
  });
  it("un informe vacío es 'sin dato', no 0 %", () => {
    expect(audienceInCountries({}, ["CO"])).toBeNull();
    expect(audienceInCountries({ COL: 0, USA: 0 }, ["CO"])).toBeNull();
    expect(audienceInCountries(null, ["CO"])).toBeNull();
  });
});
