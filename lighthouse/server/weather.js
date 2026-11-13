'use strict';
// The weather over the owner's area, for the Home scene. Open-Meteo, no key, polled every ten minutes, only when
// config.json names a place or coordinates: "weather": {"place": "Town, ST"} or {"lat": .., "lon": ..}. The response
// carries the sky, never the place: weather code (WMO), precipitation, cloud cover, wind, day or night, and when it
// was read.
const https = require('https');

module.exports = function makeWeather(ctx) {
  const { cfg, now } = ctx;
  const WX = { data: null, geo: null, error: null };
  function httpsJson(u) {
    return new Promise((resolve, reject) => {
      https
        .get(u, { headers: { 'User-Agent': 'lighthouse-board' } }, res => {
          let b = '';
          res.on('data', d => (b += d));
          res.on('end', () => {
            try {
              resolve(JSON.parse(b));
            } catch (e) {
              reject(e);
            }
          });
        })
        .on('error', reject);
    });
  }
  async function pollWeather() {
    const w = cfg.weather;
    if (!w) return;
    try {
      if (!WX.geo) {
        if (w.lat != null && w.lon != null) WX.geo = { lat: Number(w.lat), lon: Number(w.lon) };
        else if (w.place) {
          const g = await httpsJson(
            'https://geocoding-api.open-meteo.com/v1/search?count=1&name=' + encodeURIComponent(w.place),
          );
          const r = g && g.results && g.results[0];
          if (!r) throw new Error('place not found');
          WX.geo = { lat: r.latitude, lon: r.longitude };
        } else return;
      }
      const j = await httpsJson(
        'https://api.open-meteo.com/v1/forecast?latitude=' +
          WX.geo.lat +
          '&longitude=' +
          WX.geo.lon +
          '&current=weather_code,precipitation,cloud_cover,wind_speed_10m,is_day,temperature_2m&wind_speed_unit=kmh',
      );
      const c = j && j.current;
      if (!c) throw new Error('no current weather in the answer');
      WX.data = {
        code: c.weather_code,
        rain: c.precipitation,
        cloud: c.cloud_cover,
        wind: c.wind_speed_10m,
        day: c.is_day,
        temp: c.temperature_2m,
        at: now(),
      };
      WX.error = null;
    } catch (e) {
      WX.error = e.message;
    }
  }
  if (cfg.weather) {
    pollWeather();
    setInterval(pollWeather, 10 * 60 * 1000).unref();
  }

  return { WX };
};
