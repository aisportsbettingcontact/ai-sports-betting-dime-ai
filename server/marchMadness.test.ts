/**
 * marchMadness.test.ts
 *
 * Unit tests for the 2026 March Madness teams allowlist and isMarchMadnessGame helper.
 */
import { describe, it, expect } from "vitest";
import {
  MARCH_MADNESS_DB_SLUGS,
  isMarchMadnessGame,
} from "../shared/marchMadnessTeams";

describe("MARCH_MADNESS_DB_SLUGS", () => {
  it("should contain exactly 68 unique teams", () => {
    expect(MARCH_MADNESS_DB_SLUGS.size).toBe(68);
  });

  it("should include all four First Four teams for March 18 games", () => {
    expect(MARCH_MADNESS_DB_SLUGS.has("prairie_view_a_and_m")).toBe(true);
    expect(MARCH_MADNESS_DB_SLUGS.has("lehigh")).toBe(true);
    expect(MARCH_MADNESS_DB_SLUGS.has("miami_oh")).toBe(true);
    expect(MARCH_MADNESS_DB_SLUGS.has("smu")).toBe(true);
  });

  it("should include all four First Four teams for March 17 games", () => {
    expect(MARCH_MADNESS_DB_SLUGS.has("umbc")).toBe(true);
    expect(MARCH_MADNESS_DB_SLUGS.has("howard")).toBe(true);
    expect(MARCH_MADNESS_DB_SLUGS.has("texas")).toBe(true);
    expect(MARCH_MADNESS_DB_SLUGS.has("nc_state")).toBe(true);
  });

  it("should include all 1-seeds", () => {
    expect(MARCH_MADNESS_DB_SLUGS.has("duke")).toBe(true); // East 1
    expect(MARCH_MADNESS_DB_SLUGS.has("florida")).toBe(true); // South 1
    expect(MARCH_MADNESS_DB_SLUGS.has("arizona")).toBe(true); // West 1
    expect(MARCH_MADNESS_DB_SLUGS.has("michigan")).toBe(true); // Midwest 1
  });

  it("should include all 2-seeds", () => {
    expect(MARCH_MADNESS_DB_SLUGS.has("connecticut")).toBe(true); // East 2
    expect(MARCH_MADNESS_DB_SLUGS.has("houston")).toBe(true); // South 2
    expect(MARCH_MADNESS_DB_SLUGS.has("purdue")).toBe(true); // West 2
    expect(MARCH_MADNESS_DB_SLUGS.has("iowa_st")).toBe(true); // Midwest 2
  });

  it("should NOT include non-March Madness NCAAM teams", () => {
    // Conference tournament teams that appear in the DB but are NOT in the bracket
    expect(MARCH_MADNESS_DB_SLUGS.has("navy")).toBe(false);
    expect(MARCH_MADNESS_DB_SLUGS.has("wake_forest")).toBe(false);
    expect(MARCH_MADNESS_DB_SLUGS.has("dayton")).toBe(false);
    expect(MARCH_MADNESS_DB_SLUGS.has("bradley")).toBe(false);
    expect(MARCH_MADNESS_DB_SLUGS.has("st_josephs")).toBe(false);
    expect(MARCH_MADNESS_DB_SLUGS.has("colorado_st")).toBe(false);
    expect(MARCH_MADNESS_DB_SLUGS.has("illinois_chicago")).toBe(false);
    expect(MARCH_MADNESS_DB_SLUGS.has("california")).toBe(false);
    expect(MARCH_MADNESS_DB_SLUGS.has("murray_st")).toBe(false);
    expect(MARCH_MADNESS_DB_SLUGS.has("nevada")).toBe(false);
  });
});

describe("isMarchMadnessGame", () => {
  it("should return true for First Four Game 1: Prairie View A&M vs Lehigh", () => {
    expect(isMarchMadnessGame("prairie_view_a_and_m", "lehigh")).toBe(true);
  });

  it("should return true for First Four Game 2: Miami OH vs SMU", () => {
    expect(isMarchMadnessGame("miami_oh", "smu")).toBe(true);
  });

  it("should return true for a main bracket matchup", () => {
    expect(isMarchMadnessGame("duke", "siena")).toBe(true);
    expect(isMarchMadnessGame("michigan", "howard")).toBe(true);
  });

  it("should return false if either team is not in the bracket", () => {
    expect(isMarchMadnessGame("navy", "duke")).toBe(false);
    expect(isMarchMadnessGame("duke", "wake_forest")).toBe(false);
    expect(isMarchMadnessGame("dayton", "bradley")).toBe(false);
  });

  it("should return false if both teams are not in the bracket", () => {
    expect(isMarchMadnessGame("navy", "wake_forest")).toBe(false);
    expect(isMarchMadnessGame("murray_st", "nevada")).toBe(false);
  });
});
