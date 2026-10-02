// /public/app/viewer.js
(function () {
  const qs = new URLSearchParams(location.search);

  // /brands/{carrier}/{brand}/index.html 기준으로 경로 자동 추출
  function detectCarrierBrand() {
    const pC = qs.get("carrier"), pB = qs.get("brand");
    if (pC && pB) return { carrier: pC, brand: pB };
    const parts = location.pathname.replace(/^\/+/, "").split("/");
    const i = parts.indexOf("brands");
    if (i >= 0 && parts[i+1] && parts[i+2]) return { carrier: parts[i+1], brand: parts[i+2] };
    return { carrier: "kt", brand: "mmobile" };
  }

  const doc  = (qs.get("doc")  || "join").toLowerCase();       // join | change | cancel
  const age  = (qs.get("age")  || "adult").toLowerCase();      // adult | teen
  const mode = (qs.get("mode") || "preview").toLowerCase();    // preview | fill | pdf

  const app = document.getElementById("app");
  if (!app) { console.error("#app not found"); return; }
  app.innerHTML =
    '<div style="max-width:980px;margin:40px auto;padding:18px;border:1px solid #e5e9f2;border-radius:12px;background:#fff">불러오는 중…</div>';

  const { carrier, brand } = detectCarrierBrand();
  const basePath = location.pathname.replace(/\/index\.html.*$/, "");
  const designUrl = `${basePath}/${resolveDesignFilename(doc, age)}?v=${Date.now()}`;
  const storageKey = `overlay_autosave_${carrier}_${brand}_${doc}_${age}`;

  function resolveDesignFilename(doc, age){
    if (doc === "change") return "overlay-design.change.json";
    if (doc === "cancel" || doc === "terminate" || doc === "close") return "overlay-design.cancel.json";
    return age === "teen" ? "overlay-design.teen.json" : "overlay-design.adult.json";
  }

  // plans.json 로드 (없어도 동작)
  async function loadPlans(){
    try{
      const r = await fetch('/public/plans.json', {cache:'no-store'});
      if(!r.ok) throw new Error('plans.json not found');
      return await r.json();
    }catch(e){
      console.warn('[plans] load fail:', e);
      return {};
    }
  }

  fetch(designUrl, { cache: "no-store" })
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(json => render(json))
    .catch(err => {
      app.innerHTML = `<div style="max-width:980px;margin:40px auto;padding:18px;border:1px solid #e5e9f2;border-radius:12px;background:#fff">
        설계를 불러오지 못했습니다.<br><b>${designUrl}</b><br><small>${String(err)}</small></div>`;
    });

  async function render(j) {
    const pages = (j && j.pages) || [];
    if (!pages.length) throw new Error("pages 가 비어있습니다.");

    const plans = await loadPlans();

    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch(e){}

    const wrap = el("div", { class: "viewer" });

    pages.forEach((pg) => {
      const paper = el("div", { class: "paper" }, wrap);
      const stage = el("div", { class: "stage" }, paper);

      const bg = el("img", {}, stage);
      bg.src = pg.bg || "";
      bg.addEventListener('load', () => {
        const natw = bg.naturalWidth  || 595;
        const nath = bg.naturalHeight || 842;
        paper.style.setProperty('--natw', natw + 'px');
        paper.style.setProperty('--nath', nath + 'px');
        applyZoom(paper, natw, nath);
      });

      const ov = el("div", { class: "overlay" }, stage);

      (pg.fields || []).forEach((f) => {
        const w = el("div", { class: "field" }, ov);
        w.dataset.id = f.id || '';                                // data-id 바인딩
        w.style.left  = (f.x ?? 0) + "%";
        w.style.top   = (f.y ?? 0) + "%";
        w.style.width = (f.w ?? 24) + "%";

        if (f.label) {
          const lab = el("div", { class: "label" }, w);
          lab.textContent = f.label;
        }

        const savedVal = (saved[f.id] !== undefined) ? saved[f.id] : f.value;

        // 미리보기/인쇄
        if (mode === "preview" || mode === "pdf") {
          if (f.type === "signature") {
            const pv = el("div", { class:"print-value" }, w);
            const img = el("img", {}, pv);
            img.style.maxWidth = "100%";
            img.style.maxHeight = "80px";
            img.src = savedVal || "";
            styleValue(pv, f);
          } else {
            const pv = el("div", { class:"print-value" }, w);
            pv.textContent = (f.type === "checkbox") ? (savedVal ? "☑ 동의" : "☐ 미동의") : (savedVal ?? "");
            styleValue(pv, f);
          }
          return;
        }

        // 입력 모드
        let ctrl;
        if (f.type === "select") {
          ctrl = el("select", {}, w);
          (f.options || []).forEach(o => { const op = el("option", {}, ctrl); op.value = op.textContent = o; });
          ctrl.value = savedVal || "";
          ctrl.onchange = () => onChange(f.id, ctrl.value);
        } else if (f.type === "checkbox") {
          ctrl = el("input", {}, w); ctrl.type = "checkbox";
          ctrl.checked = !!savedVal;
          ctrl.onchange = () => onChange(f.id, ctrl.checked);
        } else if (f.type === "radio") {
          const box = el("div", {}, w);
          (f.options||[]).forEach(opt=>{
            const id = `${f.id}_${opt}`;
            const lab = el("label", {}, box);
            lab.style.marginRight = "10px";
            const r = el("input", {}, lab);
            r.type = "radio"; r.name = f.id; r.value = opt; r.id = id;
            if (opt === savedVal) r.checked = true;
            r.onchange = ()=> onChange(f.id, opt);
            lab.appendChild(document.createTextNode(' '+opt));
          });
        } else if (f.type === "signature") {
          const c = el("canvas", {}, w);
          c.width = 600; c.height = 160; c.style.width="100%"; c.style.height="80px";
          c.style.border = "1px solid #d0d5dd"; c.style.borderRadius="8px"; c.style.background="#fff";
          const ctx = c.getContext('2d'); ctx.lineWidth = 2; ctx.lineCap="round";
          let drawing=false, px=0, py=0;
          function pos(e){ const r=c.getBoundingClientRect(); const x=(e.touches?e.touches[0].clientX:e.clientX)-r.left; const y=(e.touches?e.touches[0].clientY:e.clientY)-r.top; return {x,y};}
          c.addEventListener('mousedown', e=>{drawing=true; ({x:px,y:py}=pos(e));});
          c.addEventListener('mousemove', e=>{ if(!drawing) return; const {x,y}=pos(e); ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(x,y); ctx.stroke(); px=x; py=y; onChange(f.id, c.toDataURL('image/png')); });
          window.addEventListener('mouseup', ()=> drawing=false);
          c.addEventListener('touchstart', e=>{e.preventDefault(); drawing=true; ({x:px,y:py}=pos(e));});
          c.addEventListener('touchmove',  e=>{e.preventDefault(); if(!drawing) return; const {x,y}=pos(e); ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(x,y); ctx.stroke(); px=x; py=y; onChange(f.id, c.toDataURL('image/png'));});
          window.addEventListener('touchend', ()=> drawing=false);
          if (savedVal){ const img=new Image(); img.onload=()=>ctx.drawImage(img,0,0,c.width,c.height); img.src=savedVal; }
        } else {
          ctrl = el("input", {}, w); ctrl.type = "text";
          ctrl.value = savedVal || "";
          ctrl.oninput = () => onChange(f.id, ctrl.value);
        }

        // 컨트롤 공통 스타일 속성
        if (ctrl){
          if (f.fontSize)  ctrl.style.setProperty('--fs', unit(f.fontSize,'px'));
          if (f.color)     ctrl.style.color = f.color;
          if (f.inputHeight && f.inputHeight !== 'auto'){
            ctrl.style.height = unit(f.inputHeight,'px'); ctrl.style.resize = 'none';
          }
        }

        // 요금제 자동 채움
        if (ctrl && f.type === "select" && f.id === "plan"){
          ctrl.addEventListener('change', ()=>{
            const p = plans[ctrl.value] || {};
            const base = Number(p.baseFee||0);
            const dc   = Number(p.discountFee||0);
            const tot  = Math.max(base - dc, 0);
            fillAndSave('baseFee', base);
            fillAndSave('discountFee', dc);
            fillAndSave('totalFee', tot);
          });
        }
      });
    });

    app.innerHTML = "";
    app.appendChild(wrap);

    // 리사이즈 시 각 페이지 zoom 재계산
    window.addEventListener('resize', () => {
      document.querySelectorAll('.paper').forEach(paper => {
        const natw = pxToNum(getComputedStyle(paper).getPropertyValue('--natw')) || 595;
        const nath = pxToNum(getComputedStyle(paper).getPropertyValue('--nath')) || 842;
        applyZoom(paper, natw, nath);
      });
    });

    // 오늘 날짜 자동 채움 (applyYear/Month/Day)
    autoFillToday();

    // PDF 모드: 필수값 검증 후 인쇄
    if (mode === "pdf") {
      const ok = validateRequired(pages);
      if (!ok) return;
      setTimeout(()=> window.print(), 150);
    }
  }

  // ===== helpers =====
  function applyZoom(paper, natw, nath){
    const avail = paper.clientWidth || paper.getBoundingClientRect().width || 980;
    const zoom  = avail / natw;
    paper.style.setProperty('--zoom', zoom);
  }

  function onChange(id, val) {
    try {
      const cur = JSON.parse(localStorage.getItem(storageKey) || "{}");
      cur[id] = val;
      localStorage.setItem(storageKey, JSON.stringify(cur));
    } catch(e){}
    // 즉시 화면 반영
    const elInput = document.querySelector(`.field[data-id="${id}"] input, .field[data-id="${id}"] .print-value, .field[data-id="${id}"] textarea`);
    if (elInput){
      if (elInput.tagName === 'INPUT' || elInput.tagName === 'TEXTAREA') elInput.value = val;
      else elInput.textContent = val;
    }
  }

  function fillAndSave(id, v){ onChange(id, v); }

  // 오늘 날짜 자동 채움
  function autoFillToday(){
    const d = new Date();
    const pad = (n)=> String(n).padStart(2,'0');
    const today = {
      applyYear:  String(d.getFullYear()),
      applyMonth: pad(d.getMonth()+1),
      applyDay:   pad(d.getDate())
    };
    Object.entries(today).forEach(([k,v])=> fillAndSave(k, v));
  }

  // 미리보기 텍스트 스타일
  function styleValue(node, f){
    node.style.whiteSpace = "pre-wrap";
    node.style.minHeight  = "18px";
    if (f.fontSize) node.style.fontSize = unit(f.fontSize, 'px');
    if (f.color)    node.style.color    = f.color;
  }

  // 필수값 검증
  function validateRequired(pages){
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch(e){}
    const missing = [];
    pages.forEach(pg => {
      (pg.fields || []).forEach(f => {
        if (!f.required) return;
        const v = (saved[f.id] !== undefined) ? saved[f.id] : f.value;
        const empty = (f.type === "checkbox") ? !v : (v === undefined || v === null || String(v).trim()==="");
        if (empty) missing.push(f.label || f.id);
      });
    });
    if (missing.length){
      showBanner(`필수 입력 누락: ${missing.join(", ")}`);
      const u = new URL(location.href); u.searchParams.set('mode','fill'); history.replaceState(null,'',u.toString());
      return false;
    }
    return true;
  }

  // 경고 배너
  function showBanner(msg){
    let b = document.getElementById('overlay-warn');
    if (!b){
      b = document.createElement('div'); b.id = 'overlay-warn';
      Object.assign(b.style, {
        position:'sticky', top:'8px', zIndex:9999, maxWidth:'980px',
        margin:'0 auto 8px', padding:'10px 14px', border:'1px solid #f59e0b',
        background:'#fffbeb', color:'#92400e', borderRadius:'10px', fontWeight:'700'
      });
      app.prepend(b);
    }
    b.textContent = msg;
    setTimeout(()=>{ if(b && b.parentNode){ b.parentNode.removeChild(b); } }, 4000);
  }

  // 유틸
  function unit(v, fallback){ return (typeof v==='number' || /^\d+$/.test(String(v))) ? `${v}${fallback}` : String(v); }
  function pxToNum(s){ const m = String(s).trim().match(/^([\d.]+)/); return m ? parseFloat(m[1]) : 0; }
  function el(tag, attrs={}, parent){ const n=document.createElement(tag); for(const k in attrs) n.setAttribute(k, attrs[k]); if(parent) parent.appendChild(n); return n; }
})();
