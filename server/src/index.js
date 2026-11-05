import { createApp } from './app.js';
import { config } from './config.js';
import { migrate } from './migrate.js';

await migrate();
createApp().listen(config.port, () => {
  console.log(`Trackify API listening on :${config.port} (${config.env})`);
});
