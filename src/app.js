/* Flashcards whiteboard - app logic.
   Expects globals injected at build time:
     window.CATALOG : [{id, cat, type:'pic', src} | {id, cat, type:'marker', kind, color, ring}]
     window.CATS    : [{key, label}]
     window.SERVER  : only on the PHP host (server/): {mode:'builder', api, csrf,
                      user, links} for a logged-in teacher, or {mode:'board', sel,
                      opts, exp} for a student link (CATALOG then holds only the
                      lesson's cards). Absent in the standalone / Artifact builds.
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
  var SRV = window.SERVER || null;
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
  function hashParam(name) {
    var m = new RegExp("[#&]" + name + "=([^&]+)").exec(location.hash);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function currentHashPayload() { return hashParam("s"); }

  /* ---------- word options (teacher's ⚙️ panel) ---------- */
  // Which words each dot can stand for (in the generator AND when a dot on the
  // board is tapped) and where the generator may put an "s". Saved in this
  // browser; sent to the class in the share link (#...&o=). See docs/generator.md.
  // OPT_KEYS order is part of the link format: only ever APPEND new keys.
  var OPT_KEYS = [
    "dot-red:the", "dot-red:a",
    "dot-orange:my", "dot-orange:your", "dot-orange:his", "dot-orange:her", "dot-orange:our", "dot-orange:their",
    "dot-green:is", "dot-green:let's", "dot-green:are",
    "dot-blue:in", "dot-blue:on", "dot-blue:under", "dot-blue:near", "dot-blue:at", "dot-blue:with",
    "marker-s:verb", "marker-s:noun"
  ];
  var OPT_DEFAULT_OFF = ["dot-blue:near"];
  var OPT_GROUPS = [
    { id: "dot-red", label: "Red dot", ex: { the: "the fox", a: "a fox" } },
    { id: "dot-orange", label: "Orange dot", ex: { my: "my cat", your: "your cat", his: "his cat",
      her: "her cat", our: "our cat", their: "their cat" } },
    { id: "dot-green", label: "Green dot", ex: { is: "the frog is green", "let's": "let's run",
      are: "the frogs are green" } },
    { id: "dot-blue", label: "Blue dot", ex: { "in": "in the garden · in winter", on: "on the desk",
      under: "under the desk", near: "near the river", at: "at Christmas", "with": "with my cat" } },
    { id: "marker-s", label: "s (sentence generator)", ex: { verb: "the fox run·s", noun: "the fox·es run" },
      names: { verb: "on verbs", noun: "on nouns" } }
  ];
  // words the generator can use (the others only matter when tapping a dot on the board)
  var OPT_GEN = ["dot-red:the", "dot-red:a", "dot-orange:my", "dot-orange:your", "dot-orange:his",
    "dot-orange:her", "dot-orange:our", "dot-orange:their", "dot-green:is", "dot-green:let's",
    "dot-green:are", "dot-blue:in", "dot-blue:near", "dot-blue:at", "marker-s:verb", "marker-s:noun"];

  function optsFromMap(map) {
    var on = new Set();
    OPT_KEYS.forEach(function (k) {
      var v = map && typeof map[k] === "boolean" ? map[k] : OPT_DEFAULT_OFF.indexOf(k) < 0;
      if (v) on.add(k);
    });
    return on;
  }
  function encodeOpts(on) {
    var bytes = new Uint8Array(Math.ceil(OPT_KEYS.length / 8));
    OPT_KEYS.forEach(function (k, i) { if (on.has(k)) bytes[i >> 3] |= (1 << (i & 7)); });
    return "1" + OPT_KEYS.length.toString(36) + "." + b64urlEnc(bytes);
  }
  function decodeOpts(payload) {            // keys newer than the link keep their default
    var m = /^1([0-9a-z]+)\.(.*)$/.exec(payload || "");
    if (!m) return optsFromMap(null);
    var n = parseInt(m[1], 36), map = {};
    try {
      var bytes = b64urlDec(m[2]);
      OPT_KEYS.forEach(function (k, i) { if (i < n) map[k] = !!(bytes[i >> 3] & (1 << (i & 7))); });
    } catch (e) {}
    return optsFromMap(map);
  }
  var linkOpts = SRV && SRV.mode === "board" ? SRV.opts : hashParam("o");
  var wordOpts = linkOpts ? decodeOpts(linkOpts) : optsFromMap(LS.get("fcw_opts", null));
  function saveOpts() {
    var map = {};
    OPT_KEYS.forEach(function (k) { map[k] = wordOpts.has(k); });
    LS.set("fcw_opts", map);
  }
  function optOn(id, word) { return wordOpts.has(id + ":" + word); }
  // the words a marker can stand for right now (words without an option always count)
  function activeWords(def) {
    var w = (def.words || []).filter(function (x) {
      var k = def.id + ":" + x;
      return OPT_KEYS.indexOf(k) < 0 || wordOpts.has(k);
    });
    return w.length ? w : (def.words || []);
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
  if (SRV && SRV.mode === "board") {       // student link signed by the PHP host
    MODE = "board";
    selected = new Set(SRV.sel || []);
  } else if (hashPayload) {                       // opened via a shared link (hash)
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

  // The teacher's selection lives in this browser, not in the address bar: a
  // "#s=" there would reopen the page as the student view on reload.
  function syncHashFromSelection() {
    if (MODE !== "builder") return;
    LS.set("fcw_lastsel", Array.from(selected));
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
          else sayCard(def);
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
    if (def.kind !== "s") {
      var say = el("div", "say", "🔊");
      say.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      say.addEventListener("click", function (e) { e.stopPropagation(); speech.say(wordOfNode(node)); });
      node.appendChild(say);
    }
    if (def.words && def.words.length > 1) {
      // dot markers stand for several words: the chip shows the current one, tap cycles
      node.dataset.word = opts.word || activeWords(def)[0];
      var chip = el("div", "word-chip", node.dataset.word);
      chip.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      chip.addEventListener("click", function (e) {
        e.stopPropagation();
        var list = activeWords(def), i = list.indexOf(node.dataset.word);
        node.dataset.word = chip.textContent = list[(i + 1) % list.length];
        speech.say(node.dataset.word);
      });
      node.appendChild(chip);
    }
    cardsLayer.appendChild(node);
    attachInstancePointer(node, def);
    if (def.kind === "s") snapS(node);
    if (!opts.noHistory) pushHistory(function () { node.remove(); if (selectedInst === node) selectedInst = null; });
    if (!opts.noSelect) selectInstance(node);
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

  /* ---------- speech (browser speech synthesis, British voice preferred) ---------- */
  var speech = (function () {
    var synth = window.speechSynthesis;
    var voice = null;
    function pickVoice() {
      if (!synth) return;
      var vs = synth.getVoices().filter(function (v) { return /^en/i.test(v.lang); });
      function gb(v) { return /en[-_]GB/i.test(v.lang); }
      var nice = /Google UK|Sonia|Libby|Ryan|Hazel|George|Natural/i;
      voice = vs.filter(function (v) { return gb(v) && nice.test(v.name); })[0]
        || vs.filter(gb)[0] || vs[0] || null;
    }
    if (synth) {
      pickVoice();
      if ("onvoiceschanged" in synth) synth.onvoiceschanged = pickVoice;
    }
    function say(text) {
      if (!text) return;
      if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
        toast("Speech is not available in this browser.");
        return;
      }
      if (!voice) pickVoice();
      synth.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = voice ? voice.lang : "en-GB";
      if (voice) u.voice = voice;
      u.rate = 0.85;
      synth.speak(u);
    }
    return { say: say };
  })();

  /* ---------- words: inflection and reading the board ---------- */
  function inflect(word) {           // add -s / -es / -ies to one word
    if (/(s|x|z|ch|sh)$/i.test(word) || /^(go|do)$/i.test(word)) return word + "es";
    if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + "ies";
    if (/^have$/i.test(word)) return "has";
    return word + "s";
  }
  function pluralOf(def) {           // inflect the last word: "Christmas trees"
    if (def.pl) return def.pl;
    var p = def.w.split(" "); p[p.length - 1] = inflect(p[p.length - 1]); return p.join(" ");
  }
  function thirdPerson(def) {        // inflect the first word: "puts on"
    var p = def.w.split(" "); p[0] = inflect(p[0]); return p.join(" ");
  }
  function markerWord(node, def) { return node.dataset.word || (def.words ? def.words[0] : ""); }
  function sayCard(def) {
    if (def.kind === "s") return;
    speech.say(def.type === "marker" ? activeWords(def).join(", ") : def.w);
  }

  // Cards on the board in reading order (rows top->bottom, left->right),
  // with each "s" marker attached to the card it sits on.
  function boardItems() {
    var items = [], sNodes = [];
    Array.prototype.forEach.call(cardsLayer.querySelectorAll(".inst"), function (n) {
      var d = BYID[n.dataset.id];
      if (!d) return;
      if (d.kind === "s") { sNodes.push(n); return; }
      var r = n.getBoundingClientRect();
      items.push({ n: n, d: d, r: r, cx: r.left + r.width / 2, cy: r.top + r.height / 2, s: false });
    });
    sNodes.forEach(function (sn) {
      var sr = sn.getBoundingClientRect();
      var x = sr.left + sr.width / 2, y = sr.top + sr.height / 2;
      var best = null;
      items.forEach(function (it) {
        if (it.d.type !== "pic") return;
        if (x >= it.r.left && x <= it.r.right && y >= it.r.top && y <= it.r.bottom &&
            (!best || it.r.width * it.r.height > best.r.width * best.r.height)) best = it;
      });
      if (best) best.s = true;
    });
    items.sort(function (a, b) { return a.cy - b.cy; });
    var rows = [];
    items.forEach(function (it) {
      var row = rows[rows.length - 1];
      if (row && Math.abs(it.cy - row.cy) < Math.max(row.h, it.r.height) * 0.6) row.items.push(it);
      else rows.push({ cy: it.cy, h: it.r.height, items: [it] });
    });
    rows.forEach(function (row) { row.items.sort(function (a, b) { return a.cx - b.cx; }); });
    return rows;
  }
  function itemWord(it) {
    if (it.d.type === "marker") return markerWord(it.n, it.d);
    if (!it.s) return it.d.w;
    if (it.d.cat === "verbs") return thirdPerson(it.d);
    if (/nouns$/.test(it.d.cat)) return pluralOf(it.d);
    return it.d.w + "s";
  }
  function fixArticles(words) {      // "a" -> "an" before a vowel sound
    return words.map(function (w, i) {
      return w === "a" && words[i + 1] && /^[aeio]|^u(?!ni)/i.test(words[i + 1]) ? "an" : w;
    });
  }
  function wordOfNode(node) {
    var found = "";
    boardItems().forEach(function (row) {
      row.items.forEach(function (it) { if (it.n === node) found = itemWord(it); });
    });
    return found;
  }
  function readBoard() {
    var rows = boardItems();
    if (!rows.length) { toast("The board is empty."); return; }
    speech.say(rows.map(function (row) {
      return fixArticles(row.items.map(itemWord)).join(" ");
    }).join(". "));
  }

  /* ---------- sentence generator ---------- */
  // Levels (a level-N sentence always contains its level's structure; the
  // features of the lower levels may appear inside it):
  //  1  the/a + noun + verb-s           2  + plurals (noun-s), possessives (orange)
  //  3  + adjective                     4  + green dot: "is" / "are" / "let's"
  //  5  + numbers, "+" (compound subject, verb without s)
  //  6  + blue preposition + place: "In the garden the black fox + the green frog sleep"
  //  + optional time phrase at the end (TIME below), on top of the level's structure.
  // All these rules and the reasons behind them: docs/generator.md
  var genLevel = LS.get("fcw_level", 1);

  // Optional time phrase: "every day" from everyFrom, "in winter" / "at Christmas"
  // (blue dot + abstract noun with a "prep" in vocab.json) from prepFrom.
  var TIME = { chance: 0.33, everyFrom: 3, prepFrom: 6 };
  var silly = !!LS.get("fcw_silly", false);

  function rnd(a) { return a[Math.floor(Math.random() * a.length)]; }
  // one of these words, among those enabled in the ⚙️ options (else the first: rejected by usable)
  function pickWord(id, among) {
    var on = among.filter(function (w) { return optOn(id, w); });
    return on.length ? rnd(on) : among[0];
  }
  function chance(p) { return Math.random() < p; }

  function makePools(restrict) {
    var src = CATALOG.filter(function (c) {
      return c.type === "pic" && c.w && (!restrict || selected.has(c.id));
    });
    function of(cat, fn) { return src.filter(function (c) { return c.cat === cat && (!fn || fn(c)); }); }
    var subj = of("common-nouns", function (c) {
      return silly ? c.tag !== "abstract" : c.tag === "animate";
    });
    return {
      // markers count too: in the student view only the lesson's markers are usable
      has: function (id) { return !restrict || selected.has(id); },
      subj: subj,
      subjPl: subj.filter(function (c) { return !c.nopl; }),
      proper: of("proper-nouns"),
      verb: of("verbs", function (c) { return silly || c.tag === "intr"; }),
      adj: of("adjectives", function (c) { return silly || c.tag !== "weather"; }),
      place: of("common-nouns", function (c) { return c.tag === "place"; }),
      every: of("time"),
      season: of("common-nouns", function (c) { return c.tag === "abstract" && c.prep; }),
      one: of("numbers", function (c) { return c.id === "numbers-01"; }),
      numPl: of("numbers", function (c) { return c.id !== "numbers-01"; })
    };
  }

  // A noun phrase. f forces features: {plural, det:'art'|'poss'|'num', adj, proper}.
  function nounPhrase(P, L, f) {
    f = f || {};
    var canProper = P.proper.length && f.plural == null && !f.det && !f.adj;
    if (canProper && (f.proper || chance(0.2))) return { t: [{ id: rnd(P.proper).id }], plural: false };
    var plural = f.plural != null ? f.plural : (L >= 2 && P.subjPl.length > 0 && chance(0.4));
    var noun = rnd(plural ? P.subjPl : P.subj);
    var det = f.det || (plural && L >= 5 && P.numPl.length && chance(0.3) ? "num"
      : L >= 2 && chance(0.3) ? "poss" : "art");
    var t = [];
    if (det === "num") t.push({ id: rnd(plural ? P.numPl : P.one).id });
    else if (det === "poss") t.push({ id: "dot-orange", word: rnd(activeWords(BYID["dot-orange"])) });
    else t.push({ id: "dot-red", word: plural ? "the" : pickWord("dot-red", ["the", "a"]) });
    if (P.adj.length && (f.adj || (L >= 3 && chance(0.4)))) t.push({ id: rnd(P.adj).id });
    t.push({ id: noun.id, s: plural });
    return { t: t, plural: plural };
  }
  function withVerb(np, P) { return np.t.concat([{ id: rnd(P.verb).id, s: !np.plural }]); }
  function placePhrase(P) {
    return [{ id: "dot-blue", word: pickWord("dot-blue", ["in", "near"]) }, { id: "dot-red", word: "the" }, { id: rnd(P.place).id }];
  }

  var TEMPLATES = [
    { lvl: 1, ok: function (P) { return P.subj.length && P.verb.length; },
      make: function (P, L) { return withVerb(nounPhrase(P, L, { plural: L >= 2 ? null : false }), P); } },
    { lvl: 1, ok: function (P) { return P.proper.length && P.verb.length; },
      make: function (P) { return withVerb(nounPhrase(P, 1, { proper: true }), P); } },
    { lvl: 2, ok: function (P) { return P.subjPl.length && P.verb.length; },
      make: function (P, L) { return withVerb(nounPhrase(P, L, { plural: true, det: "art" }), P); } },
    { lvl: 2, ok: function (P) { return P.subj.length && P.verb.length; },
      make: function (P, L) { return withVerb(nounPhrase(P, L, { det: "poss" }), P); } },
    { lvl: 3, ok: function (P) { return P.subj.length && P.verb.length && P.adj.length; },
      make: function (P, L) { return withVerb(nounPhrase(P, L, { adj: true }), P); } },
    { lvl: 4, ok: function (P) { return P.subj.length && P.adj.length; },
      make: function (P, L) {
        var np = nounPhrase(P, L, { plural: false });
        var used = np.t.map(function (tk) { return tk.id; });
        var adjs = P.adj.filter(function (c) { return used.indexOf(c.id) < 0; });
        return np.t.concat([{ id: "dot-green", word: "is" }, { id: rnd(adjs.length ? adjs : P.adj).id }]);
      } },
    { lvl: 4, ok: function (P) { return P.subjPl.length && P.adj.length; },
      make: function (P, L) {
        var np = nounPhrase(P, L, { plural: true });
        return np.t.concat([{ id: "dot-green", word: "are" }, { id: rnd(P.adj).id }]);
      } },
    { lvl: 4, ok: function (P) { return P.verb.length; },
      make: function (P) { return [{ id: "dot-green", word: "let's" }, { id: rnd(P.verb).id }]; } },
    { lvl: 5, ok: function (P) { return P.subjPl.length && P.numPl.length && P.verb.length; },
      make: function (P, L) { return withVerb(nounPhrase(P, L, { plural: true, det: "num" }), P); } },
    { lvl: 5, ok: function (P) { return P.subj.length && P.verb.length; },
      make: function (P, L) {
        var a = nounPhrase(P, L), b = nounPhrase(P, L);
        return withVerb({ t: a.t.concat([{ id: "marker-plus", word: "and" }], b.t), plural: true }, P);
      } },
    { lvl: 6, ok: function (P) { return P.place.length && P.subj.length && P.verb.length; },
      make: function (P, L) { return placePhrase(P).concat(pickUpTo(P, 5).make(P, L)); } },
    { lvl: 6, ok: function (P) { return P.place.length && P.subj.length; },
      make: function (P, L) {
        var np = nounPhrase(P, L, { plural: false });
        return np.t.concat([{ id: "dot-green", word: "is" }], placePhrase(P));
      } }
  ];

  function timePhrase(P, L) {
    var choices = [];
    if (L >= TIME.everyFrom) P.every.forEach(function (c) { choices.push([{ id: c.id }]); });
    if (L >= TIME.prepFrom && P.has("dot-blue")) P.season.forEach(function (c) {
      if (!optOn("dot-blue", c.prep)) return;
      choices.push([{ id: "dot-blue", word: c.prep }, { id: c.id }]);
    });
    return choices.length ? rnd(choices) : null;
  }

  // Any structure up to level L (used for the sentence inside a level-6 place phrase).
  function pickUpTo(P, L) {
    var avail = TEMPLATES.filter(function (t) { return t.lvl <= L && t.ok(P); });
    return avail.length ? rnd(avail) : null;
  }

  // Every card in the sentence, the "s" marker included, must be in the pools,
  // and every dot word and "s" must be enabled in the ⚙️ options.
  function usable(tokens, P) {
    return tokens.every(function (tk) {
      if (!P.has(tk.id)) return false;
      if (tk.word && OPT_KEYS.indexOf(tk.id + ":" + tk.word) >= 0 && !optOn(tk.id, tk.word)) return false;
      if (!tk.s) return true;
      return P.has("marker-s") && optOn("marker-s", BYID[tk.id].cat === "verbs" ? "verb" : "noun");
    });
  }

  // A sentence of exactly level L, or null if these cards can't make one.
  // Random choices may pick a marker the lesson lacks, so retry a few times.
  function sentenceAtLevel(P, L) {
    var tpls = TEMPLATES.filter(function (t) { return t.lvl === L && t.ok(P); });
    for (var i = 0; i < 80 && tpls.length; i++) {
      var tokens = rnd(tpls).make(P, L);
      if (usable(tokens, P)) return tokens;
    }
    return null;
  }

  function generateSentence() {
    var restrict = MODE === "board" && selected.size > 0;
    var P = makePools(restrict);
    var tokens = sentenceAtLevel(P, genLevel);
    if (!tokens) {
      var ok = [1, 2, 3, 4, 5, 6].filter(function (L) { return L !== genLevel && sentenceAtLevel(P, L); });
      toast(ok.length
        ? "No level " + genLevel + " sentence with these cards and ⚙️ options — try level " + ok.join(", ") + "."
        : "These cards and ⚙️ options can't make a sentence.", 3200);
      return;
    }
    var lets = tokens.some(function (tk) { return tk.word === "let's"; });
    if (!lets && chance(TIME.chance)) {
      var tp = timePhrase(P, genLevel);
      if (tp) tokens = tokens.concat(tp);
    }
    placeSentence(tokens);
  }

  // Lay the tokens out in one centred row, replacing the previous generated sentence.
  function placeSentence(tokens) {
    var GAP = 14;
    var bw = board.clientWidth, bh = board.clientHeight;
    var total = 0, n = 0;
    tokens.forEach(function (tk) { total += sizeFor(BYID[tk.id]); n++; });
    total += GAP * (n - 1);
    var k = Math.min(1, (bw - 60) / total);
    var x = (bw - total * k) / 2, cy = bh * 0.45;

    var old = Array.prototype.slice.call(cardsLayer.querySelectorAll(".inst.gen"));
    old.forEach(function (o) { o.remove(); });
    var made = [];
    tokens.forEach(function (tk) {
      var def = BYID[tk.id], size = sizeFor(def) * k;
      var node = spawnInstance(def, x + size / 2, cy, { size: size, word: tk.word, noHistory: true, noSelect: true });
      node.classList.add("gen");
      made.push(node);
      if (tk.s) {
        var sDef = BYID["marker-s"], ss = sizeFor(sDef) * k;
        var sn = spawnInstance(sDef, x + size - ss * 0.05, cy - size / 2 + ss * 0.12 + ss / 2,
          { size: ss, noHistory: true, noSelect: true });
        sn.classList.add("gen");
        made.push(sn);
      }
      x += size + GAP * k;
    });
    selectInstance(null);
    pushHistory(function () {
      made.forEach(function (m) { m.remove(); });
      old.forEach(function (o) { cardsLayer.appendChild(o); });
    });
  }

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

  // Tools sit in a drop-down; every session starts on Move (the tool is not saved).
  var toolMenu = document.querySelector(".tool-menu");
  var toolMenuBtn = document.getElementById("toolMenuBtn");
  function openToolMenu(open) {
    toolMenu.classList.toggle("open", open);
    toolMenuBtn.setAttribute("aria-expanded", String(open));
  }
  function setTool(t) {
    document.body.dataset.tool = t;
    document.querySelectorAll("button.tool").forEach(function (b) {
      var on = b.dataset.tool === t;
      b.classList.toggle("active", on);
      if (on) {
        document.getElementById("toolMenuIco").textContent = b.querySelector(".ico").textContent;
        document.getElementById("toolMenuTxt").textContent = b.textContent.replace(b.querySelector(".ico").textContent, "");
      }
    });
    if (t !== "move") selectInstance(null);
  }
  document.querySelectorAll("button.tool").forEach(function (b) {
    b.addEventListener("click", function () { setTool(b.dataset.tool); openToolMenu(false); });
  });
  toolMenuBtn.addEventListener("click", function (e) {
    e.stopPropagation(); openToolMenu(!toolMenu.classList.contains("open"));
  });
  document.addEventListener("pointerdown", function (e) {
    if (!toolMenu.contains(e.target)) openToolMenu(false);
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

  var levelInput = document.getElementById("genLevel");
  var levelVal = document.getElementById("genLevelVal");
  var sillyBtn = document.getElementById("sillyBtn");
  levelInput.value = genLevel; levelVal.textContent = genLevel;
  levelInput.addEventListener("input", function () {
    genLevel = +levelInput.value; levelVal.textContent = genLevel; LS.set("fcw_level", genLevel);
  });
  function refreshSilly() {
    sillyBtn.classList.toggle("active", silly);
    sillyBtn.setAttribute("aria-pressed", String(silly));
  }
  sillyBtn.addEventListener("click", function () { silly = !silly; LS.set("fcw_silly", silly); refreshSilly(); });
  refreshSilly();
  document.getElementById("genBtn").addEventListener("click", generateSentence);
  document.getElementById("readBtn").addEventListener("click", readBoard);

  document.addEventListener("keydown", function (e) {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if ((e.key === "Delete" || e.key === "Backspace") && selectedInst) {
      e.preventDefault(); removeInstance(selectedInst);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault(); var fn = undoStack.pop(); if (fn) fn();
    } else if (e.key === "p") setTool("pen");
    else if (e.key === "h") setTool("highlighter");
    else if (e.key === "e") setTool("eraser");
    else if (e.key === "v" || e.key === "Escape") { setTool("move"); openToolMenu(false); }
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
    return location.origin + location.pathname + "#s=" + encodeSelection(selected) + "&o=" + encodeOpts(wordOpts);
  }
  var shareWarn = document.getElementById("shareWarn");
  var shareExpiry = document.getElementById("shareExpiry");
  function showShareUrl(url) {
    urlInput.value = url;
    try { qrBox.innerHTML = window.QR.svg(url, { ecc: "M", border: 2 }); }
    catch (e) { qrBox.textContent = "QR error"; }
  }
  // On the PHP host the students' link is signed by the server (it works
  // without an account, until it expires): ask for one per card set + options.
  var serverLink = { key: null, url: "", exp: 0 };
  function refreshShare() {
    if (selected.size === 0) return;
    if (!SRV) { showShareUrl(shareUrl()); return; }
    var s = encodeSelection(selected), o = encodeOpts(wordOpts), key = s + "&" + o;
    if (serverLink.key === key && serverLink.exp > Date.now() / 1000 + 900) { showShareUrl(serverLink.url); return; }
    urlInput.value = "Making the link…";
    qrBox.innerHTML = "";
    fetch(SRV.api, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF": SRV.csrf },
      body: JSON.stringify({ s: s, o: o })
    }).then(function (r) {
      if (r.status === 401) throw new Error("login");
      if (!r.ok) throw new Error("http");
      return r.json();
    }).then(function (j) {
      serverLink = { key: key, url: location.origin + location.pathname + "?t=" + j.token, exp: j.exp };
      if (shareExpiry) {
        shareExpiry.textContent = "The students' link works until " + new Date(j.exp * 1000).toLocaleString("en-GB",
          { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + ".";
      }
      if (key === encodeSelection(selected) + "&" + encodeOpts(wordOpts)) showShareUrl(serverLink.url);
    }).catch(function (err) {
      urlInput.value = "";
      qrBox.textContent = err.message === "login"
        ? "You have been logged out: reload the page and log in again."
        : "Couldn't make the link. Check the connection and try again.";
    });
  }
  function openShare() {
    var empty = selected.size === 0;
    if (shareWarn) shareWarn.style.display = empty ? "block" : "none";
    qrBox.style.display = empty ? "none" : "";
    urlInput.value = "";
    refreshShare();
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
      a.href = location.origin + location.pathname + "#s=" + s.payload + (s.opts ? "&o=" + s.opts : "");
      var load = el("button", null, "Load");
      load.addEventListener("click", function () {
        selected = decodeSelection(s.payload);
        if (s.opts) { wordOpts = decodeOpts(s.opts); saveOpts(); }
        buildPalette(); syncHashFromSelection();
        refreshShare();
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
    var url = SRV ? urlInput.value : shareUrl();
    if (/^https?:/.test(url)) window.open(url, "_blank");
  });
  var setNameInput = document.getElementById("setName");
  document.getElementById("saveSetBtn").addEventListener("click", function () {
    if (selected.size === 0) { if (shareWarn) shareWarn.style.display = "block"; return; }
    var name = (setNameInput && setNameInput.value || "").trim();
    if (!name) { if (setNameInput) setNameInput.focus(); return; }
    var sets = LS.get("fcw_sets", []);
    sets.unshift({ name: name, payload: encodeSelection(selected), opts: encodeOpts(wordOpts), count: selected.size, ts: Date.now() });
    LS.set("fcw_sets", sets.slice(0, 30));
    if (setNameInput) setNameInput.value = "";
    renderSaved();
  });

  /* ---------- word options dialog (teacher only) ---------- */
  var optsOverlay = document.getElementById("optsOverlay");
  var optsBody = document.getElementById("optsBody");
  function renderOpts() {
    optsBody.innerHTML = "";
    OPT_GROUPS.forEach(function (g) {
      var box = el("div", "opt-group");
      var h = el("h3");
      h.appendChild(markerEl(BYID[g.id]));
      h.appendChild(document.createTextNode(g.label));
      box.appendChild(h);
      OPT_KEYS.forEach(function (k) {
        if (k.indexOf(g.id + ":") !== 0) return;
        var word = k.slice(g.id.length + 1);
        var lab = el("label");
        var cb = el("input"); cb.type = "checkbox"; cb.checked = wordOpts.has(k);
        cb.addEventListener("change", function () {
          if (cb.checked) wordOpts.add(k); else wordOpts.delete(k);
          var left = OPT_KEYS.filter(function (x) { return x.indexOf(g.id + ":") === 0 && wordOpts.has(x); });
          if (!left.length) { wordOpts.add(k); cb.checked = true; toast("Keep at least one."); }
          saveOpts();
        });
        lab.appendChild(cb);
        lab.appendChild(el("b", null, (g.names && g.names[word]) || word));
        lab.appendChild(el("span", "ex", g.ex[word] || ""));
        if (OPT_GEN.indexOf(k) >= 0) lab.appendChild(el("span", "gen", "🎲"));
        box.appendChild(lab);
      });
      optsBody.appendChild(box);
    });
  }
  document.getElementById("optsBtn").addEventListener("click", function () {
    renderOpts(); optsOverlay.classList.add("open");
  });
  document.getElementById("optsDone").addEventListener("click", function () { optsOverlay.classList.remove("open"); });
  document.getElementById("optsReset").addEventListener("click", function () {
    wordOpts = optsFromMap(null); saveOpts(); renderOpts();
  });
  optsOverlay.addEventListener("click", function (e) { if (e.target === optsOverlay) optsOverlay.classList.remove("open"); });

  /* ---------- deselect all (two taps: the first one arms the button) ---------- */
  var clearSelBtn = document.getElementById("clearSelBtn");
  clearSelBtn.addEventListener("click", function () {
    if (!selected.size) return;
    if (!clearSelBtn.classList.contains("armed")) {
      clearSelBtn.classList.add("armed"); clearSelBtn.textContent = "Tap again";
      clearTimeout(clearSelBtn._t);
      clearSelBtn._t = setTimeout(function () {
        clearSelBtn.classList.remove("armed"); clearSelBtn.textContent = "Deselect all";
      }, 3000);
      return;
    }
    clearTimeout(clearSelBtn._t);
    clearSelBtn.classList.remove("armed"); clearSelBtn.textContent = "Deselect all";
    selected.clear();
    paletteScroll.querySelectorAll(".pcard.on").forEach(function (c) { c.classList.remove("on"); });
    refreshCounts(); syncHashFromSelection();
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

  // Switch teacher/student view live, without a reload (reload + localStorage
  // are both unreliable inside the sandboxed Artifact frame).
  function applyMode(m) {
    MODE = m;
    document.body.dataset.mode = m;
    if (m === "builder" && selected.size === 0 && embeddedSet) selected = new Set(embeddedSet);
    buildPalette();
    refreshModeNote();
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
    var toggle = el("button", "teacher-toggle");
    function refreshToggle() {
      toggle.textContent = MODE === "builder"
        ? "◂ Done — show the student view"
        : "Set up the lesson (teacher) ▸";
    }
    toggle.addEventListener("click", function () {
      var next = MODE === "builder" ? "board" : "builder";
      try { LS.set("fcw_teacher", next === "builder"); } catch (e) {}
      applyMode(next);
      refreshToggle();
      if (next === "builder") toast("Teacher setup — pick cards, then Push to class", 2600);
    });
    refreshToggle();
    document.body.appendChild(toggle);
  }

  /* ---------- account links (PHP host, teacher) ---------- */
  if (SRV && SRV.mode === "builder" && SRV.links) {
    var acct = el("span", "account");
    var who = el("span", "who", SRV.user ? SRV.user.name : "");
    acct.appendChild(who);
    var links = [["Account", SRV.links.account]];
    if (SRV.user && SRV.user.admin) links.push(["Users", SRV.links.admin]);
    links.push(["Log out", SRV.links.logout]);
    links.forEach(function (l) { var a = el("a", null, l[0]); a.href = l[1]; acct.appendChild(a); });
    var bar = document.querySelector("header.toolbar");
    bar.insertBefore(acct, document.getElementById("shareBtn"));
    if (SRV.feedback) {
      var fbBtn = el("a", "feedback-btn", "Segnala");
      fbBtn.href = "#";
      fbBtn.title = "Segnala un problema o chiedi una modifica";
      fbBtn.addEventListener("click", function (e) { e.preventDefault(); openFeedback(); });
      acct.insertBefore(fbBtn, acct.firstChild.nextSibling);
    }
  }

  /* ---------- feedback dialog (PHP host, teacher; Italian: it is for the teachers) ---------- */
  var fbOverlay = null;
  function openFeedback() {
    if (!fbOverlay) {
      fbOverlay = el("div", "overlay");
      fbOverlay.id = "fbOverlay";
      fbOverlay.innerHTML =
        '<div class="dialog fb-dialog"><h2>Segnala un problema o chiedi una modifica</h2>' +
        '<p class="hint">Arriva a chi sviluppa la lavagna. Il messaggio include il tuo nome e la tua email, ' +
        'così può risponderti, e alcuni dati tecnici (browser, schermo, carte selezionate).</p>' +
        '<div class="fb-type"><label><input type="radio" name="fbType" value="bug" checked> Qualcosa non funziona</label>' +
        '<label><input type="radio" name="fbType" value="change"> Vorrei una modifica</label></div>' +
        '<div class="fb-text"><textarea id="fbText" rows="6" maxlength="5000" placeholder="Che cosa stavi facendo, che cosa è successo, che cosa ti aspettavi…"></textarea></div>' +
        '<p id="fbMsg" class="hint fb-msg"></p>' +
        '<div class="row"><button id="fbCancel">Annulla</button><button id="fbSend" class="primary">Invia</button></div></div>';
      document.body.appendChild(fbOverlay);
      fbOverlay.addEventListener("click", function (e) { if (e.target === fbOverlay) fbOverlay.classList.remove("open"); });
      document.getElementById("fbCancel").addEventListener("click", function () { fbOverlay.classList.remove("open"); });
      document.getElementById("fbSend").addEventListener("click", sendFeedback);
    }
    document.getElementById("fbMsg").textContent = "";
    document.getElementById("fbSend").disabled = false;
    fbOverlay.classList.add("open");
    setTimeout(function () { document.getElementById("fbText").focus(); }, 50);
  }
  function sendFeedback() {
    var text = document.getElementById("fbText").value.trim();
    var msg = document.getElementById("fbMsg");
    if (!text) { msg.textContent = "Scrivi che cosa è successo o che cosa vorresti."; return; }
    var type = (document.querySelector('input[name="fbType"]:checked') || {}).value || "bug";
    var send = document.getElementById("fbSend");
    send.disabled = true;
    msg.textContent = "Invio…";
    fetch(SRV.feedback, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF": SRV.csrf },
      body: JSON.stringify({ type: type, text: text, ctx: {
        ua: navigator.userAgent, screen: screen.width + "x" + screen.height + " (finestra " + innerWidth + "x" + innerHeight + ")",
        mode: MODE, cards: selected.size + " selezionate", level: String(genLevel) } })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j }; });
    }).then(function (res) {
      if (res.status === 200) {
        document.getElementById("fbText").value = "";
        fbOverlay.classList.remove("open");
        toast("Grazie! Segnalazione inviata.", 2600);
        return;
      }
      send.disabled = false;
      msg.textContent = res.status === 401 ? "Sei uscito: ricarica la pagina e accedi di nuovo (copia prima il testo)."
        : (res.j && res.j.error) || "Invio non riuscito: riprova tra poco.";
    }).catch(function () {
      send.disabled = false;
      msg.textContent = "Invio non riuscito: controlla la connessione e riprova.";
    });
  }

  /* ---------- init ---------- */
  buildPalette();
  setTool("move");
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
