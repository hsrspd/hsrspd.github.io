const characters = window.HSR_CHARACTERS || [];

const IDS = {
  SILVER_WOLF: "1506",
  SPARKLE: "1501",
  YAOGUANG: "1502",
  HUOHUO: "1217",
};

const TRACKED_IDS = new Set([
  IDS.SILVER_WOLF,
  IDS.SPARKLE,
  IDS.YAOGUANG,
  IDS.HUOHUO,
  "8010",
]);

const ENERGY_MAX = {
  [IDS.SILVER_WOLF]: 60,
  [IDS.SPARKLE]: 160,
  [IDS.YAOGUANG]: 180,
  [IDS.HUOHUO]: 140,
};

const DEFAULT_PANEL = {
  atk: 0,
  elation: 0,
  critRate: 5,
  critDmg: 50,
};

const state = {
  selectedIds: [],
  speedInputs: {},
  panelInputs: {},
  actionModes: {},
  initialSkillPoints: 5,
  vonwacq: {},
  query: "",
  activeWindowIndex: 0,
};

const els = {
  search: document.querySelector("#characterSearch"),
  grid: document.querySelector("#characterGrid"),
  selectedStrip: document.querySelector("#selectedStrip"),
  speedRows: document.querySelector("#speedRows"),
  bonusPanel: document.querySelector("#bonusPanel"),
  ahaPanel: document.querySelector("#ahaPanel"),
  timelineTabs: document.querySelector("#timelineTabs"),
  timeline: document.querySelector("#timeline"),
  clearAll: document.querySelector("#clearAll"),
};

const windows = [
  { label: "混沌0t", limit: 150 },
  { label: "王棋0t", limit: 300 },
];

const AHA_ICON = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="32" fill="#252a34"/>
    <circle cx="32" cy="32" r="24" fill="#3a4050"/>
    <text x="32" y="38" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="800" fill="#f0d500">AHA</text>
  </svg>
`);

function byId(id) {
  return characters.find((character) => character.id === id);
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function formatNumber(value, digits = 1) {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : String(round(value, digits));
}

function formatSigned(value, suffix = "") {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${formatNumber(value)}${suffix}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getDefaultActionMode(id) {
  if (id === IDS.SILVER_WOLF) return "skill";
  if (id === IDS.SPARKLE) return "enhanced";
  if (id === IDS.YAOGUANG) return "skill";
  if (id === IDS.HUOHUO) return "skill";
  return "basic";
}

function ensureCharacterState(id) {
  const character = byId(id);
  if (!character) return;
  state.speedInputs[id] = Number(state.speedInputs[id] ?? character.baseSpd);
  state.panelInputs[id] = {
    ...DEFAULT_PANEL,
    ...(state.panelInputs[id] || {}),
  };
  state.actionModes[id] = state.actionModes[id] || getDefaultActionMode(id);
}

function getSkillPointLimit() {
  const elationCount = state.selectedIds
    .map((id) => byId(id))
    .filter((character) => character?.path === "Elation").length;
  const sparkleConeBonus = state.selectedIds.includes(IDS.SPARKLE) ? Math.min(3, elationCount) : 0;
  return 5 + sparkleConeBonus;
}

function getBaseInput(character) {
  return Number(state.speedInputs[character.id] ?? character.baseSpd);
}

function getPanelInput(id) {
  return {
    ...DEFAULT_PANEL,
    ...(state.panelInputs[id] || {}),
  };
}

function getSelectedElationCharacters() {
  return state.selectedIds
    .map((id) => byId(id))
    .filter((character) => character?.path === "Elation");
}

function getAhaSpeedInfo() {
  const elationCharacters = getSelectedElationCharacters();
  if (!elationCharacters.length) return null;

  const ratios = [0.2, 0.1, 0.05, 0.02];
  const parts = elationCharacters
    .map((character) => ({
      character,
      speed: getBaseInput(character),
    }))
    .sort((a, b) => b.speed - a.speed || state.selectedIds.indexOf(a.character.id) - state.selectedIds.indexOf(b.character.id))
    .map(({ character, speed }, index) => {
      const ratio = ratios[index] || 0;
      return {
        id: character.id,
        name: character.name,
        speed,
        ratio,
        bonus: speed * ratio,
      };
    });
  const speed = 80 + parts.reduce((sum, part) => sum + part.bonus, 0);
  return { speed, parts };
}

function isVonwacqActive(character) {
  if (!state.vonwacq[character.id]) return false;
  return getBaseInput(character) >= 120;
}

function makeBuff({ name, targetId = "team", stat = null, value = 0, remaining = 1, source = "", tickOnId = null }) {
  return { name, targetId, stat, value, remaining, source, tickOnId };
}

function refreshBuff(combat, buff) {
  const index = combat.buffs.findIndex((item) =>
    item.name === buff.name &&
    item.targetId === buff.targetId &&
    item.source === buff.source
  );
  if (index >= 0) {
    combat.buffs[index] = { ...combat.buffs[index], ...buff };
  } else {
    combat.buffs.push(buff);
  }
}

function hasBuff(combat, id, name) {
  return combat.buffs.some((buff) =>
    buff.name === name &&
    (buff.targetId === "team" || buff.targetId === id)
  );
}

function getActiveBuffs(combat, id) {
  return combat.buffs.filter((buff) => buff.targetId === "team" || buff.targetId === id);
}

function getBuffValue(combat, id, stat) {
  return getActiveBuffs(combat, id)
    .filter((buff) => buff.stat === stat)
    .reduce((sum, buff) => sum + buff.value, 0);
}

function getStats(combat, id) {
  const character = byId(id);
  const panel = getPanelInput(id);
  const hidden = combat.hiddenMmr || 0;
  let critRate = panel.critRate + getBuffValue(combat, id, "critRate");
  let critDmg = panel.critDmg + getBuffValue(combat, id, "critDmg");

  if (id === IDS.SILVER_WOLF) {
    const roomToCap = Math.max(0, 100 - critRate);
    const hiddenToCrit = Math.min(hidden, roomToCap / 0.4);
    critRate += hiddenToCrit * 0.4;
    critDmg += Math.max(0, hidden - hiddenToCrit) * 0.8;
  }

  const attackMultiplier = 1 + getBuffValue(combat, id, "attackPercent");
  const speedMultiplier = 1 + getBuffValue(combat, id, "speedPercent");
  const elationMultiplier = 1 + getBuffValue(combat, id, "elationPercent");

  return {
    atk: panel.atk * attackMultiplier,
    speed: Math.max(1, getBaseInput(character) * speedMultiplier),
    elation: panel.elation * elationMultiplier + getBuffValue(combat, id, "elationFlat"),
    critRate: Math.min(100, critRate),
    critDmg,
    hidden,
  };
}

function getExpectedDamage(baseDamage, stats) {
  const critRate = Math.max(0, Math.min(100, stats.critRate)) / 100;
  const critDmg = Math.max(0, stats.critDmg) / 100;
  return baseDamage * (1 + critRate * critDmg);
}

function makeDamageLine(label, raw, stats, note = "") {
  return {
    label,
    raw,
    expected: getExpectedDamage(raw, stats),
    note,
  };
}

function getBuffLabels(combat, id) {
  const labels = getActiveBuffs(combat, id).map((buff) => {
    const statLabel = {
      attackPercent: "攻击",
      speedPercent: "速度",
      elationPercent: "欢愉",
      elationFlat: "欢愉",
      critRate: "暴击率",
      critDmg: "暴伤",
      resPen: "抗性穿透",
    }[buff.stat] || "";
    const valueLabel = buff.stat?.endsWith("Percent")
      ? formatSigned(buff.value * 100, "%")
      : buff.stat === "elationFlat"
        ? formatSigned(buff.value)
        : buff.stat
          ? formatSigned(buff.value, "%")
          : "";
    return `${buff.name}${statLabel ? ` ${statLabel}${valueLabel}` : ""} ${buff.remaining}回合`;
  });
  return labels.length ? labels : ["无技能buff"];
}

function buildCombat(limit) {
  const combat = {
    punchline: 0,
    hiddenMmr: 0,
    skillPoints: Math.min(state.initialSkillPoints, getSkillPointLimit()),
    skillPointLimit: getSkillPointLimit(),
    buffs: [],
    energy: Object.fromEntries(state.selectedIds.map((id) => [id, 0])),
    actionCounts: Object.fromEntries(state.selectedIds.map((id) => [id, 0])),
  };

  if (state.selectedIds.includes(IDS.YAOGUANG)) {
    refreshBuff(combat, makeBuff({
      name: "上上签",
      targetId: "team",
      stat: "critRate",
      value: 10,
      remaining: 3,
      source: "yaoguang-lightcone",
      tickOnId: IDS.YAOGUANG,
    }));
    refreshBuff(combat, makeBuff({
      name: "上上签",
      targetId: "team",
      stat: "critDmg",
      value: 30,
      remaining: 3,
      source: "yaoguang-lightcone",
      tickOnId: IDS.YAOGUANG,
    }));
  }

  const units = state.selectedIds.map((id, index) => {
    const character = byId(id);
    const speed = getStats(combat, id).speed;
    const interval = 10000 / speed;
    return {
      id,
      index,
      name: character.name,
      icon: character.icon,
      interval,
      nextAv: interval * (isVonwacqActive(character) ? 0.6 : 1),
      actionCount: 0,
    };
  });

  const aha = getAhaSpeedInfo();
  if (aha) {
    const interval = 10000 / aha.speed;
    units.push({
      id: "aha",
      index: -1,
      name: "阿哈时刻",
      icon: AHA_ICON,
      interval,
      nextAv: interval,
      actionCount: 0,
      isAha: true,
    });
  }

  const rows = [];
  while (units.length && rows.length < 120) {
    units.sort((a, b) => a.nextAv - b.nextAv || getUnitSpeed(combat, b) - getUnitSpeed(combat, a) || a.index - b.index);
    const unit = units[0];
    if (unit.nextAv - limit > 1e-9) break;

    const action = unit.isAha ? resolveAhaAction(combat, unit) : resolveCharacterAction(combat, unit);
    rows.push({
      ...unit,
      ...action,
      av: unit.nextAv,
      cycle: unit.actionCount,
    });

    unit.actionCount += 1;
    tickBuffsAfterAction(combat, unit.id);
    const nextSpeed = getUnitSpeed(combat, unit);
    unit.interval = 10000 / nextSpeed;
    unit.nextAv += unit.interval;
  }
  return rows;
}

function getUnitSpeed(combat, unit) {
  if (unit.isAha) return getAhaSpeedInfo()?.speed || 1;
  return getStats(combat, unit.id).speed;
}

function addEnergy(combat, id, amount) {
  const max = ENERGY_MAX[id] || 120;
  combat.energy[id] = Math.min(max, (combat.energy[id] || 0) + amount);
}

function spendSkillPoint(combat, amount) {
  combat.skillPoints -= amount;
}

function recoverSkillPoint(combat, amount) {
  combat.skillPoints = Math.min(combat.skillPointLimit, combat.skillPoints + amount);
}

function gainPunchline(combat, amount) {
  combat.punchline += amount;
  if (state.selectedIds.includes(IDS.SILVER_WOLF)) {
    combat.hiddenMmr = Math.min(300, combat.hiddenMmr + amount);
  }
}

function resolveAhaAction(combat, unit) {
  const elationIds = state.selectedIds.filter((id) => byId(id)?.path === "Elation");
  elationIds.forEach((id) => {
    refreshBuff(combat, makeBuff({
      name: "好活当赏",
      targetId: id,
      remaining: 2,
      source: "aha",
    }));
  });
  if (state.selectedIds.includes(IDS.YAOGUANG)) {
    recoverSkillPoint(combat, 1);
  }
  return {
    modeLabel: "阿哈时刻",
    note: `给欢愉角色施加【好活当赏】2回合；爻光欢愉技回1点；笑点计入用于粗略伤害展示。`,
    snapshot: null,
    damageLines: [],
    energyDelta: 0,
    skillPointDelta: 0,
    punchline: combat.punchline,
  };
}

function resolveCharacterAction(combat, unit) {
  const id = unit.id;
  const mode = getPlannedActionMode(combat, id);
  const beforeEnergy = combat.energy[id] || 0;
  const beforeSkillPoints = combat.skillPoints;
  const damageLines = [];
  const notes = [];

  if (id === IDS.SILVER_WOLF) {
    resolveSilverWolfAction(combat, id, mode, damageLines, notes);
  } else if (id === IDS.SPARKLE) {
    resolveSparkleAction(combat, id, mode, damageLines, notes);
  } else if (id === IDS.YAOGUANG) {
    resolveYaoguangAction(combat, id, mode, notes);
  } else if (id === IDS.HUOHUO) {
    resolveHuohuoAction(combat, id, mode, notes);
  } else {
    addEnergy(combat, id, 20);
    notes.push("普攻回能 +20。");
  }

  const stats = getStats(combat, id);
  return {
    modeLabel: getActionModeLabel(id, mode),
    note: notes.join(" "),
    snapshot: {
      ...stats,
      energy: combat.energy[id] || 0,
      skillPoints: combat.skillPoints,
      skillPointLimit: combat.skillPointLimit,
      buffs: getBuffLabels(combat, id),
    },
    damageLines,
    energyDelta: (combat.energy[id] || 0) - beforeEnergy,
    skillPointDelta: combat.skillPoints - beforeSkillPoints,
    punchline: combat.punchline,
  };
  combat.actionCounts[id] = (combat.actionCounts[id] || 0) + 1;
}

function getPlannedActionMode(combat, id) {
  const mode = state.actionModes[id] || getDefaultActionMode(id);
  if (id === IDS.HUOHUO && mode === "auto") return "skill";
  if (id === IDS.YAOGUANG && mode === "auto") {
    return ((combat.actionCounts[id] || 0) % 3 === 0) ? "skill" : "basic";
  }
  return mode;
}

function resolveSilverWolfAction(combat, id, mode, damageLines, notes) {
  const stats = getStats(combat, id);
  if (mode === "enhanced") {
    addEnergy(combat, id, 20);
    const hiddenStacks = Math.min(2, Math.floor((combat.hiddenMmr || 0) / 60));
    const damageMultiplier = 1 + hiddenStacks * 0.15;
    const skillRaw = stats.atk * (2.4 + 1) * damageMultiplier;
    damageLines.push(makeDamageLine("强化普攻粗略", skillRaw, stats, `含隐藏分增伤 ${formatNumber((damageMultiplier - 1) * 100)}%`));
    damageLines.push(makeDamageLine("盲盒预计伤害", stats.atk * 0.9 * 3, stats, "按3次盲盒估算，忽略随机附加效果"));
    notes.push("强化普攻不恢复战技点。");
    return;
  }

  spendSkillPoint(combat, 1);
  addEnergy(combat, id, 30);
  gainPunchline(combat, 5);
  const nextStats = getStats(combat, id);
  damageLines.push(makeDamageLine("战技全体", nextStats.atk * 1.6, nextStats, "不计敌方防御/抗性"));
  if (hasBuff(combat, id, "好活当赏")) {
    damageLines.push(makeDamageLine("好活当赏追加", nextStats.atk * 0.4, nextStats, "战技命中目标追加欢愉伤害"));
  }
  notes.push("战技获得5笑点，银狼同步获得5隐藏分。");
}

function resolveSparkleAction(combat, id, mode, damageLines, notes) {
  const stats = getStats(combat, id);
  if (mode === "ultimate") {
    gainPunchline(combat, 2);
    damageLines.push(makeDamageLine("终结技全体", stats.atk * (0.6 * stats.elation + 0.5), stats, "倍率按(0.6*欢愉度+50%)"));
    notes.push("终结技获得2笑点。");
    return;
  }

  spendSkillPoint(combat, 1);
  addEnergy(combat, id, 20);
  damageLines.push(makeDamageLine("强化普攻主目标", stats.atk * 1.2, stats, "默认耗1点并发动1次互动陷阱"));
  damageLines.push(makeDamageLine("强化普攻相邻", stats.atk * 0.6, stats, "相邻目标粗略"));
  if (hasBuff(combat, id, "好活当赏")) {
    damageLines.push(makeDamageLine("好活当赏主目标", stats.atk * 0.4, stats, "火属性欢愉伤害"));
    damageLines.push(makeDamageLine("互动陷阱追加", stats.atk * 0.2, stats, "随机受击目标，粗略"));
  }
  notes.push("默认耗点打强普；火花爆点暂不模拟。");
}

function resolveYaoguangAction(combat, id, mode, notes) {
  const stats = getStats(combat, id);
  if (mode === "ultimate") {
    gainPunchline(combat, 5);
    refreshBuff(combat, makeBuff({
      name: "六爻皆吉",
      targetId: "team",
      stat: "resPen",
      value: 20,
      remaining: 3,
      source: "yaoguang-ult",
      tickOnId: IDS.YAOGUANG,
    }));
    notes.push("终结技获得5笑点；全队抗性穿透+20%，持续3回合；阿哈额外回合暂以文字记录。");
    return;
  }

  if (mode === "skill") {
    spendSkillPoint(combat, 1);
    addEnergy(combat, id, 30);
    refreshBuff(combat, makeBuff({
      name: "十方光映",
      targetId: "team",
      stat: "elationFlat",
      value: stats.elation * 0.2,
      remaining: 3,
      source: "yaoguang-zone",
      tickOnId: IDS.YAOGUANG,
    }));
    gainPunchline(combat, 3);
    notes.push("战技展开结界3回合；全队欢愉度提高爻光当前欢愉度20%；结界期间本次行动获得3笑点。");
    return;
  }

  addEnergy(combat, id, 30);
  if (hasBuff(combat, id, "十方光映")) {
    gainPunchline(combat, 3);
    notes.push("普攻回能+30；结界期间获得3笑点。");
  } else {
    notes.push("普攻回能+30。");
  }
}

function resolveHuohuoAction(combat, id, mode, notes) {
  if (mode === "ultimate") {
    state.selectedIds.forEach((targetId) => {
      if (targetId !== id) {
        addEnergy(combat, targetId, (ENERGY_MAX[targetId] || 120) * 0.2);
      }
    });
    state.selectedIds.forEach((targetId) => {
      if (targetId === id) return;
      refreshBuff(combat, makeBuff({
        name: "遣神役鬼",
        targetId,
        stat: "attackPercent",
        value: 0.4,
        remaining: 2,
        source: "huohuo-ult",
      }));
    });
    notes.push("终结技使除自身外队友回20%能量上限；全队攻击+40%持续2回合。");
    return;
  }

  if (mode === "skill") {
    spendSkillPoint(combat, 1);
    addEnergy(combat, id, 30);
    state.selectedIds.forEach((targetId) => addEnergy(combat, targetId, 4));
    refreshBuff(combat, makeBuff({
      name: "禳命",
      targetId: "team",
      stat: "speedPercent",
      value: 0.12,
      remaining: 3,
      source: "huohuo-talent-e1",
      tickOnId: IDS.HUOHUO,
    }));
    notes.push("战技获得【禳命】3回合；1魂使全队速度+12%；同一种心情叠5使全队回能+4。");
    return;
  }

  addEnergy(combat, id, 20);
  notes.push("普攻回能+20。");
}

function tickBuffsAfterAction(combat, actorId) {
  combat.buffs = combat.buffs
    .map((buff) => {
      const shouldTick = buff.tickOnId ? buff.tickOnId === actorId : buff.targetId === actorId;
      return shouldTick ? { ...buff, remaining: buff.remaining - 1 } : buff;
    })
    .filter((buff) => buff.remaining > 0);
}

function getActionOptions(id) {
  if (id === IDS.SILVER_WOLF) {
    return [
      ["skill", "战技"],
      ["enhanced", "强化普攻"],
    ];
  }
  if (id === IDS.SPARKLE) {
    return [
      ["enhanced", "耗点强普"],
      ["ultimate", "终结技"],
    ];
  }
  if (id === IDS.YAOGUANG) {
    return [
      ["auto", "自动：战技-普攻-普攻"],
      ["skill", "战技"],
      ["basic", "普攻"],
      ["ultimate", "终结技"],
    ];
  }
  if (id === IDS.HUOHUO) {
    return [
      ["auto", "自动：每动战技"],
      ["skill", "战技"],
      ["basic", "普攻"],
      ["ultimate", "终结技"],
    ];
  }
  return [["basic", "普攻"]];
}

function getActionModeLabel(id, mode) {
  if (id === IDS.YAOGUANG && mode === "auto") return "自动";
  if (id === IDS.HUOHUO && mode === "auto") return "自动";
  return getActionOptions(id).find(([value]) => value === mode)?.[1] || "普攻";
}

function renderCharacters() {
  const query = state.query.trim().toLowerCase();
  const filtered = characters.filter((character) => character.name.toLowerCase().includes(query));
  const selectedSet = new Set(state.selectedIds);
  const atLimit = state.selectedIds.length >= 5;

  els.grid.innerHTML = filtered.map((character) => {
    const selected = selectedSet.has(character.id);
    const disabled = atLimit && !selected;
    return `
      <button class="character-card ${selected ? "selected" : ""}" data-id="${character.id}" type="button" ${disabled ? "disabled" : ""} title="${character.name}">
        <img src="${character.icon}" alt="" loading="lazy" />
        <strong>${character.name}</strong>
        <span>基础 ${formatNumber(character.baseSpd)}</span>
      </button>
    `;
  }).join("");
}

function renderSelectedStrip() {
  if (!state.selectedIds.length) {
    els.selectedStrip.innerHTML = '<div class="empty">请选择至少 1 个角色。</div>';
    return;
  }
  els.selectedStrip.innerHTML = state.selectedIds.map((id) => {
    const character = byId(id);
    return `
      <span class="selected-pill">
        <img src="${character.icon}" alt="" />
        ${character.name}
      </span>
    `;
  }).join("");
}

function renderSpeedRows() {
  if (!state.selectedIds.length) {
    els.speedRows.innerHTML = '<div class="empty">选择角色后填写局外面板速度和翁瓦克状态。</div>';
    return;
  }

  els.speedRows.innerHTML = state.selectedIds.map((id) => {
    const character = byId(id);
    const inactiveVonwacq = state.vonwacq[id] && !isVonwacqActive(character);
    return `
      <div class="speed-row">
        <div class="char-inline">
          <img src="${character.icon}" alt="" />
          <div>
            <strong>${character.name}</strong>
            <span>局外面板速度</span>
          </div>
        </div>
        <input class="speed-input" data-id="${id}" type="number" min="1" step="0.1" value="${getBaseInput(character)}" aria-label="${character.name} 局外速度" />
        <span class="arrow">→</span>
        <span class="final-speed">${formatNumber(getBaseInput(character))}</span>
        <button class="toggle-button ${state.vonwacq[id] ? "active" : ""}" data-vonwacq="${id}" type="button" title="${inactiveVonwacq ? "当前速度未达到 120，翁瓦克不生效" : "战斗开始行动提前 40%"}">翁瓦克</button>
      </div>
    `;
  }).join("");
}

function renderBattlePanel() {
  if (!state.selectedIds.length) {
    els.bonusPanel.innerHTML = '<div class="empty">选择角色后填写攻击、欢愉度和双暴，并选择行动方式。</div>';
    return;
  }

  els.bonusPanel.innerHTML = `
    <div class="skill-point-row">
      <strong>战技点</strong>
      <label>初始<input id="initialSkillPoints" type="number" min="0" max="${getSkillPointLimit()}" step="1" value="${state.initialSkillPoints}" /></label>
      <span>当前上限 <b>${getSkillPointLimit()}</b>（火花专光按欢愉角色数最多 +3）</span>
    </div>
    ${state.selectedIds.map((id) => {
    const character = byId(id);
    const panel = getPanelInput(id);
    const options = getActionOptions(id).map(([value, label]) =>
      `<option value="${value}" ${state.actionModes[id] === value ? "selected" : ""}>${label}</option>`
    ).join("");
    const tracked = TRACKED_IDS.has(id) ? "tracked" : "";
    return `
      <div class="battle-row ${tracked}">
        <div class="char-inline battle-char">
          <img src="${character.icon}" alt="" />
          <div>
            <strong>${character.name}</strong>
            <span>${TRACKED_IDS.has(id) ? "记录快照" : "仅参与行动轴"}</span>
          </div>
        </div>
        <label>攻击<input data-panel="${id}:atk" type="number" min="0" step="1" value="${panel.atk}" /></label>
        <label>欢愉<input data-panel="${id}:elation" type="number" min="0" step="0.1" value="${panel.elation}" /></label>
        <label>暴击<input data-panel="${id}:critRate" type="number" min="0" step="0.1" value="${panel.critRate}" /></label>
        <label>暴伤<input data-panel="${id}:critDmg" type="number" min="0" step="0.1" value="${panel.critDmg}" /></label>
        <label>行动<select data-action-mode="${id}">${options}</select></label>
      </div>
    `;
  }).join("")}
  `;
}

function renderAhaPanel() {
  const aha = getAhaSpeedInfo();
  if (!aha) {
    els.ahaPanel.innerHTML = "";
    return;
  }

  els.ahaPanel.innerHTML = `
    <article class="panel aha-card">
      <div class="aha-speed">
        <span>阿哈速度</span>
        <strong>${formatNumber(aha.speed)}</strong>
      </div>
      <div>
        <div class="aha-breakdown">
          <span class="aha-chip">基础 <b>80</b></span>
          ${aha.parts.map((part, index) => `
            <span class="aha-chip">#${index + 1} ${part.name} <b>${formatNumber(part.speed)}</b> × <em>${Math.round(part.ratio * 100)}%</em> = <b>+${formatNumber(part.bonus)}</b></span>
          `).join("")}
        </div>
        <p class="note">选中欢愉角色时，阿哈时刻会加入行动轴；阿哈行动会给欢愉角色施加【好活当赏】2回合。</p>
      </div>
    </article>
  `;
}

function renderTimeline() {
  if (!state.selectedIds.length) {
    els.timelineTabs.innerHTML = "";
    els.timeline.innerHTML = "";
    return;
  }

  els.timelineTabs.innerHTML = windows.map((windowDef, index) => `
    <button class="tab-button ${index === state.activeWindowIndex ? "active" : ""}" data-window-index="${index}" type="button">
      ${windowDef.label}<span>${windowDef.limit}</span>
    </button>
  `).join("");

  const windowDef = windows[state.activeWindowIndex] || windows[0];
  const rows = buildCombat(windowDef.limit);
  els.timeline.innerHTML = `
    <article class="panel timeline-card">
      <h2>${windowDef.label}<span>${windowDef.limit}</span></h2>
      <div class="action-list">
        ${rows.map((row, index) => renderActionRow(row, index)).join("") || '<div class="empty">当前速度下该窗口内没有行动。</div>'}
      </div>
      <p class="note">伤害为粗略预计：只按当前攻击、双暴和已列技能倍率计算，不计敌方防御、抗性、减防、易伤等完整乘区。银狼盲盒忽略随机附加效果。</p>
    </article>
  `;
}

function renderActionRow(row, index) {
  const snapshot = row.snapshot;
  return `
    <div class="action-row ${row.cycle === 0 ? "first-cycle" : ""} ${snapshot ? "with-snapshot" : ""}">
      <span class="rank">${index + 1}</span>
      <img src="${row.icon}" alt="" />
      <span class="action-name">
        ${escapeHtml(row.name)}
        <em>${escapeHtml(row.modeLabel || "")}</em>
      </span>
      <span class="action-time">${formatNumber(row.av)}</span>
      ${snapshot ? renderSnapshot(row) : renderAhaSnapshot(row)}
    </div>
  `;
}

function renderSnapshot(row) {
  const s = row.snapshot;
  return `
    <div class="snapshot">
      <div class="snapshot-stats">
        <span>攻 <b>${formatNumber(s.atk)}</b></span>
        <span>速 <b>${formatNumber(s.speed)}</b></span>
        <span>欢 <b>${formatNumber(s.elation)}</b></span>
        <span>暴 <b>${formatNumber(s.critRate)}%</b></span>
        <span>伤 <b>${formatNumber(s.critDmg)}%</b></span>
        ${row.id === IDS.SILVER_WOLF ? `<span>隐藏分 <b>${formatNumber(s.hidden)}</b></span>` : ""}
        <span>能量 <b>${formatNumber(s.energy)}</b></span>
        <span class="${s.skillPoints < 0 ? "danger-stat" : ""}">战技点 <b>${formatNumber(s.skillPoints)}/${formatNumber(s.skillPointLimit)}</b></span>
        <span>笑点 <b>${formatNumber(row.punchline)}</b></span>
      </div>
      <div class="snapshot-meta">
        <span>回能 ${formatSigned(row.energyDelta)}</span>
        <span>战技点 ${formatSigned(row.skillPointDelta)}</span>
      </div>
      <div class="buff-list">
        ${s.buffs.map((buff) => `<span>${escapeHtml(buff)}</span>`).join("")}
      </div>
      ${row.damageLines.length ? `
        <div class="damage-list">
          ${row.damageLines.map((line) => `
            <span>
              ${escapeHtml(line.label)}
              <b>${formatNumber(line.expected)}</b>
              <em>裸 ${formatNumber(line.raw)}${line.note ? `，${escapeHtml(line.note)}` : ""}</em>
            </span>
          `).join("")}
        </div>
      ` : ""}
      ${row.note ? `<p>${escapeHtml(row.note)}</p>` : ""}
    </div>
  `;
}

function renderAhaSnapshot(row) {
  return `
    <div class="snapshot">
      <div class="buff-list"><span>${escapeHtml(row.note || "阿哈行动")}</span></div>
    </div>
  `;
}

function render() {
  renderCharacters();
  renderSelectedStrip();
  renderSpeedRows();
  renderBattlePanel();
  renderAhaPanel();
  renderTimeline();
}

els.search.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderCharacters();
});

els.grid.addEventListener("click", (event) => {
  const card = event.target.closest(".character-card");
  if (!card || card.disabled) return;
  const id = card.dataset.id;
  if (state.selectedIds.includes(id)) {
    state.selectedIds = state.selectedIds.filter((selectedId) => selectedId !== id);
  } else if (state.selectedIds.length < 5) {
    state.selectedIds.push(id);
    ensureCharacterState(id);
  }
  render();
});

els.speedRows.addEventListener("input", (event) => {
  if (event.target.matches(".speed-input")) {
    state.speedInputs[event.target.dataset.id] = Number(event.target.value) || 1;
    render();
  }
});

els.speedRows.addEventListener("click", (event) => {
  const button = event.target.closest("[data-vonwacq]");
  if (!button) return;
  const id = button.dataset.vonwacq;
  state.vonwacq[id] = !state.vonwacq[id];
  render();
});

els.bonusPanel.addEventListener("input", (event) => {
  if (event.target.id === "initialSkillPoints") {
    state.initialSkillPoints = Math.max(0, Math.min(getSkillPointLimit(), Number(event.target.value) || 0));
    renderBattlePanel();
    renderTimeline();
    return;
  }
  const key = event.target.dataset.panel;
  if (!key) return;
  const [id, field] = key.split(":");
  state.panelInputs[id] = {
    ...getPanelInput(id),
    [field]: Number(event.target.value) || 0,
  };
  renderAhaPanel();
  renderTimeline();
});

els.bonusPanel.addEventListener("change", (event) => {
  const id = event.target.dataset.actionMode;
  if (!id) return;
  state.actionModes[id] = event.target.value;
  renderTimeline();
});

els.timelineTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-window-index]");
  if (!button) return;
  state.activeWindowIndex = Number(button.dataset.windowIndex);
  renderTimeline();
});

els.clearAll.addEventListener("click", () => {
  state.selectedIds = [];
  state.speedInputs = {};
  state.panelInputs = {};
  state.actionModes = {};
  state.initialSkillPoints = 5;
  state.vonwacq = {};
  render();
});

state.selectedIds = [
  IDS.SILVER_WOLF,
  IDS.YAOGUANG,
  IDS.SPARKLE,
  IDS.HUOHUO,
  "8010",
].filter((id) => byId(id));
state.selectedIds.forEach(ensureCharacterState);
state.initialSkillPoints = getSkillPointLimit();
state.actionModes[IDS.YAOGUANG] = "auto";
state.actionModes[IDS.HUOHUO] = "auto";
render();
