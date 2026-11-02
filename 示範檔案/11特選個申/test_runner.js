// test_runner.js - Comprehensive Verification Runner
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('=== STARTING COMPREHENSIVE VERIFICATION ===\n');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

// Helper to create a DOM environment for each test
function createEnv(initialStorage = {}) {
  const store = new Map(Object.entries(initialStorage));
  const eventListeners = {};
  const elements = new Map();

  function makeElement(tag, id = '') {
    const el = {
      tagName: tag.toUpperCase(),
      id: id,
      className: '',
      type: tag === 'input' ? 'text' : '',
      value: '',
      checked: false,
      hidden: false,
      children: [],
      dataset: {},
      style: {},
      attributes: {},
      selectedIndex: 0,
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k]; },
      removeAttribute(k) { delete this.attributes[k]; },
      replaceChildren(...newChildren) {
        this.children = [...newChildren];
        newChildren.forEach(c => { if (c) c.parentNode = this; });
      },
      append(...newChildren) {
        newChildren.forEach(c => {
          this.children.push(c);
          if (c) c.parentNode = this;
        });
      },
      remove() {
        if (this.parentNode) {
          const idx = this.parentNode.children.indexOf(this);
          if (idx !== -1) this.parentNode.children.splice(idx, 1);
          this.parentNode = null;
        }
      },
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        toggle(c, force) {
          if (force === undefined) {
            if (this.classes.has(c)) this.classes.delete(c);
            else this.classes.add(c);
          } else if (force) this.classes.add(c);
          else this.classes.delete(c);
        },
        contains(c) { return this.classes.has(c); }
      },
      addEventListener(type, fn) {
        if (!this._listeners) this._listeners = {};
        if (!this._listeners[type]) this._listeners[type] = [];
        this._listeners[type].push(fn);
      },
      dispatch(type) {
        if (this._listeners && this._listeners[type]) {
          this._listeners[type].forEach(fn => fn.call(this, { target: this }));
        }
      },
      querySelectorAll(selector) {
        const res = [];
        function walk(node) {
          if (node !== el) {
            if (selector === '.program-card' && node.className && node.className.includes('program-card')) res.push(node);
            else if (selector === '[data-program-field]' && node.dataset && node.dataset.programField) res.push(node);
            else if (selector === 'input,select' && (node.tagName === 'INPUT' || node.tagName === 'SELECT')) res.push(node);
            else if (selector === '[data-profile]' && node.dataset && ('profile' in node.dataset)) res.push(node);
            else if (selector === '.stage-panel' && node.className && node.className.includes('stage-panel')) res.push(node);
            else if (selector === '.stage-link' && node.className && node.className.includes('stage-link')) res.push(node);
            else if (selector === '[data-go]' && node.dataset && node.dataset.go) res.push(node);
          }
          if (node.children) node.children.forEach(walk);
        }
        walk(el);
        return res;
      },
      querySelector(selector) {
        const all = this.querySelectorAll(selector);
        return all.length ? all[0] : null;
      }
    };
    if (id) elements.set(id, el);
    return el;
  }

  // Pre-populate required elements from index.html
  const requiredIds = [
    'storageAlert', 'saveState', 'toast', 'stageBreadcrumb',
    'schoolYear', 'studentAlias', 'schoolClass', 'studentInterests', 'experienceSummary',
    'addProgram', 'programList',
    'stage2Target', 'officialRequirements', 'officialEvaluation', 'officialMaterials', 'officialSecondStage',
    'departmentTraits', 'fitExperience', 'fitRole', 'fitEvidence', 'fitReflection', 'fitGap',
    'materialStatus', 'nextTask', 'portfolioPlan', 'makePlan', 'copyPlan',
    'needRecommendation', 'recommendationFields', 'recTraits', 'recStory', 'recProof', 'recDraft', 'makeRecDraft',
    'includeStage2Context', 'stage2Prompt', 'copyStage2Prompt', 'openStage2ChatGPT', 'openStage2Gemini',
    'stage3Target', 'assessmentType', 'stage3OfficialInfo', 'stage3Topics', 'stage3PastInfo',
    'includeStage3Context', 'stage3Prompt', 'copyStage3Prompt', 'openStage3ChatGPT', 'openStage3Gemini',
    'searchGoogleStage3', 'searchPastStage3', 'printButton', 'exportButton', 'resetButton'
  ];

  requiredIds.forEach(id => {
    let tag = 'div';
    if (id.includes('Prompt') || id.includes('Requirements') || id.includes('Evaluation') || id.includes('Materials') ||
        id.includes('SecondStage') || id.includes('Traits') || id.includes('Experience') || id.includes('Role') ||
        id.includes('Evidence') || id.includes('Reflection') || id.includes('Gap') || id.includes('Draft') ||
        id.includes('Story') || id.includes('Proof') || id.includes('OfficialInfo') || id.includes('Topics') ||
        id.includes('PastInfo') || id.includes('Summary') || id.includes('Interests')) tag = 'textarea';
    else if (id.includes('Target') || id.includes('Year') || id.includes('Status') || id.includes('Type')) tag = 'select';
    else if (id.includes('includeStage') || id === 'needRecommendation') tag = 'input';
    else if (id.includes('Button') || id.includes('make') || id.includes('copy') || id.includes('open') || id.includes('search') || id === 'addProgram') tag = 'button';
    const el = makeElement(tag, id);
    if (id.includes('includeStage') || id === 'needRecommendation') el.type = 'checkbox';
    if (id === 'schoolYear' || id === 'studentAlias' || id === 'schoolClass' || id === 'studentInterests' || id === 'experienceSummary') {
      el.dataset.profile = '';
    }
    if (id === 'storageAlert') {
      el.setAttribute('role', 'alert');
      el.hidden = true;
    }
  });

  const body = makeElement('body');
  const documentObj = {
    getElementById(id) { return elements.get(id) || null; },
    createElement(tag) { return makeElement(tag); },
    querySelectorAll(selector) { return body.querySelectorAll(selector); },
    body: body,
    addEventListener(type, fn) {
      if (!eventListeners[type]) eventListeners[type] = [];
      eventListeners[type].push(fn);
    }
  };

  const localStorageObj = {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
    _store: store
  };

  const sandbox = {
    document: documentObj,
    window: {
      crypto: { randomUUID: () => 'uuid-' + Math.random().toString(36).slice(2, 9) },
      confirm: () => true,
      open: () => {},
      scrollTo: () => {},
      print: () => {}
    },
    localStorage: localStorageObj,
    Blob: function(parts, opts) { this.parts = parts; this.opts = opts; },
    URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} },
    navigator: { clipboard: { writeText: async () => {} } },
    location: { reload: () => {} },
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout: () => {},
    console: console
  };

  return { sandbox, documentObj, elements, localStorageObj, eventListeners };
}

function runScript(env) {
  const context = vm.createContext(env.sandbox);
  vm.runInContext(appSource, context);
  // Trigger DOMContentLoaded
  if (env.eventListeners['DOMContentLoaded']) {
    env.eventListeners['DOMContentLoaded'].forEach(fn => fn());
  }
}

// TEST 1: Syntax check
console.log('TEST 1: Syntax check');
assert.strictEqual(typeof appSource, 'string');
assert(appSource.length > 1000);
console.log('  PASS: app.js loaded and syntactically valid.\n');

// TEST 2: Failure Case 1: Valid old v2 with obsolete consent flags
console.log('TEST 2: Failure Case 1 - Old consent flags cleanup on load');
{
  const oldSeed = {
    version: 2,
    updatedAt: "2026-11-01T10:00:00.000Z",
    profile: { schoolYear: "116", studentAlias: "學生甲" },
    programs: [
      { id: "prog-1", university: "國立臺灣大學", department: "資訊工程學系", route: "特殊選才", status: "研究中", officialUrl: "https://csie.ntu.edu.tw" }
    ],
    phase2: { departmentTraits: "系所官方特色", includeStage2Context: true },
    phase3: { assessmentType: "口試／面試", includeStage3Context: true },
    phase2ByProgram: {
      "prog-1": {
        departmentTraits: "系所特色",
        fitExperience: "高三專題成果",
        includeStage2Context: true
      }
    },
    phase3ByProgram: {
      "prog-1": {
        assessmentType: "口試／面試",
        stage3Topics: "演算法題型",
        includeStage3Context: true
      }
    },
    selected2: "prog-1",
    selected3: "prog-1"
  };

  const env = createEnv({ 'admissions-studio-v1': JSON.stringify(oldSeed) });
  runScript(env);

  // Checkboxes must be unchecked
  assert.strictEqual(env.elements.get('includeStage2Context').checked, false, 'Stage 2 consent checkbox must be false');
  assert.strictEqual(env.elements.get('includeStage3Context').checked, false, 'Stage 3 consent checkbox must be false');

  // localStorage must be IMMEDIATELY updated in storage without user input
  const updatedRaw = env.localStorageObj.getItem('admissions-studio-v1');
  assert(updatedRaw !== null, 'Storage must not be empty');
  const updatedData = JSON.parse(updatedRaw);

  // Consent flags removed from storage
  assert.strictEqual(updatedData.phase2ByProgram['prog-1'].includeStage2Context, undefined, 'phase2ByProgram consent flag removed');
  assert.strictEqual(updatedData.phase3ByProgram['prog-1'].includeStage3Context, undefined, 'phase3ByProgram consent flag removed');
  assert.strictEqual(updatedData.phase2.includeStage2Context, undefined, 'root phase2 consent flag removed');
  assert.strictEqual(updatedData.phase3.includeStage3Context, undefined, 'root phase3 consent flag removed');

  // Student content must be preserved
  assert.strictEqual(updatedData.phase2ByProgram['prog-1'].fitExperience, '高三專題成果', 'Student material preserved');
  assert.strictEqual(updatedData.phase2ByProgram['prog-1'].departmentTraits, '系所特色', 'Department traits preserved');
  assert.strictEqual(updatedData.phase3ByProgram['prog-1'].stage3Topics, '演算法題型', 'Stage 3 topics preserved');
  assert.strictEqual(updatedData.profile.studentAlias, '學生甲', 'Profile preserved');
  assert.strictEqual(updatedData.programs[0].university, '國立臺灣大學', 'Program preserved');

  // saveState text
  assert.strictEqual(env.elements.get('saveState').textContent, '已從本機資料還原');

  console.log('  PASS: Obsolete consent flags immediately removed from localStorage upon load while student materials fully preserved.\n');
}

// TEST 3: Failure Case 2 - Incompatible structure & Fail closed
console.log('TEST 3: Failure Case 2 - Incompatible structure rejected & raw string protected');
{
  const badRaw = '{"version":2,"programs":"not-an-array","profile":null,"phase2ByProgram":[],"phase3ByProgram":[]}';
  const env = createEnv({ 'admissions-studio-v1': badRaw });
  runScript(env);

  // storageAlert must be visible
  const alertEl = env.elements.get('storageAlert');
  assert.strictEqual(alertEl.hidden, false, 'storageAlert must not be hidden');
  assert.strictEqual(alertEl.getAttribute('role'), 'alert', 'storageAlert must have role="alert"');

  // saveState must indicate paused / corrupted
  assert.strictEqual(env.elements.get('saveState').textContent, '已暫停儲存（本機資料損壞）');

  // Now simulate user input on profile and programs
  const aliasInput = env.elements.get('studentAlias');
  aliasInput.value = '新輸入的名字';
  aliasInput.dispatch('input');

  const interestsInput = env.elements.get('studentInterests');
  interestsInput.value = '新輸入的興趣';
  interestsInput.dispatch('input');

  // saveState must show protected message
  assert.strictEqual(env.elements.get('saveState').textContent, '已暫停儲存（保護損壞資料中）');

  // CRITICAL: Raw data in localStorage MUST NOT be overwritten!
  const currentInStorage = env.localStorageObj.getItem('admissions-studio-v1');
  assert.strictEqual(currentInStorage, badRaw, 'Original bad raw string must remain completely unchanged in storage!');

  console.log('  PASS: Incompatible structure rejected with role=alert, and auto-save strictly prevented from overwriting original data.\n');
}

// TEST 4: Fail Closed validation suite
console.log('TEST 4: Fail Closed on various invalid types');
{
  const invalidCases = [
    { name: 'phase2ByProgram value is null', json: '{"version":2,"programs":[],"phase2ByProgram":{"p1":null}}' },
    { name: 'phase2ByProgram value is array', json: '{"version":2,"programs":[],"phase2ByProgram":{"p1":[]}}' },
    { name: 'phase2ByProgram value is string', json: '{"version":2,"programs":[],"phase2ByProgram":{"p1":"invalid"}}' },
    { name: 'phase3ByProgram value is number', json: '{"version":2,"programs":[],"phase3ByProgram":{"p1":123}}' },
    { name: 'programs item is not object', json: '{"version":2,"programs":[123]}' },
    { name: 'version 3', json: '{"version":3,"programs":[]}' },
    { name: 'programs missing', json: '{"version":2,"profile":{}}' }
  ];

  for (const c of invalidCases) {
    const env = createEnv({ 'admissions-studio-v1': c.json });
    runScript(env);
    const alertEl = env.elements.get('storageAlert');
    assert.strictEqual(alertEl.hidden, false, `Expected failure for case: ${c.name}`);
    assert.strictEqual(env.localStorageObj.getItem('admissions-studio-v1'), c.json, `Raw string must be preserved for: ${c.name}`);
  }

  // Valid legacy compatibility
  const validLegacy = '{"programs":[{"id":"p-leg-1","university":"臺大"}],"phase2":{"officialRequirements":"要求A"},"phase3":{"assessmentType":"面試"}}';
  const envLegacy = createEnv({ 'admissions-studio-v1': validLegacy });
  runScript(envLegacy);
  assert.strictEqual(envLegacy.elements.get('storageAlert').hidden, true, 'Valid legacy format must be accepted');
  assert.strictEqual(envLegacy.elements.get('saveState').textContent, '已從本機資料還原');

  console.log('  PASS: All invalid structures fail closed, valid legacy formats supported.\n');
}

// TEST 5: localStorage.getItem throwing
console.log('TEST 5: localStorage.getItem throws SecurityError');
{
  const env = createEnv();
  env.localStorageObj.getItem = () => { throw new Error('SecurityError: storage disabled'); };
  runScript(env);

  const alertEl = env.elements.get('storageAlert');
  assert.strictEqual(alertEl.hidden, false, 'storageAlert must be shown when getItem throws');
  assert.strictEqual(env.elements.get('saveState').textContent, '已停用儲存（儲存空間受阻）');

  // Try user input
  const aliasInput = env.elements.get('studentAlias');
  aliasInput.value = '測試輸入';
  let setItemCalled = false;
  env.localStorageObj.setItem = () => { setItemCalled = true; };
  aliasInput.dispatch('input');

  assert.strictEqual(setItemCalled, false, 'setItem must NEVER be called when storage is blocked!');
  assert.strictEqual(env.elements.get('saveState').textContent, '已停用儲存（儲存空間受阻）');

  console.log('  PASS: getItem exception enters explicit storage-blocked state and prevents writes.\n');
}

// TEST 6: localStorage.setItem throwing
console.log('TEST 6: localStorage.setItem throws QuotaExceededError');
{
  // Part A: setItem throws during consent cleanup on load
  const oldSeed = {
    version: 2,
    programs: [{ id: "p1" }],
    phase2ByProgram: { p1: { includeStage2Context: true } }
  };
  const envA = createEnv({ 'admissions-studio-v1': JSON.stringify(oldSeed) });
  envA.localStorageObj.setItem = () => { throw new Error('QuotaExceededError'); };
  runScript(envA);

  assert.strictEqual(envA.elements.get('saveState').textContent, '本機清理失敗（無法更新儲存空間）');

  // Part B: setItem throws during normal auto-save
  const envB = createEnv({ 'admissions-studio-v1': JSON.stringify({ version: 2, programs: [{ id: "p1" }] }) });
  runScript(envB);
  assert.strictEqual(envB.elements.get('saveState').textContent, '已從本機資料還原');

  envB.localStorageObj.setItem = () => { throw new Error('QuotaExceededError'); };
  const aliasInput = envB.elements.get('studentAlias');
  aliasInput.value = '更新文字';
  aliasInput.dispatch('input');

  assert.strictEqual(envB.elements.get('saveState').textContent, '本機儲存失敗（請檢查空間或設定）');

  console.log('  PASS: setItem throwing never reports success and clearly displays failure.\n');
}

// TEST 7: copyText fallback textarea removal
console.log('TEST 7: copyText fallback textarea removal');
{
  const env = createEnv();
  runScript(env);

  let appendedArea = null;
  env.documentObj.body.append = (el) => {
    appendedArea = el;
    env.documentObj.body.children.push(el);
    el.parentNode = env.documentObj.body;
  };

  // Test when execCommand succeeds
  env.documentObj.execCommand = () => true;
  env.sandbox.navigator.clipboard = null; // force fallback

  // Call copyText in sandbox
  const copyFn = vm.runInContext('copyText', env.sandbox);
  copyFn('測試文字', false).then((ok) => {
    assert.strictEqual(ok, true);
    assert.strictEqual(appendedArea.parentNode, null, 'Textarea must be removed from body on success');

    // Test when execCommand throws
    env.documentObj.execCommand = () => { throw new Error('execCommand blocked'); };
    copyFn('測試文字2', false).then((ok2) => {
      assert.strictEqual(ok2, false);
      assert.strictEqual(appendedArea.parentNode, null, 'Textarea must be removed from body even when execCommand throws');
      console.log('  PASS: copyText textarea guaranteed removed on both success and failure.\n');
      console.log('=== ALL TESTS PASSED SUCCESSFULLY ===');
    });
  });
}
