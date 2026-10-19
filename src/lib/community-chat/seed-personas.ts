/**
 * Development chat seed personas.
 *
 * These describe the fake members that populate community rooms when the
 * seeding endpoint runs. They are deliberately pure data with no Supabase
 * imports so the generator and its tests can run without a database.
 *
 * Avatar emblems follow the Accountabul Design Studio palette (Ink #212536,
 * Paper #FAFFFF, Periwinkle #7488DE, Sky #75BCDE, Mint #A4FFCD, Aqua #A4FFF5).
 * Magenta is reserved for campaigns, so it is not used here.
 */

export type CommunityBadge = "member" | "vendor" | "moderator" | "admin";

export type SeedPersona = {
  /** Stable key. Drives the deterministic email, so never renumber it. */
  key: string;
  displayName: string;
  handle: string;
  badge: CommunityBadge;
  accountType: "individual" | "business";
  /** Left null on purpose for some personas so the initials fallback renders. */
  avatarUrl: string | null;
};

/** Every seed account uses this domain, which is reserved and unroutable. */
export const SEED_EMAIL_DOMAIN = "seed.accountabul.test";

/** Handles are prefixed so a seed member can never collide with a real one. */
export const SEED_HANDLE_PREFIX = "dev-";

/** Stored on every seeded profile row so cleanup can find the accounts. */
export const SEED_PROFILE_MARKER = "community-chat-seed";

const EMBLEM_THEMES = [
  { background: "#7488DE", foreground: "#FAFFFF" }, // Periwinkle
  { background: "#212536", foreground: "#A4FFCD" }, // Ink + Mint
  { background: "#75BCDE", foreground: "#212536" }, // Sky
  { background: "#A4FFF5", foreground: "#212536" }, // Aqua
] as const;

/** First letter of the first two words, matching the UI initials fallback. */
export function initialsOf(displayName: string) {
  const letters = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("");
  return letters.toUpperCase() || "?";
}

/** Where the seeded avatar files are served from, under public/. */
export const SEED_AVATAR_DIRECTORY = "/seed-avatars";

/**
 * A self-contained SVG emblem. The files are committed under
 * public/seed-avatars and served by the app itself, so a seeded avatar never
 * depends on a remote host that could 404 and show a broken image.
 */
export function emblemSvg(displayName: string, themeIndex: number) {
  const theme = EMBLEM_THEMES[themeIndex % EMBLEM_THEMES.length]!;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="${initialsOf(displayName)}">` +
    `<rect width="96" height="96" rx="48" fill="${theme.background}"/>` +
    `<text x="48" y="49" fill="${theme.foreground}" font-family="Poppins, ui-sans-serif, system-ui, sans-serif"` +
    ` font-size="38" font-weight="600" letter-spacing="-0.02em" text-anchor="middle" dominant-baseline="central">` +
    `${initialsOf(displayName)}</text></svg>`;
  return `${svg}\n`;
}

type PersonaSeed = Omit<SeedPersona, "avatarUrl"> & { emblem: number | null };

const PERSONA_SEEDS: PersonaSeed[] = [
  {
    key: "jordan",
    displayName: "Jordan Avery",
    handle: "dev-jordan",
    badge: "admin",
    accountType: "individual",
    emblem: 0,
  },
  {
    key: "taylor",
    displayName: "Taylor Smith",
    handle: "dev-taylor",
    badge: "member",
    accountType: "individual",
    emblem: 1,
  },
  {
    key: "marcus",
    displayName: "Marcus Webb",
    handle: "dev-marcus",
    badge: "member",
    accountType: "individual",
    emblem: null,
  },
  {
    key: "dana",
    displayName: "Dana Ortiz",
    handle: "dev-dana",
    badge: "vendor",
    accountType: "business",
    emblem: 2,
  },
  {
    key: "priya",
    displayName: "Priya Raman",
    handle: "dev-priya",
    badge: "member",
    accountType: "individual",
    emblem: 3,
  },
  {
    key: "curtis",
    displayName: "Curtis Hale",
    handle: "dev-curtis",
    badge: "vendor",
    accountType: "business",
    emblem: null,
  },
  {
    key: "renee",
    displayName: "Renee Adkins",
    handle: "dev-renee",
    badge: "moderator",
    accountType: "individual",
    emblem: 0,
  },
  {
    key: "sam",
    displayName: "Sam Oyelaran",
    handle: "dev-sam",
    badge: "member",
    accountType: "individual",
    emblem: null,
  },
  {
    key: "bianca",
    displayName: "Bianca Ford",
    handle: "dev-bianca",
    badge: "member",
    accountType: "individual",
    emblem: 1,
  },
  {
    key: "otis",
    displayName: "Otis Brandt",
    handle: "dev-otis",
    badge: "vendor",
    accountType: "business",
    emblem: null,
  },
  {
    key: "leah",
    displayName: "Leah Kim",
    handle: "dev-leah",
    badge: "member",
    accountType: "individual",
    emblem: 2,
  },
  {
    key: "darius",
    displayName: "Darius Pool",
    handle: "dev-darius",
    badge: "member",
    accountType: "individual",
    emblem: null,
  },
];

export const SEED_PERSONAS: SeedPersona[] = PERSONA_SEEDS.map((persona) => ({
  key: persona.key,
  displayName: persona.displayName,
  handle: persona.handle,
  badge: persona.badge,
  accountType: persona.accountType,
  avatarUrl: persona.emblem === null ? null : `${SEED_AVATAR_DIRECTORY}/${persona.key}.svg`,
}));

/** The avatar files the personas point at, for writing and for tests. */
export const SEED_AVATAR_FILES = PERSONA_SEEDS.flatMap((persona) =>
  persona.emblem === null
    ? []
    : [{ key: persona.key, svg: emblemSvg(persona.displayName, persona.emblem) }],
);

export function seedEmailFor(personaKey: string) {
  return `${SEED_HANDLE_PREFIX}${personaKey}@${SEED_EMAIL_DOMAIN}`;
}

/** True for any address this seeder owns. Used to reuse accounts across runs. */
export function isSeedEmail(email: string | null | undefined) {
  return Boolean(email && email.toLowerCase().endsWith(`@${SEED_EMAIL_DOMAIN}`));
}
