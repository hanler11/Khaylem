// khaylem.js — script separado para Pangea interactiva
(function () {
  const svg = document.getElementById("svg");
  const pangea = document.getElementById("pangea");
  const continents = Array.from(document.querySelectorAll(".continent"));
  const resetBtn = document.getElementById("reset");
  const hintBtn = document.getElementById("hint");
  // optional bottom reset button placed in the footer area
  const resetBottomBtn = document.getElementById("reset-bottom");

  // Map each continent id to the image file you added in Images/
  const imageMap = {
    africa: "Images/africa.png",
    europa: "Images/europa.png",
    asia: "Images/asia.png",
    america: "Images/america.png",
    antartida: "Images/antartida.png",
  };

  // Guardamos estado original para reinicio
  const state = new Map();
  continents.forEach((g) => {
    state.set(g.dataset.id, { transform: g.getAttribute("transform") || "" });
  });

  // Dragging variables
  let dragging = null; // {el, startPoint(svg coords), origTransform, currentTranslate: {x,y}}
  const splitThreshold = 180; // px de distancia desde su origen para separar
  let cinematicPlaying = false;
  // Allow automatic split when a continent is dropped far from center.
  // Set to false to require explicit split (dblclick or button). User requested
  // to be able to move continents anywhere without them auto-splitting.
  let autoSplitEnabled = false;
  let originalTransformsSaved = true; // state map already holds originals

  // Assemble all continents close to the center to form Pangea-like cluster
  function assemblePangea() {
    try {
      const centerX = 1200 / 2;
      const centerY = 800 / 2;
      const radius = 30; // small packing radius
      const n = continents.length;
      continents.forEach((g, i) => {
        // compute small circular placement near center
        const angle = (i / n) * Math.PI * 2;
        const tx = Math.round(Math.cos(angle) * radius - 40);
        const ty = Math.round(Math.sin(angle) * radius);
        g.setAttribute("transform", `translate(${tx},${ty})`);
      });
      // update labels positions after assembling
      updateAllLabels();
      // center the whole pangea group in the svg viewBox
      try {
        const base = parseTranslate(pangea.getAttribute("transform"));
        const b = pangea.getBBox();
        const dx = centerX - (b.x + b.width / 2);
        const dy = centerY - (b.y + b.height / 2);
        pangea.setAttribute(
          "transform",
          `translate(${base.x + dx},${base.y + dy})`
        );
      } catch (e) {}
    } catch (e) {
      console.warn("assemblePangea failed", e);
    }
  }

  // Labels: posicionar nombre centrado dentro de cada continente
  function updateLabelFor(g) {
    if (!g) return;
    // position single or multiple label elements inside the continent
    const labels = Array.from(g.querySelectorAll(".label"));
    if (labels.length === 0) return;
    try {
      const b = g.getBBox();
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      labels.forEach((l) => {
        const sub = l.getAttribute("data-sub");
        if (sub === "norte") {
          l.setAttribute("x", cx);
          l.setAttribute("y", cy - 18);
        } else if (sub === "sur") {
          l.setAttribute("x", cx);
          l.setAttribute("y", cy + 18);
        } else {
          l.setAttribute("x", cx);
          l.setAttribute("y", cy);
        }
      });
    } catch (e) {
      // getBBox can throw on disconnected nodes in some cases; ignore
    }
  }

  function updateAllLabels() {
    continents.forEach((g) => updateLabelFor(g));
    // After labels/geometry are settled, create texture patterns for each piece
    setTimeout(createPatternsFromImages, 60);
    // Also create overlay labels so they remain visible and attached
    setTimeout(() => {
      // refresh positions of SVG labels now that geometry has settled
      try {
        continents.forEach((g) => updateLabelFor(g));
      } catch (e) {}
    }, 140);
  }

  // create starfield in the background (simple DOM stars)
  function makeStars(count = 120) {
    const wrap = document.getElementById("stars");
    if (!wrap) return;
    const style = document.createElement("style");
    style.textContent = `@keyframes twinkle{0%,100%{opacity:0.3}50%{opacity:1}}`;
    document.head.appendChild(style);
    for (let i = 0; i < count; i++) {
      const s = document.createElement("div");
      s.className = "star";
      const size = Math.random() * 2 + 0.6;
      s.style.width = size + "px";
      s.style.height = size + "px";
      s.style.background = "white";
      s.style.borderRadius = "50%";
      s.style.position = "absolute";
      s.style.left = Math.random() * 100 + "%";
      s.style.top = Math.random() * 100 + "%";
      s.style.opacity = (Math.random() * 0.7 + 0.2).toString();
      s.style.animation = `twinkle ${Math.random() * 4 + 2}s infinite`;
      wrap.appendChild(s);
    }
  }

  // LABEL OVERLAY: fallback HTML labels positioned over SVG for robust tracking
  function ensureLabelOverlay() {
    // Previously this created an HTML overlay container. That caused
    // detached/misplaced labels in some browsers (labels stuck at 0,0).
    // We no longer create the overlay element automatically. Return the
    // existing container if present; otherwise return null so callers
    // that check for the container won't create overlays.
    return document.getElementById("label-overlay") || null;
  }

  function svgPointToScreen(x, y) {
    const pt = svg.createSVGPoint();
    pt.x = x;
    pt.y = y;
    const screenPt = pt.matrixTransform(svg.getScreenCTM());
    return { x: screenPt.x, y: screenPt.y };
  }

  // Position an overlay label node relative to the #stage container.
  // Shows the node only when the target point is inside the visible stage area.
  function positionOverlayNode(node, el) {
    try {
      const stage = document.getElementById("stage");
      if (!stage || !node || !el) return;
      const srect = stage.getBoundingClientRect();
      // Prefer SVG bbox (user-space), fallback to DOM rect
      let screenX, screenY;
      try {
        const bb = el.getBBox();
        const cx = bb.x + bb.width / 2;
        const cy = bb.y + bb.height / 2;
        const p = svgPointToScreen(cx, cy);
        screenX = p.x;
        screenY = p.y;
      } catch (e) {
        const r = el.getBoundingClientRect();
        screenX = r.left + r.width / 2;
        screenY = r.top + r.height / 2;
      }
      const left = screenX - srect.left;
      const top = screenY - srect.top - 8; // small upward offset
      // if within stage bounds show, otherwise hide/remove
      if (
        !isNaN(left) &&
        !isNaN(top) &&
        left >= 0 &&
        left <= srect.width &&
        top >= 0 &&
        top <= srect.height
      ) {
        node.style.left = left + "px";
        node.style.top = top + "px";
        node.style.visibility = "visible";
        node.style.display = "";
      } else {
        // If coordinates are invalid or outside bounds, hide and mark for cleanup.
        node.style.visibility = "hidden";
        node.style.display = "none";
      }
    } catch (e) {
      // ignore
    }
  }

  function refreshAllOverlayPositions() {
    try {
      ensureLabelOverlay();
      const overlay = document.getElementById("label-overlay");
      if (!overlay) return;
      continents.forEach((g) => {
        try {
          const id = g.dataset.id || Math.random().toString(36).slice(2, 7);
          let node = overlay.querySelector(`[data-ov="${id}"]`);
          if (!node) {
            // create minimal node if missing
            node = document.createElement("div");
            node.setAttribute("data-ov", id);
            node.className = "overlay-label";
            node.style.position = "absolute";
            node.style.transform = "translate(-50%,-50%)";
            node.style.padding = "4px 8px";
            node.style.background = "rgba(0,0,0,0.45)";
            node.style.borderRadius = "6px";
            node.style.fontSize = "13px";
            node.style.color = "#e9f9ff";
            node.style.pointerEvents = "none";
            node.style.visibility = "hidden";
            node.textContent =
              g.dataset.name ||
              Array.from(g.querySelectorAll(".label"))
                .map((l) => l.textContent || "")
                .join(" / ") ||
              id;
            overlay.appendChild(node);
          }
          positionOverlayNode(node, g);
        } catch (e) {}
      });
    } catch (e) {}
  }

  function updateOverlayLabelFor(el) {
    try {
      const overlay = ensureLabelOverlay();
      const id = el.dataset.id || Math.random().toString(36).slice(2, 7);
      const labelTexts = Array.from(el.querySelectorAll(".label"))
        .map((l) => (l.textContent || "").trim())
        .filter(Boolean);
      const text = labelTexts.length
        ? labelTexts.join(" / ")
        : el.dataset.name || id;
      let node = overlay.querySelector(`[data-ov="${id}"]`);
      if (!node) {
        node = document.createElement("div");
        node.setAttribute("data-ov", id);
        node.className = "overlay-label";
        node.style.position = "absolute";
        node.style.visibility = "hidden";
        node.style.transform = "translate(-50%,-50%)";
        node.style.padding = "4px 8px";
        node.style.background = "rgba(0,0,0,0.45)";
        node.style.borderRadius = "6px";
        node.style.fontSize = "13px";
        node.style.color = "#e9f9ff";
        node.textContent = text;
        node.style.pointerEvents = "none";
        // append to overlay before measuring/positioning so getBoundingClientRect works
        try {
          overlay.appendChild(node);
        } catch (e) {}
        // position via centralized helper (handles bbox and fallbacks)
        try {
          positionOverlayNode(node, el);
        } catch (e) {
          // schedule a retry if position fails
          setTimeout(() => {
            try {
              positionOverlayNode(node, el);
            } catch (err) {}
          }, 120);
        }
      } else {
        // update text and reposition existing node
        try {
          node.textContent = text;
        } catch (e) {}
        try {
          positionOverlayNode(node, el);
        } catch (e) {
          setTimeout(() => {
            try {
              positionOverlayNode(node, el);
            } catch (err) {}
          }, 120);
        }
      }
    } catch (e) {
      // fallback: ignore
    }
  }

  // Ensure every continent has an overlay label node (used at init)
  function createOverlayForAll() {
    try {
      ensureLabelOverlay();
      continents.forEach((g) => {
        try {
          updateLabelFor(g);
          const id = g.dataset.id;
          const overlay = document.getElementById("label-overlay");
          if (overlay && id) {
            const node = overlay.querySelector(`[data-ov="${id}"]`);
            if (!node) {
              const n = document.createElement("div");
              n.setAttribute("data-ov", id);
              n.className = "overlay-label";
              n.style.position = "absolute";
              n.style.transform = "translate(-50%,-50%)";
              n.style.padding = "4px 8px";
              n.style.background = "rgba(0,0,0,0.45)";
              n.style.borderRadius = "6px";
              n.style.fontSize = "13px";
              n.style.color = "#e9f9ff";
              n.style.pointerEvents = "none";
              n.textContent =
                g.dataset.name ||
                Array.from(g.querySelectorAll(".label"))
                  .map((l) => l.textContent || "")
                  .join(" / ") ||
                id;
              overlay.appendChild(n);
              try {
                updateLabelFor(g);
              } catch (e) {}
            }
          }
        } catch (e) {}
      });
    } catch (e) {}
    // cleanup: remove any overlay labels that are stuck at the very top-left
    try {
      const overlay = document.getElementById("label-overlay");
      if (overlay) {
        Array.from(overlay.children).forEach((n) => {
          try {
            const rect = n.getBoundingClientRect();
            const stage = document.getElementById("stage");
            const srect = stage
              ? stage.getBoundingClientRect()
              : { left: 0, top: 0 };
            const left = rect.left - srect.left;
            const top = rect.top - srect.top;
            // if a label is less than 80px from the left edge and near the top,
            // it's likely mis-positioned and should be hidden to avoid the left column
            if (left < 80 && top < 80) {
              n.style.display = "none";
            }
          } catch (e) {}
        });
      }
    } catch (e) {}
  }

  // Remove any overlay labels that are still stuck near the top-left of the stage.
  function removeStuckLeftLabels() {
    try {
      const overlay = document.getElementById("label-overlay");
      const stage = document.getElementById("stage");
      if (!overlay || !stage) return;
      const srect = stage.getBoundingClientRect();
      Array.from(overlay.children).forEach((n) => {
        try {
          const r = n.getBoundingClientRect();
          const left = r.left - srect.left;
          const top = r.top - srect.top;
          if (isNaN(left) || isNaN(top)) {
            // remove invalid nodes
            try {
              overlay.removeChild(n);
            } catch (e) {}
            return;
          }
          // Use a more conservative threshold: if label is very close to top-left
          // it's almost certainly mis-positioned — remove it entirely to avoid left-column
          const LEFT_THRESHOLD = 140;
          const TOP_THRESHOLD = 140;
          if (left < LEFT_THRESHOLD && top < TOP_THRESHOLD) {
            try {
              overlay.removeChild(n);
            } catch (e) {}
          }
        } catch (e) {}
      });
    } catch (e) {}
  }

  // Create clipped <image> for each piece using the bitmap images you added
  function createPatternsFromImages() {
    // normaliza rutas relativas para evitar que el navegador resuelva a la raíz
    function normalizeHref(h) {
      if (!h) return h;
      // si ya es absoluta o empieza con ./ or ../ o / o http(s) dejamos tal cual
      if (/^(https?:|\/|\.\/|\.\.)/.test(h)) return h;
      return "./" + h;
    }
    const defs =
      svg.querySelector("defs") ||
      (function () {
        const d = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "defs"
        );
        svg.insertBefore(d, svg.firstChild);
        return d;
      })();

    // clear old clips/images created by this script to avoid duplicates
    Array.from(defs.querySelectorAll('[id^="clip-"]')).forEach((n) =>
      n.remove()
    );
    Array.from(svg.querySelectorAll('image[id^="img-"]')).forEach((n) =>
      n.remove()
    );

    // Gather unique image hrefs required (normalized)
    const hrefs = new Set();
    continents.forEach((g) => {
      const id = g.dataset.id;
      const h = imageMap[id];
      if (h) hrefs.add(normalizeHref(h));
    });

    // Preload all images first; if some fail, we'll fallback to gradients for those continents
    const loads = Array.from(hrefs).map((h) =>
      preloadImage(h)
        .then(() => ({ href: h, ok: true }))
        .catch((err) => {
          console.warn("preload failed:", h, err && err.message);
          return { href: h, ok: false };
        })
    );

    Promise.all(loads)
      .then((results) => {
        const available = new Set(
          results.filter((r) => r.ok).map((r) => r.href)
        );
        // image debug panel removed (not shown to user)
        continents.forEach((g) => {
          const id = g.dataset.id;
          const pieces = Array.from(g.querySelectorAll(".piece"));
          pieces.forEach((p, i) => {
            try {
              const b = p.getBBox();
              const pid = `piece-${id}-${i}`;
              if (!p.id) p.id = pid;
              const raw = imageMap[id];
              const href = normalizeHref(raw);
              if (!href || !available.has(href)) {
                // leave existing fill (gradients) if image unavailable
                return;
              }

              // Create a pattern in defs and use it as the fill for the piece.
              // patternUnits='userSpaceOnUse' so we can map the image to the piece bbox.
              const patId = `pat-${pid}`;
              // remove existing pattern if any
              const existingPat = defs.querySelector(`#${patId}`);
              if (existingPat) existingPat.remove();

              const pattern = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "pattern"
              );
              pattern.setAttribute("id", patId);
              pattern.setAttribute("patternUnits", "userSpaceOnUse");
              // ensure the pattern's content uses the same user-space coordinates
              pattern.setAttribute("patternContentUnits", "userSpaceOnUse");
              pattern.setAttribute("x", b.x);
              pattern.setAttribute("y", b.y);
              pattern.setAttribute("width", Math.max(2, b.width));
              pattern.setAttribute("height", Math.max(2, b.height));

              const img = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "image"
              );
              img.setAttribute("id", `img-${pid}`);
              img.setAttribute("href", href);
              try {
                img.setAttributeNS(
                  "http://www.w3.org/1999/xlink",
                  "xlink:href",
                  href
                );
              } catch (e) {}
              // image inside pattern positioned at 0,0 relative to pattern
              img.setAttribute("x", 0);
              img.setAttribute("y", 0);
              img.setAttribute("width", Math.max(2, b.width));
              img.setAttribute("height", Math.max(2, b.height));
              img.setAttribute("preserveAspectRatio", "xMidYMid slice");
              img.style.pointerEvents = "none";
              // when the image inside the pattern finishes loading, apply the fill
              img.addEventListener("load", () => {
                try {
                  // set both presentation attribute and inline style to increase compatibility
                  p.setAttribute("fill", `url(#${patId})`);
                  p.style.fill = `url(#${patId})`;
                  p.setAttribute("stroke", "rgba(6,52,58,0.85)");
                  p.setAttribute("stroke-width", "1.5");
                  console.log("pattern image loaded for", id, pid, href);
                } catch (e) {
                  console.warn("error applying pattern fill", e);
                }
              });
              img.addEventListener("error", (e) => {
                console.warn("svg image load error for pattern:", href, e);
              });
              pattern.appendChild(img);
              defs.appendChild(pattern);
              // If the image was already cached and the load event didn't fire, try a short retry
              setTimeout(() => {
                if (
                  !p.getAttribute("fill") ||
                  p.getAttribute("fill") === "none"
                ) {
                  try {
                    p.setAttribute("fill", `url(#${patId})`);
                    p.style.fill = `url(#${patId})`;
                    console.log("applied pattern (timeout) for", id, pid, href);
                  } catch (e) {}
                }
              }, 120);
            } catch (e) {
              // ignore bbox errors
            }
          });
        });
      })
      .catch(() => {
        // if preload overall fails, do nothing and keep gradients
      });
  }

  function getPoint(evt) {
    const pt = svg.createSVGPoint();
    if (evt.touches)
      (pt.x = evt.touches[0].clientX), (pt.y = evt.touches[0].clientY);
    else (pt.x = evt.clientX), (pt.y = evt.clientY);
    const ctm = svg.getScreenCTM().inverse();
    return pt.matrixTransform(ctm);
  }

  function parseTranslate(transform) {
    if (!transform) return { x: 0, y: 0 };
    const m = /translate\(([-0-9\.]+)[, ]+([-0-9\.]+)\)/.exec(transform);
    if (m) return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
    return { x: 0, y: 0 };
  }

  function setTranslate(el, x, y) {
    // keep existing rotate/scale (not used here) but we set translate
    el.setAttribute("transform", `translate(${x},${y})`);
  }

  function startDrag(evt) {
    if (cinematicPlaying) return; // desactivar arrastre durante cinemática
    evt.preventDefault();
    const target = evt.currentTarget;
    const pt = getPoint(evt);
    const tr = target.getAttribute("transform");
    const base = parseTranslate(tr);
    dragging = { el: target, start: pt, base };
    // raise element visually by applying filter
    target.querySelectorAll(".piece").forEach((p) => p.classList.add("glow"));
    // ensure label stays centered while dragging starts
    updateLabelFor(target);
    // update overlay label while dragging
    try {
      updateLabelFor(target);
    } catch (e) {}
  }

  function onMove(evt) {
    if (!dragging) return;
    evt.preventDefault();
    const pt = getPoint(evt);
    const dx = pt.x - dragging.start.x;
    const dy = pt.y - dragging.start.y;
    const nx = dragging.base.x + dx;
    const ny = dragging.base.y + dy;
    setTranslate(dragging.el, nx, ny);
    dragging.current = { x: nx, y: ny };
    // update only this continent's label to keep it centered
    updateLabelFor(dragging.el);
    try {
      updateLabelFor(dragging.el);
    } catch (e) {}
  }

  function endDrag(evt) {
    if (!dragging) return;
    const el = dragging.el;
    el.querySelectorAll(".piece").forEach((p) => p.classList.remove("glow"));
    const id = el.dataset.id;
    const origin = state.get(id)
      ? parseTranslate(state.get(id).transform)
      : { x: 0, y: 0 };
    const cur = dragging.current || dragging.base;
    // movement since drag start (to avoid accidental tiny moves triggering split)
    const moved = Math.hypot(
      cur.x - dragging.start.x,
      cur.y - dragging.start.y
    );

    // compute distance from the Pangea center to decide split only when far away
    let distToPangea = 0;
    try {
      const pb = pangea.getBBox();
      const pbase = parseTranslate(pangea.getAttribute("transform"));
      const pcenterX = pbase.x + pb.x + pb.width / 2;
      const pcenterY = pbase.y + pb.y + pb.height / 2;
      distToPangea = Math.hypot(cur.x - pcenterX, cur.y - pcenterY);
    } catch (e) {
      // fallback: use origin-based distance
      distToPangea = Math.hypot(cur.x - origin.x, cur.y - origin.y);
    }

    // require both: user moved the piece a minimum amount AND dropped it far from Pangea center
    const minMoveToConsider = 36; // px user must move to consider splitting
    if (
      autoSplitEnabled &&
      moved > minMoveToConsider &&
      distToPangea > splitThreshold
    ) {
      try {
        splitContinent(el, cur, distToPangea);
      } catch (e) {}
    }

    // ensure overlay label exists and follows this element
    try {
      updateLabelFor(el);
    } catch (e) {}
    dragging = null;
  }

  function splitContinent(g, translate, dist) {
    // Convert NodeList of pieces to array
    const pieces = Array.from(g.querySelectorAll(".piece"));
    // create a legend entry for this continent (so name remains visible)
    const legend = document.getElementById("legend");
    if (legend) {
      const id = g.dataset.id;
      if (!legend.querySelector(`[data-legend="${id}"]`)) {
        const item = document.createElement("div");
        item.className = "item";
        item.setAttribute("data-legend", id);
        const sw = document.createElement("div");
        sw.className = "swatch";
        sw.style.background = "linear-gradient(180deg,#739f4a,#caa26d)";
        const nm = document.createElement("div");
        nm.className = "name";
        const labelEls = Array.from(g.querySelectorAll(".label"))
          .map((l) => (l.textContent || "").trim())
          .filter(Boolean);
        if (labelEls.length > 0) nm.textContent = labelEls.join(" / ");
        else nm.textContent = g.dataset.name || `Continente ${id}`;
        item.appendChild(sw);
        item.appendChild(nm);
        item.style.transform = "translateX(12px)";
        legend.appendChild(item);
        setTimeout(() => {
          item.style.transition =
            "transform 420ms cubic-bezier(.2,.9,.3,1), background 300ms";
          item.style.transform = "translateX(0)";
        }, 40);
      }
    }

    // Create a new continent wrapper that will replace the original group so it remains draggable
    const wrapper = document.createElementNS("http://www.w3.org/2000/svg", "g");
    wrapper.classList.add("continent");
    wrapper.setAttribute("data-id", g.dataset.id || "");
    if (g.dataset.name) wrapper.setAttribute("data-name", g.dataset.name);
    // start wrapper at the same transform as the original group
    const baseTr = g.getAttribute("transform") || "";
    wrapper.setAttribute("transform", baseTr);
    wrapper.style.cursor = "grab";
    // clone and append label elements so the name remains visible and moves with the group
    Array.from(g.querySelectorAll(".label")).forEach((lbl) => {
      const c = lbl.cloneNode(true);
      c.style.pointerEvents = "none";
      wrapper.appendChild(c);
    });

    svg.appendChild(wrapper);

    // Attach drag listeners to the new wrapper so it can be moved later
    wrapper.addEventListener("mousedown", startDrag);
    wrapper.addEventListener("touchstart", startDrag, { passive: false });
    wrapper.addEventListener("dblclick", () => {
      const tr = parseTranslate(wrapper.getAttribute("transform"));
      splitContinent(wrapper, tr, splitThreshold + 50);
    });
    // include new wrapper in the continents array so future toggles include it
    continents.push(wrapper);
    // remember this wrapper's current transform as the new origin so future
    // drag distance is measured relative to where it started (prevents
    // immediate split if user grabs it after an animation)
    try {
      const id = wrapper.dataset.id;
      if (id)
        state.set(id, { transform: wrapper.getAttribute("transform") || "" });
    } catch (e) {}
    // create/update overlay label for this new wrapper immediately so it doesn't
    // momentarily disappear when the original group is removed
    try {
      updateLabelFor(wrapper);
    } catch (e) {}

    // stagger pieces' animations for a cinematic effect; pieces go into wrapper
    pieces.forEach((p, i) => {
      const clone = p.cloneNode(true);
      const pieceWrap = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "g"
      );
      pieceWrap.classList.add("floating");
      // compute some base position from group's transform and piece bbox
      const groupBase = parseTranslate(g.getAttribute("transform"));
      const pieceBox = p.getBBox();
      const baseX = (groupBase.x || 0) + (pieceBox.x + pieceBox.width / 2);
      const baseY = (groupBase.y || 0) + (pieceBox.y + pieceBox.height / 2);
      const angle =
        Math.PI * 2 * (i / Math.max(1, pieces.length)) +
        (Math.random() - 0.5) * 0.6;
      // limit strength so pieces remain visible inside the viewBox (smaller)
      // reduce multiplier on `dist` so long drags don't catapult pieces far away
      const strength = Math.min(
        40,
        18 + Math.random() * 12 + (dist || 0) * 0.02
      );
      const tx = baseX + Math.cos(angle) * 8;
      const ty = baseY + Math.sin(angle) * 8;
      pieceWrap.appendChild(clone);
      // set initial transform relative to svg (wrapper has same transform so pieces align)
      pieceWrap.setAttribute("transform", `translate(${tx},${ty})`);
      clone.style.opacity = "0";
      wrapper.appendChild(pieceWrap);

      // staggered launch
      setTimeout(() => {
        let outX = tx + Math.cos(angle) * strength;
        let outY = ty + Math.sin(angle) * strength;
        // clamp to svg viewBox (safe margins)
        const minX = 40;
        const maxX = 1200 - 40;
        const minY = 40;
        const maxY = 800 - 40;
        outX = Math.max(minX, Math.min(maxX, outX));
        outY = Math.max(minY, Math.min(maxY, outY));
        pieceWrap.style.transition =
          "transform 1.3s cubic-bezier(.2,.9,.3,1), opacity 900ms, filter 900ms";
        clone.style.opacity = "1";
        pieceWrap.setAttribute(
          "transform",
          `translate(${outX},${outY}) rotate(${
            (Math.random() - 0.5) * 20
          }) scale(${1 + Math.random() * 0.04})`
        );
      }, i * 120);
    });

    // after animations complete, ensure wrapper stays within viewBox and labels are centered
    const finishDelay = pieces.length * 120 + 900;
    setTimeout(() => {
      try {
        const wb = wrapper.getBBox();
        const centerX = wb.x + wb.width / 2;
        const centerY = wb.y + wb.height / 2;
        // viewBox margins to keep everything visible
        const minX = 80;
        const maxX = 1200 - 80;
        const minY = 80;
        const maxY = 800 - 80;
        let dx = 0,
          dy = 0;
        if (centerX < minX) dx = minX - centerX;
        else if (centerX > maxX) dx = maxX - centerX;
        if (centerY < minY) dy = minY - centerY;
        else if (centerY > maxY) dy = maxY - centerY;
        if (dx !== 0 || dy !== 0) {
          // adjust existing transform
          const base = parseTranslate(wrapper.getAttribute("transform"));
          wrapper.style.transition = "transform 700ms cubic-bezier(.2,.9,.3,1)";
          wrapper.setAttribute(
            "transform",
            `translate(${base.x + dx},${base.y + dy})`
          );
        }
        // reposition labels to the wrapper bbox
        updateLabelFor(wrapper);
        try {
          updateLabelFor(wrapper);
        } catch (e) {}
      } catch (e) {
        // ignore bbox errors
      }
    }, finishDelay);

    // Fade and remove original group after animations start
    g.style.transition = "opacity 600ms";
    g.style.opacity = 0;
    setTimeout(() => g.remove(), 1100);
  }

  // Attach pointer/touch events to each continent
  continents.forEach((g) => {
    // enable pointer capture using mouse/touch
    g.style.cursor = "grab";
    // initial transform present in markup
    g.addEventListener("mousedown", startDrag);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", endDrag);
    // touch
    g.addEventListener("touchstart", startDrag, { passive: false });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", endDrag);
  });

  // Helper: preload an image and return a Promise
  function preloadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(src);
      img.onerror = () => reject(new Error("failed to load " + src));
      img.src = src;
    });
  }

  // Initialize after window load to ensure images load reliably (file:// and HTTP differences)
  function init() {
    updateAllLabels();
    makeStars(140);
    // start assembled in center
    assemblePangea();
    createPatternsFromImages();
    // ensure overlay labels exist for every continent (so names are always visible)
    setTimeout(() => {
      try {
        // Remove any HTML overlay container (we'll use SVG text labels instead)
        const ov = document.getElementById("label-overlay");
        if (ov) ov.remove();
      } catch (e) {}
      // Ensure SVG text labels are visible and styled. Using SVG <text>
      // keeps labels in the same coordinate system as continents so they
      // always follow the groups when transformed or dragged.
      try {
        Array.from(document.querySelectorAll(".label")).forEach((l) => {
          l.style.display = "";
          l.setAttribute("fill", "#ffffff");
          l.setAttribute("stroke", "#06343a");
          l.setAttribute("stroke-width", "2");
          l.setAttribute("paint-order", "stroke");
        });
        // refresh their positions
        continents.forEach((g) => updateLabelFor(g));
      } catch (e) {}
    }, 200);
    // play a short cinematic 'video' where continents separate automatically
    setTimeout(() => {
      try {
        playCinematic();
      } catch (e) {
        console.warn("cinematic failed", e);
      }
    }, 900);
    // After init finish, do a forced cleanup of any overlays still at top-left
    setTimeout(() => {
      try {
        refreshAllOverlayPositions();
        removeStuckLeftLabels();
      } catch (e) {}
    }, 700);
  }

  window.addEventListener("load", init);

  // keep overlay positions up-to-date on resize/scroll/orientation changes
  try {
    window.addEventListener("resize", () => {
      try {
        refreshAllOverlayPositions();
        removeStuckLeftLabels();
      } catch (e) {}
    });
    window.addEventListener("orientationchange", () => {
      try {
        refreshAllOverlayPositions();
        removeStuckLeftLabels();
      } catch (e) {}
    });
    // capture scroll events at capture phase so overlays update when the page scrolls
    window.addEventListener(
      "scroll",
      () => {
        try {
          refreshAllOverlayPositions();
        } catch (e) {}
      },
      true
    );
  } catch (e) {}

  // Cinematic: sequentially split continents like a short video
  function playCinematic() {
    if (cinematicPlaying) return;
    cinematicPlaying = true;
    // disable pointer events while playing
    continents.forEach((g) => (g.style.pointerEvents = "none"));

    // small camera/tween effect on the pangea group
    try {
      // apply a CSS transform to the svg viewport to simulate camera zoom/pan
      const svgEl = document.getElementById("svg");
      svgEl.style.transition = "transform 900ms cubic-bezier(.2,.9,.2,1)";
      svgEl.style.transformOrigin = "50% 45%";
      svgEl.style.transform = "scale(1.06) translateX(-28px)";
    } catch (e) {}

    // Deterministic final layout: move each continent to a fixed target so they
    // visibly separate (no automatic fragmentation). The user asked that they
    // just split apart — not shatter — so we move groups to target offsets and
    // keep them draggable and labeled.
    const order = continents.slice();
    const targetOffsets = {
      africa: [-140, 20],
      europa: [-60, -140],
      asia: [140, -60],
      america: [-240, -40],
      antartida: [40, 200],
    };

    order.forEach((g, i) => {
      setTimeout(() => {
        try {
          const id = g.dataset.id || "";
          const base = parseTranslate(g.getAttribute("transform"));
          const pref =
            targetOffsets[id] || (i % 2 === 0 ? [-120, 0] : [120, 0]);
          const tx = pref[0];
          const ty = pref[1];
          g.style.transition = "transform 700ms cubic-bezier(.2,.9,.3,1)";
          g.setAttribute(
            "transform",
            `translate(${base.x + tx},${base.y + ty})`
          );
          // update overlay label shortly after the move so it follows
          try {
            setTimeout(() => updateLabelFor(g), 40);
          } catch (e) {}
        } catch (e) {
          console.warn("move failed during cinematic", e);
        }
      }, i * 420 + 240);
    });

    // re-enable pointer events after the longest per-group transition ends
    const totalMs = order.length * 420 + 1000;
    setTimeout(() => {
      cinematicPlaying = false;
      continents.forEach((g) => (g.style.pointerEvents = "auto"));
      // restore svg transform (camera) smoothly
      try {
        const svgEl = document.getElementById("svg");
        svgEl.style.transition = "transform 900ms ease-out";
        svgEl.style.transform = "none";
      } catch (e) {}
      // final pass: update all overlay labels so they're locked to their groups
      try {
        continents.forEach((g) => updateLabelFor(g));
      } catch (e) {}
      // remove any overlays still stuck in the top-left
      try {
        removeStuckLeftLabels();
      } catch (e) {}
      // IMPORTANT: after the cinematic finishes, update the saved origin
      // transform for each continent so future drag-based split checks
      // compare against the *current* position (prevents splits when moving
      // toward the center immediately after the animation).
      try {
        continents.forEach((g) => {
          try {
            const id = g.dataset.id;
            if (!id) return;
            const tr = g.getAttribute("transform") || "";
            state.set(id, { transform: tr });
          } catch (e) {}
        });
      } catch (e) {}
    }, totalMs);
  }

  // Reset button
  resetBtn.addEventListener("click", () => {
    // remove floating pieces if any
    Array.from(svg.querySelectorAll("g.floating")).forEach((n) => n.remove());
    // remove old continents then recreate from initial HTML (simpler: reload document fragment)
    // We'll restore transforms and opacity
    document.querySelectorAll(".continent").forEach((c) => {
      const id = c.dataset.id;
      const initial = state.get(id).transform || "";
      c.setAttribute("transform", initial);
      c.style.opacity = "";
    });
    // clear legend entries
    const legend = document.getElementById("legend");
    if (legend)
      while (legend.children.length > 1) legend.removeChild(legend.lastChild);
    // reload to fully restore original DOM (safe fallback)
    location.reload();
  });

  // Mirror the reset action from the bottom button to keep behavior identical
  if (resetBottomBtn) {
    resetBottomBtn.addEventListener("click", () => {
      try {
        resetBtn.click();
      } catch (e) {
        /* fallback: reload */ location.reload();
      }
    });
  }

  hintBtn.addEventListener("click", () => {
    alert(
      "Ayuda rápida:\n- Arrastra un continente para moverlo.\n- Sepáralo del centro para que las piezas se dispersen.\n- Pulsa 'Reiniciar' para volver a la configuración inicial."
    );
  });

  // Small UX: allow double-click to force split
  continents.forEach((g) =>
    g.addEventListener("dblclick", () => {
      const tr = parseTranslate(g.getAttribute("transform"));
      splitContinent(g, tr, splitThreshold + 50);
    })
  );

  // Touch support: make stage respond to pointer cancel
  window.addEventListener("blur", () => {
    if (dragging) dragging = null;
  });
})();
