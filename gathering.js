// The gathering rules as pure functions. Every number comes from rules.json, passed in as `rules`,
// so a DM ruling is an edit to that file and never to this one.
//
// A gather is: roll the check die (d100), look up how many yield dice (d4) that band grants, sum
// them into a Value, then derive each material and the skill increase from the Value.

/** The band a check roll falls in. Bands are listed in ascending order of `upTo`. */
export function bandFor(rules, check) {
  if (!Number.isInteger(check) || check < 1 || check > rules.checkDie) {
    throw new RangeError(`The d${rules.checkDie} roll must be a whole number from 1 to ${rules.checkDie}.`);
  }
  return rules.bands.find((band) => check <= band.upTo);
}

/** max(0, round(value / divideBy) - minus) — the shape every yield in rules.json shares. */
export function applyYield(formula, value) {
  const divided = value / formula.divideBy;
  const rounded = formula.round === "down" ? Math.floor(divided) : Math.ceil(divided);
  return Math.max(0, rounded - formula.minus);
}

/** Work out a gather from dice that have already been rolled. */
export function resolveGather(rules, check, dice) {
  const band = bandFor(rules, check);
  if (!Array.isArray(dice) || dice.length !== band.dice) {
    throw new RangeError(`A roll of ${check} needs ${band.dice}d${rules.yieldDie}.`);
  }
  for (const die of dice) {
    if (!Number.isInteger(die) || die < 1 || die > rules.yieldDie) {
      throw new RangeError(`Each d${rules.yieldDie} must be a whole number from 1 to ${rules.yieldDie}.`);
    }
  }
  const value = dice.reduce((sum, die) => sum + die, 0);
  return {
    check,
    dice: [...dice],
    value,
    primary: applyYield(rules.yields.primary, value),
    secondary: applyYield(rules.yields.secondary, value),
    rare: applyYield(rules.yields.rare, value),
    skillIncrease: applyYield(rules.skillIncrease, value),
  };
}

/**
 * Roll a whole gather. `randomInt(n)` must return a uniform integer in 0..n-1.
 * Pass `check` to use a d100 that was rolled elsewhere (in Owlbear's own dice tray, say).
 */
export function rollGather(rules, randomInt, check) {
  const rolledCheck = check ?? randomInt(rules.checkDie) + 1;
  const band = bandFor(rules, rolledCheck);
  const dice = Array.from({ length: band.dice }, () => randomInt(rules.yieldDie) + 1);
  return resolveGather(rules, rolledCheck, dice);
}

/** A uniform integer in 0..n-1 from the platform's cryptographic generator, without modulo bias. */
export function cryptoRandomInt(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buffer = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(buffer);
  } while (buffer[0] >= limit);
  return buffer[0] % n;
}
