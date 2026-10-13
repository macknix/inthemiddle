/* Word lists shared by room-id and participant-name generation.
 *
 * Room ids are lowercase pairs ("sunny-otter") so share links stay tiny and
 * readable aloud; participant names are the capitalised form ("Sunny Otter").
 * Guessable ids are acceptable for ephemeral rooms that only ever hold
 * self-reported pins on a personal deployment.
 */

export const ADJECTIVES = [
  "amber", "bold", "brave", "breezy", "bright", "calm", "cheery", "clever",
  "cosy", "eager", "fancy", "fuzzy", "gentle", "giddy", "golden", "happy",
  "jolly", "keen", "kind", "lively", "lucky", "mellow", "merry", "nimble",
  "perky", "plucky", "proud", "quick", "quiet", "rosy", "shiny", "snug",
  "spry", "sunny", "swift", "tidy", "warm", "wise", "witty", "zesty",
];

export const ANIMALS = [
  "badger", "bee", "crow", "deer", "dove", "duck", "ferret", "finch",
  "fox", "frog", "goose", "hare", "heron", "koala", "lark", "lemur",
  "lynx", "mole", "newt", "otter", "owl", "panda", "pony", "puffin",
  "quail", "robin", "seal", "shrew", "sparrow", "squid", "stoat", "swan",
  "tapir", "toad", "trout", "vole", "walrus", "weasel", "wren", "yak",
];

/** Cryptographically-seeded integer in [min, maxExclusive). */
export function randomInt(min: number, maxExclusive: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return min + (buf[0] % (maxExclusive - min));
}

export function pick<T>(items: T[]): T {
  return items[randomInt(0, items.length)];
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/** A friendly display name like "Sunny Otter", avoiding names already taken
 * in the room. */
export function randomName(taken: Set<string>): string {
  for (let i = 0; i < 20; i++) {
    const name = `${cap(pick(ADJECTIVES))} ${cap(pick(ANIMALS))}`;
    if (!taken.has(name)) return name;
  }
  return `Person ${taken.size + 1}`;
}
