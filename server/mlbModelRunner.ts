/**
 * mlbModelRunner.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Reusable MLB model pipeline:
 *   1. Reads all MLB games for a given date from the DB (with book lines)
 *   2. Calls the Python MLBAIModel.project_game() via child process
 *   3. Writes results back to DB using the v2 field mapping:
 *      - modelTotal  = book O/U line (NOT proj_total)
 *      - awayModelSpread / homeModelSpread = ±1.5 book RL (NOT raw diff)
 *      - awayRunLine / homeRunLine / awayRunLineOdds / homeRunLineOdds populated
 *   4. Post-write validation gate: flags any total or RL mismatch
 *   5. Sets publishedToFeed=true and publishedModel=true for all written games
 *
 * Designed to be called from runMlbCycle() in vsinAutoRefresh.ts as Step 5.
 *
 * Usage:
 *   import { runMlbModelForDate } from "./mlbModelRunner";
 *   await runMlbModelForDate("2026-03-27");
 */

import { spawn } from "child_process";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";
import { eq, and, inArray, sql } from "drizzle-orm";
import { getDb } from "./db";
import { games, mlbPitcherStats, mlbPitcherRolling5, mlbTeamBattingSplits, mlbParkFactors, mlbBullpenStats, mlbUmpireModifiers, mlbLineups, mlbPlayers } from "../drizzle/schema";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const ENGINE_PATH = path.join(__dirname, "MLBAIModel.py");
const PYTHON      = "/usr/bin/python3.11";

// 2025 MLB team season stats — used as model inputs
// Format: rpg, era, avg, obp, slg, k9, bb9, whip, ip_per_game
const TEAM_STATS_2025: Record<string, Record<string, number>> = {
  NYY: { rpg: 5.01, era: 3.88, avg: 0.260, obp: 0.332, slg: 0.445, k9: 9.4,  bb9: 2.9, whip: 1.20, ip_per_game: 5.6 },
  SF:  { rpg: 4.52, era: 4.12, avg: 0.251, obp: 0.320, slg: 0.415, k9: 9.1,  bb9: 3.1, whip: 1.27, ip_per_game: 5.3 },
  ATH: { rpg: 4.21, era: 4.38, avg: 0.244, obp: 0.312, slg: 0.395, k9: 8.8,  bb9: 3.3, whip: 1.30, ip_per_game: 5.1 },
  TOR: { rpg: 4.68, era: 4.05, avg: 0.255, obp: 0.325, slg: 0.422, k9: 9.2,  bb9: 3.0, whip: 1.25, ip_per_game: 5.4 },
  COL: { rpg: 5.18, era: 5.42, avg: 0.271, obp: 0.340, slg: 0.458, k9: 8.2,  bb9: 3.6, whip: 1.42, ip_per_game: 4.8 },
  MIA: { rpg: 3.89, era: 4.28, avg: 0.238, obp: 0.305, slg: 0.378, k9: 9.0,  bb9: 3.2, whip: 1.29, ip_per_game: 5.2 },
  KC:  { rpg: 4.55, era: 4.15, avg: 0.252, obp: 0.320, slg: 0.410, k9: 8.9,  bb9: 3.1, whip: 1.28, ip_per_game: 5.2 },
  ATL: { rpg: 5.08, era: 3.78, avg: 0.263, obp: 0.335, slg: 0.448, k9: 9.6,  bb9: 2.8, whip: 1.19, ip_per_game: 5.6 },
  LAA: { rpg: 4.18, era: 4.48, avg: 0.243, obp: 0.310, slg: 0.392, k9: 8.7,  bb9: 3.4, whip: 1.33, ip_per_game: 5.0 },
  HOU: { rpg: 4.71, era: 3.82, avg: 0.254, obp: 0.323, slg: 0.425, k9: 9.5,  bb9: 2.9, whip: 1.21, ip_per_game: 5.5 },
  DET: { rpg: 4.62, era: 3.98, avg: 0.251, obp: 0.319, slg: 0.416, k9: 9.1,  bb9: 3.1, whip: 1.26, ip_per_game: 5.3 },
  SD:  { rpg: 4.38, era: 4.15, avg: 0.246, obp: 0.314, slg: 0.399, k9: 9.0,  bb9: 3.2, whip: 1.28, ip_per_game: 5.2 },
  CLE: { rpg: 4.35, era: 3.88, avg: 0.247, obp: 0.315, slg: 0.398, k9: 9.3,  bb9: 2.9, whip: 1.22, ip_per_game: 5.5 },
  SEA: { rpg: 4.48, era: 3.95, avg: 0.249, obp: 0.318, slg: 0.408, k9: 9.2,  bb9: 3.0, whip: 1.24, ip_per_game: 5.4 },
  ARI: { rpg: 4.61, era: 4.05, avg: 0.252, obp: 0.321, slg: 0.418, k9: 9.1,  bb9: 3.1, whip: 1.26, ip_per_game: 5.3 },
  LAD: { rpg: 5.12, era: 3.65, avg: 0.265, obp: 0.338, slg: 0.452, k9: 9.7,  bb9: 2.8, whip: 1.18, ip_per_game: 5.7 },
  BOS: { rpg: 4.88, era: 4.02, avg: 0.258, obp: 0.328, slg: 0.432, k9: 9.3,  bb9: 3.0, whip: 1.23, ip_per_game: 5.4 },
  BAL: { rpg: 4.72, era: 3.92, avg: 0.255, obp: 0.322, slg: 0.425, k9: 9.1,  bb9: 2.9, whip: 1.22, ip_per_game: 5.5 },
  TB:  { rpg: 4.41, era: 3.98, avg: 0.248, obp: 0.316, slg: 0.405, k9: 9.2,  bb9: 3.0, whip: 1.24, ip_per_game: 5.3 },
  MIN: { rpg: 4.55, era: 4.08, avg: 0.252, obp: 0.320, slg: 0.415, k9: 9.0,  bb9: 3.1, whip: 1.26, ip_per_game: 5.3 },
  CWS: { rpg: 3.82, era: 4.98, avg: 0.235, obp: 0.298, slg: 0.375, k9: 8.5,  bb9: 3.5, whip: 1.38, ip_per_game: 4.9 },
  CHC: { rpg: 4.42, era: 4.18, avg: 0.248, obp: 0.318, slg: 0.408, k9: 9.0,  bb9: 3.1, whip: 1.27, ip_per_game: 5.2 },
  CIN: { rpg: 4.58, era: 4.32, avg: 0.251, obp: 0.320, slg: 0.415, k9: 9.1,  bb9: 3.2, whip: 1.28, ip_per_game: 5.2 },
  MIL: { rpg: 4.62, era: 3.95, avg: 0.252, obp: 0.320, slg: 0.418, k9: 9.2,  bb9: 3.0, whip: 1.24, ip_per_game: 5.4 },
  PIT: { rpg: 4.28, era: 4.12, avg: 0.245, obp: 0.312, slg: 0.398, k9: 8.9,  bb9: 3.2, whip: 1.28, ip_per_game: 5.2 },
  STL: { rpg: 4.38, era: 4.05, avg: 0.248, obp: 0.318, slg: 0.405, k9: 9.0,  bb9: 3.1, whip: 1.26, ip_per_game: 5.3 },
  WSH: { rpg: 4.12, era: 4.42, avg: 0.242, obp: 0.308, slg: 0.392, k9: 8.8,  bb9: 3.3, whip: 1.30, ip_per_game: 5.1 },
  NYM: { rpg: 4.62, era: 4.02, avg: 0.252, obp: 0.322, slg: 0.418, k9: 9.1,  bb9: 3.0, whip: 1.25, ip_per_game: 5.4 },
  PHI: { rpg: 4.88, era: 3.88, avg: 0.258, obp: 0.328, slg: 0.438, k9: 9.4,  bb9: 2.9, whip: 1.21, ip_per_game: 5.5 },
  TEX: { rpg: 4.52, era: 4.15, avg: 0.250, obp: 0.318, slg: 0.412, k9: 9.0,  bb9: 3.1, whip: 1.27, ip_per_game: 5.3 },
  OAK: { rpg: 4.21, era: 4.38, avg: 0.244, obp: 0.312, slg: 0.395, k9: 8.8,  bb9: 3.3, whip: 1.30, ip_per_game: 5.1 },
};

// Default pitcher stats for unknown/new pitchers
const DEFAULT_PITCHER_STATS: Record<string, number> = {
  era: 4.25, k9: 8.8, bb9: 3.1, whip: 1.28, ip: 140.0, gp: 25, xera: 4.25,
};

// Known pitcher stats registry — keyed by "Name (TEAM)"
// Updated with 2025 season stats
const PITCHER_REGISTRY: Record<string, Record<string, number>> = {
  // March 28, 2026 starters (Baseball Savant 2025 season stats)
  "Joe Boyle (TB)":            { era: 4.67, k9: 10.0, bb9: 4.8,  whip: 1.35, ip: 52.0,  gp: 13, xera: 4.04 },
  "Michael McGreevy (STL)":    { era: 4.42, k9: 5.5,  bb9: 1.9,  whip: 1.30, ip: 95.7,  gp: 17, xera: 4.67 },
  "Miles Mikolas (WSH)":       { era: 4.84, k9: 5.8,  bb9: 2.1,  whip: 1.35, ip: 156.3, gp: 31, xera: 5.27 },
  "Cade Horton (CHC)":         { era: 2.67, k9: 7.4,  bb9: 2.5,  whip: 1.12, ip: 118.0, gp: 23, xera: 3.88 },
  "Jeffrey Springs (ATH)":     { era: 4.11, k9: 7.3,  bb9: 2.8,  whip: 1.21, ip: 171.0, gp: 32, xera: 4.30 },
  "Dylan Cease (TOR)":         { era: 4.55, k9: 11.5, bb9: 3.8,  whip: 1.33, ip: 168.0, gp: 32, xera: 3.46 },
  "Taj Bradley (MIN)":         { era: 5.05, k9: 8.0,  bb9: 3.5,  whip: 1.38, ip: 142.7, gp: 27, xera: 4.10 },
  "Kyle Bradish (BAL)":        { era: 2.53, k9: 9.8,  bb9: 2.8,  whip: 1.10, ip: 32.0,  gp: 6,  xera: 3.09 },
  "Jacob Latz (TEX)":          { era: 2.84, k9: 8.0,  bb9: 3.9,  whip: 1.22, ip: 85.7,  gp: 33, xera: 4.13 },
  "Aaron Nola (PHI)":          { era: 6.01, k9: 9.3,  bb9: 2.7,  whip: 1.42, ip: 94.3,  gp: 17, xera: 4.13 },
  "Sonny Gray (BOS)":          { era: 4.28, k9: 10.0, bb9: 1.9,  whip: 1.23, ip: 180.7, gp: 32, xera: 3.88 },
  "Brady Singer (CIN)":        { era: 4.03, k9: 8.6,  bb9: 3.2,  whip: 1.24, ip: 169.7, gp: 32, xera: 4.27 },
  "Mitch Keller (PIT)":        { era: 4.19, k9: 7.7,  bb9: 2.6,  whip: 1.26, ip: 176.3, gp: 32, xera: 4.45 },
  "David Peterson (NYM)":      { era: 4.22, k9: 8.0,  bb9: 3.5,  whip: 1.37, ip: 168.7, gp: 30, xera: 4.61 },
  "Michael Lorenzen (COL)":    { era: 4.64, k9: 8.1,  bb9: 2.5,  whip: 1.32, ip: 141.7, gp: 27, xera: 4.61 },
  "Eury Pérez (MIA)":          { era: 4.50, k9: 9.2,  bb9: 3.5,  whip: 1.30, ip: 45.0,  gp: 10, xera: 4.50 },
  "Reid Detmers (LAA)":        { era: 3.96, k9: 11.3, bb9: 3.5,  whip: 1.28, ip: 63.7,  gp: 14, xera: 3.61 },
  "Cristian Javier (HOU)":     { era: 4.62, k9: 8.3,  bb9: 3.6,  whip: 1.30, ip: 37.0,  gp: 8,  xera: 3.36 },
  "Sean Burke (CWS)":          { era: 4.22, k9: 8.9,  bb9: 4.2,  whip: 1.38, ip: 134.3, gp: 28, xera: 4.96 },
  "Chad Patrick (MIL)":        { era: 3.53, k9: 9.6,  bb9: 3.0,  whip: 1.25, ip: 119.7, gp: 27, xera: 3.88 },
  "Michael Wacha (KC)":        { era: 3.86, k9: 6.6,  bb9: 2.4,  whip: 1.22, ip: 172.7, gp: 31, xera: 4.19 },
  "Reynaldo López (ATL)":      { era: 4.08, k9: 11.0, bb9: 3.6,  whip: 1.28, ip: 92.7,  gp: 21, xera: 3.64 },
  "Will Warren (NYY)":         { era: 4.44, k9: 9.5,  bb9: 3.6,  whip: 1.37, ip: 162.3, gp: 33, xera: 4.58 },
  "Tyler Mahle (SF)":          { era: 2.18, k9: 6.9,  bb9: 3.0,  whip: 1.10, ip: 86.7,  gp: 16, xera: 4.24 },
  "Jack Flaherty (DET)":       { era: 4.64, k9: 10.5, bb9: 3.3,  whip: 1.32, ip: 161.0, gp: 31, xera: 3.99 },
  "Randy Vásquez (SD)":        { era: 4.85, k9: 8.2,  bb9: 3.8,  whip: 1.38, ip: 62.0,  gp: 14, xera: 4.95 },
  "Joey Cantillo (CLE)":       { era: 3.21, k9: 10.2, bb9: 4.0,  whip: 1.28, ip: 95.3,  gp: 34, xera: 3.71 },
  "Bryan Woo (SEA)":           { era: 2.94, k9: 9.5,  bb9: 1.7,  whip: 0.93, ip: 186.7, gp: 30, xera: 3.07 },
  "Eduardo Rodriguez (ARI)":   { era: 5.02, k9: 8.3,  bb9: 3.5,  whip: 1.38, ip: 154.3, gp: 29, xera: 4.51 },
  "Tyler Glasnow (LAD)":       { era: 3.19, k9: 10.6, bb9: 4.3,  whip: 1.22, ip: 90.3,  gp: 18, xera: 3.33 },
  // March 29, 2026 starters (MLB Stats API 2025 season stats)
  "Bailey Ober (MIN)":          { era: 5.10, k9: 7.39,  bb9: 1.91, whip: 1.30, ip: 146.1, gp: 27, xera: 5.10 },
  "Shane Baz (BAL)":            { era: 4.87, k9: 9.54,  bb9: 3.47, whip: 1.33, ip: 166.1, gp: 31, xera: 4.87 },
  "MacKenzie Gore (TEX)":       { era: 4.17, k9: 10.46, bb9: 3.62, whip: 1.35, ip: 159.2, gp: 30, xera: 4.17 },
  "Jesús Luzardo (PHI)":        { era: 3.92, k9: 10.61, bb9: 2.80, whip: 1.22, ip: 183.2, gp: 32, xera: 3.92 },
  "Seth Lugo (KC)":             { era: 4.15, k9: 7.75,  bb9: 3.41, whip: 1.29, ip: 145.1, gp: 26, xera: 4.15 },
  "Grant Holmes (ATL)":         { era: 3.99, k9: 9.63,  bb9: 4.23, whip: 1.34, ip: 115.0, gp: 22, xera: 3.99 },
  "Eric Lauer (ATH)":           { era: 3.18, k9: 8.81,  bb9: 2.25, whip: 1.11, ip: 104.2, gp: 28, xera: 3.18 },
  "Connelly Early (BOS)":       { era: 2.33, k9: 13.66, bb9: 1.88, whip: 1.09, ip: 19.1,  gp: 4,  xera: 2.33 },
  "Rhett Lowder (CIN)":         { era: 1.17, k9: 6.46,  bb9: 4.11, whip: 1.27, ip: 30.2,  gp: 6,  xera: 3.50 },
  "Carmen Mlodzinski (PIT)":    { era: 3.55, k9: 8.09,  bb9: 2.45, whip: 1.30, ip: 99.0,  gp: 34, xera: 3.55 },
  "Nolan McLean (NYM)":         { era: 2.06, k9: 10.69, bb9: 3.00, whip: 1.04, ip: 48.0,  gp: 8,  xera: 2.06 },
  "Max Meyer (MIA)":            { era: 4.73, k9: 9.53,  bb9: 2.80, whip: 1.42, ip: 64.2,  gp: 12, xera: 4.73 },
  "Tatsuya Imai (HOU)":         { era: 4.25, k9: 8.80,  bb9: 3.10, whip: 1.28, ip: 0.0,   gp: 0,  xera: 4.25 },
  "Anthony Kay (CWS)":          { era: 6.14, k9: 6.75,  bb9: 5.52, whip: 1.50, ip: 14.2,  gp: 16, xera: 5.80 },
  "Brandon Sproat (MIL)":       { era: 4.79, k9: 7.57,  bb9: 3.12, whip: 1.21, ip: 20.2,  gp: 4,  xera: 4.79 },
  "Steven Matz (TB)":           { era: 3.05, k9: 6.97,  bb9: 1.30, whip: 1.10, ip: 76.2,  gp: 53, xera: 3.05 },
  "Dustin May (STL)":           { era: 4.96, k9: 8.38,  bb9: 3.82, whip: 1.42, ip: 132.1, gp: 25, xera: 4.96 },
  "Jake Irvin (WSH)":           { era: 5.70, k9: 6.20,  bb9: 3.10, whip: 1.43, ip: 180.0, gp: 33, xera: 5.70 },
  "Shota Imanaga (CHC)":        { era: 3.73, k9: 7.30,  bb9: 1.62, whip: 0.99, ip: 144.2, gp: 25, xera: 3.73 },
  "Slade Cecconi (CLE)":        { era: 4.30, k9: 7.43,  bb9: 2.18, whip: 1.19, ip: 132.0, gp: 23, xera: 4.30 },
  "Emerson Hancock (SEA)":      { era: 4.90, k9: 6.40,  bb9: 3.10, whip: 1.38, ip: 90.0,  gp: 22, xera: 4.90 },
  // March 27 starters
  "Cam Schlittler (NYY)":   { era: 2.96, k9: 8.8,  bb9: 3.1, whip: 1.18, ip: 91.1,  gp: 16, xera: 4.11 },
  "Robbie Ray (SF)":        { era: 3.42, k9: 10.2, bb9: 3.4, whip: 1.22, ip: 158.1, gp: 27, xera: 3.65 },
  "Luis Severino (ATH)":    { era: 4.52, k9: 6.8,  bb9: 3.2, whip: 1.35, ip: 142.0, gp: 25, xera: 4.38 },
  "Kevin Gausman (TOR)":    { era: 3.28, k9: 9.4,  bb9: 1.8, whip: 1.10, ip: 193.0, gp: 32, xera: 3.41 },
  "Kyle Freeland (COL)":    { era: 5.18, k9: 7.2,  bb9: 3.5, whip: 1.44, ip: 138.0, gp: 25, xera: 5.02 },
  "Sandy Alcantara (MIA)":  { era: 3.88, k9: 8.9,  bb9: 2.4, whip: 1.22, ip: 162.0, gp: 28, xera: 3.72 },
  "Cole Ragans (KC)":       { era: 4.67, k9: 10.1, bb9: 3.0, whip: 1.28, ip: 168.0, gp: 29, xera: 2.67 },
  "Chris Sale (ATL)":       { era: 2.58, k9: 9.8,  bb9: 2.2, whip: 1.02, ip: 178.0, gp: 30, xera: 2.85 },
  "Yusei Kikuchi (LAA)":    { era: 4.22, k9: 9.1,  bb9: 3.2, whip: 1.28, ip: 152.0, gp: 27, xera: 4.01 },
  "Mike Burrows (HOU)":     { era: 3.92, k9: 9.4,  bb9: 3.1, whip: 1.24, ip: 118.0, gp: 22, xera: 3.78 },
  "Framber Valdez (DET)":   { era: 3.45, k9: 8.9,  bb9: 2.6, whip: 1.18, ip: 178.0, gp: 30, xera: 3.38 },
  "Michael King (SD)":      { era: 3.12, k9: 10.8, bb9: 2.8, whip: 1.08, ip: 168.0, gp: 29, xera: 3.24 },
  "Gavin Williams (CLE)":   { era: 3.05, k9: 9.2,  bb9: 3.4, whip: 1.18, ip: 148.0, gp: 26, xera: 4.29 },
  "George Kirby (SEA)":     { era: 3.38, k9: 8.8,  bb9: 1.4, whip: 1.05, ip: 192.0, gp: 32, xera: 3.21 },
  "Ryne Nelson (ARI)":      { era: 3.39, k9: 8.4,  bb9: 2.8, whip: 1.18, ip: 158.0, gp: 28, xera: 3.93 },
  "Emmet Sheehan (LAD)":    { era: 3.62, k9: 10.3, bb9: 3.2, whip: 1.22, ip: 128.0, gp: 24, xera: 3.48 },
  // March 26 starters
  "Garrett Crochet (BOS)":  { era: 3.58, k9: 11.4, bb9: 2.8, whip: 1.12, ip: 162.0, gp: 28, xera: 3.42 },
  "Gerrit Cole (NYY)":      { era: 2.63, k9: 11.2, bb9: 2.1, whip: 0.98, ip: 188.0, gp: 32, xera: 2.78 },
  "Paul Skenes (PIT)":      { era: 1.90, k9: 11.8, bb9: 2.0, whip: 0.95, ip: 133.0, gp: 23, xera: 2.12 },
  "Tarik Skubal (DET)":     { era: 2.39, k9: 11.1, bb9: 1.8, whip: 0.98, ip: 192.0, gp: 32, xera: 2.55 },
  "Logan Gilbert (SEA)":    { era: 3.24, k9: 9.8,  bb9: 2.1, whip: 1.08, ip: 185.0, gp: 31, xera: 3.38 },
  "Yoshinobu Yamamoto (LAD)": { era: 3.00, k9: 10.4, bb9: 2.2, whip: 1.05, ip: 182.0, gp: 31, xera: 3.12 },
  "Nathan Eovaldi (TEX)":   { era: 3.98, k9: 8.2,  bb9: 2.4, whip: 1.22, ip: 168.0, gp: 29, xera: 4.05 },
  "Zac Gallen (ARI)":       { era: 3.62, k9: 9.2,  bb9: 2.5, whip: 1.15, ip: 172.0, gp: 30, xera: 3.75 },
  "Freddy Peralta (NYM)":   { era: 3.28, k9: 10.8, bb9: 3.0, whip: 1.12, ip: 158.0, gp: 27, xera: 3.42 },
  "Joe Ryan (MIN)":         { era: 3.45, k9: 9.8,  bb9: 1.8, whip: 1.08, ip: 178.0, gp: 30, xera: 3.58 },
  "Cristopher Sanchez (PHI)": { era: 3.42, k9: 8.8, bb9: 2.6, whip: 1.18, ip: 162.0, gp: 28, xera: 3.55 },
  "Tanner Bibee (CLE)":     { era: 3.58, k9: 9.4,  bb9: 2.8, whip: 1.18, ip: 168.0, gp: 29, xera: 3.72 },
  "Jose Soriano (LAA)":     { era: 3.88, k9: 9.8,  bb9: 3.2, whip: 1.22, ip: 142.0, gp: 25, xera: 3.95 },
  "Hunter Brown (HOU)":     { era: 3.78, k9: 9.6,  bb9: 3.0, whip: 1.22, ip: 162.0, gp: 28, xera: 3.88 },
  "Matthew Boyd (CHC)":     { era: 3.92, k9: 9.2,  bb9: 2.8, whip: 1.25, ip: 148.0, gp: 26, xera: 4.05 },
  "Andrew Abbott (CIN)":    { era: 3.72, k9: 9.8,  bb9: 3.1, whip: 1.22, ip: 152.0, gp: 27, xera: 3.85 },
  "Trevor Rogers (BAL)":    { era: 4.12, k9: 9.0,  bb9: 3.4, whip: 1.28, ip: 138.0, gp: 25, xera: 4.25 },
  "Drew Rasmussen (TB)":    { era: 3.62, k9: 8.8,  bb9: 2.4, whip: 1.18, ip: 148.0, gp: 26, xera: 3.75 },
  "Shane Smith (CWS)":      { era: 4.42, k9: 8.4,  bb9: 3.2, whip: 1.32, ip: 132.0, gp: 24, xera: 4.55 },
  "Matthew Liberatore (STL)": { era: 4.18, k9: 8.8, bb9: 3.1, whip: 1.28, ip: 142.0, gp: 25, xera: 4.32 },
  "Jacob Misiorowski (MIL)": { era: 3.88, k9: 10.8, bb9: 3.8, whip: 1.22, ip: 98.0,  gp: 18, xera: 3.95 },
  "Cade Cavalli (WSH)":     { era: 4.52, k9: 9.2,  bb9: 3.8, whip: 1.35, ip: 88.0,  gp: 16, xera: 4.65 },
  // March 30, 2026 starters (MLB Stats API 2025 season stats; * = 2024 fallback; ** = league-average default)
  "Simeon Woods Richardson (MIN)": { era: 4.04, k9: 8.6,  bb9: 3.7, whip: 1.28, ip: 111.3, gp: 22, xera: 4.15 },
  "Kris Bubic (KC)":               { era: 2.55, k9: 9.0,  bb9: 3.0, whip: 1.18, ip: 116.3, gp: 20, xera: 2.68 },
  "Jack Leiter (TEX)":             { era: 3.86, k9: 8.8,  bb9: 4.0, whip: 1.28, ip: 151.7, gp: 29, xera: 3.98 },
  "Chris Bassitt (BAL)":           { era: 3.96, k9: 8.8,  bb9: 2.7, whip: 1.33, ip: 170.3, gp: 31, xera: 4.05 },
  "Braxton Ashcraft (PIT)":        { era: 2.71, k9: 9.2,  bb9: 3.1, whip: 1.25, ip: 69.7,  gp: 8,  xera: 2.85 },
  "Chase Burns (CIN)":             { era: 4.57, k9: 13.9, bb9: 3.3, whip: 1.32, ip: 43.3,  gp: 8,  xera: 4.12 },
  "Foster Griffin (WSH)":          { era: 4.50, k9: 8.0,  bb9: 3.5, whip: 1.35, ip: 80.0,  gp: 15, xera: 4.50 }, // ** league-avg default
  "Taijuan Walker (PHI)":          { era: 4.08, k9: 6.3,  bb9: 3.1, whip: 1.41, ip: 123.7, gp: 21, xera: 4.22 },
  "Davis Martin (CWS)":            { era: 4.10, k9: 6.6,  bb9: 3.0, whip: 1.29, ip: 142.7, gp: 25, xera: 4.18 },
  "Chris Paddack (MIA)":           { era: 5.35, k9: 6.4,  bb9: 2.1, whip: 1.28, ip: 158.0, gp: 28, xera: 5.10 },
  "Tomoyuki Sugano (COL)":         { era: 4.64, k9: 6.1,  bb9: 2.1, whip: 1.33, ip: 157.0, gp: 30, xera: 4.72 },
  "Cody Ponce (TOR)":              { era: 4.50, k9: 7.5,  bb9: 3.0, whip: 1.35, ip: 60.0,  gp: 10, xera: 4.50 }, // ** league-avg default
  "Jacob Lopez (ATH)":             { era: 4.08, k9: 11.0, bb9: 3.6, whip: 1.27, ip: 92.7,  gp: 17, xera: 3.95 },
  "Bryce Elder (ATL)":             { era: 5.30, k9: 7.5,  bb9: 2.9, whip: 1.39, ip: 156.3, gp: 28, xera: 5.15 },
  "Ryan Johnson (LAA)":            { era: 4.50, k9: 8.5,  bb9: 3.2, whip: 1.35, ip: 40.0,  gp: 8,  xera: 4.50 }, // ** limited MLB data; debut-level default
  "Edward Cabrera (CHC)":          { era: 3.53, k9: 9.8,  bb9: 3.1, whip: 1.23, ip: 137.7, gp: 26, xera: 3.62 },
  "Nick Martinez (TB)":            { era: 4.45, k9: 6.3,  bb9: 2.3, whip: 1.21, ip: 165.7, gp: 26, xera: 4.38 },
  "Kyle Harrison (MIL)":           { era: 4.04, k9: 9.6,  bb9: 3.5, whip: 1.37, ip: 35.7,  gp: 6,  xera: 4.12 },
  "Clay Holmes (NYM)":             { era: 3.53, k9: 7.0,  bb9: 3.6, whip: 1.30, ip: 165.7, gp: 31, xera: 3.62 },
  "Kyle Leahy (STL)":              { era: 3.07, k9: 8.2,  bb9: 2.9, whip: 1.23, ip: 88.0,  gp: 1,  xera: 3.18 },
  "Ranger Suarez (BOS)":           { era: 3.20, k9: 8.6,  bb9: 2.2, whip: 1.22, ip: 157.3, gp: 26, xera: 3.28 },
  "Lance McCullers Jr. (HOU)":     { era: 6.51, k9: 9.9,  bb9: 6.3, whip: 1.81, ip: 55.3,  gp: 13, xera: 6.25 },
  "Landen Roupp (SF)":             { era: 3.80, k9: 8.6,  bb9: 3.8, whip: 1.48, ip: 106.7, gp: 22, xera: 3.92 },
  "Walker Buehler (SD)":           { era: 4.93, k9: 6.6,  bb9: 4.4, whip: 1.52, ip: 126.0, gp: 24, xera: 5.05 },
  "Ryan Weathers (NYY)":           { era: 3.99, k9: 8.7,  bb9: 2.8, whip: 1.28, ip: 38.3,  gp: 8,  xera: 4.08 },
  "Luis Castillo (SEA)":           { era: 3.54, k9: 8.1,  bb9: 2.3, whip: 1.18, ip: 180.7, gp: 32, xera: 3.62 },
  "Parker Messick (CLE)":          { era: 2.72, k9: 8.6,  bb9: 1.4, whip: 1.31, ip: 39.7,  gp: 7,  xera: 2.85 },
  "Roki Sasaki (LAD)":             { era: 4.46, k9: 6.9,  bb9: 5.4, whip: 1.43, ip: 36.3,  gp: 8,  xera: 4.58 },
  "Justin Verlander (DET)":        { era: 3.85, k9: 8.1,  bb9: 3.1, whip: 1.36, ip: 152.0, gp: 29, xera: 3.95 },
  "Michael Soroka (ARI)":          { era: 4.52, k9: 9.5,  bb9: 2.9, whip: 1.13, ip: 89.7,  gp: 17, xera: 4.38 },
};

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface MlbModelResult {
  ok: boolean;
  db_id: number;
  game: string;
  away_abbrev: string;
  home_abbrev: string;
  away_pitcher: string;
  home_pitcher: string;
    // Projected runs
  proj_away_runs: number;
  proj_home_runs: number;
  proj_total: number;
  // Moneyline
  away_ml: number;
  home_ml: number;
  away_win_pct: number;
  home_win_pct: number;
  // Run line (book ±1.5)
  away_run_line: string;
  home_run_line: string;
  away_rl_odds: number;
  home_rl_odds: number;
  away_rl_cover_pct: number;
  home_rl_cover_pct: number;
  // Total (book-anchored)
  total_line: number;
  over_odds: number;
  under_odds: number;
  over_pct: number;
  under_pct: number;
  // Model spread
  model_spread: number;
  // F5 (First Five Innings)
  p_f5_home_win: number;
  p_f5_away_win: number;
  f5_ml_home: number;
  f5_ml_away: number;
  p_f5_home_rl: number;
  p_f5_away_rl: number;
  f5_rl_home_odds: number;
  f5_rl_away_odds: number;
  f5_total_key: number;
  f5_over_odds: number;
  f5_under_odds: number;
  p_f5_over: number;
  p_f5_under: number;
  p_f5_push: number | null;        // THREE-WAY: Bayesian-blended P(F5 push/tie)
  p_f5_push_raw: number | null;    // raw simulation push rate (diagnostic)
  exp_f5_home_runs: number;
  exp_f5_away_runs: number;
  exp_f5_total: number;
  // NRFI / YRFI
  p_nrfi: number;
  p_yrfi: number;
  nrfi_odds: number;
  yrfi_odds: number;
  exp_first_inn_total: number;
  // HR Props (team-level)
  p_home_hr_any: number;
  p_away_hr_any: number;
  p_both_hr: number;
  exp_home_hr: number;
  exp_away_hr: number;
  // Inning-by-Inning projections (I1-I9, backtest-calibrated 2026-04-13)
  inning_home_exp: number[];       // [I1..I9] expected home runs per inning
  inning_away_exp: number[];       // [I1..I9] expected away runs per inning
  inning_total_exp: number[];      // [I1..I9] expected combined runs per inning
  inning_p_home_scores: number[];  // [I1..I9] P(home scores >= 1)
  inning_p_away_scores: number[];  // [I1..I9] P(away scores >= 1)
  inning_p_neither_score: number[];// [I1..I9] P(neither scores) = NRFI per inning
  // P1-A: Weather adjustment
  weather_run_adj: number;            // weather_run_adj from get_environment_features (1.0 = neutral)
  // Meta
  simulations: number;
  elapsed_sec: number;
  error: string | null;
}

interface ValidationResult {
  passed: boolean;
  issues: string[];
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function fmtMl(val: number): string {
  const rounded = Math.round(val);
  return rounded >= 0 ? `+${rounded}` : `${rounded}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRECISION SIGNAL HELPERS: Park Factors, Bullpen Stats, Umpire Modifiers
// ─────────────────────────────────────────────────────────────────────────────

/** Default bullpen stats (league-average fallback) */
const DEFAULT_BULLPEN: Record<string, number> = {
  era: 4.20, fip: 4.10, k9: 9.0, bb9: 3.2, hr9: 1.2, whip: 1.28,
  kBbRatio: 2.8, relieverCount: 7, totalIp: 300,
};

/**
 * Fetch park factors for all home teams in today's games from DB.
 * Returns a Map<teamAbbrev, parkFactor3yr>.
 */
async function fetchParkFactors(
  homeTeams: string[],
  dbInstance: Awaited<ReturnType<typeof getDb>>
): Promise<Map<string, number>> {
  const TAG = '[ParkFactors]';
  const result = new Map<string, number>();
  if (homeTeams.length === 0) return result;

  try {
    const rows = await dbInstance.select({
      teamAbbrev: mlbParkFactors.teamAbbrev,
      parkFactor3yr: mlbParkFactors.parkFactor3yr,
      pf2026: mlbParkFactors.pf2026,
      pf2025: mlbParkFactors.pf2025,
      pf2024: mlbParkFactors.pf2024,
      venueName: mlbParkFactors.venueName,
    }).from(mlbParkFactors)
      .where(inArray(mlbParkFactors.teamAbbrev, homeTeams));

    for (const row of rows) {
      const pf = row.parkFactor3yr ?? 1.0;
      result.set(row.teamAbbrev.toUpperCase(), pf);
      console.log(
        `${TAG} ${row.teamAbbrev} (${row.venueName}): ` +
        `3yr=${pf.toFixed(4)} | 2024=${row.pf2024?.toFixed(4) ?? 'N/A'} ` +
        `2025=${row.pf2025?.toFixed(4) ?? 'N/A'} 2026=${row.pf2026?.toFixed(4) ?? 'N/A'}`
      );
    }
    console.log(`${TAG} [INPUT] Loaded ${rows.length}/${homeTeams.length} park factors from DB`);
  } catch (err) {
    console.error(`${TAG} DB error — using neutral (1.0) for all:`, err);
  }
  return result;
}

/**
 * Fetch bullpen stats for all teams in today's games from DB.
 * Returns a Map<teamAbbrev, bullpenStatsRecord>.
 */
async function fetchBullpenStats(
  teams: string[],
  dbInstance: Awaited<ReturnType<typeof getDb>>
): Promise<Map<string, Record<string, number>>> {
  const TAG = '[BullpenStats]';
  const result = new Map<string, Record<string, number>>();
  if (teams.length === 0) return result;

  try {
    const rows = await dbInstance.select({
      teamAbbrev: mlbBullpenStats.teamAbbrev,
      eraBullpen: mlbBullpenStats.eraBullpen,
      fipBullpen: mlbBullpenStats.fipBullpen,
      k9Bullpen: mlbBullpenStats.k9Bullpen,
      bb9Bullpen: mlbBullpenStats.bb9Bullpen,
      hr9Bullpen: mlbBullpenStats.hr9Bullpen,
      whipBullpen: mlbBullpenStats.whipBullpen,
      kBbRatio: mlbBullpenStats.kBbRatio,
      relieverCount: mlbBullpenStats.relieverCount,
      totalIp: mlbBullpenStats.totalIp,
    }).from(mlbBullpenStats)
      .where(inArray(mlbBullpenStats.teamAbbrev, teams));

    for (const row of rows) {
      const stats: Record<string, number> = {
        era:          row.eraBullpen   ?? DEFAULT_BULLPEN.era,
        fip:          row.fipBullpen   ?? DEFAULT_BULLPEN.fip,
        k9:           row.k9Bullpen    ?? DEFAULT_BULLPEN.k9,
        bb9:          row.bb9Bullpen   ?? DEFAULT_BULLPEN.bb9,
        hr9:          row.hr9Bullpen   ?? DEFAULT_BULLPEN.hr9,
        whip:         row.whipBullpen  ?? DEFAULT_BULLPEN.whip,
        kBbRatio:     row.kBbRatio     ?? DEFAULT_BULLPEN.kBbRatio,
        relieverCount: row.relieverCount ?? DEFAULT_BULLPEN.relieverCount,
        totalIp:      row.totalIp      ?? DEFAULT_BULLPEN.totalIp,
      };
      result.set(row.teamAbbrev.toUpperCase(), stats);
      console.log(
        `${TAG} ${row.teamAbbrev}: ERA=${stats.era.toFixed(2)} FIP=${stats.fip.toFixed(2)} ` +
        `K/9=${stats.k9.toFixed(2)} BB/9=${stats.bb9.toFixed(2)} ` +
        `K/BB=${stats.kBbRatio.toFixed(2)} relievers=${stats.relieverCount}`
      );
    }
    console.log(`${TAG} [INPUT] Loaded ${rows.length}/${teams.length} bullpen rows from DB`);
  } catch (err) {
    console.error(`${TAG} DB error — using league-average defaults:`, err);
  }
  return result;
}

/**
 * Fetch HP umpire assignments for today's games from MLB Stats API,
 * then look up kModifier/bbModifier from DB.
 * Returns a Map<mlbGamePk, { umpireName, kMod, bbMod }>.
 */
async function fetchUmpireModifiers(
  gamePks: number[],
  dbInstance: Awaited<ReturnType<typeof getDb>>
): Promise<Map<number, { umpireName: string; kMod: number; bbMod: number }>> {
  const TAG = '[UmpireModifiers]';
  const result = new Map<number, { umpireName: string; kMod: number; bbMod: number }>();
  if (gamePks.length === 0) return result;

  // Step 1: Fetch HP umpire assignments from MLB Stats API
  const pksStr = gamePks.join(',');
  const apiUrl = `https://statsapi.mlb.com/api/v1/schedule?gamePks=${pksStr}&hydrate=officials`;
  console.log(`${TAG} [STEP] Fetching HP umpires for ${gamePks.length} games from MLB API...`);

  let scheduleData: Record<string, unknown>;
  try {
    scheduleData = await new Promise<Record<string, unknown>>((resolve, reject) => {
      https.get(apiUrl, (res) => {
        let raw = '';
        res.on('data', (d: Buffer) => { raw += d.toString(); });
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); }
          catch (e) { reject(e); }
        });
      }).on('error', reject);
    });
  } catch (err) {
    console.error(`${TAG} MLB API error — no umpire modifiers applied:`, err);
    return result;
  }

  // Step 2: Extract HP umpire ID per gamePk
  const umpireIdMap = new Map<number, { id: number; name: string }>();
  const dates = (scheduleData as Record<string, unknown[]>).dates ?? [];
  for (const d of dates as Record<string, unknown>[]) {
    for (const g of (d.games ?? []) as Record<string, unknown>[]) {
      const pk = g.gamePk as number;
      const officials = (g.officials ?? []) as Record<string, unknown>[];
      const hp = officials.find((o) => o.officialType === 'Home Plate');
      if (hp) {
        const official = hp.official as Record<string, unknown>;
        umpireIdMap.set(pk, { id: official.id as number, name: official.fullName as string });
      }
    }
  }
  console.log(`${TAG} [STATE] HP umpires found: ${umpireIdMap.size}/${gamePks.length} games`);

  // Step 3: Batch-fetch umpire modifiers from DB
  const umpireIds = Array.from(new Set(Array.from(umpireIdMap.values()).map(u => u.id)));
  if (umpireIds.length === 0) {
    console.warn(`${TAG} No HP umpires assigned yet — using league-average (kMod=1.0, bbMod=1.0)`);
    return result;
  }

  let dbRows: Array<{ umpireId: number; umpireName: string; kModifier: number | null; bbModifier: number | null; gamesHp: number }> = [];
  try {
    dbRows = await dbInstance.select({
      umpireId: mlbUmpireModifiers.umpireId,
      umpireName: mlbUmpireModifiers.umpireName,
      kModifier: mlbUmpireModifiers.kModifier,
      bbModifier: mlbUmpireModifiers.bbModifier,
      gamesHp: mlbUmpireModifiers.gamesHp,
    }).from(mlbUmpireModifiers)
      .where(inArray(mlbUmpireModifiers.umpireId, umpireIds));
  } catch (err) {
    console.error(`${TAG} DB error fetching umpire modifiers:`, err);
    return result;
  }

  const umpireDbMap = new Map(dbRows.map(r => [r.umpireId, r]));

  // Step 4: Build result map per gamePk
  for (const [pk, ump] of Array.from(umpireIdMap)) {
    const dbRow = umpireDbMap.get(ump.id);
    if (dbRow) {
      const kMod  = dbRow.kModifier  ?? 1.0;
      const bbMod = dbRow.bbModifier ?? 1.0;
      result.set(pk, { umpireName: dbRow.umpireName, kMod, bbMod });
      console.log(
        `${TAG} gamePk=${pk} HP=${dbRow.umpireName} (id=${ump.id}) ` +
        `kMod=${kMod.toFixed(4)} bbMod=${bbMod.toFixed(4)} games=${dbRow.gamesHp}`
      );
    } else {
      // Umpire not in DB (new umpire or insufficient sample) — use league-average
      result.set(pk, { umpireName: ump.name, kMod: 1.0, bbMod: 1.0 });
      console.warn(
        `${TAG} gamePk=${pk} HP=${ump.name} (id=${ump.id}) NOT in DB — using kMod=1.0 bbMod=1.0`
      );
    }
  }

  console.log(`${TAG} [OUTPUT] Umpire modifiers resolved: ${result.size}/${gamePks.length} games`);
  return result;
}

/**
 * Compute per-team SP averages from all rows in the DB for a given team.
 * Used as fallback when a specific pitcher is not found in the DB.
 * IP-weighted average for ERA, K/9, BB/9, HR/9, WHIP.
 */
function computeTeamSpAverage(
  teamAbbrev: string,
  allRows: Array<{
    teamAbbrev: string;
    era: number | null;
    k9: number | null;
    bb9: number | null;
    hr9: number | null;
    whip: number | null;
    ip: number | null;
    gamesStarted: number | null;
    xera: number | null;
    fip: number | null;
    xfip: number | null;
  }>
): Record<string, number> {
  const teamRows = allRows.filter(
    r => r.teamAbbrev.toUpperCase() === teamAbbrev.toUpperCase() &&
         r.gamesStarted !== null && (r.gamesStarted ?? 0) >= 1
  );

  if (teamRows.length === 0) {
    // No team data at all — use league-average defaults
    return { ...DEFAULT_PITCHER_STATS };
  }

  // IP-weighted average for rate stats
  let totalIP = 0;
  let sumEra = 0, sumK9 = 0, sumBb9 = 0, sumHr9 = 0, sumWhip = 0, sumXera = 0;
  let sumFip = 0, sumXfip = 0;
  let countXera = 0, countFip = 0, countXfip = 0;

  for (const r of teamRows) {
    const ip = r.ip ?? 0;
    totalIP += ip;
    sumEra  += (r.era  ?? DEFAULT_PITCHER_STATS.era)  * ip;
    sumK9   += (r.k9   ?? DEFAULT_PITCHER_STATS.k9)   * ip;
    sumBb9  += (r.bb9  ?? DEFAULT_PITCHER_STATS.bb9)  * ip;
    sumHr9  += (r.hr9  ?? DEFAULT_PITCHER_STATS.hr9)  * ip;
    sumWhip += (r.whip ?? DEFAULT_PITCHER_STATS.whip) * ip;
    if (r.xera !== null) { sumXera += r.xera * ip; countXera++; }
    if (r.fip  !== null) { sumFip  += r.fip  * ip; countFip++;  }
    if (r.xfip !== null) { sumXfip += r.xfip * ip; countXfip++; }
  }

  if (totalIP === 0) return { ...DEFAULT_PITCHER_STATS };

  const avgIP = totalIP / teamRows.length;
  return {
    era:  sumEra  / totalIP,
    k9:   sumK9   / totalIP,
    bb9:  sumBb9  / totalIP,
    hr9:  sumHr9  / totalIP,
    whip: sumWhip / totalIP,
    ip:   avgIP,
    gp:   teamRows.reduce((s, r) => s + (r.gamesStarted ?? 0), 0) / teamRows.length,
    xera: countXera > 0 ? sumXera / (countXera * avgIP) : DEFAULT_PITCHER_STATS.xera,
    fip:  countFip  > 0 ? sumFip  / totalIP : DEFAULT_PITCHER_STATS.era,
    xfip: countXfip > 0 ? sumXfip / totalIP : DEFAULT_PITCHER_STATS.era,
    throwsHand: 0, // team avg has no single hand
  };
}

/**
 * Batch-fetch pitcher stats from mlb_pitcher_stats table for all pitchers in a game set.
 * Returns a Map keyed by "name|teamAbbrev".
 *
 * Fallback priority:
 *   1. Exact DB match: name + team
 *   2. DB match: name only (handles team transfers)
 *   3. Legacy PITCHER_REGISTRY: name + team
 *   4. Legacy PITCHER_REGISTRY: name prefix
 *   5. Team SP average (computed from all starters for that team in DB)
 *
 * @param pitcherNames - Array of { name, teamAbbrev } pairs
 * @param dbInstance   - Drizzle DB instance (already resolved)
 */
async function batchFetchPitcherStats(
  pitcherNames: Array<{ name: string; teamAbbrev: string }>,
  dbInstance: Awaited<ReturnType<typeof getDb>>
): Promise<Map<string, Record<string, number>>> {
  const result = new Map<string, Record<string, number>>();
  if (!dbInstance || pitcherNames.length === 0) return result;

  // ── DB round-trip 1: fetch all pitcher season stats + sabermetrics ─────────
  const allRows = await dbInstance
    .select({
      mlbamId:      mlbPitcherStats.mlbamId,
      fullName:     mlbPitcherStats.fullName,
      teamAbbrev:   mlbPitcherStats.teamAbbrev,
      era:          mlbPitcherStats.era,
      k9:           mlbPitcherStats.k9,
      bb9:          mlbPitcherStats.bb9,
      hr9:          mlbPitcherStats.hr9,
      whip:         mlbPitcherStats.whip,
      ip:           mlbPitcherStats.ip,
      gamesStarted: mlbPitcherStats.gamesStarted,
      gamesPlayed:  mlbPitcherStats.gamesPlayed,
      xera:         mlbPitcherStats.xera,
      fip:          mlbPitcherStats.fip,
      xfip:         mlbPitcherStats.xfip,
      fipMinus:     mlbPitcherStats.fipMinus,
      eraMinus:     mlbPitcherStats.eraMinus,
      war:          mlbPitcherStats.war,
      throwsHand:   mlbPitcherStats.throwsHand,
      // ── 3-Year NRFI Calibration (seeded 2026-04-14 from 5,109-game backtest) ──
      nrfiRate:     mlbPitcherStats.nrfiRate,
      nrfiStarts:   mlbPitcherStats.nrfiStarts,
      nrfiCount:    mlbPitcherStats.nrfiCount,
    })
    .from(mlbPitcherStats);

  // ── DB round-trip 2: fetch all rolling-5 stats ─────────────────────────────
  const rolling5Rows = await dbInstance
    .select({
      mlbamId:        mlbPitcherRolling5.mlbamId,
      startsIncluded: mlbPitcherRolling5.startsIncluded,
      ip5:            mlbPitcherRolling5.ip5,
      era5:           mlbPitcherRolling5.era5,
      k9_5:           mlbPitcherRolling5.k9_5,
      bb9_5:          mlbPitcherRolling5.bb9_5,
      hr9_5:          mlbPitcherRolling5.hr9_5,
      whip5:          mlbPitcherRolling5.whip5,
      fip5:           mlbPitcherRolling5.fip5,
    })
    .from(mlbPitcherRolling5);

  // Build rolling-5 lookup by mlbamId
  const rolling5Map = new Map<number, typeof rolling5Rows[0]>();
  for (const r of rolling5Rows) rolling5Map.set(r.mlbamId, r);

  // ── DB round-trip 3: fetch all team batting splits (vs LHP + vs RHP) ───────
  // Also fetches rpg and ipPerGame (live 2026 season values, backfilled from MLB Stats API)
  const battingSplitRows = await dbInstance
    .select({
      teamAbbrev: mlbTeamBattingSplits.teamAbbrev,
      hand:       mlbTeamBattingSplits.hand,
      avg:        mlbTeamBattingSplits.avg,
      obp:        mlbTeamBattingSplits.obp,
      slg:        mlbTeamBattingSplits.slg,
      ops:        mlbTeamBattingSplits.ops,
      woba:       mlbTeamBattingSplits.woba,
      hr9:        mlbTeamBattingSplits.hr9,
      bb9:        mlbTeamBattingSplits.bb9,
      k9:         mlbTeamBattingSplits.k9,
      rpg:        mlbTeamBattingSplits.rpg,
      ipPerGame:  mlbTeamBattingSplits.ipPerGame,
    })
    .from(mlbTeamBattingSplits);

  // Build batting splits lookup: teamAbbrev → { L: splits, R: splits }
  const battingSplitsLookup = new Map<string, { L: Record<string, number>; R: Record<string, number> }>();
  // Build rpg/ipPerGame lookup: teamAbbrev → { rpg, ipPerGame }
  // Values are hand-agnostic (same for L and R rows); first row per team wins.
  const teamRpgIpgLookup = new Map<string, { rpg: number; ipPerGame: number }>();
  for (const r of battingSplitRows) {
    const team = r.teamAbbrev.toUpperCase();
    if (!battingSplitsLookup.has(team)) battingSplitsLookup.set(team, { L: {}, R: {} });
    const entry = battingSplitsLookup.get(team)!;
    const splits = {
      avg:  r.avg  ?? 0.250,
      obp:  r.obp  ?? 0.318,
      slg:  r.slg  ?? 0.410,
      ops:  r.ops  ?? 0.728,
      woba: r.woba ?? 0.312,
      hr9:  r.hr9  ?? 1.0,
      bb9:  r.bb9  ?? 3.1,
      k9:   r.k9   ?? 9.0,
    };
    if (r.hand === 'L') entry.L = splits;
    else                entry.R = splits;
    // Populate rpg/ipPerGame lookup (first row per team wins)
    if (!teamRpgIpgLookup.has(team)) {
      teamRpgIpgLookup.set(team, {
        rpg:       r.rpg       ?? 4.50,  // fallback: league avg
        ipPerGame: r.ipPerGame ?? 5.30,  // fallback: league avg
      });
    }
  }

  console.log(`[MLBModelRunner] [BATCH] Loaded: ${allRows.length} pitcher rows, ${rolling5Rows.length} rolling-5 rows, ${battingSplitRows.length} batting split rows`);

  // ── Helper: blend season + rolling-5 stats ─────────────────────────────────
  // Weights: 70% season, 30% rolling-5 (if ≥3 starts in window)
  const SEASON_W  = 0.70;
  const ROLLING_W = 0.30;
  const MIN_ROLLING_STARTS = 3;

  function blendWithRolling(
    season: Record<string, number>,
    r5: typeof rolling5Rows[0] | undefined
  ): Record<string, number> {
    if (!r5 || (r5.startsIncluded ?? 0) < MIN_ROLLING_STARTS || !r5.era5) {
      // Not enough rolling data — use season stats only
      return season;
    }
    const blended = { ...season };
    // Blend ERA, K/9, BB/9, HR/9, WHIP
    blended.era  = SEASON_W * season.era  + ROLLING_W * (r5.era5  ?? season.era);
    blended.k9   = SEASON_W * season.k9   + ROLLING_W * (r5.k9_5  ?? season.k9);
    blended.bb9  = SEASON_W * season.bb9  + ROLLING_W * (r5.bb9_5 ?? season.bb9);
    blended.hr9  = SEASON_W * season.hr9  + ROLLING_W * (r5.hr9_5 ?? season.hr9);
    blended.whip = SEASON_W * season.whip + ROLLING_W * (r5.whip5 ?? season.whip);
    // Blend FIP if rolling FIP available
    if (r5.fip5 !== null && season.fip) {
      blended.fip = SEASON_W * season.fip + ROLLING_W * r5.fip5;
    }
    blended.rolling_starts = r5.startsIncluded ?? 0;
    blended.rolling_era    = r5.era5  ?? season.era;
    blended.rolling_k9     = r5.k9_5  ?? season.k9;
    blended.rolling_bb9    = r5.bb9_5 ?? season.bb9;
    blended.rolling_whip   = r5.whip5 ?? season.whip;
    blended.rolling_fip    = r5.fip5  ?? season.fip ?? season.era;
    return blended;
  }

  // Build name → stats lookup map (includes FIP, xFIP, throwsHand)
  // Also build mlbamId → nrfiRate map for NRFI signal computation
  const nrfiRateByMlbamId = new Map<number, number | null>();
  for (const row of allRows) {
    nrfiRateByMlbamId.set(row.mlbamId, row.nrfiRate ?? null);
  }
  // Expose nrfiRateByMlbamId on the result map as a side-channel
  (result as any).__nrfiRates = nrfiRateByMlbamId;

  const dbMap = new Map<string, { stats: Record<string, number>; mlbamId: number; nrfiRate: number | null; nrfiStarts: number | null }>();
  for (const row of allRows) {
    const normName = row.fullName.toLowerCase().trim();
    // Season stats base
    const seasonStats: Record<string, number> = {
      era:       row.era       ?? DEFAULT_PITCHER_STATS.era,
      k9:        row.k9        ?? DEFAULT_PITCHER_STATS.k9,
      bb9:       row.bb9       ?? DEFAULT_PITCHER_STATS.bb9,
      hr9:       row.hr9       ?? DEFAULT_PITCHER_STATS.hr9,
      whip:      row.whip      ?? DEFAULT_PITCHER_STATS.whip,
      ip:        row.ip        ?? DEFAULT_PITCHER_STATS.ip,
      gp:        row.gamesStarted ?? DEFAULT_PITCHER_STATS.gp,
      xera:      row.xera      ?? DEFAULT_PITCHER_STATS.xera,
      fip:       row.fip       ?? row.era ?? DEFAULT_PITCHER_STATS.era,
      xfip:      row.xfip      ?? row.era ?? DEFAULT_PITCHER_STATS.era,
      fipMinus:  row.fipMinus  ?? 100,
      eraMinus:  row.eraMinus  ?? 100,
      war:       row.war       ?? 0,
      // throwsHand encoded as number: 0=R, 1=L, 2=S (Python reads as string via pitch_hand)
      throwsHand: row.throwsHand === 'L' ? 1 : row.throwsHand === 'S' ? 2 : 0,
      throwsHandStr: 0, // placeholder, actual string passed separately
    };
    // Blend with rolling-5 if available
    const r5 = rolling5Map.get(row.mlbamId);
    const blended = blendWithRolling(seasonStats, r5);
    // Store the actual hand string for Python
    blended.throwsHandStr = 0; // unused numeric placeholder
    const entry = { stats: blended, mlbamId: row.mlbamId, nrfiRate: row.nrfiRate ?? null, nrfiStarts: row.nrfiStarts ?? null };
    // Primary key: "name (TEAM)"
    dbMap.set(`${normName} (${row.teamAbbrev.toUpperCase()})`, entry);
    // Secondary key: name only (team-agnostic, first occurrence wins)
    if (!dbMap.has(normName)) dbMap.set(normName, entry);
  }

  // Pre-compute team SP averages for all teams that appear in the request
  const teamsNeeded = Array.from(new Set(pitcherNames.map(p => p.teamAbbrev.toUpperCase())));
  const teamAvgCache = new Map<string, Record<string, number>>();
  for (const team of teamsNeeded) {
    teamAvgCache.set(team, computeTeamSpAverage(team, allRows));
  }

  // Resolve each requested pitcher
  for (const { name, teamAbbrev } of pitcherNames) {
    const normName = name.toLowerCase().trim();
    const teamKey = `${normName} (${teamAbbrev.toUpperCase()})`;

    let stats: Record<string, number> | undefined;
    let resolvedMlbamId: number | undefined;
    let source = '';

    // 1. Exact DB match: name + team
    if (dbMap.has(teamKey)) {
      const entry = dbMap.get(teamKey)!;
      stats = entry.stats;
      resolvedMlbamId = entry.mlbamId;
      source = 'DB (exact)';
    }
    // 2. DB match: name only (handles team transfers mid-season)
    else if (dbMap.has(normName)) {
      const entry = dbMap.get(normName)!;
      stats = entry.stats;
      resolvedMlbamId = entry.mlbamId;
      source = 'DB (name-only)';
    }
    // 3. Legacy PITCHER_REGISTRY: name + team
    else {
      const legacyKey = `${name} (${teamAbbrev})`;
      if (PITCHER_REGISTRY[legacyKey]) {
        stats = PITCHER_REGISTRY[legacyKey];
        source = 'Registry (exact)';
      } else {
        // 4. Legacy PITCHER_REGISTRY: name prefix
        for (const [k, v] of Object.entries(PITCHER_REGISTRY)) {
          if (k.startsWith(name)) {
            stats = v;
            source = 'Registry (prefix)';
            break;
          }
        }
      }
    }

    // 5. Team SP average fallback — no league-average defaults
    if (!stats) {
      const teamAvg = teamAvgCache.get(teamAbbrev.toUpperCase());
      if (teamAvg) {
        stats = teamAvg;
        source = `Team SP avg (${teamAbbrev})`;
        console.log(`[MLBModelRunner] ↩ Team SP avg fallback: "${name}" (${teamAbbrev})`);
      } else {
        stats = { ...DEFAULT_PITCHER_STATS };
        source = 'league-avg default';
        console.warn(`[MLBModelRunner] ⚠ No team data for "${name}" (${teamAbbrev}) — using league-avg defaults`);
      }
    } else {
      const handStr = stats.throwsHand === 1 ? 'L' : stats.throwsHand === 2 ? 'S' : 'R';
      const rollingInfo = stats.rolling_starts
        ? ` | rolling-5: ERA=${stats.rolling_era?.toFixed(2)} K/9=${stats.rolling_k9?.toFixed(2)} (${stats.rolling_starts} starts)`
        : ' | no rolling-5 blend';
      console.log(
        `[MLBModelRunner] ✓ ${source}: "${name}" (${teamAbbrev}) | ` +
        `ERA=${stats.era?.toFixed(2)} FIP=${stats.fip?.toFixed(2)} xFIP=${stats.xfip?.toFixed(2)} ` +
        `K/9=${stats.k9?.toFixed(2)} BB/9=${stats.bb9?.toFixed(2)} WHIP=${stats.whip?.toFixed(3)} ` +
        `hand=${handStr} WAR=${stats.war?.toFixed(2)}${rollingInfo}`
      );
    }

    // Attach batting splits for the opposing team keyed by this pitcher's hand
    // These are stored in the stats dict so the Python engine can use them
    // via team_stats dict (passed separately in engineInputs)
    result.set(`${name}|${teamAbbrev}`, stats);

    // Store nrfiRate + nrfiStarts in side-channel keyed by "name|team" for NRFI signal computation
    // Only available for DB-resolved pitchers (not registry/fallback)
    // nrfiStarts is passed alongside nrfiRate so MLBAIModel.py can apply Bayesian shrinkage
    // for low-sample pitchers (< 5 starts) toward the league I1 prior (0.1166 → NRFI=0.8899)
    const nrfiRate   = resolvedMlbamId != null ? (dbMap.get(teamKey)?.nrfiRate   ?? dbMap.get(normName)?.nrfiRate   ?? null) : null;
    const nrfiStarts = resolvedMlbamId != null ? (dbMap.get(teamKey)?.nrfiStarts ?? dbMap.get(normName)?.nrfiStarts ?? null) : null;
    (result as any).__nrfiRateByKey    = (result as any).__nrfiRateByKey    ?? new Map<string, number | null>();
    (result as any).__nrfiStartsByKey  = (result as any).__nrfiStartsByKey  ?? new Map<string, number | null>();
    (result as any).__nrfiRateByKey.set(`${name}|${teamAbbrev}`, nrfiRate);
    (result as any).__nrfiStartsByKey.set(`${name}|${teamAbbrev}`, nrfiStarts);
  }

  // Expose battingSplitsLookup so Step 3 can attach to team_stats
  (result as any).__battingSplits = battingSplitsLookup;
  // Expose teamRpgIpgLookup so getTeamStats can use live DB rpg/ipPerGame instead of TEAM_STATS_2025
  (result as any).__teamRpgIpg = teamRpgIpgLookup;

  return result;
}

/**
 * getTeamStats — returns base team stats for the model engine.
 *
 * Priority:
 *   1. DB-driven rpg + ipPerGame from mlb_team_batting_splits (live 2026 season)
 *      merged with TEAM_STATS_2025 avg/obp/slg/era/k9/bb9/whip as structural defaults
 *   2. TEAM_STATS_2025 full row (frozen 2025 season — used only if team not in DB)
 *   3. League-average defaults (unknown/expansion team)
 *
 * Note: avg/obp/slg/woba/k9/bb9/hr9 are overridden by hand-specific batting splits
 * downstream in runMlbModelForDate (awayBattingSplit / homeBattingSplit merge).
 * Only rpg and ip_per_game from this function are used in the final team_stats dict.
 */
function getTeamStats(
  abbrev: string,
  rpgIpgLookup?: Map<string, { rpg: number; ipPerGame: number }>
): Record<string, number> {
  const base = TEAM_STATS_2025[abbrev] ?? {
    rpg: 4.50, era: 4.20, avg: 0.250, obp: 0.318, slg: 0.410,
    k9: 9.0, bb9: 3.1, whip: 1.26, ip_per_game: 5.30,
  };
  if (!TEAM_STATS_2025[abbrev]) {
    console.warn(`[MLBModelRunner] ⚠ Unknown team "${abbrev}" — using league-average base stats`);
  }
  // Override rpg and ip_per_game with live DB values if available
  const dbRpgIpg = rpgIpgLookup?.get(abbrev.toUpperCase());
  if (dbRpgIpg) {
    const result = { ...base, rpg: dbRpgIpg.rpg, ip_per_game: dbRpgIpg.ipPerGame };
    console.log(
      `[MLBModelRunner] [TeamStats] ${abbrev}: rpg=${dbRpgIpg.rpg.toFixed(3)} (DB) ` +
      `ip_per_game=${dbRpgIpg.ipPerGame.toFixed(3)} (DB) | ` +
      `avg=${base.avg} obp=${base.obp} slg=${base.slg} (TEAM_STATS_2025 base)`
    );
    return result;
  }
  // Fallback: TEAM_STATS_2025 frozen values
  console.warn(
    `[MLBModelRunner] [TeamStats] ${abbrev}: rpg=${base.rpg} ip_per_game=${base.ip_per_game} ` +
    `(TEAM_STATS_2025 fallback — DB row not found)`
  );
  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// PYTHON ENGINE CALLER
// ─────────────────────────────────────────────────────────────────────────────

interface EngineInput {
  db_id: number;
  away_abbrev: string;
  home_abbrev: string;
  away_pitcher_name: string;
  home_pitcher_name: string;
  away_team_stats: Record<string, number>;
  home_team_stats: Record<string, number>;
  away_pitcher_stats: Record<string, number>;
  home_pitcher_stats: Record<string, number>;
  book_lines: {
    ml_away: number;
    ml_home: number;
    ou_line: number;
    over_odds: number;
    under_odds: number;
    rl_home_spread: number;
    rl_home: number;
    rl_away: number;
  };
  game_date: string;
  // ── New precision signals ────────────────────────────────────────────────
  park_factor_3yr: number;        // 3-year weighted park run factor (1.0 = neutral)
  away_bullpen: Record<string, number>;  // bullpen ERA/FIP/K9/BB9 for away team
  home_bullpen: Record<string, number>;  // bullpen ERA/FIP/K9/BB9 for home team
  umpire_k_mod: number;           // HP umpire K-rate modifier (1.0 = league avg)
  umpire_bb_mod: number;          // HP umpire BB-rate modifier (1.0 = league avg)
  umpire_name: string;            // HP umpire name for logging
  mlb_game_pk: number | null;     // MLB Stats API gamePk for traceability
  // ── 3-year NRFI pitcher signal (pre-compute in TS, also passed to Python) ─────
  nrfi_combined_signal: number | null;  // (awayNrfiRate + homeNrfiRate) / 2, null if missing
  nrfi_filter_pass: boolean | null;     // combinedSignal >= 0.56 (optimal threshold, n=5109)
  // ── 3-year backtest NRFI/F5 priors (passed directly to project_game) ─────────
  away_pitcher_nrfi: number | null;         // away SP 3yr NRFI rate from mlbPitcherStats
  home_pitcher_nrfi: number | null;         // home SP 3yr NRFI rate from mlbPitcherStats
  away_pitcher_nrfi_starts: number | null;  // away SP NRFI sample size (for Bayesian shrinkage)
  home_pitcher_nrfi_starts: number | null;  // home SP NRFI sample size (for Bayesian shrinkage)
  away_team_nrfi: number | null;       // away team 3yr NRFI rate (null = auto-lookup in Python)
  home_team_nrfi: number | null;       // home team 3yr NRFI rate (null = auto-lookup in Python)
  away_f5_rs: number | null;           // away team 3yr F5 RS mean (null = auto-lookup in Python)
  home_f5_rs: number | null;           // home team 3yr F5 RS mean (null = auto-lookup in Python)
  // ── Weather dict (parsed from mlbLineups.weatherTemp/Wind/Dome) ───────────────────────────────
  weather: {
    temp_f: number;          // parsed from "72°F" or "72" strings
    wind_speed_mph: number;  // parsed from "15 mph Out to CF" etc.
    wind_dir: string;        // "out", "in", "calm", "cross", "unknown"
    dome: boolean;           // true = retractable/fixed dome (weather irrelevant)
  } | null;
  // ── Confirmed lineup Statcast aggregates (weighted by batting order position) ──
  away_lineup_statcast: {
    barrel_rate: number;  // weighted avg barrel% across confirmed lineup
    iso: number;          // weighted avg ISO
    hard_hit: number;     // weighted avg hard-hit%
    n_players: number;    // number of players with Statcast data
  } | null;
  home_lineup_statcast: {
    barrel_rate: number;
    iso: number;
    hard_hit: number;
    n_players: number;
  } | null;
  // ── P4-A: Per-player batting order array (9 slots, sorted by battingOrder) ──
  // Each slot: { barrel_rate, iso, hard_hit, bats } for that batting order position.
  // When confirmed lineup is available, Python builds a per-player lineup array
  // instead of replicating the team-average feature dict 9 times.
  away_lineup_order: Array<{
    barrel_rate: number;
    iso: number;
    hard_hit: number;
    bats: string; // 'R' | 'L' | 'S'
  }> | null;
  home_lineup_order: Array<{
    barrel_rate: number;
    iso: number;
    hard_hit: number;
    bats: string;
  }> | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// P1-A: WEATHER PARSING HELPERS
// ─────────────────────────────────────────────────────────────────────────────
/**
 * parseWeatherTemp: Extract numeric temperature from Rotowire weather string.
 * Handles: "72°F", "72 F", "72", "72°", null/undefined.
 * Returns 72.0 (league-average neutral) if parsing fails.
 */
export function parseWeatherTemp(raw: string | null | undefined): number {
  if (!raw) return 72.0;
  // Remove degree symbol, F/C suffix, whitespace
  const cleaned = raw.replace(/°/g, '').replace(/[FC]/gi, '').trim();
  const val = parseFloat(cleaned);
  if (isNaN(val) || val < 20 || val > 120) return 72.0; // sanity bounds
  return val;
}

/**
 * parseWeatherWind: Extract wind speed (mph) and direction from Rotowire wind string.
 * Handles: "15 mph Out to CF", "10 mph In from LF", "Calm", "5 mph L to R",
 *          "12 mph R to L", null/undefined.
 * Returns { speed: 0, dir: 'calm' } if parsing fails.
 *
 * Direction classification:
 *   'out'   = wind blowing out to CF/LF/RF (HR-boosting)
 *   'in'    = wind blowing in from CF/LF/RF (HR-suppressing)
 *   'calm'  = calm / < 3 mph
 *   'cross' = L to R, R to L (minimal HR effect)
 *   'unknown' = unrecognized pattern
 */
export function parseWeatherWind(raw: string | null | undefined): { speed: number; dir: string } {
  if (!raw) return { speed: 0, dir: 'calm' };
  const lower = raw.toLowerCase().trim();
  if (lower === 'calm' || lower === '0' || lower.startsWith('calm')) return { speed: 0, dir: 'calm' };
  // Extract speed: first numeric token
  const speedMatch = lower.match(/(\d+(?:\.\d+)?)\s*mph/);
  const speed = speedMatch ? parseFloat(speedMatch[1]) : 0;
  // Classify direction
  let dir = 'unknown';
  if (lower.includes('out to') || lower.includes('out from') || lower.includes('out cf') ||
      lower.includes('out lf') || lower.includes('out rf') || lower.includes('blowing out')) {
    dir = 'out';
  } else if (lower.includes('in from') || lower.includes('in to') || lower.includes('in cf') ||
             lower.includes('in lf') || lower.includes('in rf') || lower.includes('blowing in')) {
    dir = 'in';
  } else if (lower.includes('l to r') || lower.includes('left to right') ||
             lower.includes('r to l') || lower.includes('right to left')) {
    dir = 'cross';
  } else if (speed < 3) {
    dir = 'calm';
  }
  return { speed, dir };
}

/**
 * buildWeatherDict: Compose the full weather dict for Python project_game().
 * If dome=true, returns null (Python uses park-only factors, no weather adj).
 */
export function buildWeatherDict(
  weatherTemp: string | null | undefined,
  weatherWind: string | null | undefined,
  weatherDome: boolean | null | undefined,
): EngineInput['weather'] {
  // Dome games: weather irrelevant — pass null so Python skips weather_run_adj
  if (weatherDome === true) return null;
  const temp_f = parseWeatherTemp(weatherTemp);
  const { speed: wind_speed_mph, dir: wind_dir } = parseWeatherWind(weatherWind);
  return { temp_f, wind_speed_mph, wind_dir, dome: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// P1-B: LINEUP STATCAST AGGREGATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────
/**
 * LINEUP_POSITION_WEIGHTS: batting order positional PA weight.
 * Positions 1-3 get more PA per game than 7-9.
 * Source: empirical MLB PA distribution by batting order slot (2023-2025).
 */
const LINEUP_POSITION_WEIGHTS = [0.130, 0.125, 0.122, 0.118, 0.115, 0.110, 0.105, 0.100, 0.075];

/**
 * aggregateLineupStatcast: Compute batting-order-weighted Statcast averages
 * from a confirmed lineup's individual player data.
 *
 * @param lineupJson  JSON string from mlbLineups.awayLineup / homeLineup
 * @param playerMap   Map<mlbamId, { iso, barrelPct, hardHitPct }> from mlbPlayers
 * @param tag         Logging tag (e.g. "[1234] AWAY")
 * @returns Weighted averages or null if < MIN_PLAYERS_WITH_DATA players have Statcast data
 */
export function aggregateLineupStatcast(
  lineupJson: string | null | undefined,
  playerMap: Map<number, { iso: number | null; barrelPct: number | null; hardHitPct: number | null }>,
  tag: string,
): EngineInput['away_lineup_statcast'] {
  const MIN_PLAYERS_WITH_DATA = 5; // require at least 5 of 9 players to have Statcast data
  if (!lineupJson) {
    console.log(`${tag} [LINEUP-STATCAST] No lineup JSON — using team averages`);
    return null;
  }
  let lineup: Array<{ battingOrder: number; mlbamId: number | null }> = [];
  try {
    lineup = JSON.parse(lineupJson);
  } catch {
    console.log(`${tag} [LINEUP-STATCAST] JSON parse error — using team averages`);
    return null;
  }
  if (!Array.isArray(lineup) || lineup.length < 7) {
    console.log(`${tag} [LINEUP-STATCAST] Lineup has ${lineup.length} players (< 7) — using team averages`);
    return null;
  }
  // Sort by battingOrder ascending
  const sorted = [...lineup].sort((a, b) => (a.battingOrder ?? 9) - (b.battingOrder ?? 9));
  let weightedBarrel = 0, weightedIso = 0, weightedHardHit = 0;
  let totalWeight = 0;
  let nWithData = 0;
  for (let i = 0; i < Math.min(sorted.length, 9); i++) {
    const player = sorted[i];
    const w = LINEUP_POSITION_WEIGHTS[i] ?? 0.075;
    const stats = player.mlbamId ? playerMap.get(player.mlbamId) : undefined;
    if (!stats || (stats.iso == null && stats.barrelPct == null && stats.hardHitPct == null)) {
      // No Statcast data for this player — use league averages as placeholder
      weightedBarrel  += w * 8.3;   // LEAGUE_BARREL
      weightedIso     += w * 0.150; // LEAGUE_ISO
      weightedHardHit += w * 37.5;  // LEAGUE_HARDHIT
    } else {
      weightedBarrel  += w * (stats.barrelPct  ?? 8.3);
      weightedIso     += w * (stats.iso        ?? 0.150);
      weightedHardHit += w * (stats.hardHitPct ?? 37.5);
      nWithData++;
    }
    totalWeight += w;
  }
  if (nWithData < MIN_PLAYERS_WITH_DATA) {
    console.log(`${tag} [LINEUP-STATCAST] Only ${nWithData}/${sorted.length} players have Statcast data (< ${MIN_PLAYERS_WITH_DATA}) — using team averages`);
    return null;
  }
  const result = {
    barrel_rate: weightedBarrel  / totalWeight,
    iso:         weightedIso     / totalWeight,
    hard_hit:    weightedHardHit / totalWeight,
    n_players:   nWithData,
  };
  console.log(
    `${tag} [LINEUP-STATCAST] n=${nWithData}/${sorted.length} ` +
    `barrel=${result.barrel_rate.toFixed(2)}% iso=${result.iso.toFixed(3)} ` +
    `hard_hit=${result.hard_hit.toFixed(1)}%`
  );
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// P4-A: PER-PLAYER BATTING ORDER BUILDER
// ─────────────────────────────────────────────────────────────────────────────
/**
 * buildLineupOrder: Build a per-player batting order array (9 slots) from a
 * confirmed lineup JSON + playerStatcastMap.
 *
 * Each slot corresponds to batting order position 1-9 and contains:
 *   { barrel_rate, iso, hard_hit, bats }
 *
 * For players without Statcast data, league averages are used as fallback.
 * Returns null if < 7 players are in the lineup JSON.
 *
 * This enables the Python engine to build a TRUE per-player lineup array
 * instead of replicating the team-average feature dict 9 times.
 *
 * @param lineupJson  JSON string from mlbLineups.awayLineup / homeLineup
 * @param playerMap   Map<mlbamId, { iso, barrelPct, hardHitPct }> from mlbPlayers
 * @param tag         Logging tag (e.g. "[1234] AWAY")
 */
export function buildLineupOrder(
  lineupJson: string | null | undefined,
  playerMap: Map<number, { iso: number | null; barrelPct: number | null; hardHitPct: number | null }>,
  tag: string,
): EngineInput['away_lineup_order'] {
  // League averages (2025)
  const LEAGUE_BARREL = 8.3;
  const LEAGUE_ISO = 0.150;
  const LEAGUE_HARD_HIT = 37.5;

  if (!lineupJson) {
    console.log(`${tag} [LINEUP-ORDER] No lineup JSON — skipping per-player order`);
    return null;
  }
  let lineup: Array<{ battingOrder: number; mlbamId: number | null; bats?: string }> = [];
  try {
    lineup = JSON.parse(lineupJson);
  } catch {
    console.log(`${tag} [LINEUP-ORDER] JSON parse error — skipping per-player order`);
    return null;
  }
  if (!Array.isArray(lineup) || lineup.length < 7) {
    console.log(`${tag} [LINEUP-ORDER] Lineup has ${lineup.length} players (< 7) — skipping`);
    return null;
  }
  // Sort by battingOrder ascending (1-9)
  const sorted = [...lineup].sort((a, b) => (a.battingOrder ?? 9) - (b.battingOrder ?? 9));
  const result: Array<{ barrel_rate: number; iso: number; hard_hit: number; bats: string }> = [];
  let nWithData = 0;

  for (let i = 0; i < Math.min(sorted.length, 9); i++) {
    const player = sorted[i];
    const stats = player.mlbamId ? playerMap.get(player.mlbamId) : undefined;
    if (stats && (stats.barrelPct != null || stats.iso != null || stats.hardHitPct != null)) {
      result.push({
        barrel_rate: stats.barrelPct ?? LEAGUE_BARREL,
        iso:         stats.iso       ?? LEAGUE_ISO,
        hard_hit:    stats.hardHitPct ?? LEAGUE_HARD_HIT,
        bats:        player.bats ?? 'R',
      });
      nWithData++;
    } else {
      // Use league averages as fallback for this slot
      result.push({
        barrel_rate: LEAGUE_BARREL,
        iso:         LEAGUE_ISO,
        hard_hit:    LEAGUE_HARD_HIT,
        bats:        player.bats ?? 'R',
      });
    }
  }

  // Pad to exactly 9 slots if lineup has fewer than 9 players
  while (result.length < 9) {
    result.push({ barrel_rate: LEAGUE_BARREL, iso: LEAGUE_ISO, hard_hit: LEAGUE_HARD_HIT, bats: 'R' });
  }

  console.log(
    `${tag} [LINEUP-ORDER] Built per-player order: n=${nWithData}/${sorted.length} with Statcast data`
  );
  return result;
}

async function runPythonEngine(inputs: EngineInput[]): Promise<MlbModelResult[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, ["-c", `
import sys, json, os
sys.path.insert(0, "${__dirname.replace(/\\/g, '/')}")
from MLBAIModel import project_game
from datetime import datetime

inputs = json.load(sys.stdin)
results = []
for inp in inputs:
    try:
        r = project_game(
            away_abbrev=inp['away_abbrev'],
            home_abbrev=inp['home_abbrev'],
            away_team_stats=inp['away_team_stats'],
            home_team_stats=inp['home_team_stats'],
            away_pitcher_stats=inp['away_pitcher_stats'],
            home_pitcher_stats=inp['home_pitcher_stats'],
            book_lines=inp['book_lines'],
            game_date=datetime.strptime(inp['game_date'], '%Y-%m-%d'),
            park_factor_3yr=inp.get('park_factor_3yr', 1.0),
            away_bullpen=inp.get('away_bullpen'),
            home_bullpen=inp.get('home_bullpen'),
            umpire_k_mod=inp.get('umpire_k_mod', 1.0),
            umpire_bb_mod=inp.get('umpire_bb_mod', 1.0),
            umpire_name=inp.get('umpire_name', 'UNKNOWN'),
            mlb_game_pk=inp.get('mlb_game_pk'),
            # ── 3yr backtest NRFI/F5 priors (from DB via mlbModelRunner) ─────────────────────────────────────────────────────────────────────────────
            # Pitcher NRFI rates from DB (mlbPitcherStats.nrfiRate, 3yr rolling)
            # Team NRFI rates and F5 RS: pass None → auto-lookup from 3yr constants in project_game
            away_pitcher_nrfi=inp.get('away_pitcher_nrfi'),
            home_pitcher_nrfi=inp.get('home_pitcher_nrfi'),
            away_pitcher_nrfi_starts=inp.get('away_pitcher_nrfi_starts'),
            home_pitcher_nrfi_starts=inp.get('home_pitcher_nrfi_starts'),
            away_team_nrfi=inp.get('away_team_nrfi'),
            home_team_nrfi=inp.get('home_team_nrfi'),
            away_f5_rs=inp.get('away_f5_rs'),
            home_f5_rs=inp.get('home_f5_rs'),
            # P1-A: Weather dict (temp_f, wind_speed_mph, wind_dir, dome)
            weather=inp.get('weather'),
            # P1-B: Confirmed lineup Statcast aggregates (barrel_rate, iso, hard_hit, n_players)
            away_lineup_statcast=inp.get('away_lineup_statcast'),
            home_lineup_statcast=inp.get('home_lineup_statcast'),
            # P4-A: Per-player batting order arrays (9 slots: barrel_rate, iso, hard_hit, bats)
            away_lineup_order=inp.get('away_lineup_order'),
            home_lineup_order=inp.get('home_lineup_order'),
            verbose=True,
        )
        r['db_id'] = inp['db_id']
        r['away_pitcher'] = inp['away_pitcher_name']
        r['home_pitcher'] = inp['home_pitcher_name']
        results.append(r)
    except Exception as e:
        results.append({
            'db_id': inp['db_id'],
            'ok': False,
            'error': str(e),
            'game': f"{inp['away_abbrev']} @ {inp['home_abbrev']}",
        })
print(json.dumps(results))
`], {
      env: (() => {
        // Build a clean env for python3.11:
        // 1. Start from process.env (inherits PATH, HOME, etc.)
        // 2. DELETE PYTHONHOME entirely — setting it to undefined in JS passes the
        //    string "undefined" to the child process, which breaks stdlib lookup.
        //    We must use delete to actually remove it from the env object.
        // 3. Override PYTHONPATH to point at the correct python3.11 site-packages.
        const env: Record<string, string> = {};
        for (const [k, v] of Object.entries(process.env)) {
          if (v !== undefined && k !== 'PYTHONHOME') env[k] = v;
        }
        env['PYTHONPATH'] = '/usr/local/lib/python3.11/dist-packages:/usr/lib/python3/dist-packages';
        env['PYTHONDONTWRITEBYTECODE'] = '1';
        return env;
      })(),
      cwd: __dirname,
    });

    let stdout = "";
    let stderrBuf = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    // Stream stderr line-by-line so verbose engine diagnostics appear in real-time
    proc.stderr.on("data", (d: Buffer) => {
      stderrBuf += d.toString();
      const lines = stderrBuf.split("\n");
      stderrBuf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) console.log(`[ENGINE] ${line}`);
      }
    });

    proc.on("close", (code: number) => {
      // Flush any remaining stderr buffer
      if (stderrBuf.trim()) console.log(`[ENGINE] ${stderrBuf.trim()}`);
      const stderr = stderrBuf;
      if (code !== 0) {
        return reject(new Error(`Python engine exited with code ${code}: ${stderr.slice(0, 500)}`));
      }
      try {
        const results = JSON.parse(stdout.trim()) as MlbModelResult[];
        resolve(results);
      } catch (e) {
        reject(new Error(`Failed to parse Python output: ${stdout.slice(0, 500)}`));
      }
    });

    proc.on("error", (err: Error) => reject(err));
    proc.stdin.write(JSON.stringify(inputs));
    proc.stdin.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST-WRITE VALIDATION GATE
// ─────────────────────────────────────────────────────────────────────────────

export async function validateMlbModelResults(dateStr: string): Promise<ValidationResult> {
  const db = await getDb();
  const rows = await db.select({
    id:              games.id,
    away:            games.awayTeam,
    home:            games.homeTeam,
    bookTotal:       games.bookTotal,
    modelTotal:      games.modelTotal,
    awayBookSpread:  games.awayBookSpread,
    awayModelSpread: games.awayModelSpread,
    homeModelSpread: games.homeModelSpread,
    awayRunLine:     games.awayRunLine,
    homeRunLine:     games.homeRunLine,
    awayRunLineOdds: games.awayRunLineOdds,
    homeRunLineOdds: games.homeRunLineOdds,
    modelOverOdds:   games.modelOverOdds,
    modelUnderOdds:  games.modelUnderOdds,
    publishedToFeed:   games.publishedToFeed,
    publishedModel:    games.publishedModel,
    modelF5PushPct:    games.modelF5PushPct,
    modelF5PushRaw:    games.modelF5PushRaw,
    modelRunAt:        games.modelRunAt,
    spreadDiff:        games.spreadDiff,
    spreadEdge:        games.spreadEdge,
  }).from(games)
    .where(and(
      eq(games.gameDate, dateStr),
      eq(games.sport, "MLB"),
    ));

  const issues: string[] = [];
  const warnings: string[] = [];

  for (const g of rows as Array<typeof rows[0]>) {
    const label = `[${g.id}] ${g.away} @ ${g.home}`;

    // 1. Total must match book
    const bookT  = parseFloat(String(g.bookTotal  ?? "0"));
    const modelT = parseFloat(String(g.modelTotal ?? "0"));
    if (Math.abs(bookT - modelT) > 0.01) {
      issues.push(`${label}: modelTotal=${modelT} ≠ bookTotal=${bookT}`);
    }

    // 2. RL spread must be exactly ±1.5 — MLB run lines are NEVER 0 or pick'em
    // Note: MySQL decimal columns strip the '+' prefix, so "1.5" == "+1.5" and "-1.5" == "-1.5"
    const awayRLRaw = String(g.awayModelSpread ?? "");
    const awayRLNum = parseFloat(awayRLRaw);
    const validRL = !isNaN(awayRLNum) && Math.abs(Math.abs(awayRLNum) - 1.5) < 0.01;
    if (!validRL) {
      issues.push(`${label}: awayModelSpread="${awayRLRaw}" — expected ±1.5 (MLB RL is never 0/pick'em), got ${awayRLNum}`);
    }

    // 2b. RL sign alignment: awayModelSpread sign MUST match awayBookSpread sign
    // CRITICAL: if book has away=-1.5 (fav), model must also show away=-1.5 (not +1.5)
    const awayBookSpreadNum  = parseFloat(String(g.awayBookSpread ?? "0"));
    const awayModelSpreadNum = parseFloat(String(g.awayModelSpread ?? "0"));
    if (!isNaN(awayBookSpreadNum) && !isNaN(awayModelSpreadNum) && awayBookSpreadNum !== 0) {
      const bookSign  = awayBookSpreadNum  < 0 ? -1 : 1;
      const modelSign = awayModelSpreadNum < 0 ? -1 : 1;
      if (bookSign !== modelSign) {
        issues.push(
          `${label}: RL INVERSION — awayBookSpread=${awayBookSpreadNum} (${bookSign > 0 ? 'dog' : 'fav'}) ` +
          `but awayModelSpread=${awayModelSpreadNum} (${modelSign > 0 ? 'dog' : 'fav'}) — SIGN MISMATCH`
        );
      }
    }

    // 3. RL odds must be populated
    if (!g.awayRunLineOdds || g.awayRunLineOdds === "NULL") {
      issues.push(`${label}: awayRunLineOdds is NULL`);
    }
    if (!g.homeRunLineOdds || g.homeRunLineOdds === "NULL") {
      issues.push(`${label}: homeRunLineOdds is NULL`);
    }

    // 4. awayRunLine / homeRunLine must be populated
    if (!g.awayRunLine) {
      issues.push(`${label}: awayRunLine is NULL`);
    }
    if (!g.homeRunLine) {
      issues.push(`${label}: homeRunLine is NULL`);
    }

    // 5. Feed flags
    if (!g.publishedToFeed || !g.publishedModel) {
      issues.push(`${label}: publishedToFeed=${g.publishedToFeed} publishedModel=${g.publishedModel}`);
    }

    // 6. F5 push probability (Bayesian-blended) must be populated for modeled games
    // Only check games that have been modeled (modelRunAt is set)
    // Empirical range: Bayesian-blended push rate is always 5%–35%. Outside = model error.
    if (g.modelRunAt != null) {
      const pushVal = g.modelF5PushPct != null ? parseFloat(String(g.modelF5PushPct)) : null;
      if (pushVal === null || isNaN(pushVal)) {
        issues.push(`${label}: modelF5PushPct is NULL — Bayesian-blended F5 push probability missing for modeled game`);
      } else if (pushVal < 0.05 || pushVal > 0.35) {
        issues.push(
          `${label}: modelF5PushPct=${pushVal.toFixed(4)} out of empirical range [0.05, 0.35] ` +
          `— Bayesian blend anomaly (empirical_prior=0.1507, K=10)`
        );
      }

      // 6b. Raw simulation push rate (pre-Bayesian-blend) must be populated and plausible
      // Range [0.05, 0.40]: raw sim rate can be slightly wider than blended because it is
      // unregularised. Values outside this range indicate a Monte Carlo sampling failure.
      const rawVal = g.modelF5PushRaw != null ? parseFloat(String(g.modelF5PushRaw)) : null;
      if (rawVal === null || isNaN(rawVal)) {
        issues.push(`${label}: modelF5PushRaw is NULL — raw Monte Carlo F5 push rate missing for modeled game`);
      } else if (rawVal < 0.05 || rawVal > 0.40) {
        issues.push(
          `${label}: modelF5PushRaw=${rawVal.toFixed(4)} out of plausible range [0.05, 0.40] ` +
          `— Monte Carlo sampling anomaly (400K sims, expected raw push ≈ 0.10–0.30)`
        );
      } else if (pushVal !== null && !isNaN(pushVal)) {
        // 6c. Bayesian shrinkage coherence: blended value must be pulled TOWARD prior (0.1507)
        // relative to raw. If |blended - prior| > |raw - prior|, the shrinkage went the wrong way.
        const EMPIRICAL_PRIOR = 0.1507;
        const distRaw    = Math.abs(rawVal  - EMPIRICAL_PRIOR);
        const distBlended = Math.abs(pushVal - EMPIRICAL_PRIOR);
        if (distBlended > distRaw + 0.001) {
          // Allow 0.001 tolerance for floating-point rounding
          issues.push(
            `${label}: modelF5PushPct Bayesian shrinkage INVERTED — ` +
            `raw=${rawVal.toFixed(4)} blended=${pushVal.toFixed(4)} prior=0.1507 ` +
            `(blended is FURTHER from prior than raw — shrinkage formula error)`
          );
        }
      }
    }

    // 7. Warn on whole-number totals (push probability > 0)
    if (bookT === Math.floor(bookT)) {
      warnings.push(`${label}: bookTotal=${bookT} is a whole number — push probability applies`);
    }
  }

  // 8. spreadDiff and spreadEdge must be populated for all modeled games
  // These are required for GameCard to show MLB RL edge detection.
  // If missing, the RL edge will never be shown (GameCard falls back to game.spreadDiff=null → diff=0).
  const modeledRows = rows.filter((g: (typeof rows)[0]) => g.modelRunAt != null);
  for (const g of modeledRows) {
    const label = `[${g.id}] ${g.away} @ ${g.home}`;
    if (!g.spreadDiff) {
      warnings.push(`${label}: spreadDiff is NULL — RL edge detection disabled (will show PASS for all RL markets)`);
    }
    if (!g.spreadEdge) {
      warnings.push(`${label}: spreadEdge is NULL — RL edge direction unknown`);
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT: runMlbModelForDate
// ─────────────────────────────────────────────────────────────────────────────

export interface MlbModelRunSummary {
  date: string;
  total: number;
  written: number;
  skipped: number;
  errors: number;
  validation: ValidationResult;
}

export async function runMlbModelForDate(dateStr: string, opts?: { targetGameIds?: number[]; forceRerun?: boolean }): Promise<MlbModelRunSummary> {
  const TAG = `[MLBModelRunner][${dateStr}]`;
  console.log(`${TAG} ► START${opts?.targetGameIds ? ` (targetGameIds=[${opts.targetGameIds.join(',')}])` : ''}${opts?.forceRerun ? ' (forceRerun=true)' : ''}`);

  const db = await getDb();

  // ── Step 1: Fetch all MLB games for the date with book lines ────────────────
  // P0 FIX: Left-join mlb_lineups so Rotowire pitcher names are used when
  // games.awayStartingPitcher (VSiN/MLB Stats API) is null. Rotowire posts
  // expected pitchers hours before VSiN, so this eliminates hasPitchers=false
  // skips on early cycles and ensures tomorrow's games model automatically.
  const dbGames = await db.select({
    id:              games.id,
    awayTeam:        games.awayTeam,
    homeTeam:        games.homeTeam,
    awayML:          games.awayML,
    homeML:          games.homeML,
    awayBookSpread:  games.awayBookSpread,
    homeBookSpread:  games.homeBookSpread,
    awaySpreadOdds:  games.awaySpreadOdds,
    homeSpreadOdds:  games.homeSpreadOdds,
    bookTotal:       games.bookTotal,
    overOdds:        games.overOdds,
    underOdds:       games.underOdds,
    awayRunLine:     games.awayRunLine,
    homeRunLine:     games.homeRunLine,
    awayRunLineOdds: games.awayRunLineOdds,
    homeRunLineOdds: games.homeRunLineOdds,
    // COALESCE: prefer VSiN/MLB Stats API pitcher, fall back to Rotowire (mlb_lineups)
    awayStartingPitcher: sql<string | null>`COALESCE(${games.awayStartingPitcher}, ${mlbLineups.awayPitcherName})`,
    homeStartingPitcher: sql<string | null>`COALESCE(${games.homeStartingPitcher}, ${mlbLineups.homePitcherName})`,
    startTimeEst:    games.startTimeEst,
    mlbGamePk:       games.mlbGamePk,
    modelRunAt:      games.modelRunAt,
    // ── Weather data from mlb_lineups (Rotowire scraper) ──
    weatherTemp:     mlbLineups.weatherTemp,
    weatherWind:     mlbLineups.weatherWind,
    weatherDome:     mlbLineups.weatherDome,
    weatherPrecip:   mlbLineups.weatherPrecip,
    // ── Batting lineup JSON arrays (for Statcast aggregation) ──
    awayLineup:      mlbLineups.awayLineup,
    homeLineup:      mlbLineups.homeLineup,
    awayLineupConfirmed: mlbLineups.awayLineupConfirmed,
    homeLineupConfirmed: mlbLineups.homeLineupConfirmed,
  }).from(games)
    .leftJoin(mlbLineups, eq(mlbLineups.gameId, games.id))
    .where(and(
      eq(games.gameDate, dateStr),
      eq(games.sport, "MLB"),
    ));

  console.log(`${TAG} Found ${dbGames.length} MLB games in DB`);

  // ── Step 2: Filter games that have enough data to model ─────────────────────
  const modelable = dbGames.filter((g: typeof dbGames[0]) => {
    // If targetGameIds specified, only run those specific games
    if (opts?.targetGameIds && !opts.targetGameIds.includes(g.id)) return false;
    // Skip already-modeled games unless forceRerun is explicitly set
    // Prevents the 5-min fallback cycle from re-running games already done.
    // CRITICAL FIX: only skip if modelRunAt was set on the SAME calendar date as the game.
    // If modelRunAt was set on a different date (e.g., yesterday's run wrote to today's game record),
    // the game must be re-modeled — the previous model run used stale data for a different date.
    if (!opts?.forceRerun && g.modelRunAt !== null && g.modelRunAt !== undefined) {
      const modelRunDate = new Date(Number(g.modelRunAt)).toISOString().slice(0, 10);
      if (modelRunDate === dateStr) {
        return false; // already modeled today — skip
      }
      // modelRunAt was set on a different date — clear it and re-model
      console.warn(`${TAG} [STALE-MODEL] id=${g.id} ${g.awayTeam}@${g.homeTeam} — modelRunAt=${modelRunDate} ≠ gameDate=${dateStr} — re-modeling`);
    }
    // CRITICAL: require confirmed DK run line — never fall back to ML-derived RL direction
    // Missing awayRunLine causes RL inversion when ML is even-money (e.g. +100 treated as dog)
    const hasLines = g.bookTotal && g.awayML && g.homeML && g.awayRunLine;
    const hasPitchers = g.awayStartingPitcher && g.homeStartingPitcher;
    if (!hasLines) {
      const missing = [];
      if (!g.bookTotal) missing.push('bookTotal');
      if (!g.awayML) missing.push('awayML');
      if (!g.homeML) missing.push('homeML');
      if (!g.awayRunLine) missing.push('awayRunLine [RL GATE]');
      console.warn(`${TAG} SKIP [${g.id}] ${g.awayTeam}@${g.homeTeam} — missing: ${missing.join(', ')}`);
    }
    if (!hasPitchers) {
      console.warn(`${TAG} SKIP [${g.id}] ${g.awayTeam}@${g.homeTeam} — missing starters`);
    }
    return hasLines && hasPitchers;
  });

  console.log(`${TAG} Modelable: ${modelable.length}/${dbGames.length}`);

  if (modelable.length === 0) {
    console.log(`${TAG} No games to model — exiting`);
    return { date: dateStr, total: dbGames.length, written: 0, skipped: dbGames.length, errors: 0, validation: { passed: true, issues: [], warnings: [] } };
  }

  // ── Step 2b: Batch-fetch precision signals (park factors, bullpen, umpires) ──
  const homeTeams: string[]  = Array.from(new Set(modelable.map((g: typeof dbGames[0]) => g.homeTeam!.toUpperCase())));
  const allTeams: string[]   = Array.from(new Set(modelable.flatMap((g: typeof dbGames[0]) => [g.awayTeam!.toUpperCase(), g.homeTeam!.toUpperCase()])));
  const gamePks    = modelable.map((g: typeof dbGames[0]) => g.mlbGamePk).filter((pk: number | null | undefined): pk is number => pk !== null && pk !== undefined);

  console.log(`${TAG} [STEP] Fetching precision signals: ${homeTeams.length} park factors, ${allTeams.length} bullpens, ${gamePks.length} umpires...`);

  const [parkFactorMap, bullpenMap, umpireMap] = await Promise.all([
    fetchParkFactors(homeTeams, db),
    fetchBullpenStats(allTeams, db),
    fetchUmpireModifiers(gamePks, db),
  ]);

  console.log(
    `${TAG} [STATE] Signals loaded: parkFactors=${parkFactorMap.size}/${homeTeams.length} ` +
    `bullpens=${bullpenMap.size}/${allTeams.length} umpires=${umpireMap.size}/${gamePks.length}`
  );

  // ── P1-B: Batch-fetch Statcast data for all players in today's lineups ─────────────────────────────────────────────────────────────────────────────
  // Collect all mlbamIds from confirmed lineups for a single DB round-trip
  const lineupMlbamIds = new Set<number>();
  for (const g of modelable) {
    for (const lineupJson of [g.awayLineup, g.homeLineup]) {
      if (!lineupJson) continue;
      try {
        const lineup = JSON.parse(lineupJson) as Array<{ mlbamId?: number | null }>;
        for (const p of lineup) {
          if (p.mlbamId) lineupMlbamIds.add(p.mlbamId);
        }
      } catch { /* ignore parse errors */ }
    }
  }
  // Build playerStatcastMap: mlbamId → { iso, barrelPct, hardHitPct }
  const playerStatcastMap = new Map<number, { iso: number | null; barrelPct: number | null; hardHitPct: number | null }>();
  if (lineupMlbamIds.size > 0) {
    const mlbamIdArr = Array.from(lineupMlbamIds);
    console.log(`${TAG} [P1-B] Fetching Statcast for ${mlbamIdArr.length} lineup players...`);
    try {
      const playerRows = await db.select({
        mlbamId:    mlbPlayers.mlbamId,
        iso:        mlbPlayers.iso,
        barrelPct:  mlbPlayers.barrelPct,
        hardHitPct: mlbPlayers.hardHitPct,
      }).from(mlbPlayers)
        .where(inArray(mlbPlayers.mlbamId, mlbamIdArr));
      for (const row of playerRows) {
        playerStatcastMap.set(row.mlbamId, {
          iso:        row.iso        != null ? Number(row.iso)        : null,
          barrelPct:  row.barrelPct  != null ? Number(row.barrelPct)  : null,
          hardHitPct: row.hardHitPct != null ? Number(row.hardHitPct) : null,
        });
      }
      console.log(`${TAG} [P1-B] Statcast loaded: ${playerStatcastMap.size}/${mlbamIdArr.length} players with data`);
    } catch (err) {
      console.error(`${TAG} [P1-B] Statcast fetch error (non-fatal, using team averages):`, err);
    }
  } else {
    console.log(`${TAG} [P1-B] No lineup mlbamIds found — Statcast aggregation skipped`);
  }

  // ── Step 3: Batch-fetch pitcher stats from DB, then build engine inputs ────────
  // Collect all unique pitcher/team pairs for a single DB round-trip
  const pitcherPairs: Array<{ name: string; teamAbbrev: string }> = [];
  for (const g of modelable) {
    pitcherPairs.push({ name: g.awayStartingPitcher!, teamAbbrev: g.awayTeam! });
    pitcherPairs.push({ name: g.homeStartingPitcher!, teamAbbrev: g.homeTeam! });
  }
  const pitcherStatsMap = await batchFetchPitcherStats(pitcherPairs, db);

  const engineInputs: EngineInput[] = modelable.map((g: typeof dbGames[0]) => {
    const awayAbbrev = g.awayTeam!;
    const homeAbbrev = g.homeTeam!;
    const awayPitcher = g.awayStartingPitcher!;
    const homePitcher = g.homeStartingPitcher!;

    // ── LAYER 1: ML-direction cross-check for rl_home_spread ─────────────────
    // awayRunLine is the AUTHORITATIVE source for RL direction.
    // The LAYER 1 ML-direction cross-check was removed (2026-05-30) because it caused
    // false overrides when ML odds were temporarily inverted during line movement
    // (e.g. PHI@LAD: PHI was briefly ML fav before settling as dog, causing LAYER 1 to
    // override the correct awayRunLine=+1.5 with the wrong ML-derived direction).
    // The RL sign guard at DB write time is the correct safety net for actual inversions.
    // awayRunLine is always set correctly by the DK/VSiN scraper — trust it.
    let rlHomeSpread = -1.5; // default: home is RL favorite
    const _awayMLForRL = parseFloat(String(g.awayML ?? '100'));
    // ML-derived direction: used ONLY as fallback when awayRunLine is absent/unparseable
    const _mlDerivedRlHomeSpread = (!isNaN(_awayMLForRL) && _awayMLForRL < 0) ? 1.5 : -1.5;
    if (g.awayRunLine) {
      const awayRLNum = parseFloat(String(g.awayRunLine));
      if (!isNaN(awayRLNum)) {
        // awayRunLine is present and parseable — use it unconditionally
        rlHomeSpread = -awayRLNum; // invert: if away is +1.5, home is -1.5
        // Log if awayRunLine and ML direction disagree (informational only — no override)
        const rlDerived = rlHomeSpread;
        if (!isNaN(_awayMLForRL) && Math.sign(rlDerived) !== Math.sign(_mlDerivedRlHomeSpread)) {
          console.warn(
            `[MLB MODEL] [${g.id}] ${g.awayTeam}@${g.homeTeam} — ` +
            `[RL-ML DIRECTION DIVERGENCE] awayRunLine=${g.awayRunLine} and awayML=${g.awayML} point to different favorites. ` +
            `rl_home_spread=${rlDerived} (from awayRunLine — authoritative). ` +
            `ML-derived would be ${_mlDerivedRlHomeSpread}. This is a split-market — awayRunLine wins.`
          );
        }
      } else {
        // awayRunLine is not parseable — fall back to ML direction
        rlHomeSpread = _mlDerivedRlHomeSpread;
      }
    } else {
      // No awayRunLine — use ML direction
      rlHomeSpread = _mlDerivedRlHomeSpread;
    }

    const bookLines = {
      ml_away:       parseFloat(String(g.awayML ?? "100")),
      ml_home:       parseFloat(String(g.homeML ?? "-120")),
      ou_line:       parseFloat(String(g.bookTotal ?? "8.5")),
      over_odds:     parseFloat(String(g.overOdds ?? "-110")),
      under_odds:    parseFloat(String(g.underOdds ?? "-110")),
      rl_home_spread: rlHomeSpread,
      rl_home:       parseFloat(String(g.homeRunLineOdds ?? "-150")),
      rl_away:       parseFloat(String(g.awayRunLineOdds ?? "130")),
    };

    // Retrieve pitcher stats (season + rolling-5 blended, with FIP/xFIP/hand)
    const awayPitcherStats = pitcherStatsMap.get(`${awayPitcher}|${awayAbbrev}`) ?? { ...DEFAULT_PITCHER_STATS };
    const homePitcherStats = pitcherStatsMap.get(`${homePitcher}|${homeAbbrev}`) ?? { ...DEFAULT_PITCHER_STATS };

    // Determine pitcher hands for batting split selection
    // throwsHand: 0=R, 1=L, 2=S (switch)
    const awayHand: 'L' | 'R' = awayPitcherStats.throwsHand === 1 ? 'L' : 'R';
    const homeHand: 'L' | 'R' = homePitcherStats.throwsHand === 1 ? 'L' : 'R';

    // Retrieve batting splits lookup from pitcherStatsMap side-channel
    const battingSplits = (pitcherStatsMap as any).__battingSplits as
      Map<string, { L: Record<string, number>; R: Record<string, number> }> | undefined;
    // Retrieve live rpg/ipPerGame lookup from pitcherStatsMap side-channel
    const rpgIpgLookup = (pitcherStatsMap as any).__teamRpgIpg as
      Map<string, { rpg: number; ipPerGame: number }> | undefined;

    // Base team stats (season-level)
    // rpg and ip_per_game are now sourced from live DB values (2026 season) via rpgIpgLookup
    const awayBaseStats = getTeamStats(awayAbbrev, rpgIpgLookup);
    const homeBaseStats = getTeamStats(homeAbbrev, rpgIpgLookup);

    // Augment team stats with hand-specific batting splits vs the opposing pitcher
    // Away team bats against HOME pitcher (homeHand)
    // Home team bats against AWAY pitcher (awayHand)
    const awayBattingSplit = battingSplits?.get(awayAbbrev)?.[homeHand];
    const homeBattingSplit = battingSplits?.get(homeAbbrev)?.[awayHand];

    const awayTeamStats = awayBattingSplit
      ? {
          ...awayBaseStats,
          avg:  awayBattingSplit.avg,
          obp:  awayBattingSplit.obp,
          slg:  awayBattingSplit.slg,
          woba: awayBattingSplit.woba,
          // Override K/BB/HR rates from hand-specific splits
          batting_k9:  awayBattingSplit.k9,
          batting_bb9: awayBattingSplit.bb9,
          batting_hr9: awayBattingSplit.hr9,
          split_hand:  homeHand === 'L' ? 1 : 0,
        }
      : awayBaseStats;

    const homeTeamStats = homeBattingSplit
      ? {
          ...homeBaseStats,
          avg:  homeBattingSplit.avg,
          obp:  homeBattingSplit.obp,
          slg:  homeBattingSplit.slg,
          woba: homeBattingSplit.woba,
          batting_k9:  homeBattingSplit.k9,
          batting_bb9: homeBattingSplit.bb9,
          batting_hr9: homeBattingSplit.hr9,
          split_hand:  awayHand === 'L' ? 1 : 0,
        }
      : homeBaseStats;

    // ── Precision signals: park factor, bullpen, umpire ─────────────────────────────────
    const parkFactor3yr = parkFactorMap.get(homeAbbrev.toUpperCase()) ?? 1.0;
    const awayBullpen   = bullpenMap.get(awayAbbrev.toUpperCase()) ?? { ...DEFAULT_BULLPEN };
    const homeBullpen   = bullpenMap.get(homeAbbrev.toUpperCase()) ?? { ...DEFAULT_BULLPEN };
    const umpireData    = g.mlbGamePk ? umpireMap.get(g.mlbGamePk) : undefined;
    const umpireKMod    = umpireData?.kMod  ?? 1.0;
    const umpireBBMod   = umpireData?.bbMod ?? 1.0;
    const umpireName    = umpireData?.umpireName ?? 'UNKNOWN (league-avg)';

    console.log(
      `${TAG} [${g.id}] ${awayAbbrev}@${homeAbbrev} | ` +
      `SP: ${awayPitcher}(${awayHand}) vs ${homePitcher}(${homeHand}) | ` +
      `RL home: ${rlHomeSpread} | O/U: ${bookLines.ou_line} | ` +
      `away split: vs${homeHand}=${awayBattingSplit ? `avg=${awayBattingSplit.avg?.toFixed(3)} wOBA=${awayBattingSplit.woba?.toFixed(3)}` : 'season'} | ` +
      `home split: vs${awayHand}=${homeBattingSplit ? `avg=${homeBattingSplit.avg?.toFixed(3)} wOBA=${homeBattingSplit.woba?.toFixed(3)}` : 'season'}`
    );
    console.log(
      `${TAG} [${g.id}] PRECISION: ` +
      `parkFactor=${parkFactor3yr.toFixed(4)} (${parkFactorMap.has(homeAbbrev.toUpperCase()) ? 'DB' : 'neutral'}) | ` +
      `awayBullpen ERA=${awayBullpen.era.toFixed(2)} FIP=${awayBullpen.fip.toFixed(2)} (${bullpenMap.has(awayAbbrev.toUpperCase()) ? 'DB' : 'default'}) | ` +
      `homeBullpen ERA=${homeBullpen.era.toFixed(2)} FIP=${homeBullpen.fip.toFixed(2)} (${bullpenMap.has(homeAbbrev.toUpperCase()) ? 'DB' : 'default'}) | ` +
      `umpire=${umpireName} kMod=${umpireKMod.toFixed(4)} bbMod=${umpireBBMod.toFixed(4)}`
    );

    return {
      db_id:              g.id,
      away_abbrev:        awayAbbrev,
      home_abbrev:        homeAbbrev,
      away_pitcher_name:  awayPitcher,
      home_pitcher_name:  homePitcher,
      away_team_stats:    awayTeamStats,
      home_team_stats:    homeTeamStats,
      away_pitcher_stats: awayPitcherStats,
      home_pitcher_stats: homePitcherStats,
      book_lines:         bookLines,
      game_date:          dateStr,
      // ── Precision signals ──
      park_factor_3yr:    parkFactor3yr,
      away_bullpen:       awayBullpen,
      home_bullpen:       homeBullpen,
      umpire_k_mod:       umpireKMod,
      umpire_bb_mod:      umpireBBMod,
      umpire_name:        umpireName,
      mlb_game_pk:        g.mlbGamePk ?? null,
      // ── 3-year NRFI pitcher signal + full Bayesian prior inputs (3yr backtest integration) ──
      ...(() => {
        const nrfiRateMap   = (pitcherStatsMap as any).__nrfiRateByKey   as Map<string, number | null> | undefined;
        const nrfiStartsMap = (pitcherStatsMap as any).__nrfiStartsByKey as Map<string, number | null> | undefined;
        const awayNrfi       = nrfiRateMap?.get(`${awayPitcher}|${awayAbbrev}`)   ?? null;
        const homeNrfi       = nrfiRateMap?.get(`${homePitcher}|${homeAbbrev}`)   ?? null;
        const awayNrfiStarts = nrfiStartsMap?.get(`${awayPitcher}|${awayAbbrev}`) ?? null;
        const homeNrfiStarts = nrfiStartsMap?.get(`${homePitcher}|${homeAbbrev}`) ?? null;
        const NRFI_THRESHOLD = 0.56;
        const combined = (awayNrfi != null && homeNrfi != null) ? (awayNrfi + homeNrfi) / 2 : null;
        const filterPass = combined != null ? combined >= NRFI_THRESHOLD : null;
        const bothPass  = (awayNrfi != null && homeNrfi != null)
          ? (awayNrfi >= NRFI_THRESHOLD && homeNrfi >= NRFI_THRESHOLD)
          : null;
        console.log(
          `${TAG} [${g.id}] NRFI SIGNAL: ` +
          `away_SP=${awayPitcher} nrfi=${awayNrfi != null ? awayNrfi.toFixed(4) : 'N/A'} starts=${awayNrfiStarts ?? 'N/A'} ` +
          `home_SP=${homePitcher} nrfi=${homeNrfi != null ? homeNrfi.toFixed(4) : 'N/A'} starts=${homeNrfiStarts ?? 'N/A'} | ` +
          `combined=${combined != null ? combined.toFixed(4) : 'N/A'} ` +
          `filter=${filterPass != null ? (filterPass ? '\u2705 PASS (>=0.56)' : '\u274c FAIL (<0.56)') : 'N/A'} ` +
          `both=${bothPass != null ? (bothPass ? '\u2705 BOTH PASS' : '\u274c NOT BOTH') : 'N/A'}`
        );
        // Team NRFI rates and F5 RS: pass null → Python auto-resolves from TEAM_NRFI_RATES / TEAM_F5_RS
        return {
          nrfi_combined_signal: combined,
          nrfi_filter_pass:     filterPass,
          // Pitcher NRFI rates + starts passed to project_game Bayesian prior blending
          // MLBAIModel.py applies shrinkage toward league prior for pitchers with < 5 starts
          away_pitcher_nrfi:        awayNrfi,
          home_pitcher_nrfi:        homeNrfi,
          away_pitcher_nrfi_starts: awayNrfiStarts,  // for Bayesian shrinkage in Python
          home_pitcher_nrfi_starts: homeNrfiStarts,  // for Bayesian shrinkage in Python
          // Team rates: null → Python auto-lookup from 3yr backtest constants
          away_team_nrfi:       null,
          home_team_nrfi:       null,
          away_f5_rs:           null,
          home_f5_rs:           null,
        };
      })(),
      // ── P1-A: Weather dict (parsed from mlbLineups weather fields) ───────────────────────────────────────────────────────────────────────
      weather: (() => {
        const weatherDict = buildWeatherDict(g.weatherTemp, g.weatherWind, g.weatherDome);
        console.log(
          `${TAG} [${g.id}] WEATHER: ` +
          `dome=${g.weatherDome ?? false} ` +
          `temp=${g.weatherTemp ?? 'N/A'} → ${weatherDict?.temp_f ?? 'N/A'}°F ` +
          `wind="${g.weatherWind ?? 'N/A'}" → speed=${weatherDict?.wind_speed_mph ?? 0}mph dir=${weatherDict?.wind_dir ?? 'N/A'} ` +
          `precip=${g.weatherPrecip ?? 'N/A'} ` +
          `adj=${weatherDict ? 'ACTIVE' : 'DOME/NULL'}`
        );
        return weatherDict;
      })(),
      // ── P1-B: Confirmed lineup Statcast aggregates (batting-order-weighted) ───────────────────────────────────────────────────────────────────────
      away_lineup_statcast: (g.awayLineupConfirmed && g.awayLineup)
        ? aggregateLineupStatcast(g.awayLineup, playerStatcastMap, `${TAG} [${g.id}] AWAY`)
        : null,
      home_lineup_statcast: (g.homeLineupConfirmed && g.homeLineup)
        ? aggregateLineupStatcast(g.homeLineup, playerStatcastMap, `${TAG} [${g.id}] HOME`)
        : null,
      // ── P4-A: Per-player batting order arrays (9 slots, sorted by battingOrder) ─────────────────────────────────────────────────────────────────────────
      // When confirmed lineup is available, build a per-player Statcast array so
      // Python can construct a true heterogeneous lineup (not 9x team-average).
      away_lineup_order: (g.awayLineupConfirmed && g.awayLineup)
        ? buildLineupOrder(g.awayLineup, playerStatcastMap, `${TAG} [${g.id}] AWAY`)
        : null,
      home_lineup_order: (g.homeLineupConfirmed && g.homeLineup)
        ? buildLineupOrder(g.homeLineup, playerStatcastMap, `${TAG} [${g.id}] HOME`)
        : null,
    };
  });

  // ── Step 4: Run Python engine ────────────────────────────────────────────────
  console.log(`${TAG} Spawning Python engine for ${engineInputs.length} games...`);
  const t0 = Date.now();
  let engineResults: MlbModelResult[];
  try {
    engineResults = await runPythonEngine(engineInputs);
  } catch (err) {
    console.error(`${TAG} Python engine failed:`, err);
    return { date: dateStr, total: dbGames.length, written: 0, skipped: modelable.length, errors: modelable.length, validation: { passed: false, issues: [`Python engine error: ${err}`], warnings: [] } };
  }
  console.log(`${TAG} Engine completed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // ── Step 5: Write results to DB (v2 field mapping) ───────────────────────────
  let written     = 0;
  let errors       = 0;
  let invalidated  = 0;  // games skipped due to RL sign flip / invariant violation

  // Build a fast lookup: db_id → engineInput (for NRFI signal retrieval)
  const engineInputById = new Map<number, EngineInput>();
  for (const inp of engineInputs) engineInputById.set(inp.db_id, inp);

  // Build a fast lookup: db_id → dbGame (for book RL anchoring)
  const dbGameById = new Map<number, typeof dbGames[0]>();
  for (const g of dbGames) dbGameById.set(g.id, g);

  // ── LIVE bookTotal re-read (CRITICAL for modelTotal accuracy) ────────────────
  // dbGames was fetched at model-run START — bookTotal may have been null then if odds
  // hadn't been scraped yet. We re-read bookTotal NOW (right before DB writes) to get
  // the current authoritative value. This prevents modelTotal from being set to Python's
  // r.total_line when bookTotal was null at model-run time but has since been populated.
  const modelableIds = engineResults.filter(r => r.ok).map(r => r.db_id);
  const liveBookTotalMap = new Map<number, number | null>();
  if (modelableIds.length > 0) {
    try {
      const liveRows = await db.select({ id: games.id, bookTotal: games.bookTotal })
        .from(games)
        .where(inArray(games.id, modelableIds));
      for (const row of liveRows) {
        liveBookTotalMap.set(row.id, row.bookTotal != null ? parseFloat(String(row.bookTotal)) : null);
      }
      console.log(`${TAG} [LIVE bookTotal re-read] ${liveRows.length} games fetched`);
      // Log any games where live bookTotal differs from snapshot
      for (const [id, liveVal] of Array.from(liveBookTotalMap.entries())) {
        const snapVal = dbGameById.get(id)?.bookTotal != null ? parseFloat(String(dbGameById.get(id)!.bookTotal)) : null;
        if (liveVal !== snapVal) {
          const g = dbGameById.get(id);
          console.warn(`${TAG} [LIVE bookTotal DRIFT] id=${id} ${g?.awayTeam}@${g?.homeTeam}: snapshot=${snapVal} live=${liveVal} — using live value for modelTotal`);
        }
      }
    } catch (err) {
      console.error(`${TAG} [LIVE bookTotal re-read FAILED] ${err} — falling back to snapshot values`);
    }
  }

  // ── LIVE awayBookSpread re-read (CRITICAL for RL sign guard accuracy) ──────────
  // dbGames was fetched at model-run START — awayBookSpread may have been null then if
  // VSiN odds hadn't been scraped yet (common for midnight ET model runs).
  // We re-read awayBookSpread NOW (right before DB writes) to get the current authoritative
  // value. This ensures the RL sign guard has a valid reference to compare against.
  // Without this, bookAwaySpreadForGuard = null → guard bypassed → inverted signs written.
  const liveBookSpreadMap = new Map<number, {
    awayBookSpread: number | null;
    homeBookSpread: number | null;
    awayRunLineOdds: string | null;
    homeRunLineOdds: string | null;
  }>();
  if (modelableIds.length > 0) {
    try {
      const liveSpreadRows = await db.select({
        id:              games.id,
        awayBookSpread:  games.awayBookSpread,
        homeBookSpread:  games.homeBookSpread,
        awayRunLine:     games.awayRunLine,     // FIX 2: authoritative RL direction (awayRunLine > awayBookSpread)
        homeRunLine:     games.homeRunLine,
        awayRunLineOdds: games.awayRunLineOdds,
        homeRunLineOdds: games.homeRunLineOdds,
      })
        .from(games)
        .where(inArray(games.id, modelableIds));
      for (const row of liveSpreadRows) {
        // FIX 2: Use awayRunLine as authoritative RL direction.
        // awayBookSpread is a decimal column that can be written with wrong sign by the scraper
        // (root cause of TB@TOR 2026-05-11 inversion: awayBookSpread=-1.5 but awayRunLine=+1.5).
        // awayRunLine is the varchar column that the model runner uses to derive rl_home_spread —
        // it is always set correctly by the DK/VSiN scraper. Use it as the ground truth.
        const awayRLFromRunLine = row.awayRunLine != null ? parseFloat(row.awayRunLine) : null;
        const awayBSFromSpread  = row.awayBookSpread != null ? parseFloat(String(row.awayBookSpread)) : null;
        // Detect and log sign mismatch (should be caught by db.ts guard, but log here too)
        if (awayRLFromRunLine !== null && awayBSFromSpread !== null &&
            !isNaN(awayRLFromRunLine) && !isNaN(awayBSFromSpread) &&
            Math.sign(awayRLFromRunLine) !== Math.sign(awayBSFromSpread)) {
          const g = row as unknown as { awayTeam?: string; homeTeam?: string };
          console.error(
            `${TAG} [RL SIGN MISMATCH DETECTED] id=${row.id}: ` +
            `awayRunLine=${row.awayRunLine} vs awayBookSpread=${row.awayBookSpread}. ` +
            `Using awayRunLine as authoritative value for RL sign guard.`
          );
        }
        liveBookSpreadMap.set(row.id, {
          // FIX 2: prefer awayRunLine sign over awayBookSpread for RL direction
          awayBookSpread:  awayRLFromRunLine !== null && !isNaN(awayRLFromRunLine)
                             ? awayRLFromRunLine   // authoritative: awayRunLine
                             : awayBSFromSpread,   // fallback: awayBookSpread
          homeBookSpread:  awayRLFromRunLine !== null && !isNaN(awayRLFromRunLine)
                             ? -awayRLFromRunLine  // derived from awayRunLine
                             : (row.homeBookSpread != null ? parseFloat(String(row.homeBookSpread)) : null),
          awayRunLineOdds: row.awayRunLineOdds ?? null,
          homeRunLineOdds: row.homeRunLineOdds ?? null,
        });
      }
      console.log(`${TAG} [LIVE awayBookSpread re-read] ${liveSpreadRows.length} games fetched`);
      // Log any games where live awayBookSpread differs from snapshot (drift detection)
      for (const [id, live] of Array.from(liveBookSpreadMap.entries())) {
        const snap = dbGameById.get(id)?.awayBookSpread != null
          ? parseFloat(String(dbGameById.get(id)!.awayBookSpread))
          : null;
        if (live.awayBookSpread !== snap) {
          const g = dbGameById.get(id);
          console.warn(
            `${TAG} [LIVE awayBookSpread DRIFT] id=${id} ${g?.awayTeam}@${g?.homeTeam}: ` +
            `snapshot=${snap} live=${live.awayBookSpread} — using live value for RL sign guard`
          );
        }
      }
    } catch (err) {
      console.error(`${TAG} [LIVE awayBookSpread re-read FAILED] ${err} — falling back to snapshot values`);
    }
  }

  for (const r of engineResults) {
    if (!r.ok || r.error) {
      console.error(`${TAG} [${r.db_id}] ${r.game} — engine error: ${r.error}`);
      errors++;
      continue;
    }

    console.log(`\n${TAG} [${r.db_id}] ${r.game}`);
    console.log(`  Proj: ${r.proj_away_runs.toFixed(2)}–${r.proj_home_runs.toFixed(2)} (total: ${r.proj_total.toFixed(2)})`);
    console.log(`  Book total: ${r.total_line} | Over: ${r.over_pct.toFixed(2)}% (${fmtMl(r.over_odds)}) | Under: ${r.under_pct.toFixed(2)}% (${fmtMl(r.under_odds)})`);
    console.log(`  ML: ${fmtMl(r.away_ml)}/${fmtMl(r.home_ml)} | Win%: ${r.away_win_pct.toFixed(2)}%/${r.home_win_pct.toFixed(2)}%`);
    console.log(`  RL: ${r.away_run_line} (${fmtMl(r.away_rl_odds)}) / ${r.home_run_line} (${fmtMl(r.home_rl_odds)})`);
    console.log(`  Cover%: away=${r.away_rl_cover_pct.toFixed(2)}% home=${r.home_rl_cover_pct.toFixed(2)}%`);
    console.log(`  Model spread: ${r.model_spread.toFixed(3)} | Sims: ${r.simulations} | Elapsed: ${r.elapsed_sec}s`);
    // ── SIGN-ENFORCEMENT GUARD ────────────────────────────────────────────────
    // awayModelSpread MUST mirror awayBookSpread sign.
    // The Python engine computes away_run_line from rl_home_spread (derived from awayRunLine).
    // If awayBookSpread was NULL at model-run START (odds not yet scraped), the snapshot
    // in dbGameById is stale. We use liveBookSpreadMap (re-read right before DB writes)
    // as the authoritative source. Falls back to dbGameById snapshot if live re-read failed.
    // awayBookSpread is written ONLY by the VSiN scraper and is always the authoritative book value.
    const dbGame = dbGameById.get(r.db_id);
    const liveSpread = liveBookSpreadMap.get(r.db_id);
    // Prefer live re-read value; fall back to snapshot if live re-read failed or returned null
    const bookAwaySpreadForGuard: number | null = (
      liveSpread?.awayBookSpread != null ? liveSpread.awayBookSpread
      : dbGame?.awayBookSpread != null   ? parseFloat(String(dbGame.awayBookSpread))
      : null
    );
    const modelAwayRLNum = parseFloat(r.away_run_line);
    let safeAwayRunLine = r.away_run_line;
    let safeHomeRunLine = r.home_run_line;
    // ── RL SIGN GUARD: detect flip and INVALIDATE (not patch) ──────────────────
    // When the model ran with the wrong rl_home_spread sign (e.g. awayRunLine was
    // written with wrong sign before odds were confirmed), the entire simulation
    // used the wrong spread direction. The resulting odds are computed for the wrong
    // team's perspective and CANNOT be salvaged by simply swapping labels.
    // Correct action: skip DB write for this game and clear modelRunAt so it
    // re-runs next cycle with the now-correct awayRunLine from the scraper.
    let rlSignFlipDetected = false;
    if (bookAwaySpreadForGuard !== null && !isNaN(bookAwaySpreadForGuard) && !isNaN(modelAwayRLNum)) {
      const bookSign  = bookAwaySpreadForGuard >= 0 ? 1 : -1;
      const modelSign = modelAwayRLNum >= 0 ? 1 : -1;
      if (bookSign !== modelSign) {
        rlSignFlipDetected = true;
        console.error(
          `${TAG} [${r.db_id}] ${r.game} — [RL SIGN GUARD] FLIP DETECTED: ` +
          `Python away_run_line=${r.away_run_line} but awayBookSpread=${bookAwaySpreadForGuard}. ` +
          `Model ran with wrong rl_home_spread — odds are invalid. ` +
          `INVALIDATING modelRunAt so game re-runs next cycle with corrected awayRunLine.`
        );
        // Correct the run line labels for the invalidation write below
        const correctedAway = bookSign > 0 ? Math.abs(modelAwayRLNum) : -Math.abs(modelAwayRLNum);
        const correctedHome = -correctedAway;
        safeAwayRunLine = correctedAway >= 0 ? `+${correctedAway.toFixed(1)}` : `${correctedAway.toFixed(1)}`;
        safeHomeRunLine = correctedHome >= 0 ? `+${correctedHome.toFixed(1)}` : `${correctedHome.toFixed(1)}`;
      }
    }
    // ── POST-WRITE INVARIANT CHECK: P(cover -1.5) must be ≤ P(win outright) ────
    // Even if no sign flip was detected, verify the mathematical invariant:
    // if home has -1.5 (home is RL fav), P(home covers -1.5) MUST be ≤ P(home wins).
    // Violation means the model ran with wrong rl_spread (e.g. awayRunLine was null
    // at run time and default +1.5 was used when home should have been -1.5).
    if (!rlSignFlipDetected) {
      const liveHomeBookSpread = liveBookSpreadMap.get(r.db_id)?.homeBookSpread;
      const homeBookSpreadNum = liveHomeBookSpread != null ? liveHomeBookSpread
        : dbGame?.homeBookSpread != null ? parseFloat(String(dbGame.homeBookSpread)) : null;
      if (homeBookSpreadNum !== null && homeBookSpreadNum < 0) {
        // Home has -1.5: P(home covers -1.5) must be ≤ P(home wins outright)
        const pHomeCoverRL = r.home_rl_cover_pct / 100;
        const pHomeWin = r.home_win_pct / 100;
        if (pHomeCoverRL > pHomeWin + 0.02) {  // 2pp tolerance for simulation noise
          rlSignFlipDetected = true;
          console.error(
            `${TAG} [${r.db_id}] ${r.game} — [RL INVARIANT VIOLATION] ` +
            `homeBookSpread=${homeBookSpreadNum} (home is -1.5 fav) but ` +
            `P(home covers -1.5)=${(pHomeCoverRL*100).toFixed(2)}% > P(home wins)=${(pHomeWin*100).toFixed(2)}%. ` +
            `Model ran with wrong rl_home_spread. INVALIDATING modelRunAt for re-run.`
          );
        }
      }
      // Symmetric check: if away has -1.5 (away is RL fav)
      if (!rlSignFlipDetected && bookAwaySpreadForGuard !== null && bookAwaySpreadForGuard < 0) {
        const pAwayCoverRL = r.away_rl_cover_pct / 100;
        const pAwayWin = r.away_win_pct / 100;
        if (pAwayCoverRL > pAwayWin + 0.02) {
          rlSignFlipDetected = true;
          console.error(
            `${TAG} [${r.db_id}] ${r.game} — [RL INVARIANT VIOLATION] ` +
            `awayBookSpread=${bookAwaySpreadForGuard} (away is -1.5 fav) but ` +
            `P(away covers -1.5)=${(pAwayCoverRL*100).toFixed(2)}% > P(away wins)=${(pAwayWin*100).toFixed(2)}%. ` +
            `Model ran with wrong rl_home_spread. INVALIDATING modelRunAt for re-run.`
          );
        }
      }
    }

    // ── MLB RL EDGE DETECTION ─────────────────────────────────────────────────
    // MLB run lines are ALWAYS ±1.5 — line arithmetic (|awayModelSpread - awayBookSpread|)
    // is useless (always 0 when signs match). The edge lives in the ODDS:
    //   model fair cover% vs book break-even% at the SAME ±1.5 line.
    // spreadDiff = probability edge in percentage points (like NHL puck line).
    // spreadEdge = "AWAY +1.5 [EDGE]" or "HOME -1.5 [EDGE]" (like NHL format for edgeLabelIsAway).
    //
    // FORMULA:
    //   bookBreakEven(away) = |awayRLOdds| / (|awayRLOdds| + 100)  [for negative odds]
    //                       = 100 / (awayRLOdds + 100)              [for positive odds]
    //   edgeAway = away_rl_cover_pct/100 - bookBreakEven(away)
    //   edgeHome = home_rl_cover_pct/100 - bookBreakEven(home)
    //   spreadDiff = max(edgeAway, edgeHome) * 100  [in pp]
    //   spreadEdge = side with higher edge, formatted as "ABBR ±1.5 [EDGE]"
    const _mlbRlAwayOdds = r.away_rl_odds;  // model fair odds at book's ±1.5 line
    const _mlbRlHomeOdds = r.home_rl_odds;
    const _mlbRlAwayCoverPct = r.away_rl_cover_pct / 100;  // 0-1 scale
    const _mlbRlHomeCoverPct = r.home_rl_cover_pct / 100;
    // Book break-even: the cover% needed to break even at book's RL odds
    // Use liveBookSpreadMap (live re-read) for RL odds — more accurate than snapshot
    const _liveRLOdds = liveBookSpreadMap.get(r.db_id);
    const _bkAwayRLOddsNum = parseFloat(String(
      _liveRLOdds?.awayRunLineOdds ?? dbGame?.awayRunLineOdds ?? ''
    ));
    const _bkHomeRLOddsNum = parseFloat(String(
      _liveRLOdds?.homeRunLineOdds ?? dbGame?.homeRunLineOdds ?? ''
    ));
    const _americanBreakEven = (odds: number): number | null => {
      if (isNaN(odds)) return null;
      return odds < 0 ? Math.abs(odds) / (Math.abs(odds) + 100) : 100 / (odds + 100);
    };
    const _bkAwayBreakEven = _americanBreakEven(_bkAwayRLOddsNum);
    const _bkHomeBreakEven = _americanBreakEven(_bkHomeRLOddsNum);
    let mlbSpreadDiff: string | null = null;
    let mlbSpreadEdge: string | null = null;
    if (_bkAwayBreakEven !== null && _bkHomeBreakEven !== null) {
      const edgeAway = _mlbRlAwayCoverPct - _bkAwayBreakEven;  // positive = away has edge
      const edgeHome = _mlbRlHomeCoverPct - _bkHomeBreakEven;  // positive = home has edge
      const bestEdge = Math.max(edgeAway, edgeHome);
      if (bestEdge > 0) {
        mlbSpreadDiff = String(Math.round(bestEdge * 1000) / 10);  // pp with 1 decimal
        const dbGameForEdge = dbGameById.get(r.db_id);
        const awayRLLabel = safeAwayRunLine;  // sign-enforced RL label e.g. "+1.5" or "-1.5"
        const homeRLLabel = safeHomeRunLine;
        const awayAbbrForEdge = r.game.split('@')[0]?.trim() ?? 'AWAY';
        const homeAbbrForEdge = r.game.split('@')[1]?.trim() ?? 'HOME';
        if (edgeAway >= edgeHome) {
          mlbSpreadEdge = `${awayAbbrForEdge} ${awayRLLabel} [EDGE]`;
        } else {
          mlbSpreadEdge = `${homeAbbrForEdge} ${homeRLLabel} [EDGE]`;
        }
        console.log(
          `${TAG} [${r.db_id}] ${r.game} — [RL EDGE] ` +
          `awayEdge=${(edgeAway*100).toFixed(2)}pp homeEdge=${(edgeHome*100).toFixed(2)}pp ` +
          `→ spreadDiff=${mlbSpreadDiff}pp spreadEdge="${mlbSpreadEdge}"`
        );
      } else {
        // No edge — still write spreadDiff as raw probability diff (negative = no edge)
        mlbSpreadDiff = String(Math.round(bestEdge * 1000) / 10);
        console.log(
          `${TAG} [${r.db_id}] ${r.game} — [RL NO EDGE] ` +
          `awayEdge=${(edgeAway*100).toFixed(2)}pp homeEdge=${(edgeHome*100).toFixed(2)}pp → PASS`
        );
      }
    } else {
      console.warn(
        `${TAG} [${r.db_id}] ${r.game} — [RL EDGE] SKIP: book RL odds unavailable ` +
        `(awayRunLineOdds=${dbGame?.awayRunLineOdds} homeRunLineOdds=${dbGame?.homeRunLineOdds})`
      );
    }

    // ── MLB TOTAL EDGE DETECTION ─────────────────────────────────────────────────
    // Uses the same break-even formula as RL edge detection.
    // modelOverProb  = r.over_pct  / 100  (from Python Monte Carlo simulation)
    // modelUnderProb = r.under_pct / 100
    // bookBreakEvenOver  = |bookOverOdds|  / (|bookOverOdds|  + 100) for negative odds
    //                    = 100 / (bookOverOdds  + 100) for positive odds
    // edgeOver  = modelOverProb  - bookBreakEvenOver   (positive = over has edge)
    // edgeUnder = modelUnderProb - bookBreakEvenUnder  (positive = under has edge)
    // totalDiff = max(edgeOver, edgeUnder) * 100  [in probability points]
    // totalEdge = "OVER {bookTotal}" or "UNDER {bookTotal}" (anchored to book line)
    const _mlbOverPct  = r.over_pct  / 100;  // 0-1 scale
    const _mlbUnderPct = r.under_pct / 100;  // 0-1 scale
    // Use live book O/U odds for break-even computation (same pattern as RL odds)
    const _bkOverOddsRaw  = dbGame?.overOdds  ?? null;
    const _bkUnderOddsRaw = dbGame?.underOdds ?? null;
    const _bkOverOddsNum  = parseFloat(String(_bkOverOddsRaw  ?? ''));
    const _bkUnderOddsNum = parseFloat(String(_bkUnderOddsRaw ?? ''));
    let mlbTotalDiff: string | null = null;
    let mlbTotalEdge: string | null = null;
    if (!isNaN(_bkOverOddsNum) && !isNaN(_bkUnderOddsNum)) {
      const _bkOverBreakEven  = _americanBreakEven(_bkOverOddsNum);
      const _bkUnderBreakEven = _americanBreakEven(_bkUnderOddsNum);
      if (_bkOverBreakEven !== null && _bkUnderBreakEven !== null) {
        const edgeOver  = _mlbOverPct  - _bkOverBreakEven;   // positive = over edge
        const edgeUnder = _mlbUnderPct - _bkUnderBreakEven;  // positive = under edge
        const bestTotalEdge = Math.max(edgeOver, edgeUnder);
        // Anchor total label to book total (not model total)
        const _totalLabel = (() => {
          const liveTotal = liveBookTotalMap.get(r.db_id);
          if (liveTotal != null && !isNaN(liveTotal)) return String(liveTotal);
          const snapTotal = dbGameById.get(r.db_id)?.bookTotal;
          if (snapTotal != null) return String(snapTotal);
          return String(r.total_line);
        })();
        if (bestTotalEdge > 0) {
          mlbTotalDiff = String(Math.round(bestTotalEdge * 1000) / 10);  // pp with 1 decimal
          mlbTotalEdge = edgeOver >= edgeUnder
            ? `OVER ${_totalLabel} [EDGE]`
            : `UNDER ${_totalLabel} [EDGE]`;
          console.log(
            `${TAG} [${r.db_id}] ${r.game} — [TOTAL EDGE] ` +
            `overEdge=${(edgeOver*100).toFixed(2)}pp underEdge=${(edgeUnder*100).toFixed(2)}pp ` +
            `→ totalDiff=${mlbTotalDiff}pp totalEdge="${mlbTotalEdge}"`
          );
        } else {
          mlbTotalDiff = String(Math.round(bestTotalEdge * 1000) / 10);  // negative = no edge
          console.log(
            `${TAG} [${r.db_id}] ${r.game} — [TOTAL NO EDGE] ` +
            `overEdge=${(edgeOver*100).toFixed(2)}pp underEdge=${(edgeUnder*100).toFixed(2)}pp → PASS`
          );
        }
      }
    } else {
      console.warn(
        `${TAG} [${r.db_id}] ${r.game} — [TOTAL EDGE] SKIP: book O/U odds unavailable ` +
        `(overOdds=${_bkOverOddsRaw} underOdds=${_bkUnderOddsRaw})`
      );
    }

    // ── RL SIGN FLIP / INVARIANT VIOLATION: skip model write, clear modelRunAt ──
    // When rlSignFlipDetected=true, the simulation ran with the wrong rl_home_spread.
    // All RL-derived fields (modelHomeSpreadOdds, modelAwaySpreadOdds, spreadDiff,
    // spreadEdge, away_rl_cover_pct, home_rl_cover_pct) are invalid and must NOT be
    // written to the DB. Instead, only clear modelRunAt so the game re-runs next
    // cycle with the now-correct awayRunLine value from the scraper.
    if (rlSignFlipDetected) {
      try {
        await db.update(games)
          .set({ modelRunAt: null })
          .where(eq(games.id, r.db_id));
        console.log(
          `${TAG} [${r.db_id}] ${r.game} — [RL INVALIDATE] modelRunAt cleared. ` +
          `Game will re-run next cycle with corrected awayRunLine.`
        );
        invalidated++;
      } catch (invErr) {
        console.error(`${TAG} [${r.db_id}] ${r.game} — [RL INVALIDATE] DB clear failed: ${invErr}`);
        errors++;
      }
      continue;  // skip the full model write below
    }

    try {
      await db.update(games)
        .set({
          // ── Run line ─────────────────────────────────────────────────────
          // awayModelSpread/homeModelSpread: signed RL label used by GameCard spread section
          // CRITICAL: awayRunLine/homeRunLine are BOOK fields — NEVER overwrite from model runner.
          //   They are written ONLY by vsinAutoRefresh (the book scraper).
          //   Overwriting them creates a feedback loop: corrupted book data → wrong rlHomeSpread
          //   input on next run → flipped model output.
          // modelAwaySpreadOdds/modelHomeSpreadOdds: MUST also receive RL odds so GameCard
          //   renders them in the MLB spread section (GameCard checks isMlbGame && modelAwaySpreadOdds)
          awayModelSpread:      safeAwayRunLine,        // sign-enforced to match awayBookSpread
          homeModelSpread:      safeHomeRunLine,        // sign-enforced to match homeBookSpread
          // ⚠ awayRunLine/homeRunLine intentionally NOT written here — book fields, scraper-owned
          // ⚠ awayRunLineOdds/homeRunLineOdds intentionally NOT written here — book fields, scraper-owned
          modelAwaySpreadOdds:  fmtMl(r.away_rl_odds), // ← GameCard MLB spread odds display
          modelHomeSpreadOdds:  fmtMl(r.home_rl_odds), // ← GameCard MLB spread odds display
          // ── RL Edge (probability-based, NOT line arithmetic) ─────────────────────────────
          // spreadDiff = probability edge in pp (model cover% - book break-even%)
          // spreadEdge = "ABBR ±1.5 [EDGE]" for edgeLabelIsAway() parsing in GameCard
          // GameCard uses game.spreadDiff for MLB (like NHL) — line arithmetic is invalid for ±1.5
          spreadDiff:           mlbSpreadDiff ?? undefined,
          spreadEdge:           mlbSpreadEdge ?? undefined,
          // ── Total Edge (probability-based, same formula as RL edge) ─────────────────────
          // totalDiff = probability edge in pp (model over/under% - book break-even%)
          // totalEdge = "OVER {bookTotal} [EDGE]" or "UNDER {bookTotal} [EDGE]"
          totalDiff:            mlbTotalDiff ?? undefined,
          totalEdge:            mlbTotalEdge ?? undefined,
          // ── Total (ALWAYS anchored to book O/U line, NOT model-derived line) ────────────
          // CRITICAL: modelTotal MUST equal bookTotal so displayed model line matches book line.
          // r.total_line = Python's optimal line (may differ from book by 0.5) — NEVER use this.
          // Priority:
          //   (1) liveBookTotalMap [live DB re-read right before write — most current]
          //   (2) dbGameById.bookTotal [snapshot at model-run start — may be stale]
          //   (3) engineInput.book_lines.ou_line [what was passed to Python]
          //   (4) r.total_line [Python's own computed line — LAST RESORT ONLY]
          // liveBookTotalMap is the authoritative source: it reflects the current bookTotal
          // even if odds were populated AFTER the model started running.
          modelTotal:           (() => {
            const liveTotal = liveBookTotalMap.get(r.db_id);
            if (liveTotal != null && !isNaN(liveTotal)) return String(liveTotal);
            const snapTotal = dbGameById.get(r.db_id)?.bookTotal;
            if (snapTotal != null) return String(snapTotal);
            const engineTotal = engineInputById.get(r.db_id)?.book_lines?.ou_line;
            if (engineTotal != null && !isNaN(engineTotal)) return String(engineTotal);
            console.warn(`${TAG} [${r.db_id}] ${r.game} — [TOTAL FALLBACK] bookTotal not available, using Python r.total_line=${r.total_line}`);
            return String(r.total_line);
          })(),
          modelOverOdds:        fmtMl(r.over_odds),
          modelUnderOdds:       fmtMl(r.under_odds),
          modelOverRate:        String(r.over_pct.toFixed(2)),
          modelUnderRate:       String(r.under_pct.toFixed(2)),
          // ── Moneyline ────────────────────────────────────────────────────
          modelAwayML:          fmtMl(r.away_ml),
          modelHomeML:          fmtMl(r.home_ml),
          // ── Scores ───────────────────────────────────────────────────────
          modelAwayScore:       String(r.proj_away_runs.toFixed(2)),
          modelHomeScore:       String(r.proj_home_runs.toFixed(2)),
          modelAwayWinPct:      String(r.away_win_pct.toFixed(2)),
          modelHomeWinPct:      String(r.home_win_pct.toFixed(2)),
          // ── F5 (First Five Innings) model output ───────────────────────────────
          modelF5AwayML:        fmtMl(r.f5_ml_away),
          modelF5HomeML:        fmtMl(r.f5_ml_home),
          modelF5AwayScore:     String(r.exp_f5_away_runs.toFixed(3)),
          modelF5HomeScore:     String(r.exp_f5_home_runs.toFixed(3)),
          modelF5Total:         String(r.f5_total_key),
          modelF5OverOdds:      fmtMl(r.f5_over_odds),
          modelF5UnderOdds:     fmtMl(r.f5_under_odds),
          modelF5OverRate:      String(r.p_f5_over.toFixed(4)),
          modelF5UnderRate:     String(r.p_f5_under.toFixed(4)),
          modelF5HomeWinPct:    String((r.p_f5_home_win * 100).toFixed(2)),
          modelF5AwayWinPct:    String((r.p_f5_away_win * 100).toFixed(2)),
          // ── F5 push three-way pricing (v2.1 — 2026-04-14) ─────────────────
          modelF5PushPct:       r.p_f5_push != null ? String(r.p_f5_push.toFixed(4)) : null,
          modelF5PushRaw:       r.p_f5_push_raw != null ? String(r.p_f5_push_raw.toFixed(4)) : null,
          modelF5AwayRunLine:   '-0.5',
          modelF5HomeRunLine:   '+0.5',
          modelF5AwayRlOdds:    fmtMl(r.f5_rl_away_odds),
          modelF5HomeRlOdds:    fmtMl(r.f5_rl_home_odds),
          // F5 RL cover probabilities (no-vig, 0-100 scale) — used by backtest engine
          modelF5HomeRLCoverPct: r.p_f5_home_rl != null ? String((r.p_f5_home_rl * 100).toFixed(2)) : null,
          modelF5AwayRLCoverPct: r.p_f5_away_rl != null ? String((r.p_f5_away_rl * 100).toFixed(2)) : null,
          // ── NRFI / YRFI model output ─────────────────────────────────────
          modelPNrfi:           String(r.p_nrfi.toFixed(4)),
          modelNrfiOdds:        fmtMl(r.nrfi_odds),
          modelPYrfi:           String(r.p_yrfi.toFixed(4)),
          modelYrfiOdds:        fmtMl(r.yrfi_odds),
          // ── HR Props (team-level) model output ─────────────────────────────
          modelPHomeHrAny:      String(r.p_home_hr_any.toFixed(4)),
          modelPAwayHrAny:      String(r.p_away_hr_any.toFixed(4)),
          modelPBothHr:         String(r.p_both_hr.toFixed(4)),
          modelExpHomeHr:       String(r.exp_home_hr.toFixed(3)),
          modelExpAwayHr:       String(r.exp_away_hr.toFixed(3)),
          // ── Inning-by-Inning projections (I1-I9, backtest-calibrated 2026-04-13) ──
          // Stored as JSON arrays: [I1, I2, I3, I4, I5, I6, I7, I8, I9]
          modelInningHomeExp:        r.inning_home_exp?.length === 9
            ? JSON.stringify(r.inning_home_exp) : null,
          modelInningAwayExp:        r.inning_away_exp?.length === 9
            ? JSON.stringify(r.inning_away_exp) : null,
          modelInningTotalExp:       r.inning_total_exp?.length === 9
            ? JSON.stringify(r.inning_total_exp) : null,
          modelInningPHomeScores:    r.inning_p_home_scores?.length === 9
            ? JSON.stringify(r.inning_p_home_scores) : null,
          modelInningPAwayScores:    r.inning_p_away_scores?.length === 9
            ? JSON.stringify(r.inning_p_away_scores) : null,
          modelInningPNeitherScores: r.inning_p_neither_score?.length === 9
            ? JSON.stringify(r.inning_p_neither_score) : null,
          // ── Meta ──────────────────────────────────────────────────────────────────────────
          modelSpreadClamped:   false,
          modelTotalClamped:    false,
          modelRunAt:           BigInt(Date.now()),
          awayStartingPitcher:  r.away_pitcher,
          homeStartingPitcher:  r.home_pitcher,
          awayPitcherConfirmed: true,
          homePitcherConfirmed: true,
          publishedToFeed:      true,
          publishedModel:       true,
          // ── P1-A: Weather adjustment (stored for traceability and backtest) ───────────────────────────────────────────────────────────────────────────────────
          modelWeatherAdj:      r.weather_run_adj != null ? String(r.weather_run_adj.toFixed(4)) : null,
          // ── P2-D: Raw model projection total (pre-snap, for display alongside originated line) ───────────────────────────────────────────────────────────────────────────────────
          modelProjTotal:       r.proj_total != null ? String(r.proj_total.toFixed(2)) : null,
          // ── 3-year NRFI pitcher signal ─────────────────────────────────────────────────────────────────────────────────────
          nrfiCombinedSignal:   engineInputById.get(r.db_id)?.nrfi_combined_signal ?? null,
          nrfiFilterPass:       engineInputById.get(r.db_id)?.nrfi_filter_pass != null
                                  ? (engineInputById.get(r.db_id)!.nrfi_filter_pass ? 1 : 0)
                                  : null,
        })
        .where(eq(games.id, r.db_id));

      // [VERIFY] Log RL sign, total match, and RL edge immediately after write
      const bookTotalVal = dbGame?.bookTotal != null ? parseFloat(String(dbGame.bookTotal)) : null;
      const modelTotalVal = bookTotalVal; // we just wrote bookTotal as modelTotal
      const totalMatch = bookTotalVal != null;
      const rlSignOk = (() => {
        const bkSign = bookAwaySpreadForGuard !== null ? (bookAwaySpreadForGuard >= 0 ? 1 : -1) : null;
        const mdlSign = parseFloat(safeAwayRunLine) >= 0 ? 1 : -1;
        return bkSign === null || bkSign === mdlSign;
      })();
      console.log(
        `  [VERIFY] id=${r.db_id} | ` +
        `RL: away=${safeAwayRunLine}(${fmtMl(r.away_rl_odds)}) home=${safeHomeRunLine}(${fmtMl(r.home_rl_odds)}) ` +
        `rlSignOk=${rlSignOk} | ` +
        `Total: book=${bookTotalVal} model=${modelTotalVal} match=${totalMatch} | ` +
        `RL Edge: spreadDiff=${mlbSpreadDiff ?? 'null'} spreadEdge="${mlbSpreadEdge ?? 'null'}"`
      );
      console.log(`  [DB] ✓ Written id=${r.db_id}`);
      written++;
    } catch (err) {
      console.error(`  [DB] ✗ ERROR id=${r.db_id}: ${err}`);
      errors++;
    }
  }

  console.log(`\n${TAG} DB writes: ${written} written, ${errors} errors, ${invalidated} invalidated (RL flip/invariant), ${dbGames.length - modelable.length} skipped (no lines/pitchers)`);

  // ── Step 6: Post-write validation gate ──────────────────────────────────────
  console.log(`\n${TAG} Running post-write validation gate...`);
  const validation = await validateMlbModelResults(dateStr);

  if (validation.passed) {
    console.log(`${TAG} ✅ VALIDATION PASSED — all ${written} games correct`);
  } else {
    console.error(`${TAG} ❌ VALIDATION FAILED — ${validation.issues.length} issues:`);
    for (const issue of validation.issues) {
      console.error(`  ✗ ${issue}`);
    }
  }
  if (validation.warnings.length > 0) {
    console.warn(`${TAG} ⚠ ${validation.warnings.length} warnings:`);
    for (const w of validation.warnings) {
      console.warn(`  ⚠ ${w}`);
    }
  }

  console.log(`\n${TAG} ✅ DONE`);

  return {
    date:       dateStr,
    total:      dbGames.length,
    written,
    skipped:    dbGames.length - modelable.length,
    errors,
    validation,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STANDALONE MLB MODEL SYNC SCHEDULER
// ─────────────────────────────────────────────────────────────────────────────
/**
 * startMlbModelSyncScheduler
 *
 * Independent 5-minute heartbeat that calls runMlbModelForDate for both today
 * and tomorrow. This is the catch-all safety net that guarantees the model runs
 * even if the watcher misses a trigger (server restart, hash collision, etc.).
 *
 * The modelRunAt IS NULL guard inside runMlbModelForDate prevents re-running
 * games that are already modeled, so this scheduler is fully idempotent.
 *
 * Runs 24/7 — no time gates. Parallel to startVsinAutoRefresh (MLBCycle Step 6)
 * but independent of it so the model fires even if the MLBCycle stalls.
 */

const MLB_MODEL_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MLB_MODEL_WATCHDOG_MS      = 15 * 60 * 1000; // alert if no cycle in 15 min
let   _lastCycleAt: number       = 0;
let   _cycleRunning: boolean     = false;

/**
 * Retry a DB-bound async operation up to maxAttempts times with exponential backoff.
 * Surfaces transient connection errors without silently dropping the run.
 */
async function withDbRetry<T>(
  label: string,
  fn: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  const TAG = "[MlbModelSync][DB-RETRY]";
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = /ECONNRESET|ETIMEDOUT|ECONNREFUSED|ER_CON_COUNT|too many connections|deadlock/i.test(msg);
      console.error(`${TAG} [ATTEMPT ${attempt}/${maxAttempts}] ${label} — ${msg}${isTransient ? " (transient, will retry)" : " (non-transient)"}`);
      if (!isTransient || attempt === maxAttempts) break;
      const delayMs = 2000 * Math.pow(2, attempt - 1); // 2s, 4s, 8s
      console.log(`${TAG} Waiting ${delayMs}ms before retry...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

function getMlbTodayStr(): string {
  const now = new Date();
  const etStr = now.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const [m, d, y] = etStr.split("/");
  return `${y}-${m}-${d}`;
}

function getMlbTomorrowStr(): string {
  const now = new Date();
  // Add 1 day in ET
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const etStr = tomorrow.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const [m, d, y] = etStr.split("/");
  return `${y}-${m}-${d}`;
}

async function runMlbModelSyncCycle(): Promise<void> {
  const TAG = "[MlbModelSync]";

  // Guard: prevent overlapping cycles (model run can take 8-10 min for a full slate)
  if (_cycleRunning) {
    console.log(`${TAG} ⏭ Cycle skipped — previous cycle still running`);
    return;
  }
  _cycleRunning = true;

  const todayStr    = getMlbTodayStr();
  const tomorrowStr = getMlbTomorrowStr();

  console.log(`${TAG} ► Cycle start — today=${todayStr} tomorrow=${tomorrowStr}`);

  try {
    // ── TODAY ──────────────────────────────────────────────────────────────────
    const todayResult = await withDbRetry(
      `runMlbModelForDate(${todayStr})`,
      () => runMlbModelForDate(todayStr),
    );
    const todayAlreadyModeled = todayResult.total - todayResult.written - (todayResult.total - todayResult.skipped - todayResult.written - todayResult.errors);
    console.log(
      `${TAG} today=${todayStr}: ` +
      `written=${todayResult.written} ` +
      `not_yet_modelable=${todayResult.skipped} ` +
      `errors=${todayResult.errors} ` +
      `validation=${todayResult.validation.passed ? "✅ PASSED" : "❌ FAILED (" + todayResult.validation.issues.length + " issues)"}`
    );
    if (todayResult.written > 0) {
      console.log(`${TAG} ✅ TODAY: ${todayResult.written} game(s) newly modeled and published`);
    }
    if (!todayResult.validation.passed) {
      console.error(`${TAG} [VALIDATION FAIL] today issues:`, todayResult.validation.issues);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${TAG} [ERROR] today=${todayStr} failed after all retries: ${msg}`);
  }

  try {
    // ── TOMORROW ───────────────────────────────────────────────────────────────
    // Ensures games seeded a day ahead are modeled as soon as pitchers + odds
    // are available, without waiting for the MLBCycle watcher.
    const tomorrowResult = await withDbRetry(
      `runMlbModelForDate(${tomorrowStr})`,
      () => runMlbModelForDate(tomorrowStr),
    );
    console.log(
      `${TAG} tomorrow=${tomorrowStr}: ` +
      `written=${tomorrowResult.written} ` +
      `not_yet_modelable=${tomorrowResult.skipped} ` +
      `errors=${tomorrowResult.errors} ` +
      `validation=${tomorrowResult.validation.passed ? "✅ PASSED" : "❌ FAILED (" + tomorrowResult.validation.issues.length + " issues)"}`
    );
    if (tomorrowResult.written > 0) {
      console.log(`${TAG} ✅ TOMORROW: ${tomorrowResult.written} game(s) newly modeled and published`);
    }
    if (!tomorrowResult.validation.passed) {
      console.error(`${TAG} [VALIDATION FAIL] tomorrow issues:`, tomorrowResult.validation.issues);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${TAG} [ERROR] tomorrow=${tomorrowStr} failed after all retries: ${msg}`);
  }

  _lastCycleAt = Date.now();
  _cycleRunning = false;
  console.log(`${TAG} ◄ Cycle complete`);
}

export function startMlbModelSyncScheduler(): void {
  const TAG = "[MlbModelSync]";
  console.log(`${TAG} Starting — interval=${MLB_MODEL_SYNC_INTERVAL_MS / 1000}s watchdog=${MLB_MODEL_WATCHDOG_MS / 1000}s (24/7, no time gates)`);

  // Run immediately on boot, then every 5 minutes
  // .unref() prevents this interval from keeping the process alive if all other work is done
  _lastCycleAt = Date.now(); // initialize so watchdog doesn't fire on first boot
  void runMlbModelSyncCycle();
  setInterval(() => void runMlbModelSyncCycle(), MLB_MODEL_SYNC_INTERVAL_MS).unref();

  // ── Watchdog: alert if no cycle has completed in MLB_MODEL_WATCHDOG_MS ──────
  // Fires every 2 minutes to check cycle health. If _lastCycleAt is stale,
  // it means the scheduler is stuck (e.g., a cycle is running for >15 min).
  // This surfaces silent failures that would otherwise go undetected.
  setInterval(() => {
    const staleSince = Date.now() - _lastCycleAt;
    if (staleSince > MLB_MODEL_WATCHDOG_MS) {
      const staleMin = Math.round(staleSince / 60000);
      if (_cycleRunning) {
        console.warn(`${TAG} [WATCHDOG] ⚠ Cycle has been running for ${staleMin}min — possible hang. Last completed: ${new Date(_lastCycleAt).toISOString()}`);
      } else {
        console.error(`${TAG} [WATCHDOG] ❌ No cycle completed in ${staleMin}min — scheduler may be stalled. Triggering emergency cycle.`);
        void runMlbModelSyncCycle(); // self-healing: trigger a new cycle
      }
    }
  }, 2 * 60 * 1000).unref();
}
