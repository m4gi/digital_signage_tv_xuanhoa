// Page "Hệ thống": ports, admin IPs, retention and the audit log.

import { ACTIONS, h, api, dmy, card } from './admin-core.js';

// ---------- Hệ thống ----------

async function pageSystem(app) {
  const [settings, audit] = await Promise.all([api('GET', '/api/settings'), api('GET', '/api/audit?limit=100')]);
  app.replaceChildren(h('div', { class: 'stack' }, systemCard(settings), auditCard(audit)));
}

function systemCard(settings) {
  return card('Thông tin hệ thống', 'Các mục này sửa trong file data\\settings.json trên máy chủ, rồi khởi động lại dịch vụ.',
    h('div', { class: 'small' }, `Cổng màn hình: ${settings.screenPort} · Cổng quản trị: ${settings.adminPort}`),
    h('div', { class: 'small' }, 'Máy được phép quản trị: ' + (settings.adminAllow.includes('0.0.0.0/0') ? 'mọi máy trong mạng'
      : settings.adminAllow.length ? settings.adminAllow.join(', ') : 'chỉ máy chủ')),
    h('div', { class: 'small' }, settings.retentionDays > 0
      ? `Tự xoá dữ liệu cũ hơn ${settings.retentionDays} ngày (cuộc họp, file Excel đã nhập, nhật ký, bản sao lưu).`
      : 'Không tự xoá dữ liệu cũ.'));
}

function auditCard(audit) {
  return card('Nhật ký thao tác', '100 thao tác gần nhất. Toàn bộ nằm trong data\\audit.log.',
    !audit.length ? h('p', { class: 'muted' }, 'Chưa có thao tác nào.') : h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Lúc', 'Máy', 'Thao tác', 'Đối tượng'].map(x => h('th', null, x)))),
      h('tbody', null, audit.map(a => h('tr', null,
        h('td', { style: 'white-space:nowrap' }, `${a.at.slice(11, 16)} ${dmy(a.at.slice(0, 10))}`),
        h('td', { class: 'mono' }, a.ip),
        h('td', null, ACTIONS[a.action] || a.action),
        h('td', { class: 'mono small' }, a.target)))))));
}

export { pageSystem };