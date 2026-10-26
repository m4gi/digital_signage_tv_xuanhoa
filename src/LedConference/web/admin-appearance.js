// Page "Giao diện": global look of the screens, org names and logo.

import { EFFECTS, ORIENTATIONS, EMPTY_DAYS, SKYLINES, SWITCHES, h, api, toast, options, field, showErrors, route, loadBrand, act, switchRow } from './admin-core.js';

// ---------- Giao diện ----------

async function pageAppearance(app) {
  const [settings, themes] = await Promise.all([api('GET', '/api/settings'), api('GET', '/api/themes')]);
  app.replaceChildren(h('div', { class: 'stack' },
    themes.fileError && h('div', { class: 'alert error' }, h('strong', null, 'File data\\themes.json đang sai, các mẫu cũ vẫn được dùng: '), themes.fileError),
    appearanceCard(settings, themes.items),
    orgCard(settings)));
}

function themeChoices(themes, selected, name) {
  return h('div', { class: 'choices' }, themes.map(t => h('label', { class: 'choice' },
    h('input', { type: 'radio', name, value: t.id, checked: t.id === selected, 'aria-label': t.name }),
    h('span', { class: 'swatch', style: `background:linear-gradient(${t.tokens.bgAngle}deg,${t.tokens.bg1},${t.tokens.bg2})` }),
    h('span', null, h('strong', null, t.name), h('div', { class: 'small muted' }, t.builtIn ? (t.modified ? 'Mẫu gốc, đã chỉnh' : 'Mẫu gốc') : 'Mẫu tự tạo')))));
}

function appearanceCard(settings, themes) {
  const d = settings.display;
  const effect = h('select', { 'data-field': 'display.effect' }, options(EFFECTS, d.effect));
  const orientation = h('select', { 'data-field': 'display.orientation' }, options(ORIENTATIONS, d.orientation));
  const emptyDay = h('select', { 'data-field': 'display.emptyDay' }, options(EMPTY_DAYS, d.emptyDay));
  const skyline = h('select', { 'data-field': 'display.skyline' }, options(SKYLINES, d.skyline || 'normal'));
  const note = h('input', { type: 'text', 'data-field': 'display.footerNote', value: d.footerNote || '', maxLength: 200, placeholder: 'Để trống thì không hiện' });
  const form = h('form', { class: 'card' },
    h('div', { class: 'row between' },
      h('div', null, h('h2', { class: 'card-title' }, 'Giao diện màn hình (cấu hình chung)'),
        h('p', { class: 'card-hint' }, 'Áp dụng cho mọi phòng. Phòng nào cần khác thì sửa ở tab “Phòng & màn hình”. Màn hình đổi trong vòng 1 phút.')),
      h('a', { href: '#/mau' }, 'Chỉnh màu từng mẫu, tạo mẫu mới ›')),
    h('fieldset', { style: 'border:0;margin:0;padding:0' }, h('legend', { style: 'font-weight:600;padding:0;margin-bottom:8px' }, 'Mẫu giao diện'),
      themeChoices(themes, d.theme, 'theme')),
    h('div', { class: 'grid' }, field('Hiệu ứng chuyển cảnh', effect), field('Màn hình đứng hay ngang', orientation),
      field('Khi hết lịch trong ngày, hiện', emptyDay), field('Hình đường chân trời', skyline)),
    field('Dòng ghi chú cố định ở chân màn hình', note),
    h('div', { class: 'grid', style: 'gap:4px 24px' }, SWITCHES.map(([k, label, hint]) => switchRow(k, label, hint, !!d[k]))),
    h('div', null, h('button', { class: 'btn primary', type: 'submit' }, 'Lưu giao diện')));
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const display = {
      theme: form.querySelector('input[name=theme]:checked').value, effect: effect.value, orientation: orientation.value,
      emptyDay: emptyDay.value, skyline: skyline.value, footerNote: note.value.trim(),
    };
    for (const [k] of SWITCHES) display[k] = form.querySelector(`input[name=${k}]`).checked;
    try { await api('PUT', '/api/settings', { display }); toast('Đã lưu giao diện.'); route(); } catch (e) { showErrors(form, e); }
  });
  return form;
}

function orgCard(settings) {
  const line1 = h('input', { type: 'text', 'data-field': 'org.line1', value: settings.org.line1, maxLength: 100 });
  const line2 = h('input', { type: 'text', 'data-field': 'org.line2', value: settings.org.line2, maxLength: 100 });
  const preview = h('div', { class: 'brand-logo', style: 'width:72px;height:72px' }, 'LOGO');
  const img = new Image();
  img.onload = () => { preview.textContent = ''; preview.style.backgroundImage = `url("/logo?v=${settings.logoVersion}")`; };
  img.src = `/logo?v=${settings.logoVersion}`;
  const file = h('input', { type: 'file', accept: 'image/webp,image/png,image/jpeg', class: 'sr-only', id: 'logoFile' });
  file.addEventListener('change', () => file.files[0] &&
    act(api('POST', '/api/logo', file.files[0], { 'Content-Type': file.files[0].type || 'application/octet-stream' }), 'Đã đổi logo.').then(loadBrand));
  const form = h('form', { class: 'card' },
    h('h2', { class: 'card-title' }, 'Đơn vị & logo'),
    field('Dòng 1', line1), field('Dòng 2 (tên đơn vị)', line2),
    h('div', { class: 'row' }, preview,
      h('label', { class: 'btn', for: 'logoFile' }, 'Đổi logo (WebP/PNG/JPG, tối đa 2MB)'), file,
      h('button', { class: 'btn', type: 'button', onclick: () => act(api('DELETE', '/api/logo'), 'Đã dùng lại logo mặc định.').then(loadBrand) }, 'Dùng logo mặc định')),
    h('p', { class: 'small muted' }, 'Logo mặc định của phường có sẵn trong phần mềm; chỉ cần đổi khi logo thay đổi.'),
    h('div', null, h('button', { class: 'btn primary', type: 'submit' }, 'Lưu')));
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    try { await api('PUT', '/api/settings', { org: { line1: line1.value, line2: line2.value } }); toast('Đã lưu.'); loadBrand(); } catch (e) { showErrors(form, e); }
  });
  return form;
}

export { pageAppearance };