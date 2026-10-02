(function () {
  // -------------------------------
  // URL 파싱
  // -------------------------------
  const qs = new URLSearchParams(location.search);

  function detectCarrierBrand() {
    // 1) 쿼리 우선
    const pC = qs.get("carrier");
    const pB = qs.get("brand");
    if (pC && pB) return { carrier: pC, brand: pB };

    // 2) 경로 /{carrier}/{brand}
    const parts = location.pathname.replace(/^\/+/, "").split("/");
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return { carrier: parts[0], brand: parts[1] };
    }

    // 3) 기본값
    return { carrier: "kt", brand: "mmobile" };
  }

  // 가입/변경/해지 분기
  function detectDocSuffix() {
    const doc = (qs.get("doc") || "").toLowerCase().trim();
    if (doc === "change") return ".change";
    if (doc === "cancel" || doc === "terminate" || doc === "close") return ".cancel";
    return ""; // 기본: 가입(overlay-design.json)
  }

  // -------------------------------
  // DOM 핸들
  // -------------------------------
  const app = document.getElementById("app");
  if (!app) {
    console.error("[app] #app not found");
    return;
  }
  app.innerHTML =
    '<div class="loading" style="max-width:980px;margin:40px auto;padding:18px;border:1px solid #e5e9f2;border-radius:12px;background:#fff">불러오는 중…</div>';

  // -------------------------------
  // 디자인 로드
  // -------------------------------
  const { carrier, brand } = detectCarrierBrand();
  const suffix = detectDocSuffix();
  const root = `/brands/${carrier}/${brand}`;
  const designUrl = `${root}/overlay-design${suffix}.json?v=${Date.now()}`;

  fetch(designUrl, { cache: "no-store" })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((json) => render(json))
    .catch((err) => {
      console.error("[load fail]", designUrl, err);
      app.innerHTML =
        `<div class="error" style="max-width:980px;margin:40px auto;padding:18px;border:1px solid #e5e9f2;border-radius:12px;background:#fff">
           설계를 불러오지 못했습니다.<br>
           <b>${designUrl}</b><br>
           <small>${String(err)}</small>
         </div>`;
    });

  // -------------------------------
  // 렌더러 (간단 미리보기)
  // -------------------------------
  function render(j) {
    const pages = (j && j.pages) || [];
    if (!pages.length) throw new Error("pages 가 비어있습니다.");

    const wrap = document.createElement("div");
    wrap.className = "viewer";
    wrap.style.maxWidth = "980px";
    wrap.style.margin = "18px auto";
    wrap.style.padding = "10px";

    pages.forEach((pg) => {
      const paper = el("div", { class: "paper" }, wrap);
      Object.assign(paper.style, {
        position: "relative",
        width: "100%",
        border: "1px solid #e5e9f2",
        borderRadius: "12px",
        overflow: "hidden",
        background: "#fff",
        marginBottom: "24px",
      });

      const stage = el("div", { class: "stage" }, paper);
      Object.assign(stage.style, {
        position: "relative",
        width: "842px",
        height: "595px",
        transformOrigin: "top left",
        margin: "0 auto",
      });

      const bg = el("img", {}, stage);
      Object.assign(bg.style, {
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "fill",
      });
      bg.src = pg.bg || "";

      const ov = el("div", { class: "overlay" }, stage);
      Object.assign(ov.style, { position: "absolute", inset: 0 });

      (pg.fields || []).forEach((f) => {
        const w = el("div", { class: "field" }, ov);
        Object.assign(w.style, {
          position: "absolute",
          left: f.x + "%",
          top: f.y + "%",
          width: (f.w || 24) + "%",
        });

        if (f.label) {
          const lab = el("div", { class: "label" }, w);
          lab.textContent = f.label;
          Object.assign(lab.style, {
            position: "absolute",
            top: "-16px",
            left: 0,
            fontSize: "12px",
            fontWeight: 800,
            color: "#475467",
          });
        }

        let ctrl;
        if (f.type === "select") {
          ctrl = el("select", {}, w);
          (f.options || []).forEach((o) => {
            const op = el("option", {}, ctrl);
            op.value = op.textContent = o;
          });
          ctrl.value = f.value || "";
          ctrl.onchange = () => (f.value = ctrl.value);
        } else if (f.type === "checkbox") {
          ctrl = el("input", {}, w);
          ctrl.type = "checkbox";
          ctrl.checked = !!f.value;
          ctrl.onchange = () => (f.value = ctrl.checked);
        } else {
          ctrl = el("input", {}, w);
          ctrl.type = "text";
          ctrl.value = f.value || "";
          ctrl.oninput = () => (f.value = ctrl.value);
        }
      });
    });

    app.innerHTML = "";
    app.appendChild(wrap);
  }

  function el(tag, attrs = {}, parent) {
    const node = document.createElement(tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }
})();
