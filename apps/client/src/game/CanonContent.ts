export type FighterId =
  | "mech-akrep"
  | "sokak-krali"
  | "golge-danscisi"
  | "zincir-kiran"
  | "veri-simyacisi";

export type ArenaId =
  | "antik-atari-harabesi"
  | "veri-cekirdegi-alani"
  | "tekno-orman";

export interface FighterDefinition {
  id: FighterId;
  name: string;
  archetype: string;
  palette: {
    primary: number;
    secondary: number;
    accent: number;
    glow: number;
  };
  silhouette: "claws" | "bat" | "naginata" | "chains" | "hologram";
  intro: string;
  hitFlavor: "industrial" | "street" | "spectral" | "heavy" | "digital";
}

export interface ArenaDefinition {
  id: ArenaId;
  name: string;
  subtitle: string;
  palette: {
    sky: number;
    mid: number;
    floor: number;
    neonA: number;
    neonB: number;
  };
  motif: "arcade" | "core" | "forest";
}

export const FIGHTERS: FighterDefinition[] = [
  {
    id: "mech-akrep",
    name: "Mech-Akrep",
    archetype: "Combo Grappler",
    palette: { primary: 0xd56732, secondary: 0x9aa6b2, accent: 0xffcc66, glow: 0xff7a22 },
    silhouette: "claws",
    intro: "Hydraulics primed",
    hitFlavor: "industrial",
  },
  {
    id: "sokak-krali",
    name: "Sokak Kralı",
    archetype: "Fast Aggressor",
    palette: { primary: 0xff2d88, secondary: 0x1b1d2e, accent: 0xffe34f, glow: 0xff36aa },
    silhouette: "bat",
    intro: "No rules, clean reads",
    hitFlavor: "street",
  },
  {
    id: "golge-danscisi",
    name: "Gölge Dansçısı",
    archetype: "Balanced Fighter",
    palette: { primary: 0x39d6d6, secondary: 0x5a38d6, accent: 0xe8d39a, glow: 0x33ffee },
    silhouette: "naginata",
    intro: "Still blade, fast finish",
    hitFlavor: "spectral",
  },
  {
    id: "zincir-kiran",
    name: "Zincir Kıran",
    archetype: "Heavyweight",
    palette: { primary: 0x514a56, secondary: 0xc26c4b, accent: 0xd9d0c7, glow: 0xff4c33 },
    silhouette: "chains",
    intro: "Break the bracket",
    hitFlavor: "heavy",
  },
  {
    id: "veri-simyacisi",
    name: "Veri Simyacısı",
    archetype: "Tech Mage",
    palette: { primary: 0x36e7ff, secondary: 0x7d42ff, accent: 0xff4df0, glow: 0x59ffff },
    silhouette: "hologram",
    intro: "Reality patched live",
    hitFlavor: "digital",
  },
];

export const ARENAS: ArenaDefinition[] = [
  {
    id: "antik-atari-harabesi",
    name: "Antik Atari Harabesi",
    subtitle: "CRT ruins / moss neon",
    palette: { sky: 0x130f2d, mid: 0x30224e, floor: 0x493824, neonA: 0x00f5ff, neonB: 0xff4aa8 },
    motif: "arcade",
  },
  {
    id: "veri-cekirdegi-alani",
    name: "Veri Çekirdeği Alanı",
    subtitle: "Hologrid tournament core",
    palette: { sky: 0x090622, mid: 0x21106d, floor: 0x120d35, neonA: 0x34f7ff, neonB: 0xff37d8 },
    motif: "core",
  },
  {
    id: "tekno-orman",
    name: "Tekno-Orman",
    subtitle: "Synthetic canopy / bio neon",
    palette: { sky: 0x081d24, mid: 0x123928, floor: 0x102117, neonA: 0x64ff9a, neonB: 0x8d5cff },
    motif: "forest",
  },
];

export const DEFAULT_FIGHTER_ID: FighterId = "mech-akrep";
export const DEFAULT_ARENA_ID: ArenaId = "antik-atari-harabesi";
export const SELECTED_FIGHTER_KEY = "arcadestrike_selected_fighter";
export const SELECTED_ARENA_KEY = "arcadestrike_selected_arena";

export function getFighter(id?: string | null): FighterDefinition {
  return FIGHTERS.find(fighter => fighter.id === id) ?? FIGHTERS[0];
}

export function getArena(id?: string | null): ArenaDefinition {
  return ARENAS.find(arena => arena.id === id) ?? ARENAS[0];
}
