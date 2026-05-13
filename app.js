const characters = window.HSR_CHARACTERS || [];
const state = {
  selectedIds: [],
  speedInputs: {},
  vonwacq: {},
  bonusEnabled: {},
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
  { label: "王棋2t", limit: 600 },
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

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(round(value, 1));
}

function getBaseInput(character) {
  return Number(state.speedInputs[character.id] ?? character.baseSpd);
}

function getEnabledBonuses(character) {
  return (character.speedOptions || []).filter((option) => state.bonusEnabled[`${character.id}:${option.id}`]);
}

function getEnabledTeamBonuses() {
  return state.selectedIds
    .map((id) => byId(id))
    .flatMap((character) => (character?.speedOptions || []).map((option) => ({ character, option })))
    .filter(({ character, option }) => option.scope === "team" && state.bonusEnabled[`${character.id}:${option.id}`])
    .map(({ option }) => option);
}

function getEffectiveSpeed(character) {
  const inputSpeed = getBaseInput(character);
  const optionBonuses = getEnabledBonuses(character).filter((option) => option.scope !== "team");
  const teamBonuses = getEnabledTeamBonuses();
  const flatFromOptions = optionBonuses
    .filter((option) => option.type === "flat")
    .reduce((sum, option) => sum + option.value, 0);
  const percentFromOptions = [...optionBonuses, ...teamBonuses]
    .filter((option) => option.type === "percent")
    .reduce((sum, option) => sum + option.value, 0);
  const speed = inputSpeed + flatFromOptions + character.baseSpd * percentFromOptions / 100;
  return Math.max(1, speed);
}

function isVonwacqActive(character) {
  if (!state.vonwacq[character.id]) return false;
  return getEffectiveSpeed(character) >= 120;
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
      speed: getEffectiveSpeed(character),
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

function getUnits() {
  const units = state.selectedIds.map((id, index) => {
    const character = byId(id);
    const speed = getEffectiveSpeed(character);
    const interval = 10000 / speed;
    const firstAction = interval * (isVonwacqActive(character) ? 0.6 : 1);
    return {
      id,
      index,
      name: character.name,
      icon: character.icon,
      speed,
      interval,
      nextAv: firstAction,
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
      speed: aha.speed,
      interval,
      nextAv: interval,
      actionCount: 0,
      isAha: true,
    });
  }

  return units;
}

function calculateTimeline(limit) {
  const units = getUnits();
  const result = [];
  while (units.length && result.length < 120) {
    units.sort((a, b) => a.nextAv - b.nextAv || b.speed - a.speed || a.index - b.index);
    const unit = units[0];
    if (unit.nextAv - limit > 1e-9) break;
    result.push({
      ...unit,
      av: unit.nextAv,
      cycle: unit.actionCount,
    });
    unit.actionCount += 1;
    unit.nextAv += unit.interval;
  }
  return result;
}

function renderCharacters() {
  const query = state.query.trim().toLowerCase();
  const filtered = characters.filter((character) => character.name.toLowerCase().includes(query));
  const selectedSet = new Set(state.selectedIds);
  const atLimit = state.selectedIds.length >= 4;

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
    els.speedRows.innerHTML = '<div class="empty">选择角色后可填写具体速度和翁瓦克状态。</div>';
    return;
  }

  els.speedRows.innerHTML = state.selectedIds.map((id) => {
    const character = byId(id);
    const effective = getEffectiveSpeed(character);
    const inactiveVonwacq = state.vonwacq[id] && !isVonwacqActive(character);
    return `
      <div class="speed-row">
        <div class="char-inline">
          <img src="${character.icon}" alt="" />
          <div>
            <strong>${character.name}</strong>
            <span>基础 ${formatNumber(character.baseSpd)}</span>
          </div>
        </div>
        <input class="speed-input" data-id="${id}" type="number" min="1" step="0.1" value="${getBaseInput(character)}" aria-label="${character.name} 具体速度" />
        <span class="arrow">→</span>
        <span class="final-speed">${formatNumber(effective)}</span>
        <button class="toggle-button ${state.vonwacq[id] ? "active" : ""}" data-vonwacq="${id}" type="button" title="${inactiveVonwacq ? "当前速度未达到 120，翁瓦克不生效" : "战斗开始行动提前 40%"}">翁瓦克</button>
      </div>
    `;
  }).join("");
}

function renderBonusPanel() {
  const charactersWithOptions = state.selectedIds
    .map((id) => byId(id))
    .filter((character) => character?.speedOptions?.length);

  if (!charactersWithOptions.length) {
    els.bonusPanel.innerHTML = '<div class="empty">当前选择角色没有可选速度加成。</div>';
    return;
  }

  els.bonusPanel.innerHTML = charactersWithOptions.map((character) => {
    const id = character.id;
    const options = character.speedOptions || [];
    const optionHtml = options.map((option) => {
        const key = `${id}:${option.id}`;
        return `<button class="bonus-button ${state.bonusEnabled[key] ? "active" : ""}" data-bonus="${key}" type="button">${option.label}</button>`;
      }).join("");

    return `
      <div class="bonus-group">
        <div class="char-inline">
          <img src="${character.icon}" alt="" />
          <div>
            <strong>${character.name}</strong>
            <span>实际速度 ${formatNumber(getEffectiveSpeed(character))}</span>
          </div>
        </div>
        <div class="bonus-options">${optionHtml}</div>
      </div>
    `;
  }).join("");
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
        <p class="note">选中欢愉角色时，阿哈时刻会按此速度加入行动轴；修改角色实际速度后会同步更新。</p>
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
  const rows = calculateTimeline(windowDef.limit);
  els.timeline.innerHTML = `
    <article class="panel timeline-card">
      <h2>${windowDef.label}<span>${windowDef.limit}</span></h2>
      <div class="action-list">
        ${rows.map((row, index) => `
          <div class="action-row ${row.cycle === 0 ? "first-cycle" : ""}">
            <span class="rank">${index + 1}</span>
            <img src="${row.icon}" alt="" />
            <span class="action-name">${row.name}</span>
            <span class="action-time">${formatNumber(row.av)}</span>
          </div>
        `).join("") || '<div class="empty">当前速度下该窗口内没有行动。</div>'}
      </div>
      <p class="note">公式：行动间隔 = 10000 / 实际速度；翁瓦克生效时首次行动值为行动间隔 × 60%。</p>
    </article>
  `;
}

function render() {
  renderCharacters();
  renderSelectedStrip();
  renderSpeedRows();
  renderBonusPanel();
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
  } else if (state.selectedIds.length < 4) {
    state.selectedIds.push(id);
    const character = byId(id);
    state.speedInputs[id] = character.baseSpd;
  }
  render();
});

els.speedRows.addEventListener("input", (event) => {
  if (event.target.matches(".speed-input")) {
    state.speedInputs[event.target.dataset.id] = Number(event.target.value) || 1;
    const character = byId(event.target.dataset.id);
    const row = event.target.closest(".speed-row");
    row.querySelector(".final-speed").textContent = formatNumber(getEffectiveSpeed(character));
    renderBonusPanel();
    renderAhaPanel();
    renderTimeline();
  }
});

els.speedRows.addEventListener("click", (event) => {
  const button = event.target.closest("[data-vonwacq]");
  if (!button) return;
  const id = button.dataset.vonwacq;
  state.vonwacq[id] = !state.vonwacq[id];
  render();
});

els.bonusPanel.addEventListener("click", (event) => {
  const button = event.target.closest("[data-bonus]");
  if (!button) return;
  const key = button.dataset.bonus;
  state.bonusEnabled[key] = !state.bonusEnabled[key];
  render();
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
  state.vonwacq = {};
  state.bonusEnabled = {};
  render();
});

state.selectedIds = characters.slice(0, 2).map((character) => character.id);
state.selectedIds.forEach((id) => {
  state.speedInputs[id] = byId(id).baseSpd;
});
render();
