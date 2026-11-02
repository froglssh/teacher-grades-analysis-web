(() => {
  'use strict';
  const STORAGE_KEY = 'admissions-studio-v1';
  const $ = (id) => document.getElementById(id);
  const currentStageLabel = { 1: '01　盤點與探索', 2: '02　備審與自我推薦', 3: '03　筆試與面試' };
  
  const PHASE2_IDS = [
    'officialRequirements','officialEvaluation','officialMaterials','officialSecondStage',
    'departmentTraits','fitExperience','fitRole','fitEvidence','fitReflection','fitGap',
    'materialStatus','nextTask','needRecommendation','recTraits','recStory','recProof','recDraft',
    'stage2AiNotes'
  ];
  const PHASE3_IDS = [
    'assessmentType','stage3OfficialInfo','stage3Topics','stage3PastInfo',
    'stage3AiNotes'
  ];

  let targetNotes = { phase2: {}, phase3: {} };
  let activeTarget2 = '';
  let activeTarget3 = '';
  let toastTimer;
  let lastPlanText = '';
  let storageCorrupted = false;
  let storageBlocked = false;
  let cleanWriteFailed = false;
  let corruptRawData = '';
  let currentModalField = null;

  const makeId = () => (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : `p-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const emptyProgram = () => ({ id: makeId(), university: '', department: '', route: '特殊選才', status: '已報名', officialUrl: '', lastChecked: '' });
  const isPlainObject = (val) => Boolean(val) && typeof val === 'object' && !Array.isArray(val);

  function isValidStoredData(data) {
    if (!isPlainObject(data)) return false;

    if (data.version !== undefined && data.version !== 1 && data.version !== 2) {
      return false;
    }

    if (!Array.isArray(data.programs)) return false;
    for (let i = 0; i < data.programs.length; i++) {
      if (!isPlainObject(data.programs[i])) return false;
    }

    if (data.profile !== undefined && !isPlainObject(data.profile)) return false;
    if (data.phase2 !== undefined && !isPlainObject(data.phase2)) return false;
    if (data.phase3 !== undefined && !isPlainObject(data.phase3)) return false;

    if (data.phase2ByProgram !== undefined) {
      if (!isPlainObject(data.phase2ByProgram)) return false;
      const values = Object.values(data.phase2ByProgram);
      for (let i = 0; i < values.length; i++) {
        if (!isPlainObject(values[i])) return false;
      }
    }

    if (data.phase3ByProgram !== undefined) {
      if (!isPlainObject(data.phase3ByProgram)) return false;
      const values = Object.values(data.phase3ByProgram);
      for (let i = 0; i < values.length; i++) {
        if (!isPlainObject(values[i])) return false;
      }
    }

    if (data.selected2 !== undefined && typeof data.selected2 !== 'string') return false;
    if (data.selected3 !== undefined && typeof data.selected3 !== 'string') return false;
    if (data.updatedAt !== undefined && typeof data.updatedAt !== 'string') return false;

    return true;
  }

  function sanitizeConsent(data) {
    if (!data || typeof data !== 'object') return false;
    let removed = false;
    const cleanObj = (obj) => {
      if (obj && typeof obj === 'object') {
        if ('includeStage2Context' in obj) {
          delete obj.includeStage2Context;
          removed = true;
        }
        if ('includeStage3Context' in obj) {
          delete obj.includeStage3Context;
          removed = true;
        }
      }
    };

    cleanObj(data);
    cleanObj(data.phase2);
    cleanObj(data.phase3);
    if (data.phase2ByProgram && typeof data.phase2ByProgram === 'object') {
      Object.values(data.phase2ByProgram).forEach(cleanObj);
    }
    if (data.phase3ByProgram && typeof data.phase3ByProgram === 'object') {
      Object.values(data.phase3ByProgram).forEach(cleanObj);
    }
    return removed;
  }

  function showStorageAlert(message, canRescue = false) {
    const alertEl = $('storageAlert');
    if (!alertEl) return;
    alertEl.setAttribute('role', 'alert');
    alertEl.replaceChildren();
    alertEl.hidden = false;

    const msgP = document.createElement('p');
    msgP.style.margin = '0 0 8px';
    msgP.innerHTML = `<strong>⚠️ 本機資料提示：</strong>${message}`;
    alertEl.append(msgP);

    if (canRescue) {
      const btnRow = document.createElement('div');
      btnRow.className = 'button-row';

      const downloadBtn = document.createElement('button');
      downloadBtn.type = 'button';
      downloadBtn.className = 'button button-outline';
      downloadBtn.textContent = '下載原始損壞字串（.txt 救援）';
      downloadBtn.addEventListener('click', () => {
        const blob = new Blob([corruptRawData], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `損壞資料救援-${new Date().toISOString().slice(0, 10)}.txt`;
        a.click();
        URL.revokeObjectURL(a.href);
        showToast('已下載原始損壞字串備份檔。');
      });

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'button button-outline';
      copyBtn.textContent = '複製損壞字串';
      copyBtn.addEventListener('click', () => {
        copyText(corruptRawData, true);
      });

      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'button button-primary';
      resetBtn.textContent = '放棄損壞資料並建立新檔';
      resetBtn.addEventListener('click', () => {
        if (window.confirm('確定捨棄目前損壞資料並重新建立空白檔案？請先確認已備份或不需要原始內容。')) {
          try {
            localStorage.removeItem(STORAGE_KEY);
          } catch (error) {
            $('saveState').textContent = '清除失敗';
            showToast('清除損壞資料失敗，原始資料仍保留。請先備份，再檢查瀏覽器儲存權限。', 6000);
            return;
          }
          location.reload();
        }
      });

      btnRow.append(downloadBtn, copyBtn, resetBtn);
      alertEl.append(btnRow);
    }
  }

  function readStored() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      storageBlocked = true;
      showStorageAlert('無法讀取本機儲存空間（可能是瀏覽器隱私模式或儲存權限被停用）。為避免覆寫原有資料，已停用自動儲存。', false);
      return null;
    }
    if (raw === null || raw === undefined) return null;

    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (parseError) {
      storageCorrupted = true;
      corruptRawData = raw;
      showStorageAlert('偵測到本機資料損壞（無法解析 JSON）。為保護原始內容，已暫停自動儲存，避免覆寫。可透過下方按鈕救援原始內容。', true);
      return null;
    }

    if (!isValidStoredData(parsed)) {
      storageCorrupted = true;
      corruptRawData = raw;
      showStorageAlert('偵測到本機資料結構不相容。為保護原始內容，已暫停自動儲存，避免覆寫。可透過下方按鈕救援原始內容。', true);
      return null;
    }

    const hadConsentFlags = sanitizeConsent(parsed);
    if (hadConsentFlags) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      } catch (cleanWriteError) {
        cleanWriteFailed = true;
      }
    }

    return parsed;
  }

  function setValue(id, value) {
    const el = $(id);
    if (!el || value === undefined || value === null) return;
    if (el.type === 'checkbox') el.checked = Boolean(value);
    else el.value = value;
  }

  function loadState() {
    if ($('includeStage2Context')) $('includeStage2Context').checked = false;
    if ($('includeStage3Context')) $('includeStage3Context').checked = false;

    const data = readStored();

    if (storageBlocked) {
      $('saveState').textContent = '已停用儲存（儲存空間受阻）';
      appendProgram(emptyProgram());
      renderTargetSelects();
      activeTarget2 = $('stage2Target').value;
      activeTarget3 = $('stage3Target').value;
      clearFormValues(PHASE2_IDS);
      clearFormValues(PHASE3_IDS);
      $('recommendationFields').hidden = true;
      refreshPrompts();
      updateAllWordCounters();
      updateProgress();
      return;
    }

    if (storageCorrupted) {
      $('saveState').textContent = '已暫停儲存（本機資料損壞）';
      appendProgram(emptyProgram());
      renderTargetSelects();
      activeTarget2 = $('stage2Target').value;
      activeTarget3 = $('stage3Target').value;
      clearFormValues(PHASE2_IDS);
      clearFormValues(PHASE3_IDS);
      $('recommendationFields').hidden = true;
      refreshPrompts();
      updateAllWordCounters();
      updateProgress();
      return;
    }

    if (!data) {
      appendProgram(emptyProgram());
      renderTargetSelects();
      activeTarget2 = $('stage2Target').value;
      activeTarget3 = $('stage3Target').value;
      clearFormValues(PHASE2_IDS);
      clearFormValues(PHASE3_IDS);
      $('recommendationFields').hidden = true;
      refreshPrompts();
      updateAllWordCounters();
      updateProgress();
      return;
    }

    Object.entries(data.profile || {}).forEach(([key, value]) => setValue(key, value));
    const programs = Array.isArray(data.programs) && data.programs.length ? data.programs : [emptyProgram()];
    programs.forEach((program) => appendProgram(program));
    targetNotes = {
      phase2: data.phase2ByProgram && typeof data.phase2ByProgram === 'object' ? data.phase2ByProgram : {},
      phase3: data.phase3ByProgram && typeof data.phase3ByProgram === 'object' ? data.phase3ByProgram : {}
    };
    if (data.selected2 && !targetNotes.phase2[data.selected2] && data.phase2) targetNotes.phase2[data.selected2] = data.phase2;
    if (data.selected3 && !targetNotes.phase3[data.selected3] && data.phase3) targetNotes.phase3[data.selected3] = data.phase3;

    renderTargetSelects(data.selected2, data.selected3);
    activeTarget2 = $('stage2Target').value;
    activeTarget3 = $('stage3Target').value;
    if (activeTarget2 && !targetNotes.phase2[activeTarget2] && data.phase2) {
      targetNotes.phase2[activeTarget2] = data.phase2;
    }
    if (activeTarget3 && !targetNotes.phase3[activeTarget3] && data.phase3) {
      targetNotes.phase3[activeTarget3] = data.phase3;
    }

    loadFormValues(PHASE2_IDS, targetNotes.phase2[activeTarget2]);
    loadFormValues(PHASE3_IDS, targetNotes.phase3[activeTarget3]);
    $('recommendationFields').hidden = !$('needRecommendation').checked;

    $('includeStage2Context').checked = false;
    $('includeStage3Context').checked = false;

    if (cleanWriteFailed) {
      $('saveState').textContent = '本機清理失敗（無法更新儲存空間）';
      showToast('已移除記憶體中的舊版授權，但無法更新本機儲存空間（請檢查儲存空間或權限）。', 6000);
    } else {
      $('saveState').textContent = '已從本機資料還原';
    }
    refreshPrompts();
    updateAllWordCounters();
    updateProgress();
  }

  function appendProgram(program = emptyProgram()) {
    const host = $('programList');
    const card = document.createElement('article');
    card.className = 'program-card';
    card.dataset.id = program.id || makeId();

    const top = document.createElement('div');
    top.className = 'program-top';
    const number = document.createElement('span');
    number.className = 'program-number';
    number.textContent = `TARGET / ${String(host.children.length + 1).padStart(2, '0')}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-program';
    remove.textContent = '移除此校系';
    remove.setAttribute('aria-label', `移除第 ${host.children.length + 1} 個校系`);
    remove.addEventListener('click', () => {
      const p = readProgram(card);
      const name = targetLabel(p);
      const confirmed = window.confirm(`確定要刪除「${name}」嗎？\n此動作將一併刪除此校系在第二階段（備審）與第三階段（筆試面試）的本機筆記與規劃資料。此動作無法復原。`);
      if (!confirmed) return;

      $('includeStage2Context').checked = false;
      $('includeStage3Context').checked = false;

      const targetId = card.dataset.id;
      delete targetNotes.phase2[targetId];
      delete targetNotes.phase3[targetId];

      const wasActive2 = (activeTarget2 === targetId);
      const wasActive3 = (activeTarget3 === targetId);

      card.remove();
      if (!host.children.length) appendProgram(emptyProgram());
      renumberPrograms();

      if (wasActive2) {
        activeTarget2 = '';
        clearFormValues(PHASE2_IDS);
        resetPlanBox();
      }
      if (wasActive3) {
        activeTarget3 = '';
        clearFormValues(PHASE3_IDS);
      }

      syncAndRefresh();
      showToast(`已刪除「${name}」及其相關筆記。`);
    });
    top.append(number, remove);

    const fields = document.createElement('div');
    fields.className = 'program-fields';
    fields.append(
      createProgramField('大學／學院', 'university', 'text', program.university, '例如：國立○○大學'),
      createProgramField('科系／學程', 'department', 'text', program.department, '例如：生命科學系'),
      createProgramField('申請管道', 'route', 'select', program.route || '特殊選才', '', ['特殊選才', '個人申請', '兩者皆有', '其他']),
      createProgramField('目前進度', 'status', 'select', program.status || '已報名', '', ['研究中', '已報名', '等待一階', '一階通過', '準備二階', '已完成', '其他'])
    );
    fields.append(createProgramField('官方招生／系所網址（選填）', 'officialUrl', 'url', program.officialUrl, 'https://...'));
    fields.append(createProgramField('官方資訊最後查核日期', 'lastChecked', 'date', program.lastChecked || '', ''));

    const actions = document.createElement('div');
    actions.className = 'search-actions';
    const google = actionButton('Google 搜尋官方招生資訊 ↗', 'button button-outline');
    google.addEventListener('click', () => openGoogle(programSearchQuery(readProgram(card), 'admission')));
    
    // 全面加入 Claude 提問按鈕！
    const claude = actionButton('Claude 提問 ↗', 'button btn-claude');
    claude.addEventListener('click', () => openAI('claude', buildResearchPrompt(readProgram(card), 'admission')));

    const chatgpt = actionButton('ChatGPT 提問 ↗', 'button button-outline');
    chatgpt.addEventListener('click', () => openAI('chatgpt', buildResearchPrompt(readProgram(card), 'admission')));
    
    const gemini = actionButton('Gemini 提問 ↗', 'button button-outline');
    gemini.addEventListener('click', () => openAI('gemini', buildResearchPrompt(readProgram(card), 'admission')));
    
    actions.append(google, claude, chatgpt, gemini);

    card.append(top, fields, actions);
    host.append(card);
    card.querySelectorAll('input,select').forEach((el) => el.addEventListener('input', syncAndRefresh));
    card.querySelectorAll('input,select').forEach((el) => el.addEventListener('change', syncAndRefresh));
  }

  function createProgramField(labelText, key, type, value, placeholder, options = []) {
    const label = document.createElement('label');
    label.textContent = labelText;
    let input;
    if (type === 'select') {
      input = document.createElement('select');
      options.forEach((optionText) => {
        const option = document.createElement('option');
        option.textContent = optionText;
        option.value = optionText;
        input.append(option);
      });
    } else {
      input = document.createElement('input');
      input.type = type;
      input.autocomplete = 'off';
      input.placeholder = placeholder || '';
    }
    input.dataset.programField = key;
    input.value = value || '';
    label.append(input);
    return label;
  }

  function actionButton(text, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = text;
    return button;
  }

  function readProgram(card) {
    const values = { id: card.dataset.id };
    card.querySelectorAll('[data-program-field]').forEach((field) => {
      values[field.dataset.programField] = field.value.trim();
    });
    return values;
  }

  function getPrograms() {
    return [...$('programList').querySelectorAll('.program-card')].map(readProgram);
  }

  function renumberPrograms() {
    [...$('programList').querySelectorAll('.program-card')].forEach((card, index) => {
      const n = String(index + 1).padStart(2, '0');
      card.querySelector('.program-number').textContent = `TARGET / ${n}`;
      card.querySelector('.remove-program').setAttribute('aria-label', `移除第 ${index + 1} 個校系`);
    });
  }

  function collectFormValues(ids) {
    return Object.fromEntries(ids.map((id) => {
      const el = $(id);
      if (!el) return [id, undefined];
      return [id, el.type === 'checkbox' ? el.checked : el.value];
    }));
  }

  function clearFormValues(ids) {
    ids.forEach((id) => {
      const el = $(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = false;
      else if (el.tagName === 'SELECT') el.selectedIndex = 0;
      else el.value = '';
    });
  }

  function loadFormValues(ids, values) {
    clearFormValues(ids);
    if (values && typeof values === 'object') {
      Object.entries(values).forEach(([key, value]) => {
        if (ids.includes(key)) setValue(key, value);
      });
    }
  }

  function collectState() {
    const profile = {};
    document.querySelectorAll('[data-profile]').forEach((el) => {
      profile[el.id] = el.value.trim();
    });
    const p2 = collectFormValues(PHASE2_IDS);
    const p3 = collectFormValues(PHASE3_IDS);
    delete p2.includeStage2Context;
    delete p2.includeStage3Context;
    delete p3.includeStage2Context;
    delete p3.includeStage3Context;

    const state = {
      version: 2,
      updatedAt: new Date().toISOString(),
      profile,
      programs: getPrograms(),
      phase2: p2,
      phase3: p3,
      phase2ByProgram: targetNotes.phase2,
      phase3ByProgram: targetNotes.phase3,
      selected2: $('stage2Target').value,
      selected3: $('stage3Target').value
    };
    sanitizeConsent(state);
    return state;
  }

  function resetPlanBox() {
    const box = $('portfolioPlan');
    if (!box) return;
    lastPlanText = '';
    box.replaceChildren();
    const label = document.createElement('span');
    label.className = 'output-label';
    label.textContent = '資料規劃草圖';
    const p = document.createElement('p');
    p.textContent = '已切換校系。填寫上方內容後，按「整理我的資料規劃」，產生可修改的準備清單。';
    box.append(label, p);
  }

  function syncAndRefresh() {
    if (activeTarget2) targetNotes.phase2[activeTarget2] = collectFormValues(PHASE2_IDS);
    if (activeTarget3) targetNotes.phase3[activeTarget3] = collectFormValues(PHASE3_IDS);

    const prev2 = activeTarget2;
    const prev3 = activeTarget3;

    renderTargetSelects($('stage2Target').value, $('stage3Target').value);
    const next2 = $('stage2Target').value;
    const next3 = $('stage3Target').value;

    if (next2 !== prev2) {
      activeTarget2 = next2;
      loadFormValues(PHASE2_IDS, targetNotes.phase2[next2]);
      if ($('includeStage2Context')) $('includeStage2Context').checked = false;
      resetPlanBox();
    }

    if (next3 !== prev3) {
      activeTarget3 = next3;
      loadFormValues(PHASE3_IDS, targetNotes.phase3[next3]);
      if ($('includeStage3Context')) $('includeStage3Context').checked = false;
    }

    const validIds = new Set(getPrograms().map((program) => program.id));
    Object.values(targetNotes).forEach((map) => {
      Object.keys(map).forEach((id) => {
        if (!validIds.has(id)) delete map[id];
      });
    });

    if (storageCorrupted) {
      $('saveState').textContent = '已暫停儲存（保護損壞資料中）';
    } else if (storageBlocked) {
      $('saveState').textContent = '已停用儲存（儲存空間受阻）';
    } else {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(collectState()));
        $('saveState').textContent = `本機已儲存 ${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
      } catch (error) {
        $('saveState').textContent = '本機儲存失敗（請檢查空間或設定）';
        showToast('本機儲存失敗，請利用備份功能下載資料。', 5000);
      }
    }

    $('recommendationFields').hidden = !$('needRecommendation').checked;
    refreshPrompts();
    updateAllWordCounters();
    updateProgress();
  }

  function renderTargetSelects(preferred2, preferred3) {
    const programs = getPrograms();
    ['stage2Target','stage3Target'].forEach((id) => {
      const select = $(id);
      const old = id === 'stage2Target' ? preferred2 : preferred3;
      select.replaceChildren();
      const usable = programs.filter((p) => p.university || p.department);
      if (!usable.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '請先新增並填寫校系';
        select.append(option);
        select.disabled = true;
        return;
      }
      select.disabled = false;
      usable.forEach((program) => {
        const option = document.createElement('option');
        option.value = program.id;
        option.textContent = [program.university, program.department].filter(Boolean).join('・') || '未命名校系';
        select.append(option);
      });
      if (usable.some((p) => p.id === old)) select.value = old;
      else select.value = usable[0].id;
    });
  }

  function selectedProgram(id) {
    return getPrograms().find((program) => program.id === $(id).value) || emptyProgram();
  }

  function yearText() {
    return `${$('schoolYear').value || '116'} 學年度（請依實際招生年度核對）`;
  }

  function targetLabel(program) {
    return [program.university, program.department].filter(Boolean).join('・') || '尚未填寫校系';
  }

  function programSearchQuery(program, kind) {
    const target = targetLabel(program);
    const year = yearText();
    if (kind === 'past') return `${year} ${target} 歷屆考古題 面試經驗 二階甄試 官方招生資訊`;
    const routes = program.route === '兩者皆有' ? '特殊選才 個人申請' : (program.route || '特殊選才');
    return `${year} ${target} ${routes} 招生簡章 官方 招生資訊 課程地圖`;
  }

  function buildResearchPrompt(program, kind) {
    const common = `請以${yearText()}的最新資料，協助查找「${targetLabel(program)}」的${kind === 'past' ? '筆試、面試、考古題與二階甄試' : '特殊選才與個人申請招生資訊'}。\n\n請優先搜尋並引用大學或系所官方網站、當年度招生簡章及校系課程資料；逐項列出來源網址、資料日期與適用年度。把官方規定、非官方經驗分享、尚未查證資訊分開標示。找不到的資料請明說，不要推測或杜撰。提醒我實際期限與資格須以當年度官方公告為準。`;
    const checked = program.lastChecked ? `\n\n我上次核對日期：${program.lastChecked}（請重新確認是否有新版）` : '\n\n我尚未填寫最後核對日期，請指出資料日期並提醒我核對最新版。';
    return `${common}${program.officialUrl ? `\n\n我提供的官方網址（請先核對網址與年度）：\n${program.officialUrl}` : ''}${checked}`;
  }

  function openGoogle(query) {
    const url = new URL('https://www.google.com/search');
    url.searchParams.set('q', query);
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
    showToast('已嘗試開啟 Google 搜尋分頁；請優先核對官方來源。若未跳出，請檢查快顯封鎖設定。');
  }

  // 核心 AI 開啟函式：完整支援 Claude、ChatGPT、Gemini！
  function openAI(service, prompt) {
    if (service === 'claude') {
      window.open('https://claude.ai/new', '_blank', 'noopener,noreferrer');
      copyText(prompt, false).then((ok) => {
        if (ok) {
          showToast('已嘗試開啟 Claude 分頁；提示詞已複製到剪貼簿，請在新分頁直接貼上 (Cmd+V / Ctrl+V) 提問！', 5000);
        } else {
          showToast('已嘗試開啟 Claude 分頁；因提示詞自動複製失敗，請在下方提示詞預覽手動複製。', 6000);
        }
      });
      return;
    }

    const url = service === 'gemini' ? new URL('https://gemini.google.com/app') : new URL('https://chatgpt.com/');
    const tooLong = prompt.length > 1500 || (service === 'gemini' ? `https://gemini.google.com/app?prompt=${encodeURIComponent(prompt)}`.length > 1800 : `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`.length > 1800);

    if (!tooLong) {
      url.searchParams.set(service === 'gemini' ? 'prompt' : 'q', prompt);
    }

    window.open(url.toString(), '_blank', 'noopener,noreferrer');
    const serviceName = service === 'gemini' ? 'Gemini' : 'ChatGPT';

    copyText(prompt, false).then((ok) => {
      if (tooLong) {
        if (ok) {
          showToast(`已嘗試開啟 ${serviceName} 分頁；因提示詞較長（不加入網址），已複製到剪貼簿，請在新分頁直接貼上。`, 5000);
        } else {
          showToast(`已嘗試開啟 ${serviceName} 分頁；因提示詞較長且自動複製失敗，請在下方「提示詞預覽」選取手動複製。`, 6000);
        }
      } else {
        if (ok) {
          showToast(`已嘗試開啟 ${serviceName} 分頁，提示詞已複製到剪貼簿；若未自動帶入，請直接在對話框貼上。`, 4000);
        } else {
          showToast(`已嘗試開啟 ${serviceName} 分頁；若未自動帶入且自動複製失敗，請在下方「提示詞預覽」手動複製。`, 5000);
        }
      }
    });
  }

  function openProgramAI(service, prompt) {
    openAI(service, prompt);
  }

  function makePlanText() {
    const p = selectedProgram('stage2Target');
    const sections = [
      ['校系與招生年度', `${targetLabel(p)}｜${yearText()}｜管道：${p.route || '請核對'}`],
      ['官方招生資格／限制', $('officialRequirements').value.trim() || '待核對：資格、限制與適用年度。'],
      ['審查項目／評量方式', $('officialEvaluation').value.trim() || '待核對：依當年度簡章記錄。'],
      ['指定繳交資料／格式', $('officialMaterials').value.trim() || '待核對：依當年度簡章記錄。'],
      ['二階方式／考試範圍', $('officialSecondStage').value.trim() || '待核對：以官方公告或個別通知為準。'],
      ['官方校系特色／課程', $('departmentTraits').value.trim() || '待查：以當年度官方招生簡章、系所網站與課程地圖補充。'],
      ['可對應的學習經驗', $('fitExperience').value.trim() || $('experienceSummary').value.trim() || '待填：挑選與校系特色最相關的真實經驗。'],
      ['本人實際角色／貢獻', $('fitRole').value.trim() || '待填：說明本人實際負責內容，區分個人與團隊成果。'],
      ['可核對的證據', $('fitEvidence').value.trim() || '待填：作品、紀錄、成果、過程資料；避免只有形容詞。'],
      ['反思與學習', $('fitReflection').value.trim() || '待填：說明你的行動、調整、學到什麼，以及仍待釐清之處。'],
      ['待補強清單', $('fitGap').value.trim() || '檢查每一項主張是否有具體證據，並核對格式與篇幅要求。'],
      ['備審準備進度', $('materialStatus').value || '尚未開始'],
      ['下一步待辦', $('nextTask').value.trim() || '依官方要求列出下一項可執行工作。'],
      ['下一步', '逐項對照當年度簡章要求；依校系規格選擇素材，保留真實作品與自己的反思。']
    ];
    return sections.map(([title, body]) => `${title}\n${body}`).join('\n\n');
  }

  function renderPlan() {
    const p = selectedProgram('stage2Target');
    const box = $('portfolioPlan');
    lastPlanText = makePlanText();
    box.replaceChildren();
    const label = document.createElement('span');
    label.className = 'output-label';
    label.textContent = '資料規劃草圖';
    box.append(label);
    const heading = document.createElement('h4');
    heading.textContent = `${targetLabel(p)}｜資料準備工作表`;
    box.append(heading);
    const items = lastPlanText.split('\n\n');
    items.forEach((item) => {
      const [title, ...body] = item.split('\n');
      const block = document.createElement('div');
      block.className = 'plan-block';
      const h = document.createElement('p');
      h.className = 'plan-title';
      h.textContent = title;
      const text = document.createElement('p');
      text.textContent = body.join('\n');
      block.append(h, text);
      box.append(block);
    });
    showToast('已整理資料規劃草圖；請依官方簡章自行核對與修改。');
  }

  function buildRecommendationScaffold() {
    const p = selectedProgram('stage2Target');
    return `【學生提供推薦老師核對的素材｜${targetLabel(p)}】\n\n一、我申請這個校系的原因（請以自己的經驗說明）\n[填寫：我關注的問題／課程／學習方向，以及原因]\n\n二、我希望老師了解的個人特質\n[填寫：特質＋具體行為，不只寫形容詞]\n${$('recTraits').value.trim() ? `目前素材：${$('recTraits').value.trim()}\n` : ''}\n三、可說明特質的一個真實事件（情境／任務／行動／結果／反思）\n[填寫：時間、你做了什麼、遇到的困難、如何調整、留下什麼成果]\n${$('recStory').value.trim() ? `目前素材：${$('recStory').value.trim()}\n` : ''}\n四、老師可核對的證據或作品\n${$('recProof').value.trim() || '[列出可查證的作品、紀錄、成果或具體例子]'}\n\n五、我希望推薦老師補充的觀察（不替老師下結論）\n[填寫：老師曾在哪些情境看到你的行動；請老師依親身觀察決定是否採用]\n\n提醒：只陳述真實且可核實的事實；推薦信內容與提交方式以校系當年度規定為準。`;
  }

  // 階段二提示詞：支援多模式（架構診斷 / 文句潤飾 / 審查挑刺）
  function buildStage2Prompt() {
    const p = selectedProgram('stage2Target');
    const modeEl = $('stage2PromptMode');
    const mode = modeEl ? modeEl.value : 'framework';

    let prompt = '';
    const officialBase = `【目標校系】：${yearText()} ${targetLabel(p)}（申請管道：${p.route || '請確認'}）\n` +
      `【官方網址】：${p.officialUrl || '[尚未提供，請搜尋當年度官方簡章與系所課程]'}\n` +
      `【官方要求摘錄】：\n` +
      `- 報考資格／限制：${$('officialRequirements').value.trim() || '待確認'}\n` +
      `- 審查項目／評量方式：${$('officialEvaluation').value.trim() || '待確認'}\n` +
      `- 指定繳交資料／格式：${$('officialMaterials').value.trim() || '待確認'}\n` +
      `- 二階方式／考試範圍：${$('officialSecondStage').value.trim() || '待確認'}\n` +
      `【校系特色與課程】：\n${$('departmentTraits').value.trim() || '[待查：以當年度官方簡章、系所網站與課程地圖補充]'}`;

    let contextContent = '';
    if ($('includeStage2Context') && $('includeStage2Context').checked) {
      const context = [
        ['感興趣的領域', $('studentInterests').value.trim()],
        ['學習經驗', $('fitExperience').value.trim()],
        ['本人實際角色／貢獻', $('fitRole').value.trim()],
        ['可核對證據', $('fitEvidence').value.trim()],
        ['反思與成長', $('fitReflection').value.trim()],
        ['待補強項目', $('fitGap').value.trim()],
        ['下一步待辦', $('nextTask').value.trim()]
      ].filter(([, value]) => value);
      if (context.length) {
        contextContent = `\n\n【我所撰寫的個人經歷初稿素材（本人已檢視並移除敏感個資）】：\n${context.map(([label, value]) => `${label}：${value}`).join('\n')}`;
      }
    }

    if (mode === 'polish') {
      prompt = `你是大學升學備審文稿精煉顧問。我正在準備「${yearText()}」${targetLabel(p)}（管道：${p.route || '請確認'}）的申請文件。\n` +
        `我已經完成了初步的備審素材草稿，請協助我將文句進行專業潤飾與升級。\n\n` +
        `【精修核心原則】：\n` +
        `1. 絕對不虛構未發生的經歷、成果、數據或獎項。\n` +
        `2. 保留高中生的第一人稱真實語氣，杜絕空洞官腔與老套名言佳句。\n` +
        `3. 運用 STAR 架構（情境 Situation、任務 Task、行動 Action、成果與反思 Result），加強主動動詞與客觀數據。\n` +
        `4. 凸顯「個人貢獻」與團隊成果的界線，避免把整組成果模糊算在自己頭上。\n` +
        `5. 請逐段提供：(A) 具體優化建議、(B) 精煉後的段落示範（段落清晰、論點有力）。\n\n` +
        officialBase + contextContent;
    } else if (mode === 'challenge') {
      prompt = `請扮演該學系最嚴苛、最具批判思維的大學書面審查委員。請檢視我申請「${yearText()}」${targetLabel(p)}所準備的備審規劃，挑出弱點與漏洞：\n\n` +
        `1. 【脆弱主張】：哪些經歷只有空泛形容詞，缺乏客觀證據（數據、手稿、原始資料）支持？\n` +
        `2. 【角色模糊】：哪些成果看似龐大，但「我本人究竟做了什麼」交代不清？\n` +
        `3. 【動機牽強】：校系特色與我的經歷連結是否過於表面（如只稱讚名氣，或硬塞無關專長）？\n` +
        `4. 【教授追問清單】：列出 5 個在二階面試時，審查教授最可能犀利質疑我這份備審的問題。\n\n` +
        officialBase + contextContent;
    } else {
      // framework (預設)
      prompt = `你是升學資料整理教練，不是代筆者。請根據「${yearText()}」${targetLabel(p)}（申請管道：${p.route || '請確認'}）的官方招生資料，協助我規劃備審／學習歷程素材。先核對並列出官方來源網址、適用年度、審查項目與格式要求；若我提供的內容不足，先問澄清問題。請將校系特色對應到「可證明的真實經驗、具體證據、反思」，指出缺口並給我一份待辦清單。\n不得虛構經歷、數據或規定；不要替我寫可直接繳交的自傳、學習歷程檔案或推薦信，也不要保證錄取。推薦信僅協助學生整理素材，推薦老師須依親身觀察自行撰寫與確認。\n\n` +
        officialBase + contextContent;
    }

    prompt += '\n\n資料處理說明：姓名／班級欄位不會自動加入；本網站不會自動匿名化自由文字。送出前須逐次檢視完整提示詞並自行移除可識別／敏感資料；第三方服務及網址／瀏覽紀錄可能保留提示內容。';
    return prompt;
  }

  // 階段三提示詞：支援多模式（三輪追問式模擬面試 / MMI跑站 / 一分鐘自介）
  function buildStage3Prompt() {
    const p = selectedProgram('stage3Target');
    const modeEl = $('stage3PromptMode');
    const mode = modeEl ? modeEl.value : 'interview3';

    let prompt = '';
    const officialBase = `【甄試校系】：${yearText()} ${targetLabel(p)}\n` +
      `【甄試方式】：${$('assessmentType').value}\n` +
      `【官方通知與考試資訊】：\n${$('stage3OfficialInfo').value.trim() || '[待填：請先查當年度官方簡章或通知]'}\n` +
      `【練習主題】：${$('stage3Topics').value.trim() || '自我介紹、專題追問、校系動機、專業倫理'}\n` +
      `【歷屆/學長姐經驗】：${$('stage3PastInfo').value.trim() || '（尚未填寫）'}`;

    let contextContent = '';
    if ($('includeStage3Context') && $('includeStage3Context').checked) {
      const targetId = $('stage3Target').value;
      const p2Data = (targetNotes.phase2 && targetId) ? targetNotes.phase2[targetId] : null;
      const fitExp = (p2Data && typeof p2Data.fitExperience === 'string') ? p2Data.fitExperience.trim() : '';
      const fitEv = (p2Data && typeof p2Data.fitEvidence === 'string') ? p2Data.fitEvidence.trim() : '';
      const fitRole = (p2Data && typeof p2Data.fitRole === 'string') ? p2Data.fitRole.trim() : '';
      const fitRef = (p2Data && typeof p2Data.fitReflection === 'string') ? p2Data.fitReflection.trim() : '';
      const interests = $('studentInterests') ? $('studentInterests').value.trim() : '';
      const summary = $('experienceSummary') ? $('experienceSummary').value.trim() : '';

      const contextLines = [];
      if (interests) contextLines.push(`感興趣的領域：${interests}`);
      if (summary) contextLines.push(`學習經驗摘要：${summary}`);
      if (fitExp) contextLines.push(`備審相關經驗：${fitExp}`);
      if (fitRole) contextLines.push(`本人實際角色：${fitRole}`);
      if (fitEv) contextLines.push(`可核對證據：${fitEv}`);
      if (fitRef) contextLines.push(`反思體悟：${fitRef}`);

      if (contextLines.length > 0) {
        contextContent = `\n\n【我的真實備審與練習背景（本人已檢視並移除敏感個資）】：\n${contextLines.join('\n')}`;
      }
    }

    if (mode === 'mmi') {
      prompt = `請擔任醫學/生醫/跨領域多站式面試 (MMI) 訓練考官。我正在準備「${yearText()}」${targetLabel(p)}的甄試。\n` +
        `請根據該系所屬學群特性，為我設計 2 題高鑑別度的情境題（例如：醫學倫理兩難、團隊衝突與科研誠信、資源分配、新興科技風險）。\n\n` +
        `【進行規則】：\n` +
        `1. 一次只出一題情境題，給我 2 分鐘閱讀與思考，等我回答後再出下一題。\n` +
        `2. 當我作答後，請從以下向度進行專業點評：\n` +
        `   - 資訊辨識度：是否有抓住問題核心盲點與不同利害關係人的立場？\n` +
        `   - 推理與權衡：決策是否有明確的價值觀與理性論據，而非各打五十大板？\n` +
        `   - 溝通與同理：用語是否成熟且兼具同理心？\n` +
        `3. 指出我回答中的思維盲點，並提出 1 個追問。\n\n` +
        officialBase + contextContent;
    } else if (mode === 'selfintro') {
      prompt = `請擔任升學面試輔導專家。請協助我打造「${yearText()}」${targetLabel(p)}的【1分鐘黃金自我介紹】。\n\n` +
        `【自我介紹黃金三段式結構】：\n` +
        `1. 【Hook 開場 (15秒)】：一句具備記憶點的核心特質或問題意識，破除「從小乖巧懂事」的俗套。\n` +
        `2. 【Highlight 探究亮點 (30秒)】：用數據與具體動詞講述高中最具代表性的一項實作，強調「我的個人角色」與「克服挫折」。\n` +
        `3. 【Fit 校系連結 (15秒)】：清楚說明該系哪項特色課程/實驗室最吸引我，以及我未來能為該系帶來什麼貢獻。\n\n` +
        `請檢視我下方的背景素材，為我提供 2 種不同風格的自我介紹講稿示範（(A) 嚴謹科學探究風、(B) 跨領域熱忱實踐風），並標示大約朗讀秒數。\n\n` +
        officialBase + contextContent;
    } else {
      // interview3 (三輪追問式 - 典範模式)
      prompt = `請擔任支持性但嚴謹的大學模擬面試官，協助我準備「${yearText()}」${targetLabel(p)}的${$('assessmentType').value}。\n\n` +
        `【三輪面試練習機制（一次只問一題，嚴禁一次給多題或直接提供解答）】：\n` +
        `- 第 1 輪【診斷題】：依我的自述與報考動機提出 1 個核心釐清問題，檢視我是否能清楚說明動機。\n` +
        `- 第 2 輪【追問題】：針對我提供的專題成果、個人角色、數據與方法限制深入追問，檢視是否為本人真做與理解深度。\n` +
        `- 第 3 輪【情境題】：針對該學系特性設計 1 個專業倫理、團隊分歧或跨領域應變情境，檢視推論與權衡能力。\n\n` +
        `【每題回饋規準】：\n` +
        `每當我回答完一題後，請依以下三點提供簡明回饋，再提出下一題：\n` +
        `1. 一項說得清楚的地方\n` +
        `2. 一項可觀察的改進點（表達、邏輯或說服力）\n` +
        `3. 一個需要補證或查核的問題\n\n` +
        `若產生新題請標註「AI模擬題」，不可冒稱歷屆考古題。請從第 1 題開始發問！\n\n` +
        officialBase + contextContent;
    }

    prompt += '\n\n資料處理說明：姓名／班級欄位不會自動加入；本網站不會自動匿名化自由文字。送出前須逐次檢視完整提示詞並自行移除可識別／敏感資料；第三方服務及網址／瀏覽紀錄可能保留提示內容。';
    return prompt;
  }

  function refreshPrompts() {
    if (!$('stage2Prompt')) return;
    $('stage2Prompt').value = buildStage2Prompt();
    $('stage3Prompt').value = buildStage3Prompt();
  }

  async function copyText(text, notify = true) {
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch (error) {
      ok = false;
    }
    if (!ok) {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      try {
        document.body.append(area);
        area.select();
        ok = document.execCommand('copy');
      } catch (copyError) {
        ok = false;
      } finally {
        if (area.parentNode) {
          area.remove();
        }
      }
    }
    if (notify) {
      showToast(ok ? '已複製到剪貼簿。' : '無法自動複製，請選取提示詞後手動複製。');
    }
    return ok;
  }

  function showToast(message, duration = 3000) {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
  }

  function changeStage(number) {
    const stage = String(number);
    document.querySelectorAll('.stage-panel').forEach((panel) => {
      const active = panel.id === `stage${stage}`;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    document.querySelectorAll('.stage-link').forEach((button) => {
      const active = button.dataset.stage === stage;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    $('stageBreadcrumb').textContent = currentStageLabel[stage] || currentStageLabel[1];
    syncAndRefresh();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function exportBackup() {
    const state = collectState();
    sanitizeConsent(state);
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `升學資料備份-${state.profile.schoolYear || '116'}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast('備份檔已下載；檔案含個人輸入內容，不含授權旗標，請妥善保管。');
  }

  function resetLocalData() {
    if (!window.confirm('確定清除這台瀏覽器中本工具儲存的全部資料？此動作無法復原。')) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    } catch (error) {
      showToast('清除本機資料失敗，可能是瀏覽器安全性限制。請手動清除瀏覽器快取與網站資料。', 6000);
      $('saveState').textContent = '清除失敗';
    }
  }

  // ===== 新增功能 1：一鍵載入真實完整示範資料 (生醫與AI跨域範例) =====
  function loadDemoData() {
    if (!window.confirm('確定載入示範資料？這將匯入「國立臺灣大學・生命科學系」與「國立成功大學・生物醫學工程學系」的高中特選/個申完整範本，方便你快速觀摩學習。')) {
      return;
    }

    const p1Id = makeId();
    const p2Id = makeId();

    const demoPrograms = [
      {
        id: p1Id,
        university: '國立臺灣大學',
        department: '生命科學系',
        route: '特殊選才',
        status: '研究中',
        officialUrl: 'https://lifescience.ntu.edu.tw',
        lastChecked: '2026-10-25'
      },
      {
        id: p2Id,
        university: '國立成功大學',
        department: '生物醫學工程學系',
        route: '個人申請',
        status: '研究中',
        officialUrl: 'https://bme.ncku.edu.tw',
        lastChecked: '2026-10-25'
      }
    ];

    const demoProfile = {
      schoolYear: '116',
      studentAlias: '林同學',
      schoolClass: '臺北市立麗山高中 307 班',
      studentInterests: '專注微藻環境修復與合成生物學，探討微塑料固定化酵素吸附活性改良，以及微流道感測器在水質監測之應用。',
      experienceSummary: '高二主導生物專題《固定化微藻微球對水體微塑料吸附效能之研究》獲北市科展動物學科特優；高一彈性學習時間完成18週微藻培養自主學習計畫；APX全國高中數理能力檢定獲生物科金牌、化學科銀牌；擔任班級生物小老師與校園生態解說員。'
    };

    const demoPhase2 = {
      officialRequirements: '高中在學成績符合簡章規定；具備生命科學或生物科技卓越探究成果、競賽獲獎或特殊專長者。',
      officialEvaluation: '第一階段書面審查50%（含學習歷程自述O、多元表現綜整心得N、專題報告）；第二階段口試50%（專題簡報5分鐘+專業問答10分鐘）。',
      officialMaterials: '繳交資料依簡章規格上傳：PDF格式上限10MB；個人自傳限1000字以內；代表性作品限3件（含完整專題研究報告全文）。',
      officialSecondStage: '個人專業口試15分鐘（3位教授對1位考生；現場備有電腦與單槍投影設備，自備5分鐘專題海報簡報檔）。',
      departmentTraits: '臺大生科院整合分子細胞生物學、生化科技與生態演化；大二起落實專題實驗室制度；重視跨領域探究與批判性科學思維。',
      fitExperience: '主導高二專題《固定化微藻微球對水體微塑料吸附效能之研究》，結合海藻酸鈉微球包裹技術與吸光值定量吸附效能；以及高一18週自主學習計畫。',
      fitRole: '擔任研究核心執行者：獨立負責藻種活化、微球固定化實驗條件最佳化、吸光度檢量線製作、使用Python進行多組顯著性檢定與圖表繪製，並撰寫42頁結案論文。',
      fitEvidence: '1. 42頁完整研究報告(PDF含實驗步驟與誤差棒分析)；2. 3本手寫實驗記錄本與原始數據Excel；3. 臺北市中小學科展動物學科特優證書；4. 指導老師簽署之探究歷程認證表。',
      fitReflection: '歷經初期微球在弱酸環境易溶解崩解的挫敗，主動查閱ACS應用材料文獻改以氯化鈣高濃度交聯克服；深刻體會科學探究絕非照本宣科，必須建立在嚴謹對照組與反覆查證之上。',
      fitGap: '1. 需再次確認當年度最新公告之簡章口試確切日期與分組名單；2. 5分鐘口頭報告簡報投影片需濃縮在6頁以內，並演練時間控制；3. 深入查閱系上二位專題指導教授近期發表的微藻環境修復相關論文。',
      materialStatus: '整理中',
      nextTask: '完成專題簡報初稿，並請指導老師協助進行一次模擬問答。',
      needRecommendation: true,
      recTraits: '具備強烈自主探究熱忱與求知欲；面對多次實驗失敗具備高度心理韌性與排錯能力；在團隊中善於協調且嚴格遵守學術倫理。',
      recStory: '高二暑假微藻樣品連續三天吸光值異常偏低，林同學未私自竄改數據，主動留校連續三天重新校正分光光度計並重配緩衝液，最終查出是蒸餾水機濾芯老化導致導電度異常，展現誠實嚴謹之科學精神。',
      recProof: '完整三本手寫實驗記錄本（含日期戳記與儀器校正日誌）、自主學習18週反思週誌、指導老師實驗室工作紀錄。',
      recDraft: '',
      stage2AiNotes: '【AI 建議摘要筆記】：教授審查最欣賞「失敗後主動查英文文獻解決」的案例，建議在自述中把「微球交聯失敗」的篇幅保留為核心轉折點！'
    };

    const demoPhase3 = {
      assessmentType: '口試／面試',
      stage3OfficialInfo: '口試時間共15分鐘：5分鐘專題報告（簡報自備），10分鐘教授提問。評分著重研究真實性、問題意識、實驗方法合理性與應對邏輯。',
      stage3Topics: '1分鐘報考動機與專長亮點；微藻固定化專題核心限制與未來改進方向；當前合成生物學在微塑料降解之國際最新進展；面對教授質疑數據時之冷靜應對。',
      stage3PastInfo: '學長姐經驗分享：教授極度重視「這篇研究哪一部分是你親自做的」，會抽問實驗記錄本中的異常值處理方式；口試氣氛嚴肅但教授尊重有條理的理性辯護。',
      stage3AiNotes: '【模擬面試回饋筆記】：AI 考官提醒「不要過度背誦自介，第30秒要帶入具體數據（如吸附率達74%），最後一句點出為何選擇臺大生科的特定實驗室」。'
    };

    // 儲存狀態
    const state = {
      version: 2,
      updatedAt: new Date().toISOString(),
      profile: demoProfile,
      programs: demoPrograms,
      phase2: demoPhase2,
      phase3: demoPhase3,
      phase2ByProgram: { [p1Id]: demoPhase2 },
      phase3ByProgram: { [p1Id]: demoPhase3 },
      selected2: p1Id,
      selected3: p1Id
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      $('programList').replaceChildren();
      loadState();
      showToast('✨ 已成功載入示範資料！可點選各區塊觀摩，也可以在此基礎上修改為自己的資料。', 4500);
    } catch (e) {
      showToast('載入示範資料失敗：' + e.message, 5000);
    }
  }

  // ===== 新增功能 2：欄位快捷關鍵字標籤點選 (Tag Pills) =====
  function setupTagPills() {
    document.querySelectorAll('.tag-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        const insertText = pill.dataset.insert || pill.textContent.trim();
        const container = pill.closest('.field-wrapper') || pill.closest('.tag-cloud');
        let targetInput = null;

        if (pill.dataset.target) {
          targetInput = $(pill.dataset.target);
        } else if (container && container.dataset.target) {
          targetInput = $(container.dataset.target);
        } else if (container) {
          targetInput = container.querySelector('textarea, input:not([type=checkbox])');
        }

        if (!targetInput) return;

        const currentVal = targetInput.value.trim();
        if (!currentVal) {
          targetInput.value = insertText;
        } else if (!currentVal.includes(insertText)) {
          // 若為多行 textarea 且已有多行，以頓號或換行連接
          const sep = targetInput.tagName === 'TEXTAREA' && currentVal.includes('\n') ? '\n' : '、';
          targetInput.value = currentVal + sep + insertText;
        }

        targetInput.focus();
        targetInput.dispatchEvent(new Event('input', { bubbles: true }));
        targetInput.dispatchEvent(new Event('change', { bubbles: true }));

        // 視覺動態效果
        pill.style.transform = 'scale(0.92)';
        setTimeout(() => { pill.style.transform = ''; }, 150);
        showToast(`已加入「${insertText}」`);
      });
    });
  }

  // ===== 新增功能 3：句型引導起手式 (Sentence Starters) =====
  function setupSentenceStarters() {
    document.querySelectorAll('.starter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const template = btn.dataset.insert || '';
        const container = btn.closest('.field-wrapper') || btn.closest('.sentence-starters');
        let targetInput = null;

        if (container && container.dataset.target) {
          targetInput = $(container.dataset.target);
        } else if (container) {
          targetInput = container.querySelector('textarea, input');
        }

        if (!targetInput) return;

        const currentVal = targetInput.value.trim();
        if (!currentVal) {
          targetInput.value = template;
        } else {
          targetInput.value = currentVal + '\n' + template;
        }

        targetInput.focus();
        targetInput.dispatchEvent(new Event('input', { bubbles: true }));
        targetInput.dispatchEvent(new Event('change', { bubbles: true }));
        showToast('已加入範例句型框架，請依個人真實經驗修改填寫！');
      });
    });
  }

  // ===== 新增功能 4：字數統計與整體填寫進度 =====
  function updateAllWordCounters() {
    document.querySelectorAll('textarea').forEach((ta) => {
      updateSingleWordCount(ta);
    });
  }

  function updateSingleWordCount(ta) {
    if (!ta || !ta.id) return;
    const countEl = $('count_' + ta.id);
    if (!countEl) return;
    const len = (ta.value || '').trim().replace(/\s+/g, ' ').length;
    countEl.textContent = `${len} 字`;
  }

  function updateProgress() {
    const badge = $('progressBadge');
    if (!badge) return;

    // 計算重要欄位填寫比例
    const checkIds = [
      'schoolYear', 'studentInterests', 'experienceSummary',
      'officialRequirements', 'officialEvaluation', 'departmentTraits',
      'fitExperience', 'fitRole', 'fitEvidence', 'fitReflection',
      'stage3OfficialInfo', 'stage3Topics'
    ];

    let filled = 0;
    checkIds.forEach((id) => {
      const el = $(id);
      if (el && el.value && el.value.trim().length > 3) filled++;
    });

    const percent = Math.round((filled / checkIds.length) * 100);
    badge.textContent = `填寫進度 ${percent}%`;
    if (percent >= 80) {
      badge.style.background = '#d8ebde';
      badge.style.color = '#1b5434';
      badge.style.borderColor = '#9acb9a';
    } else if (percent >= 40) {
      badge.style.background = '#fef6e4';
      badge.style.color = '#82590f';
      badge.style.borderColor = '#ebd196';
    } else {
      badge.style.background = '#e4eee6';
      badge.style.color = '#285a4a';
      badge.style.borderColor = '#c8ddd0';
    }
  }

  // ===== 新增功能 5：AI 靈感發想彈窗 (AI Inspiration Modal) =====
  const FIELD_METADATA = {
    studentInterests: {
      title: '感興趣的領域／想解決的問題',
      tips: '💡 <strong>教授最想看的是：</strong>你對這個問題的「真實好奇心」從何而來？是生活中的某次觀察，還是課程實作發現的盲點？避免只寫「我自小對XX抱有遠大志向」這種罐頭句。',
      promptMaker: (p, val) => `你是大學升學輔導顧問。我正在準備「${yearText()}」申請「${targetLabel(p)}」（管道：${p.route || '請確認'}）。\n請針對【感興趣的領域／想解決的問題】給我構思建議：\n1. 【校系契合點】：以該系教授的視角，目前最關注的研究焦點與關鍵能力是什麼？\n2. 【問題意識引導】：請給我 3 個探索視角，幫助我把高中日常觀察或實驗，轉化為具備深度與學術潛力的「問題意識」。\n3. 【好壞範例對比】：請提供一個空洞陳腔濫調的寫法 vs 具體有說服力的寫法。\n${val ? `\n我目前的初步構想如下：\n「${val}」` : ''}`
    },
    experienceSummary: {
      title: '高中學習經驗總結',
      tips: '💡 <strong>教授最想看的是：</strong>你在高中做過最深刻、最有代表性的一項自主探究或實作，以及你如何從挫折中克服問題，留下具體佐證。',
      promptMaker: (p, val) => `你是升學輔導教練。我正在準備申請「${targetLabel(p)}」。\n請協助我梳理高中階段可用來說明個人特質的代表性經驗：\n1. 如何挑選 1~2 項最能對接該校系特質的探究經驗（如專題、自主學習、競賽、社團領導）？\n2. 面對大學審查委員，如何用具體動詞交代「我遭遇的困難」與「留下的客觀證據」？\n3. 請提供一份「經歷梳理三問表」供我自我檢視。\n${val ? `\n我目前的經歷摘要：\n「${val}」` : ''}`
    },
    officialRequirements: {
      title: '報考資格／限制',
      tips: '💡 <strong>官方簡章是唯一標準！</strong>請先確認成績百分比、競賽獲獎等級、APX級分或特長限制是否符合當年度規定。',
      promptMaker: (p, val) => `請協助我查找「${yearText()}」${targetLabel(p)}（管道：${p.route || '特殊選才'}）的官方報考資格與門檻規定。\n請條列出官方簡章中的：\n1. 在校成績門檻（如前標、前20%等）\n2. 必備或有利之競賽、檢定、特殊經歷條件\n3. 繳交證明文件時之注意事項，並提醒我務必核對當年度官方公告。`
    },
    officialEvaluation: {
      title: '審查項目／評量方式',
      tips: '💡 掌握書審與面試各佔幾%，書審中自述(O)、多元表現(F)、專題(N)各需準備哪些項，避免努力錯方向。',
      promptMaker: (p, val) => `請協助我檢索並分析「${yearText()}」${targetLabel(p)}的官方審查項目與配分比重：\n1. 書面審查與二階面試之評分權重分別為何？\n2. 審查指引中特別看重學習歷程自述(O)、多元表現(F)還是專題研究成果(N)？\n3. 請提醒我該系在招生審查上歷年最重視的核心指標。`
    },
    officialMaterials: {
      title: '指定繳交資料／格式',
      tips: '💡 嚴格遵守檔案大小(如10MB)、自傳字數(如800~1000字)或作品件數上限。排版以閱讀舒適、圖表清晰為優先。',
      promptMaker: (p, val) => `請查找「${yearText()}」${targetLabel(p)}對於指定繳交文件的格式限制：\n1. 上傳檔案格式（PDF限制大小、總頁數上限）\n2. 自傳或學習歷程自述之字數限制\n3. 證明文件與作品件數上限，並提醒我不可遺漏的官方附件。`
    },
    officialSecondStage: {
      title: '二階甄試方式／考試範圍',
      tips: '💡 確認是個人口試、MMI跑站、專題簡報還是筆試。若需自備簡報，注意頁數與時間限制。',
      promptMaker: (p, val) => `請協助我查找「${yearText()}」${targetLabel(p)}二階甄試的具體形式與考試規定：\n1. 甄試包含口試、筆試、實作還是 MMI 多站面試？時間各為幾分鐘？\n2. 是否需要自備簡報投影片或紙本作品？\n3. 官方公告之考試範圍或準備指引有哪些？`
    },
    departmentTraits: {
      title: '校系官方特色／課程／能力要求',
      tips: '💡 <strong>切忌通篇稱讚學校名氣大！</strong>一定要具體寫出該系的 1~2 門特色課程、實驗室制度或跨領域學程，並連結到自己的志向。',
      promptMaker: (p, val) => `請以「${yearText()}」最新資料，詳細分析「${targetLabel(p)}」的系所特色與發展重點：\n1. 【系所三大特色】：該學系在全國同領域中，最獨特的學術強項或研究方向是什麼？\n2. 【核心必修與特色實驗室】：請列出 2~3 門大二至大四的特色課程，以及適合高中生認識的核心實驗室方向。\n3. 【教授期待的學生特質】：該系最青睞具備何種思維（如批判性、跨領域、動手實作）的學生？\n4. 請給我 2 個切入點，說明如何將我的自主學習經驗與該系課程自然對接。`
    },
    fitExperience: {
      title: '我的相關經驗對接',
      tips: '💡 挑選 1~2 件「最能證明你具備該系所需特質」的真實經歷，不要像菜單一樣堆疊十幾項無關的社團或志工。',
      promptMaker: (p, val) => `我是準備申請「${targetLabel(p)}」的高中生。請協助我規劃如何呈現我的學習經驗：\n1. 以該系教授的審查標準，怎樣的專題或探究經驗最具說服力？\n2. 如果我有以下初步經驗：\n「${val || '自主學習、高中專題研究、科展或能力競賽'}」\n請建議我應從哪個切入點展開論述，避免寫成流水帳。`
    },
    fitRole: {
      title: '我在研究／作品中的本人角色',
      tips: '💡 <strong>這是面試最常被問翻的致命題！</strong>清楚區分「整組做了什麼」與「我個人獨立完成了什麼」，用具體動詞（如採樣、編程、配液、分析）說明。',
      promptMaker: (p, val) => `請擔任升學輔導面試官。在備審中呈現「本人實際角色與貢獻」時：\n1. 教授最容易懷疑學生「掛名」或「搭便車」的地方在哪裡？\n2. 請教我如何使用精準的行動動詞（如主導假說、獨立架設、優化變因、排查異常值）展現個人貢獻？\n3. 請示範一段「區分團隊成果與個人獨立工作」的優質論述範例。\n${val ? `\n我目前的角色描述：\n「${val}」` : ''}`
    },
    fitEvidence: {
      title: '可驗證的證據',
      tips: '💡 <strong>口說無憑！</strong>提出可查證的手寫實驗記錄本、完整報告PDF、原始數據、程式碼網址或老師簽章，勝過千言萬語。',
      promptMaker: (p, val) => `在申請「${targetLabel(p)}」時，如何為自己的學習經歷建立「硬核證據鏈」？\n1. 除了獎狀以外，大學教授更認可哪些「過程性證據」（例如實驗日誌手稿、原始數據、Git版本庫、反思週誌）？\n2. 這些證據在上傳或面試時，應如何排版與標註重點，讓審查委員在 10 秒內看到亮點？`
    },
    fitReflection: {
      title: '反思與學習',
      tips: '💡 成功的實驗人人會講，<strong>失敗後的調整才是靈魂！</strong>寫出你在面對瓶頸、數據異常時如何推理、查文獻並修正，展現科學家精神。',
      promptMaker: (p, val) => `請指導我如何為「${targetLabel(p)}」撰寫深刻的【反思與學習】：\n1. 為什麼很多學生的反思被評為「空泛假大空」（例如只寫學會耐心、熱忱）？\n2. 如何把「實驗失敗」、「數據偏差」或「團隊分歧」轉化為展現科學韌性與推理能力的亮點？\n3. 請提供 3 個引導問題，帶我深挖自己從實作中獲得的認知改變。\n${val ? `\n我目前的初步體悟：\n「${val}」` : ''}`
    },
    fitGap: {
      title: '還需要補強／確認的清單',
      tips: '💡 誠實列出待確認事項（如簡章時程、專題簡報演練、名詞術語查核），這是嚴謹態度的展現。',
      promptMaker: (p, val) => `請協助我進行申請「${targetLabel(p)}」前的【盲點自我檢查】：\n1. 高中生送出備審前最常漏掉的 5 大致命細節是什麼？\n2. 面對一階通過後的二階專業挑戰，我現在應該提前補強哪些學科先備知識或英文術語？`
    },
    recTraits: {
      title: '推薦信：希望老師觀察到的個人特質',
      tips: '💡 <strong>推薦老師需要的是具體行為事實！</strong>而不是要學生代寫誇張的稱讚。提供時間、事件與真實成果讓老師核對。',
      promptMaker: (p, val) => `請協助我整理提供給推薦信撰寫老師的特質素材（目標：${targetLabel(p)}）：\n1. 如何挑選 2 個符合該學系要求且能被老師在課堂/專題中親眼驗證的特質？\n2. 如何用具體事例說明「心理韌性」、「求知欲」或「合作溝通」，而不是只寫形容詞？`
    },
    recStory: {
      title: '推薦信：一個可說明特質的事件',
      tips: '💡 運用 STAR 架構：情境與任務 → 你採取的具體行動 → 結果與反思。',
      promptMaker: (p, val) => `請協助我把一個高中真實事件，整理成推薦老師可採用的 STAR 事實素材：\n情境與任務 → 遇到的具體阻礙 → 我採取的自主行動 → 最終留下的客觀結果與改變。\n${val ? `\n我目前的素材：\n「${val}」` : ''}`
    },
    recProof: {
      title: '推薦信：可提供老師核對的材料',
      tips: '💡 列出真實、可查證的筆記、實驗日誌、作業或作品，讓推薦人安心背書。',
      promptMaker: (p, val) => `請列出高中生提供給推薦信撰寫老師時，最有效且體貼的「查核材料清冊」架構，讓老師能省時且有根據地撰寫。`
    },
    stage3OfficialInfo: {
      title: '二階甄試官方規定與通知',
      tips: '💡 仔細核對面試通知中的時間、分組、是否需攜帶身分證件、是否可使用投影機等細節。',
      promptMaker: (p, val) => `請協助我整理「${yearText()}」${targetLabel(p)}二階甄試的應試注意事項與清單。`
    },
    stage3Topics: {
      title: '面試我想練習的主題',
      tips: '💡 練習重點在於聽懂問題、理性推理、承認不知道並提出假設，而非死背答案。',
      promptMaker: (p, val) => `請針對「${yearText()}」${targetLabel(p)}的${$('assessmentType').value}，為我預測 5 個最可能出現的考題方向：\n1. 自我介紹與報考動機題\n2. 高中專題/探究成果深入追問題\n3. 該學系當前熱門時事或跨領域題\n4. 挫折因應與人際協作情境題\n請說明每個題目教授背後的考核意圖。`
    },
    stage3PastInfo: {
      title: '學長姐經驗與歷屆考題',
      tips: '💡 網路經驗只作參考，不可當作固定題型。重點在於了解面試氛圍與教授提問邏輯。',
      promptMaker: (p, val) => `請搜尋或分析「${targetLabel(p)}」歷屆面試經驗與考古題型：\n1. 教授的提問風格偏向學術深究、生活探索還是臨場情境？\n2. 歷屆學長姐最常遇到的突發問題或黑臉教授提問是什麼？\n3. 面對未知或刁鑽提問，有何穩健的應對心態與策略？`
    }
  };

  function openFieldExploreModal(fieldId) {
    currentModalField = fieldId;
    const meta = FIELD_METADATA[fieldId] || {
      title: '此欄位靈感發想',
      tips: '💡 整理你的真實經歷，聚焦在動詞、客觀數據與個人反思。',
      promptMaker: (p, val) => `請針對申請「${targetLabel(p)}」的「${fieldId}」項目，提供具體構思與優化建議。`
    };

    const targetProg = selectedProgram(fieldId.startsWith('stage3') ? 'stage3Target' : 'stage2Target');
    const inputEl = $(fieldId);
    const val = inputEl ? inputEl.value.trim() : '';

    $('modalTitle').textContent = `AI 靈感發想・${meta.title}`;
    $('modalFieldTitle').textContent = meta.title;
    $('modalTargetProgram').textContent = targetLabel(targetProg);
    $('modalTips').innerHTML = meta.tips;

    const generatedPrompt = meta.promptMaker(targetProg, val);
    $('modalPromptText').value = generatedPrompt;

    $('aiModal').hidden = false;
  }

  function closeFieldExploreModal() {
    $('aiModal').hidden = true;
    if (currentModalField && $(currentModalField)) {
      $(currentModalField).focus();
    }
  }

  // 單欄優化提問詞生成
  function copySingleFieldRefine(fieldId) {
    const el = $(fieldId);
    if (!el) return;
    const val = el.value.trim();
    if (!val) {
      showToast('此欄位目前空白，請先點選標籤帶入關鍵字或填寫初稿！', 4000);
      openFieldExploreModal(fieldId);
      return;
    }

    const targetProg = selectedProgram(fieldId.startsWith('stage3') ? 'stage3Target' : 'stage2Target');
    const meta = FIELD_METADATA[fieldId] || { title: '申請素材' };

    const prompt = `你是高中升學備審輔導專家。請針對我在申請「${targetLabel(targetProg)}」時所撰寫的【${meta.title}】初稿進行專業診斷與精修：\n\n` +
      `【我撰寫的初稿如下】：\n「${val}」\n\n` +
      `【優化原則】：\n` +
      `1. 絕對不虛構未發生的經歷、成果或數據。\n` +
      `2. 保留高中生第一人稱真實語氣，避免官腔與空洞形容詞。\n` +
      `3. 運用具體動詞與 STAR 邏輯（情境、任務、具體行動、成果與反思），指出可補充的客觀佐證。\n` +
      `4. 請提供：(A) 2 點具體修改建議，(B) 1 個精煉示範版本（字數適中、段落清晰）。`;

    // 填入 Modal 並開啟，讓學生能一鍵複製或直接跳轉 Claude / ChatGPT / Gemini！
    $('modalTitle').textContent = `單欄優化提問詞・${meta.title}`;
    $('modalFieldTitle').textContent = `${meta.title}（精修優化）`;
    $('modalTargetProgram').textContent = targetLabel(targetProg);
    $('modalTips').innerHTML = '💡 <strong>已為你生成專屬優化 Prompt！</strong>點選下方按鈕，一鍵開啟 Claude / ChatGPT / Gemini 進行段落精修。';
    $('modalPromptText').value = prompt;
    currentModalField = fieldId;
    $('aiModal').hidden = false;

    copyText(prompt, false).then((ok) => {
      showToast(ok ? '優化提示詞已複製！可點選下方按鈕開啟 Claude 或 ChatGPT。' : '請選取下方提示詞手動複製。');
    });
  }

  // ===== 初始化事件綁定 =====
  document.addEventListener('DOMContentLoaded', () => {
    loadState();

    // 載入示範資料按鈕
    if ($('loadDemoButton')) {
      $('loadDemoButton').addEventListener('click', loadDemoData);
    }

    // 新增校系按鈕
    $('addProgram').addEventListener('click', () => {
      appendProgram(emptyProgram());
      renumberPrograms();
      syncAndRefresh();
    });

    // 表單輸入監聽
    const inputSelectors = [
      '[data-profile]',
      '#stage2 input:not(#includeStage2Context)',
      '#stage2 textarea',
      '#stage2 select',
      '#stage3 input:not(#includeStage3Context)',
      '#stage3 textarea',
      '#stage3 select'
    ];
    inputSelectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        el.addEventListener('input', () => {
          syncAndRefresh();
          updateSingleWordCount(el);
        });
        el.addEventListener('change', () => {
          syncAndRefresh();
          updateSingleWordCount(el);
        });
      });
    });

    // 授權 Checkbox 改變事件
    $('includeStage2Context').addEventListener('change', refreshPrompts);
    $('includeStage3Context').addEventListener('change', refreshPrompts);

    // 協作模式選擇器切換事件
    if ($('stage2PromptMode')) $('stage2PromptMode').addEventListener('change', refreshPrompts);
    if ($('stage3PromptMode')) $('stage3PromptMode').addEventListener('change', refreshPrompts);

    $('needRecommendation').addEventListener('change', syncAndRefresh);
    $('stage2Target').addEventListener('change', syncAndRefresh);
    $('stage3Target').addEventListener('change', syncAndRefresh);

    $('makePlan').addEventListener('click', renderPlan);
    $('copyPlan').addEventListener('click', () => {
      if (!lastPlanText) {
        lastPlanText = makePlanText();
        renderPlan();
      }
      copyText(lastPlanText);
    });

    $('makeRecDraft').addEventListener('click', () => {
      $('recDraft').value = buildRecommendationScaffold();
      syncAndRefresh();
      showToast('已建立素材架構；請由學生依真實經驗補寫。');
    });

    // Phase 2 AI 按鈕（含 Claude！）
    $('copyStage2Prompt').addEventListener('click', () => copyText(buildStage2Prompt()));
    if ($('openStage2Claude')) $('openStage2Claude').addEventListener('click', () => openProgramAI('claude', buildStage2Prompt()));
    $('openStage2ChatGPT').addEventListener('click', () => openProgramAI('chatgpt', buildStage2Prompt()));
    $('openStage2Gemini').addEventListener('click', () => openProgramAI('gemini', buildStage2Prompt()));

    // Phase 3 AI 按鈕（含 Claude！）
    $('copyStage3Prompt').addEventListener('click', () => copyText(buildStage3Prompt()));
    if ($('openStage3Claude')) $('openStage3Claude').addEventListener('click', () => openProgramAI('claude', buildStage3Prompt()));
    $('openStage3ChatGPT').addEventListener('click', () => openProgramAI('chatgpt', buildStage3Prompt()));
    $('openStage3Gemini').addEventListener('click', () => openProgramAI('gemini', buildStage3Prompt()));

    $('searchGoogleStage3').addEventListener('click', () => openGoogle(programSearchQuery(selectedProgram('stage3Target'), 'admission')));
    $('searchPastStage3').addEventListener('click', () => openGoogle(programSearchQuery(selectedProgram('stage3Target'), 'past')));

    // 清空對照筆記
    if ($('clearStage2AiNotes')) {
      $('clearStage2AiNotes').addEventListener('click', () => {
        if ($('stage2AiNotes')) {
          $('stage2AiNotes').value = '';
          syncAndRefresh();
          showToast('已清空階段二 AI 對照筆記。');
        }
      });
    }
    if ($('clearStage3AiNotes')) {
      $('clearStage3AiNotes').addEventListener('click', () => {
        if ($('stage3AiNotes')) {
          $('stage3AiNotes').value = '';
          syncAndRefresh();
          showToast('已清空階段三面試紀錄。');
        }
      });
    }

    // 階段導航
    document.querySelectorAll('.stage-link').forEach((button) => button.addEventListener('click', () => changeStage(button.dataset.stage)));
    document.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => changeStage(button.dataset.go)));
    $('printButton').addEventListener('click', () => window.print());
    $('exportButton').addEventListener('click', exportBackup);
    $('resetButton').addEventListener('click', resetLocalData);

    // 設定快捷標籤與起手句
    setupTagPills();
    setupSentenceStarters();

    // 先問 AI 靈感按鈕綁定 (btn-ai-sparkle)
    document.querySelectorAll('.btn-ai-sparkle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fieldId = btn.dataset.explore;
        if (fieldId) openFieldExploreModal(fieldId);
      });
    });

    // 單欄 AI 優化按鈕綁定 (btn-field-ai)
    document.querySelectorAll('.btn-field-ai').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fieldId = btn.dataset.refine;
        if (fieldId) copySingleFieldRefine(fieldId);
      });
    });

    // Modal 動作按鈕綁定
    if ($('closeAiModal')) $('closeAiModal').addEventListener('click', closeFieldExploreModal);
    if ($('copyModalPrompt')) $('copyModalPrompt').addEventListener('click', () => copyText($('modalPromptText').value));
    if ($('openModalClaude')) $('openModalClaude').addEventListener('click', () => openAI('claude', $('modalPromptText').value));
    if ($('openModalChatGPT')) $('openModalChatGPT').addEventListener('click', () => openAI('chatgpt', $('modalPromptText').value));
    if ($('openModalGemini')) $('openModalGemini').addEventListener('click', () => openAI('gemini', $('modalPromptText').value));

    // 按 Escape 關閉 Modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('aiModal').hidden) {
        closeFieldExploreModal();
      }
    });

    refreshPrompts();
    updateAllWordCounters();
    updateProgress();
  });
})();
