/*
 * MCC_TYPING_VERSION_MANAGER_CURRENT_PREVIOUS_DRAFT_INTEGRATION_1
 *
 * 이 스크립트는 MCCNETWORLDPORTAL이 /typing-static/<version>/brands/<carrier>/<brand>/index.html
 * 경로로 이 페이지를 서빙할 때만 동작한다. URL 경로가 그 패턴과 일치하지 않으면
 * (예: 기존처럼 `npx http-server . -p 8080`으로 직접 열었을 때) 아무 것도 하지 않고
 * 종료하므로, 기존 타이핑 사이트의 "설계 저장(JSON)/요금표 저장(plans.json)" 버튼은
 * 항상 지금과 똑같이(브라우저 다운로드) 동작한다.
 *
 * 버전관리 환경에서는 추가로:
 *  - #saveJson / #savePlans 클릭으로 생성되는 Blob 내용을 가로채서(다운로드는 그대로
 *    유지한 채) 같은 내용을 PREVIOUS/DRAFT 버전 폴더에 서버 저장한다(CURRENT는 거부).
 *  - design 모드(?mode=design)일 때만 "신청서 이미지 관리" 패널을 추가한다.
 *
 * 각 채널 index.html의 내부 변수명(필드 데이터 구조 등)에는 전혀 의존하지 않는다 —
 * 오직 이미 모든 채널이 공통으로 쓰는 외부 관찰 가능한 동작(Blob 다운로드, #bg 이미지,
 * URL 쿼리스트링 mode/doc/age)만 사용한다.
 */
(function () {
  'use strict';

  function parseVersionContext() {
    var m = location.pathname.match(
      /\/typing-static\/(current|previous|draft)\/brands\/([^/]+)\/([^/]+)\/index\.html$/
    );
    if (!m) return null;
    return { version: m[1], carrier: m[2], brand: m[3] };
  }

  var ctx = parseVersionContext();
  if (!ctx) return; // 버전관리 환경이 아니면 기존 동작만 유지하고 종료

  var qs = new URLSearchParams(location.search);
  var isDesignMode = qs.get('mode') === 'design';

  function authHeader() {
    try {
      var raw = localStorage.getItem('auth-storage');
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      var sessionId = parsed && parsed.state && parsed.state.sessionId;
      return sessionId ? ('Bearer ' + sessionId) : null;
    } catch (e) {
      return null;
    }
  }

  function apiCall(url, opts) {
    var headers = opts.headers || {};
    var auth = authHeader();
    if (auth) headers['Authorization'] = auth;
    opts.headers = headers;
    return fetch(url, opts).then(function (r) {
      return r
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          if (!r.ok) throw new Error((data && data.error) || '저장 실패 (' + r.status + ')');
          return data;
        });
    });
  }

  function postJson(url, payload) {
    return apiCall(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  var bridge = {
    ctx: ctx,
    isDesignMode: isDesignMode,
    isReadOnly: ctx.version === 'current',
    saveOverlay: function (payload, docKey) {
      if (ctx.version === 'current') {
        return Promise.reject(new Error('현재 운영 버전은 저장할 수 없습니다.'));
      }
      var url =
        '/api/typing-versions/' + ctx.version + '/overlay/' + ctx.carrier + '/' + ctx.brand + '/' + docKey;
      return postJson(url, payload);
    },
    savePlans: function (payload) {
      if (ctx.version === 'current') {
        return Promise.reject(new Error('현재 운영 버전은 저장할 수 없습니다.'));
      }
      var url = '/api/typing-versions/' + ctx.version + '/plans/' + ctx.carrier + '/' + ctx.brand;
      return postJson(url, payload);
    },
    saveImage: function (file, doc, page) {
      if (ctx.version === 'current') {
        return Promise.reject(new Error('현재 운영 버전은 저장할 수 없습니다.'));
      }
      var fd = new FormData();
      fd.append('file', file);
      fd.append('doc', doc);
      fd.append('page', String(page));
      var url = '/api/typing-versions/' + ctx.version + '/images/' + ctx.carrier + '/' + ctx.brand;
      return apiCall(url, { method: 'POST', body: fd });
    },
  };
  window.__typingVersionBridge = bridge;

  function flashStatus(message, isError) {
    var el = document.getElementById('__typingVersionStatus');
    if (!el) {
      el = document.createElement('div');
      el.id = '__typingVersionStatus';
      el.style.position = 'fixed';
      el.style.right = '16px';
      el.style.bottom = '16px';
      el.style.zIndex = '99999';
      el.style.padding = '10px 14px';
      el.style.borderRadius = '8px';
      el.style.fontSize = '13px';
      el.style.fontWeight = '600';
      el.style.boxShadow = '0 4px 14px rgba(0,0,0,.25)';
      el.style.color = '#fff';
      document.body.appendChild(el);
    }
    el.style.background = isError ? '#dc2626' : '#16a34a';
    el.textContent = message;
    el.style.display = 'block';
    clearTimeout(el.__hideTimer);
    el.__hideTimer = setTimeout(function () {
      el.style.display = 'none';
    }, 3500);
  }

  // ───────────────────────────────────────────────────────────
  // 1) #saveJson / #savePlans 클릭 → Blob 내용을 가로채 서버에도 저장
  //    (다운로드 자체는 막지 않는다 — 기존 동작 그대로 유지, 서버저장은 "추가")
  // ───────────────────────────────────────────────────────────
  var pendingSaveKind = null; // 'overlay' | 'plans'

  document.addEventListener(
    'click',
    function (e) {
      var el = e.target && e.target.closest ? e.target.closest('#saveJson, #savePlans') : null;
      if (!el) return;
      pendingSaveKind = el.id === 'saveJson' ? 'overlay' : 'plans';
    },
    true // capture: 실제 저장 버튼의 클릭 핸들러(버블 단계)보다 먼저 실행된다
  );

  var nativeCreateObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (blob) {
    var url = nativeCreateObjectURL(blob);
    if (pendingSaveKind && blob && typeof blob.text === 'function') {
      var kind = pendingSaveKind;
      pendingSaveKind = null;
      blob
        .text()
        .then(function (text) {
          var json;
          try {
            json = JSON.parse(text);
          } catch (e) {
            return; // JSON이 아니면(다른 다운로드) 무시
          }
          if (ctx.version === 'current') return; // 안전장치(이미 UI에서 버튼 자체를 숨김)
          if (kind === 'overlay') {
            var doc = qs.get('doc') || 'adult';
            var age = qs.get('age') || 'adult';
            var docKey = doc === 'device' ? (age === 'teen' ? 'device.teen' : 'device.adult') : doc === 'join' || !doc ? (age === 'teen' ? 'teen' : 'adult') : doc;
            bridge
              .saveOverlay(json, docKey)
              .then(function () {
                flashStatus('설계(JSON)가 ' + ctx.version + ' 버전에 저장되었습니다.');
              })
              .catch(function (err) {
                flashStatus('서버 저장 실패: ' + err.message, true);
              });
          } else {
            bridge
              .savePlans(json)
              .then(function () {
                flashStatus('요금표(plans.json)가 ' + ctx.version + ' 버전에 저장되었습니다.');
              })
              .catch(function (err) {
                flashStatus('요금표 서버 저장 실패: ' + err.message, true);
              });
          }
        })
        .catch(function () {});
    }
    return url;
  };

  // ───────────────────────────────────────────────────────────
  // 2) CURRENT에서는 저장/업로드 버튼을 숨겨 실수 수정을 원천 차단
  // ───────────────────────────────────────────────────────────
  function hideWriteControlsOnCurrent() {
    if (ctx.version !== 'current') return;
    ['saveJson', 'savePlans', 'loadPlansFile', 'bulkPlansBtn'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        var host = el.closest('label') || el;
        host.style.display = 'none';
      }
    });
  }

  // ───────────────────────────────────────────────────────────
  // 3) design 모드에서만 "신청서 이미지 관리" 패널 추가
  // ───────────────────────────────────────────────────────────
  function buildImagePanel() {
    var host = document.querySelector('.panel.builder');
    if (!host || document.getElementById('__typingImagePanel')) return;

    var wrap = document.createElement('div');
    wrap.id = '__typingImagePanel';
    wrap.className = 'group';
    wrap.style.marginTop = '12px';
    wrap.innerHTML =
      '<h4>신청서 이미지 관리</h4>' +
      '<div class="row"><div>서류</div>' +
      '<select id="__timDoc">' +
      '<option value="adult">가입신청서(성인)</option>' +
      '<option value="teen">가입신청서(청소년)</option>' +
      '<option value="change">변경 서류</option>' +
      '<option value="cancel">해지 서류</option>' +
      '</select></div>' +
      '<div class="row"><div>페이지</div>' +
      '<input id="__timPage" type="number" min="1" max="20" value="1" style="width:70px" />' +
      '</div>' +
      '<div class="row"><label class="btn--ghost btn" style="cursor:pointer;display:inline-block">' +
      '파일 선택<input type="file" id="__timFile" accept="image/jpeg,image/png" hidden></label></div>' +
      '<div id="__timDrop" style="margin-top:8px;border:2px dashed #94a3b8;border-radius:8px;' +
      'padding:16px;text-align:center;font-size:12px;color:#64748b;cursor:pointer">' +
      '새 이미지를 여기에 드래그앤드롭</div>' +
      '<div class="row" style="margin-top:8px"><button class="btn" id="__timApply">이미지 교체</button></div>';

    host.appendChild(wrap);

    var fileInput = wrap.querySelector('#__timFile');
    var dropZone = wrap.querySelector('#__timDrop');
    var pendingFile = null;

    function setPendingFile(f) {
      if (!f) return;
      pendingFile = f;
      dropZone.textContent = '선택됨: ' + f.name;
    }

    fileInput.addEventListener('change', function () {
      setPendingFile(fileInput.files && fileInput.files[0]);
    });
    dropZone.addEventListener('click', function () {
      fileInput.click();
    });
    dropZone.addEventListener('dragover', function (e) {
      e.preventDefault();
      dropZone.style.background = '#eef2ff';
    });
    dropZone.addEventListener('dragleave', function () {
      dropZone.style.background = '';
    });
    dropZone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropZone.style.background = '';
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      setPendingFile(f);
    });

    wrap.querySelector('#__timApply').addEventListener('click', function () {
      if (!pendingFile) {
        flashStatus('먼저 교체할 이미지를 선택해주세요.', true);
        return;
      }
      var doc = wrap.querySelector('#__timDoc').value;
      var page = parseInt(wrap.querySelector('#__timPage').value, 10) || 1;
      bridge
        .saveImage(pendingFile, doc, page)
        .then(function (result) {
          flashStatus('이미지가 교체되었습니다 (' + doc + '-' + page + ').');
          var bg = document.getElementById('bg');
          if (bg && result && result.filename) {
            var basePath = bg.src.split('?')[0].replace(/\/[^/]+$/, '/' + result.filename);
            bg.src = basePath + '?t=' + Date.now();
          }
          pendingFile = null;
          dropZone.textContent = '새 이미지를 여기에 드래그앤드롭';
          fileInput.value = '';
        })
        .catch(function (err) {
          flashStatus('이미지 저장 실패: ' + err.message, true);
        });
    });
  }

  // ───────────────────────────────────────────────────────────
  // 4) MCC_TYPING_DESIGN_UI_NON_INTRUSIVE_DOCUMENT_LAYOUT_FIX_1
  //    관리용 UI(배너/저장 토스트/이미지 패널)가 신청서 DOCUMENT의 document flow에
  //    끼어들어 top/height를 바꾸는 일이 없도록, 전부 position:fixed(또는 이미
  //    fixed인 토스트/사이드바 안에 있는 이미지패널)로 두고 @media print에서는
  //    예외 없이 display:none으로 제거한다. 신청서 본문(.wrap/.paper/.stage 등)
  //    자체의 CSS/HTML은 이 스크립트가 전혀 건드리지 않는다.
  // ───────────────────────────────────────────────────────────
  function ensureAdminPrintStyle() {
    if (document.getElementById('__typingAdminPrintStyle')) return;
    var style = document.createElement('style');
    style.id = '__typingAdminPrintStyle';
    style.textContent =
      '@media print {' +
      '#__typingVersionBanner,#__typingVersionStatus,#__typingImagePanel{display:none !important;}' +
      '}';
    document.head.appendChild(style);
  }

  function init() {
    ensureAdminPrintStyle();
    hideWriteControlsOnCurrent();
    if (isDesignMode && ctx.version !== 'current') {
      buildImagePanel();
    }
    // 이 안내 배너는 "PREVIOUS를 수정 중"이라는 편집 경고이므로 design 모드에서만
    // 보여준다(기존에는 mode 무관하게 떴다 — 실제화면/fill 모드는 원본 신청서
    // 레이아웃과 100% 동일해야 하므로 관리 UI를 띄우지 않는다, 섹션5 요구사항).
    if (isDesignMode && ctx.version === 'previous') {
      var banner = document.createElement('div');
      banner.id = '__typingVersionBanner';
      // document flow에 영향을 주지 않도록 fixed 오버레이로 띄운다(기존 버그: position
      // 미지정 상태로 body.firstChild에 insertBefore되어 .wrap 전체가 그만큼 아래로
      // 밀렸었다 — 신청서 자체의 margin/padding/transform은 건드리지 않고 배너만
      // document flow 밖으로 분리). 상단 .hd 툴바를 가리지 않게 좌상단 작은 배지로 배치.
      banner.style.position = 'fixed';
      banner.style.top = '12px';
      banner.style.left = '12px';
      banner.style.zIndex = '99998';
      banner.style.maxWidth = '280px';
      banner.style.background = '#fef3c7';
      banner.style.color = '#92400e';
      banner.style.padding = '8px 12px';
      banner.style.borderRadius = '8px';
      banner.style.fontSize = '12px';
      banner.style.fontWeight = '600';
      banner.style.boxShadow = '0 4px 14px rgba(0,0,0,.2)';
      banner.textContent = '이전 버전(PREVIOUS)을 직접 수정합니다. 현재 운영 버전에는 영향을 주지 않습니다.';
      document.body.appendChild(banner);
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
