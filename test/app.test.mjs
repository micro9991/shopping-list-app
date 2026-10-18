import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const STORAGE_KEY = 'shopping-list-items';
const HTML = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'),
  'utf8'
);

// 앱을 새 DOM에 로드한다. seed를 주면 이전 세션의 localStorage 상태를 재현한다.
function loadApp(seed) {
  const dom = new JSDOM(HTML, {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    beforeParse(window) {
      if (seed !== undefined) window.localStorage.setItem(STORAGE_KEY, seed);
    }
  });

  const { window } = dom;
  const { document } = window;
  const $ = sel => document.querySelector(sel);

  const api = {
    window,
    document,
    input: $('#input'),
    addBtn: $('.add'),
    clearBtn: $('#clear'),
    emptyMsg: $('#empty'),
    count: $('#count'),

    // 사용자가 입력창에 적고 "추가"를 누르는 동작
    add(name) {
      api.input.value = name;
      api.addBtn.click();
    },
    rows: () => [...document.querySelectorAll('#list li')],
    names: () => api.rows().map(li => li.querySelector('.name').textContent),
    doneFlags: () => api.rows().map(li => li.classList.contains('done')),
    checkboxes: () => api.rows().map(li => li.querySelector('input[type="checkbox"]')),
    stored: () => JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null'),
    emptyVisible: () => api.emptyMsg.style.display !== 'none'
  };

  return api;
}

describe('초기 상태', () => {
  let app;
  before(() => { app = loadApp(); });

  test('목록이 비어 있고 안내 문구가 보인다', () => {
    assert.equal(app.rows().length, 0);
    assert.equal(app.emptyVisible(), true);
  });

  test('카운터는 비어 있고 "체크한 항목 비우기"는 비활성화된다', () => {
    assert.equal(app.count.textContent, '');
    assert.equal(app.clearBtn.disabled, true);
  });
});

describe('추가 기능', () => {
  test('항목을 추가하면 목록에 나타나고 입력창이 비워진다', () => {
    const app = loadApp();
    app.add('우유 2개');

    assert.deepEqual(app.names(), ['우유 2개']);
    assert.equal(app.input.value, '');
    assert.equal(app.emptyVisible(), false);
  });

  test('여러 항목이 입력한 순서대로 쌓인다', () => {
    const app = loadApp();
    ['우유', '계란', '식빵'].forEach(app.add);

    assert.deepEqual(app.names(), ['우유', '계란', '식빵']);
    assert.equal(app.count.textContent, '전체 3개 · 완료 0개');
  });

  test('같은 이름도 별개 항목으로 추가된다', () => {
    const app = loadApp();
    app.add('사과');
    app.add('사과');

    assert.equal(app.rows().length, 2);
    const [a, b] = app.stored().map(it => it.id);
    assert.notEqual(a, b, 'id가 중복되면 체크/삭제가 엉킨다');
  });

  test('Enter 키 제출(form submit)로도 추가된다', () => {
    const app = loadApp();
    app.input.value = '양파';
    const form = app.document.getElementById('form');
    form.dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));

    assert.deepEqual(app.names(), ['양파']);
  });

  test('빈 값과 공백만 입력한 값은 무시된다', () => {
    const app = loadApp();
    app.add('');
    app.add('   ');

    assert.equal(app.rows().length, 0);
    assert.equal(app.emptyVisible(), true);
  });

  test('앞뒤 공백은 잘라서 저장된다', () => {
    const app = loadApp();
    app.add('  두부  ');

    assert.deepEqual(app.names(), ['두부']);
  });

  test('HTML 문자열을 넣어도 텍스트로 그대로 표시된다 (삽입 방지)', () => {
    const app = loadApp();
    const payload = '<img src=x onerror="window.__xss=1">';
    app.add(payload);

    assert.deepEqual(app.names(), [payload]);
    assert.equal(app.document.querySelector('#list img'), null);
    assert.equal(app.window.__xss, undefined);
  });
});

describe('체크 기능', () => {
  test('체크박스를 누르면 완료 표시되고 카운터가 바뀐다', () => {
    const app = loadApp();
    ['우유', '계란'].forEach(app.add);
    app.checkboxes()[0].click();

    assert.deepEqual(app.doneFlags(), [true, false]);
    assert.equal(app.checkboxes()[0].checked, true);
    assert.equal(app.count.textContent, '전체 2개 · 완료 1개');
    assert.equal(app.clearBtn.disabled, false);
  });

  test('항목 이름을 클릭해도 체크된다', () => {
    const app = loadApp();
    app.add('계란');
    app.rows()[0].querySelector('.name').click();

    assert.deepEqual(app.doneFlags(), [true]);
  });

  test('다시 누르면 체크가 해제된다', () => {
    const app = loadApp();
    app.add('식빵');
    app.checkboxes()[0].click();
    app.checkboxes()[0].click();

    assert.deepEqual(app.doneFlags(), [false]);
    assert.equal(app.checkboxes()[0].checked, false);
    assert.equal(app.count.textContent, '전체 1개 · 완료 0개');
    assert.equal(app.clearBtn.disabled, true);
  });

  test('체크는 누른 항목에만 적용된다', () => {
    const app = loadApp();
    ['우유', '계란', '식빵'].forEach(app.add);
    app.checkboxes()[1].click();

    assert.deepEqual(app.doneFlags(), [false, true, false]);
    assert.deepEqual(app.stored().map(it => it.done), [false, true, false]);
  });
});

describe('삭제 기능', () => {
  const del = (app, i) => app.rows()[i].querySelector('.del').click();

  test('가운데 항목을 지우면 그 항목만 사라진다', () => {
    const app = loadApp();
    ['우유', '계란', '식빵'].forEach(app.add);
    del(app, 1);

    assert.deepEqual(app.names(), ['우유', '식빵']);
    assert.equal(app.count.textContent, '전체 2개 · 완료 0개');
  });

  test('체크된 항목을 지워도 나머지 체크 상태는 유지된다', () => {
    const app = loadApp();
    ['우유', '계란', '식빵'].forEach(app.add);
    app.checkboxes()[0].click();
    app.checkboxes()[2].click();
    del(app, 0);

    assert.deepEqual(app.names(), ['계란', '식빵']);
    assert.deepEqual(app.doneFlags(), [false, true]);
  });

  test('전부 지우면 빈 목록 안내가 다시 나온다', () => {
    const app = loadApp();
    ['우유', '계란'].forEach(app.add);
    del(app, 0);
    del(app, 0);

    assert.equal(app.rows().length, 0);
    assert.equal(app.emptyVisible(), true);
    assert.equal(app.count.textContent, '');
    assert.equal(app.clearBtn.disabled, true);
    assert.deepEqual(app.stored(), []);
  });
});

describe('체크한 항목 비우기', () => {
  test('완료된 항목만 지우고 나머지는 남긴다', () => {
    const app = loadApp();
    ['우유', '계란', '식빵'].forEach(app.add);
    app.checkboxes()[0].click();
    app.checkboxes()[2].click();
    app.clearBtn.click();

    assert.deepEqual(app.names(), ['계란']);
    assert.equal(app.clearBtn.disabled, true);
  });

  test('완료된 항목이 없으면 버튼이 비활성화되어 있다', () => {
    const app = loadApp();
    app.add('우유');

    assert.equal(app.clearBtn.disabled, true);
  });
});

describe('localStorage 저장/복원', () => {
  test('추가·체크 결과가 저장 형식에 맞게 기록된다', () => {
    const app = loadApp();
    app.add('우유');
    app.checkboxes()[0].click();

    const stored = app.stored();
    assert.equal(stored.length, 1);
    assert.equal(stored[0].name, '우유');
    assert.equal(stored[0].done, true);
    assert.equal(typeof stored[0].id, 'string');
  });

  test('새로고침하면 목록과 체크 상태가 그대로 복원된다', () => {
    const first = loadApp();
    ['우유', '계란', '식빵'].forEach(first.add);
    first.checkboxes()[1].click();
    const snapshot = first.window.localStorage.getItem(STORAGE_KEY);

    const reopened = loadApp(snapshot);
    assert.deepEqual(reopened.names(), ['우유', '계란', '식빵']);
    assert.deepEqual(reopened.doneFlags(), [false, true, false]);
    assert.deepEqual(reopened.checkboxes().map(c => c.checked), [false, true, false]);
    assert.equal(reopened.count.textContent, '전체 3개 · 완료 1개');
  });

  test('저장값이 깨져 있어도 빈 목록으로 안전하게 시작한다', () => {
    for (const bad of ['not json', '{"a":1}', 'null']) {
      const app = loadApp(bad);
      assert.equal(app.rows().length, 0, `입력: ${bad}`);
      assert.equal(app.emptyVisible(), true);
    }
  });

  test('배열 안에 잘못된 항목이 섞여 있으면 걸러낸다', () => {
    const app = loadApp(JSON.stringify([
      { id: 'a', name: '우유', done: true },
      null,
      { id: 'b', done: false },
      { name: '계란' }
    ]));

    assert.deepEqual(app.names(), ['우유', '계란']);
    assert.deepEqual(app.doneFlags(), [true, false]);
  });
});
