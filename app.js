// The Gathering popover. Rules and numbers live in rules.json and gathering.js; this file only
// wires them to the page and to Owlbear Rodeo.
//
// Inside Owlbear, each player's skill and last few gathers are stored in the room's metadata under
// that player's own key, so they survive between sessions and everyone sees them. Opened on its own
// in a browser, the page works the same but keeps everything in localStorage.

// The SDK must load before anything else runs. Owlbear sends its one "ready" message as the popover
// loads and never repeats it; an SDK that starts listening later (after an await) waits forever.
import OBR from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3.1.0/+esm";
import { cryptoRandomInt, resolveGather, rollGather, undoLatest } from "./gathering.js";

const PLUGIN = "app.wow-table.gathering";
const PLAYER_PREFIX = `${PLUGIN}/player/`;
const CHANNEL = `${PLUGIN}/gather`;
// Room metadata is capped at 16 kB and shared with every other extension, so keep the log short.
const LOG_PER_PLAYER = 5;
const LOG_SHOWN = 8;

const rules = await (await fetch("./rules.json", { cache: "no-cache" })).json();

const inOwlbear = OBR.isAvailable;
const embedded = window.self !== window.top;

const me = { id: "local", name: "You", role: "GM" };
/** id -> { name, skills: { professionId: number }, log: [{ t, p, c, d, s, i, m }] } */
let players = {};
let professionId = readLocal(`${PLUGIN}/profession`);
if (!rules.professions.some((profession) => profession.id === professionId)) {
  professionId = rules.professions[0].id;
}
let lastGather = null;
let savingMine = 0;

const $ = (id) => document.getElementById(id);
const professionSelect = $("profession");
const skillInput = $("skill");
const checkInput = $("check");

// ---------- storage ----------

function readLocal(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows and blocked storage: nothing to do.
  }
}

const backupKey = () => `${PLUGIN}/self/${me.id}`;

/** Room metadata is written by other people's browsers, so never trust its shape. */
function asRecord(raw) {
  const record = { name: "", skills: {}, log: [] };
  if (!raw || typeof raw !== "object") return record;
  if (typeof raw.name === "string") record.name = raw.name.slice(0, 60);
  if (raw.skills && typeof raw.skills === "object") {
    for (const [id, value] of Object.entries(raw.skills)) {
      if (Number.isInteger(value) && value >= 0) record.skills[id] = value;
    }
  }
  if (Array.isArray(raw.log)) {
    record.log = raw.log
      .filter((entry) => entry && Number.isFinite(entry.t) && typeof entry.p === "string")
      .slice(0, LOG_PER_PLAYER);
  }
  return record;
}

const hasData = (record) => Object.keys(record.skills).length > 0 || record.log.length > 0;

async function save(id) {
  const record = players[id];
  if (id === me.id) {
    record.name = me.name;
    writeLocal(backupKey(), record);
  }
  if (!inOwlbear) return;
  if (id === me.id) savingMine++;
  try {
    await OBR.room.setMetadata({ [PLAYER_PREFIX + id]: record });
  } catch {
    setStatus("Couldn't save to the room. Your numbers are kept on this device.");
  } finally {
    if (id === me.id) savingMine--;
  }
}

function readRoom(metadata) {
  const next = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (key.startsWith(PLAYER_PREFIX)) next[key.slice(PLAYER_PREFIX.length)] = asRecord(value);
  }
  const inRoom = Boolean(next[me.id]);
  // A write of mine is still on its way: what I have is newer than what the room just sent.
  if (players[me.id] && (savingMine > 0 || !inRoom)) next[me.id] = players[me.id];
  if (!next[me.id]) next[me.id] = asRecord(readLocal(backupKey()));
  players = next;
  // First visit to this room with numbers from an earlier one: put them where the table can see.
  if (!inRoom && savingMine === 0 && hasData(players[me.id])) save(me.id);
  render();
}

// ---------- rules lookups ----------

const professionById = (id) => rules.professions.find((profession) => profession.id === id);
const currentProfession = () => professionById(professionId);
const skillOf = (id, profession) => players[id]?.skills[profession.id] ?? 0;
const nameOf = (id) => (id === me.id ? me.name : players[id]?.name || "Someone");

/** "d100 57 → 2 + 4 + 1 = 7 · 7 Stone, 4 Ore, 0 Gems" */
function describe(profession, result, typedIn) {
  const check = `d${rules.checkDie} ${result.check}${typedIn ? " (typed in)" : ""}`;
  const dice = result.dice.length > 1 ? `${result.dice.join(" + ")} = ${result.value}` : `${result.value}`;
  const haul = `${result.primary} ${profession.primary}, ${result.secondary} ${profession.secondary}, ${result.rare} ${profession.rare}`;
  return `${check} → ${result.dice.length}d${rules.yieldDie}: ${dice} · ${haul}`;
}

// ---------- actions ----------

function setStatus(text) {
  $("status").textContent = text;
}

/** A whole number from an input, or null when the text isn't one in range. */
function wholeNumber(text, min, max = Number.MAX_SAFE_INTEGER) {
  const value = Number(text);
  return /^\d+$/.test(text.trim()) && value >= min && value <= max ? value : null;
}

async function gather() {
  const profession = currentProfession();
  // The d100 box only shows when rules.json's typeInCheck is on; otherwise Gather rolls everything.
  const typed = rules.typeInCheck ? checkInput.value.trim() : "";
  let check;
  if (typed !== "") {
    check = wholeNumber(typed, 1, rules.checkDie);
    if (check === null) {
      setStatus(`The d${rules.checkDie} must be a whole number from 1 to ${rules.checkDie}.`);
      checkInput.focus();
      return;
    }
  }
  setStatus("");

  const result = rollGather(rules, cryptoRandomInt, check);
  const mine = players[me.id];
  const before = skillOf(me.id, profession);
  const after = before + result.skillIncrease;
  mine.skills[profession.id] = after;
  const entry = {
    t: Date.now(),
    p: profession.id,
    c: result.check,
    d: result.dice,
    s: after,
    i: result.skillIncrease,
  };
  if (typed !== "") entry.m = 1;
  mine.log = [entry, ...mine.log].slice(0, LOG_PER_PLAYER);
  lastGather = { t: entry.t, professionId: profession.id, result, before, after, typedIn: typed !== "" };
  checkInput.value = "";
  render();

  await save(me.id);
  if (inOwlbear) {
    const text = `${me.name} · ${profession.name} · ${describe(profession, result, typed !== "")} · skill ${after}`;
    OBR.broadcast.sendMessage(CHANNEL, { text }, { destination: "REMOTE" }).catch(() => {});
  }
}

/** Take back my latest gather, for a Gather pressed by mistake. */
async function undo() {
  const undone = undoLatest(rules, players[me.id]);
  if (!undone) return;
  const profession = professionById(undone.entry.p);
  players[me.id] = { ...players[me.id], ...undone.record };
  if (lastGather?.t === undone.entry.t) lastGather = null;
  const name = profession?.name ?? "gather";
  const skill = players[me.id].skills[undone.entry.p] ?? 0;
  setStatus(`Undid your ${when(undone.entry.t)} ${name} gather. Skill back to ${skill}.`);
  render();

  await save(me.id);
  if (inOwlbear) {
    const text = `${me.name} undid a ${name} gather (d${rules.checkDie} ${undone.entry.c}) · skill ${skill}`;
    OBR.broadcast.sendMessage(CHANNEL, { text }, { destination: "REMOTE" }).catch(() => {});
  }
}

function setSkill(id, input) {
  const profession = currentProfession();
  const value = wholeNumber(input.value, 0);
  if (value === null) {
    setStatus("Skill must be a whole number, 0 or more.");
    input.value = skillOf(id, profession);
    return;
  }
  setStatus("");
  if (!players[id] || value === skillOf(id, profession)) return;
  players[id].skills[profession.id] = value;
  if (id === me.id) lastGather = null;
  render();
  save(id);
}

// ---------- rendering ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function when(timestamp) {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const today = date.toDateString() === new Date().toDateString();
  return today ? time : `${date.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
}

function renderResult() {
  const box = $("result");
  box.hidden = !lastGather;
  if (!lastGather) return;
  const profession = professionById(lastGather.professionId);
  const { result, before, after } = lastGather;
  for (const kind of ["primary", "secondary", "rare"]) {
    $(`${kind}-count`).textContent = result[kind];
    $(`${kind}-name`).textContent = profession[kind];
    $(`${kind}-count`).parentElement.classList.toggle("none", result[kind] === 0);
  }
  $("result-dice").textContent = describe(profession, result, lastGather.typedIn).split(" · ")[0];
  $("result-skill").textContent = `${profession.name} skill ${before} → ${after} (+${result.skillIncrease})`;
}

function renderParty() {
  const profession = currentProfession();
  const ids = Object.keys(players).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  $("party").hidden = !inOwlbear || ids.length < 2;
  const list = $("party-list");
  // Don't pull the row out from under a GM who is typing in it.
  if ($("party").hidden || list.contains(document.activeElement)) return;
  list.replaceChildren(
    ...ids.map((id) => {
      const row = el("li");
      row.append(el("span", "name", id === me.id ? `${nameOf(id)} (you)` : nameOf(id)));
      if (me.role === "GM" && id !== me.id) {
        const input = el("input");
        input.type = "number";
        input.min = "0";
        input.step = "1";
        input.value = skillOf(id, profession);
        input.setAttribute("aria-label", `${nameOf(id)}'s ${profession.name} skill`);
        input.addEventListener("change", () => setSkill(id, input));
        row.append(input);
      } else {
        row.append(el("span", "value", String(skillOf(id, profession))));
      }
      return row;
    }),
  );
}

function renderLog() {
  const entries = Object.entries(players)
    .flatMap(([id, record]) => record.log.map((entry) => ({ id, entry })))
    .sort((a, b) => b.entry.t - a.entry.t)
    .slice(0, LOG_SHOWN);
  const rows = [];
  const myLatest = players[me.id]?.log[0];
  for (const { id, entry } of entries) {
    const profession = professionById(entry.p);
    if (!profession) continue;
    let result;
    try {
      result = resolveGather(rules, entry.c, entry.d);
    } catch {
      continue; // Written under different rules, or mangled: leave it out.
    }
    const row = el("li");
    const who = el("div", "who");
    who.append(el("span", "", `${nameOf(id)} · ${profession.name}`), el("span", "when", when(entry.t)));
    const skill = Number.isInteger(entry.s) ? ` · skill ${entry.s}` : "";
    row.append(who, el("div", "detail", describe(profession, result, Boolean(entry.m)) + skill));
    if (id === me.id && entry === myLatest) {
      const button = el("button", "undo", "Undo");
      button.type = "button";
      button.title = "Remove this gather and take back the skill it added";
      button.addEventListener("click", undo);
      row.append(button);
    }
    rows.push(row);
  }
  $("log").hidden = rows.length === 0;
  $("log-list").replaceChildren(...rows);
}

function render() {
  const profession = currentProfession();
  professionSelect.value = profession.id;
  $("party-title").textContent = `Party ${profession.name} skill`;
  if (document.activeElement !== skillInput) skillInput.value = skillOf(me.id, profession);
  renderResult();
  renderParty();
  renderLog();
}

function applyTheme(theme) {
  const dark = theme.mode === "DARK";
  const style = document.documentElement.style;
  style.setProperty("color-scheme", dark ? "dark" : "light");
  style.setProperty("--text", theme.text.primary);
  style.setProperty("--text-soft", theme.text.secondary);
  style.setProperty("--accent", theme.primary.main);
  style.setProperty("--accent-text", theme.primary.contrastText);
  style.setProperty("--raised", dark ? "rgba(255, 255, 255, 0.07)" : "rgba(0, 0, 0, 0.05)");
  style.setProperty("--line", dark ? "rgba(255, 255, 255, 0.16)" : "rgba(0, 0, 0, 0.14)");
  style.setProperty("--warn", dark ? "#f0a070" : "#b3541e");
}

// ---------- start ----------

for (const profession of rules.professions) {
  const option = el("option", "", profession.name);
  option.value = profession.id;
  professionSelect.append(option);
}
professionSelect.addEventListener("change", () => {
  professionId = professionSelect.value;
  writeLocal(`${PLUGIN}/profession`, professionId);
  lastGather = null;
  setStatus("");
  render();
});

checkInput.max = rules.checkDie;
checkInput.placeholder = "roll for me";
$("check-label").append(" ", el("small", "", "(optional)"));
// Without the d100 box, profession and skill share one row.
$("check-field").hidden = !rules.typeInCheck;
$("profession-field").classList.toggle("wide", rules.typeInCheck);
$("gather").addEventListener("click", gather);
checkInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") gather();
});
skillInput.addEventListener("change", () => setSkill(me.id, skillInput));

// Anything that goes wrong shows in the status line: inside Owlbear there is no console to look at.
window.addEventListener("error", (event) => setStatus(`Error: ${event.message}`));
window.addEventListener("unhandledrejection", (event) =>
  setStatus(`Error: ${event.reason?.message ?? event.reason}`),
);

if (inOwlbear) {
  document.body.classList.add("in-owlbear");
  // Draw straight away; the room's numbers fill in once Owlbear answers.
  players = { [me.id]: asRecord(null) };
  $("gather").disabled = true;
  render();
  setStatus("Connecting to Owlbear…");
  OBR.onReady(async () => {
    try {
      await connect();
      $("gather").disabled = false;
      setStatus("");
    } catch (error) {
      setStatus(`Couldn't connect to Owlbear: ${error?.message ?? error}`);
    }
  });
} else {
  players = { [me.id]: asRecord(readLocal(backupKey())) };
  if (embedded) setStatus("Couldn't reach Owlbear. Results stay on this device.");
  render();
}

async function connect() {
  [me.id, me.name, me.role] = await Promise.all([
    OBR.player.getId(),
    OBR.player.getName(),
    OBR.player.getRole(),
  ]);
  applyTheme(await OBR.theme.getTheme());
  OBR.theme.onChange(applyTheme);
  OBR.player.onChange((player) => {
    me.name = player.name;
    me.role = player.role;
    render();
  });
  OBR.broadcast.onMessage(CHANNEL, (event) => {
    const text = String(event.data?.text ?? "").slice(0, 300);
    if (text) OBR.notification.show(text, "INFO");
  });
  readRoom(await OBR.room.getMetadata());
  OBR.room.onMetadataChange(readRoom);
}
