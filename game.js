(() => {
  "use strict";

  const canvas = document.querySelector("#gameCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const arena = document.querySelector("#arena");
  const ui = {
    timer: document.querySelector("#timerText"),
    wave: document.querySelector("#waveText"),
    health: document.querySelector("#healthText"),
    kills: document.querySelector("#killText"),
    stamina: document.querySelector("#staminaText"),
    staminaFill: document.querySelector("#staminaFill"),
    level: document.querySelector("#levelText"),
    xp: document.querySelector("#xpText"),
    xpFill: document.querySelector("#xpFill"),
    slow: document.querySelector("#slowChip"),
    slowLabel: document.querySelector("#slowLabel"),
    toast: document.querySelector("#combatToast"),
    combo: document.querySelector("#comboCounter"),
    comboValue: document.querySelector("#comboValue"),
    comboLabel: document.querySelector("#comboLabel"),
    prediction: document.querySelector("#predictionPanel"),
    predictionTitle: document.querySelector("#predictionTitle"),
    predictionSummary: document.querySelector("#predictionSummary"),
    predictionHint: document.querySelector("#predictionHint"),
    startOverlay: document.querySelector("#startOverlay"),
    pauseOverlay: document.querySelector("#pauseOverlay"),
    upgradeOverlay: document.querySelector("#upgradeOverlay"),
    endOverlay: document.querySelector("#endOverlay"),
    upgradeChoices: document.querySelector("#upgradeChoices"),
    endIcon: document.querySelector("#endIcon"),
    endEyebrow: document.querySelector("#endEyebrow"),
    endTitle: document.querySelector("#endTitle"),
    endCopy: document.querySelector("#endCopy"),
    finalTime: document.querySelector("#finalTime"),
    finalKills: document.querySelector("#finalKills"),
    pauseButton: document.querySelector("#pauseButton"),
  };

  const SURVIVE_SECONDS = 180;
  const BASE_HEALTH = 7;
  const BASE_STAMINA = 4;
  const COMBO_WINDOW = 1.55;
  const UPGRADE_POOL = [
    { id: "edge", icon: "⌁", title: "淬火刃锋", detail: "追光突刺伤害 +1。更快斩穿厚甲敌人。" },
    { id: "breath", icon: "↗", title: "调息回劲", detail: "体力回复速度提高 0.22 点 / 秒。" },
    { id: "reserve", icon: "✦", title: "扩充气海", detail: "体力上限 +1，并立即回复 1 点体力。" },
    { id: "charge", icon: "➤", title: "逆鳞蓄势", detail: "冲撞伤害 +1，反弹后的延长距离增加。" },
    { id: "heart", icon: "♥", title: "余烬护身", detail: "生命上限 +1，并恢复 1 点生命。" },
  ];

  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let scale = 1;
  let stars = [];
  let enemies = [];
  let effects = [];
  let dash = null;
  let mode = "ready";
  let timeStopped = false;
  let stopWaveRadius = 0;
  let stopFade = 0;
  let planningState = null;
  let plannedActions = [];
  let replayQueue = [];
  let replayAction = null;
  let replaying = false;
  let replayTotal = 0;
  let replayDone = 0;
  let attackGesture = null;
  let previewPlan = null;
  let toastTimer = 0;
  let comboCount = 0;
  let comboTimer = 0;
  let screenShakeTime = 0;
  let screenShakeDuration = 0;
  let screenShakeStrength = 0;
  let spawnTimer = 0.7;
  let gameTime = 0;
  let realTime = 0;
  let kills = 0;
  let level = 1;
  let levelKills = 0;
  let killsToNextLevel = 8;
  let wave = 1;
  let healthMarkup = "";
  let lastFrame = 0;
  let runEndTime = 0;

  const player = {
    x: 0,
    y: 0,
    hp: BASE_HEALTH,
    maxHp: BASE_HEALTH,
    stamina: BASE_STAMINA,
    maxStamina: BASE_STAMINA,
    staminaRegen: 0.62,
    thrustDamage: 1,
    chargeDamage: 2,
    thrustDistance: 142,
    chargeDistance: 272,
    bounceDistance: 112,
    invulnerable: 0,
  };

  const mouse = { x: 0, y: 0 };

  function center() {
    return { x: width / 2, y: height / 2 };
  }

  function formatTime(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const minutes = String(Math.floor(total / 60)).padStart(2, "0");
    const remainder = String(total % 60).padStart(2, "0");
    return `${minutes}:${remainder}`;
  }

  function setOverlay(element, visible) {
    element.classList.toggle("is-hidden", !visible);
  }

  function resizeCanvas() {
    const oldWidth = width;
    const oldHeight = height;
    const rect = arena.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    scale = Math.min(width, height) / 760;
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    if (oldWidth > 0 && oldHeight > 0) {
      const sx = width / oldWidth;
      const sy = height / oldHeight;
      player.x *= sx;
      player.y *= sy;
      for (const enemy of enemies) {
        enemy.x *= sx;
        enemy.y *= sy;
        enemy.vx *= sx;
        enemy.vy *= sy;
      }
      for (const effect of effects) {
        effect.x *= sx;
        effect.y *= sy;
      }
    } else {
      const origin = center();
      player.x = origin.x;
      player.y = origin.y;
      mouse.x = origin.x;
      mouse.y = origin.y - 1;
    }

    stars = Array.from({ length: Math.round((width * height) / 5100) }, (_, index) => {
      const seed = (index * 9301 + 49297) % 233280;
      const seed2 = (index * 49297 + 13579) % 233280;
      return {
        x: (seed / 233280) * width,
        y: (seed2 / 233280) * height,
        r: 0.45 + ((index * 7) % 12) / 10,
        phase: (index * 19) % 100,
      };
    });
  }

  function showToast(message, tone = "ember") {
    ui.toast.textContent = message;
    ui.toast.dataset.tone = tone;
    ui.toast.classList.add("visible");
    toastTimer = 1.15;
  }

  function syncHealth() {
    const markup = `${"<span>♥</span>".repeat(player.hp)}${"<span class=\"empty-heart\">♡</span>".repeat(Math.max(0, player.maxHp - player.hp))}`;
    if (markup !== healthMarkup) {
      healthMarkup = markup;
      ui.health.innerHTML = markup;
      ui.health.setAttribute("aria-label", `生命值 ${player.hp} / ${player.maxHp}`);
    }
  }

  function syncHud() {
    ui.timer.textContent = formatTime(gameTime);
    ui.wave.textContent = `第 ${String(wave).padStart(2, "0")} 波 · 敌潮逼近`;
    const forecast = timeStopped
      ? (attackGesture && previewPlan && previewPlan.valid ? previewPlan.after : planningState)
      : null;
    const visibleStamina = forecast ? planningState.stamina : player.stamina;
    const visibleKills = forecast ? planningState.kills : kills;
    const visibleLevelKills = forecast ? planningState.levelKills : levelKills;
    ui.kills.textContent = String(visibleKills).padStart(2, "0");
    ui.stamina.textContent = `${forecast ? "预计 " : ""}${visibleStamina.toFixed(1)} / ${player.maxStamina}`;
    ui.stamina.classList.toggle("forecast-value", Boolean(forecast));
    ui.staminaFill.style.width = `${Math.max(0, Math.min(100, visibleStamina / player.maxStamina * 100))}%`;
    ui.level.textContent = String(level).padStart(2, "0");
    ui.xp.textContent = `${visibleLevelKills} / ${killsToNextLevel}`;
    ui.xp.classList.toggle("forecast-value", Boolean(forecast));
    ui.xpFill.style.width = `${Math.min(100, visibleLevelKills / killsToNextLevel * 100)}%`;
    ui.slow.classList.toggle("visible", mode === "playing" && (timeStopped || replaying));
    ui.slowLabel.textContent = timeStopped ? "时停中 · 周遭褪色" : "慢镜回放 · 世界将醒";
    ui.pauseButton.innerHTML = mode === "paused" ? "▶ <span>继续</span>" : "Ⅱ <span>暂停</span>";
    syncPredictionHud();
    syncComboCounter();
    syncHealth();
  }

  function syncComboCounter() {
    const forecast = timeStopped && planningState;
    const preview = forecast && attackGesture && previewPlan && previewPlan.valid ? previewPlan.after : planningState;
    const visibleCount = preview ? preview.comboCount : comboCount;
    const visible = visibleCount >= 2 && (Boolean(forecast) || comboTimer > 0);
    const isForecast = Boolean(forecast);
    const formattedCount = String(visibleCount).padStart(2, "0");
    if (ui.comboValue.textContent !== formattedCount) ui.comboValue.textContent = formattedCount;
    ui.comboLabel.textContent = isForecast ? "预演连击" : "HIT COMBO";
    ui.combo.classList.toggle("visible", visible);
    ui.combo.classList.toggle("forecast", isForecast && visible);
    ui.combo.setAttribute("aria-hidden", String(!visible));
  }

  function resetRun() {
    enemies = [];
    effects = [];
    dash = null;
    gameTime = 0;
    realTime = 0;
    kills = 0;
    level = 1;
    levelKills = 0;
    killsToNextLevel = 8;
    wave = 1;
    spawnTimer = 0.65;
    timeStopped = false;
    stopWaveRadius = 0;
    stopFade = 0;
    planningState = null;
    plannedActions = [];
    replayQueue = [];
    replayAction = null;
    replaying = false;
    replayTotal = 0;
    replayDone = 0;
    attackGesture = null;
    previewPlan = null;
    comboCount = 0;
    comboTimer = 0;
    screenShakeTime = 0;
    screenShakeDuration = 0;
    screenShakeStrength = 0;
    player.hp = BASE_HEALTH;
    player.maxHp = BASE_HEALTH;
    player.stamina = BASE_STAMINA;
    player.maxStamina = BASE_STAMINA;
    player.staminaRegen = 0.62;
    player.thrustDamage = 1;
    player.chargeDamage = 2;
    player.thrustDistance = 142;
    player.chargeDistance = 272;
    player.bounceDistance = 112;
    player.invulnerable = 0;
    const origin = center();
    player.x = origin.x;
    player.y = origin.y;
    mode = "playing";
    setOverlay(ui.startOverlay, false);
    setOverlay(ui.pauseOverlay, false);
    setOverlay(ui.upgradeOverlay, false);
    setOverlay(ui.endOverlay, false);
    syncHud();
  }

  function getPointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function beginDash(type) {
    if (mode !== "playing" || dash || timeStopped || replaying) return;
    const cost = type === "thrust" ? 1 : 2;
    if (player.stamina + 0.001 < cost) {
      showToast("体力不足 · 稍候回劲", "mint");
      return;
    }
    const origin = { x: player.x, y: player.y };
    let dx = mouse.x - origin.x;
    let dy = mouse.y - origin.y;
    const length = Math.hypot(dx, dy);
    if (length < 1) {
      dx = 0;
      dy = -1;
    } else {
      dx /= length;
      dy /= length;
    }

    player.stamina = Math.max(0, player.stamina - cost);
    const isThrust = type === "thrust";
    dash = {
      type,
      startX: player.x,
      startY: player.y,
      dx,
      dy,
      distanceLeft: (isThrust ? player.thrustDistance : player.chargeDistance) * scale,
      speed: (isThrust ? 890 : 1110) * scale,
      hitIds: new Set(),
      bounced: false,
      bounceCount: 0,
      bouncePoints: [],
      pathSegments: [],
    };
    syncHud();
  }

  function spawnEnemy() {
    if (enemies.length >= 180 || mode !== "playing") return;
    const angle = Math.random() * Math.PI * 2;
    const desiredDistance = Math.min(width, height) * (0.46 + Math.random() * 0.065);
    const origin = { x: player.x, y: player.y };
    let type = "stalker";
    const pick = Math.random();
    if (gameTime > 22 && pick < 0.28) type = "runner";
    if (gameTime > 48 && pick > 0.78) type = "brute";

    const waveBoost = Math.floor(gameTime / 55);
    const specs = {
      stalker: { radius: 13, hp: 1 + Math.floor(waveBoost / 2), speed: 40, color: "#dc7464", xp: 1 },
      runner: { radius: 10, hp: 1 + Math.floor(waveBoost / 3), speed: 68, color: "#65b7a7", xp: 1 },
      brute: { radius: 19, hp: 3 + waveBoost, speed: 28, color: "#ae82c4", xp: 2 },
    };
    const spec = specs[type];
    const margin = spec.radius * scale + 5 * scale;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const distanceToXEdge = dx > 0
      ? (width - margin - origin.x) / dx
      : dx < 0 ? (margin - origin.x) / dx : Infinity;
    const distanceToYEdge = dy > 0
      ? (height - margin - origin.y) / dy
      : dy < 0 ? (margin - origin.y) / dy : Infinity;
    const maxDistance = Math.max(0, Math.min(distanceToXEdge, distanceToYEdge));
    const distance = Math.min(desiredDistance, maxDistance);
    enemies.push({
      id: `${Math.random().toString(36).slice(2)}-${gameTime}`,
      type,
      x: Math.max(margin, Math.min(width - margin, origin.x + dx * distance)),
      y: Math.max(margin, Math.min(height - margin, origin.y + dy * distance)),
      vx: 0,
      vy: 0,
      radius: spec.radius * scale,
      hp: spec.hp,
      maxHp: spec.hp,
      speed: spec.speed * scale * (1 + Math.min(0.55, gameTime * 0.0012)),
      color: spec.color,
      xp: spec.xp,
      contactCooldown: 0,
      flash: 0,
      angle: Math.random() * Math.PI * 2,
      dead: false,
    });
  }

  function addEffect(effect) {
    effects.push(effect);
    if (effects.length > 120) effects.splice(0, effects.length - 120);
  }

  function burst(x, y, color, amount = 9, strength = 1) {
    for (let i = 0; i < amount; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (45 + Math.random() * 150) * scale * strength;
      const life = 0.24 + Math.random() * 0.35;
      addEffect({
        type: "spark",
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life,
        maxLife: life,
        size: (1.5 + Math.random() * 2.4) * scale,
        color,
      });
    }
    addEffect({ type: "ring", x, y, life: 0.25, maxLife: 0.25, color });
  }

  function triggerScreenShake(strength, duration = 0.2) {
    const currentStrength = screenShakeDuration > 0
      ? screenShakeStrength * Math.max(0, screenShakeTime / screenShakeDuration)
      : 0;
    if (strength < currentStrength) return;
    screenShakeStrength = strength;
    screenShakeTime = duration;
    screenShakeDuration = duration;
  }

  function registerComboHit() {
    comboCount = comboTimer > 0 ? comboCount + 1 : 1;
    comboTimer = COMBO_WINDOW;
    if (comboCount >= 2) {
      ui.combo.classList.remove("combo-pop");
      void ui.combo.offsetWidth;
      ui.combo.classList.add("combo-pop");
    }
  }

  function addFloatingText(x, y, text, color) {
    addEffect({ type: "text", x, y, text, color, life: 0.7, maxLife: 0.7 });
  }

  function normalize(x, y, fallbackX = 0, fallbackY = -1) {
    let length = Math.hypot(x, y);
    if (length < 0.000001) {
      x = fallbackX;
      y = fallbackY;
      length = Math.hypot(x, y);
    }
    if (length < 0.000001) return { x: 0, y: -1 };
    return { x: x / length, y: y / length };
  }

  function closestOnSegment(ax, ay, bx, by, px, py) {
    const vx = bx - ax;
    const vy = by - ay;
    const lengthSq = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lengthSq));
    return { x: ax + vx * t, y: ay + vy * t, t };
  }

  function segmentContact(ax, ay, bx, by, enemy) {
    const point = closestOnSegment(ax, ay, bx, by, enemy.x, enemy.y);
    const reach = enemy.radius + 12 * scale;
    const dx = point.x - enemy.x;
    const dy = point.y - enemy.y;
    if (dx * dx + dy * dy <= reach * reach) return point;
    return null;
  }

  function firstSurfaceContact(ax, ay, bx, by, enemy) {
    const vx = bx - ax;
    const vy = by - ay;
    const ox = ax - enemy.x;
    const oy = ay - enemy.y;
    const reach = enemy.radius + 12 * scale;
    const a = vx * vx + vy * vy;
    const c = ox * ox + oy * oy - reach * reach;
    if (a < 0.000001) return c <= 0 ? { x: ax, y: ay, t: 0 } : null;
    if (c <= 0) return { x: ax, y: ay, t: 0 };
    const b = 2 * (ox * vx + oy * vy);
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    const t = (-b - Math.sqrt(discriminant)) / (2 * a);
    if (t < 0 || t > 1) return null;
    return { x: ax + vx * t, y: ay + vy * t, t };
  }

  function damageEnemy(enemy, attackType, point, outward) {
    if (enemy.dead) return;
    registerComboHit();
    const damage = attackType === "thrust" ? player.thrustDamage : player.chargeDamage;
    enemy.hp -= damage;
    enemy.flash = 0.12;
    const force = attackType === "charge" ? 390 : 100;
    triggerScreenShake(attackType === "charge" ? 5.5 : 3.1, attackType === "charge" ? 0.24 : 0.16);
    enemy.vx += outward.x * force * scale;
    enemy.vy += outward.y * force * scale;
    burst(point.x, point.y, attackType === "charge" ? "#ffd095" : "#9de9d4", attackType === "charge" ? 14 : 9, attackType === "charge" ? 1.25 : 0.9);
    addEffect({ type: "slash", x: point.x, y: point.y, angle: Math.atan2(outward.y, outward.x) + Math.PI, life: 0.22, maxLife: 0.22, color: attackType === "charge" ? "#ffd095" : "#a8ecda" });

    if (attackType === "thrust") {
      const refund = 0.38;
      player.stamina = Math.min(player.maxStamina, player.stamina + refund);
      addFloatingText(point.x, point.y - 13 * scale, `+${refund} 体力`, "#a5e6d6");
      showToast("命中回劲", "mint");
    } else {
      addFloatingText(point.x, point.y - 13 * scale, "冲撞命中", "#ffd095");
    }

    if (enemy.hp <= 0) {
      enemy.dead = true;
      kills += 1;
      levelKills += enemy.xp;
      const killRefund = 0.25;
      player.stamina = Math.min(player.maxStamina, player.stamina + killRefund);
      addFloatingText(enemy.x, enemy.y - 21 * scale, `+${killRefund} 击破回劲`, "#a5e6d6");
      addFloatingText(enemy.x, enemy.y - 37 * scale, "击破！", "#ffd095");
      addEffect({ type: "death", x: enemy.x, y: enemy.y, radius: enemy.radius, life: 0.46, maxLife: 0.46, color: enemy.color });
      burst(enemy.x, enemy.y, enemy.color, 22, 1.4);
      triggerScreenShake(11.5, 0.32);
    }
  }

  function damageAlongSegment(ax, ay, bx, by, attackType, hitIds) {
    for (const enemy of enemies) {
      if (enemy.dead || hitIds.has(enemy.id)) continue;
      const point = segmentContact(ax, ay, bx, by, enemy);
      if (!point) continue;
      const outward = normalize(enemy.x - point.x, enemy.y - point.y, bx - ax, by - ay);
      hitIds.add(enemy.id);
      damageEnemy(enemy, attackType, point, outward);
    }
  }

  function firstContact(ax, ay, bx, by, hitIds) {
    let earliest = null;
    for (const enemy of enemies) {
      if (enemy.dead || hitIds.has(enemy.id)) continue;
      const point = firstSurfaceContact(ax, ay, bx, by, enemy);
      if (point && (!earliest || point.t < earliest.point.t)) earliest = { enemy, point };
    }
    return earliest;
  }

  function copyPlanningState(state) {
    return {
      x: state.x,
      y: state.y,
      stamina: state.stamina,
      maxStamina: state.maxStamina,
      kills: state.kills,
      levelKills: state.levelKills,
      comboCount: state.comboCount,
      comboTimer: state.comboTimer,
      enemies: state.enemies.map((enemy) => ({ ...enemy })),
    };
  }

  function snapshotPlanningState() {
    return {
      x: player.x,
      y: player.y,
      stamina: player.stamina,
      maxStamina: player.maxStamina,
      kills,
      levelKills,
      comboCount,
      comboTimer,
      enemies: enemies.filter((enemy) => !enemy.dead).map((enemy) => ({
        id: enemy.id,
        x: enemy.x,
        y: enemy.y,
        vx: enemy.vx,
        vy: enemy.vy,
        radius: enemy.radius,
        hp: enemy.hp,
        maxHp: enemy.maxHp,
        xp: enemy.xp,
        type: enemy.type,
        color: enemy.color,
        dead: false,
      })),
    };
  }

  function distanceToArenaEdge(x, y, dx, dy) {
    const margin = 18 * scale;
    const edgeX = dx > 0
      ? (width - margin - x) / dx
      : dx < 0 ? (margin - x) / dx : Infinity;
    const edgeY = dy > 0
      ? (height - margin - y) / dy
      : dy < 0 ? (margin - y) / dy : Infinity;
    return Math.max(0, Math.min(edgeX, edgeY));
  }

  function appendPlanSegment(plan, x1, y1, x2, y2) {
    const length = Math.hypot(x2 - x1, y2 - y1);
    const segment = {
      x1,
      y1,
      x2,
      y2,
      length,
      startDistance: plan.totalDistance,
      endDistance: plan.totalDistance + length,
    };
    plan.segments.push(segment);
    plan.totalDistance += length;
    return segment;
  }

  function planSegmentHits(plan, state, segment, attackType, hitIds) {
    const contacts = [];
    for (const enemy of state.enemies) {
      if (enemy.dead || hitIds.has(enemy.id)) continue;
      const point = firstSurfaceContact(segment.x1, segment.y1, segment.x2, segment.y2, enemy);
      if (point) contacts.push({ enemy, point });
    }
    contacts.sort((a, b) => a.point.t - b.point.t);
    for (const contact of contacts) {
      if (contact.enemy.dead || hitIds.has(contact.enemy.id)) continue;
      hitIds.add(contact.enemy.id);
      const outward = normalize(contact.enemy.x - contact.point.x, contact.enemy.y - contact.point.y, segment.x2 - segment.x1, segment.y2 - segment.y1);
      addProjectedHit(plan, state, contact.enemy, attackType, contact.point, outward, segment.startDistance + segment.length * contact.point.t);
    }
  }

  function firstProjectedContact(segment, state, hitIds) {
    let earliest = null;
    for (const enemy of state.enemies) {
      if (enemy.dead || hitIds.has(enemy.id)) continue;
      const point = firstSurfaceContact(segment.x1, segment.y1, segment.x2, segment.y2, enemy);
      if (point && (!earliest || point.t < earliest.point.t)) earliest = { enemy, point };
    }
    return earliest;
  }

  function addProjectedHit(plan, state, enemy, attackType, point, outward, pathDistance) {
    const damage = attackType === "thrust" ? player.thrustDamage : player.chargeDamage;
    state.comboCount = state.comboTimer > 0 ? state.comboCount + 1 : 1;
    state.comboTimer = COMBO_WINDOW;
    const hpBefore = enemy.hp;
    const staminaBefore = state.stamina;
    enemy.hp -= damage;
    if (attackType === "thrust") state.stamina = Math.min(state.maxStamina, state.stamina + 0.38);
    const killed = enemy.hp <= 0;
    if (killed) {
      enemy.dead = true;
      state.kills += 1;
      state.levelKills += enemy.xp;
      state.stamina = Math.min(state.maxStamina, state.stamina + 0.25);
    }

    const shove = (attackType === "charge" ? 58 : 15) * scale;
    const margin = enemy.radius + 3 * scale;
    const enemyAfterX = Math.max(margin, Math.min(width - margin, enemy.x + outward.x * shove));
    const enemyAfterY = Math.max(margin, Math.min(height - margin, enemy.y + outward.y * shove));
    const event = {
      enemyId: enemy.id,
      attackType,
      damage,
      x: point.x,
      y: point.y,
      outwardX: outward.x,
      outwardY: outward.y,
      enemyAfterX,
      enemyAfterY,
      hpBefore,
      hpAfter: Math.max(0, enemy.hp),
      killed,
      pathDistance,
      comboCount: state.comboCount,
      staminaBefore,
      staminaAfter: state.stamina,
    };
    plan.events.push(event);
    enemy.x = enemyAfterX;
    enemy.y = enemyAfterY;
  }

  function makeAttackPlan(type, targetX, targetY, sourceState) {
    const state = copyPlanningState(sourceState);
    const cost = type === "thrust" ? 1 : 2;
    const plan = {
      type,
      valid: state.stamina + 0.001 >= cost,
      cost,
      startX: state.x,
      startY: state.y,
      endX: state.x,
      endY: state.y,
      dx: 0,
      dy: -1,
      bounced: false,
      segments: [],
      events: [],
      totalDistance: 0,
      staminaBefore: state.stamina,
      staminaAfter: state.stamina,
      killsBefore: state.kills,
      killsAfter: state.kills,
      reason: "",
      after: state,
    };
    if (!plan.valid) {
      plan.reason = "体力不足";
      return plan;
    }

    let dx = targetX - state.x;
    let dy = targetY - state.y;
    const aimLength = Math.hypot(dx, dy);
    if (aimLength < 1) {
      dx = 0;
      dy = -1;
    } else {
      dx /= aimLength;
      dy /= aimLength;
    }
    plan.dx = dx;
    plan.dy = dy;
    state.stamina = Math.max(0, state.stamina - cost);

    const hitIds = new Set();
    if (type === "thrust") {
      const requested = player.thrustDistance * scale;
      const distance = Math.min(requested, distanceToArenaEdge(state.x, state.y, dx, dy));
      const segment = appendPlanSegment(plan, state.x, state.y, state.x + dx * distance, state.y + dy * distance);
      planSegmentHits(plan, state, segment, "thrust", hitIds);
    } else {
      let remaining = player.chargeDistance * scale;
      let impacts = 0;
      while (remaining > 0.5 && impacts <= state.enemies.length) {
        const available = Math.min(remaining, distanceToArenaEdge(state.x, state.y, dx, dy));
        if (available <= 0.5) break;
        const segment = {
          x1: state.x,
          y1: state.y,
          x2: state.x + dx * available,
          y2: state.y + dy * available,
          length: available,
          startDistance: plan.totalDistance,
        };
        const contact = firstProjectedContact(segment, state, hitIds);
        if (!contact) {
          appendPlanSegment(plan, segment.x1, segment.y1, segment.x2, segment.y2);
          break;
        }

        const travelToContact = available * contact.point.t;
        const impactSegment = appendPlanSegment(plan, state.x, state.y, contact.point.x, contact.point.y);
        state.x = contact.point.x;
        state.y = contact.point.y;
        hitIds.add(contact.enemy.id);
        const normal = normalize(contact.point.x - contact.enemy.x, contact.point.y - contact.enemy.y, -dx, -dy);
        const outward = { x: -normal.x, y: -normal.y };
        addProjectedHit(plan, state, contact.enemy, "charge", contact.point, outward, impactSegment.endDistance);
        plan.bounced = true;
        impacts += 1;
        dx = normal.x;
        dy = normal.y;
        plan.dx = dx;
        plan.dy = dy;
        remaining = Math.max(0, remaining - travelToContact) + player.bounceDistance * scale;
      }
    }

    const finalSegment = plan.segments[plan.segments.length - 1];
    if (finalSegment) {
      state.x = finalSegment.x2;
      state.y = finalSegment.y2;
    }
    plan.endX = state.x;
    plan.endY = state.y;
    plan.staminaAfter = state.stamina;
    plan.killsAfter = state.kills;
    plan.after = state;
    return plan;
  }

  function refreshAttackPreview() {
    if (!attackGesture || mode !== "playing") {
      previewPlan = null;
      return;
    }
    const source = timeStopped && planningState ? planningState : snapshotPlanningState();
    previewPlan = makeAttackPlan(attackGesture.type, mouse.x, mouse.y, source);
  }

  function queuePreparedAttack() {
    if (!attackGesture || !timeStopped || !planningState) return;
    refreshAttackPreview();
    attackGesture = null;
    if (!previewPlan || !previewPlan.valid) {
      showToast("预演取消 · 体力不足", "mint");
      previewPlan = null;
      syncHud();
      return;
    }
    if (plannedActions.length >= 24) {
      showToast("预备动作已满", "mint");
      previewPlan = null;
      syncHud();
      return;
    }
    plannedActions.push(previewPlan);
    planningState = previewPlan.after;
    showToast(`已预备第 ${plannedActions.length} 招`, "mint");
    previewPlan = null;
    syncHud();
  }

  function startTimeStop() {
    if (mode !== "playing" || timeStopped || replaying) return;
    dash = null;
    timeStopped = true;
    stopWaveRadius = 0;
    stopFade = 0;
    plannedActions = [];
    replayQueue = [];
    replayAction = null;
    replayDone = 0;
    planningState = snapshotPlanningState();
    previewPlan = null;
    showToast("时停 · 战场冻结", "mint");
    syncHud();
  }

  function endTimeStop() {
    if (!timeStopped) return;
    if (attackGesture && mode === "playing") queuePreparedAttack();
    else if (attackGesture) {
      attackGesture = null;
      previewPlan = null;
    }
    timeStopped = false;
    stopWaveRadius = Math.max(width, height) * 1.35;
    if (plannedActions.length > 0) {
      replayQueue = [...plannedActions];
      replayTotal = replayQueue.length;
      replayDone = 0;
      replayAction = null;
      replaying = true;
      planningState = null;
      showToast("时停解除 · 预备动作慢镜回放", "ember");
    } else {
      planningState = null;
      plannedActions = [];
      stopFade = 0.48;
    }
    syncHud();
  }

  function positionAlongPlan(plan, distance) {
    if (plan.segments.length === 0) return { x: plan.startX, y: plan.startY };
    for (const segment of plan.segments) {
      if (distance <= segment.endDistance || segment === plan.segments[plan.segments.length - 1]) {
        const localDistance = Math.max(0, Math.min(segment.length, distance - segment.startDistance));
        const t = segment.length > 0 ? localDistance / segment.length : 1;
        return {
          x: segment.x1 + (segment.x2 - segment.x1) * t,
          y: segment.y1 + (segment.y2 - segment.y1) * t,
        };
      }
    }
    return { x: plan.endX, y: plan.endY };
  }

  function applyReplayEvent(event) {
    const enemy = enemies.find((candidate) => candidate.id === event.enemyId);
    if (!enemy || enemy.dead) return;
    damageEnemy(enemy, event.attackType, { x: event.x, y: event.y }, { x: event.outwardX, y: event.outwardY });
    enemy.x = event.enemyAfterX;
    enemy.y = event.enemyAfterY;
    if (!enemy.dead) {
      enemy.vx = 0;
      enemy.vy = 0;
    }
    enemies = enemies.filter((candidate) => !candidate.dead);
  }

  function updateReplay(dt) {
    if (!replayAction) {
      if (replayQueue.length === 0) {
        replaying = false;
        replayAction = null;
        plannedActions = [];
        planningState = null;
        stopFade = 0.48;
        if (levelKills >= killsToNextLevel) openUpgrade();
        return;
      }
      const plan = replayQueue.shift();
      replayAction = {
        plan,
        elapsed: 0,
        duration: Math.max(0.18, Math.min(0.45, plan.totalDistance / (900 * scale * 2.8) + 0.12)),
        nextEvent: 0,
      };
      player.x = plan.startX;
      player.y = plan.startY;
      player.stamina = Math.max(0, player.stamina - plan.cost);
    }

    const active = replayAction;
    active.elapsed = Math.min(active.duration, active.elapsed + dt);
    const progress = active.duration > 0 ? active.elapsed / active.duration : 1;
    const distance = active.plan.totalDistance * progress;
    while (active.nextEvent < active.plan.events.length && active.plan.events[active.nextEvent].pathDistance <= distance + 0.5) {
      applyReplayEvent(active.plan.events[active.nextEvent]);
      active.nextEvent += 1;
    }
    const point = positionAlongPlan(active.plan, distance);
    player.x = point.x;
    player.y = point.y;

    if (progress >= 1) {
      while (active.nextEvent < active.plan.events.length) {
        applyReplayEvent(active.plan.events[active.nextEvent]);
        active.nextEvent += 1;
      }
      player.x = active.plan.endX;
      player.y = active.plan.endY;
      replayAction = null;
      replayDone += 1;
      plannedActions.shift();
    }
  }

  function syncPredictionHud() {
    if (mode !== "playing") {
      ui.prediction.classList.add("is-hidden");
      return;
    }
    if (attackGesture && previewPlan) {
      const actionName = attackGesture.type === "thrust" ? "追光突刺预演" : "逆鳞冲撞预演";
      ui.predictionTitle.textContent = actionName;
      if (previewPlan.valid) {
        const killsPlanned = previewPlan.events.filter((event) => event.killed).length;
        ui.predictionSummary.textContent = `命中 ${previewPlan.events.length} · 击破 ${killsPlanned} · 体力 ${previewPlan.staminaBefore.toFixed(1)} → ${previewPlan.staminaAfter.toFixed(1)}`;
      } else {
        ui.predictionSummary.textContent = previewPlan.reason;
      }
      ui.predictionHint.textContent = timeStopped ? "松开鼠标加入时停队列" : "松开鼠标执行这次突刺";
      ui.prediction.classList.remove("is-hidden");
      return;
    }
    if (timeStopped) {
      ui.predictionTitle.textContent = plannedActions.length ? `时停预备 · ${plannedActions.length} 招` : "时停中 · 战场冻结";
      if (plannedActions.length && planningState) {
        const hits = plannedActions.reduce((sum, plan) => sum + plan.events.length, 0);
        const defeats = plannedActions.reduce((sum, plan) => sum + plan.events.filter((event) => event.killed).length, 0);
        ui.predictionSummary.textContent = `预计命中 ${hits} · 击破 ${defeats} · 体力 ${planningState.stamina.toFixed(1)}`;
        ui.predictionHint.textContent = "继续按住左/右键编排 · 松开 SHIFT 慢镜回放";
      } else {
        ui.predictionSummary.textContent = "敌人、计时与体力回复均已暂停";
        ui.predictionHint.textContent = "按住左/右键预演，松开加入队列";
      }
      ui.prediction.classList.remove("is-hidden");
      return;
    }
    if (replaying) {
      const displayIndex = Math.min(replayTotal, replayDone + 1);
      ui.predictionTitle.textContent = `慢镜回放 · ${displayIndex} / ${replayTotal}`;
      const current = replayAction && replayAction.plan;
      const remaining = replayQueue.length + (current ? 1 : 0);
      ui.predictionSummary.textContent = current
        ? `正在重现${current.type === "thrust" ? "突刺" : "冲撞"} · 预计命中 ${current.events.length} 次`
        : remaining > 0 ? `正在演绎剩余 ${remaining} 招` : "演绎完成，即将恢复战斗";
      ui.predictionHint.textContent = "时停期间计算的命中、击破与回劲正在重现";
      ui.prediction.classList.remove("is-hidden");
      return;
    }
    ui.prediction.classList.add("is-hidden");
  }

  function updateDash(dt) {
    if (!dash) return;
    let remainingStep = Math.min(dash.distanceLeft, dash.speed * dt);

    if (dash.type !== "charge") {
      const ax = player.x;
      const ay = player.y;
      const bx = ax + dash.dx * remainingStep;
      const by = ay + dash.dy * remainingStep;
      player.x = bx;
      player.y = by;
      dash.distanceLeft -= remainingStep;
      if (remainingStep > 0.01) dash.pathSegments.push({ x1: ax, y1: ay, x2: bx, y2: by });
      damageAlongSegment(ax, ay, bx, by, dash.type, dash.hitIds);
    } else {
      let impactsThisFrame = 0;
      while (remainingStep > 0.01 && impactsThisFrame <= enemies.length) {
        const ax = player.x;
        const ay = player.y;
        const step = Math.min(remainingStep, dash.distanceLeft);
        const bx = ax + dash.dx * step;
        const by = ay + dash.dy * step;
        const contact = firstContact(ax, ay, bx, by, dash.hitIds);

        if (!contact) {
          player.x = bx;
          player.y = by;
          dash.distanceLeft = Math.max(0, dash.distanceLeft - step);
          remainingStep -= step;
          if (step > 0.01) dash.pathSegments.push({ x1: ax, y1: ay, x2: bx, y2: by });
          break;
        }

        const { enemy, point } = contact;
        const travelled = step * point.t;
        player.x = point.x;
        player.y = point.y;
        if (travelled > 0.01) dash.pathSegments.push({ x1: ax, y1: ay, x2: point.x, y2: point.y });
        dash.distanceLeft = Math.max(0, dash.distanceLeft - travelled);
        remainingStep = Math.max(0, remainingStep - travelled);

        const normal = normalize(point.x - enemy.x, point.y - enemy.y, -dash.dx, -dash.dy);
        const outward = { x: -normal.x, y: -normal.y };
        dash.hitIds.add(enemy.id);
        dash.bouncePoints.push({ x: point.x, y: point.y });
        damageEnemy(enemy, "charge", point, outward);
        dash.dx = normal.x;
        dash.dy = normal.y;
        dash.distanceLeft += player.bounceDistance * scale;
        dash.bounced = true;
        dash.bounceCount += 1;
        dash.speed *= 1.04;
        showToast(`台球反冲 · ${dash.bounceCount} 次变向`, "ember");
        impactsThisFrame += 1;
      }
    }

    const margin = 18 * scale;
    player.x = Math.max(margin, Math.min(width - margin, player.x));
    player.y = Math.max(margin, Math.min(height - margin, player.y));
    if (dash && dash.distanceLeft <= 0.5) dash = null;
  }

  function updateEnemies(dt) {
    for (const enemy of enemies) {
      if (enemy.dead) continue;
      enemy.contactCooldown = Math.max(0, enemy.contactCooldown - dt);
      enemy.flash = Math.max(0, enemy.flash - dt);
      enemy.angle += dt * (enemy.type === "runner" ? 2.1 : 0.7);
      const direction = normalize(player.x - enemy.x, player.y - enemy.y);
      enemy.vx += direction.x * enemy.speed * 2.3 * dt;
      enemy.vy += direction.y * enemy.speed * 2.3 * dt;
      const velocity = Math.hypot(enemy.vx, enemy.vy);
      const maxVelocity = enemy.speed * (enemy.type === "runner" ? 1.42 : 1.25);
      if (velocity > maxVelocity) {
        enemy.vx = enemy.vx / velocity * maxVelocity;
        enemy.vy = enemy.vy / velocity * maxVelocity;
      }
      enemy.x += enemy.vx * dt;
      enemy.y += enemy.vy * dt;
      const drag = Math.exp(-2.6 * dt);
      enemy.vx *= drag;
      enemy.vy *= drag;

      const margin = enemy.radius + 3 * scale;
      enemy.x = Math.max(margin, Math.min(width - margin, enemy.x));
      enemy.y = Math.max(margin, Math.min(height - margin, enemy.y));

      const touching = Math.hypot(enemy.x - player.x, enemy.y - player.y) < enemy.radius + 13 * scale;
      if (touching && enemy.contactCooldown <= 0 && player.invulnerable <= 0) {
        player.hp = Math.max(0, player.hp - 1);
        player.invulnerable = 0.82;
        enemy.contactCooldown = 0.95;
        const away = normalize(enemy.x - player.x, enemy.y - player.y);
        enemy.vx += away.x * 230 * scale;
        enemy.vy += away.y * 230 * scale;
        burst(player.x, player.y, "#ee8271", 12, 1.1);
        showToast("生命受损", "damage");
        syncHud();
        if (player.hp <= 0) finishRun(false);
      }
    }
    enemies = enemies.filter((enemy) => !enemy.dead);
  }

  function updateEffects(dt) {
    for (const effect of effects) {
      effect.life -= dt;
      if (effect.type === "spark") {
        effect.x += effect.vx * dt;
        effect.y += effect.vy * dt;
        const drag = Math.exp(-3 * dt);
        effect.vx *= drag;
        effect.vy *= drag;
      } else if (effect.type === "text") {
        effect.y -= 23 * scale * dt;
      }
    }
    effects = effects.filter((effect) => effect.life > 0);
    screenShakeTime = Math.max(0, screenShakeTime - dt);
    if (screenShakeTime <= 0) {
      screenShakeStrength = 0;
      screenShakeDuration = 0;
    }
    toastTimer = Math.max(0, toastTimer - dt);
    if (toastTimer <= 0) ui.toast.classList.remove("visible");
  }

  function update(dt) {
    if (mode !== "playing") {
      if (mode !== "paused") realTime += dt;
      updateEffects(dt);
      return;
    }

    if (timeStopped) {
      stopWaveRadius = Math.min(Math.hypot(width, height) * 1.35, stopWaveRadius + Math.hypot(width, height) * 2.4 * dt);
      syncHud();
      return;
    }

    if (replaying) {
      realTime += dt;
      updateReplay(dt);
      updateEffects(dt);
      syncHud();
      return;
    }

    realTime += dt;
    stopFade = Math.max(0, stopFade - dt);
    const worldDt = dt;
    gameTime += worldDt;
    comboTimer = Math.max(0, comboTimer - worldDt);
    if (comboTimer <= 0) comboCount = 0;
    player.invulnerable = Math.max(0, player.invulnerable - worldDt);
    player.stamina = Math.min(player.maxStamina, player.stamina + player.staminaRegen * worldDt);

    const currentWave = Math.min(6, Math.floor(gameTime / 30) + 1);
    if (currentWave > wave) {
      wave = currentWave;
      showToast(`第 ${wave} 波 · 敌潮增强`, "ember");
    }

    spawnTimer -= worldDt;
    if (spawnTimer <= 0) {
      spawnEnemy();
      spawnTimer += Math.max(0.34, 0.92 - gameTime * 0.0028);
    }

    updateEnemies(worldDt);
    if (mode === "playing") updateDash(worldDt);
    if (mode === "playing" && levelKills >= killsToNextLevel) openUpgrade();
    updateEffects(worldDt);

    if (gameTime >= SURVIVE_SECONDS && mode === "playing") finishRun(true);
    syncHud();
  }

  function openUpgrade() {
    if (mode !== "playing") return;
    mode = "upgrade";
    timeStopped = false;
    attackGesture = null;
    previewPlan = null;
    level += 1;
    levelKills -= killsToNextLevel;
    killsToNextLevel = 7 + level * 4;
    dash = null;
    const shuffled = [...UPGRADE_POOL].sort(() => Math.random() - 0.5).slice(0, 3);
    ui.upgradeChoices.innerHTML = "";
    for (const upgrade of shuffled) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "upgrade-choice";
      button.innerHTML = `<span class="upgrade-icon">${upgrade.icon}</span><strong>${upgrade.title}</strong><small>${upgrade.detail}</small><span class="choose-label">选择强化 →</span>`;
      button.addEventListener("click", () => selectUpgrade(upgrade.id), { once: true });
      ui.upgradeChoices.append(button);
    }
    setOverlay(ui.upgradeOverlay, true);
    syncHud();
  }

  function selectUpgrade(id) {
    switch (id) {
      case "edge":
        player.thrustDamage += 1;
        showToast("刃锋淬火 · 突刺伤害提升", "ember");
        break;
      case "breath":
        player.staminaRegen += 0.22;
        showToast("调息回劲 · 体力回复提升", "mint");
        break;
      case "reserve":
        player.maxStamina = Math.min(7, player.maxStamina + 1);
        player.stamina = Math.min(player.maxStamina, player.stamina + 1);
        showToast("气海扩充 · 体力上限提升", "ember");
        break;
      case "charge":
        player.chargeDamage += 1;
        player.bounceDistance += 32;
        showToast("逆鳞蓄势 · 冲撞更强", "ember");
        break;
      case "heart":
        player.maxHp += 1;
        player.hp = Math.min(player.maxHp, player.hp + 1);
        showToast("余烬护身 · 生命恢复", "mint");
        break;
      default:
        break;
    }
    mode = "playing";
    setOverlay(ui.upgradeOverlay, false);
    syncHud();
  }

  function finishRun(victory) {
    if (mode === "gameover" || mode === "victory") return;
    mode = victory ? "victory" : "gameover";
    timeStopped = false;
    replaying = false;
    replayQueue = [];
    replayAction = null;
    plannedActions = [];
    planningState = null;
    stopFade = 0;
    attackGesture = null;
    previewPlan = null;
    dash = null;
    runEndTime = gameTime;
    ui.endIcon.textContent = victory ? "✦" : "×";
    ui.endEyebrow.textContent = victory ? "守夜完成" : "守夜记录";
    ui.endTitle.textContent = victory ? "中线仍在" : "余烬暂熄";
    ui.endCopy.textContent = victory ? "你守过了最漫长的夜。" : "敌潮越过了中线。下一次，试着让冲撞替你开路。";
    ui.finalTime.textContent = formatTime(runEndTime);
    ui.finalKills.textContent = String(kills);
    setOverlay(ui.endOverlay, true);
    syncHud();
  }

  function drawBackground() {
    const origin = center();
    ctx.fillStyle = "#091018";
    const overscan = 22 * scale;
    ctx.fillRect(-overscan, -overscan, width + overscan * 2, height + overscan * 2);

    const glow = ctx.createRadialGradient(origin.x, origin.y, 0, origin.x, origin.y, Math.max(width, height) * 0.68);
    glow.addColorStop(0, "rgba(54, 65, 59, 0.24)");
    glow.addColorStop(0.35, "rgba(28, 41, 42, 0.13)");
    glow.addColorStop(1, "rgba(5, 9, 14, 0.2)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    const gridStep = Math.max(29, 45 * scale);
    ctx.beginPath();
    for (let x = origin.x % gridStep; x < width; x += gridStep) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = origin.y % gridStep; y < height; y += gridStep) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.strokeStyle = "rgba(144, 165, 158, 0.032)";
    ctx.lineWidth = 1;
    ctx.stroke();

    for (const star of stars) {
      const pulse = 0.45 + (Math.sin(realTime * 0.8 + star.phase) + 1) * 0.17;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = "#bfccc0";
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const radius = Math.min(width, height) * 0.41;
    ctx.strokeStyle = "rgba(189, 159, 118, 0.055)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2 * scale, 12 * scale]);
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawHomeMark() {
    const origin = center();
    const pulse = 1 + Math.sin(realTime * 1.7) * 0.035;
    const r = 34 * scale * pulse;
    ctx.save();
    ctx.strokeStyle = "rgba(234, 167, 104, 0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(165, 189, 173, 0.09)";
    ctx.setLineDash([2 * scale, 7 * scale]);
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, r * 1.55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawEnemies() {
    for (const enemy of enemies) {
      if (enemy.dead) continue;
      const { x, y, radius: r } = enemy;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(enemy.angle);
      ctx.shadowBlur = enemy.flash > 0 ? 20 * scale : 11 * scale;
      ctx.shadowColor = enemy.flash > 0 ? "#fff3d0" : enemy.color;
      ctx.fillStyle = enemy.flash > 0 ? "#fff1d2" : enemy.color;
      ctx.strokeStyle = "rgba(255, 236, 208, 0.44)";
      ctx.lineWidth = 1.1 * scale;
      ctx.beginPath();
      if (enemy.type === "runner") {
        ctx.moveTo(0, -r * 1.18);
        ctx.lineTo(r * 0.75, 0);
        ctx.lineTo(0, r * 1.18);
        ctx.lineTo(-r * 0.75, 0);
      } else if (enemy.type === "brute") {
        for (let i = 0; i < 8; i += 1) {
          const angle = i * Math.PI / 4;
          const rr = i % 2 === 0 ? r * 1.05 : r * 0.82;
          const px = Math.cos(angle) * rr;
          const py = Math.sin(angle) * rr;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
      } else {
        for (let i = 0; i < 7; i += 1) {
          const angle = i * Math.PI * 2 / 7;
          const rr = i % 2 === 0 ? r * 1.06 : r * 0.88;
          const px = Math.cos(angle) * rr;
          const py = Math.sin(angle) * rr;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(15, 18, 22, .86)";
      ctx.beginPath();
      ctx.arc(-r * 0.23, -r * 0.06, Math.max(1.3, r * 0.12), 0, Math.PI * 2);
      ctx.arc(r * 0.23, -r * 0.06, Math.max(1.3, r * 0.12), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (enemy.maxHp > 1) {
        const barWidth = r * 2.2;
        const barY = y - r - 6 * scale;
        ctx.fillStyle = "rgba(0, 0, 0, .48)";
        ctx.fillRect(x - barWidth / 2, barY, barWidth, 2.5 * scale);
        ctx.fillStyle = enemy.color;
        ctx.fillRect(x - barWidth / 2, barY, barWidth * Math.max(0, enemy.hp / enemy.maxHp), 2.5 * scale);
      }
    }
  }

  function drawDashTrail() {
    if (!dash || dash.pathSegments.length === 0) return;
    const color = dash.type === "charge" ? "#f7b46e" : "#92e2ce";
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = (dash.type === "charge" ? 9 : 6) * scale;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowBlur = 14 * scale;
    ctx.shadowColor = color;
    ctx.beginPath();
    ctx.moveTo(dash.pathSegments[0].x1, dash.pathSegments[0].y1);
    for (const segment of dash.pathSegments) ctx.lineTo(segment.x2, segment.y2);
    ctx.stroke();
    ctx.globalAlpha = 0.88;
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.lineTo(player.x - dash.dx * 20 * scale, player.y - dash.dy * 20 * scale);
    ctx.stroke();
    for (const point of dash.bouncePoints) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 5 * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlayer() {
    const r = 13.5 * scale;
    let aim;
    if (replayAction) {
      const distance = replayAction.plan.totalDistance * replayAction.elapsed / replayAction.duration;
      const segment = replayAction.plan.segments.find((item) => distance <= item.endDistance) || replayAction.plan.segments[replayAction.plan.segments.length - 1];
      aim = segment
        ? normalize(segment.x2 - segment.x1, segment.y2 - segment.y1, replayAction.plan.dx, replayAction.plan.dy)
        : normalize(replayAction.plan.dx, replayAction.plan.dy);
    } else {
      aim = dash ? normalize(dash.dx, dash.dy) : normalize(mouse.x - player.x, mouse.y - player.y);
    }
    ctx.save();
    ctx.globalAlpha = player.invulnerable > 0 && Math.floor(realTime * 18) % 2 === 0 ? 0.48 : 1;
    ctx.shadowBlur = 27 * scale;
    ctx.shadowColor = "rgba(241, 165, 91, .5)";
    const aura = ctx.createRadialGradient(player.x, player.y, r * 0.2, player.x, player.y, r * 2.8);
    aura.addColorStop(0, "rgba(235, 160, 93, .24)");
    aura.addColorStop(1, "rgba(235, 160, 93, 0)");
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(player.x, player.y, r * 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.translate(player.x, player.y);
    ctx.rotate(Math.atan2(aim.y, aim.x));
    ctx.fillStyle = "#252c32";
    ctx.strokeStyle = "#e8b982";
    ctx.lineWidth = 1.5 * scale;
    ctx.beginPath();
    ctx.moveTo(-r * 0.74, -r * 0.76);
    ctx.quadraticCurveTo(-r * 1.25, 0, -r * 0.74, r * 0.76);
    ctx.lineTo(r * 0.46, r * 0.52);
    ctx.quadraticCurveTo(r * 0.91, 0, r * 0.46, -r * 0.52);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const body = ctx.createRadialGradient(-r * 0.25, -r * 0.28, 1, 0, 0, r);
    body.addColorStop(0, "#ffe0aa");
    body.addColorStop(0.34, "#e8a45e");
    body.addColorStop(1, "#a95d3c");
    ctx.fillStyle = body;
    ctx.strokeStyle = "rgba(255, 226, 177, .8)";
    ctx.lineWidth = 1.3 * scale;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.76, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 11 * scale;
    ctx.shadowColor = "#fff1c8";
    ctx.fillStyle = "#fff4cf";
    ctx.beginPath();
    ctx.moveTo(r * 0.38, 0);
    ctx.lineTo(r * 0.11, -r * 0.2);
    ctx.lineTo(r * 0.13, r * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

  }

  function drawEffects() {
    for (const effect of effects) {
      const ratio = Math.max(0, effect.life / effect.maxLife);
      ctx.save();
      ctx.globalAlpha = Math.min(1, ratio * 1.4);
      if (effect.type === "death") {
        const progress = 1 - ratio;
        const radius = effect.radius * (0.55 + progress * 2.7);
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = (1.2 + ratio * 3.2) * scale;
        ctx.shadowBlur = 20 * scale * ratio;
        ctx.shadowColor = effect.color;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = "#ffe2aa";
        ctx.lineWidth = 1.5 * scale * ratio;
        ctx.beginPath();
        for (let i = 0; i < 8; i += 1) {
          const angle = i * Math.PI / 4 + progress * 0.2;
          const inner = radius * (0.22 + (i % 2) * 0.05);
          const outer = radius * (0.82 + (i % 3) * 0.08);
          ctx.moveTo(effect.x + Math.cos(angle) * inner, effect.y + Math.sin(angle) * inner);
          ctx.lineTo(effect.x + Math.cos(angle) * outer, effect.y + Math.sin(angle) * outer);
        }
        ctx.stroke();
      } else if (effect.type === "spark") {
        ctx.fillStyle = effect.color;
        ctx.shadowBlur = 8 * scale;
        ctx.shadowColor = effect.color;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, effect.size * ratio, 0, Math.PI * 2);
        ctx.fill();
      } else if (effect.type === "ring") {
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = 1.5 * scale * ratio;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, (1 - ratio) * 25 * scale + 3 * scale, 0, Math.PI * 2);
        ctx.stroke();
      } else if (effect.type === "slash") {
        ctx.translate(effect.x, effect.y);
        ctx.rotate(effect.angle);
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = (3 + ratio * 2) * scale;
        ctx.lineCap = "round";
        ctx.shadowBlur = 11 * scale;
        ctx.shadowColor = effect.color;
        ctx.beginPath();
        ctx.arc(0, 0, (13 + (1 - ratio) * 11) * scale, -0.75, 0.75);
        ctx.stroke();
      } else if (effect.type === "text") {
        ctx.fillStyle = effect.color;
        ctx.font = `700 ${Math.max(10, 12 * scale)}px "Noto Sans SC", sans-serif`;
        ctx.textAlign = "center";
        ctx.shadowBlur = 8;
        ctx.shadowColor = "rgba(0, 0, 0, .8)";
        ctx.fillText(effect.text, effect.x, effect.y);
      }
      ctx.restore();
    }
  }

  function drawPlanPath(plan, visibleDistance = Infinity, color = "#9de9d4", dashed = true, startDistance = 0, alpha = 0.88) {
    if (!plan || plan.segments.length === 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = (plan.type === "charge" ? 4 : 3) * scale;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowBlur = 12 * scale;
    ctx.shadowColor = color;
    if (dashed) ctx.setLineDash([7 * scale, 5 * scale]);
    ctx.beginPath();
    for (const segment of plan.segments) {
      if (segment.endDistance < startDistance) continue;
      if (segment.startDistance > visibleDistance) break;
      const from = Math.max(0, startDistance - segment.startDistance);
      const to = Math.max(0, Math.min(segment.length, visibleDistance - segment.startDistance));
      if (to < from) continue;
      const fromT = segment.length > 0 ? from / segment.length : 1;
      const toT = segment.length > 0 ? to / segment.length : 1;
      const fromX = segment.x1 + (segment.x2 - segment.x1) * fromT;
      const fromY = segment.y1 + (segment.y2 - segment.y1) * fromT;
      const toX = segment.x1 + (segment.x2 - segment.x1) * toT;
      const toY = segment.y1 + (segment.y2 - segment.y1) * toT;
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(toX, toY);
      if (to < segment.length) break;
    }
    ctx.stroke();
    ctx.setLineDash([]);

    if (visibleDistance === Infinity) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = color;
      ctx.fillStyle = "rgba(10, 18, 22, .74)";
      ctx.lineWidth = 1.4 * scale;
      ctx.beginPath();
      ctx.arc(plan.endX, plan.endY, 8 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = `700 ${Math.max(9, 10 * scale)}px "Noto Sans SC", sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("落点", plan.endX, plan.endY - 12 * scale);
      for (const event of plan.events) {
        if (event.pathDistance < startDistance - 0.5) continue;
        ctx.beginPath();
        ctx.arc(event.x, event.y, event.killed ? 8 * scale : 5 * scale, 0, Math.PI * 2);
        ctx.strokeStyle = event.killed ? "#ffd095" : color;
        ctx.lineWidth = event.killed ? 2 * scale : 1.2 * scale;
        ctx.stroke();
        if (event.killed) {
          ctx.fillStyle = "#ffd095";
          ctx.font = `700 ${Math.max(8, 9 * scale)}px "Noto Sans SC", sans-serif`;
          ctx.fillText("击破", event.x, event.y - 10 * scale);
        }
      }
    }
    ctx.restore();
  }

  function drawAttackPreview() {
    for (let index = 0; index < plannedActions.length; index += 1) {
      const plan = plannedActions[index];
      let startDistance = 0;
      let alpha = timeStopped ? 0.66 : 0.42;
      if (replaying && replayAction && plan === replayAction.plan) {
        startDistance = plan.totalDistance * Math.min(1, replayAction.elapsed / replayAction.duration);
        alpha = 0.94;
      } else if (replaying && index === 0) {
        alpha = 0.82;
      }
      const color = plan.type === "thrust" ? "#77d9c3" : "#f0b875";
      drawPlanPath(plan, Infinity, color, true, startDistance, alpha);
    }

    if (attackGesture && previewPlan) {
      const color = previewPlan.valid
        ? (attackGesture.type === "thrust" ? "#9de9d4" : "#ffd095")
        : "#ed8576";
      drawPlanPath(previewPlan, Infinity, color, true);
    }
  }

  function drawSlowField() {
    if (mode !== "playing" || (!timeStopped && !replaying && stopFade <= 0)) return;
    const fullRadius = Math.hypot(width, height) * 1.35;
    const radius = timeStopped ? stopWaveRadius : fullRadius;
    const fadeRatio = timeStopped || replaying ? 1 : Math.max(0, stopFade / 0.48);
    if (radius < 2 || fadeRatio <= 0) return;

    ctx.save();
    ctx.beginPath();
    ctx.arc(player.x, player.y, radius, 0, Math.PI * 2);
    ctx.clip();

    const field = ctx.createRadialGradient(player.x, player.y, 4 * scale, player.x, player.y, Math.max(2, radius));
    field.addColorStop(0, `rgba(128, 128, 128, ${0.16 * fadeRatio})`);
    field.addColorStop(0.66, `rgba(128, 128, 128, ${0.52 * fadeRatio})`);
    field.addColorStop(1, `rgba(128, 128, 128, ${0.63 * fadeRatio})`);
    ctx.globalCompositeOperation = "saturation";
    if (ctx.globalCompositeOperation === "saturation") {
      ctx.fillStyle = field;
    } else {
      const fallback = ctx.createRadialGradient(player.x, player.y, 4 * scale, player.x, player.y, Math.max(2, radius));
      fallback.addColorStop(0, `rgba(133, 157, 151, ${0.08 * fadeRatio})`);
      fallback.addColorStop(1, `rgba(133, 157, 151, ${0.3 * fadeRatio})`);
      ctx.fillStyle = fallback;
    }
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();

    if (timeStopped && stopWaveRadius < fullRadius) {
      ctx.save();
      ctx.strokeStyle = "rgba(145, 230, 211, .74)";
      ctx.lineWidth = 2 * scale;
      ctx.shadowBlur = 18 * scale;
      ctx.shadowColor = "#8be2cb";
      ctx.beginPath();
      ctx.arc(player.x, player.y, stopWaveRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function draw() {
    if (!width || !height) return;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const shakeRatio = screenShakeDuration > 0 ? Math.max(0, Math.min(1, screenShakeTime / screenShakeDuration)) : 0;
    const shakeAmount = screenShakeStrength * scale * shakeRatio * shakeRatio;
    if (shakeAmount > 0.05) {
      ctx.translate(Math.sin(realTime * 83 + 1.7) * shakeAmount, Math.sin(realTime * 97 + 4.2) * shakeAmount * 0.72);
    }
    drawBackground();
    drawHomeMark();
    drawEnemies();
    drawEffects();
    drawSlowField();
    drawDashTrail();
    drawAttackPreview();
    drawPlayer();
  }

  function frame(now) {
    const delta = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    update(delta);
    draw();
    requestAnimationFrame(frame);
  }

  document.querySelector("#startButton").addEventListener("click", () => {
    resetRun();
    lastFrame = performance.now();
  });
  document.querySelector("#resumeButton").addEventListener("click", () => {
    if (mode !== "paused") return;
    mode = "playing";
    setOverlay(ui.pauseOverlay, false);
  });
  document.querySelector("#restartButton").addEventListener("click", () => {
    resetRun();
    lastFrame = performance.now();
  });

  ui.pauseButton.addEventListener("click", () => {
    if (mode === "playing") {
      mode = "paused";
      setOverlay(ui.pauseOverlay, true);
    } else if (mode === "paused") {
      mode = "playing";
      setOverlay(ui.pauseOverlay, false);
    }
    syncHud();
  });

  canvas.addEventListener("pointermove", (event) => {
    const point = getPointerPosition(event);
    mouse.x = point.x;
    mouse.y = point.y;
    if (attackGesture) {
      refreshAttackPreview();
      syncHud();
    }
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.button !== 2) return;
    event.preventDefault();
    const point = getPointerPosition(event);
    mouse.x = point.x;
    mouse.y = point.y;
    if (mode !== "playing" || replaying || dash || attackGesture) return;
    attackGesture = { type: event.button === 0 ? "thrust" : "charge" };
    refreshAttackPreview();
    syncHud();
    if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
  });
  window.addEventListener("pointerup", (event) => {
    if (!attackGesture) return;
    const point = getPointerPosition(event);
    mouse.x = point.x;
    mouse.y = point.y;
    refreshAttackPreview();
    const type = attackGesture.type;
    if (mode !== "playing") {
      attackGesture = null;
      previewPlan = null;
      syncHud();
      return;
    }
    if (timeStopped) {
      queuePreparedAttack();
      return;
    }
    attackGesture = null;
    previewPlan = null;
    beginDash(type);
    syncHud();
  });
  canvas.addEventListener("pointercancel", () => {
    attackGesture = null;
    previewPlan = null;
    syncHud();
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  window.addEventListener("keydown", (event) => {
    if (event.key === "Shift") {
      if (!event.repeat) startTimeStop();
      return;
    }
    if (event.key === "Escape") {
      if (mode === "playing") {
        mode = "paused";
        setOverlay(ui.pauseOverlay, true);
      } else if (mode === "paused") {
        mode = "playing";
        setOverlay(ui.pauseOverlay, false);
      }
      syncHud();
    }
  });
  window.addEventListener("keyup", (event) => {
    if (event.key === "Shift") endTimeStop();
  });
  window.addEventListener("blur", () => {
    attackGesture = null;
    previewPlan = null;
    if (timeStopped) endTimeStop();
  });
  window.addEventListener("resize", resizeCanvas);

  resizeCanvas();
  syncHud();
  requestAnimationFrame(frame);
})();
