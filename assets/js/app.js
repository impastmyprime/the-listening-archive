const SUPABASE_URL = "https://nyktfobukaqunyqxasvt.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_j8rvDBetm5vXbBPaEiDIgg_AgySRdsQ";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);

let songs = [];
let currentPerson = null;
let currentUserName = "";
const ARCHIVE_PEOPLE = {
  owner: "",
  friend: ""
};

function setArchivePeople(people) {
  if (!people || typeof people !== "object") return;

  if (typeof people.owner === "string") {
    ARCHIVE_PEOPLE.owner = people.owner;
  }

  if (typeof people.friend === "string") {
    ARCHIVE_PEOPLE.friend = people.friend;
  }
}

function ownerName() {
  return String(ARCHIVE_PEOPLE.owner || "").toUpperCase();
}

function friendName() {
  return String(ARCHIVE_PEOPLE.friend || "").toUpperCase();
}

function getDisplayNames() {
  if (currentPerson === "friend") {
    return {
      me: friendName(),
      you: ownerName()
    };
  }

  return {
    me: ownerName(),
    you: friendName()
  };
}

function refreshPeopleLabels() {
  const names = getDisplayNames();

  document.querySelectorAll("[data-owner-name]").forEach(el => {
    el.textContent = names.me;
  });

  document.querySelectorAll("[data-friend-name]").forEach(el => {
    el.textContent = names.you;
  });

  document.querySelectorAll(".legend-me").forEach(el => {
    el.textContent = names.me;
  });

  document.querySelectorAll(".legend-you").forEach(el => {
    el.textContent = names.you;
  });

  const monthlyLegendNote = document.querySelector("#monthlyLegendNote");
  if (monthlyLegendNote) {
    const interactionWord = statsUseTapInteraction() ? "TAP" : "HOVER";
    monthlyLegendNote.textContent =
      `${interactionWord} TO INSPECT · FILLED = ${names.me} · OUTLINE = ${names.you}`;
  }
}


let currentUser = null;
let realtimeChannel = null;

let songReadStateReady = false;
let readSongIdsForCurrentPerson = new Set();
const pendingSongReadIds = new Set();
// Keep pending media state outside song objects so realtime row replacements cannot erase it.
const pendingMediaLookupIds = new Set();
const pendingYouTubeLookupIds = new Set();
const pendingSpotifyLookupIds = new Set();

const PIXEL_COLS = 40;
const PIXEL_ROWS = 20;
const PIXEL_CELL_SIZE = 8;
const PIXEL_SYNC_DELAY_MS = 120;
const PIXEL_SYNC_RETRY_MS = 800;
const PIXEL_DEFAULT_COLORS = [
  "#FFD60A",
  "#FF3B30",
  "#0066FF"
];
const PIXEL_RECENT_COLORS_STORAGE_PREFIX = "listening-archive-pixel-recent-colors-v2";
const PIXEL_RECENT_COLORS_LIMIT = 4;
const pixelState = Array.from({ length: PIXEL_COLS * PIXEL_ROWS }, () => ({ filled: false, color: "#FFD60A" }));
const pendingPixelWrites = new Map();

let pixelBoardReady = false;
let pixelFlushTimer = null;
let pixelFlushInFlight = false;
let pixelDrawing = false;
let pixelActiveTool = "brush";
let pixelActiveColor = "#FFD60A";
let pixelLastPaintKey = null;
let pixelLastPaintPoint = null;
let pixelRenderQueued = false;
let pixelTouchDrawingArmed = false;
let pixelTouchArmTimer = null;
let pixelRecentColors = [];

const PIXEL_TOUCH_ARM_TIMEOUT_MS = 7000;

let currentFilter = "all";
let searchTerm = "";
let currentSongId = null;
let currentSource = null;
let backgroundYoutubeFallbackActive = false;

const STARTUP_LOADER_MIN_VISIBLE_MS = 1750;

async function holdStartupLoaderUntilMinimumDuration() {
  if (!document.documentElement.classList.contains("archive-startup-loading")) return;

  const startedAt = Number(window.__archiveStartupLoaderStartedAt);
  if (!Number.isFinite(startedAt)) return;

  const elapsed = performance.now() - startedAt;
  const remaining = Math.max(0, STARTUP_LOADER_MIN_VISIBLE_MS - elapsed);

  if (remaining > 0) {
    await new Promise(resolve => window.setTimeout(resolve, remaining));
  }
}

function finishArchiveStartupLoader() {
  document.documentElement.classList.remove("archive-startup-loading");
}


let autoNextEnabled = true;
let youtubePlayer = null;
let youtubeApiPromise = null;
let youtubeMountToken = 0;
let youtubePlaybackMonitor = null;
let youtubePlaybackWorker = null;
let autoNextTransitionLock = false;
let youtubeAutoQueue = [];
let youtubeNativeQueueActive = false;

let spotifyIframeApiPromise = null;
let spotifyIframeApi = null;
let spotifyController = null;
let spotifyMountToken = 0;
let spotifyHasStarted = false;
let spotifyPlaybackMode = "unknown"; // unknown | full | preview | blocked
let spotifyEndHandled = false;
let spotifyLastPosition = 0;
let spotifyLastDuration = 0;
let spotifyAwaitingSignInRetry = false;
let spotifyAutoplayTimer = null;
let spotifyAutoNextWorker = null;
let spotifyAutoNextMonitor = null;
let spotifyAutoNextDeadlineTimer = null;
let spotifyExpectedEndAt = 0;
let spotifyLastUpdateAt = 0;
let spotifyLastPaused = true;
let spotifyLastBuffering = false;
let spotifyPendingAutoStartSongId = null;
let spotifyPendingAutoStartUri = "";
let spotifyPendingEntityReady = false;
let spotifyPendingLoadRequestedAt = 0;
let spotifyCurrentPlayingUri = "";
let spotifyAutoStartAttempts = 0;
let spotifyInterstitialActive = false;
let spotifySessionHasFullPlayback = false;
let spotifyShortDurationEvidence = 0;
let spotifyShortDurationFirstAt = 0;

const SPOTIFY_HIDDEN_START_READY_MS = 180;
const SPOTIFY_VISIBLE_START_READY_MS = 650;

const songList = document.querySelector("#songList");
const songCount = document.querySelector("#songCount");
const emptyState = document.querySelector("#emptyState");
const searchInput = document.querySelector("#searchInput");
const searchWrap = searchInput ? searchInput.closest(".search-wrap") : null;
const filters = document.querySelector("#filters");
const dialog = document.querySelector("#songDialog");
const form = document.querySelector("#songForm");
const template = document.querySelector("#songRowTemplate");

const customCursorOverlay = document.querySelector("#customCursor");
const customCursorHome = customCursorOverlay
  ? {
      parent: customCursorOverlay.parentNode,
      nextSibling: customCursorOverlay.nextSibling,
    }
  : null;

function mountCustomCursorInSongDialog() {
  if (!customCursorOverlay || !dialog) return;
  if (customCursorOverlay.parentNode !== dialog) {
    dialog.appendChild(customCursorOverlay);
  }
}

function restoreCustomCursorHome() {
  if (!customCursorOverlay || !customCursorHome?.parent) return;
  const { parent, nextSibling } = customCursorHome;
  if (nextSibling && nextSibling.parentNode === parent) {
    parent.insertBefore(customCursorOverlay, nextSibling);
  } else {
    parent.appendChild(customCursorOverlay);
  }
}

const playerBar = document.querySelector("#playerBar");
const playerTitle = document.querySelector("#playerTitle");
const playerArtist = document.querySelector("#playerArtist");
const playerStatus = document.querySelector("#playerStatus");
const sourceTabs = document.querySelector("#sourceTabs");
const mediaEmbed = document.querySelector("#mediaEmbed");
const footerArchiveSummary = document.querySelector("#footerArchiveSummary");
const backToTop = document.querySelector("#backToTop");
const autoNextToggle = document.querySelector("#autoNextToggle");
const addSongNav = document.querySelector("#addSongNav");

const archiveView = document.querySelector("#archiveView");
const statsView = document.querySelector("#statsView");
const wallView = document.querySelector("#wallView");
const coverWall = document.querySelector("#coverWall");
const wallEmpty = document.querySelector("#wallEmpty");
const wallAlbumCount = document.querySelector("#wallAlbumCount");
const archiveTools = document.querySelector("#archiveTools");
const viewButtons = [...document.querySelectorAll(".view-button")];

const statsHeadline = document.querySelector("#statsHeadline");
const statsTotal = document.querySelector("#statsTotal");
const statsRange = document.querySelector("#statsRange");
const statsMeCount = document.querySelector("#statsMeCount");
const statsYouCount = document.querySelector("#statsYouCount");
const balanceTrack = document.querySelector("#balanceTrack");
const statsBalanceCopy = document.querySelector("#statsBalanceCopy");
const statsTopArtist = document.querySelector("#statsTopArtist");
const statsTopArtistCopy = document.querySelector("#statsTopArtistCopy");
const statsLongestGap = document.querySelector("#statsLongestGap");
const statsLongestStreak = document.querySelector("#statsLongestStreak");
const statsStreakCopy = document.querySelector("#statsStreakCopy");
const timelineArt = document.querySelector("#timelineArt");
const timelineStart = document.querySelector("#timelineStart");
const timelineEnd = document.querySelector("#timelineEnd");
const monthlyArt = document.querySelector("#monthlyArt");
const artistRanking = document.querySelector("#artistRanking");
const weirdFacts = document.querySelector("#weirdFacts");
const statsTooltip = document.querySelector("#statsTooltip");

const submitSongButton = form.querySelector('button[type="submit"]');
const youtubeUrlInput = form.querySelector('input[name="youtubeUrl"]');
const youtubeAutoStatus = document.querySelector("#youtubeAutoStatus");
const spotifyUrlInput = form.querySelector('input[name="spotifyUrl"]');
const spotifyAutoStatus = document.querySelector("#spotifyAutoStatus");

const accessGate = document.querySelector("#accessGate");
const appShell = document.querySelector("#appShell");
const accessForm = document.querySelector("#accessForm");
const accessCodeInput = document.querySelector("#accessCode");
const accessCodeToggle = document.querySelector("#accessCodeToggle");
const accessSubmit = document.querySelector("#accessSubmit");
const accessStatus = document.querySelector("#accessStatus");
const currentSenderIdentity = document.querySelector("#currentSenderIdentity");

const pixelBoardStage = document.querySelector("#pixelBoardStage");
const pixelBoard = document.querySelector("#pixelBoard");
const pixelBoardStatus = document.querySelector("#pixelBoardStatus");
const pixelBoardClear = document.querySelector("#pixelBoardClear");
const pixelBrushTool = document.querySelector("#pixelBrushTool");
const pixelFillTool = document.querySelector("#pixelFillTool");
const pixelEraserTool = document.querySelector("#pixelEraserTool");
const pixelSwatches = document.querySelector("#pixelSwatches");
const pixelCustomColor = document.querySelector("#pixelCustomColor");
const pixelToolHint = document.querySelector("#pixelToolHint");
const pixelContext = pixelBoard.getContext("2d", { alpha: false });

youtubeUrlInput.addEventListener("input", () => {
  const hasManualUrl = youtubeUrlInput.value.trim().length > 0;

  setYouTubeAutoStatus(
    hasManualUrl
      ? "MANUAL YOUTUBE LINK · AUTO-FETCH WILL BE SKIPPED"
      : "OPTIONAL",
    hasManualUrl ? "found" : "idle"
  );
});

spotifyUrlInput.addEventListener("input", () => {
  const hasManualUrl = spotifyUrlInput.value.trim().length > 0;

  setSpotifyAutoStatus(
    hasManualUrl
      ? "MANUAL SPOTIFY LINK · AUTO-FETCH WILL BE SKIPPED"
      : "OPTIONAL · AUTO-FETCH",
    hasManualUrl ? "found" : "idle"
  );
});


function pixelIndex(x, y) {
  return y * PIXEL_COLS + x;
}

function setPixelBoardStatus(message, state = "idle") {
  pixelBoardStatus.textContent = message;
  pixelBoardStatus.classList.toggle("is-live", state === "live");
  pixelBoardStatus.classList.toggle("is-error", state === "error");
  pixelBoard.classList.toggle("is-syncing", state === "syncing");
  pixelBoardStage.classList.toggle("is-syncing", state === "syncing");
}

function renderPixelBoard() {
  pixelContext.imageSmoothingEnabled = false;
  pixelContext.globalAlpha = 1;
  pixelContext.fillStyle = "#FFFFFF";
  pixelContext.fillRect(
    0,
    0,
    pixelBoard.width,
    pixelBoard.height
  );

  for (let y = 0; y < PIXEL_ROWS; y += 1) {
    for (let x = 0; x < PIXEL_COLS; x += 1) {
      const pixel = pixelState[pixelIndex(x, y)];

      if (!pixel?.filled) continue;

      pixelContext.fillStyle =
        pixel?.color || "#FFD60A";

      pixelContext.fillRect(
        x * PIXEL_CELL_SIZE,
        y * PIXEL_CELL_SIZE,
        PIXEL_CELL_SIZE,
        PIXEL_CELL_SIZE
      );
    }
  }

  pixelContext.strokeStyle = "#B8B8B8";
  pixelContext.globalAlpha = 0.22;
  pixelContext.lineWidth = 0.5;

  pixelContext.beginPath();

  for (let x = 0; x <= PIXEL_COLS; x += 1) {
    const px = x * PIXEL_CELL_SIZE + 0.5;
    pixelContext.moveTo(px, 0);
    pixelContext.lineTo(px, pixelBoard.height);
  }

  for (let y = 0; y <= PIXEL_ROWS; y += 1) {
    const py = y * PIXEL_CELL_SIZE + 0.5;
    pixelContext.moveTo(0, py);
    pixelContext.lineTo(pixelBoard.width, py);
  }

  pixelContext.stroke();
  pixelContext.globalAlpha = 1;
}

function schedulePixelRender() {
  if (pixelRenderQueued) return;

  pixelRenderQueued = true;

  requestAnimationFrame(() => {
    pixelRenderQueued = false;
    renderPixelBoard();
  });
}

function pixelCoordinatesFromEvent(event) {
  const rect = pixelBoard.getBoundingClientRect();

  const cssX = Math.max(
    0,
    Math.min(rect.width - Number.EPSILON, event.clientX - rect.left)
  );
  const cssY = Math.max(
    0,
    Math.min(rect.height - Number.EPSILON, event.clientY - rect.top)
  );

  const bitmapX = cssX * (pixelBoard.width / rect.width);
  const bitmapY = cssY * (pixelBoard.height / rect.height);

  const x = Math.max(
    0,
    Math.min(
      PIXEL_COLS - 1,
      Math.floor(bitmapX / PIXEL_CELL_SIZE)
    )
  );

  const y = Math.max(
    0,
    Math.min(
      PIXEL_ROWS - 1,
      Math.floor(bitmapY / PIXEL_CELL_SIZE)
    )
  );

  return { x, y };
}

function schedulePixelFlush(delay = PIXEL_SYNC_DELAY_MS) {
  if (pixelFlushTimer) return;

  pixelFlushTimer = window.setTimeout(() => {
    pixelFlushTimer = null;
    flushPixelWrites();
  }, delay);
}

function queuePixelWrite(x, y, filled, color) {
  const key = `${x}:${y}`;

  pendingPixelWrites.set(key, {
    x,
    y,
    filled: Boolean(filled),
    color: color || "#FFD60A"
  });

  setPixelBoardStatus("SYNCING…", "syncing");
  schedulePixelFlush();
}

async function flushPixelWrites() {
  if (
    pixelFlushInFlight ||
    !pendingPixelWrites.size ||
    !currentUser ||
    !pixelBoardReady
  ) {
    return;
  }

  pixelFlushInFlight = true;

  const writes = [...pendingPixelWrites.values()].map(pixel => ({
    x: pixel.x,
    y: pixel.y,
    filled: pixel.filled,
    color: pixel.color || "#FFD60A",
    updated_by: currentUser.id,
    updated_at: new Date().toISOString()
  }));

  pendingPixelWrites.clear();

  let syncFailed = false;

  try {
    const { error } = await supabaseClient
      .from("pixel_board")
      .upsert(writes, { onConflict: "x,y" });

    if (error) throw error;

    if (!pendingPixelWrites.size) {
      setPixelBoardStatus("LIVE · SYNCED", "live");
    }
  } catch (error) {
    syncFailed = true;
    console.error("Pixel board sync failed:", error);

    for (const pixel of writes) {
      const key = `${pixel.x}:${pixel.y}`;
      if (!pendingPixelWrites.has(key)) {
        pendingPixelWrites.set(key, {
          x: pixel.x,
          y: pixel.y,
          filled: pixel.filled,
          color: pixel.color || "#FFD60A"
        });
      }
    }

    setPixelBoardStatus("SYNC ERROR · RETRYING", "error");
  } finally {
    pixelFlushInFlight = false;

    if (pendingPixelWrites.size) {
      schedulePixelFlush(
        syncFailed ? PIXEL_SYNC_RETRY_MS : PIXEL_SYNC_DELAY_MS
      );
    }
  }
}

function pixelUsesScrollSafeTouch() {
  return window.matchMedia(
    "(max-width: 768px), (hover: none), (pointer: coarse)"
  ).matches;
}

function syncPixelToolHint() {
  const touchMode = pixelUsesScrollSafeTouch();

  if (touchMode && !pixelTouchDrawingArmed) {
    pixelToolHint.textContent = "SWIPE TO SCROLL · TAP A TOOL TO DRAW";
    return;
  }

  pixelToolHint.textContent =
    pixelActiveTool === "brush"
      ? "BRUSH · DRAG TO DRAW"
      : pixelActiveTool === "fill"
        ? "FILL · TAP AN AREA"
        : "ERASER · DRAG TO ERASE";
}

function disarmPixelTouchDrawing() {
  pixelTouchDrawingArmed = false;
  clearTimeout(pixelTouchArmTimer);
  pixelTouchArmTimer = null;
  pixelBoardStage.classList.remove("is-touch-draw-armed");
  syncPixelToolButtons();
  syncPixelToolHint();
}

function armPixelTouchDrawing() {
  if (!pixelUsesScrollSafeTouch()) return;

  pixelTouchDrawingArmed = true;
  pixelBoardStage.classList.add("is-touch-draw-armed");
  syncPixelToolButtons();

  clearTimeout(pixelTouchArmTimer);
  pixelTouchArmTimer = setTimeout(() => {
    if (!pixelDrawing) disarmPixelTouchDrawing();
  }, PIXEL_TOUCH_ARM_TIMEOUT_MS);

  syncPixelToolHint();
}

function syncPixelToolButtons() {
  const showActiveState =
    !pixelUsesScrollSafeTouch() || pixelTouchDrawingArmed;

  const brushActive =
    showActiveState && pixelActiveTool === "brush";

  const fillActive =
    showActiveState && pixelActiveTool === "fill";

  const eraserActive =
    showActiveState && pixelActiveTool === "eraser";


  pixelBrushTool.classList.toggle(
    "is-active",
    brushActive
  );

  pixelFillTool.classList.toggle(
    "is-active",
    fillActive
  );

  pixelEraserTool.classList.toggle(
    "is-active",
    eraserActive
  );


  pixelBrushTool.setAttribute(
    "aria-pressed",
    brushActive ? "true" : "false"
  );

  pixelFillTool.setAttribute(
    "aria-pressed",
    fillActive ? "true" : "false"
  );

  pixelEraserTool.setAttribute(
    "aria-pressed",
    eraserActive ? "true" : "false"
  );

}

function setPixelTool(tool) {
  const allowedTools = new Set([
    "brush",
    "fill",
    "eraser"
  ]);

  pixelActiveTool =
    allowedTools.has(tool)
      ? tool
      : "brush";

  syncPixelToolButtons();
  syncPixelToolHint();

  pixelLastPaintKey = null;
  pixelLastPaintPoint = null;
}

function normalizePixelColor(color) {
  const normalized = String(color || "").trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : "#FFD60A";
}

function pixelRecentColorsStorageKey() {
  const person = currentPerson === "owner" || currentPerson === "friend"
    ? currentPerson
    : "device";
  return `${PIXEL_RECENT_COLORS_STORAGE_PREFIX}:${person}`;
}

function loadPixelRecentColors() {
  try {
    const stored = JSON.parse(localStorage.getItem(pixelRecentColorsStorageKey()) || "[]");
    if (!Array.isArray(stored)) return [];

    const unique = [];
    for (const color of stored) {
      const normalized = normalizePixelColor(color);
      if (PIXEL_DEFAULT_COLORS.includes(normalized) || unique.includes(normalized)) continue;
      unique.push(normalized);
      if (unique.length >= PIXEL_RECENT_COLORS_LIMIT) break;
    }
    return unique;
  } catch {
    return [];
  }
}

function savePixelRecentColors() {
  try {
    localStorage.setItem(pixelRecentColorsStorageKey(), JSON.stringify(pixelRecentColors));
  } catch { }
}

function syncPixelSwatchSelection() {
  pixelSwatches
    .querySelectorAll(".pixel-swatch")
    .forEach(button => {
      const active =
        normalizePixelColor(button.dataset.color) ===
        pixelActiveColor;

      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
}

function renderPixelRecentColors() {
  pixelSwatches
    .querySelectorAll(".pixel-swatch-recent")
    .forEach(button => button.remove());

  pixelRecentColors.forEach((color, index) => {
    const button = document.createElement("button");
    button.className = "pixel-swatch pixel-swatch-recent";
    button.type = "button";
    button.dataset.color = color;
    button.setAttribute("aria-label", `Recent color ${index + 1}: ${color}`);
    button.setAttribute("aria-pressed", "false");
    button.style.setProperty("--swatch", color);
    button.disabled = !pixelBoardReady;
    pixelSwatches.append(button);
  });

  syncPixelSwatchSelection();
}

function rememberPixelColorUsage(color) {
  const normalized = normalizePixelColor(color);
  if (PIXEL_DEFAULT_COLORS.includes(normalized)) return;
  if (pixelRecentColors[0] === normalized) return;

  pixelRecentColors = [
    normalized,
    ...pixelRecentColors.filter(existing => existing !== normalized)
  ].slice(0, PIXEL_RECENT_COLORS_LIMIT);

  savePixelRecentColors();
  renderPixelRecentColors();
}

function setPixelColor(color) {
  pixelActiveColor = normalizePixelColor(color);
  syncPixelSwatchSelection();
  pixelCustomColor.value = pixelActiveColor;
  setPixelTool("brush");
}


function pixelsMatchForFill(a, b) {
  const aFilled = Boolean(a?.filled);
  const bFilled = Boolean(b?.filled);

  if (aFilled !== bFilled) {
    return false;
  }

  if (!aFilled) {
    return true;
  }

  return (
    String(a?.color || "#FFD60A").toUpperCase() ===
    String(b?.color || "#FFD60A").toUpperCase()
  );
}

function floodFillPixels(startX, startY) {
  if (!pixelBoardReady) return;

  const startIndex =
    pixelIndex(startX, startY);

  const targetPixel = {
    ...pixelState[startIndex]
  };

  const replacement = {
    filled: true,
    color: pixelActiveColor
  };

  if (
    targetPixel.filled &&
    String(targetPixel.color || "").toUpperCase() ===
    pixelActiveColor
  ) {
    return;
  }

  const stack = [[startX, startY]];
  const visited = new Uint8Array(
    PIXEL_COLS * PIXEL_ROWS
  );

  const changed = [];

  while (stack.length) {
    const [x, y] = stack.pop();

    if (
      x < 0 ||
      x >= PIXEL_COLS ||
      y < 0 ||
      y >= PIXEL_ROWS
    ) {
      continue;
    }

    const index =
      pixelIndex(x, y);

    if (visited[index]) {
      continue;
    }

    visited[index] = 1;

    if (
      !pixelsMatchForFill(
        pixelState[index],
        targetPixel
      )
    ) {
      continue;
    }

    pixelState[index] = {
      ...replacement
    };

    changed.push({ x, y });

    stack.push(
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1]
    );
  }

  if (!changed.length) {
    return;
  }

  rememberPixelColorUsage(pixelActiveColor);
  schedulePixelRender();

  for (const pixel of changed) {
    queuePixelWrite(
      pixel.x,
      pixel.y,
      true,
      pixelActiveColor
    );
  }

  schedulePixelFlush();
}

function paintPixel(x, y) {
  if (!pixelBoardReady) return;

  const key = `${x}:${y}`;

  if (pixelLastPaintKey === key) {
    return;
  }

  pixelLastPaintKey = key;

  const index = pixelIndex(x, y);
  const pixel = pixelState[index];

  const nextFilled = pixelActiveTool === "brush";
  const nextColor = nextFilled
    ? pixelActiveColor
    : (pixel?.color || pixelActiveColor);

  const unchanged =
    Boolean(pixel?.filled) === nextFilled &&
    (!nextFilled || pixel?.color === nextColor);

  if (unchanged) {
    return;
  }

  pixelState[index] = {
    filled: nextFilled,
    color: nextColor
  };

  if (nextFilled) {
    rememberPixelColorUsage(nextColor);
  }

  schedulePixelRender();

  queuePixelWrite(
    x,
    y,
    nextFilled,
    nextColor
  );
}

function paintPixelLine(from, to) {
  if (!from || !to) return;

  let x0 = from.x;
  let y0 = from.y;
  const x1 = to.x;
  const y1 = to.y;

  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;

  while (true) {
    paintPixel(x0, y0);

    if (x0 === x1 && y0 === y1) {
      break;
    }

    const e2 = 2 * error;

    if (e2 >= dy) {
      error += dy;
      x0 += sx;
    }

    if (e2 <= dx) {
      error += dx;
      y0 += sy;
    }
  }
}

function applyPixelRealtime(payload) {
  const row = payload?.new;

  if (
    !row ||
    !Number.isInteger(row.x) ||
    !Number.isInteger(row.y)
  ) {
    return;
  }

  if (
    row.x < 0 ||
    row.x >= PIXEL_COLS ||
    row.y < 0 ||
    row.y >= PIXEL_ROWS
  ) {
    return;
  }

  const index = pixelIndex(row.x, row.y);
  const localPixel = pixelState[index];
  const incomingFilled = Boolean(row.filled);
  const incomingColor = row.color || "#FFD60A";

  if (
    row.updated_by === currentUser?.id &&
    Boolean(localPixel?.filled) === incomingFilled &&
    String(localPixel?.color || "#FFD60A").toUpperCase() ===
      String(incomingColor).toUpperCase()
  ) {
    return;
  }

  pixelState[index] = {
    filled: incomingFilled,
    color: incomingColor
  };

  schedulePixelRender();
}

async function loadPixelBoard() {
  setPixelBoardStatus("LOADING…");
  pixelBoardReady = false;
  pixelBoardClear.disabled = true;
  pixelBrushTool.disabled = true;
  pixelFillTool.disabled = true;
  pixelEraserTool.disabled = true;
  pixelCustomColor.disabled = true;
  pixelSwatches
    .querySelectorAll(".pixel-swatch")
    .forEach(button => {
      button.disabled = true;
    });

  const { data, error } = await supabaseClient
    .from("pixel_board")
    .select("x,y,filled,color");

  if (error) {
    console.error("Pixel board setup/load failed:", error);

    setPixelBoardStatus(
      "SETUP REQUIRED",
      "error"
    );

    renderPixelBoard();
    return false;
  }

  for (let i = 0; i < pixelState.length; i += 1) {
    pixelState[i] = { filled: false, color: "#FFD60A" };
  }

  for (const row of data || []) {
    if (
      Number.isInteger(row.x) &&
      Number.isInteger(row.y) &&
      row.x >= 0 &&
      row.x < PIXEL_COLS &&
      row.y >= 0 &&
      row.y < PIXEL_ROWS
    ) {
      pixelState[pixelIndex(row.x, row.y)] = {
        filled: Boolean(row.filled),
        color: row.color || "#FFD60A"
      };
    }
  }

  pixelBoardReady = true;
  pixelBoardClear.disabled = false;
  pixelBrushTool.disabled = false;
  pixelFillTool.disabled = false;
  pixelEraserTool.disabled = false;
  pixelCustomColor.disabled = false;
  pixelSwatches
    .querySelectorAll(".pixel-swatch")
    .forEach(button => {
      button.disabled = false;
    });

  renderPixelBoard();

  setPixelBoardStatus(
    "LIVE · SYNCED",
    "live"
  );

  return true;
}


pixelBrushTool.addEventListener("click", () => {
  setPixelTool("brush");
  armPixelTouchDrawing();
});

pixelFillTool.addEventListener("click", () => {
  setPixelTool("fill");
  armPixelTouchDrawing();
});

pixelEraserTool.addEventListener("click", () => {
  setPixelTool("eraser");
  armPixelTouchDrawing();
});


pixelSwatches.addEventListener("click", event => {
  const button = event.target.closest(".pixel-swatch");

  if (!button || button.disabled) return;

  setPixelColor(
    button.dataset.color || "#FFD60A"
  );
  armPixelTouchDrawing();
});


pixelCustomColor.addEventListener("input", event => {
  setPixelColor(event.target.value);
  armPixelTouchDrawing();
});

renderPixelRecentColors();
setPixelTool("brush");
setPixelColor("#FFD60A");


pixelBoardStage.addEventListener("pointerdown", event => {
  if (!pixelBoardReady) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;

  if (
    event.pointerType === "touch" &&
    pixelUsesScrollSafeTouch() &&
    !pixelTouchDrawingArmed
  ) {
    return;
  }

  event.preventDefault();

  const point =
    pixelCoordinatesFromEvent(event);


  if (pixelActiveTool === "fill") {
    floodFillPixels(point.x, point.y);

    if (event.pointerType === "touch") {
      clearTimeout(pixelTouchArmTimer);
      pixelTouchArmTimer = setTimeout(
        disarmPixelTouchDrawing,
        PIXEL_TOUCH_ARM_TIMEOUT_MS
      );
    }
    return;
  }

  pixelDrawing = true;
  pixelLastPaintKey = null;
  pixelLastPaintPoint = point;

  try {
    pixelBoardStage.setPointerCapture(
      event.pointerId
    );
  } catch { }

  paintPixel(point.x, point.y);
});

pixelBoardStage.addEventListener("pointermove", event => {
  if (!pixelDrawing || !pixelBoardReady) return;

  event.preventDefault();

  const samples =
    typeof event.getCoalescedEvents === "function"
      ? event.getCoalescedEvents()
      : [];

  const sample = samples.length
    ? samples[samples.length - 1]
    : event;

  const point = pixelCoordinatesFromEvent(sample);

  if (pixelLastPaintPoint) {
    paintPixelLine(pixelLastPaintPoint, point);
  } else {
    paintPixel(point.x, point.y);
  }

  pixelLastPaintPoint = point;
});

function endPixelStroke(event) {
  if (!pixelDrawing) return;

  if (pixelBoardReady && event?.clientX != null && event?.clientY != null) {
    const point = pixelCoordinatesFromEvent(event);

    if (pixelLastPaintPoint) {
      paintPixelLine(pixelLastPaintPoint, point);
    } else {
      paintPixel(point.x, point.y);
    }
  }

  pixelDrawing = false;
  pixelLastPaintKey = null;
  pixelLastPaintPoint = null;

  try {
    pixelBoardStage.releasePointerCapture(
      event.pointerId
    );
  } catch { }

  clearTimeout(pixelFlushTimer);
  pixelFlushTimer = null;
  flushPixelWrites();

  if (event?.pointerType === "touch" && pixelUsesScrollSafeTouch()) {
    clearTimeout(pixelTouchArmTimer);
    pixelTouchArmTimer = setTimeout(
      disarmPixelTouchDrawing,
      PIXEL_TOUCH_ARM_TIMEOUT_MS
    );
  }
}

pixelBoardStage.addEventListener(
  "pointerup",
  endPixelStroke
);

pixelBoardStage.addEventListener(
  "pointercancel",
  endPixelStroke
);

pixelBoardStage.addEventListener(
  "contextmenu",
  event => event.preventDefault()
);

window.addEventListener("scroll", () => {
  if (!pixelDrawing && pixelUsesScrollSafeTouch()) {
    disarmPixelTouchDrawing();
  }
}, { passive: true });

document.addEventListener("pointerdown", event => {
  if (!pixelUsesScrollSafeTouch() || pixelDrawing) return;
  if (event.target.closest(".pixel-board-panel")) return;
  disarmPixelTouchDrawing();
}, { passive: true });

pixelBoardClear.addEventListener(
  "click",
  async () => {
    if (!pixelBoardReady || !currentUser) return;

    if (
      !confirm(
        "Clear the shared pixel board for both of you?"
      )
    ) {
      return;
    }

    pixelBoardClear.disabled = true;

    for (let i = 0; i < pixelState.length; i += 1) {
      pixelState[i] = {
        filled: false,
        color:
          pixelState[i]?.color ||
          "#FFD60A"
      };
    }

    renderPixelBoard();
    setPixelBoardStatus("CLEARING…");

    const { error } =
      await supabaseClient
        .from("pixel_board")
        .update({
          filled: false,
          updated_by: currentUser.id,
          updated_at:
            new Date().toISOString()
        })
        .eq("filled", true);

    pixelBoardClear.disabled = false;

    if (error) {
      console.error(
        "Could not clear pixel board:",
        error
      );

      setPixelBoardStatus(
        "CLEAR FAILED · TEST ON LOCALHOST",
        "error"
      );

      await loadPixelBoard();
      return;
    }

    setPixelBoardStatus(
      "LIVE · SYNCED",
      "live"
    );
  }
);
renderPixelBoard();

function setAccessStatus(message, state = "idle") {
  accessStatus.textContent = message;
  accessStatus.classList.toggle("is-error", state === "error");
  accessStatus.classList.toggle("is-success", state === "success");
}

async function functionErrorMessage(error, fallback) {
  try {
    if (error?.context && typeof error.context.json === "function") {
      const payload = await error.context.json();
      if (payload?.error) return String(payload.error);
      if (payload?.message) return String(payload.message);
    }
  } catch { }

  return String(error?.message || fallback);
}

async function ensureAnonymousSession() {
  const {
    data: { session },
    error: sessionError
  } = await supabaseClient.auth.getSession();

  if (sessionError) throw sessionError;

  if (session?.user) {
    currentUser = session.user;
    return session;
  }

  const { data, error } = await supabaseClient.auth.signInAnonymously();

  if (error) throw error;
  if (!data?.session?.user) throw new Error("Anonymous session was not created.");

  currentUser = data.session.user;
  return data.session;
}

async function restoreCurrentMembership() {
  const { data, error } = await supabaseClient.functions.invoke(
    "claim-access",
    {
      body: { restore: true }
    }
  );

  if (error) {
    const status = error?.context?.status;

    if (status === 404) {
      return null;
    }

    const message = await functionErrorMessage(
      error,
      "MEMBERSHIP COULD NOT BE RESTORED"
    );

    throw new Error(message);
  }

  if (!data?.person || !["owner", "friend"].includes(data.person)) {
    return null;
  }

  return data;
}

async function loadSongReadState({ preserveExisting = false } = {}) {
  if (!preserveExisting) {
    songReadStateReady = false;
    readSongIdsForCurrentPerson = new Set();
    pendingSongReadIds.clear();
  }

  if (!currentPerson) return;

  const { data, error } = await supabaseClient
    .from("member_song_reads")
    .select("song_id")
    .eq("person", currentPerson);

  if (error) {
    console.warn("Per-song NEW state is not available yet:", error);
    return;
  }

  readSongIdsForCurrentPerson = new Set(
    (data || []).map(row => String(row.song_id))
  );
  songReadStateReady = true;
  writeCachedReadState();
}

function isSongNewForCurrentPerson(song) {
  if (!songReadStateReady || !currentPerson || !song) return false;

  if (song.senderPerson === currentPerson) return false;

  return !readSongIdsForCurrentPerson.has(String(song.id));
}

function removeNewMarkerFromSongDom(songId) {
  const id = String(songId);
  document.querySelectorAll(".song-row").forEach(row => {
    if (String(row.dataset.id || "") !== id) return;
    // Preserve the marker slot until the next render to avoid mobile reflow.
    row.classList.add("is-new-read");
    row.querySelectorAll(".latest-song-marker").forEach(marker => {
      marker.classList.add("is-read-placeholder");
      marker.setAttribute("aria-hidden", "true");
    });
  });
}

async function markSongRead(song) {
  if (
    !songReadStateReady ||
    !currentPerson ||
    !song ||
    song.senderPerson === currentPerson
  ) {
    return;
  }

  const songId = String(song.id);
  if (
    readSongIdsForCurrentPerson.has(songId) ||
    pendingSongReadIds.has(songId)
  ) {
    return;
  }

  pendingSongReadIds.add(songId);
  readSongIdsForCurrentPerson.add(songId);
  writeCachedReadState();
  removeNewMarkerFromSongDom(songId);

  const { error } = await supabaseClient
    .from("member_song_reads")
    .insert({
      person: currentPerson,
      song_id: songId
    });

  pendingSongReadIds.delete(songId);

  if (error && error.code !== "23505") {
    console.warn("Could not mark song as opened:", error);
    readSongIdsForCurrentPerson.delete(songId);
    renderSongs();
  }
}

function applySongReadRealtime(payload) {
  if (!songReadStateReady || !currentPerson) return;
  if (payload?.new?.person !== currentPerson) return;

  const songId = String(payload?.new?.song_id || "");
  if (!songId) return;

  pendingSongReadIds.delete(songId);
  readSongIdsForCurrentPerson.add(songId);
  removeNewMarkerFromSongDom(songId);
}

function createNewSongMarker(song) {
  const marker = document.createElement("span");
  marker.className = "latest-song-marker";
  marker.setAttribute(
    "aria-label",
    `New recommendation from ${song.senderPerson === "owner" ? ownerName() : friendName()}. Opens as read when you play this song.`
  );

  const label = document.createElement("span");
  label.className = "latest-song-marker-label";
  label.textContent = "NEW";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 10 10");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("latest-song-marker-icon");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M2 8 8 2M3.25 2H8v4.75");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.35");
  path.setAttribute("stroke-linecap", "square");
  path.setAttribute("stroke-linejoin", "miter");

  svg.appendChild(path);
  marker.append(label, svg);
  return marker;
}

function mapRemoteSong(row) {
  const senderPerson =
    row.sender_person === "friend"
      ? "friend"
      : "owner";

  return {
    id: row.id,
    title: String(row.title || ""),
    artist: String(row.artist || ""),
    youtubeUrl: String(row.youtube_url || ""),
    spotifyUrl: String(row.spotify_url || ""),
    spotifyStatus: String(row.spotify_status || ""),
    spotifyLookupSource: String(row.spotify_lookup_source || ""),
    spotifyLookupAt: row.spotify_lookup_at || null,
    spotifyTitle: String(row.spotify_title || ""),
    spotifyArtist: String(row.spotify_artist || ""),
    spotifyIsrc: String(row.spotify_isrc || ""),
    spotifyMatchConfidence: row.spotify_match_confidence ?? null,
    note: String(row.note || ""),
    senderPerson,
    recommendedBy: senderPerson === currentPerson ? "me" : "friend",
    createdAt: row.created_at || new Date().toISOString(),
    albumName: String(row.album_name || ""),
    albumArtist: String(row.album_artist || ""),
    albumArtworkUrl: String(row.album_artwork_url || ""),
    albumSource: String(row.album_source || ""),
    albumKey: String(row.album_key || ""),
    releaseType: String(row.release_type || "album"),
    spotifyAlbumId: String(row.spotify_album_id || ""),
    bandcampUrl: String(row.bandcamp_url || ""),
    albumExternalUrl: String(row.album_external_url || ""),
    albumMatchConfidence: row.album_match_confidence ?? null,
    albumResolutionStatus: String(row.album_resolution_status || ""),
    albumLocked: Boolean(row.album_locked),
    albumResolvedAt: row.album_resolved_at || null
  };
}

let remoteSongsHaveLoaded = false;

const SONG_SNAPSHOT_CACHE_KEY = "listening-archive-song-snapshot-v1";
const READ_STATE_CACHE_PREFIX = "listening-archive-read-state-v1";

function readCachedSongSnapshot() {
  try {
    const raw = localStorage.getItem(SONG_SNAPSHOT_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(song => song && song.id)
      .map(song => ({
        ...song,
        recommendedBy: song.senderPerson === currentPerson ? "me" : "friend"
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch {
    return [];
  }
}

function writeCachedSongSnapshot(songList) {
  try {
    const privacySafeSnapshot = (songList || []).slice(0, 500).map(song => ({
      ...song,
      note: ""
    }));

    localStorage.setItem(
      SONG_SNAPSHOT_CACHE_KEY,
      JSON.stringify(privacySafeSnapshot)
    );
  } catch { }
}

function readStateCacheKey(person = currentPerson) {
  return `${READ_STATE_CACHE_PREFIX}:${String(person || "unknown")}`;
}

function hydrateCachedReadState() {
  if (!currentPerson) return false;

  try {
    const raw = localStorage.getItem(readStateCacheKey());
    if (!raw) return false;
    const ids = JSON.parse(raw);
    if (!Array.isArray(ids)) return false;
    readSongIdsForCurrentPerson = new Set(ids.map(String));
    songReadStateReady = true;
    return true;
  } catch {
    return false;
  }
}

function writeCachedReadState() {
  if (!currentPerson || !songReadStateReady) return;
  try {
    localStorage.setItem(
      readStateCacheKey(),
      JSON.stringify(Array.from(readSongIdsForCurrentPerson || []).map(String))
    );
  } catch { }
}

function showArchiveLoadingState() {
  songCount.textContent = "SYNCING…";
  emptyState.hidden = true;
  songList.innerHTML = `
    <div class="archive-loading-row" role="status" aria-live="polite">
      SYNCING ARCHIVE…
    </div>`;
}

function hydrateArchiveSnapshot() {
  hydrateCachedReadState();
  const cachedSongs = readCachedSongSnapshot();
  if (!cachedSongs.length) {
    showArchiveLoadingState();
    return false;
  }

  songs = cachedSongs;
  remoteSongsHaveLoaded = true;
  renderSongs();
  return true;
}

function scheduleNonCriticalTask(task, timeout = 1200) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => task(), { timeout });
  } else {
    window.setTimeout(task, 40);
  }
}

function songDatasetSignature(list = songs) {
  return JSON.stringify((list || []).map(song => [
    String(song.id || ""),
    String(song.title || ""),
    String(song.artist || ""),
    String(song.youtubeUrl || ""),
    String(song.spotifyUrl || ""),
    String(song.spotifyStatus || ""),
    String(song.spotifyLookupSource || ""),
    String(song.spotifyLookupAt || ""),
    String(song.spotifyTitle || ""),
    String(song.spotifyArtist || ""),
    String(song.spotifyIsrc || ""),
    String(song.spotifyMatchConfidence ?? ""),
    String(song.note || ""),
    String(song.senderPerson || ""),
    String(song.createdAt || ""),
    String(song.albumName || ""),
    String(song.albumArtist || ""),
    String(song.albumArtworkUrl || ""),
    String(song.albumSource || ""),
    String(song.albumKey || ""),
    String(song.releaseType || ""),
    String(song.spotifyAlbumId || ""),
    String(song.bandcampUrl || ""),
    String(song.albumExternalUrl || ""),
    String(song.albumMatchConfidence ?? ""),
    String(song.albumResolutionStatus || ""),
    String(song.albumLocked || ""),
    String(song.albumResolvedAt || "")
  ]));
}

function songReadStateSignature() {
  return Array.from(readSongIdsForCurrentPerson || [])
    .map(String)
    .sort()
    .join("|");
}

async function loadRemoteSongs({ quiet = false, forceRender = false } = {}) {
  const { data, error } = await supabaseClient
    .from("songs")
    .select(
      "id,title,artist,youtube_url,spotify_url,spotify_status,spotify_lookup_source,spotify_lookup_at,spotify_title,spotify_artist,spotify_isrc,spotify_match_confidence,note,sender_person,created_at,album_name,album_artist,album_artwork_url,album_source,album_key,release_type,spotify_album_id,bandcamp_url,album_external_url,album_match_confidence,album_resolution_status,album_locked,album_resolved_at"
    )
    .order("created_at", { ascending: false });

  if (error) {
    if (!quiet) {
      console.error("Could not load songs:", error);
      alert(`Could not load the shared archive: ${error.message}`);
    }
    throw error;
  }

  const nextSongs = (data || [])
    .map(mapRemoteSong)
    .sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const changed = songDatasetSignature(nextSongs) !== songDatasetSignature(songs);
  songs = nextSongs;
  writeCachedSongSnapshot(nextSongs);

  if (!remoteSongsHaveLoaded || changed || forceRender) {
    remoteSongsHaveLoaded = true;
    renderSongs();
  } else {
    remoteSongsHaveLoaded = true;
  }

  return changed;
}

function stopRealtime() {
  if (!realtimeChannel) return;

  try {
    supabaseClient.removeChannel(realtimeChannel);
  } catch { }

  realtimeChannel = null;
}

function setupRealtime() {
  stopRealtime();

  realtimeChannel = supabaseClient
    .channel("shared-live-archive")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "songs"
      },
      () => {
        loadRemoteSongs({ quiet: true }).catch(console.error);
      }
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "member_song_reads",
        filter: `person=eq.${currentPerson}`
      },
      payload => {
        applySongReadRealtime(payload);
      }
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "pixel_board"
      },
      payload => {
        applyPixelRealtime(payload);
      }
    )
    .subscribe(status => {
      if (status === "SUBSCRIBED" && pixelBoardReady) {
        setPixelBoardStatus(
          "LIVE · SYNCED",
          "live"
        );
      }

      if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT"
      ) {
        setPixelBoardStatus(
          "LIVE CONNECTION LOST",
          "error"
        );
      }
    });
}

async function unlockArchive(person, people) {
  currentPerson = person;
  setArchivePeople(people);
  pixelRecentColors = loadPixelRecentColors();
  renderPixelRecentColors();

  if (!ownerName() || !friendName()) {
    throw new Error("ARCHIVE DISPLAY NAMES ARE MISSING");
  }

  currentUserName =
    person === "owner"
      ? ownerName()
      : friendName();

  currentSenderIdentity.textContent =
    currentUserName;

  finishArchiveStartupLoader();
  document.body.classList.remove("access-checking");
  document.body.classList.add("access-granted");

  accessGate.hidden = true;
  accessGate.setAttribute("aria-hidden", "true");

  appShell.setAttribute("aria-hidden", "false");

  setAccessStatus(
    person === "owner"
      ? `${ownerName()} ACCESS GRANTED`
      : `${friendName()} ACCESS GRANTED`,
    "success"
  );

  refreshPeopleLabels();

  // Paint cached content first, then refresh it from Supabase.
  const hadSnapshot = hydrateArchiveSnapshot();
  const previousReadState = songReadStateSignature();

  const readStatePromise = loadSongReadState({ preserveExisting: hadSnapshot }).catch(error => {
    console.warn("Read-state refresh failed:", error);
  });

  const songsPromise = loadRemoteSongs({ quiet: hadSnapshot }).catch(error => {
    console.error("Archive refresh failed:", error);
    if (!hadSnapshot) {
      songList.innerHTML = `
        <div class="archive-loading-row is-error">
          ARCHIVE COULD NOT SYNC · REFRESH TO RETRY
        </div>`;
    }
  });

  Promise.allSettled([readStatePromise, songsPromise]).then(() => {
    if (songReadStateSignature() !== previousReadState) {
      renderSongs();
    }

    // Defer realtime until the first core refresh is complete.
    setupRealtime();

    // Load non-critical pixel data after the archive is usable.
    scheduleNonCriticalTask(() => {
      loadPixelBoard().catch(error => {
        console.error("Pixel board initialization failed:", error);
        setPixelBoardStatus("SETUP REQUIRED", "error");
      });
    });
  });

  // YouTube is loaded lazily when playback starts.
}

async function bootstrapSupabase() {
  accessGate.hidden = false;
  accessGate.setAttribute("aria-hidden", "false");
  appShell.setAttribute("aria-hidden", "true");

  accessCodeInput.disabled = true;
  accessSubmit.disabled = true;
  setAccessStatus("CONNECTING TO ARCHIVE…");

  try {
    await ensureAnonymousSession();

    const membership = await restoreCurrentMembership();

    if (membership) {
      setAccessStatus("ACCESS RESTORED", "success");
      await holdStartupLoaderUntilMinimumDuration();
      await unlockArchive(membership.person, membership.people);
      return;
    }

    await holdStartupLoaderUntilMinimumDuration();
    finishArchiveStartupLoader();
    document.body.classList.add("access-checking");
    document.body.classList.remove("access-granted");

    accessCodeInput.disabled = false;
    accessSubmit.disabled = false;
    setAccessStatus("ENTER YOUR PRIVATE ACCESS CODE");
    accessCodeInput.focus();
  } catch (error) {
    console.error("Supabase bootstrap failed:", error);
    await holdStartupLoaderUntilMinimumDuration();
    finishArchiveStartupLoader();
    document.body.classList.add("access-checking");
    document.body.classList.remove("access-granted");

    accessCodeInput.disabled = false;
    accessSubmit.disabled = false;
    setAccessStatus(
      `CONNECTION FAILED · ${String(error?.message || "CHECK SUPABASE SETUP")}`,
      "error"
    );
  }
}


document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") {
    if (currentSource === "spotify" && spotifyPlaybackMode === "full" && spotifyHasStarted) {
      // Move an active Spotify session to YouTube immediately when the page is
      // hidden. Waiting until Spotify ends makes the new YouTube autoplay
      // request arrive too late for reliable background playback.
      if (handoffActiveSpotifyToYouTube()) return;

      startSpotifyAutoNextWatchdog();
      syncSpotifyAutoNextDeadline();
    }
    return;
  }

  if (currentSource === "youtube" && youtubePlayer) {
    syncYouTubeQueueSong(youtubePlayer);
  }

  if (currentSource === "spotify") {
    handleSpotifyBackgroundTick();
  }

  if (!currentPerson) return;

  // Re-render only when read state or song data changes.
  const previousReadState = songReadStateSignature();

  loadSongReadState()
    .then(() => {
      const readStateChanged = songReadStateSignature() !== previousReadState;
      return loadRemoteSongs({ quiet: true, forceRender: readStateChanged });
    })
    .catch(console.error);
});


accessCodeToggle?.addEventListener("click", () => {
  const willShow = accessCodeInput.type === "password";
  accessCodeInput.type = willShow ? "text" : "password";
  accessCodeToggle.setAttribute("aria-pressed", String(willShow));
  accessCodeToggle.setAttribute(
    "aria-label",
    willShow ? "Hide access code" : "Show access code"
  );
  accessCodeToggle.closest(".access-code-wrap")?.classList.toggle("is-visible", willShow);
  accessCodeInput.focus({ preventScroll: true });
});

accessForm.addEventListener("submit", async event => {
  event.preventDefault();

  const code = accessCodeInput.value.trim();
  if (!code) return;

  accessSubmit.disabled = true;
  accessCodeInput.disabled = true;
  accessSubmit.textContent = "CHECKING…";
  setAccessStatus("VERIFYING ACCESS CODE…");

  try {
    await ensureAnonymousSession();

    const { data, error } = await supabaseClient.functions.invoke(
      "claim-access",
      {
        body: { code }
      }
    );

    if (error) {
      const message = await functionErrorMessage(
        error,
        "ACCESS CODE COULD NOT BE VERIFIED"
      );
      throw new Error(message);
    }

    if (!data?.person || !["owner", "friend"].includes(data.person)) {
      throw new Error(data?.error || "INVALID ACCESS CODE");
    }

    accessCodeInput.value = "";
    await unlockArchive(data.person, data.people);
  } catch (error) {
    console.error("Access claim failed:", error);
    setAccessStatus(
      String(error?.message || "INVALID ACCESS CODE").toUpperCase(),
      "error"
    );
    accessCodeInput.disabled = false;
    accessSubmit.disabled = false;
    accessSubmit.textContent = "ENTER →";
    accessCodeInput.select();
    accessCodeInput.focus();
  }
});

document.querySelectorAll("#addSongBottom, #addSongNav").forEach(button => {
  button.addEventListener("click", () => {
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    mountCustomCursorInSongDialog();
  });
});

dialog.addEventListener("close", restoreCustomCursorHome);
document.querySelector("#closeDialog").addEventListener("click", () => dialog.close());
document.querySelector("#closePlayer").addEventListener("click", closePlayer);

viewButtons.forEach(button => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

function activePlaybackStatusText() {
  if (backgroundYoutubeFallbackActive && currentSource === "youtube") {
    return "BACKGROUND · YOUTUBE";
  }

  return autoNextEnabled ? "AUTO NEXT ON" : "NOW PLAYING";
}

function syncPlaybackPreferenceUi() {
  autoNextToggle.textContent = autoNextEnabled ? "AUTO NEXT ON" : "AUTO NEXT OFF";
  autoNextToggle.setAttribute("aria-pressed", String(autoNextEnabled));
}

autoNextToggle.addEventListener("click", () => {
  autoNextEnabled = !autoNextEnabled;
  syncPlaybackPreferenceUi();

  if (currentSource === "youtube" && currentSongId && youtubePlayer) {
    const currentSong = songs.find(song => song.id === currentSongId);
    const currentTime = Number(youtubePlayer.getCurrentTime?.() || 0);

    if (currentSong) {
      const videoId = getYouTubeVideoId(currentSong.youtubeUrl);
      if (videoId) {
        destroyYouTubePlayer();
        mountYouTubePlayer(currentSong, videoId, currentTime);
      }
    }
  }

  if (currentSource === "spotify" && currentSongId) {
    const currentSong = songs.find(song => String(song.id) === String(currentSongId));
    if (currentSong) {
      syncSpotifyPlaybackStatus(currentSong);
      syncSpotifyAutoNextDeadline();
    }
  }
});

backToTop.addEventListener("click", () => {
  window.scrollTo({
    top: 0,
    left: 0,
    behavior: "smooth"
  });
});

function destroyYouTubePlayer() {
  youtubeMountToken++;
  youtubeAutoQueue = [];
  youtubeNativeQueueActive = false;

  if (youtubePlayer && typeof youtubePlayer.destroy === "function") {
    try {
      youtubePlayer.destroy();
    } catch { }
  }

  youtubePlayer = null;
}

function ensureYouTubeApi() {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      try {
        if (typeof previousReady === "function") previousReady();
      } catch { }

      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube IFrame API loaded without Player."));
    };

    const existing = document.querySelector('script[data-youtube-iframe-api="true"]');

    if (!existing) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.dataset.youtubeIframeApi = "true";
      script.onerror = () => reject(new Error("Could not load YouTube IFrame API."));
      document.head.appendChild(script);
    }

    setTimeout(() => {
      if (window.YT?.Player) resolve(window.YT);
    }, 6000);
  });

  return youtubeApiPromise;
}

function stopSpotifyAutoNextWatchdog() {
  spotifyExpectedEndAt = 0;
  spotifyLastUpdateAt = 0;
  spotifyLastPaused = true;
  spotifyLastBuffering = false;
  spotifyPendingAutoStartSongId = null;
  spotifyPendingAutoStartUri = "";
  spotifyPendingEntityReady = false;
  spotifyPendingLoadRequestedAt = 0;
  spotifyAutoStartAttempts = 0;

  if (spotifyAutoNextMonitor) {
    clearInterval(spotifyAutoNextMonitor);
    spotifyAutoNextMonitor = null;
  }

  if (spotifyAutoNextDeadlineTimer) {
    clearTimeout(spotifyAutoNextDeadlineTimer);
    spotifyAutoNextDeadlineTimer = null;
  }

  if (spotifyAutoNextWorker) {
    try {
      spotifyAutoNextWorker.terminate();
    } catch { }
    spotifyAutoNextWorker = null;
  }
}

function tryStartPendingSpotifyTrack() {
  if (
    !spotifyPendingAutoStartSongId ||
    !spotifyPendingAutoStartUri ||
    String(currentSongId) !== String(spotifyPendingAutoStartSongId) ||
    currentSource !== "spotify" ||
    spotifyHasStarted ||
    spotifyInterstitialActive ||
    !spotifyController
  ) {
    return;
  }

  // Prefer Spotify's URI confirmation; use a short timeout if state events lag.
  const loadReadyDelay = document.hidden
    ? SPOTIFY_HIDDEN_START_READY_MS
    : SPOTIFY_VISIBLE_START_READY_MS;
  const loadSettledByTime =
    spotifyPendingLoadRequestedAt > 0 &&
    Date.now() - spotifyPendingLoadRequestedAt >= loadReadyDelay;
  if (!spotifyPendingEntityReady && !loadSettledByTime) return;

  spotifyAutoStartAttempts += 1;

  try {
    if (typeof spotifyController.resume === "function") {
      spotifyController.resume();
    } else if (typeof spotifyController.play === "function") {
      spotifyController.play();
    }
  } catch { }
}

function checkSpotifyAutoNextDeadline() {
  if (
    !spotifyExpectedEndAt ||
    Date.now() < spotifyExpectedEndAt ||
    spotifyEndHandled ||
    autoNextTransitionLock ||
    !autoNextEnabled ||
    currentSource !== "spotify" ||
    spotifyPlaybackMode !== "full" ||
    spotifyInterstitialActive ||
    !spotifyHasStarted
  ) {
    return;
  }

  spotifyEndHandled = true;
  spotifyExpectedEndAt = 0;
  if (spotifyAutoNextDeadlineTimer) {
    clearTimeout(spotifyAutoNextDeadlineTimer);
    spotifyAutoNextDeadlineTimer = null;
  }
  playNextSpotifySong();
}

function handleSpotifyBackgroundTick() {
  checkSpotifyAutoNextDeadline();

  if (spotifyPendingAutoStartSongId && !spotifyHasStarted) {
    if (document.hidden && spotifyAutoStartAttempts >= 8) {
      const pendingSong = songs.find(
        item => String(item.id) === String(spotifyPendingAutoStartSongId)
      );

      if (handoffSpotifyBackgroundToYouTube(pendingSong)) return;
    }

    if (spotifyAutoStartAttempts < 24) {
      tryStartPendingSpotifyTrack();
    } else if (playerStatus) {
      playerStatus.textContent = "PRESS PLAY";
    }
  }
}

function startSpotifyAutoNextWatchdog() {
  if (spotifyAutoNextWorker || spotifyAutoNextMonitor) return;

  try {
    const workerUrl = URL.createObjectURL(
      new Blob([`setInterval(() => postMessage("tick"), 180);`], {
        type: "application/javascript"
      })
    );

    spotifyAutoNextWorker = new Worker(workerUrl);
    URL.revokeObjectURL(workerUrl);
    spotifyAutoNextWorker.onmessage = handleSpotifyBackgroundTick;
  } catch {
    spotifyAutoNextMonitor = setInterval(handleSpotifyBackgroundTick, 500);
  }
}

function scheduleSpotifyAutoNextDeadlineTimer() {
  if (spotifyAutoNextDeadlineTimer) {
    clearTimeout(spotifyAutoNextDeadlineTimer);
    spotifyAutoNextDeadlineTimer = null;
  }

  if (!spotifyExpectedEndAt) return;

  const delay = Math.max(50, spotifyExpectedEndAt - Date.now());
  spotifyAutoNextDeadlineTimer = setTimeout(() => {
    spotifyAutoNextDeadlineTimer = null;
    checkSpotifyAutoNextDeadline();
  }, delay);
}

function syncSpotifyAutoNextDeadline(state = null) {
  const now = Date.now();
  const previousDeadline = spotifyExpectedEndAt;

  if (state) {
    const duration = Number(state.duration || spotifyLastDuration || 0);
    const position = Number(state.position || 0);

    spotifyLastUpdateAt = now;
    spotifyLastPaused = state.isPaused === true;
    spotifyLastBuffering = state.isBuffering === true;

    if (duration > 0) spotifyLastDuration = duration;
    if (position >= 0) spotifyLastPosition = Math.max(0, position);
  }

  if (
    !autoNextEnabled ||
    currentSource !== "spotify" ||
    spotifyPlaybackMode !== "full" ||
    spotifyInterstitialActive ||
    !spotifyHasStarted ||
    spotifyLastDuration <= 31000
  ) {
    spotifyExpectedEndAt = 0;
    scheduleSpotifyAutoNextDeadlineTimer();
    return;
  }

  startSpotifyAutoNextWatchdog();

  const elapsedSinceUpdate = spotifyLastUpdateAt
    ? Math.max(0, now - spotifyLastUpdateAt)
    : 0;
  const estimatedPosition = spotifyLastPaused
    ? spotifyLastPosition
    : Math.min(spotifyLastDuration, spotifyLastPosition + elapsedSinceUpdate);
  const remaining = Math.max(0, spotifyLastDuration - estimatedPosition);

  if (spotifyLastBuffering) return;

  if (spotifyLastPaused) {
    // Preserve a near-end deadline when Spotify resets position at natural completion.
    const msUntilPreviousDeadline = previousDeadline
      ? previousDeadline - now
      : Number.POSITIVE_INFINITY;

    if (previousDeadline && msUntilPreviousDeadline <= 4000) {
      spotifyExpectedEndAt = Math.max(previousDeadline, now + 120);
      scheduleSpotifyAutoNextDeadlineTimer();
      return;
    }

    // An early pause is treated as intentional.
    spotifyExpectedEndAt = 0;
    scheduleSpotifyAutoNextDeadlineTimer();
    return;
  }

  // Track end time independently from Spotify's final state event.
  spotifyExpectedEndAt = now + remaining + 250;
  scheduleSpotifyAutoNextDeadlineTimer();
}

function destroySpotifyPlayer({ preserveMode = false } = {}) {
  spotifyMountToken++;
  stopSpotifyAutoNextWatchdog();

  if (spotifyAutoplayTimer) {
    clearTimeout(spotifyAutoplayTimer);
    spotifyAutoplayTimer = null;
  }

  if (spotifyController && typeof spotifyController.destroy === "function") {
    try {
      spotifyController.destroy();
    } catch { }
  }

  spotifyController = null;
  spotifyHasStarted = false;
  spotifyEndHandled = false;
  spotifyLastPosition = 0;
  spotifyLastDuration = 0;
  spotifyCurrentPlayingUri = "";
  spotifyInterstitialActive = false;
  spotifySessionHasFullPlayback = false;
  spotifyShortDurationEvidence = 0;
  spotifyShortDurationFirstAt = 0;
  spotifyAwaitingSignInRetry = false;

  if (!preserveMode) {
    spotifyPlaybackMode = "unknown";
  }
}

function ensureSpotifyIframeApi() {
  if (spotifyIframeApi?.createController) {
    return Promise.resolve(spotifyIframeApi);
  }

  if (spotifyIframeApiPromise) return spotifyIframeApiPromise;

  spotifyIframeApiPromise = new Promise((resolve, reject) => {
    const previousReady = window.onSpotifyIframeApiReady;

    window.onSpotifyIframeApiReady = IFrameAPI => {
      try {
        if (typeof previousReady === "function") previousReady(IFrameAPI);
      } catch { }

      if (IFrameAPI?.createController) {
        spotifyIframeApi = IFrameAPI;
        resolve(IFrameAPI);
      } else {
        reject(new Error("Spotify iFrame API loaded without createController."));
      }
    };

    const existing = document.querySelector('script[data-spotify-iframe-api="true"]');

    if (!existing) {
      const script = document.createElement("script");
      script.src = "https://open.spotify.com/embed/iframe-api/v1";
      script.async = true;
      script.dataset.spotifyIframeApi = "true";
      script.onerror = () => reject(new Error("Could not load Spotify iFrame API."));
      document.head.appendChild(script);
    }

    setTimeout(() => {
      if (spotifyIframeApi?.createController) resolve(spotifyIframeApi);
    }, 7000);
  });

  return spotifyIframeApiPromise;
}

function nextSpotifySong(currentId) {
  const startIndex = songs.findIndex(song => String(song.id) === String(currentId));
  if (startIndex < 0) return null;

  for (let index = startIndex + 1; index < songs.length; index++) {
    const candidate = songs[index];
    if (spotifyTrackUrlOnly(candidate.spotifyUrl)) return candidate;
  }

  return null;
}

function nextYouTubeSong(currentId) {
  const startIndex = songs.findIndex(song => String(song.id) === String(currentId));
  if (startIndex < 0) return null;

  for (let index = startIndex + 1; index < songs.length; index++) {
    const candidate = songs[index];
    if (getYouTubeVideoId(candidate.youtubeUrl)) return candidate;
  }

  return null;
}

function estimatedSpotifyPositionSeconds() {
  let position = Math.max(0, Number(spotifyLastPosition || 0));

  if (!spotifyLastPaused && spotifyLastUpdateAt) {
    position += Math.max(0, Date.now() - spotifyLastUpdateAt);
  }

  if (spotifyLastDuration > 0) {
    position = Math.min(position, spotifyLastDuration);
  }

  return position / 1000;
}

function handoffActiveSpotifyToYouTube() {
  if (
    !document.hidden ||
    !autoNextEnabled ||
    currentSource !== "spotify" ||
    spotifyPlaybackMode !== "full" ||
    !spotifyHasStarted ||
    spotifyInterstitialActive ||
    autoNextTransitionLock
  ) {
    return false;
  }

  const currentSong = songs.find(
    song => String(song.id) === String(currentSongId)
  );
  const videoId = getYouTubeVideoId(currentSong?.youtubeUrl);
  if (!currentSong || !videoId) return false;

  const startSeconds = estimatedSpotifyPositionSeconds();

  autoNextTransitionLock = true;
  playSong(currentSong, "youtube", {
    backgroundFallback: true,
    startSeconds
  });

  window.setTimeout(() => {
    autoNextTransitionLock = false;
  }, 650);

  return true;
}

function handoffSpotifyBackgroundToYouTube(targetSong = null) {
  if (
    !document.hidden ||
    !autoNextEnabled ||
    autoNextTransitionLock
  ) {
    return false;
  }

  const nextSong = targetSong || nextYouTubeSong(currentSongId);
  if (!nextSong || !getYouTubeVideoId(nextSong.youtubeUrl)) return false;

  autoNextTransitionLock = true;
  playSong(nextSong, "youtube", { backgroundFallback: true });

  window.setTimeout(() => {
    autoNextTransitionLock = false;
  }, 650);

  return true;
}

function syncSpotifyPlaybackStatus(song = null) {
  const activeSong = song || songs.find(item => String(item.id) === String(currentSongId));
  if (!activeSong || currentSource !== "spotify") return;

  if (spotifyPlaybackMode === "preview") {
    playerStatus.textContent = "PREVIEW";
  } else if (spotifyPlaybackMode === "full") {
    playerStatus.textContent = activePlaybackStatusText();
  } else if (spotifyPlaybackMode === "blocked") {
    playerStatus.textContent = "PRESS PLAY";
  } else {
    playerStatus.textContent = "LOADING…";
  }

  renderSourceTabs(activeSong, "spotify");
}

function spotifyUsesMobileEmbedUx() {
  return window.matchMedia(
    "(max-width: 768px), (hover: none) and (pointer: coarse)"
  ).matches;
}

function openSpotifyForFullPlayback(song = null) {
  const activeSong = song || songs.find(item => String(item.id) === String(currentSongId));

  // Mobile full playback opens the native Spotify destination.
  if (spotifyUsesMobileEmbedUx()) {
    const target = spotifyTrackUrlOnly(activeSong?.spotifyUrl) || "https://open.spotify.com/";
    window.open(target, "_blank", "noopener,noreferrer");
    spotifyAwaitingSignInRetry = false;
    playerStatus.textContent = "PREVIEW";
    if (activeSong) renderSourceTabs(activeSong, "spotify");
    return;
  }

  window.open("https://accounts.spotify.com/login", "_blank", "noopener,noreferrer");
  spotifyAwaitingSignInRetry = true;
  playerStatus.textContent = "PREVIEW";
  if (activeSong) renderSourceTabs(activeSong, "spotify");
}

function renderMobileSpotifyPreviewHandoff(song) {
  if (!song || !spotifyUsesMobileEmbedUx()) return;

  spotifyPlaybackMode = "preview";
  playerStatus.textContent = "PREVIEW";
  renderSourceTabs(song, "spotify");
}

function mountSpotifyFallbackIframe(song, spotifyEmbedUrl, message = "SPOTIFY · STANDARD PLAYER") {
  spotifyPlaybackMode = "blocked";
  playerStatus.textContent = message;
  mediaEmbed.className = "media-embed spotify-mode";
  mediaEmbed.innerHTML = "";

  const iframe = document.createElement("iframe");
  iframe.title = `Spotify player: ${song.title} — ${song.artist}`;
  iframe.src = spotifyEmbedUrl;
  iframe.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";
  iframe.allowFullscreen = true;
  iframe.loading = "eager";
  mediaEmbed.appendChild(iframe);

  renderSourceTabs(song, "spotify");
}

function playNextSpotifySong() {
  if (
    autoNextTransitionLock ||
    !autoNextEnabled ||
    currentSource !== "spotify" ||
    !currentSongId ||
    spotifyPlaybackMode !== "full"
  ) {
    return;
  }

  // Hidden tabs continue the archive on YouTube because Spotify iframe autoplay is unreliable there.
  if (document.hidden && handoffSpotifyBackgroundToYouTube()) return;

  const nextSong = nextSpotifySong(currentSongId);

  if (!nextSong) {
    playerStatus.textContent = "END OF QUEUE";
    return;
  }

  autoNextTransitionLock = true;
  currentSongId = nextSong.id;
  currentSource = "spotify";
  spotifyHasStarted = false;
  spotifyEndHandled = false;
  spotifyLastPosition = 0;
  spotifyLastDuration = 0;
  spotifyLastUpdateAt = 0;
  spotifyLastPaused = true;
  spotifyLastBuffering = false;
  spotifyExpectedEndAt = 0;
  spotifyInterstitialActive = false;
  spotifyShortDurationEvidence = 0;
  spotifyShortDurationFirstAt = 0;
  spotifyPlaybackMode = spotifySessionHasFullPlayback ? "full" : "unknown";
  spotifyAwaitingSignInRetry = false;
  spotifyPendingAutoStartSongId = nextSong.id;
  spotifyPendingAutoStartUri = spotifyTrackUri(nextSong.spotifyUrl);
  spotifyPendingEntityReady = false;
  spotifyPendingLoadRequestedAt = Date.now();
  spotifyAutoStartAttempts = 0;

  setScriptAwareText(playerTitle, nextSong.title);
  setScriptAwareText(playerArtist, nextSong.artist);
  renderSourceTabs(nextSong, "spotify");
  playerStatus.textContent = "LOADING NEXT…";
  void markSongRead(nextSong);
  syncPlayButtons();
  syncStatsPlayingState();

  const spotifyUrl = spotifyTrackUrlOnly(nextSong.spotifyUrl);

  if (spotifyController && spotifyUrl && typeof spotifyController.loadEntity === "function") {
    try {
      spotifyController.loadEntity(spotifyPendingAutoStartUri || spotifyUrl);
      startSpotifyAutoNextWatchdog();

      // Wait for the requested Spotify entity before starting it.
      setTimeout(tryStartPendingSpotifyTrack, 700);
      setTimeout(tryStartPendingSpotifyTrack, 1500);
    } catch {
      spotifyPendingAutoStartSongId = null;
      spotifyPendingAutoStartUri = "";
      spotifyPendingEntityReady = false;
      spotifyPendingLoadRequestedAt = 0;
      playSong(nextSong, "spotify");
    }
  } else {
    spotifyPendingAutoStartSongId = null;
    spotifyPendingAutoStartUri = "";
    spotifyPendingEntityReady = false;
    spotifyPendingLoadRequestedAt = 0;
    playSong(nextSong, "spotify");
  }

  setTimeout(() => {
    autoNextTransitionLock = false;
  }, 650);
}

async function mountSpotifyPlayer(song) {
  const spotifyUrl = spotifyTrackUrlOnly(song.spotifyUrl);
  const spotifyEmbedUrl = getSpotifyEmbedUrl(song.spotifyUrl);

  if (!spotifyUrl || !spotifyEmbedUrl) {
    mountSpotifyFallbackIframe(song, spotifyEmbedUrl || "", "NO EMBEDDABLE SPOTIFY TRACK");
    return;
  }

  destroySpotifyPlayer();
  const mountToken = ++spotifyMountToken;

  spotifyPlaybackMode = "unknown";
  spotifyAwaitingSignInRetry = false;
  spotifyHasStarted = false;
  spotifyEndHandled = false;
  spotifyLastPosition = 0;
  spotifyLastDuration = 0;
  spotifyCurrentPlayingUri = "";
  spotifyInterstitialActive = false;
  spotifySessionHasFullPlayback = false;
  spotifyShortDurationEvidence = 0;
  spotifyShortDurationFirstAt = 0;
  spotifyPendingAutoStartUri = "";
  spotifyPendingEntityReady = false;
  spotifyPendingLoadRequestedAt = 0;

  playerStatus.textContent = "LOADING…";
  mediaEmbed.className = "media-embed spotify-mode";
  mediaEmbed.innerHTML = '<div class="spotify-player-mount" aria-label="Spotify player"></div>';
  const mount = mediaEmbed.querySelector(".spotify-player-mount");

  try {
    const IFrameAPI = await ensureSpotifyIframeApi();

    if (
      mountToken !== spotifyMountToken ||
      currentSource !== "spotify" ||
      String(currentSongId) !== String(song.id)
    ) {
      return;
    }

    // Mount Spotify at the same mobile height as YouTube to avoid post-mount resizing.
    const spotifyEmbedHeight = window.matchMedia(
      "(max-width: 768px), (hover: none) and (pointer: coarse)"
    ).matches ? 112 : 152;

    IFrameAPI.createController(
      mount,
      {
        width: "100%",
        height: spotifyEmbedHeight,
        url: spotifyUrl
      },
      controller => {
        if (
          mountToken !== spotifyMountToken ||
          currentSource !== "spotify" ||
          String(currentSongId) !== String(song.id)
        ) {
          try {
            controller?.destroy?.();
          } catch { }
          return;
        }

        spotifyController = controller;

        const spotifyFrame = mount.querySelector("iframe");
        if (spotifyFrame) {
          spotifyFrame.setAttribute(
            "allow",
            "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          );
        }

        controller.addListener("ready", () => {
          if (mountToken !== spotifyMountToken || currentSource !== "spotify") return;

          playerStatus.textContent = "STARTING…";

          const readyFrame = mount.querySelector("iframe");
          if (readyFrame) {
            readyFrame.setAttribute(
              "allow",
              "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            );
          }

          try {
            controller.play();
          } catch { }

          if (spotifyAutoplayTimer) clearTimeout(spotifyAutoplayTimer);
          spotifyAutoplayTimer = setTimeout(() => {
            if (
              mountToken === spotifyMountToken &&
              currentSource === "spotify" &&
              !spotifyHasStarted
            ) {
              spotifyPlaybackMode = "blocked";
              syncSpotifyPlaybackStatus(song);
            }
          }, 2800);
        });

        controller.addListener("playback_started", event => {
          if (mountToken !== spotifyMountToken || currentSource !== "spotify") return;

          const startedUri = spotifyPlayingUri(event?.data?.playingURI);
          const expectedUri = spotifyPendingAutoStartUri || spotifyTrackUri(
            songs.find(item => String(item.id) === String(currentSongId))?.spotifyUrl || song.spotifyUrl
          );

          // Foreign URIs are treated as Spotify-controlled interstitial playback.
          if (startedUri && expectedUri && startedUri !== expectedUri) {
            spotifyInterstitialActive = true;
            spotifyExpectedEndAt = 0;
            scheduleSpotifyAutoNextDeadlineTimer();
            return;
          }

          spotifyCurrentPlayingUri = startedUri || expectedUri;
          spotifyInterstitialActive = false;
          spotifyHasStarted = true;
          spotifyEndHandled = false;
          spotifyLastPaused = false;
          spotifyLastBuffering = false;
          spotifyPendingAutoStartSongId = null;
          spotifyPendingAutoStartUri = "";
          spotifyPendingEntityReady = false;
          spotifyPendingLoadRequestedAt = 0;
          spotifyAutoStartAttempts = 0;
          startSpotifyAutoNextWatchdog();
          syncSpotifyAutoNextDeadline();

          if (spotifyAutoplayTimer) {
            clearTimeout(spotifyAutoplayTimer);
            spotifyAutoplayTimer = null;
          }

          if (spotifyPlaybackMode === "unknown" || spotifyPlaybackMode === "blocked") {
            playerStatus.textContent = activePlaybackStatusText();
          }
        });

        controller.addListener("playback_update", event => {
          if (
            mountToken !== spotifyMountToken ||
            currentSource !== "spotify" ||
            !spotifyController
          ) {
            return;
          }

          const state = event?.data || {};
          const duration = Number(state.duration || 0);
          const position = Number(state.position || 0);
          const stateUri = spotifyPlayingUri(state.playingURI);
          const expectedUri = spotifyPendingAutoStartUri || spotifyTrackUri(
            songs.find(item => String(item.id) === String(currentSongId))?.spotifyUrl || song.spotifyUrl
          );

          // Ignore archive automation while Spotify is playing a foreign URI.
          if (stateUri && expectedUri && stateUri !== expectedUri) {
            spotifyInterstitialActive = true;
            spotifyExpectedEndAt = 0;
            scheduleSpotifyAutoNextDeadlineTimer();
            return;
          }

          if (spotifyInterstitialActive && (!stateUri || stateUri === expectedUri)) {
            spotifyInterstitialActive = false;
            spotifyEndHandled = false;
          }

          if (
            spotifyPendingAutoStartSongId &&
            spotifyPendingAutoStartUri &&
            stateUri === spotifyPendingAutoStartUri
          ) {
            spotifyPendingEntityReady = true;
            if (state.isPaused === true) tryStartPendingSpotifyTrack();
          }

          spotifyLastUpdateAt = Date.now();
          spotifyLastPaused = state.isPaused === true;
          spotifyLastBuffering = state.isBuffering === true;
          if (duration > 0) spotifyLastDuration = duration;
          if (position >= 0) spotifyLastPosition = Math.max(0, position);

          if (stateUri && state.isPaused === false) {
            spotifyCurrentPlayingUri = stateUri;
            if (spotifyPendingAutoStartUri === stateUri) {
              spotifyHasStarted = true;
              spotifyPendingAutoStartSongId = null;
              spotifyPendingAutoStartUri = "";
              spotifyPendingEntityReady = false;
              spotifyPendingLoadRequestedAt = 0;
              spotifyAutoStartAttempts = 0;
            }
          }

          if (duration > 0 && duration <= 31000) {
            spotifyExpectedEndAt = 0;
            scheduleSpotifyAutoNextDeadlineTimer();

            // Do not downgrade confirmed full playback because of a later short segment.
            if (spotifySessionHasFullPlayback) {
              spotifyInterstitialActive = true;
              return;
            }

            const now = Date.now();
            if (!spotifyShortDurationFirstAt) spotifyShortDurationFirstAt = now;
            spotifyShortDurationEvidence += 1;

            // Require stable short-duration evidence before declaring preview mode.
            if (
              spotifyShortDurationEvidence >= 3 &&
              now - spotifyShortDurationFirstAt >= 650 &&
              spotifyPlaybackMode !== "preview"
            ) {
              spotifyPlaybackMode = "preview";
              const activeSong =
                songs.find(item => String(item.id) === String(currentSongId)) || song;

              if (spotifyUsesMobileEmbedUx()) {
                renderMobileSpotifyPreviewHandoff(activeSong);
              } else {
                syncSpotifyPlaybackStatus(activeSong);
              }
            }
            return;
          }

          if (duration > 31000) {
            spotifySessionHasFullPlayback = true;
            spotifyInterstitialActive = false;
            spotifyShortDurationEvidence = 0;
            spotifyShortDurationFirstAt = 0;

            if (spotifyPlaybackMode !== "full") {
              spotifyPlaybackMode = "full";
              spotifyAwaitingSignInRetry = false;
              syncSpotifyPlaybackStatus(
                songs.find(item => String(item.id) === String(currentSongId)) || song
              );
            }
          }

          if (duration > 31000) {
            syncSpotifyAutoNextDeadline(state);
          }

          if (
            spotifyPlaybackMode === "full" &&
            spotifyHasStarted &&
            !spotifyInterstitialActive &&
            autoNextEnabled &&
            !spotifyEndHandled &&
            !autoNextTransitionLock &&
            state.isPaused === true &&
            spotifyLastDuration > 31000 &&
            (
              Math.max(position, spotifyLastPosition) >= spotifyLastDuration - 1200 ||
              (spotifyExpectedEndAt && Date.now() >= spotifyExpectedEndAt - 900)
            )
          ) {
            spotifyEndHandled = true;
            spotifyExpectedEndAt = 0;
            if (spotifyAutoNextDeadlineTimer) {
              clearTimeout(spotifyAutoNextDeadlineTimer);
              spotifyAutoNextDeadlineTimer = null;
            }
            playNextSpotifySong();
          }
        });
      }
    );
  } catch (error) {
    console.error("Spotify iFrame API failed:", error);

    if (
      mountToken !== spotifyMountToken ||
      currentSource !== "spotify" ||
      String(currentSongId) !== String(song.id)
    ) {
      return;
    }

    mountSpotifyFallbackIframe(
      song,
      spotifyEmbedUrl,
      "SPOTIFY · STANDARD PLAYER · AUTO NEXT UNAVAILABLE"
    );
  }
}

function nextPlayableSong(currentId) {
  const ordered = [...songs];
  const startIndex = ordered.findIndex(song => song.id === currentId);

  if (startIndex < 0) return null;

  for (let index = startIndex + 1; index < ordered.length; index++) {
    const candidate = ordered[index];

    if (
      getYouTubeVideoId(candidate.youtubeUrl) ||
      getSpotifyEmbedUrl(candidate.spotifyUrl)
    ) {
      return candidate;
    }
  }

  return null;
}

function buildYouTubeAutoQueue(currentSong) {
  const startIndex = songs.findIndex(song => song.id === currentSong.id);
  if (startIndex < 0) return [];

  const queue = [];

  for (let index = startIndex; index < songs.length; index++) {
    const candidate = songs[index];
    const videoId = getYouTubeVideoId(candidate.youtubeUrl);
    const spotifyUrl = getSpotifyEmbedUrl(candidate.spotifyUrl);

    if (videoId) {
      queue.push({ song: candidate, videoId });
      continue;
    }

    if (spotifyUrl) break;
  }

  return queue;
}

function syncYouTubeQueueSong(player = youtubePlayer) {
  if (!player || !youtubeAutoQueue.length) return null;

  const videoId = String(player.getVideoData?.()?.video_id || "");
  if (!videoId) return null;

  const queueItem = youtubeAutoQueue.find(item => item.videoId === videoId);
  if (!queueItem) return null;

  const song = queueItem.song;

  if (currentSongId !== song.id) {
    currentSongId = song.id;
    currentSource = "youtube";
    setScriptAwareText(playerTitle, song.title);
    setScriptAwareText(playerArtist, song.artist);
    playerStatus.textContent = activePlaybackStatusText();
    renderSourceTabs(song, "youtube");
    void markSongRead(song);
    syncPlayButtons();
    syncStatsPlayingState();
  }

  return queueItem;
}

function youtubeNativeQueueHasNext(player = youtubePlayer) {
  if (!youtubeNativeQueueActive || !player) return false;

  try {
    const playlist = player.getPlaylist?.() || [];
    const index = Number(player.getPlaylistIndex?.());
    return playlist.length > 0 && Number.isFinite(index) && index >= 0 && index < playlist.length - 1;
  } catch {
    return false;
  }
}

function playNextSong() {
  if (autoNextTransitionLock || !autoNextEnabled || !currentSongId) return;
  autoNextTransitionLock = true;

  const nextSong = nextPlayableSong(currentSongId);

  if (!nextSong) {
    playerStatus.textContent = "AUTO NEXT · END OF ARCHIVE";
    autoNextTransitionLock = false;
    return;
  }

  const preferredSource =
    getYouTubeVideoId(nextSong.youtubeUrl)
      ? "youtube"
      : getSpotifyEmbedUrl(nextSong.spotifyUrl)
        ? "spotify"
        : null;

  if (preferredSource === "youtube") {
    const nextVideoId = getYouTubeVideoId(nextSong.youtubeUrl);

    // Reuse the active YouTube player to preserve continuous playback.
    if (
      youtubePlayer &&
      nextVideoId &&
      typeof youtubePlayer.loadVideoById === "function"
    ) {
      currentSongId = nextSong.id;
      currentSource = "youtube";
      setScriptAwareText(playerTitle, nextSong.title);
      setScriptAwareText(playerArtist, nextSong.artist);
      renderSourceTabs(nextSong, "youtube");
      playerStatus.textContent = activePlaybackStatusText();
      void markSongRead(nextSong);
      syncPlayButtons();
      syncStatsPlayingState();

      try {
        youtubePlayer.loadVideoById(nextVideoId);
      } catch {
        playSong(nextSong, preferredSource, {
          backgroundFallback: backgroundYoutubeFallbackActive
        });
      } finally {
        setTimeout(() => {
          autoNextTransitionLock = false;
        }, 500);
      }
      return;
    }
  }

  if (preferredSource) {
    // Briefly debounce duplicate ENDED events.
    playSong(nextSong, preferredSource, {
      backgroundFallback:
        backgroundYoutubeFallbackActive && preferredSource === "youtube"
    });
    setTimeout(() => {
      autoNextTransitionLock = false;
    }, 500);
  } else {
    autoNextTransitionLock = false;
  }
}

async function mountYouTubePlayer(song, videoId, startSeconds = 0) {
  const mountToken = ++youtubeMountToken;
  youtubeAutoQueue = autoNextEnabled
    ? buildYouTubeAutoQueue(song)
    : [{ song, videoId }];

  if (!youtubeAutoQueue.length) {
    youtubeAutoQueue = [{ song, videoId }];
  }

  const queuedVideoIds = youtubeAutoQueue
    .slice(1)
    .map(item => item.videoId)
    .filter(Boolean);

  mediaEmbed.innerHTML = '<div class="youtube-player-mount"></div>';
  const mount = mediaEmbed.querySelector(".youtube-player-mount");

  try {
    const YT = await ensureYouTubeApi();

    if (
      mountToken !== youtubeMountToken ||
      currentSongId !== song.id ||
      currentSource !== "youtube"
    ) {
      return;
    }

    const playerVars = {
      autoplay: 0,
      playsinline: 1,
      rel: 0,
      origin: window.location.origin,
      start: Math.max(0, Math.floor(startSeconds))
    };

    youtubePlayer = new YT.Player(mount, {
      width: "100%",
      height: "152",
      videoId,
      host: "https://www.youtube.com",
      playerVars,
      events: {
        onReady: event => {
          const iframe = event.target.getIframe?.();

          if (iframe) {
            iframe.referrerPolicy = "strict-origin-when-cross-origin";
            iframe.allow =
              "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
          }

          try {
            event.target.unMute?.();
            event.target.setVolume?.(100);

            const playlistIds = youtubeAutoQueue
              .map(item => item.videoId)
              .filter(Boolean);

            if (autoNextEnabled && playlistIds.length > 1 && typeof event.target.loadPlaylist === "function") {
              youtubeNativeQueueActive = true;
              event.target.loadPlaylist(playlistIds, 0, Math.max(0, Number(startSeconds || 0)));
            } else {
              youtubeNativeQueueActive = false;
              event.target.loadVideoById?.({
                videoId,
                startSeconds: Math.max(0, Number(startSeconds || 0))
              });
            }
          } catch {
            try {
              event.target.playVideo?.();
            } catch { }
          }

          clearInterval(youtubePlaybackMonitor);
          youtubePlaybackWorker?.terminate?.();

          // Worker ticks keep queue checks responsive in background tabs.
          try {
            youtubePlaybackWorker = new Worker(
              URL.createObjectURL(
                new Blob([
                  `setInterval(() => postMessage("tick"), 1000);`
                ], { type: "application/javascript" })
              )
            );

            youtubePlaybackWorker.onmessage = () => {
              if (!youtubePlayer || currentSource !== "youtube" || !autoNextEnabled) return;

              try {
                const state = youtubePlayer.getPlayerState?.();
                if (state === window.YT.PlayerState.ENDED && !autoNextTransitionLock) {
                  syncYouTubeQueueSong(youtubePlayer);
                  if (!youtubeNativeQueueHasNext(youtubePlayer)) {
                    playNextSong();
                  }
                }
              } catch { }
            };
          } catch {
            youtubePlaybackMonitor = setInterval(() => {
              if (!youtubePlayer || currentSource !== "youtube" || !autoNextEnabled) return;

              try {
                const state = youtubePlayer.getPlayerState?.();
                if (state === window.YT.PlayerState.ENDED && !autoNextTransitionLock) {
                  syncYouTubeQueueSong(youtubePlayer);
                  if (!youtubeNativeQueueHasNext(youtubePlayer)) {
                    playNextSong();
                  }
                }
              } catch { }
            }, 1000);
          }
        },

        onStateChange: event => {
          if (!window.YT || currentSource !== "youtube") return;

          if (event.data === window.YT.PlayerState.PLAYING) {
            syncYouTubeQueueSong(event.target);
            return;
          }

          if (event.data !== window.YT.PlayerState.ENDED) return;

          // Drive queue changes locally so newly added songs remain available.
          const activeItem = syncYouTubeQueueSong(event.target);

          if (youtubeNativeQueueHasNext(event.target)) return;

          if (activeItem || currentSongId === song.id) {
            setTimeout(() => {
              playNextSong();
            }, 250);
          }
        },

        onError: () => {
          playerStatus.textContent = "YOUTUBE · PLAYBACK ERROR";
        }
      }
    });
  } catch (error) {
    console.error(error);

    if (mountToken !== youtubeMountToken) return;

    playerStatus.textContent = "YOUTUBE · API FAILED";
    mediaEmbed.innerHTML = `
  <div class="player-error">
    YouTube's player API could not load. Spotify is still available if this song has a Spotify link.
  </div>`;
  }
}


syncPlaybackPreferenceUi();

const WALL_ARTWORK_STORAGE = "listening-archive-prototype-albums-v5";
let wallArtworkCache = {};
let wallRenderToken = 0;
let wallRenderedSongSignature = "";

try {
  wallArtworkCache = JSON.parse(localStorage.getItem(WALL_ARTWORK_STORAGE) || "{}") || {};
} catch { wallArtworkCache = {}; }


let albumMetadataFunctionUnavailable = false;
let albumMetadataBackfillPromise = null;

function hasStoredAlbumMetadata(song) {
  return Boolean(
    song &&
    String(song.albumName || "").trim() &&
    String(song.albumArtworkUrl || "").trim() &&
    String(song.albumKey || "").trim()
  );
}

function needsKnownAlbumCorrection(song) {
  if (!song) return false;
  const title = normalizeArtworkText(song.title || "");
  const artist = normalizeArtworkText(song.artist || "");
  const album = normalizeArtworkText(song.albumName || "");

  if (artist === "mogwai" && title === "i know you are but what am i") {
    return album !== "happy songs for happy people";
  }

  if (title === "muffled beneath the sound of the ocean") {
    return album !== "death of a rabbit";
  }

  return false;
}

function applyStoredAlbumMetadata(song, metadata) {
  if (!song || !metadata) return song;
  song.albumName = String(metadata.album_name ?? metadata.albumName ?? song.albumName ?? "");
  song.albumArtist = String(metadata.album_artist ?? metadata.albumArtist ?? song.albumArtist ?? "");
  song.albumArtworkUrl = String(metadata.album_artwork_url ?? metadata.albumArtworkUrl ?? song.albumArtworkUrl ?? "");
  song.albumSource = String(metadata.album_source ?? metadata.albumSource ?? song.albumSource ?? "");
  song.albumKey = String(metadata.album_key ?? metadata.albumKey ?? song.albumKey ?? "");
  song.releaseType = String(metadata.release_type ?? metadata.releaseType ?? song.releaseType ?? "album");
  song.spotifyAlbumId = String(metadata.spotify_album_id ?? metadata.spotifyAlbumId ?? song.spotifyAlbumId ?? "");
  song.bandcampUrl = String(metadata.bandcamp_url ?? metadata.bandcampUrl ?? song.bandcampUrl ?? "");
  song.albumExternalUrl = String(metadata.album_external_url ?? metadata.albumExternalUrl ?? song.albumExternalUrl ?? "");
  song.albumMatchConfidence = metadata.album_match_confidence ?? metadata.albumMatchConfidence ?? song.albumMatchConfidence ?? null;
  song.albumResolutionStatus = String(metadata.album_resolution_status ?? metadata.albumResolutionStatus ?? song.albumResolutionStatus ?? "");
  song.albumLocked = Boolean(metadata.album_locked ?? metadata.albumLocked ?? song.albumLocked ?? false);
  song.albumResolvedAt = metadata.album_resolved_at ?? metadata.albumResolvedAt ?? song.albumResolvedAt ?? null;
  return song;
}

function storedAlbumForWall(song) {
  const source = String(song.albumSource || "SUPABASE");
  const storedUrl = String(song.albumArtworkUrl || "");
  return {
    url: source.toLowerCase() === "youtube" ? normalizeYouTubeArtworkUrl(storedUrl) : storedUrl,
    source,
    albumKey: String(song.albumKey || `song:${String(song.id)}`),
    albumName: String(song.albumName || song.title || ""),
    artistName: String(song.albumArtist || song.artist || ""),
    releaseType: String(song.releaseType || "album"),
    spotifyAlbumId: String(song.spotifyAlbumId || ""),
    externalUrl: String(song.albumExternalUrl || "")
  };
}

async function resolveAlbumMetadataViaSupabase(songList, { force = false, limit = 8 } = {}) {
  const candidates = (songList || [])
    .filter(song => song && !song.albumLocked && (force || !hasStoredAlbumMetadata(song) || needsKnownAlbumCorrection(song)))
    .slice(0, Math.max(1, limit));

  if (!candidates.length || albumMetadataFunctionUnavailable) return false;

  let resolvedAny = false;

  // Limit concurrent resolver calls to protect external endpoints.
  const concurrency = 3;
  for (let start = 0; start < candidates.length; start += concurrency) {
    const batch = candidates.slice(start, start + concurrency);
    const results = await Promise.all(batch.map(async song => {
      try {
        const { data, error } = await supabaseClient.functions.invoke(
          "resolve-song-album",
          { body: { song_id: String(song.id) } }
        );

        if (error) {
          if (error?.context?.status === 404) albumMetadataFunctionUnavailable = true;
          throw error;
        }

        const updated = data?.song || null;
        const metadata = updated || data?.metadata || null;
        if (metadata) {
          applyStoredAlbumMetadata(song, metadata);
          resolvedAny = Boolean(data?.resolved ?? true) || resolvedAny;
        }
        return true;
      } catch (error) {
        console.warn(`Album metadata resolve failed for song ${song.id}:`, error);
        return false;
      }
    }));

    if (albumMetadataFunctionUnavailable) break;
    if (results.some(Boolean)) resolvedAny = true;
  }

  return resolvedAny;
}

function pendingAlbumForWall(song) {
  return {
    url: youtubeArtwork(song) || artworkPlaceholder(song),
    source: "PENDING",
    albumKey: `song:${String(song.id)}`,
    albumName: String(song.title || ""),
    artistName: String(song.artist || ""),
    releaseType: "single",
    spotifyAlbumId: "",
    externalUrl: ""
  };
}

function ensureWallAlbumMetadata(songList) {
  const missing = (songList || []).filter(song => !hasStoredAlbumMetadata(song) || needsKnownAlbumCorrection(song));
  if (!missing.length || albumMetadataFunctionUnavailable) return;

  // Backfill album metadata asynchronously without reshuffling the active wall.
  if (!albumMetadataBackfillPromise) {
    albumMetadataBackfillPromise = resolveAlbumMetadataViaSupabase(missing)
      .finally(() => { albumMetadataBackfillPromise = null; });
  }
}

function normalizeArtworkText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function artworkPlaceholder(song) {
  const title = String(song.title || "SONG").trim();
  const artist = String(song.artist || "UNKNOWN").trim();
  const initials = `${title.charAt(0) || "S"}${artist.charAt(0) || "A"}`.toUpperCase();
  const safeTitle = title.replace(/[&<>"']/g, "");
  const safeArtist = artist.replace(/[&<>"']/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="700" viewBox="0 0 700 700"><rect width="700" height="700" fill="#5f7cff"/><rect x="24" y="24" width="652" height="652" fill="none" stroke="#E7FE00" stroke-width="2"/><text x="48" y="116" fill="#E7FE00" font-family="Arial,sans-serif" font-size="22" font-weight="700">THE LISTENING ARCHIVE</text><text x="48" y="378" fill="#E7FE00" font-family="Georgia,serif" font-size="190" font-style="italic">${initials}</text><text x="48" y="566" fill="#E7FE00" font-family="Arial,sans-serif" font-size="28" font-weight="700">${safeTitle.slice(0,32)}</text><text x="48" y="610" fill="#E7FE00" opacity=".78" font-family="Arial,sans-serif" font-size="22">${safeArtist.slice(0,36)}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function youtubeArtwork(song) {
  const id = getYouTubeVideoId(song.youtubeUrl);
  // mqdefault is 16:9 and crops cleanly into square wall cells.
  return id ? `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg` : "";
}

function normalizeYouTubeArtworkUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  return value
    .replace(/\/hqdefault\.jpg(?:\?.*)?$/i, "/mqdefault.jpg")
    .replace(/\/sddefault\.jpg(?:\?.*)?$/i, "/mqdefault.jpg");
}

async function fetchWithPrototypeTimeout(url, options = {}, timeoutMs = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function spotifyArtwork(song) {
  if (!song.spotifyUrl) return "";
  try {
    const response = await fetchWithPrototypeTimeout(`https://open.spotify.com/oembed?url=${encodeURIComponent(song.spotifyUrl)}`);
    if (!response.ok) return "";
    const data = await response.json();
    return String(data?.thumbnail_url || "");
  } catch { return ""; }
}

const MOGWAI_HAPPY_SONGS_BANDCAMP_URL = "https://mogwai.bandcamp.com/album/happy-songs-for-happy-people";
const MOGWAI_HAPPY_SONGS_SPOTIFY_URL = "https://open.spotify.com/album/1k2uLH7mwB72zbepvM8rR4";

async function bandcampArtworkFromPage(pageUrl) {
  if (!pageUrl) return "";
  const encoded = encodeURIComponent(pageUrl);
  const endpoints = [
    `https://bandcamp.com/api/oembed?url=${encoded}&format=json`,
    `https://bandcamp.com/oembed?format=json&url=${encoded}`
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetchWithPrototypeTimeout(endpoint, {}, 5000);
      if (!response.ok) continue;
      const data = await response.json();
      const artwork = String(
        data?.thumbnail_url ||
        data?.thumbnailUrl ||
        data?.image?.url ||
        data?.image ||
        ""
      ).trim();
      if (artwork) return artwork;
    } catch { }
  }

  // Stable fallback when Bandcamp oEmbed is blocked by CORS.
  try {
    const response = await fetchWithPrototypeTimeout(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(MOGWAI_HAPPY_SONGS_SPOTIFY_URL)}`,
      {},
      4500
    );
    if (response.ok) {
      const data = await response.json();
      return String(data?.thumbnail_url || "").trim();
    }
  } catch { }

  return "";
}

async function appleAlbumMatch(song) {
  const term = `${song.title || ""} ${song.artist || ""}`.trim();
  if (!term) return null;
  try {
    const url = `https://itunes.apple.com/search?media=music&entity=song&limit=10&term=${encodeURIComponent(term)}`;
    const response = await fetchWithPrototypeTimeout(url);
    if (!response.ok) return null;
    const data = await response.json();
    const targetTitle = normalizeArtworkText(song.title);
    const targetArtist = normalizeArtworkText(song.artist);
    const results = Array.isArray(data?.results) ? data.results : [];
    let best = null;
    let bestScore = -1;

    for (const result of results) {
      const resultTitle = normalizeArtworkText(result.trackName);
      const resultArtist = normalizeArtworkText(result.artistName);
      let score = 0;
      if (resultTitle === targetTitle) score += 6;
      else if (resultTitle.includes(targetTitle) || targetTitle.includes(resultTitle)) score += 3;
      if (resultArtist === targetArtist) score += 5;
      else if (resultArtist.includes(targetArtist) || targetArtist.includes(resultArtist)) score += 2;
      if (score > bestScore && result.artworkUrl100) {
        best = result;
        bestScore = score;
      }
    }

    if (!best || bestScore < 4) return null;
    const rawAlbumName = String(best.collectionName || "").trim();
    const isSingle = /(?:\s[-–—]\s|\s)single$/i.test(rawAlbumName);
    const cleanAlbumName = rawAlbumName
      .replace(/\s+(?:[-–—]\s*)?EP$/i, "")
      .replace(/\s+(?:[-–—]\s*)?Single$/i, "")
      .trim();

    return {
      artworkUrl: String(best.artworkUrl100 || "").replace(/100x100bb(?:-\d+)?\./, "700x700bb."),
      albumName: isSingle ? String(song.title || cleanAlbumName || rawAlbumName).trim() : cleanAlbumName,
      albumId: best.collectionId ? String(best.collectionId) : "",
      artistName: String(best.artistName || song.artist || "").trim(),
      releaseType: isSingle ? "single" : "album"
    };
  } catch { return null; }
}

function stableArtworkIdentity(url) {
  return String(url || "")
    .replace(/\?.*$/, "")
    .replace(/\/\d+x\d+[^/]*\.(jpg|jpeg|png|webp)$/i, "/ART.$1")
    .toLowerCase();
}

function getPrototypeAlbumOverride(song) {
  const title = normalizeArtworkText(song?.title || "");
  const artist = normalizeArtworkText(song?.artist || "");
  const suppliedAlbumName = normalizeArtworkText(String(song?.albumName || ""));

  // Wall-art overrides for known metadata mismatches.
  if (title === normalizeArtworkText("Muffled Beneath the Sound of the Ocean")) {
    return {
      url: "https://f4.bcbits.com/img/a3889476287_16.jpg",
      source: "OVERRIDE",
      albumKey: "override:death-of-a-rabbit",
      albumName: "Death of a Rabbit",
      artistName: String(song?.artist || artist || "").trim(),
      releaseType: "album"
    };
  }

  // Resolve known Mogwai metadata from its canonical source.
  if (suppliedAlbumName === normalizeArtworkText("Mogwai") ||
      suppliedAlbumName === normalizeArtworkText("Happy Songs for Happy People") ||
      title === normalizeArtworkText("Mogwai")) {
    return {
      url: "",
      bandcampPageUrl: MOGWAI_HAPPY_SONGS_BANDCAMP_URL,
      source: "BANDCAMP",
      albumKey: "override:mogwai-happy-songs-for-happy-people",
      albumName: "Happy Songs for Happy People",
      artistName: String(song?.artist || artist || "Mogwai").trim(),
      releaseType: "album"
    };
  }

  return null;
}

async function resolvePrototypeAlbum(song) {
  const cacheKey = String(song.id);
  const override = getPrototypeAlbumOverride(song);
  if (override) {
    if (override.bandcampPageUrl) {
      override.url = await bandcampArtworkFromPage(override.bandcampPageUrl) || override.url;
    }
    if (!override.url) {
      override.url = youtubeArtwork(song) || artworkPlaceholder(song);
    }
    wallArtworkCache[cacheKey] = override;
    try { localStorage.setItem(WALL_ARTWORK_STORAGE, JSON.stringify(wallArtworkCache)); } catch { }
    return override;
  }
  const cached = wallArtworkCache[cacheKey];
  if (cached?.url && cached?.albumKey && String(cached?.albumName || "").trim()) return cached;

  const [spotifyUrl, apple] = await Promise.all([
    spotifyArtwork(song),
    appleAlbumMatch(song)
  ]);

  let url = spotifyUrl || apple?.artworkUrl || youtubeArtwork(song) || artworkPlaceholder(song);
  let source = spotifyUrl ? "SPOTIFY" : apple?.artworkUrl ? "APPLE MUSIC" : youtubeArtwork(song) ? "YOUTUBE" : "ARCHIVE";

  let albumKey = "";
  if (apple?.releaseType === "single") {
    // Keep singles grouped by song rather than release metadata.
    albumKey = `single:${String(song.id)}`;
  } else if (apple?.albumId) {
    albumKey = `apple:${apple.albumId}`;
  } else if (spotifyUrl) {
    albumKey = `art:${stableArtworkIdentity(spotifyUrl)}`;
  } else {
    // Keep unresolved releases separate to avoid false album grouping.
    albumKey = `song:${String(song.id)}`;
  }

  let result = {
    url,
    source,
    albumKey,
    albumName: apple?.albumName || "",
    artistName: apple?.artistName || String(song.artist || ""),
    releaseType: apple?.releaseType || "album"
  };

  // Apply album-level overrides after external metadata resolution.
  const normalizedAlbumName = normalizeArtworkText(result?.albumName || "");
  if (normalizedAlbumName === normalizeArtworkText("Mogwai") ||
      normalizedAlbumName === normalizeArtworkText("Happy Songs for Happy People")) {
    const bandcampArtwork = await bandcampArtworkFromPage(MOGWAI_HAPPY_SONGS_BANDCAMP_URL);
    result = {
      ...result,
      url: bandcampArtwork || result.url,
      source: bandcampArtwork ? "BANDCAMP" : result.source,
      albumKey: "override:mogwai-happy-songs-for-happy-people",
      albumName: "Happy Songs for Happy People",
      artistName: "Mogwai"
    };
  } else if (normalizedAlbumName === normalizeArtworkText("Death of a Rabbit")) {
    result = {
      ...result,
      url: "https://f4.bcbits.com/img/a3889476287_16.jpg",
      source: "OVERRIDE",
      albumKey: "override:death-of-a-rabbit",
      albumName: "Death of a Rabbit"
    };
  }

  wallArtworkCache[cacheKey] = result;
  try { localStorage.setItem(WALL_ARTWORK_STORAGE, JSON.stringify(wallArtworkCache)); } catch { }
  return result;
}

function senderDisplayName(song) {
  return song.senderPerson === "owner" ? ownerName() : friendName();
}

function makeAlbumGroups(resolvedSongs) {
  const groups = new Map();

  resolvedSongs.forEach(({ song, album }) => {
    const key = album.albumKey || `song:${String(song.id)}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        albumName: album.albumName,
        artistName: album.artistName || song.artist,
        artwork: album.url,
        source: album.source,
        releaseType: album.releaseType || "album",
        songs: []
      });
    }
    const group = groups.get(key);
    group.songs.push(song);
    if (!group.albumName && album.albumName) group.albumName = album.albumName;
  });

  // Preserve newest-first album order.
  return Array.from(groups.values());
}


const WALL_HALFTONE_PURPLE = "#5168E0";
const WALL_HALFTONE_YELLOW = "#FFFF2E";
const wallHalftonePromiseCache = new Map();

function wallHalftoneProxyUrl(src) {
  const raw = String(src || "").trim();
  if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) return raw;
  try {
    const parsed = new URL(raw, window.location.href);
    if (parsed.origin === window.location.origin) return parsed.href;
    return `https://images.weserv.nl/?url=${encodeURIComponent(parsed.href)}&w=420&h=420&fit=cover&output=jpg&q=92`;
  } catch {
    return raw;
  }
}

function loadHalftoneSource(src, useProxy = false) {
  return new Promise((resolve, reject) => {
    const source = new Image();
    source.decoding = "async";
    source.crossOrigin = "anonymous";
    source.onload = () => resolve(source);
    source.onerror = () => reject(new Error("halftone source failed"));
    source.src = useProxy ? wallHalftoneProxyUrl(src) : src;
  });
}

async function getHalftoneSource(src) {
  try {
    return await loadHalftoneSource(src, false);
  } catch {
    return loadHalftoneSource(src, true);
  }
}

function renderTrueWallHalftone(source, canvas) {
  const outputSize = 420;
  const step = 5;
  const cols = Math.ceil(outputSize / step);
  const rows = Math.ceil(outputSize / step);

  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return false;

  // Downsample to one luminance sample per halftone cell.
  const sample = document.createElement("canvas");
  sample.width = cols;
  sample.height = rows;
  const sctx = sample.getContext("2d", { willReadFrequently: true });
  if (!sctx) return false;

  sctx.fillStyle = "#fff";
  sctx.fillRect(0, 0, cols, rows);
  sctx.drawImage(source, 0, 0, cols, rows);

  let pixels;
  try {
    pixels = sctx.getImageData(0, 0, cols, rows).data;
  } catch {
    return false;
  }

  ctx.fillStyle = WALL_HALFTONE_PURPLE;
  ctx.fillRect(0, 0, outputSize, outputSize);
  ctx.fillStyle = WALL_HALFTONE_YELLOW;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const i = (row * cols + col) * 4;
      const alpha = pixels[i + 3] / 255;
      const luminance = ((pixels[i] * 0.2126) + (pixels[i + 1] * 0.7152) + (pixels[i + 2] * 0.0722)) / 255;

      // Preserve midtones while slightly deepening shadows and highlights.
      let tone = Math.max(0, Math.min(1, luminance * alpha));
      tone = Math.max(0, Math.min(1, (tone - 0.045) / 0.91));
      tone = Math.pow(tone, 0.95);

      // Keep dots small enough to preserve image detail.
      const radius = 0.12 + tone * 2.02;
      if (radius <= 0.16) continue;

      const x = col * step + step * 0.5;
      const y = row * step + step * 0.5;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return true;
}

function ensureTrueWallHalftone(img, canvas) {
  if (canvas.dataset.ready === "true") return Promise.resolve(true);
  const src = String(img.currentSrc || img.src || "");
  if (!src) return Promise.resolve(false);

  const existing = wallHalftonePromiseCache.get(src);
  if (existing) {
    return existing.then(result => {
      if (result && result.source && renderTrueWallHalftone(result.source, canvas)) {
        canvas.dataset.ready = "true";
        return true;
      }
      return false;
    });
  }

  const promise = getHalftoneSource(src)
    .then(source => ({ source }))
    .catch(() => null);
  wallHalftonePromiseCache.set(src, promise);

  return promise.then(result => {
    if (!result?.source) return false;
    const rendered = renderTrueWallHalftone(result.source, canvas);
    if (rendered) canvas.dataset.ready = "true";
    return rendered;
  });
}

function makeAlbumArtCell(group) {
  const fallbackSong = group.songs[0];
  const art = document.createElement("button");
  art.type = "button";
  art.className = "album-editorial-cell album-editorial-art";
  art.setAttribute("aria-label", `Play ${fallbackSong.title} from ${group.albumName || "this album"}`);

  const img = document.createElement("img");
  img.alt = `${group.albumName || fallbackSong.title} — ${group.artistName || fallbackSong.artist}`;
  img.loading = "lazy";
  img.decoding = "async";
  const isYouTubeArtwork = String(group.source || "").toLowerCase() === "youtube";
  if (isYouTubeArtwork) art.classList.add("is-youtube-artwork");
  const initialArtwork = isYouTubeArtwork
    ? normalizeYouTubeArtworkUrl(group.artwork)
    : group.artwork;
  img.src = initialArtwork || youtubeArtwork(fallbackSong) || artworkPlaceholder(fallbackSong);
  img.onerror = () => {
    const youtubeFallback = youtubeArtwork(fallbackSong);
    if (youtubeFallback && img.src !== youtubeFallback) {
      art.classList.add("is-youtube-artwork");
      img.src = youtubeFallback;
      return;
    }
    img.onerror = null;
    img.src = artworkPlaceholder(fallbackSong);
  };

  art.append(img);
  art.addEventListener("click", () => playSong(fallbackSong));
  return art;
}

function makeAlbumInfoCell(group) {
  const fallbackSong = group.songs[0];
  const info = document.createElement("article");
  info.className = "album-editorial-cell album-editorial-info";
  if (group.songs.length > 1) info.classList.add("has-multiple");

  const albumName = document.createElement("h3");
  albumName.className = "album-editorial-name";
  const cleanedAlbumName = String(group.albumName || "")
    .replace(/\s+(?:[-–—]\s*)?EP$/i, "")
    .trim();
  const displayAlbumName = group.releaseType === "single"
    ? fallbackSong.title
    : (cleanedAlbumName || fallbackSong.title);
  setScriptAwareText(albumName, displayAlbumName);

  const artist = document.createElement("p");
  artist.className = "album-editorial-artist";
  setScriptAwareText(artist, group.artistName || fallbackSong.artist);

  const tracks = document.createElement("div");
  tracks.className = "album-editorial-tracks";

  // Wall captions contain album, recommended tracks, and artist only.
  group.songs.forEach(song => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "album-editorial-track";
    button.setAttribute("aria-label", `Play ${song.title} by ${song.artist}`);
    setScriptAwareText(button, song.title);
    button.addEventListener("click", () => playSong(song));
    tracks.appendChild(button);
  });

  info.append(albumName, artist, tracks);
  return info;
}

function makeWallSpacer(type = "blank") {
  const spacer = document.createElement("div");
  spacer.className = `album-editorial-cell album-editorial-spacer is-${type}`;
  spacer.setAttribute("aria-hidden", "true");
  return spacer;
}

function wallLayoutHash(value) {
  const text = String(value || "wall");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function appendAlbumCollage(groups) {
  // Balance cover, caption, yellow, and blank cells across columns.
  const dominoSlots = [[0, 1], [2, 3], [4, 5]];
  const templates = [];

  for (let emptySlot = 0; emptySlot < dominoSlots.length; emptySlot += 1) {
    const occupiedSlots = [0, 1, 2].filter(index => index !== emptySlot);
    for (const swapAlbums of [false, true]) {
      for (const flipA of [false, true]) {
        for (const flipB of [false, true]) {
          for (const flipDecor of [false, true]) {
            const pattern = Array(6).fill("blank");
            const slotA = dominoSlots[occupiedSlots[swapAlbums ? 1 : 0]];
            const slotB = dominoSlots[occupiedSlots[swapAlbums ? 0 : 1]];
            const decorSlot = dominoSlots[emptySlot];

            pattern[slotA[0]] = flipA ? "a" : "A";
            pattern[slotA[1]] = flipA ? "A" : "a";
            pattern[slotB[0]] = flipB ? "b" : "B";
            pattern[slotB[1]] = flipB ? "B" : "b";
            pattern[decorSlot[0]] = flipDecor ? "blank" : "solid";
            pattern[decorSlot[1]] = flipDecor ? "solid" : "blank";
            templates.push(pattern);
          }
        }
      }
    }
  }

  let albumIndex = 0;
  let rowIndex = 0;
  let previousCoverColumns = [];
  let previousBlankColumns = [];
  let previousSolidColumn = -1;

  const totalRows = Math.ceil(groups.length / 2);
  const maxYellowCells = Math.min(totalRows, 12); // 6 columns × max 2 each.
  const yellowRows = new Set();
  if (maxYellowCells === 1) {
    yellowRows.add(0);
  } else if (maxYellowCells > 1) {
    for (let i = 0; i < maxYellowCells; i += 1) {
      yellowRows.add(Math.round(i * (totalRows - 1) / (maxYellowCells - 1)));
    }
  }

  const solidColumnCounts = Array(6).fill(0);
  const blankColumnCounts = Array(6).fill(0);
  const coverColumnCounts = Array(6).fill(0);

  const coverColumnsFor = pattern => pattern
    .map((token, i) => (token === "A" || token === "B") ? i : -1)
    .filter(i => i >= 0);
  const decorativeBlankColumnsFor = pattern => pattern
    .map((token, i) => token === "blank" ? i : -1)
    .filter(i => i >= 0);
  const solidColumnFor = pattern => pattern.indexOf("solid");

  while (albumIndex < groups.length) {
    const rowGroups = groups.slice(albumIndex, albumIndex + 2);
    const seedText = rowGroups.map(group => group.key).join("|") + `:${rowIndex}`;
    const startingIndex = wallLayoutHash(seedText) % templates.length;
    const useYellowThisRow = yellowRows.has(rowIndex);
    const minSolidCount = Math.min(...solidColumnCounts);

    let bestTemplateIndex = startingIndex;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let offset = 0; offset < templates.length; offset += 1) {
      const templateIndex = (startingIndex + offset) % templates.length;
      const template = templates[templateIndex];
      const solidColumn = solidColumnFor(template);
      const coverColumns = coverColumnsFor(template);
      const blankColumns = decorativeBlankColumnsFor(template);

      if (useYellowThisRow && solidColumnCounts[solidColumn] >= 2) continue;

      const nextCoverCounts = coverColumnCounts.slice();
      coverColumns.forEach(col => { nextCoverCounts[col] += 1; });
      const nextMaxCover = Math.max(...nextCoverCounts);
      const nextMinCover = Math.min(...nextCoverCounts);
      const coverVariance = nextCoverCounts.reduce((sum, count) => {
        const mean = nextCoverCounts.reduce((a, b) => a + b, 0) / 6;
        return sum + ((count - mean) ** 2);
      }, 0);

      const repeatedCoverCount = coverColumns.filter(col => previousCoverColumns.includes(col)).length;
      const repeatedBlankCount = blankColumns.filter(col => previousBlankColumns.includes(col)).length;
      let score = 0;

      // Prioritize even cover distribution.
      score += (nextMaxCover - nextMinCover) * 2500;
      score += coverVariance * 220;
      score += repeatedCoverCount * 420;
      if (coverColumns.join(",") === previousCoverColumns.join(",")) score += 1800;

      // Spread blank cells across columns.
      score += blankColumns.reduce((sum, col) => sum + blankColumnCounts[col], 0) * 80;
      score += repeatedBlankCount * 110;
      if (blankColumns.join(",") === previousBlankColumns.join(",")) score += 550;

      if (useYellowThisRow) {
        // Give each column one yellow cell before assigning a second.
        score += (solidColumnCounts[solidColumn] - minSolidCount) * 5000;
        if (previousSolidColumn === solidColumn) score += 900;
      }

      score += offset * 0.001;
      if (score < bestScore) {
        bestScore = score;
        bestTemplateIndex = templateIndex;
      }
    }

    const templateIndex = bestTemplateIndex;
    const template = templates[templateIndex];
    const chosenSolidColumn = solidColumnFor(template);
    const chosenCoverColumns = coverColumnsFor(template);
    const chosenBlankColumns = decorativeBlankColumnsFor(template);
    const canUseSolid = useYellowThisRow && solidColumnCounts[chosenSolidColumn] < 2;

    if (canUseSolid) solidColumnCounts[chosenSolidColumn] += 1;
    chosenCoverColumns.forEach(col => { coverColumnCounts[col] += 1; });
    chosenBlankColumns.forEach(col => {
      // Count the unused solid cell as blank space on non-yellow rows.
      blankColumnCounts[col] += 1;
    });
    if (!canUseSolid && chosenSolidColumn >= 0) blankColumnCounts[chosenSolidColumn] += 1;

    previousCoverColumns = chosenCoverColumns;
    previousBlankColumns = chosenBlankColumns;
    previousSolidColumn = canUseSolid ? chosenSolidColumn : -1;

    const row = document.createElement("div");
    row.className = `album-editorial-row pattern-${templateIndex}`;

    const albumA = rowGroups[0] || null;
    const albumB = rowGroups[1] || null;
    const cells = {
      A: albumA ? makeAlbumArtCell(albumA) : makeWallSpacer("blank"),
      a: albumA ? makeAlbumInfoCell(albumA) : makeWallSpacer("blank"),
      B: albumB ? makeAlbumArtCell(albumB) : makeWallSpacer("blank"),
      b: albumB ? makeAlbumInfoCell(albumB) : makeWallSpacer("blank")
    };

    template.forEach((token, columnIndex) => {
      if (token === "solid") {
        row.appendChild(makeWallSpacer(canUseSolid && columnIndex === chosenSolidColumn ? "solid" : "blank"));
      } else if (token === "blank") {
        row.appendChild(makeWallSpacer("blank"));
      } else {
        row.appendChild(cells[token]);
      }
    });

    coverWall.appendChild(row);
    albumIndex += rowGroups.length;
    rowIndex += 1;
  }
}

function getWallSongs() {
  return songs;
}

function wallVisibleSongSignature(songList = getWallSongs()) {
  return (songList || []).map(song => String(song.id)).join("|");
}

async function renderWall() {
  if (!coverWall || !wallEmpty) return;
  const token = ++wallRenderToken;
  const wallSongs = getWallSongs();
  wallRenderedSongSignature = wallVisibleSongSignature(wallSongs);

  wallEmpty.hidden = true;

  if (!wallSongs.length) {
    coverWall.innerHTML = "";
    wallEmpty.hidden = false;
    if (wallAlbumCount) wallAlbumCount.textContent = "0 ALBUMS";
    return;
  }

  // Render stored metadata immediately and resolve missing data in background.
  const resolved = wallSongs.map(song => ({
    song,
    album: hasStoredAlbumMetadata(song)
      ? storedAlbumForWall(song)
      : pendingAlbumForWall(song)
  }));

  if (token !== wallRenderToken) return;
  const groups = makeAlbumGroups(resolved);
  coverWall.innerHTML = "";
  wallEmpty.hidden = groups.length > 0;
  if (wallAlbumCount) wallAlbumCount.textContent = `${groups.length} ALBUM${groups.length === 1 ? "" : "S"}`;
  appendAlbumCollage(groups);

  // Start metadata backfill after first paint.
  ensureWallAlbumMetadata(wallSongs);
}

function scrollViewBelowToolbar(section) {
  requestAnimationFrame(() => {
    const toolbar = document.querySelector(".toolbar");
    const toolbarHeight = toolbar ? toolbar.getBoundingClientRect().height : 0;
    const top = section.getBoundingClientRect().top + window.scrollY - toolbarHeight;
    window.scrollTo({
      top: Math.max(0, top),
      left: 0,
      behavior: "smooth"
    });
  });
}

function setView(view) {
  const isStats = view === "stats";
  const isWall = view === "wall";
  const isArchive = !isStats && !isWall;
  hideStatsTooltip();

  archiveView.hidden = !isArchive;
  statsView.hidden = !isStats;
  wallView.hidden = !isWall;
  archiveTools.hidden = isStats;

  if (filters) {
    filters.hidden = isWall;
    filters.style.display = isWall ? "none" : "";
  }
  if (searchWrap) {
    searchWrap.hidden = isWall;
    searchWrap.style.display = isWall ? "none" : "";
  }

  viewButtons.forEach(button => {
    button.classList.toggle("active", button.dataset.view === view);
  });

  document.body.classList.toggle("stats-mode", isStats);
  document.body.classList.toggle("wall-mode", isWall);

  if (isStats) {
    renderStats();
    requestAnimationFrame(() => {
      statsView.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  } else if (isWall) {
    wallRenderedSongSignature = "";
    renderWall();
    scrollViewBelowToolbar(wallView);
  } else if (window.matchMedia("(min-width: 621px)").matches) {
    scrollViewBelowToolbar(archiveView);
  }
}


dialog.addEventListener("click", event => {
  const rect = dialog.getBoundingClientRect();
  const clickedOutside =
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom;
  if (clickedOutside) dialog.close();
});

function applySongMediaPatchToObject(target, patch) {
  if (!target || !patch) return;

  if (Object.prototype.hasOwnProperty.call(patch, "youtube_url")) {
    target.youtubeUrl = String(patch.youtube_url || "");
  }
  if (Object.prototype.hasOwnProperty.call(patch, "spotify_url")) {
    target.spotifyUrl = String(patch.spotify_url || "");
  }
  if (Object.prototype.hasOwnProperty.call(patch, "spotify_status")) {
    target.spotifyStatus = String(patch.spotify_status || "");
  }
  if (Object.prototype.hasOwnProperty.call(patch, "spotify_lookup_source")) {
    target.spotifyLookupSource = String(patch.spotify_lookup_source || "");
  }
  if (Object.prototype.hasOwnProperty.call(patch, "spotify_lookup_at")) {
    target.spotifyLookupAt = patch.spotify_lookup_at || null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "spotify_title")) {
    target.spotifyTitle = String(patch.spotify_title || "");
  }
  if (Object.prototype.hasOwnProperty.call(patch, "spotify_artist")) {
    target.spotifyArtist = String(patch.spotify_artist || "");
  }
  if (Object.prototype.hasOwnProperty.call(patch, "spotify_isrc")) {
    target.spotifyIsrc = String(patch.spotify_isrc || "");
  }
  if (Object.prototype.hasOwnProperty.call(patch, "spotify_match_confidence")) {
    target.spotifyMatchConfidence = patch.spotify_match_confidence ?? null;
  }
}

async function updateSongMediaPatch(song, patch) {
  if (!song?.id || !patch || !Object.keys(patch).length) return;

  const { error } = await supabaseClient
    .from("songs")
    .update(patch)
    .eq("id", song.id);

  if (error) throw error;

  // Update both the object owned by the background task and whichever fresh
  // object Supabase realtime may already have remapped into the songs array.
  applySongMediaPatchToObject(song, patch);
  const liveSong = songs.find(item => String(item.id || "") === String(song.id || ""));
  if (liveSong && liveSong !== song) {
    applySongMediaPatchToObject(liveSong, patch);
  }

  renderSongs();
  refreshOpenPlayerSourceState(liveSong || song);
}

async function enrichSongMediaInBackground(song, { title, artist, youtubeUrl = "", spotifyUrl = "" }) {
  const shouldFindYouTube = !youtubeUrl;
  const shouldFindSpotify = !spotifyUrl;
  const tasks = [];
  const songId = String(song?.id || "");

  // Keep pending state outside the song object. Supabase realtime replaces song
  // objects after INSERT/UPDATE events, but the ID survives those remaps.
  song.mediaLookupPending = shouldFindYouTube || shouldFindSpotify;
  if (songId) {
    if (song.mediaLookupPending) pendingMediaLookupIds.add(songId);
    if (shouldFindYouTube) pendingYouTubeLookupIds.add(songId);
    if (shouldFindSpotify) pendingSpotifyLookupIds.add(songId);
  }
  renderSongs();
  refreshOpenPlayerSourceState(song);

  if (shouldFindYouTube) {
    tasks.push((async () => {
      try {
        const match = await findYouTubeSong(title, artist);
        if (match?.url) {
          // Update immediately. Do not wait for Spotify if YouTube finishes first.
          await updateSongMediaPatch(song, {
            youtube_url: match.url
          });
        }
      } catch (error) {
        console.error("Background YouTube auto-fetch failed:", error);
      } finally {
        if (songId) pendingYouTubeLookupIds.delete(songId);
        renderSongs();
        refreshOpenPlayerSourceState(song);
      }
    })());
  }

  if (shouldFindSpotify) {
    tasks.push((async () => {
      const lookupAt = new Date().toISOString();

      try {
        const result = await findSpotifySong(title, artist);
        const match = result?.match;

        if (match?.url) {
          await updateSongMediaPatch(song, {
            spotify_url: match.url,
            spotify_status: "found",
            spotify_lookup_source:
              match.source ||
              result.source ||
              "AUTO",
            spotify_lookup_at: lookupAt,
            spotify_title:
              match.spotify_title ||
              match.title ||
              null,
            spotify_artist:
              match.spotify_artist ||
              match.artist ||
              null,
            spotify_isrc: match.isrc || null,
            spotify_match_confidence: Number.isFinite(Number(match.confidence))
              ? Number(match.confidence)
              : null
          });
        } else {
          await updateSongMediaPatch(song, {
            spotify_status:
              result?.status === "error"
                ? "error"
                : "not_found",
            spotify_lookup_source:
              result?.source ||
              "ALL_RESOLVERS_EXHAUSTED",
            spotify_lookup_at: lookupAt
          });
        }
      } catch (error) {
        console.error("Background Spotify auto-fetch failed:", error);

        try {
          await updateSongMediaPatch(song, {
            spotify_status: "error",
            spotify_lookup_source: "FUNCTION_ERROR",
            spotify_lookup_at: lookupAt
          });
        } catch (updateError) {
          console.error("Could not save Spotify lookup error state:", updateError);
        }
      } finally {
        if (songId) pendingSpotifyLookupIds.delete(songId);
        renderSongs();
        refreshOpenPlayerSourceState(song);
      }
    })());
  }

  // Start both lookups together and persist each source as soon as it resolves.
  await Promise.allSettled(tasks);
  song.mediaLookupPending = false;
  if (songId) {
    pendingMediaLookupIds.delete(songId);
    pendingYouTubeLookupIds.delete(songId);
    pendingSpotifyLookupIds.delete(songId);
  }
  renderSongs();
  refreshOpenPlayerSourceState(song);

  return song;
}

async function enrichNewSongInBackground(song, options) {
  try {
    // Media enrichment runs in the background.
    await enrichSongMediaInBackground(song, options);

    // Resolve album metadata after media lookup so it can reuse discovered identifiers.
    const resolvedAlbum = await resolveAlbumMetadataViaSupabase(
      [song],
      { limit: 1 }
    );

    if (resolvedAlbum) {
      renderSongs();
    }
  } catch (error) {
    console.warn(`Background enrichment failed for song ${song?.id || "unknown"}:`, error);
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();

  if (!currentPerson || !currentUser) {
    alert("Your access session is not ready yet.");
    return;
  }

  const data = new FormData(form);
  const title = String(data.get("title") || "").trim();
  const artist = String(data.get("artist") || "").trim();
  const youtubeUrl = String(data.get("youtubeUrl") || "").trim();
  const spotifyUrl = String(data.get("spotifyUrl") || "").trim();
  const note = String(data.get("note") || "").trim();

  if (!title || !artist) return;

  const spotifyStatus = spotifyUrl ? "manual" : "pending";
  const spotifyLookupSource = spotifyUrl ? "MANUAL" : null;
  const now = new Date().toISOString();

  submitSongButton.disabled = true;
  submitSongButton.textContent = "SAVING…";

  if (youtubeUrl) {
    setYouTubeAutoStatus("MANUAL YOUTUBE LINK USED", "found");
  } else {
    setYouTubeAutoStatus("AUTO-FETCH WILL CONTINUE IN BACKGROUND");
  }

  if (spotifyUrl) {
    setSpotifyAutoStatus("MANUAL SPOTIFY LINK USED", "found");
  } else {
    setSpotifyAutoStatus("AUTO-FETCH WILL CONTINUE IN BACKGROUND");
  }

  try {
    // Save user-entered content first; media links are background enrichment.
    const { data: inserted, error } = await supabaseClient
      .from("songs")
      .insert({
        title,
        artist,
        youtube_url: youtubeUrl || null,
        spotify_url: spotifyUrl || null,
        spotify_status: spotifyStatus,
        spotify_lookup_source: spotifyLookupSource,
        spotify_lookup_at: spotifyUrl ? now : null,
        spotify_title: null,
        spotify_artist: null,
        spotify_isrc: null,
        spotify_match_confidence: null,
        note: note || null,
        sender_person: currentPerson,
        created_by: currentUser.id
      })
      .select(
        "id,title,artist,youtube_url,spotify_url,spotify_status,spotify_lookup_source,spotify_lookup_at,spotify_title,spotify_artist,spotify_isrc,spotify_match_confidence,note,sender_person,created_at,album_name,album_artist,album_artwork_url,album_source,album_key,release_type,spotify_album_id,bandcamp_url,album_external_url,album_match_confidence,album_resolution_status,album_locked,album_resolved_at"
      )
      .single();

    if (error) throw error;

    let newSong = null;

    if (inserted) {
      newSong = mapRemoteSong(inserted);
      newSong.mediaLookupPending = !youtubeUrl || !spotifyUrl;
      if (newSong.id) {
        const newSongId = String(newSong.id);
        if (newSong.mediaLookupPending) pendingMediaLookupIds.add(newSongId);
        if (!youtubeUrl) pendingYouTubeLookupIds.add(newSongId);
        if (!spotifyUrl) pendingSpotifyLookupIds.add(newSongId);
      }
      songs.unshift(newSong);
      renderSongs();
    } else {
      await loadRemoteSongs();
    }

    form.reset();
    setYouTubeAutoStatus("OPTIONAL");
    setSpotifyAutoStatus("OPTIONAL · AUTO-FETCH");

    currentFilter = "all";
    document
      .querySelectorAll(".filter")
      .forEach(x => x.classList.remove("active"));
    document
      .querySelector('.filter[data-filter="all"]')
      .classList.add("active");

    renderSongs();

    // Close as soon as Supabase confirms the insert.
    dialog.close();

    // Do not block the UI on background enrichment.
    if (newSong) {
      void enrichNewSongInBackground(newSong, {
        title,
        artist,
        youtubeUrl,
        spotifyUrl
      });
    }
  } catch (error) {
    console.error("Could not save song:", error);
    alert(`Could not save this song: ${error.message}`);
  } finally {
    submitSongButton.disabled = false;
    submitSongButton.textContent = "ADD TO ARCHIVE →";
  }
});

filters.addEventListener("click", event => {
  const button = event.target.closest(".filter");
  if (!button) return;
  currentFilter = button.dataset.filter;
  document.querySelectorAll(".filter").forEach(x => x.classList.remove("active"));
  button.classList.add("active");
  renderSongs();
});

searchInput.addEventListener("input", event => {
  searchTerm = event.target.value.trim().toLowerCase();
  renderSongs();
});

document.querySelector("#randomSong").addEventListener("click", () => {
  const visible = wallView && !wallView.hidden ? getWallSongs() : getVisibleSongs();
  if (!visible.length) return;

  const pick = visible[Math.floor(Math.random() * visible.length)];

  const preferredSource =
    getYouTubeVideoId(pick.youtubeUrl)
      ? "youtube"
      : getSpotifyEmbedUrl(pick.spotifyUrl)
        ? "spotify"
        : null;

  if (preferredSource) {
    playSong(pick, preferredSource);
  }

  const node = document.querySelector(`[data-id="${CSS.escape(pick.id)}"]`);

  if (node) {
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    node.classList.add("random-pick");
    setTimeout(() => node.classList.remove("random-pick"), 1400);
  }
});


function setYouTubeAutoStatus(message, state = "idle") {
  if (!youtubeAutoStatus) return;

  youtubeAutoStatus.textContent = message;
  youtubeAutoStatus.classList.toggle(
    "youtube-auto-status-found",
    state === "found"
  );
  youtubeAutoStatus.classList.toggle(
    "youtube-auto-status-error",
    state === "error"
  );
}

function setSpotifyAutoStatus(message, state = "idle") {
  if (!spotifyAutoStatus) return;

  spotifyAutoStatus.textContent = message;
  spotifyAutoStatus.classList.toggle(
    "spotify-auto-status-found",
    state === "found"
  );
  spotifyAutoStatus.classList.toggle(
    "spotify-auto-status-error",
    state === "error"
  );
}

function spotifyTrackUrlOnly(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "open.spotify.com") return "";
    const parts = parsed.pathname.split("/").filter(Boolean);
    const start = parts[0]?.startsWith("intl-") ? 1 : 0;
    if (parts[start] !== "track" || !parts[start + 1]) return "";
    return `https://open.spotify.com/track/${parts[start + 1]}`;
  } catch {
    return "";
  }
}

function spotifyTrackUri(urlOrUri) {
  const value = String(urlOrUri || "").trim();
  const uriMatch = value.match(/^spotify:track:([A-Za-z0-9]+)$/i);
  if (uriMatch) return `spotify:track:${uriMatch[1]}`;

  const trackUrl = spotifyTrackUrlOnly(value);
  if (!trackUrl) return "";
  const id = trackUrl.split("/").pop();
  return id ? `spotify:track:${id}` : "";
}

function spotifyPlayingUri(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return spotifyTrackUri(raw) || raw;
}

function normalizeSpotifyMatchText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function findSpotifySong(title, artist) {
  const wantedTitle = normalizeSpotifyMatchText(title);
  const wantedArtist = normalizeSpotifyMatchText(artist);

  const archived = songs.find(song =>
    normalizeSpotifyMatchText(song.title) === wantedTitle &&
    normalizeSpotifyMatchText(song.artist) === wantedArtist &&
    spotifyTrackUrlOnly(song.spotifyUrl)
  );

  if (archived) {
    return {
      status: "found",
      source: "ARCHIVE",
      match: {
        url: spotifyTrackUrlOnly(archived.spotifyUrl),
        spotify_title: archived.spotifyTitle || archived.title,
        spotify_artist: archived.spotifyArtist || archived.artist,
        source: "ARCHIVE",
        isrc: archived.spotifyIsrc || null,
        confidence: 1
      }
    };
  }

  const { data, error } = await supabaseClient.functions.invoke(
    "spotify-search",
    {
      body: {
        title,
        artist
      }
    }
  );

  if (error) {
    const message = await functionErrorMessage(
      error,
      "SPOTIFY SEARCH FAILED"
    );
    const wrapped = new Error(message);
    wrapped.original = error;
    throw wrapped;
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return {
    status: String(
      data?.status ||
      (data?.match?.url ? "found" : "not_found")
    ),
    source: String(
      data?.match?.source ||
      data?.source ||
      ""
    ),
    match: data?.match || null
  };
}

function formatSpotifyApiError(error) {
  const message = String(error?.message || "").toLowerCase();

  if (message.includes("404") || message.includes("not found")) {
    return "SPOTIFY AUTO-FETCH NOT DEPLOYED · SONG CAN STILL BE SAVED";
  }

  if (
    message.includes("access not claimed") ||
    message.includes("unauthorized") ||
    message.includes("jwt")
  ) {
    return "SPOTIFY AUTO-FETCH FAILED · ACCESS SESSION ERROR";
  }

  if (message.includes("listenbrainz") || message.includes("spotify")) {
    return `SPOTIFY AUTO-FETCH FAILED · ${String(error?.message || "CHECK EDGE FUNCTION").toUpperCase()}`;
  }

  return "SPOTIFY AUTO-FETCH FAILED · SONG CAN STILL BE SAVED";
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function findYouTubeSong(title, artist) {
  const { data, error } = await supabaseClient.functions.invoke(
    "youtube-search",
    {
      body: {
        title,
        artist
      }
    }
  );

  if (error) {
    const message = await functionErrorMessage(
      error,
      "YOUTUBE SEARCH FAILED"
    );
    const wrapped = new Error(message);
    wrapped.original = error;
    throw wrapped;
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data?.match || null;
}

function formatYouTubeApiError(error) {
  const message = String(error?.message || "").toLowerCase();

  if (message.includes("quota")) {
    return "YOUTUBE AUTO-FETCH FAILED · API QUOTA REACHED";
  }

  if (
    message.includes("access not claimed") ||
    message.includes("unauthorized") ||
    message.includes("jwt")
  ) {
    return "YOUTUBE AUTO-FETCH FAILED · ACCESS SESSION ERROR";
  }

  if (message.includes("api") || message.includes("youtube")) {
    return `YOUTUBE AUTO-FETCH FAILED · ${String(error?.message || "CHECK EDGE FUNCTION").toUpperCase()}`;
  }

  return "YOUTUBE AUTO-FETCH FAILED · SONG CAN STILL BE SAVED";
}

function playSong(song, requestedSource = null, options = {}) {
  const youtubeId = getYouTubeVideoId(song.youtubeUrl);
  const spotifyEmbedUrl = getSpotifyEmbedUrl(song.spotifyUrl);
  const backgroundFallback = options?.backgroundFallback === true;

  backgroundYoutubeFallbackActive = backgroundFallback;

  const source = requestedSource || (youtubeId ? "youtube" : spotifyEmbedUrl ? "spotify" : null);

  // Open the player while background media lookup is still pending.
  if (!source && isSongMediaLookupPending(song)) {
    void markSongRead(song);
    currentSource = null;
    currentSongId = song.id;
    revealPlayer(song);
    renderSourceTabs(song, null);
    playerStatus.textContent = "FINDING PLAYABLE LINK…";
    mediaEmbed.className = "media-embed";
    mediaEmbed.innerHTML = `
      <div class="player-error player-pending-media">
        YouTube and Spotify are still being checked for this song.
      </div>`;
    syncPlayButtons();
    syncStatsPlayingState();
    stabilizeMobileArchiveHorizontalPosition();
    return;
  }

  void markSongRead(song);

  currentSongId = song.id;
  revealPlayer(song);
  renderSourceTabs(song, source);

  if (source === "youtube" && youtubeId) {
    destroySpotifyPlayer();
    currentSource = "youtube";
    playerStatus.textContent = activePlaybackStatusText();
    mediaEmbed.className = "media-embed youtube-mode";
    mediaEmbed.innerHTML = "";

    if (!["http:", "https:"].includes(window.location.protocol)) {
      playerStatus.textContent = "YOUTUBE · NEEDS LOCALHOST / HOSTED SITE";
      mediaEmbed.innerHTML = `
    <div class="player-error">
      <div>
        <strong>Open this site through localhost.</strong><br><br>
        YouTube cannot reliably identify a page opened as <code>file://</code>.
        Use START-MAC.command / START-WINDOWS.bat from the downloaded project,
        then open <code>http://localhost:8000</code>.
      </div>
    </div>`;
      currentSongId = song.id;
      syncPlayButtons();
      return;
    }

    destroyYouTubePlayer();
    mountYouTubePlayer(song, youtubeId, Math.max(0, Number(options?.startSeconds || 0)));
  } else if (source === "spotify" && spotifyEmbedUrl) {
    destroyYouTubePlayer();
    currentSource = "spotify";
    playerStatus.textContent = "LOADING…";
    mediaEmbed.className = "media-embed spotify-mode";
    mediaEmbed.innerHTML = "";

    // Warm the YouTube API while Spotify is in the foreground so a later
    // background handoff does not have to wait for the API script to load.
    if (youtubeId) {
      void ensureYouTubeApi().catch(() => {});
    }

    void mountSpotifyPlayer(song);
  } else {
    destroyYouTubePlayer();
    destroySpotifyPlayer();
    currentSource = null;
    playerStatus.textContent = "NO EMBEDDABLE SOURCE";
    mediaEmbed.className = "media-embed";
    mediaEmbed.innerHTML = `
  <div class="player-error">
    Add a YouTube watch link or a Spotify track link to play this song here.
  </div>`;
  }

  currentSongId = song.id;
  syncPlayButtons();
  syncStatsPlayingState();
  stabilizeMobileArchiveHorizontalPosition();
}

function renderSourceTabs(song, activeSource) {
  const sources = [];
  const youtubeReady = Boolean(getYouTubeVideoId(song.youtubeUrl));
  const spotifyReady = Boolean(getSpotifyEmbedUrl(song.spotifyUrl));
  const youtubePending = !youtubeReady && isYouTubeLookupPending(song);
  const spotifyPending = !spotifyReady && isSpotifyLookupPending(song);
  const spotifyPreviewActive =
    spotifyReady &&
    activeSource === "spotify" &&
    currentSource === "spotify" &&
    spotifyPlaybackMode === "preview";

  if (youtubeReady) {
    sources.push({ key: "youtube", label: "YOUTUBE", pending: false });
  } else if (youtubePending) {
    sources.push({ key: "youtube", label: "YOUTUBE · FINDING…", pending: true });
  }

  if (spotifyReady) {
    const mobileSpotifyPreview = spotifyPreviewActive && spotifyUsesMobileEmbedUx();

    sources.push({
      key: "spotify",
      label:
        spotifyPreviewActive && !mobileSpotifyPreview
          ? (spotifyAwaitingSignInRetry ? "SPOTIFY · RETRY" : "SPOTIFY · SIGN IN ↗")
          : "SPOTIFY",
      pending: false,
      previewAction: spotifyPreviewActive && !mobileSpotifyPreview
    });

    if (mobileSpotifyPreview) {
      sources.push({
        key: "spotify-open",
        label: "OPEN",
        icon: "external",
        pending: false,
        externalSpotifyAction: true
      });
    }
  } else if (spotifyPending) {
    sources.push({ key: "spotify", label: "SPOTIFY · FINDING…", pending: true });
  }

  sourceTabs.innerHTML = "";
  const hasPendingSource = sources.some(source => source.pending);
  const hasPreviewAction = sources.some(source => source.previewAction);
  sourceTabs.hidden = sources.length === 0 || (sources.length < 2 && !hasPendingSource && !hasPreviewAction);

  sources.forEach(source => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.source = source.key;
    button.className = `source-tab${source.key === activeSource && !source.pending ? " active" : ""}${source.pending ? " is-pending" : ""}${source.previewAction ? " is-preview-signin" : ""}${source.externalSpotifyAction ? " is-mobile-spotify-open" : ""}`;

    const label = document.createElement("span");
    label.className = "source-tab-label";
    label.append(document.createTextNode(source.label));

    if (source.icon === "external") {
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.classList.add("source-tab-icon");
      icon.setAttribute("viewBox", "0 0 12 12");
      icon.setAttribute("aria-hidden", "true");

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M4 2h6v6M10 2 2 10");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "1.45");
      path.setAttribute("stroke-linecap", "square");
      path.setAttribute("stroke-linejoin", "miter");
      icon.appendChild(path);
      label.appendChild(icon);
    }

    button.appendChild(label);

    if (source.pending) {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
    } else if (source.externalSpotifyAction) {
      button.setAttribute("aria-label", "Open this track in Spotify");
      button.addEventListener("click", () => {
        const target = spotifyTrackUrlOnly(song.spotifyUrl);
        if (target) window.open(target, "_blank", "noopener,noreferrer");
      });
    } else if (source.previewAction) {
      if (spotifyAwaitingSignInRetry) {
        button.setAttribute("aria-label", "Retry Spotify after signing in");
        button.addEventListener("click", () => {
          spotifyAwaitingSignInRetry = false;
          playSong(song, "spotify");
        });
      } else {
        button.setAttribute("aria-label", "Sign in to Spotify for full playback");
        button.addEventListener("click", () => openSpotifyForFullPlayback(song));
      }
    } else {
      button.addEventListener("click", () => playSong(song, source.key));
    }

    sourceTabs.appendChild(button);
  });
}

function getYouTubeVideoId(url) {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const cleanId = value =>
      value && /^[A-Za-z0-9_-]{6,}$/.test(value) ? value : null;

    if (host === "youtu.be") {
      return cleanId(parsed.pathname.split("/").filter(Boolean)[0]);
    }

    if (
      ["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"]
        .includes(host)
    ) {
      if (parsed.pathname === "/watch") {
        return cleanId(parsed.searchParams.get("v"));
      }

      const parts = parsed.pathname.split("/").filter(Boolean);

      if (["embed", "shorts", "live"].includes(parts[0]) && parts[1]) {
        return cleanId(parts[1]);
      }
    }
  } catch { }

  return null;
}

function getSpotifyEmbedUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "open.spotify.com") return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    let i = parts[0]?.startsWith("intl-") ? 1 : 0;
    const type = parts[i];
    const id = parts[i + 1];
    const supported = ["track", "album", "playlist", "artist", "episode", "show"];
    if (!supported.includes(type) || !id) return null;
    return `https://open.spotify.com/embed/${type}/${encodeURIComponent(id)}?utm_source=generator&theme=0`;
  } catch {
    return null;
  }
}

function revealPlayer(song) {
  currentSongId = song.id;
  setScriptAwareText(playerTitle, song.title);
  setScriptAwareText(playerArtist, song.artist);
  playerBar.hidden = false;
  document.body.classList.add("player-open");
  requestAnimationFrame(() => playerBar.classList.add("is-visible"));
  syncPlayButtons();
}

function closePlayer() {
  destroyYouTubePlayer();
  destroySpotifyPlayer();
  playerBar.classList.remove("is-visible");
  setTimeout(() => {
    playerBar.hidden = true;
    mediaEmbed.innerHTML = "";
    document.body.classList.remove("player-open");
  }, 220);
  currentSongId = null;
  syncStatsPlayingState();
  currentSource = null;
  syncPlayButtons();
}

function isYouTubeLookupPending(song) {
  if (!song) return false;
  const songId = String(song.id || "");
  return Boolean(songId && pendingYouTubeLookupIds.has(songId));
}

function isSpotifyLookupPending(song) {
  if (!song) return false;
  const songId = String(song.id || "");
  if (songId && pendingSpotifyLookupIds.has(songId)) return true;
  return !getSpotifyEmbedUrl(song.spotifyUrl) &&
    String(song.spotifyStatus || "").toLowerCase() === "pending";
}

function refreshOpenPlayerSourceState(song) {
  if (!song || playerBar.hidden || String(currentSongId || "") !== String(song.id || "")) {
    return;
  }

  const latestSong = songs.find(item => String(item.id || "") === String(song.id || "")) || song;
  renderSourceTabs(latestSong, currentSource);

  // Do not remount active playback when another source finishes resolving.
  if (currentSource) return;

  const youtubeReady = Boolean(getYouTubeVideoId(latestSong.youtubeUrl));
  const spotifyReady = Boolean(getSpotifyEmbedUrl(latestSong.spotifyUrl));
  const stillPending = isYouTubeLookupPending(latestSong) || isSpotifyLookupPending(latestSong);

  if (youtubeReady || spotifyReady) {
    playerStatus.textContent = stillPending
      ? "PLAYABLE LINK FOUND · OTHER SOURCE STILL CHECKING…"
      : "READY · SELECT SOURCE";
    mediaEmbed.className = "media-embed";
    mediaEmbed.innerHTML = `
      <div class="player-error player-pending-media">
        A playable source is ready. Choose it above${stillPending ? " while the other source keeps resolving." : "."}
      </div>`;
    return;
  }

  if (stillPending || isSongMediaLookupPending(latestSong)) {
    playerStatus.textContent = "FINDING PLAYABLE LINK…";
    mediaEmbed.className = "media-embed";
    mediaEmbed.innerHTML = `
      <div class="player-error player-pending-media">
        YouTube and Spotify are still being checked for this song.
      </div>`;
    return;
  }

  playerStatus.textContent = "NO EMBEDDABLE SOURCE";
  mediaEmbed.className = "media-embed";
  mediaEmbed.innerHTML = `
    <div class="player-error">
      No playable YouTube or Spotify link was found for this song.
    </div>`;
}

function isSongMediaLookupPending(song) {
  if (!song) return false;

  const songId = String(song.id || "");
  if (songId && pendingMediaLookupIds.has(songId)) return true;
  if (isYouTubeLookupPending(song) || isSpotifyLookupPending(song)) return true;
  if (song.mediaLookupPending) return true;

  // Persisted pending status covers realtime remaps before local lookup state is attached.
  const hasPlayableLink =
    Boolean(getYouTubeVideoId(song.youtubeUrl)) ||
    Boolean(getSpotifyEmbedUrl(song.spotifyUrl));

  return !hasPlayableLink && String(song.spotifyStatus || "").toLowerCase() === "pending";
}

function setPlayButtonContent(button, state = "idle") {
  if (!button) return;

  if (state === "pending") {
    button.innerHTML = `<span>FINDING LINK…</span>`;
    return;
  }

  if (state === "disabled") {
    button.innerHTML = `<span>NO PLAYABLE LINK</span>`;
    return;
  }

  const active = state === "playing";

  button.innerHTML = active
    ? `<svg class="play-action-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><rect x="3" y="3" width="6" height="6" fill="currentColor" /></svg><span>PLAYING</span>`
    : `<svg class="play-action-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 2.25L9.25 6 3 9.75Z" fill="currentColor" /></svg><span>PLAY HERE</span>`;
}

function syncPlayButtons() {
  document.querySelectorAll(".song-row").forEach(row => {
    const button = row.querySelector(".play-song");
    const active = row.dataset.id === currentSongId && !playerBar.hidden;
    row.classList.toggle("is-playing", active);
    if (!button || button.disabled) return;
    setPlayButtonContent(button, active ? "playing" : "idle");
  });
}


function loadLegacySongs() {
  try {
    const saved = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!saved) return [];

    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function saveSongs() { }

function containsCyrillic(value) {
  return /[\u0400-\u052F]/u.test(String(value ?? ""));
}

function setScriptAwareText(element, value) {
  if (!element) return null;

  const text = document.createElement("span");
  text.textContent = String(value ?? "");

  if (containsCyrillic(value)) {
    text.classList.add("script-size-adjust");
  }

  element.replaceChildren(text);
  return text;
}

function scriptAwareHtml(value) {
  const className = containsCyrillic(value) ? ' class="script-size-adjust"' : "";
  return `<span${className}>${escapeHtml(value)}</span>`;
}

const mobileSongLayoutQuery = window.matchMedia(
  "(max-width: 768px), (hover: none) and (pointer: coarse)"
);


function stabilizeMobileArchiveHorizontalPosition() {
  if (!mobileSongLayoutQuery.matches) return;

  const y = window.scrollY;
  const reset = () => {
    const root = document.scrollingElement;
    if (root && root.scrollLeft !== 0) root.scrollLeft = 0;
    if (window.scrollX !== 0) window.scrollTo(0, y);
    if (songList && songList.scrollLeft !== 0) songList.scrollLeft = 0;
  };

  reset();
  requestAnimationFrame(() => {
    reset();
    requestAnimationFrame(reset);
  });
  setTimeout(reset, 80);
  setTimeout(reset, 240);
}

// Prevent native long-press effects from changing mobile title geometry.
["contextmenu", "selectstart", "dragstart"].forEach(type => {
  songList?.addEventListener(type, event => {
    if (!mobileSongLayoutQuery.matches) return;
    if (!event.target.closest(".song-row")) return;
    event.preventDefault();
  });
});

["pointerup", "pointercancel"].forEach(type => {
  songList?.addEventListener(type, event => {
    if (!mobileSongLayoutQuery.matches || event.pointerType === "mouse") return;
    const row = event.target.closest(".song-row");
    row?.querySelector(".song-title")?.blur?.();

    // Keep the mobile archive horizontally anchored.
    stabilizeMobileArchiveHorizontalPosition();
  }, { passive: true });
});

// Remove touch focus styling without blocking click behavior.
songList?.addEventListener("pointerdown", event => {
  if (!mobileSongLayoutQuery.matches || event.pointerType === "mouse") return;
  const control = event.target.closest('.song-row button, .song-row [role="button"]');
  if (!control) return;
  control.blur?.();
  requestAnimationFrame(() => control.blur?.());
}, { passive: true, capture: true });

let mobileSongMeasureFrame = 0;

function updateMobileSongWrapState(row) {
  if (!row) return;
  if (!mobileSongLayoutQuery.matches) {
    row.classList.remove("is-title-multiline");
    row.style.removeProperty("--mobile-first-line-width");
    return;
  }

  const titleText = row.querySelector(".song-title-text");
  const titleSpan = titleText?.querySelector(":scope > span:first-child");
  if (!titleText || !titleSpan) return;

  // Use line rects to measure wrapping and position the NEW marker.
  const range = document.createRange();
  range.selectNodeContents(titleSpan);
  const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);

  if (rects.length) {
    row.classList.toggle("is-title-multiline", rects.length > 1);
    row.style.setProperty("--mobile-first-line-width", `${rects[0].width.toFixed(2)}px`);
    return;
  }

  const style = getComputedStyle(titleText);
  const lineHeight = parseFloat(style.lineHeight) || 19.55;
  const height = titleText.getBoundingClientRect().height;
  row.classList.toggle("is-title-multiline", height > lineHeight * 1.45);
  row.style.setProperty("--mobile-first-line-width", `${titleSpan.getBoundingClientRect().width.toFixed(2)}px`);
}

function syncMobileSongWrapStates() {
  document.querySelectorAll(".song-row").forEach(updateMobileSongWrapState);
}

function queueMobileSongWrapSync() {
  cancelAnimationFrame(mobileSongMeasureFrame);
  mobileSongMeasureFrame = requestAnimationFrame(() => {
    mobileSongMeasureFrame = requestAnimationFrame(syncMobileSongWrapStates);
  });
}

window.addEventListener("resize", queueMobileSongWrapSync, { passive: true });
if (document.fonts?.ready) {
  document.fonts.ready.then(queueMobileSongWrapSync).catch(() => {});
}

function getVisibleSongs() {
  return songs.filter(song => {
    const matchesFilter =
      currentFilter === "all" ||
      song.recommendedBy === currentFilter;

    const senderName =
      song.senderPerson === "owner"
        ? ownerName()
        : friendName();

    const haystack = [
      song.title,
      song.artist,
      song.note,
      senderName,
      song.recommendedBy
    ].join(" ").toLowerCase();

    return (
      matchesFilter &&
      (!searchTerm || haystack.includes(searchTerm))
    );
  });
}

function renderSongs() {
  songList.innerHTML = "";
  const renderBuffer = document.createDocumentFragment();
  const visible = getVisibleSongs();
  songCount.textContent = `${String(songs.length).padStart(3, "0")} SONG${songs.length === 1 ? "" : "S"}`;
  emptyState.hidden = visible.length > 0;

  visible.forEach(song => {
    const fragment = template.content.cloneNode(true);
    const row = fragment.querySelector(".song-row");
    let titleButton = fragment.querySelector(".song-title");
    const playButton = fragment.querySelector(".play-song");
    let mobileDetailsToggle = fragment.querySelector(".mobile-details-toggle");

    if (mobileSongLayoutQuery.matches) {
      // Keep mobile controls out of focus navigation.
      if (playButton) playButton.tabIndex = -1;
      if (mobileDetailsToggle) mobileDetailsToggle.tabIndex = -1;
    }

    // Use a neutral role=button control to avoid synthetic mobile button states.
    if (mobileSongLayoutQuery.matches && titleButton?.tagName === "BUTTON") {
      const mobileTitle = document.createElement("div");
      mobileTitle.className = titleButton.className;
      mobileTitle.setAttribute("role", "button");
      mobileTitle.setAttribute("tabindex", "-1");
      mobileTitle.setAttribute("aria-label", "Play song");
      while (titleButton.firstChild) mobileTitle.appendChild(titleButton.firstChild);
      titleButton.replaceWith(mobileTitle);
      titleButton = mobileTitle;
    }

    // Apply the same neutral control treatment to NOTE.
    if (mobileSongLayoutQuery.matches && mobileDetailsToggle?.tagName === "BUTTON") {
      const mobileNoteToggle = document.createElement("div");
      mobileNoteToggle.className = mobileDetailsToggle.className;
      mobileNoteToggle.setAttribute("role", "button");
      mobileNoteToggle.setAttribute("tabindex", "-1");
      mobileNoteToggle.setAttribute(
        "aria-expanded",
        mobileDetailsToggle.getAttribute("aria-expanded") || "false"
      );
      mobileNoteToggle.textContent = mobileDetailsToggle.textContent;
      mobileDetailsToggle.replaceWith(mobileNoteToggle);
      mobileDetailsToggle = mobileNoteToggle;
    }

    row.dataset.id = song.id;


    const displayNumber = String(songs.length - songs.indexOf(song)).padStart(3, "0");
    fragment.querySelector(".song-number").textContent = displayNumber;
    fragment.querySelector(".expanded-number").textContent = displayNumber;
    const titleText = titleButton.querySelector(".song-title-text");
    setScriptAwareText(titleText, song.title);

    if (isSongNewForCurrentPerson(song)) {
      row.classList.add("is-new");

      titleText.appendChild(createNewSongMarker(song));
    }

    titleButton.addEventListener("click", event => {
      event.currentTarget.blur?.();
      playSong(song);
    });

    if (titleButton.getAttribute("role") === "button" && titleButton.tabIndex >= 0) {
      titleButton.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        titleButton.blur?.();
        playSong(song);
      });
    }

    // Let the full desktop row start playback, excluding dedicated controls.
    row.addEventListener("click", event => {
      const isDesktopPointer = window.matchMedia(
        "(min-width: 851px) and (hover: hover) and (pointer: fine)"
      ).matches;

      if (!isDesktopPointer) return;
      if (event.target.closest(".delete-song, .mobile-details-toggle")) return;
      if (event.target.closest(".song-title, .play-song")) return;

      playSong(song);
    });
    setScriptAwareText(fragment.querySelector(".song-artist"), song.artist);
    fragment.querySelector(".song-from").textContent =
      senderLabel(song);
    fragment.querySelector(".song-date").textContent = shortDate(song.createdAt);
    fragment.querySelector(".expanded-note").textContent = song.note || "No note. Just trust the song.";

    mobileDetailsToggle.addEventListener("click", event => {
      event.stopPropagation();

      // Preserve the row viewport position while toggling details.
      const beforeTop = mobileSongLayoutQuery.matches
        ? row.getBoundingClientRect().top
        : null;

      const willOpen = !row.classList.contains("mobile-expanded");

      document.querySelectorAll(".song-row.mobile-expanded").forEach(openRow => {
        if (openRow === row) return;
        openRow.classList.remove("mobile-expanded");
        const openToggle = openRow.querySelector(".mobile-details-toggle");
        if (openToggle) {
          openToggle.setAttribute("aria-expanded", "false");
          openToggle.textContent = "NOTE +";
        }
      });

      row.classList.toggle("mobile-expanded", willOpen);
      mobileDetailsToggle.setAttribute("aria-expanded", String(willOpen));
      mobileDetailsToggle.textContent = willOpen ? "NOTE −" : "NOTE +";
      event.currentTarget.blur?.();

      // NOTE does not change title width, so no wrap re-measure is needed.
      if (beforeTop !== null) {
        requestAnimationFrame(() => {
          const afterTop = row.getBoundingClientRect().top;
          const deltaY = afterTop - beforeTop;
          if (Math.abs(deltaY) > 0.5) {
            window.scrollBy(0, deltaY);
          }
          stabilizeMobileArchiveHorizontalPosition();
        });
      } else {
        stabilizeMobileArchiveHorizontalPosition();
      }
    });

    const canYouTube = Boolean(getYouTubeVideoId(song.youtubeUrl));
    const canSpotify = Boolean(getSpotifyEmbedUrl(song.spotifyUrl));

    if (canYouTube || canSpotify) {
      playButton.addEventListener("click", event => {
        event.currentTarget.blur();
        playSong(song);
      });
      setPlayButtonContent(playButton, "idle");
      const preferredUrl = canYouTube ? song.youtubeUrl : song.spotifyUrl;
    } else if (isSongMediaLookupPending(song)) {
      playButton.disabled = true;
      setPlayButtonContent(playButton, "pending");
    } else {
      playButton.disabled = true;
      setPlayButtonContent(playButton, "disabled");
    }

    const deleteButton = fragment.querySelector(".delete-song");
    const canDelete = song.senderPerson === currentPerson;

    if (mobileSongLayoutQuery.matches && deleteButton) deleteButton.tabIndex = -1;
    deleteButton.hidden = !canDelete;

    deleteButton.addEventListener("click", async () => {
      if (!canDelete) return;
      if (!confirm(`Delete “${song.title}” from the archive?`)) return;

      deleteButton.disabled = true;
      deleteButton.textContent = "DELETING…";

      try {
        const { error } = await supabaseClient
          .from("songs")
          .delete()
          .eq("id", song.id);

        if (error) throw error;

        if (currentSongId === song.id) closePlayer();

        songs = songs.filter(item => item.id !== song.id);
        renderSongs();
      } catch (error) {
        console.error("Could not delete song:", error);
        alert(`Could not delete this song: ${error.message}`);
        deleteButton.disabled = false;
        deleteButton.textContent = "DELETE";
      }
    });

    renderBuffer.appendChild(fragment);
  });

  songList.appendChild(renderBuffer);
  queueMobileSongWrapSync();
  syncPlayButtons();
  if (statsView && !statsView.hidden) {
    renderStats();
  }
  syncStatsPlayingState();
  if (wallView && !wallView.hidden) {
    const nextWallSongSignature = wallVisibleSongSignature(getWallSongs());
    if (nextWallSongSignature !== wallRenderedSongSignature) renderWall();
  }

}


function parseSongDate(song) {
  const date = new Date(song?.createdAt);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function chronologicalSongs() {
  return [...songs].sort((a, b) => parseSongDate(a) - parseSongDate(b));
}

function sameCalendarMonth(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth()
  );
}

function ordinal(value) {
  const n = Number(value) || 0;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}TH`;
  const mod10 = n % 10;
  if (mod10 === 1) return `${n}ST`;
  if (mod10 === 2) return `${n}ND`;
  if (mod10 === 3) return `${n}RD`;
  return `${n}TH`;
}

function senderLabel(song) {
  if (song?.senderPerson === "owner") {
    return ownerName();
  }

  if (song?.senderPerson === "friend") {
    return friendName();
  }

  return "UNKNOWN";
}

function normalizeArtist(value) {
  return String(value || "").trim().toLowerCase();
}

function dayDiff(later, earlier) {
  const diff = later.getTime() - earlier.getTime();
  return Math.max(0, Math.round(diff / 86400000));
}

function getSongContext(song) {
  const ordered = chronologicalSongs();
  const index = ordered.findIndex(item => item.id === song.id);
  if (index < 0) return "ONE MORE ENTRY IN THE ARCHIVE.";

  const upToSong = ordered.slice(0, index + 1);
  const beforeSong = ordered.slice(0, index);
  const date = parseSongDate(song);
  const artistKey = normalizeArtist(song.artist);
  const sender = song.recommendedBy;
  const label = senderLabel(song);

  const artistAppearances = upToSong.filter(
    item => normalizeArtist(item.artist) === artistKey
  ).length;

  const totalArtistAppearances = ordered.filter(
    item => normalizeArtist(item.artist) === artistKey
  ).length;

  let streak = 1;
  for (let i = index - 1; i >= 0; i--) {
    if (ordered[i].recommendedBy !== sender) break;
    streak++;
  }

  const monthCount = upToSong.filter(item => {
    return (
      item.recommendedBy === sender &&
      sameCalendarMonth(parseSongDate(item), date)
    );
  }).length;

  const previousSameSender = [...beforeSong]
    .reverse()
    .find(item => item.recommendedBy === sender);

  if (artistAppearances > 1) {
    return `${String(song.artist).toUpperCase()} · ${ordinal(artistAppearances)} APPEARANCE`;
  }

  if (streak >= 3) {
    return `${ordinal(streak)} SONG FROM ${label} IN A ROW`;
  }

  if (monthCount >= 3) {
    return `${ordinal(monthCount)} SONG FROM ${label} THIS MONTH`;
  }

  if (totalArtistAppearances > 1) {
    return `FIRST OF ${totalArtistAppearances} ${String(song.artist).toUpperCase()} SONGS IN THE ARCHIVE`;
  }

  if (previousSameSender) {
    const gap = dayDiff(date, parseSongDate(previousSameSender));
    if (gap >= 2) {
      return `${gap} DAYS SINCE ${label}'S LAST RECOMMENDATION`;
    }
  }

  return `FIRST ${String(song.artist).toUpperCase()} SONG IN THE ARCHIVE`;
}

function getArchiveStats() {
  const ordered = chronologicalSongs();
  const meCount = ordered.filter(song => song.recommendedBy === "me").length;
  const youCount = ordered.filter(song => song.recommendedBy === "friend").length;

  const artistMap = new Map();
  const artistSenders = new Map();

  ordered.forEach(song => {
    const key = normalizeArtist(song.artist);
    if (!key) return;

    const existing = artistMap.get(key) || {
      name: song.artist,
      count: 0,
      me: 0,
      you: 0
    };

    existing.count++;
    if (song.recommendedBy === "me") existing.me++;
    else existing.you++;

    artistMap.set(key, existing);

    const senders = artistSenders.get(key) || new Set();
    senders.add(song.recommendedBy);
    artistSenders.set(key, senders);
  });

  const artists = [...artistMap.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  let longestGap = 0;
  let gapStart = null;
  let gapEnd = null;

  for (let i = 1; i < ordered.length; i++) {
    const diff = dayDiff(parseSongDate(ordered[i]), parseSongDate(ordered[i - 1]));
    if (diff > longestGap) {
      longestGap = diff;
      gapStart = ordered[i - 1];
      gapEnd = ordered[i];
    }
  }

  let longestStreak = 0;
  let longestStreakSender = null;
  let currentStreak = 0;
  let currentSender = null;

  ordered.forEach(song => {
    if (song.recommendedBy === currentSender) {
      currentStreak++;
    } else {
      currentSender = song.recommendedBy;
      currentStreak = 1;
    }

    if (currentStreak > longestStreak) {
      longestStreak = currentStreak;
      longestStreakSender = currentSender;
    }
  });

  const hourCounts = Array(24).fill(0);
  const weekdayCounts = Array(7).fill(0);

  ordered.forEach(song => {
    const date = parseSongDate(song);
    hourCounts[date.getHours()]++;
    weekdayCounts[date.getDay()]++;
  });

  const busiestHour = hourCounts.indexOf(Math.max(...hourCounts));
  const busiestWeekday = weekdayCounts.indexOf(Math.max(...weekdayCounts));

  const sharedArtists = [...artistSenders.entries()]
    .filter(([, senders]) => senders.size > 1)
    .map(([key]) => artistMap.get(key))
    .filter(Boolean)
    .sort((a, b) => b.count - a.count);

  const monthlyMap = new Map();

  ordered.forEach(song => {
    const date = parseSongDate(song);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

    if (!monthlyMap.has(key)) {
      monthlyMap.set(key, {
        key,
        date: new Date(date.getFullYear(), date.getMonth(), 1),
        me: 0,
        you: 0,
        total: 0
      });
    }

    const bucket = monthlyMap.get(key);
    bucket.total++;
    if (song.recommendedBy === "me") bucket.me++;
    else bucket.you++;
  });

  const months = [...monthlyMap.values()].sort((a, b) => a.date - b.date);

  return {
    ordered,
    meCount,
    youCount,
    artists,
    sharedArtists,
    longestGap,
    gapStart,
    gapEnd,
    longestStreak,
    longestStreakSender,
    busiestHour,
    busiestWeekday,
    months
  };
}

function formatHour(hour) {
  const normalized = ((hour % 24) + 24) % 24;
  const suffix = normalized >= 12 ? "PM" : "AM";
  const display = normalized % 12 || 12;
  return `${display} ${suffix}`;
}

function compactMonth(date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    year: "2-digit"
  }).format(date).toUpperCase();
}

function fullMonth(date) {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric"
  }).format(date).toUpperCase();
}

function balanceHeadline(leader, diff) {
  if (!leader) return "PERFECTLY EVEN. SUSPICIOUS.";
  if (diff === 1) return `${leader} IS 1 SONG AHEAD. BARELY.`;
  if (diff <= 3) return `${leader} IS ${diff} SONGS AHEAD. STILL CLOSE.`;
  if (diff <= 6) return `${leader} IS ${diff} SONGS AHEAD. OKAY THEN.`;
  return `${leader} IS ${diff} SONGS AHEAD. CALM DOWN.`;
}

function topArtistComment(count) {
  if (count <= 1) return "No artist has managed to return yet.";
  if (count === 2) return "2 appearances. A second visit felt necessary.";
  if (count <= 4) return `${count} appearances. Apparently once was not enough.`;
  if (count <= 7) return `${count} appearances. This is becoming a pattern.`;
  return `${count} appearances. At this point, this is clearly intentional.`;
}

function streakComment(streak, name) {
  if (streak <= 1) return "Nobody has monopolized the aux yet.";
  if (streak === 2) return `${name} sent two in a row. Fair enough.`;
  if (streak <= 4) return `${name} briefly forgot this was supposed to be a conversation.`;
  if (streak <= 7) return `${name} had several things to say, apparently.`;
  return `${name} was clearly on a roll.`;
}

function monthVolumeComment(total) {
  if (total <= 2) return "A VERY QUIET MONTH.";
  if (total <= 5) return "REASONABLY CIVILIZED.";
  if (total <= 10) return "THINGS ESCALATED.";
  if (total <= 15) return "THIS GOT OUT OF HAND.";
  return "CLEARLY NOTHING ELSE WAS HAPPENING.";
}

function busiestWeekdayFact(weekday) {
  const variants = [
    "SUNDAYS HAVE BECOME A RECOMMENDATION DAY, APPARENTLY.",
    "MONDAYS ARE APPARENTLY FOR SENDING MUSIC.",
    "TUESDAYS SEEM TO COME WITH SONGS.",
    "WEDNESDAYS ARE DOING MORE WORK THAN EXPECTED.",
    "THURSDAYS KEEP GETTING SONGS, APPARENTLY.",
    "FRIDAYS SEEM TO COME WITH SONGS.",
    "SATURDAYS ARE APPARENTLY FOR SENDING MUSIC."
  ];

  return variants[weekday] || variants[0];
}

function busiestHourFact(hour) {
  const time = formatHour(hour);
  if (hour < 6) return `THE ARCHIVE PEAKS AROUND ${time}. VERY NORMAL HOUR FOR THIS.`;
  if (hour < 12) return `THE ARCHIVE PEAKS AROUND ${time}. STARTING EARLY.`;
  if (hour < 18) return `THE ARCHIVE PEAKS AROUND ${time}. FAIRLY CIVILIZED.`;
  return `THE ARCHIVE PEAKS AROUND ${time}. PRIME SONG-SENDING HOURS.`;
}

function sharedArtistFact(sharedArtists) {
  if (!sharedArtists.length) {
    return "NO SHARED ARTISTS YET. IMPRESSIVELY INDEPENDENT TASTE.";
  }

  const artist = String(sharedArtists[0].name).toUpperCase();
  if (sharedArtists.length === 1) {
    return `YOU'VE BOTH SENT ${artist}. A RARE MOMENT OF AGREEMENT.`;
  }
  if (sharedArtists.length <= 3) {
    return `YOU'VE BOTH SENT ${artist}. MAYBE YOUR TASTES OVERLAP AFTER ALL.`;
  }
  return `${artist} IS ONE OF SEVERAL ARTISTS YOU'VE BOTH SENT. PROGRESS.`;
}

function currentMonthFact(month) {
  const label = fullMonth(month.date);
  const total = month.total;
  const songs = `${total} SONG${total === 1 ? "" : "S"}`;

  if (total === 1) return `${label} HAS ${songs} SO FAR. QUIET START.`;
  if (total <= 4) return `${label} HAS ${songs} SO FAR. REASONABLE.`;
  if (total <= 9) return `${label} HAS ${songs} SO FAR. PICKING UP.`;
  if (total <= 14) return `${label} HAS ${songs} SO FAR. BUSY MONTH.`;
  return `${label} HAS ${songs} SO FAR. THIS MONTH GOT AWAY FROM YOU.`;
}

function longestGapFact(days) {
  if (days < 7) return null;
  if (days <= 9) return `THE ARCHIVE ONCE WENT QUIET FOR ${days} DAYS. A LITTLE BREAK.`;
  if (days <= 20) return `THE ARCHIVE ONCE WENT QUIET FOR ${days} DAYS. THAT'S A WHILE.`;
  return `THE ARCHIVE ONCE WENT QUIET FOR ${days} DAYS. YOU DID EVENTUALLY COME BACK.`;
}

function renderStats() {
  if (!statsView) return;

  const stats = getArchiveStats();
  const total = stats.ordered.length;

  statsTotal.textContent = `${String(total).padStart(3, "0")} SONG${total === 1 ? "" : "S"}`;
  statsMeCount.textContent = stats.meCount;
  statsYouCount.textContent = stats.youCount;

  if (!total) {
    statsHeadline.textContent = "NO DATA. HOW PEACEFUL.";
    statsRange.textContent = "ADD SOME SONGS FIRST";
    statsBalanceCopy.textContent = "Nobody is winning because nobody bothered.";
    setScriptAwareText(statsTopArtist, "—");
    statsTopArtistCopy.textContent = "No repeat artists yet.";
    statsLongestGap.textContent = "—";
    statsLongestStreak.textContent = "—";
    statsStreakCopy.textContent = "No monologues detected.";
    balanceTrack.innerHTML = "";
    timelineArt.innerHTML = "";
    monthlyArt.innerHTML = "";
    artistRanking.innerHTML = "";
    weirdFacts.innerHTML = "";
    return;
  }

  const firstDate = parseSongDate(stats.ordered[0]);
  const lastDate = parseSongDate(stats.ordered[stats.ordered.length - 1]);

  statsRange.textContent =
    `${new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(firstDate).toUpperCase()} → ` +
    `${new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(lastDate).toUpperCase()}`;

  const diff = Math.abs(stats.meCount - stats.youCount);
  const displayNames = getDisplayNames();

  const leader =
    stats.meCount === stats.youCount
      ? null
      : stats.meCount > stats.youCount
        ? displayNames.me.toUpperCase()
        : displayNames.you.toUpperCase();

  statsHeadline.textContent = balanceHeadline(leader, diff);

  if (!leader) {
    statsBalanceCopy.textContent = "Nobody gets to act superior.";
  } else if (diff === 1) {
    statsBalanceCopy.textContent = "This could change at any moment.";
  } else {
    const leaderShare = Math.round(Math.max(stats.meCount, stats.youCount) / total * 100);
    statsBalanceCopy.textContent = `${leader} currently has ${leaderShare}% of the archive.`;
  }

  const meShare = total ? stats.meCount / total * 100 : 50;
  const youShare = total ? stats.youCount / total * 100 : 50;

  balanceTrack.innerHTML = `
<button type="button"
  class="balance-segment balance-segment-me"
  data-sender="me"
  data-tooltip="${escapeHtml(displayNames.me)} · ${stats.meCount} SONG${stats.meCount === 1 ? "" : "S"} · ${Math.round(meShare)}% OF THE ARCHIVE"
  style="width:${meShare}%">
  <span>${stats.meCount}</span>
</button>
<button type="button"
  class="balance-segment balance-segment-you"
  data-sender="friend"
  data-tooltip="${escapeHtml(displayNames.you)} · ${stats.youCount} SONG${stats.youCount === 1 ? "" : "S"} · ${Math.round(youShare)}% OF THE ARCHIVE"
  style="width:${youShare}%">
  <span>${stats.youCount}</span>
</button>
  `;

  balanceTrack.querySelectorAll(".balance-segment").forEach(segment => {
    bindTooltip(segment);
  });

  const topArtist = stats.artists[0];

  if (topArtist) {
    setScriptAwareText(statsTopArtist, topArtist.name);
    statsTopArtistCopy.textContent = topArtistComment(topArtist.count);
  }

  statsLongestGap.textContent =
    stats.longestGap > 0
      ? `${stats.longestGap} DAY${stats.longestGap === 1 ? "" : "S"}`
      : "< 1 DAY";

  statsLongestStreak.textContent =
    stats.longestStreak > 0
      ? `${stats.longestStreak} IN A ROW`
      : "—";

  const streakName =
    stats.longestStreakSender === "me" ? displayNames.me : displayNames.you;
  statsStreakCopy.textContent = streakComment(stats.longestStreak, streakName);

  renderTimeline(stats);
  renderMonthly(stats);
  renderArtistRanking(stats);
  renderWeirdFacts(stats);
}

let timelineClusterPopover = null;

function hideTimelineClusterPopover() {
  if (!timelineClusterPopover) return;
  timelineClusterPopover.hidden = true;
  timelineClusterPopover.replaceChildren();
}

function ensureTimelineClusterPopover() {
  if (timelineClusterPopover) return timelineClusterPopover;

  timelineClusterPopover = document.createElement("div");
  timelineClusterPopover.className = "timeline-cluster-popover";
  timelineClusterPopover.hidden = true;
  timelineClusterPopover.setAttribute("role", "dialog");
  timelineClusterPopover.setAttribute("aria-label", "Songs in this recommendation burst");
  document.body.appendChild(timelineClusterPopover);

  document.addEventListener("pointerdown", event => {
    if (timelineClusterPopover.hidden) return;
    if (event.target.closest(".timeline-cluster-popover")) return;
    if (event.target.closest(".timeline-cluster")) return;
    hideTimelineClusterPopover();
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") hideTimelineClusterPopover();
  });

  window.addEventListener("scroll", hideTimelineClusterPopover, { passive: true });

  return timelineClusterPopover;
}

function positionTimelineClusterPopover(anchor) {
  if (!timelineClusterPopover || timelineClusterPopover.hidden) return;

  const anchorRect = anchor.getBoundingClientRect();
  const popoverRect = timelineClusterPopover.getBoundingClientRect();
  const pad = 14;
  const gap = 12;

  let left = anchorRect.left + anchorRect.width / 2 - popoverRect.width / 2;
  left = Math.max(pad, Math.min(left, window.innerWidth - popoverRect.width - pad));

  let top = anchorRect.bottom + gap;
  if (top + popoverRect.height + pad > window.innerHeight) {
    top = anchorRect.top - popoverRect.height - gap;
  }
  top = Math.max(pad, top);

  timelineClusterPopover.style.left = `${Math.round(left)}px`;
  timelineClusterPopover.style.top = `${Math.round(top)}px`;
}

function openTimelineClusterPopover(anchor, cluster) {
  const popover = ensureTimelineClusterPopover();
  popover.replaceChildren();

  const heading = document.createElement("div");
  heading.className = "timeline-cluster-popover-heading";
  heading.textContent = cluster.grouping === "month"
    ? fullMonth(cluster.monthDate)
    : `${cluster.songs.length} SONGS IN THIS BURST`;
  popover.appendChild(heading);

  const meta = document.createElement("div");
  meta.className = "timeline-cluster-popover-meta";
  meta.textContent = cluster.grouping === "month"
    ? `${senderLabel(cluster.songs[0])} · ${cluster.songs.length} SONG${cluster.songs.length === 1 ? "" : "S"}`
    : `${senderLabel(cluster.songs[0])} · ${cluster.songs.length} RECOMMENDATIONS`;
  popover.appendChild(meta);

  const list = document.createElement("div");
  list.className = "timeline-cluster-popover-list";

  cluster.songs.forEach(song => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "timeline-cluster-song";
    button.innerHTML =
      `<strong>${scriptAwareHtml(song.title)}</strong>` +
      `<span>${scriptAwareHtml(song.artist)}</span>` +
      `<small>${shortDate(song.createdAt)}</small>`;
    button.addEventListener("click", event => {
      event.stopPropagation();
      hideTimelineClusterPopover();
      playSong(song);
    });
    list.appendChild(button);
  });

  popover.appendChild(list);
  popover.hidden = false;
  requestAnimationFrame(() => positionTimelineClusterPopover(anchor));
}

function timelineClusterTooltip(cluster) {
  const songLines = cluster.songs
    .map(song =>
      `<span class="timeline-cluster-tooltip-song"><b>${scriptAwareHtml(song.title)}</b> · ${scriptAwareHtml(song.artist)} <i>${shortDate(song.createdAt)}</i></span>`
    )
    .join("");

  const heading = cluster.grouping === "month"
    ? fullMonth(cluster.monthDate)
    : `${cluster.songs.length} SONGS IN THIS BURST`;

  return `<strong>${heading}</strong>` +
    songLines +
    `<small>${escapeHtml(senderLabel(cluster.songs[0]))}</small>`;
}

function bindTimelineClusterPreview(element, cluster) {
  const content = timelineClusterTooltip(cluster);
  element.dataset.statsTooltipTrigger = "true";

  element.addEventListener("pointerenter", event => {
    if (statsUseTapInteraction()) return;
    showStatsTooltip(event, content);
  });

  element.addEventListener("pointermove", event => {
    if (statsUseTapInteraction()) return;
    positionStatsTooltip(event);
  });

  element.addEventListener("pointerleave", () => {
    if (statsUseTapInteraction()) return;
    hideStatsTooltip();
  });

  element.addEventListener("click", event => {
    // Coarse pointers use tap inspection; desktop remains hover-only.
    if (!statsUseTapInteraction()) return;

    event.preventDefault();
    event.stopPropagation();
    hideStatsTooltip();
    openTimelineClusterPopover(element, cluster);
  });
}

function timelineMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function timelineMonthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function timelineMonthsBetween(startDate, endDate) {
  const months = [];
  let cursor = timelineMonthStart(startDate);
  const finalMonth = timelineMonthStart(endDate);

  while (cursor <= finalMonth) {
    months.push(new Date(cursor));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  return months;
}

function timelineMonthAxisLabel(date, includeYear = false) {
  const month = new Intl.DateTimeFormat("en", { month: "short" })
    .format(date)
    .toUpperCase();

  if (!includeYear) return month;
  return `${month} '${String(date.getFullYear()).slice(-2)}`;
}

function buildDesktopTimelineClusters(ordered, start, span, trackWidth) {
  const thresholdPx = 22;
  const lanes = { me: [], friend: [] };

  ordered.forEach((song, index) => {
    const time = parseSongDate(song).getTime();
    const ratio = Math.max(0, Math.min(1, (time - start) / span));
    const item = { song, index, ratio, x: ratio * trackWidth };
    lanes[song.recommendedBy === "me" ? "me" : "friend"].push(item);
  });

  const clusters = [];

  Object.entries(lanes).forEach(([lane, items]) => {
    if (!items.length) return;

    let current = [items[0]];

    const commit = () => {
      if (!current.length) return;
      const avgRatio = current.reduce((sum, item) => sum + item.ratio, 0) / current.length;
      clusters.push({
        lane,
        ratio: avgRatio,
        firstIndex: current[0].index,
        songs: current.map(item => item.song),
        grouping: "collision"
      });
    };

    for (let i = 1; i < items.length; i++) {
      const item = items[i];
      const previous = current[current.length - 1];

      if (item.x - previous.x <= thresholdPx) {
        current.push(item);
      } else {
        commit();
        current = [item];
      }
    }

    commit();
  });

  return {
    clusters: clusters.sort((a, b) => a.firstIndex - b.firstIndex),
    months: []
  };
}

function buildMobileSequenceTimeline(ordered, viewportWidth) {
  const spacing = 34;
  const edgePadding = 24;
  const naturalWidth = edgePadding * 2 + Math.max(0, ordered.length - 1) * spacing;
  const trackMinWidth = Math.max(viewportWidth, naturalWidth, 260);
  const step = ordered.length > 1
    ? naturalWidth <= trackMinWidth
      ? (trackMinWidth - edgePadding * 2) / (ordered.length - 1)
      : spacing
    : 0;
  const monthMarkers = [];
  const seenMonths = new Set();

  const clusters = ordered.map((song, index) => {
    const date = parseSongDate(song);
    const monthKey = timelineMonthKey(date);
    const x = ordered.length === 1
      ? trackMinWidth / 2
      : edgePadding + index * step;

    if (!seenMonths.has(monthKey)) {
      seenMonths.add(monthKey);
      monthMarkers.push({
        date: timelineMonthStart(date),
        x
      });
    }

    return {
      lane: song.recommendedBy === "me" ? "me" : "friend",
      firstIndex: index,
      songs: [song],
      x,
      grouping: "sequence"
    };
  });

  return {
    clusters,
    monthMarkers,
    trackMinWidth
  };
}

function buildTimelineClusters(ordered, start, span, trackWidth) {
  // Keep one chronological point per song at every viewport size.
  return buildMobileSequenceTimeline(ordered, trackWidth);
}

function renderMobileTimelineSequenceAxis(track, monthMarkers) {
  if (!monthMarkers.length) return;

  const axis = document.createElement("div");
  axis.className = "timeline-mobile-sequence-axis";
  const firstYear = monthMarkers[0].date.getFullYear();
  const lastYear = monthMarkers[monthMarkers.length - 1].date.getFullYear();
  const crossesYears = firstYear !== lastYear;

  monthMarkers.forEach((marker, index) => {
    const tick = document.createElement("span");
    tick.className = "timeline-mobile-sequence-tick";
    tick.style.left = `${marker.x}px`;

    const label = document.createElement("span");
    label.className = "timeline-mobile-sequence-label";
    label.textContent = timelineMonthAxisLabel(
      marker.date,
      crossesYears || index === 0
    );

    tick.appendChild(label);
    axis.appendChild(tick);
  });

  track.appendChild(axis);
}

function bindTimelineTapEffect(dot) {
  if (!dot) return;

  let startX = 0;
  let startY = 0;
  let moved = false;
  const cancelDistance = 10;

  dot.addEventListener("pointerdown", event => {
    if (!statsUseTapInteraction()) return;
    if (event.pointerType === "mouse") return;

    // Track movement only; press-and-hold has no visual state.
    startX = event.clientX;
    startY = event.clientY;
    moved = false;
  });

  dot.addEventListener("pointermove", event => {
    if (!statsUseTapInteraction()) return;
    if (event.pointerType === "mouse") return;

    const distance = Math.hypot(
      event.clientX - startX,
      event.clientY - startY
    );

    if (distance > cancelDistance) moved = true;
  });

  dot.addEventListener("pointerup", event => {
    if (!statsUseTapInteraction()) return;
    if (event.pointerType === "mouse" || moved) return;

    // Persist the mobile selection after a completed tap.
    document.querySelectorAll(".timeline-dot.is-selected").forEach(otherDot => {
      if (otherDot !== dot) otherDot.classList.remove("is-selected");
    });
    dot.classList.add("is-selected");
  });

  dot.addEventListener("pointercancel", () => {
    moved = true;
  });
}

function renderTimeline(stats) {
  hideTimelineClusterPopover();
  timelineArt.innerHTML = "";
  const sequenceTimeline = true;
  timelineArt.classList.toggle("timeline-art-mobile-sequence", sequenceTimeline);

  if (!stats.ordered.length) return;

  const start = parseSongDate(stats.ordered[0]).getTime();
  const end = parseSongDate(stats.ordered[stats.ordered.length - 1]).getTime();
  const span = Math.max(1, end - start);

  const lanes = document.createElement("div");
  lanes.className = "timeline-lane-labels";
  const displayNames = getDisplayNames();
  lanes.innerHTML = `
<span class="timeline-lane-label timeline-lane-label-me">${escapeHtml(displayNames.me)}</span>
<span class="timeline-lane-label timeline-lane-label-you">${escapeHtml(displayNames.you)}</span>
  `;

  const track = document.createElement("div");
  track.className = "timeline-track";

  const axis = document.createElement("div");
  axis.className = "timeline-axis";
  track.appendChild(axis);

  timelineArt.appendChild(lanes);

  let trackViewport = null;
  if (sequenceTimeline) {
    trackViewport = document.createElement("div");
    trackViewport.className = "timeline-track-viewport";
    trackViewport.appendChild(track);
    timelineArt.appendChild(trackViewport);

    const laneLabelWidth = Math.ceil(
      Math.max(
        0,
        ...Array.from(lanes.querySelectorAll(".timeline-lane-label"), label =>
          label.getBoundingClientRect().width
        )
      ) + 10
    );

    timelineArt.style.setProperty(
      "--timeline-lane-width",
      `${laneLabelWidth}px`
    );
  } else {
    timelineArt.style.removeProperty("--timeline-lane-width");
    timelineArt.appendChild(track);
  }

  const trackWidth = Math.max(1, track.getBoundingClientRect().width);
  const timelineLayout = buildTimelineClusters(
    stats.ordered,
    start,
    span,
    trackWidth
  );
  const clusters = timelineLayout.clusters;

  if (sequenceTimeline) {
    track.style.minWidth = `${timelineLayout.trackMinWidth}px`;
    renderMobileTimelineSequenceAxis(track, timelineLayout.monthMarkers);
  }

  clusters.forEach(cluster => {
    const isCluster = cluster.songs.length > 1;
    const firstSong = cluster.songs[0];
    const dot = document.createElement("button");
    dot.type = "button";
    const clusterSizeClass = !isCluster
      ? ""
      : " timeline-cluster timeline-cluster-counted";

    dot.className =
      `timeline-dot ${cluster.lane === "me" ? "timeline-dot-me" : "timeline-dot-you"}` +
      clusterSizeClass;

    dot.style.left = sequenceTimeline
      ? `${cluster.x}px`
      : `${cluster.ratio * 100}%`;
    dot.style.setProperty("--dot-index", cluster.firstIndex);
    dot.dataset.songIds = cluster.songs.map(song => song.id).join(",");

    if (!isCluster) {
      dot.dataset.songId = firstSong.id;
      dot.dataset.tooltip =
        `<strong>${scriptAwareHtml(firstSong.title)}</strong>` +
        `<span>${scriptAwareHtml(firstSong.artist)}</span>` +
        `<small>${escapeHtml(senderLabel(firstSong))} · ${shortDate(firstSong.createdAt)}</small>`;
      bindTooltip(dot, true);
    } else {
      dot.setAttribute(
        "aria-label",
        `${cluster.songs.length} songs from ${senderLabel(firstSong)} in one recommendation burst`
      );

      const count = document.createElement("span");
      count.className = "timeline-cluster-count";
      count.textContent = String(cluster.songs.length);
      count.setAttribute("aria-hidden", "true");
      dot.appendChild(count);

      bindTimelineClusterPreview(dot, cluster);
    }

    const nowPlaying = document.createElement("span");
    nowPlaying.className = "timeline-now-playing";
    nowPlaying.setAttribute("aria-hidden", "true");
    nowPlaying.innerHTML = `<span></span><span></span><span></span>`;
    dot.appendChild(nowPlaying);
    bindTimelineTapEffect(dot);

    track.appendChild(dot);
  });

  timelineStart.textContent = shortDate(stats.ordered[0].createdAt);
  timelineEnd.textContent = shortDate(stats.ordered[stats.ordered.length - 1].createdAt);

  syncStatsPlayingState();
}

function renderMonthly(stats) {
  monthlyArt.innerHTML = "";

  if (!stats.months.length) return;

  const maxTotal = Math.max(...stats.months.map(month => month.total), 1);

  stats.months.forEach(month => {
    const column = document.createElement("button");
    column.type = "button";
    column.className = "month-column";

    const bars = document.createElement("div");
    bars.className = "month-bars";

    const meHeight = month.me ? Math.max(7, month.me / maxTotal * 100) : 0;
    const youHeight = month.you ? Math.max(7, month.you / maxTotal * 100) : 0;

    bars.innerHTML = `
  <div class="month-bar month-bar-me" style="height:${meHeight}%">
    <span>${month.me || ""}</span>
  </div>
  <div class="month-bar month-bar-you" style="height:${youHeight}%">
    <span>${month.you || ""}</span>
  </div>
`;

    const label = document.createElement("div");
    label.className = "month-label";
    label.innerHTML =
      `<span>${compactMonth(month.date)}</span>` +
      `<strong>${month.total}</strong>`;

    column.dataset.tooltip =
      `<strong>${fullMonth(month.date)}</strong>` +
      `<span>${month.total} SONG${month.total === 1 ? "" : "S"} TOTAL · ${monthVolumeComment(month.total)}</span>` +
      `<small>${escapeHtml(getDisplayNames().me)} ${month.me} · ${escapeHtml(getDisplayNames().you)} ${month.you}</small>`;

    bindTooltip(column, true);

    column.appendChild(bars);
    column.appendChild(label);
    monthlyArt.appendChild(column);
  });
}

function renderArtistRanking(stats) {
  artistRanking.innerHTML = "";

  const artists = stats.artists.slice(0, 8);
  const maxCount = artists[0]?.count || 1;

  artists.forEach((artist, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "artist-rank-row";

    const scale = 1 + (artist.count / maxCount) * 1.15;

    row.innerHTML = `
  <span class="artist-rank-number">${String(index + 1).padStart(2, "0")}</span>
  <span class="artist-rank-name" style="--artist-scale:${scale}">${scriptAwareHtml(artist.name)}</span>
  <span class="artist-rank-split">${escapeHtml(getDisplayNames().me)} ${artist.me} · ${escapeHtml(getDisplayNames().you)} ${artist.you}</span>
  <span class="artist-rank-count">${artist.count}×</span>
`;

    row.dataset.tooltip =
      `<strong>${escapeHtml(artist.name)}</strong>` +
      `<span>${artist.count} APPEARANCE${artist.count === 1 ? "" : "S"}</span>` +
      `<small>${escapeHtml(getDisplayNames().me)} ${artist.me} · ${escapeHtml(getDisplayNames().you)} ${artist.you}</small>`;

    bindTooltip(row, true);

    artistRanking.appendChild(row);
  });
}

function renderWeirdFacts(stats) {
  weirdFacts.innerHTML = "";

  const total = stats.ordered.length;
  const facts = [];

  if (total) {
    facts.push(busiestWeekdayFact(stats.busiestWeekday));
    facts.push(busiestHourFact(stats.busiestHour));
  }

  facts.push(sharedArtistFact(stats.sharedArtists));

  const currentMonth = stats.months[stats.months.length - 1];
  if (currentMonth) {
    facts.push(currentMonthFact(currentMonth));
  }

  const gapFact = longestGapFact(stats.longestGap);
  if (gapFact) {
    facts.push(gapFact);
  }

  facts.slice(0, 5).forEach((fact, index) => {
    const row = document.createElement("div");
    row.className = "weird-fact";

    const number = document.createElement("span");
    number.textContent = String(index + 1).padStart(2, "0");

    const copy = document.createElement("p");
    copy.textContent = fact;

    row.append(number, copy);
    weirdFacts.appendChild(row);
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function positionStatsTooltip(event) {
  if (!statsTooltip || statsTooltip.hidden) return;

  const pad = 16;
  const rect = statsTooltip.getBoundingClientRect();
  const hasDesktopCustomCursor = window.matchMedia(
    "(hover: hover) and (pointer: fine)"
  ).matches;

  const rightGap = hasDesktopCustomCursor ? 108 : 14;
  const leftGap = hasDesktopCustomCursor ? 24 : 14;
  const verticalGap = hasDesktopCustomCursor ? 10 : 14;

  let x = event.clientX + rightGap;
  let y = event.clientY + verticalGap;

  if (x + rect.width + pad > window.innerWidth) {
    x = event.clientX - rect.width - leftGap;
  }

  if (y + rect.height + pad > window.innerHeight) {
    y = event.clientY - rect.height - verticalGap;
  }

  statsTooltip.style.left = `${Math.max(pad, x)}px`;
  statsTooltip.style.top = `${Math.max(pad, y)}px`;
}

function showStatsTooltip(event, content) {
  if (!statsTooltip || !content) return;

  statsTooltip.innerHTML = content;
  statsTooltip.hidden = false;
  requestAnimationFrame(() => positionStatsTooltip(event));
}

function hideStatsTooltip() {
  if (!statsTooltip) return;
  statsTooltip.hidden = true;
}

function statsUseTapInteraction() {
  return window.matchMedia(
    "(max-width: 768px), (hover: none), (pointer: coarse)"
  ).matches;
}

let statsTooltipTriggerCounter = 0;

function bindTooltip(element, allowHtml = false) {
  if (!element) return;

  const triggerId = `stats-tooltip-${++statsTooltipTriggerCounter}`;
  element.dataset.statsTooltipTrigger = "true";
  element.dataset.statsTooltipTriggerId = triggerId;

  const tooltipContent = () => {
    const content = element.dataset.tooltip;
    if (!content) return "";
    return allowHtml ? content : escapeHtml(content);
  };

  element.addEventListener("pointerenter", event => {
    if (statsUseTapInteraction()) return;
    const content = tooltipContent();
    if (!content) return;
    showStatsTooltip(event, content);
  });

  element.addEventListener("pointermove", event => {
    if (statsUseTapInteraction()) return;
    positionStatsTooltip(event);
  });

  element.addEventListener("pointerleave", () => {
    if (statsUseTapInteraction()) return;
    hideStatsTooltip();
  });

  element.addEventListener("click", event => {
    if (!statsUseTapInteraction()) return;

    event.preventDefault();
    event.stopPropagation();

    const content = tooltipContent();
    if (!content) return;

    const sameTrigger =
      !statsTooltip.hidden &&
      statsTooltip.dataset.triggerId === triggerId;

    if (sameTrigger) {
      // Re-tapping a selected timeline dot keeps its tooltip open.
      if (element.classList.contains("timeline-dot") && element.classList.contains("is-selected")) {
        showStatsTooltip(event, content);
        statsTooltip.dataset.triggerId = triggerId;
        return;
      }

      hideStatsTooltip();
      return;
    }

    showStatsTooltip(event, content);
    statsTooltip.dataset.triggerId = triggerId;
  });

  element.addEventListener("blur", () => {
    if (!statsUseTapInteraction()) hideStatsTooltip();
  });
}

document.addEventListener("click", event => {
  if (!statsUseTapInteraction()) return;
  if (event.target.closest('[data-stats-tooltip-trigger="true"]')) return;

  // Clear persistent timeline selection only from an empty-space tap.
  document.querySelectorAll(".timeline-dot.is-selected").forEach(dot => {
    dot.classList.remove("is-selected");
  });

  if (statsTooltip && !statsTooltip.hidden) hideStatsTooltip();
});

function syncStatsPlayingState() {
  document.querySelectorAll(".timeline-dot").forEach(dot => {
    const songIds = (dot.dataset.songIds || dot.dataset.songId || "")
      .split(",")
      .filter(Boolean);
    const isCurrent = Boolean(currentSongId) && songIds.includes(currentSongId);

    dot.classList.toggle("is-playing", isCurrent);

    if (isCurrent) {
      dot.setAttribute(
        "aria-label",
        songIds.length > 1 ? "Now playing a song in this burst" : "Now playing"
      );
    } else if (!dot.classList.contains("timeline-cluster")) {
      dot.removeAttribute("aria-label");
    }
  });

  document.querySelectorAll(".song-row").forEach(row => {
    row.classList.toggle(
      "is-playing",
      Boolean(currentSongId) && row.dataset.id === currentSongId
    );
  });
}

let timelineResizeTimer = 0;

window.addEventListener("resize", () => {
  refreshPeopleLabels();
  syncPixelToolButtons();
  syncPixelToolHint();

  clearTimeout(timelineResizeTimer);
  timelineResizeTimer = window.setTimeout(() => {
    if (statsView && !statsView.hidden && songs.length) {
      renderTimeline(getArchiveStats());
    }
  }, 120);
});

function safeLink(url) {
  if (!url) return "#";
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "#";
  } catch {
    return "#";
  }
}

function shortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit"
  }).format(date);
}

function longDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short"
  }).format(date).toUpperCase();
}

function initials(title, artist) {
  return `${title.trim().charAt(0)}${artist.trim().charAt(0)}`.toUpperCase();
}

bootstrapSupabase();


(() => {
  const root = document.documentElement;
  const songList = document.querySelector("#songList");

  function syncDateColumnWidth() {
    const dates = [...document.querySelectorAll(".song-date")];
    if (!dates.length) return;

    let maxWidth = 0;

    dates.forEach(date => {
      const oldWidth = date.style.width;
      date.style.width = "max-content";
      maxWidth = Math.max(maxWidth, date.getBoundingClientRect().width);
      date.style.width = oldWidth;
    });

    if (maxWidth > 0) {
      root.style.setProperty(
        "--date-col-width",
        `${Math.ceil(maxWidth)}px`
      );
    }
  }

  if (songList) {
    const observer = new MutationObserver(() => {
      requestAnimationFrame(syncDateColumnWidth);
    });

    observer.observe(songList, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  window.addEventListener("resize", syncDateColumnWidth);

  if (document.fonts?.ready) {
    document.fonts.ready.then(syncDateColumnWidth);
  }

  requestAnimationFrame(syncDateColumnWidth);
})();
(() => {
  const cursor = document.querySelector("#customCursor");
  if (!cursor) return;

  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const root = document.documentElement;

  const interactiveSelector = [
    'a[href]',
    'button:not(:disabled)',
    'summary',
    'select:not(:disabled)',
    'input:not(:disabled)',
    'textarea:not(:disabled)',
    '[role="button"]:not([aria-disabled="true"])',
    '[role="link"]',
    '[tabindex]:not([tabindex="-1"])',
    '[data-stats-tooltip-trigger="true"]',
    '[data-tooltip]',
    'label[for]',
    '.text-button',
    '.filter',
    '.delete-song',
    '.giant-add',
    '.song-title',
    '.song-row',
    '.player-close',
    '.source-tab',
    '.mini-action',
    '.view-button',
    '.balance-segment',
    '.timeline-dot',
    '.month-column',
    '.artist-rank-row',
    '.nav-action',
    '.pixel-board-clear',
    '.pixel-tool-button',
    '.pixel-swatch',
    '.pixel-custom-color',
    '.import-label',
    '.access-code-toggle',
    '#addSongBottom',
    '#closeDialog'
  ].join(',');

  let pointerX = -140;
  let pointerY = -140;
  let frame = 0;
  let pressed = false;
  let pressStartedAt = 0;
  let releaseTimer = 0;
  let lastTarget = null;
  const MIN_CLICK_STATE_MS = 110;

  function drawCursor() {
    frame = 0;
    cursor.style.transform =
      `translate3d(${Math.round(pointerX)}px, ${Math.round(pointerY)}px, 0)`;
  }

  function scheduleCursorDraw() {
    if (!frame) frame = requestAnimationFrame(drawCursor);
  }

  function targetIsInteractive(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest(interactiveSelector));
  }

  function targetUsesNativeCursor(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest('.media-embed'));
  }

  function hideCustomCursorForMedia() {
    cursor.classList.remove('is-visible');
    pressed = false;
    clearTimeout(releaseTimer);
  }

  function syncCursorState(target = lastTarget) {
    if (!finePointer.matches) return;
    lastTarget = target;

    if (pressed) {
      cursor.dataset.state = 'click';
    } else if (targetIsInteractive(target)) {
      cursor.dataset.state = 'hover';
    } else {
      cursor.dataset.state = 'default';
    }
  }

  function enableCustomCursor() {
    if (!finePointer.matches) {
      root.classList.remove('custom-cursor-active');
      cursor.classList.remove('is-visible');
      pressed = false;
      return;
    }
    root.classList.add('custom-cursor-active');
  }

  function finishPress(target) {
    const elapsed = performance.now() - pressStartedAt;
    const remaining = Math.max(0, MIN_CLICK_STATE_MS - elapsed);

    clearTimeout(releaseTimer);
    releaseTimer = window.setTimeout(() => {
      pressed = false;
      syncCursorState(target || lastTarget);
    }, remaining);
  }

  document.addEventListener('pointermove', event => {
    if (!finePointer.matches || event.pointerType === 'touch') return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    lastTarget = event.target;

    if (targetUsesNativeCursor(event.target)) {
      hideCustomCursorForMedia();
      return;
    }

    cursor.classList.add('is-visible');
    syncCursorState(event.target);
    scheduleCursorDraw();
  }, { passive: true, capture: true });

  document.addEventListener('pointerdown', event => {
    if (!finePointer.matches || event.pointerType === 'touch') return;

    if (targetUsesNativeCursor(event.target)) {
      lastTarget = event.target;
      hideCustomCursorForMedia();
      return;
    }

    clearTimeout(releaseTimer);
    pressed = true;
    pressStartedAt = performance.now();
    lastTarget = event.target;
    cursor.classList.add('is-visible');
    syncCursorState(event.target);
  }, { passive: true, capture: true });

  document.addEventListener('pointerup', event => {
    if (!finePointer.matches || event.pointerType === 'touch') return;
    lastTarget = event.target;
    finishPress(event.target);
  }, { passive: true, capture: true });

  document.addEventListener('pointercancel', event => {
    if (!finePointer.matches || event.pointerType === 'touch') return;
    finishPress(event.target);
  }, { passive: true, capture: true });

  document.addEventListener('pointerover', event => {
    if (!finePointer.matches || event.pointerType === 'touch') return;
    lastTarget = event.target;

    if (targetUsesNativeCursor(event.target)) {
      hideCustomCursorForMedia();
      return;
    }

    cursor.classList.add('is-visible');
    syncCursorState(event.target);
  }, { passive: true, capture: true });

  mediaEmbed?.addEventListener('mouseenter', () => {
    if (!finePointer.matches) return;
    hideCustomCursorForMedia();
  });

  mediaEmbed?.addEventListener('mouseleave', event => {
    if (!finePointer.matches) return;
    lastTarget = event.relatedTarget;
    cursor.classList.add('is-visible');
    syncCursorState(event.relatedTarget);
  });

  document.addEventListener('mouseleave', () => {
    cursor.classList.remove('is-visible');
    pressed = false;
    clearTimeout(releaseTimer);
  });

  window.addEventListener('blur', () => {
    cursor.classList.remove('is-visible');
    pressed = false;
    clearTimeout(releaseTimer);
  });

  finePointer.addEventListener?.('change', enableCustomCursor);
  enableCustomCursor();
})();
