/* Flashcards whiteboard - app logic.
   Expects globals injected at build time:
     window.CATALOG : [{id, cat, type:'pic', src} | {id, cat, type:'marker', kind, color, ring}]
     window.CATS    : [{key, label}]
*/
(function () {
  "use strict";
  // Pristine copy of the served document, captured before any DOM mutation.
  // Used to republish a new version (with an updated lesson set) via the
  // "artifact" runtime capability. fetch() of the live URL is preferred; this
  // is the fallback.
  var PRISTINE_SNAPSHOT = "<!doctype html>\n" + document.documentElement.outerHTML;

  var CATALOG = window.CATALOG || [];
  var CATS = window.CATS || [];
  var IDS = CATALOG.map(function (c) { return c.id; });
  var BYID = {};
  CATALOG.forEach(function (c) { BYID[c.id] = c; });

  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  /* ---------- selection <-> URL ---------- */
  function b64urlEnc(bytes) {
    var s = btoa(String.fromCharCode.apply(null, bytes));
    return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urlDec(str) {
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    var bin = atob(str);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function encodeSelection(set) {
    var nBytes = Math.ceil(IDS.length / 8);
    var bytes = new Uint8Array(nBytes);
    IDS.forEach(function (id, i) {
      if (set.has(id)) bytes[i >> 3] |= (1 << (i & 7));
    });
    return "1" + b64urlEnc(bytes);
  }
  function decodeSelection(payload) {
    var set = new Set();
    if (!payload || payload[0] !== "1") return set;
    try {
      var bytes = b64urlDec(payload.slice(1));
      IDS.forEach(function (id, i) {
        if (bytes[i >> 3] & (1 << (i & 7))) set.add(id);
      });
    } catch (e) {}
    return set;
  }
  function currentHashPayload() {
    var m = /[#&]s=([^&]+)/.exec(location.hash);
    return m ? decodeURIComponent(m[1]) : null;
  }

  // Lesson set embedded in the page by the "artifact" shared-state capability.
  var embeddedSet = null;
  try {
    var stateEl = document.getElementById("lesson-state");
    if (stateEl) {
      var st = JSON.parse(stateEl.textContent || "{}");
      if (st && st.set && st.set.length) embeddedSet = st.set;
    }
  } catch (e) {}

  var isTeacher = !!LS.get("fcw_teacher", false);
  var hashPayload = currentHashPayload();

  var MODE, selected;
  if (hashPayload) {                       // opened via a shared link (hash)
    MODE = "board";
    selected = decodeSelection(hashPayload);
  } else if (embeddedSet && !isTeacher) {  // a lesson has been pushed to the class
    MODE = "board";
    selected = new Set(embeddedSet);
  } else {                                  // teacher setting up
    MODE = "builder";
    selected = new Set(embeddedSet || LS.get("fcw_lastsel", []));
  }
  document.body.dataset.mode = MODE;
  var SHARED = false;   // set true once the "artifact" capability resolves

  function syncHashFromSelection() {
    if (MODE !== "builder") return;
    LS.set("fcw_lastsel", Array.from(selected));
    var payload = encodeSelection(selected);
    try { history.replaceState(null, "", "#s=" + payload); }
    catch (e) { try { location.hash = "s=" + payload; } catch (e2) {} }
  }

  /* ---------- element helpers ---------- */
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function markerEl(def) {
    var e = el("div", "marker");
    if (def.kind === "dot") {
      e.classList.add("dot", def.ring ? "ringed" : "plain");
      e.style.setProperty("--c", def.color);
      if (def.ring) e.style.setProperty("--ring", def.ring);
    } else if (def.kind === "plus") {
      e.classList.add("mplus"); e.style.setProperty("--c", def.color || "#06a2ff");
    } else if (def.kind === "s") {
      e.classList.add("ms");
    }
    return e;
  }
  function cardVisual(def) {
    if (def.type === "marker") return markerEl(def);
    var img = new Image();
    img.src = def.src; img.alt = "";
    return img;
  }

  /* ---------- palette ---------- */
  var paletteScroll = document.getElementById("paletteScroll");
  var paletteHeadCount = document.getElementById("paletteHeadCount");

  function buildPalette() {
    paletteScroll.innerHTML = "";
    if (MODE === "board") {
      var wrap = el("div", "cat-grid");
      var list = CATALOG.filter(function (c) { return selected.has(c.id); });
      if (list.length === 0) list = CATALOG.slice(); // fallback: show all
      list.forEach(function (c) { wrap.appendChild(paletteCard(c)); });
      var head = el("div", "palette-head", "Lesson set");
      var cnt = el("span", "cat-count", String(list.length));
      head.appendChild(cnt);
      paletteScroll.appendChild(head);
      paletteScroll.appendChild(wrap);
      return;
    }
    CATS.forEach(function (cat) {
      var cards = CATALOG.filter(function (c) { return c.cat === cat.key; });
      if (!cards.length) return;
      var d = el("details", "cat"); d.open = true;
      var sum = el("summary");
      sum.appendChild(el("span", null, cat.label));
      var count = el("span", "cat-count");
      sum.appendChild(count);
      d.appendChild(sum);
      var grid = el("div", "cat-grid");
      cards.forEach(function (c) { grid.appendChild(paletteCard(c)); });
      d.appendChild(grid);
      paletteScroll.appendChild(d);
      d._refresh = function () {
        var on = cards.filter(function (c) { return selected.has(c.id); }).length;
        count.textContent = on + " / " + cards.length;
      };
      d._refresh();
    });
    refreshHeadCount();
  }
  function refreshHeadCount() {
    if (paletteHeadCount) paletteHeadCount.textContent = selected.size + " selected";
  }
  function refreshCounts() {
    paletteScroll.querySelectorAll("details.cat").forEach(function (d) { if (d._refresh) d._refresh(); });
    refreshHeadCount();
  }

  function paletteCard(def) {
    var c = el("div", "pcard");
    c.appendChild(cardVisual(def));
    c.dataset.id = def.id;
    if (MODE === "builder") {
      c.classList.add("selectable");
      if (selected.has(def.id)) c.classList.add("on");
    }
    attachPalettePointer(c, def);
    return c;
  }

  /* pointer on a palette card: tap = toggle (builder), drag = spawn instance */
  function attachPalettePointer(node, def) {
    node.addEventListener("pointerdown", function (ev) {
      if (ev.button != null && ev.button !== 0) return;
      ev.preventDefault();
      var startX = ev.clientX, startY = ev.clientY;
      var dragging = false, ghost = null;
      function move(e) {
        var dx = e.clientX - startX, dy = e.clientY - startY;
        if (!dragging && Math.hypot(dx, dy) > 6) {
          dragging = true;
          ghost = el("div", "drag-ghost");
          ghost.style.cssText = "position:fixed;z-index:99;width:96px;height:96px;pointer-events:none;opacity:.85;transform:translate(-50%,-50%)";
          ghost.appendChild(cardVisual(def));
          ghost.firstChild.style.width = "100%"; ghost.firstChild.style.height = "100%";
          if (def.type === "marker") { ghost.firstChild.style.position = "static"; ghost.firstChild.style.fontSize = "96px"; }
          document.body.appendChild(ghost);
        }
        if (dragging) { ghost.style.left = e.clientX + "px"; ghost.style.top = e.clientY + "px"; }
      }
      function up(e) {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        if (ghost) ghost.remove();
        if (!dragging) {
          if (MODE === "builder") toggleSelect(def.id, node);
          return;
        }
        var b = board.getBoundingClientRect();
        if (e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom) {
          spawnInstance(def, e.clientX - b.left, e.clientY - b.top);
        }
      }
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    });
  }

  function toggleSelect(id, node) {
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    if (node) node.classList.toggle("on", selected.has(id));
    refreshCounts();
    syncHashFromSelection();
  }

  /* ---------- board / instances ---------- */
  var board = document.getElementById("board");
  var cardsLayer = document.getElementById("cardsLayer");
  var selectedInst = null;
  var undoStack = [];

  function pushHistory(fn) { undoStack.push(fn); if (undoStack.length > 120) undoStack.shift(); }

  function sizeFor(def) {
    if (def.type === "marker") {
      if (def.kind === "s") return 54;
      return 66;
    }
    return 128;
  }

  function spawnInstance(def, cx, cy, opts) {
    opts = opts || {};
    var size = opts.size || sizeFor(def);
    var node = el("div", "inst");
    node.dataset.id = def.id;
    var w = size, h = def.type === "pic" ? size : size;
    node.style.width = w + "px";
    node.style.height = h + "px";
    node.style.left = (cx - w / 2) + "px";
    node.style.top = (cy - h / 2) + "px";
    node.style.fontSize = w + "px";
    node.appendChild(cardVisual(def));
    if (def.type === "marker") { node.firstChild.style.position = "absolute"; node.firstChild.style.inset = "0"; }
    var del = el("div", "del", "×");
    del.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    del.addEventListener("click", function (e) { e.stopPropagation(); removeInstance(node); });
    node.appendChild(del);
    cardsLayer.appendChild(node);
    attachInstancePointer(node, def);
    if (def.kind === "s") snapS(node);
    pushHistory(function () { node.remove(); if (selectedInst === node) selectedInst = null; });
    selectInstance(node);
    return node;
  }

  function removeInstance(node) {
    var def = BYID[node.dataset.id];
    var x = node.style.left, y = node.style.top;
    node.remove();
    if (selectedInst === node) selectedInst = null;
    pushHistory(function () {
      cardsLayer.appendChild(node);
      node.style.left = x; node.style.top = y;
    });
  }

  function selectInstance(node) {
    if (selectedInst && selectedInst !== node) selectedInst.classList.remove("sel");
    selectedInst = node;
    if (node) node.classList.add("sel");
  }

  function attachInstancePointer(node, def) {
    node.addEventListener("pointerdown", function (ev) {
      if (document.body.dataset.tool !== "move") return;
      if (ev.button != null && ev.button !== 0) return;
      ev.stopPropagation();
      selectInstance(node);
      var r = node.getBoundingClientRect();
      var b = board.getBoundingClientRect();
      var offX = ev.clientX - r.left, offY = ev.clientY - r.top;
      var startLeft = parseFloat(node.style.left), startTop = parseFloat(node.style.top);
      var moved = false;
      node.setPointerCapture(ev.pointerId);
      node.classList.add("dragging");
      function move(e) {
        moved = true;
        var nx = e.clientX - b.left - offX;
        var ny = e.clientY - b.top - offY;
        nx = Math.max(-node.offsetWidth / 2, Math.min(b.width - node.offsetWidth / 2, nx));
        ny = Math.max(0, Math.min(b.height - node.offsetHeight / 2, ny));
        node.style.left = nx + "px"; node.style.top = ny + "px";
      }
      function up(e) {
        node.releasePointerCapture(ev.pointerId);
        node.classList.remove("dragging");
        node.removeEventListener("pointermove", move);
        node.removeEventListener("pointerup", up);
        if (moved) {
          var fromL = startLeft, fromT = startTop;
          pushHistory(function () { node.style.left = fromL + "px"; node.style.top = fromT + "px"; });
          if (def && def.kind === "s") snapS(node);
        }
      }
      node.addEventListener("pointermove", move);
      node.addEventListener("pointerup", up);
    });
    node.addEventListener("dblclick", function (e) {
      if (document.body.dataset.tool === "move") { e.preventDefault(); removeInstance(node); }
    });
  }

  /* snap an "s" marker onto the right border of the card it overlaps */
  function snapS(sNode) {
    var sr = sNode.getBoundingClientRect();
    var scx = sr.left + sr.width / 2, scy = sr.top + sr.height / 2;
    var best = null, bestArea = 0;
    cardsLayer.querySelectorAll(".inst").forEach(function (other) {
      if (other === sNode) return;
      var od = BYID[other.dataset.id];
      if (od && od.type === "marker") return;
      var or = other.getBoundingClientRect();
      if (scx >= or.left && scx <= or.right && scy >= or.top && scy <= or.bottom) {
        var area = or.width * or.height;
        if (area > bestArea) { bestArea = area; best = other; }
      }
    });
    if (!best) return;
    var b = board.getBoundingClientRect();
    var or = best.getBoundingClientRect();
    var left = (or.right - b.left) - sNode.offsetWidth * 0.55;
    var top = (or.top - b.top) + sNode.offsetHeight * 0.12;
    sNode.style.left = left + "px";
    sNode.style.top = top + "px";
  }

  board.addEventListener("pointerdown", function (e) {
    if (document.body.dataset.tool === "move" && (e.target === board || e.target === cardsLayer)) {
      selectInstance(null);
    }
  });

  /* ---------- ink layer ---------- */
  var ink = document.getElementById("ink");
  var ictx = ink.getContext("2d");
  var strokes = [];
  var dpr = Math.max(1, window.devicePixelRatio || 1);

  function resizeInk() {
    var r = board.getBoundingClientRect();
    ink.width = Math.round(r.width * dpr);
    ink.height = Math.round(r.height * dpr);
    ink.style.width = r.width + "px";
    ink.style.height = r.height + "px";
    ictx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redrawInk();
  }
  function strokeStyle(s) {
    ictx.lineJoin = ictx.lineCap = "round";
    if (s.tool === "eraser") {
      ictx.globalCompositeOperation = "destination-out";
      ictx.globalAlpha = 1;
      ictx.strokeStyle = "rgba(0,0,0,1)";
      ictx.lineWidth = s.size;
    } else if (s.tool === "highlighter") {
      ictx.globalCompositeOperation = "source-over";
      ictx.globalAlpha = 0.32;
      ictx.strokeStyle = s.color;
      ictx.lineWidth = s.size;
    } else {
      ictx.globalCompositeOperation = "source-over";
      ictx.globalAlpha = 1;
      ictx.strokeStyle = s.color;
      ictx.lineWidth = s.size;
    }
  }
  function drawStroke(s) {
    if (s.pts.length < 1) return;
    strokeStyle(s);
    ictx.beginPath();
    ictx.moveTo(s.pts[0][0], s.pts[0][1]);
    for (var i = 1; i < s.pts.length; i++) ictx.lineTo(s.pts[i][0], s.pts[i][1]);
    if (s.pts.length === 1) ictx.lineTo(s.pts[0][0] + 0.01, s.pts[0][1] + 0.01);
    ictx.stroke();
  }
  function redrawInk() {
    ictx.save();
    ictx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ictx.clearRect(0, 0, ink.width, ink.height);
    strokes.forEach(drawStroke);
    ictx.restore();
    ictx.globalCompositeOperation = "source-over";
    ictx.globalAlpha = 1;
  }

  var curStroke = null;
  ink.addEventListener("pointerdown", function (e) {
    var t = document.body.dataset.tool;
    if (t === "move") return;
    e.preventDefault();
    ink.setPointerCapture(e.pointerId);
    var r = board.getBoundingClientRect();
    curStroke = {
      tool: t,
      color: penColor,
      size: t === "highlighter" ? penSize * 3.4 : t === "eraser" ? penSize * 4 : penSize,
      pts: [[e.clientX - r.left, e.clientY - r.top]]
    };
    strokes.push(curStroke);
    drawStroke(curStroke);
  });
  ink.addEventListener("pointermove", function (e) {
    if (!curStroke) return;
    var r = board.getBoundingClientRect();
    var coalesced = e.getCoalescedEvents && e.getCoalescedEvents();
    var evs = (coalesced && coalesced.length) ? coalesced : [e];
    evs.forEach(function (ce) { curStroke.pts.push([ce.clientX - r.left, ce.clientY - r.top]); });
    redrawInk();
  });
  function endStroke(e) {
    if (!curStroke) return;
    try { ink.releasePointerCapture(e.pointerId); } catch (x) {}
    var s = curStroke; curStroke = null;
    pushHistory(function () {
      var i = strokes.indexOf(s);
      if (i >= 0) strokes.splice(i, 1);
      redrawInk();
    });
  }
  ink.addEventListener("pointerup", endStroke);
  ink.addEventListener("pointercancel", endStroke);

  /* ---------- toolbar ---------- */
  var penColor = LS.get("fcw_color", "#e02f2f");
  var penSize = LS.get("fcw_size", 4);

  function setTool(t) {
    document.body.dataset.tool = t;
    LS.set("fcw_tool", t);
    document.querySelectorAll("button.tool").forEach(function (b) {
      b.classList.toggle("active", b.dataset.tool === t);
    });
    if (t !== "move") selectInstance(null);
  }
  document.querySelectorAll("button.tool").forEach(function (b) {
    b.addEventListener("click", function () { setTool(b.dataset.tool); });
  });
  document.querySelectorAll(".swatch").forEach(function (sw) {
    if (sw.dataset.color === penColor) sw.classList.add("active");
    sw.addEventListener("click", function () {
      penColor = sw.dataset.color;
      LS.set("fcw_color", penColor);
      document.querySelectorAll(".swatch").forEach(function (o) { o.classList.toggle("active", o === sw); });
      if (document.body.dataset.tool === "move") setTool("pen");
    });
  });
  var sizeInput = document.getElementById("penSize");
  if (sizeInput) {
    sizeInput.value = penSize;
    sizeInput.addEventListener("input", function () { penSize = +sizeInput.value; LS.set("fcw_size", penSize); });
  }
  document.getElementById("undoBtn").addEventListener("click", function () {
    var fn = undoStack.pop(); if (fn) fn();
  });
  document.getElementById("clearInkBtn").addEventListener("click", function () {
    if (!strokes.length) return;
    var old = strokes; strokes = []; redrawInk();
    pushHistory(function () { strokes = old; redrawInk(); });
  });
  document.getElementById("clearBoardBtn").addEventListener("click", function () {
    var oldStrokes = strokes;
    var oldCards = Array.prototype.slice.call(cardsLayer.children);
    if (!oldStrokes.length && !oldCards.length) return;
    strokes = []; redrawInk();
    oldCards.forEach(function (n) { n.remove(); });
    selectedInst = null;
    pushHistory(function () {
      strokes = oldStrokes; redrawInk();
      oldCards.forEach(function (n) { cardsLayer.appendChild(n); });
    });
  });

  document.addEventListener("keydown", function (e) {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if ((e.key === "Delete" || e.key === "Backspace") && selectedInst) {
      e.preventDefault(); removeInstance(selectedInst);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault(); var fn = undoStack.pop(); if (fn) fn();
    } else if (e.key === "p") setTool("pen");
    else if (e.key === "h") setTool("highlighter");
    else if (e.key === "e") setTool("eraser");
    else if (e.key === "v" || e.key === "Escape") setTool("move");
  });

  /* ---------- flag ---------- */
  var flagWrap = document.getElementById("flagWrap");
  function setFlag(up) {
    flagWrap.classList.toggle("raised", up);
    document.body.classList.toggle("english-only", up);
    LS.set("fcw_flag", up);
  }
  flagWrap.addEventListener("click", function () {
    setFlag(!flagWrap.classList.contains("raised"));
  });
  setFlag(!!LS.get("fcw_flag", false));

  /* ---------- share dialog ---------- */
  var overlay = document.getElementById("overlay");
  var qrBox = document.getElementById("qrBox");
  var urlInput = document.getElementById("shareUrl");
  var savedListEl = document.getElementById("savedList");

  function shareUrl() {
    return location.origin + location.pathname + "#s=" + encodeSelection(selected);
  }
  var shareWarn = document.getElementById("shareWarn");
  function openShare() {
    var empty = selected.size === 0;
    if (shareWarn) shareWarn.style.display = empty ? "block" : "none";
    qrBox.style.display = empty ? "none" : "";
    var url = shareUrl();
    urlInput.value = url;
    if (!empty) {
      try { qrBox.innerHTML = window.QR.svg(url, { ecc: "M", border: 2 }); }
      catch (e) { qrBox.textContent = "QR error"; }
    }
    renderSaved();
    overlay.classList.add("open");
  }
  function closeShare() { overlay.classList.remove("open"); }

  function renderSaved() {
    var sets = LS.get("fcw_sets", []);
    savedListEl.innerHTML = "";
    if (!sets.length) { savedListEl.innerHTML = '<p class="empty-hint">No saved sets yet.</p>'; return; }
    sets.forEach(function (s, i) {
      var li = el("li");
      var a = el("a", null, s.name + "  (" + s.count + ")");
      a.href = location.origin + location.pathname + "#s=" + s.payload;
      var load = el("button", null, "Load");
      load.addEventListener("click", function () {
        selected = decodeSelection(s.payload);
        buildPalette(); syncHashFromSelection();
        urlInput.value = shareUrl();
        try { qrBox.innerHTML = window.QR.svg(shareUrl(), { ecc: "M", border: 2 }); } catch (e) {}
      });
      var del = el("button", null, "×");
      del.addEventListener("click", function () {
        sets.splice(i, 1); LS.set("fcw_sets", sets); renderSaved();
      });
      li.appendChild(a); li.appendChild(load); li.appendChild(del);
      savedListEl.appendChild(li);
    });
  }

  var shareBtn = document.getElementById("shareBtn");
  if (shareBtn) shareBtn.addEventListener("click", openShare);
  document.getElementById("closeShare").addEventListener("click", closeShare);
  overlay.addEventListener("click", function (e) { if (e.target === overlay) closeShare(); });
  document.getElementById("copyBtn").addEventListener("click", function () {
    urlInput.focus(); urlInput.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) {}
    if (navigator.clipboard) navigator.clipboard.writeText(urlInput.value).catch(function () {});
    this.textContent = ok || navigator.clipboard ? "Copied!" : "Press Ctrl+C";
    var b = this; setTimeout(function () { b.textContent = "Copy link"; }, 1600);
  });
  document.getElementById("openBoardBtn").addEventListener("click", function () {
    window.open(shareUrl(), "_blank");
  });
  var setNameInput = document.getElementById("setName");
  document.getElementById("saveSetBtn").addEventListener("click", function () {
    if (selected.size === 0) { if (shareWarn) shareWarn.style.display = "block"; return; }
    var name = (setNameInput && setNameInput.value || "").trim();
    if (!name) { if (setNameInput) setNameInput.focus(); return; }
    var sets = LS.get("fcw_sets", []);
    sets.unshift({ name: name, payload: encodeSelection(selected), count: selected.size, ts: Date.now() });
    LS.set("fcw_sets", sets.slice(0, 30));
    if (setNameInput) setNameInput.value = "";
    renderSaved();
  });

  /* ---------- board-mode banner ---------- */
  var modeNote = document.getElementById("modeNote");
  function refreshModeNote() {
    if (!modeNote) return;
    if (MODE === "board") modeNote.textContent = "Following the teacher · " + selected.size + " cards";
    else modeNote.textContent = "";
  }
  refreshModeNote();

  /* ---------- shared-state mode (published Artifact) ---------- */
  var toastEl = null;
  function toast(msg, ms) {
    if (!toastEl) {
      toastEl = el("div", "toast");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.classList.remove("show"); }, ms || 2200);
  }

  function getPristineDoc() {
    return fetch(location.href, { cache: "reload" })
      .then(function (r) { if (!r.ok) throw 0; return r.text(); })
      .then(function (src) {
        return /id="lesson-state"/.test(src) ? src : PRISTINE_SNAPSHOT;
      })
      .catch(function () { return PRISTINE_SNAPSHOT; });
  }

  var artifactNS = null;
  function pushToClass() {
    if (!artifactNS) return;
    if (selected.size === 0) { toast("Pick some cards first."); return; }
    var ids = Array.from(selected);
    var btn = document.getElementById("shareBtn");
    var label = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Pushing…"; }
    getPristineDoc().then(function (src) {
      if (!/id="lesson-state"/.test(src)) throw new Error("no-marker");
      var doc = src.replace(
        /(<script id="lesson-state"[^>]*>)[\s\S]*?(<\/script>)/,
        function (m, a, b) { return a + JSON.stringify({ set: ids }) + b; });
      return artifactNS.publish(doc);
    }).then(function () {
      toast("Pushed to the class ✓ (" + ids.length + " cards)");
    }).catch(function (err) {
      var s = (err && (err.code || err.message || "")) + "";
      if (/writer|granted|permission/i.test(s)) toast("Only your own copy of this board can push to the class.");
      else if (/conflict/i.test(s)) toast("Someone else just pushed — this view will reload.");
      else toast("Couldn't push. Try again.");
    }).then(function () {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    });
  }

  function enterSharedMode(ns) {
    if (!ns) return;               // not in a capable Artifact view -> keep link mode
    SHARED = true;
    artifactNS = ns;
    document.body.classList.add("shared");
    var btn = document.getElementById("shareBtn");
    if (btn) {
      btn.textContent = "📤 Push to class";
      btn.replaceWith(btn.cloneNode(true));           // drop the openShare listener
      document.getElementById("shareBtn").addEventListener("click", pushToClass);
    }
    // teacher <-> student toggle in the corner
    var toggle = el("button", "teacher-toggle",
      MODE === "builder" ? "Viewing as teacher — switch to student" : "Set up the lesson (teacher)");
    toggle.addEventListener("click", function () {
      LS.set("fcw_teacher", MODE !== "builder");
      location.reload();
    });
    document.body.appendChild(toggle);
  }

  /* ---------- init ---------- */
  buildPalette();
  setTool(LS.get("fcw_tool", "move"));
  var savedColor = document.querySelector('.swatch[data-color="' + penColor + '"]');
  if (savedColor) { document.querySelectorAll(".swatch").forEach(function (o) { o.classList.toggle("active", o === savedColor); }); }
  resizeInk();
  window.addEventListener("resize", function () {
    clearTimeout(window._rz); window._rz = setTimeout(resizeInk, 120);
  });
  if (MODE === "builder") syncHashFromSelection();

  if (window.claude && typeof window.claude.use === "function") {
    try { window.claude.use("artifact").then(enterSharedMode, function () {}); } catch (e) {}
  }
})();
