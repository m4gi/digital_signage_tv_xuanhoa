// Admin UI entry: each page lives in its own module and is wired to its hash route here.
// Routes: #/lich, #/nhap, #/phong, #/phong/{code|moi}, #/giaodien, #/mau/{id}, #/hethong.
import { start } from './admin-core.js';
import { pageSchedule } from './admin-schedule.js';
import { pageImport } from './admin-import.js';
import { pageRooms, pageRoom } from './admin-rooms.js';
import { pageAppearance } from './admin-appearance.js';
import { pageThemes } from './admin-themes.js';
import { pageSystem } from './admin-system.js';

start({
  lich: { list: pageSchedule },
  nhap: { list: pageImport },
  phong: { list: pageRooms, item: pageRoom },
  giaodien: { list: pageAppearance },
  mau: { list: pageThemes, tab: 'giaodien' }, // #/mau/{id}: the page reads the theme id itself
  hethong: { list: pageSystem },
});
