import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const LEGACY_KEY = 'shopping-list-items';
const HTML = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'),
  'utf8'
);

/**
 * 테스트용 Supabase 클라이언트. 네트워크 없이 메모리 배열을 테이블처럼 다루며,
 * 앱이 실제로 쓰는 체이닝(select/order/insert/update/delete/eq/in/single)만 구현한다.
 * failOn에 연산 이름을 주면 그 연산이 오류를 돌려준다.
 */
function fakeSupabase({ rows = [], failOn = null } = {}) {
  const table = rows.map((r, i) => ({ id: r.id || `row-${i + 1}`, name: r.name, done: !!r.done }));
  const calls = [];
  let seq = table.length;

  const matches = (row, filters) =>
    filters.every(f => (f.many ? f.value.includes(row[f.column]) : row[f.column] === f.value));

  function builder(op, payload) {
    const filters = [];
    let wantsRow = false;
    let single = false;

    const run = () => {
      calls.push({ op, payload });
      if (failOn === op) {
        return { data: null, error: { message: '테스트용 오류' } };
      }

      if (op === 'select') {
        return { data: table.map(r => ({ ...r })), error: null };
      }

      if (op === 'insert') {
        const incoming = Array.isArray(payload) ? payload : [payload];
        const created = incoming.map(r => ({
          id: `row-${++seq}`,
          name: r.name,
          done: !!r.done
        }));
        table.push(...created);
        if (!wantsRow) return { data: null, error: null };
        return { data: single ? { ...created[0] } : created.map(r => ({ ...r })), error: null };
      }

      if (op === 'update') {
        table.filter(r => matches(r, filters)).forEach(r => Object.assign(r, payload));
        return { data: null, error: null };
      }

      if (op === 'delete') {
        for (let i = table.length - 1; i >= 0; i--) {
          if (matches(table[i], filters)) table.splice(i, 1);
        }
        return { data: null, error: null };
      }

      throw new Error(`구현되지 않은 연산: ${op}`);
    };

    const api = {
      select() { wantsRow = true; return api; },
      order() { return api; },
      eq(column, value) { filters.push({ column, value }); return api; },
      in(column, value) { filters.push({ column, value, many: true }); return api; },
      single() { single = true; return api; },
      then(onOk, onErr) { return Promise.resolve().then(run).then(onOk, onErr); }
    };
    return api;
  }

  return {
    createClient: () => ({
      from: () => ({
        select: () => builder('select'),
        insert: payload => builder('insert', payload),
        update: payload => builder('update', payload),
        delete: () => builder('delete')
      })
    }),
    _table: table,
    _calls: calls
  };
}

// 앱을 새 DOM에 올린다. library:false 로 주면 CDN 스크립트가 실패한 상황을 재현한다.
async function loadApp({ rows = [], failOn = null, legacy, library = true } = {}) {
  const stub = fakeSupabase({ rows, failOn });

  const dom = new JSDOM(HTML, {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    beforeParse(window) {
      if (library) window.supabase = stub;
      if (legacy !== undefined) window.localStorage.setItem(LEGACY_KEY, legacy);
    }
  });

  const { window } = dom;
  const { document } = window;

  const app = {
    window,
    document,
    db: stub,
    input: document.getElementById('input'),
    addBtn: document.getElementById('add'),
    clearBtn: document.getElementById('clear'),
    status: document.getElementById('status'),
    empty: document.getElementById('empty'),
    count: document.getElementById('count'),

    rows: () => [...document.querySelectorAll('#list li')],
    names: () => app.rows().map(li => li.querySelector('.name').textContent),
    doneFlags: () => app.rows().map(li => li.classList.contains('done')),
    checkboxes: () => app.rows().map(li => li.querySelector('input[type="checkbox"]')),
    emptyVisible: () => app.empty.style.display !== 'none',
    statusText: () => app.status.textContent,
    isError: () => app.status.classList.contains('error'),
    tableState: () => stub._table.map(r => `${r.name}:${r.done}`),

    submit(name) {
      app.input.value = name;
      app.addBtn.click();
    },

    // 앱의 DB 호출은 비동기이므로 화면이 기대 상태가 될 때까지 기다린다.
    async until(predicate, label) {
      for (let i = 0; i < 200; i++) {
        if (predicate()) return;
        await new Promise(r => setTimeout(r, 5));
      }
      throw new Error(`대기 시간 초과: ${label}`);
    }
  };

  await window.__appReady;
  return app;
}

describe('초기 로드', () => {
  test('DB에 있는 항목을 순서대로 보여준다', async () => {
    const app = await loadApp({ rows: [
      { name: '우유', done: false },
      { name: '계란', done: true }
    ] });

    assert.deepEqual(app.names(), ['우유', '계란']);
    assert.deepEqual(app.doneFlags(), [false, true]);
    assert.equal(app.count.textContent, '전체 2개 · 완료 1개');
    assert.equal(app.statusText(), '', '로드가 끝나면 상태줄은 비어야 한다');
    assert.equal(app.input.disabled, false);
  });

  test('DB가 비어 있으면 안내 문구를 보여준다', async () => {
    const app = await loadApp();

    assert.equal(app.rows().length, 0);
    assert.equal(app.emptyVisible(), true);
    assert.equal(app.clearBtn.disabled, true);
  });

  test('로드에 실패하면 오류를 표시한다', async () => {
    const app = await loadApp({ failOn: 'select' });

    assert.match(app.statusText(), /목록을 불러오지 못했습니다/);
    assert.equal(app.isError(), true);
    assert.equal(app.input.disabled, true, '실패 시 입력창은 잠겨 있어야 한다');
  });

  test('Supabase 라이브러리를 못 불러오면 안내한다', async () => {
    const app = await loadApp({ library: false });

    assert.match(app.statusText(), /Supabase 라이브러리를 불러오지 못했습니다/);
    assert.equal(app.isError(), true);
  });
});

describe('추가 기능', () => {
  test('추가하면 DB에 저장되고 화면에 나타난다', async () => {
    const app = await loadApp();
    app.submit('우유 2개');
    await app.until(() => app.rows().length === 1, '항목 추가');

    assert.deepEqual(app.names(), ['우유 2개']);
    assert.deepEqual(app.tableState(), ['우유 2개:false']);
    assert.equal(app.input.value, '');
    assert.equal(app.emptyVisible(), false);
  });

  test('여러 항목이 입력한 순서대로 쌓인다', async () => {
    const app = await loadApp();
    for (const name of ['우유', '계란', '식빵']) {
      app.submit(name);
      await app.until(() => app.names().includes(name), `${name} 추가`);
    }

    assert.deepEqual(app.names(), ['우유', '계란', '식빵']);
    assert.equal(app.count.textContent, '전체 3개 · 완료 0개');
  });

  test('빈 값과 공백만 입력한 값은 DB에 보내지 않는다', async () => {
    const app = await loadApp();
    app.submit('');
    app.submit('   ');

    assert.equal(app.rows().length, 0);
    assert.equal(app.db._calls.filter(c => c.op === 'insert').length, 0);
  });

  test('앞뒤 공백은 잘라서 저장한다', async () => {
    const app = await loadApp();
    app.submit('  두부  ');
    await app.until(() => app.rows().length === 1, '공백 제거 후 추가');

    assert.deepEqual(app.tableState(), ['두부:false']);
  });

  test('HTML 문자열을 넣어도 텍스트로 표시된다', async () => {
    const app = await loadApp();
    const payload = '<img src=x onerror="window.__xss=1">';
    app.submit(payload);
    await app.until(() => app.rows().length === 1, 'HTML 문자열 추가');

    assert.deepEqual(app.names(), [payload]);
    assert.equal(app.document.querySelector('#list img'), null);
    assert.equal(app.window.__xss, undefined);
  });

  test('추가에 실패하면 오류를 알리고 목록은 그대로 둔다', async () => {
    const app = await loadApp({ failOn: 'insert' });
    app.submit('우유');
    await app.until(() => app.isError(), '추가 실패 표시');

    assert.match(app.statusText(), /추가하지 못했습니다/);
    assert.equal(app.rows().length, 0);
  });
});

describe('체크 기능', () => {
  test('체크박스를 누르면 DB에 반영된다', async () => {
    const app = await loadApp({ rows: [{ name: '우유' }, { name: '계란' }] });
    app.checkboxes()[0].click();
    await app.until(() => app.doneFlags()[0] === true, '체크 반영');

    assert.deepEqual(app.doneFlags(), [true, false]);
    assert.deepEqual(app.tableState(), ['우유:true', '계란:false']);
    assert.equal(app.count.textContent, '전체 2개 · 완료 1개');
    assert.equal(app.clearBtn.disabled, false);
  });

  test('항목 이름을 클릭해도 체크된다', async () => {
    const app = await loadApp({ rows: [{ name: '계란' }] });
    app.rows()[0].querySelector('.name').click();
    await app.until(() => app.doneFlags()[0] === true, '이름 클릭 체크');

    assert.deepEqual(app.tableState(), ['계란:true']);
  });

  test('다시 누르면 체크가 해제된다', async () => {
    const app = await loadApp({ rows: [{ name: '식빵', done: true }] });
    app.checkboxes()[0].click();
    await app.until(() => app.doneFlags()[0] === false, '체크 해제');

    assert.deepEqual(app.tableState(), ['식빵:false']);
    assert.equal(app.clearBtn.disabled, true);
  });

  test('체크에 실패하면 화면 표시를 되돌린다', async () => {
    const app = await loadApp({ rows: [{ name: '우유' }], failOn: 'update' });
    app.checkboxes()[0].click();
    await app.until(() => app.isError(), '체크 실패 표시');

    assert.match(app.statusText(), /체크 상태를 바꾸지 못했습니다/);
    assert.deepEqual(app.doneFlags(), [false]);
    assert.equal(app.checkboxes()[0].checked, false, '체크 표시가 되돌아가야 한다');
    assert.deepEqual(app.tableState(), ['우유:false']);
  });
});

describe('삭제 기능', () => {
  test('가운데 항목을 지우면 그 항목만 DB에서 사라진다', async () => {
    const app = await loadApp({ rows: [{ name: '우유' }, { name: '계란' }, { name: '식빵' }] });
    app.rows()[1].querySelector('.del').click();
    await app.until(() => app.rows().length === 2, '삭제 반영');

    assert.deepEqual(app.names(), ['우유', '식빵']);
    assert.deepEqual(app.tableState(), ['우유:false', '식빵:false']);
  });

  test('전부 지우면 빈 목록 안내가 다시 나온다', async () => {
    const app = await loadApp({ rows: [{ name: '우유' }, { name: '계란' }] });
    app.rows()[0].querySelector('.del').click();
    await app.until(() => app.rows().length === 1, '첫 삭제');
    app.rows()[0].querySelector('.del').click();
    await app.until(() => app.rows().length === 0, '두 번째 삭제');

    assert.equal(app.emptyVisible(), true);
    assert.equal(app.count.textContent, '');
    assert.deepEqual(app.tableState(), []);
  });

  test('삭제에 실패하면 오류를 알리고 목록은 그대로 둔다', async () => {
    const app = await loadApp({ rows: [{ name: '우유' }], failOn: 'delete' });
    app.rows()[0].querySelector('.del').click();
    await app.until(() => app.isError(), '삭제 실패 표시');

    assert.match(app.statusText(), /삭제하지 못했습니다/);
    assert.deepEqual(app.names(), ['우유']);
  });
});

describe('체크한 항목 비우기', () => {
  test('완료된 항목만 DB에서 지운다', async () => {
    const app = await loadApp({ rows: [
      { name: '우유', done: true },
      { name: '계란', done: false },
      { name: '식빵', done: true }
    ] });
    app.clearBtn.click();
    await app.until(() => app.rows().length === 1, '완료 항목 비우기');

    assert.deepEqual(app.names(), ['계란']);
    assert.deepEqual(app.tableState(), ['계란:false']);
    assert.equal(app.clearBtn.disabled, true);
  });

  test('완료된 항목이 없으면 버튼이 비활성화되어 있다', async () => {
    const app = await loadApp({ rows: [{ name: '우유' }] });

    assert.equal(app.clearBtn.disabled, true);
  });
});

describe('localStorage에 남은 이전 데이터 이전', () => {
  test('이전 목록을 DB로 옮기고 저장소 키를 지운다', async () => {
    const app = await loadApp({
      legacy: JSON.stringify([
        { name: '우유', done: false },
        { name: '계란', done: true }
      ])
    });

    assert.deepEqual(app.tableState(), ['우유:false', '계란:true']);
    assert.deepEqual(app.names(), ['우유', '계란']);
    assert.equal(app.window.localStorage.getItem(LEGACY_KEY), null);
  });

  test('저장값이 깨져 있으면 아무것도 옮기지 않는다', async () => {
    for (const bad of ['not json', '{"a":1}', 'null']) {
      const app = await loadApp({ legacy: bad });
      assert.deepEqual(app.tableState(), [], `입력: ${bad}`);
      assert.equal(app.db._calls.filter(c => c.op === 'insert').length, 0, `입력: ${bad}`);
    }
  });

  test('이름이 없는 항목은 걸러서 옮긴다', async () => {
    const app = await loadApp({
      legacy: JSON.stringify([{ name: '우유' }, null, { done: true }, { name: '   ' }])
    });

    assert.deepEqual(app.tableState(), ['우유:false']);
  });
});
