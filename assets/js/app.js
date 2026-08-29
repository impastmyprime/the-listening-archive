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

const PIXEL_COLS = 40;
const PIXEL_ROWS = 20;
const PIXEL_CELL_SIZE = 8;
const PIXEL_SYNC_DELAY_MS = 120;
const PIXEL_SYNC_RETRY_MS = 800;
const pixelState = Array.from({ length: PIXEL_COLS * PIXEL_ROWS }, () => ({ filled: false, color: "#E7FE00" }));
const pendingPixelWrites = new Map();

let pixelBoardReady = false;
let pixelFlushTimer = null;
let pixelFlushInFlight = false;
let pixelDrawing = false;
let pixelActiveTool = "brush";
let pixelActiveColor = "#E7FE00";
let pixelLastPaintKey = null;
let pixelLastPaintPoint = null;
let pixelRenderQueued = false;
let pixelTouchDrawingArmed = false;
let pixelTouchArmTimer = null;

const PIXEL_TOUCH_ARM_TIMEOUT_MS = 7000;

let currentFilter = "all";
let searchTerm = "";
let currentSongId = null;
let currentSource = null;

const AUTO_NEXT_STORAGE = "songs-we-sent-auto-next-v1";

// Auto Next always starts enabled on every fresh page load.
// The control can still be toggled OFF for the current page session.
let autoNextEnabled = true;
try {
  localStorage.setItem(AUTO_NEXT_STORAGE, "true");
} catch { }
let youtubePlayer = null;
let youtubeApiPromise = null;
let youtubeMountToken = 0;
let youtubePlaybackMonitor = null;
let youtubePlaybackWorker = null;
let autoNextTransitionLock = false;
let youtubeAutoQueue = [];

const songList = document.querySelector("#songList");
const songCount = document.querySelector("#songCount");
const emptyState = document.querySelector("#emptyState");
const searchInput = document.querySelector("#searchInput");
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
        pixel?.color || "#E7FE00";

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
    color: color || "#E7FE00"
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
    color: pixel.color || "#E7FE00",
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
          color: pixel.color || "#E7FE00"
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

function setPixelColor(color) {
  pixelActiveColor = String(color || "#E7FE00").toUpperCase();

  pixelSwatches
    .querySelectorAll(".pixel-swatch")
    .forEach(button => {
      const active =
        String(button.dataset.color || "").toUpperCase() ===
        pixelActiveColor;

      button.classList.toggle("is-active", active);
      button.setAttribute(
        "aria-pressed",
        active ? "true" : "false"
      );
    });

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
    String(a?.color || "#E7FE00").toUpperCase() ===
    String(b?.color || "#E7FE00").toUpperCase()
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
  const incomingColor = row.color || "#E7FE00";

  if (
    row.updated_by === currentUser?.id &&
    Boolean(localPixel?.filled) === incomingFilled &&
    String(localPixel?.color || "#E7FE00").toUpperCase() ===
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
    pixelState[i] = { filled: false, color: "#E7FE00" };
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
        color: row.color || "#E7FE00"
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
    button.dataset.color || "#E7FE00"
  );
  armPixelTouchDrawing();
});



pixelCustomColor.addEventListener("input", event => {
  setPixelColor(event.target.value);
  armPixelTouchDrawing();
});

setPixelTool("brush");
setPixelColor("#E7FE00");


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
          "#E7FE00"
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

async function loadSongReadState() {
  songReadStateReady = false;
  readSongIdsForCurrentPerson = new Set();
  pendingSongReadIds.clear();

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
    row.classList.remove("is-new");
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
    note: String(row.note || ""),
    senderPerson,
    createdBy: row.created_by || null,
    recommendedBy: senderPerson === currentPerson ? "me" : "friend",
    createdAt: row.created_at || new Date().toISOString()
  };
}

async function loadRemoteSongs({ quiet = false } = {}) {
  const { data, error } = await supabaseClient
    .from("songs")
    .select(
      "id,title,artist,youtube_url,spotify_url,note,sender_person,created_by,created_at"
    )
    .order("created_at", { ascending: false });

  if (error) {
    if (!quiet) {
      console.error("Could not load songs:", error);
      alert(`Could not load the shared archive: ${error.message}`);
    }
    throw error;
  }

  songs = (data || [])
    .map(mapRemoteSong)
    .sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  renderSongs();
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

  if (!ownerName() || !friendName()) {
    throw new Error("ARCHIVE DISPLAY NAMES ARE MISSING");
  }

  currentUserName =
    person === "owner"
      ? ownerName()
      : friendName();

  currentSenderIdentity.textContent =
    currentUserName;

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

  if (["http:", "https:"].includes(window.location.protocol)) {
    ensureYouTubeApi().catch(() => {});
  }

  await loadSongReadState();
  await loadRemoteSongs();

  await loadPixelBoard().catch(error => {
    console.error("Pixel board initialization failed:", error);
    setPixelBoardStatus("SETUP REQUIRED", "error");
  });

  setupRealtime();
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
      await unlockArchive(membership.person, membership.people);
      return;
    }

    document.body.classList.add("access-checking");
    document.body.classList.remove("access-granted");

    accessCodeInput.disabled = false;
    accessSubmit.disabled = false;
    setAccessStatus("ENTER YOUR PRIVATE ACCESS CODE");
    accessCodeInput.focus();
  } catch (error) {
    console.error("Supabase bootstrap failed:", error);
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
  if (document.visibilityState !== "visible") return;

  if (currentSource === "youtube" && youtubePlayer) {
    syncYouTubeQueueSong(youtubePlayer);
  }

  if (!currentPerson) return;

  loadSongReadState()
    .then(() => loadRemoteSongs({ quiet: true }))
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

function syncPlaybackPreferenceUi() {
  autoNextToggle.textContent = autoNextEnabled ? "AUTO NEXT ON" : "AUTO NEXT OFF";
  autoNextToggle.setAttribute("aria-pressed", String(autoNextEnabled));
}

autoNextToggle.addEventListener("click", () => {
  autoNextEnabled = !autoNextEnabled;
  try {
    localStorage.setItem(AUTO_NEXT_STORAGE, String(autoNextEnabled));
  } catch { }
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
    playerStatus.textContent = "NOW PLAYING · YOUTUBE";
    renderSourceTabs(song, "youtube");
    void markSongRead(song);
    syncPlayButtons();
    syncStatsPlayingState();
  }

  return queueItem;
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

    // Keep the existing YouTube player session during auto-next.
    // Recreating the iframe can trigger background autoplay restrictions.
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
      playerStatus.textContent = "NOW PLAYING · YOUTUBE";
      void markSongRead(nextSong);
      syncPlayButtons();
      syncStatsPlayingState();

      try {
        youtubePlayer.loadVideoById(nextVideoId);
      } catch {
        playSong(nextSong, preferredSource);
      } finally {
        setTimeout(() => {
          autoNextTransitionLock = false;
        }, 500);
      }
      return;
    }
  }

  if (preferredSource) {
    // playSong() is synchronous; release the guard shortly after switching
    // tracks so duplicate ENDED events cannot immediately skip another song.
    playSong(nextSong, preferredSource);
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
      autoplay: 1,
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
            event.target.playVideo();
          } catch { }

          clearInterval(youtubePlaybackMonitor);
          youtubePlaybackWorker?.terminate?.();

          // Use a worker clock so background tabs are less affected by normal
          // window timer throttling. The worker only signals a check; the
          // YouTube API call still runs on the main thread.
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
                  playNextSong();
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
                  playNextSong();
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

          // Always handle next track ourselves instead of relying on
          // YouTube playlist state. This keeps newly added songs available
          // and prevents failures when the browser tab is backgrounded.
          const activeItem = syncYouTubeQueueSong(event.target);

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

function setView(view) {
  const isStats = view === "stats";
  hideStatsTooltip();

  archiveView.hidden = isStats;
  statsView.hidden = !isStats;
  archiveTools.hidden = isStats;

  viewButtons.forEach(button => {
    button.classList.toggle("active", button.dataset.view === view);
  });

  document.body.classList.toggle("stats-mode", isStats);

  if (isStats) {
    renderStats();
    requestAnimationFrame(() => {
      statsView.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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

form.addEventListener("submit", async event => {
  event.preventDefault();

  if (!currentPerson || !currentUser) {
    alert("Your access session is not ready yet.");
    return;
  }

  const data = new FormData(form);
  const title = String(data.get("title") || "").trim();
  const artist = String(data.get("artist") || "").trim();
  let youtubeUrl = String(data.get("youtubeUrl") || "").trim();
  const spotifyUrl = String(data.get("spotifyUrl") || "").trim();
  const note = String(data.get("note") || "").trim();

  if (!title || !artist) return;

  submitSongButton.disabled = true;
  submitSongButton.textContent = "ADDING…";

  try {
    if (!youtubeUrl) {
      submitSongButton.textContent = "FINDING YOUTUBE…";

      setYouTubeAutoStatus(
        `SEARCHING YOUTUBE · ${artist.toUpperCase()} — ${title.toUpperCase()}`
      );

      try {
        const match = await findYouTubeSong(title, artist);

        if (match?.url) {
          youtubeUrl = match.url;
          youtubeUrlInput.value = youtubeUrl;

          setYouTubeAutoStatus(
            `FOUND · ${String(match.channel || "YOUTUBE").toUpperCase()} · ${String(match.title || title).toUpperCase()}`,
            "found"
          );
        } else {
          setYouTubeAutoStatus(
            "NO EMBEDDABLE YOUTUBE MATCH FOUND · SONG WILL STILL BE SAVED",
            "error"
          );
        }
      } catch (error) {
        console.error("YouTube auto-fetch failed:", error);
        setYouTubeAutoStatus(
          formatYouTubeApiError(error),
          "error"
        );
      }
    } else {
      setYouTubeAutoStatus("MANUAL YOUTUBE LINK USED", "found");
    }

    submitSongButton.textContent = "SAVING…";

    const { data: inserted, error } = await supabaseClient
      .from("songs")
      .insert({
        title,
        artist,
        youtube_url: youtubeUrl || null,
        spotify_url: spotifyUrl || null,
        note: note || null,
        sender_person: currentPerson,
        created_by: currentUser.id
      })
      .select(
        "id,title,artist,youtube_url,spotify_url,note,sender_person,created_by,created_at"
      )
      .single();

    if (error) throw error;

    if (inserted) {
      songs.unshift(mapRemoteSong(inserted));
      renderSongs();
    } else {
      await loadRemoteSongs();
    }

    form.reset();
    setYouTubeAutoStatus(
      "OPTIONAL"
    );

    currentFilter = "all";
    document
      .querySelectorAll(".filter")
      .forEach(x => x.classList.remove("active"));
    document
      .querySelector('.filter[data-filter="all"]')
      .classList.add("active");

    renderSongs();

    await delay(260);
    dialog.close();
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
  const visible = getVisibleSongs();
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

function playSong(song, requestedSource = null) {
  void markSongRead(song);

  const youtubeId = getYouTubeVideoId(song.youtubeUrl);
  const spotifyEmbedUrl = getSpotifyEmbedUrl(song.spotifyUrl);

  const source = requestedSource || (youtubeId ? "youtube" : spotifyEmbedUrl ? "spotify" : null);

  currentSongId = song.id;
  revealPlayer(song);
  renderSourceTabs(song, source);

  if (source === "youtube" && youtubeId) {
    currentSource = "youtube";
    playerStatus.textContent = "NOW PLAYING · YOUTUBE";
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
    mountYouTubePlayer(song, youtubeId);
  } else if (source === "spotify" && spotifyEmbedUrl) {
    destroyYouTubePlayer();
    currentSource = "spotify";
    playerStatus.textContent = "NOW PLAYING · SPOTIFY";
    mediaEmbed.className = "media-embed spotify-mode";
    mediaEmbed.innerHTML = "";

    const iframe = document.createElement("iframe");
    iframe.title = `Spotify player: ${song.title} — ${song.artist}`;
    iframe.src = spotifyEmbedUrl;
    iframe.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";
    iframe.allowFullscreen = true;
    iframe.loading = "eager";
    mediaEmbed.appendChild(iframe);
  } else {
    destroyYouTubePlayer();
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
}

function renderSourceTabs(song, activeSource) {
  const sources = [];
  if (getYouTubeVideoId(song.youtubeUrl)) sources.push({ key: "youtube", label: "YOUTUBE" });
  if (getSpotifyEmbedUrl(song.spotifyUrl)) sources.push({ key: "spotify", label: "SPOTIFY" });

  sourceTabs.innerHTML = "";
  sourceTabs.hidden = sources.length < 2;

  sources.forEach(source => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `source-tab${source.key === activeSource ? " active" : ""}`;
    const label = document.createElement("span");
    label.className = "source-tab-label";
    label.textContent = source.label;
    button.appendChild(label);
    button.addEventListener("click", () => playSong(song, source.key));
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

function setPlayButtonContent(button, state = "idle") {
  if (!button) return;

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

// Mobile browsers can synthesize hover/focus and show a text-selection
// magnifier/callout during a long press. Keep those browser-native effects
// from changing the perceived title size while preserving normal tap/scroll.
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
    event.target.closest(".song-row")?.querySelector(".song-title")?.blur();
  }, { passive: true });
});

/* Do not let a touch hold leave a native button focus state behind. The
   click still fires normally; this only removes browser focus styling. */
songList?.addEventListener("pointerdown", event => {
  if (!mobileSongLayoutQuery.matches || event.pointerType === "mouse") return;
  const button = event.target.closest(".song-row button");
  if (!button) return;
  button.blur();
  requestAnimationFrame(() => button.blur());
}, { passive: true, capture: true });

let mobileSongMeasureFrame = 0;

function updateMobileSongWrapState(row) {
  if (!row) return;
  if (!mobileSongLayoutQuery.matches) {
    row.classList.remove("is-title-multiline");
    return;
  }

  const titleText = row.querySelector(".song-title-text");
  if (!titleText) return;

  const style = getComputedStyle(titleText);
  const lineHeight = parseFloat(style.lineHeight) || 19.55;
  const height = titleText.getBoundingClientRect().height;
  row.classList.toggle("is-title-multiline", height > lineHeight * 1.45);
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
  const visible = getVisibleSongs();
  songCount.textContent = `${String(songs.length).padStart(3, "0")} SONG${songs.length === 1 ? "" : "S"}`;
  emptyState.hidden = visible.length > 0;

  visible.forEach(song => {
    const fragment = template.content.cloneNode(true);
    const row = fragment.querySelector(".song-row");
    let titleButton = fragment.querySelector(".song-title");
    const playButton = fragment.querySelector(".play-song");
    const mobileDetailsToggle = fragment.querySelector(".mobile-details-toggle");

    // On touch/mobile, avoid native <button> pressed/focus rendering entirely.
    // Some mobile browsers synthesize :hover/:active while a finger is held or
    // dragged, which can visually resize/reposition button text even when the
    // declared font-size is unchanged. A neutral role=button element keeps the
    // same tap-to-play behavior without the browser-native press treatment.
    if (mobileSongLayoutQuery.matches && titleButton?.tagName === "BUTTON") {
      const mobileTitle = document.createElement("div");
      mobileTitle.className = titleButton.className;
      mobileTitle.setAttribute("role", "button");
      mobileTitle.setAttribute("tabindex", "0");
      mobileTitle.setAttribute("aria-label", "Play song");
      while (titleButton.firstChild) mobileTitle.appendChild(titleButton.firstChild);
      titleButton.replaceWith(mobileTitle);
      titleButton = mobileTitle;
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

    if (titleButton.getAttribute("role") === "button") {
      titleButton.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        titleButton.blur?.();
        playSong(song);
      });
    }

    // Desktop: treat the entire song card as the playback hit area, including
    // metadata and the expanded note. Existing playback buttons keep their own
    // handlers, and destructive/detail controls are excluded.
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
      event.currentTarget.blur();
      queueMobileSongWrapSync();
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
    } else {
      playButton.disabled = true;
      setPlayButtonContent(playButton, "disabled");
    }

    const deleteButton = fragment.querySelector(".delete-song");
    const canDelete = song.senderPerson === currentPerson;

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

    songList.appendChild(fragment);
  });

  queueMobileSongWrapSync();
  syncPlayButtons();
  renderStats();
  syncStatsPlayingState();

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
    `<small>${senderLabel(cluster.songs[0])}</small>`;
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
    // Desktop timeline inspection is hover-only. Keep tap behavior available
    // for coarse/touch pointers if clusters are ever reintroduced there.
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
  // Use the same one-song-per-point chronological layout on every viewport.
  // This keeps desktop recommendations from collapsing into stacked clusters.
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

    // Only track the gesture here. Holding a circle must have no scale effect.
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

    // A completed tap becomes a persistent mobile hover/selection state.
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
        `<small>${senderLabel(firstSong)} · ${shortDate(firstSong.createdAt)}</small>`;
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
    row.innerHTML = `<span>${String(index + 1).padStart(2, "0")}</span><p>${fact}</p>`;
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
      // Timeline dots behave like a persistent hover state on touch: tapping
      // the selected circle again keeps both the circle and popup open.
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

  // Only a completed tap/click on empty space clears the persistent timeline
  // selection. Touch-hold and swipe gestures do not dismiss it.
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
    cursor.classList.add('is-visible');
    syncCursorState(event.target);
    scheduleCursorDraw();
  }, { passive: true, capture: true });

  document.addEventListener('pointerdown', event => {
    if (!finePointer.matches || event.pointerType === 'touch') return;
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
    cursor.classList.add('is-visible');
    syncCursorState(event.target);
  }, { passive: true, capture: true });

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
